/**
 * 人物与称呼对齐：把签名、同意人、正文称呼统一到访客编号，
 * 并在任意文本中标注人名/称呼出现的位置。
 *
 * 对齐来源是展务决定（人物对齐.json）；没有决定时仅按原拼写建表，
 * 不会猜测同一关系，避免把一页的许可错误扩大到另一页。
 */

/**
 * @typedef {Object} Person
 * @property {string} id 访客编号，如 P1
 * @property {string[]} names 该访客的全部已知写法（中文与拉丁字母）
 * @property {string[]} sources 写法出处
 */

/** 建立访客表。 */
export function buildPersonRegistry(materials, decisions) {
  /** @type {Map<string, Person>} */
  const byId = new Map();
  const nameToPerson = new Map();

  const register = (id, names, sources = []) => {
    const existing = byId.get(id);
    const person = existing ?? { id, names: [], sources: [] };
    for (const name of names) {
      if (name && !person.names.includes(name)) person.names.push(name);
    }
    for (const source of sources) {
      if (!person.sources.includes(source)) person.sources.push(source);
    }
    byId.set(id, person);
    for (const name of person.names) nameToPerson.set(name, id);
  };

  if (decisions.people?.人物) {
    for (const entry of decisions.people.人物) {
      register(entry.访客编号, entry.写法 ?? [], entry.来源 ?? []);
    }
  }

  // 资料中出现、但决定文件未覆盖的拼写，单独编号（仅按字面，不合并）。
  let fallback = byId.size;
  const ensureLiteral = (name, source) => {
    if (!name || nameToPerson.has(name)) return nameToPerson.get(name);
    fallback += 1;
    const id = `L${fallback}`;
    register(id, [name], [source]);
    return id;
  };

  for (const row of materials['手账.json']) {
    for (const token of splitSignature(row.signature)) {
      ensureLiteral(token, `${row.id}.signature`);
    }
  }
  for (const row of materials['同意登记.json']) {
    ensureLiteral(row.contributor, `${row.id}.contributor`);
  }

  return {
    people: [...byId.values()].sort((a, b) => a.id.localeCompare(b.id)),
    personIdFor(name) {
      return nameToPerson.get(name) ?? null;
    },
    namesOf(personId) {
      return byId.get(personId)?.names ?? [];
    },
    /**
     * 拉丁全名的名字部分（如 May Lin 的 May）也指向同一访客。
     * 仅对含空格的拉丁名拆词；中文与单词拉丁名不拆，避免误匹配。
     */
    personIdForToken(token) {
      const direct = nameToPerson.get(token);
      if (direct) return direct;
      if (!/^[A-Za-z]+$/.test(token)) return null;
      for (const [name, id] of nameToPerson) {
        if (!name.includes(' ')) continue;
        const parts = name.split(/\s+/);
        if (parts.includes(token)) return id;
      }
      return null;
    }
  };
}

/**
 * 签名字段按、/，/、/空格拆词；长名（含空格的拉丁全名）整体保留。
 * 例："Mei、小伊" -> ["Mei", "小伊"]；"May Lin" -> ["May Lin"]。
 */
export function splitSignature(signature) {
  return signature
    .split(/[、,，]/)
    .map(part => part.trim())
    .filter(Boolean)
    .flatMap(part => {
      // 含空格的拉丁串视为一个全名；纯中文不按空格拆
      if (/[A-Za-z]/.test(part) && part.includes(' ')) return [part];
      return part.split(/\s+/).filter(Boolean);
    });
}

/**
 * 在文本中找出全部已知人名/称呼及其范围（最长匹配优先）。
 * 除整串名称外，拉丁全名的名字部分（May Lin→May）也会命中。
 * @returns {{name:string, personId:string|null, start:number, end:number}[]}
 */
export function findNameMentions(text, registry) {
  const allNames = registry.people
    .flatMap(person => person.names)
    .sort((a, b) => b.length - a.length);
  const hits = [];
  const occupied = [];
  const push = (name, start, end, personId) => {
    const overlaps = occupied.some(range => start < range.end && end > range.start);
    if (overlaps) return;
    occupied.push({ start, end });
    hits.push({ name, personId, start, end });
  };

  // 1) 整串名称（最长优先）
  for (const name of allNames) {
    let from = 0;
    for (;;) {
      const index = text.indexOf(name, from);
      if (index < 0) break;
      push(name, index, index + name.length, registry.personIdFor(name));
      from = index + name.length;
    }
  }

  // 2) 拉丁词元（覆盖全名的名字部分，如 May）
  const latinTokens = text.match(/[A-Za-z]+/g) ?? [];
  let searchFrom = 0;
  for (const token of latinTokens) {
    const index = text.indexOf(token, searchFrom);
    if (index < 0) continue;
    const personId = registry.personIdForToken(token);
    if (personId) push(token, index, index + token.length, personId);
    searchFrom = index + token.length;
  }
  return hits.sort((a, b) => a.start - b.start);
}
