/**
 * 同意登记的结构化解析与许可判定。
 *
 * 登记 text 是自由文字，这里把它解析成按元素（祝词/昵称/同行者/地点/语言）
 * 的允许或限制。规则只对本登记的 source 生效；人物对齐不扩大许可范围。
 *
 * 同一 contributor+source 的后一条事件覆盖前一条（如 r3 的次日改定），
 * 被覆盖的事件保留在决定依据里（退役版本仍能说明当时采用的理由）。
 */

/**
 * 元素类型：
 * - greeting   原祝词/祝愿本身
 * - nickname   昵称或本人标识
 * - companion  同行者身份信息
 * - place      地点/摊名线索
 * - language   语言限制
 */
const RULES = [
  {
    element: 'greeting',
    allow: [/原祝词可用/, /这句可译/, /可公开祝词/, /可译/, /保留祝词/, /可留祝词/, /留祝词/],
    deny: [/祝词.*不可/, /撤回/]
  },
  {
    element: 'nickname',
    allow: [/可留自己的昵称/, /同意保留.*昵称/, /保留.*昵称/],
    deny: [/不公开本人标识/, /只可留祝词/, /要求抹除身份/, /抹除身份/]
  },
  {
    element: 'companion',
    allow: [],
    deny: [/同行者.*不公开/, /旁边人的身份未确认/, /同行者信息不公开/]
  },
  {
    element: 'place',
    allow: [],
    deny: [/地点.*不公开/, /地点.*受限/]
  },
  {
    element: 'language',
    allow: [/可译/],
    deny: [/语言.*受限/]
  }
];

/**
 * 解析单条登记。
 * @returns {{id:string, contributor:string, source:string, scopeText:string,
 *           events:Array, raw:string}}
 */
export function parseConsent(row) {
  const text = row.text;
  const events = [];

  // “次日改为/后来改为/变更为”拆成两个有序事件，旧事件标记 superseded
  const changeMatch = text.match(/^(.+?)。(次日|后来)?改为(.+?)。?$/);
  if (changeMatch) {
    events.push(buildEvent(row, changeMatch[1] + '。', 'initial', null));
    events.push(buildEvent(row, changeMatch[3] + '。', 'revision', events[0].eventId));
    events[0].supersededBy = events[1].eventId;
  } else {
    events.push(buildEvent(row, text, 'sole', null));
  }

  return {
    id: row.id,
    contributor: row.contributor,
    source: row.source,
    scopeText: row.scope,
    events,
    raw: text
  };
}

function buildEvent(row, clause, phase, supersedes) {
  const rules = [];
  for (const rule of RULES) {
    if (rule.deny.some(pattern => pattern.test(clause))) {
      rules.push({ element: rule.element, decision: 'deny', matched: matchOne(clause, rule.deny) });
    } else if (rule.allow.some(pattern => pattern.test(clause))) {
      rules.push({ element: rule.element, decision: 'allow', matched: matchOne(clause, rule.allow) });
    }
  }
  return {
    eventId: `${row.id}-${phase}`,
    phase,
    clause,
    supersedes,
    supersededBy: null,
    rules
  };
}

function matchOne(clause, patterns) {
  for (const pattern of patterns) {
    const match = clause.match(pattern);
    if (match) return match[0];
  }
  return null;
}

/** 汇总全部登记，按 source 索引；每个 source 保留事件时间线。 */
export function buildConsentLedger(materials) {
  const parsed = materials['同意登记.json'].map(parseConsent);
  const bySource = new Map();
  for (const entry of parsed) {
    const list = bySource.get(entry.source) ?? [];
    list.push(entry);
    bySource.set(entry.source, list);
  }
  return {
    entries: parsed,
    forSource(source) {
      return bySource.get(source) ?? [];
    },
    /** 该 source 当前（未被覆盖）的许可规则集合。 */
    currentRules(source) {
      const result = [];
      for (const entry of this.forSource(source)) {
        const live = entry.events.filter(event => event.supersededBy === null);
        for (const event of live) result.push(...event.rules.map(rule => ({ ...rule, consentId: entry.id, scopeText: entry.scopeText })));
      }
      return result;
    }
  };
}

/**
 * 展区与登记 scope 的匹配。
 * 登记 scope（如“园区纸展”）覆盖展区 medium（如“纸展”）时视为同一场地；
 * 双语网页按 medium 全称匹配。
 */
export function scopeMatchesVenue(scopeText, venue) {
  if (scopeText === venue.medium) return true;
  if (scopeText.includes(venue.medium) || venue.medium.includes(scopeText)) return true;
  // 园区纸展 ↔ 纸展：去掉“园区”等前缀后比较
  const normalized = scopeText.replace(/^园区/, '');
  return normalized === venue.medium;
}

/** 某 source 在某展区是否存在当前有效的同意。 */
export function hasLiveConsent(ledger, source, venue) {
  return ledger.forSource(source).some(entry =>
    entry.events.some(event => event.supersededBy === null) &&
    scopeMatchesVenue(entry.scopeText, venue)
  );
}

/** 查某元素在某展区的当前决定：allow / deny / 未表态。 */
export function elementDecision(ledger, source, venue, element) {
  let decision = null;
  for (const rule of ledger.currentRules(source)) {
    if (rule.element !== element) continue;
    if (!scopeMatchesVenue(rule.scopeText, venue)) continue;
    // 同元素多条时 deny 优先（最保守）
    if (rule.decision === 'deny') return { decision: 'deny', consentId: rule.consentId };
    decision = { decision: 'allow', consentId: rule.consentId };
  }
  return decision;
}
