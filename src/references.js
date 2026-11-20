/**
 * 引用与线索识别。
 *
 * 职责：
 * 1. 区分记录作者自己的表达与对前页的引用（含跨语言引用）；
 * 2. 识别人名/称呼、同行者、地点/摊名、职业等足以指向同行者的线索；
 * 3. 把译文片段对齐到原文片段，并核对译文归属是否与原文一致。
 *
 * 对齐优先使用展务决定（词条对齐.json 的引用核对与词条），
 * 没有决定时退回词条字面匹配；任何猜测都标注 confidence。
 */
import { findNameMentions } from './person-registry.js';
import { locate, splitSentences } from './text-utils.js';

const QUOTE_MARK = /[“”"「」]/g;

/** 同行者线索词（中/英）。 */
const COMPANION_TERMS = ['同伴', '同行者', '陪我', '和我一起', 'companion', 'with me', 'was with me'];
/** 职业/摊位线索词（中/英）。 */
const OCCUPATION_TERMS = ['木刻', 'woodcut', 'artist'];

/**
 * 把一条手账或译文记录拆成带分类的片段。
 * @returns {Array} 片段列表，字段见各分支
 */
export function analyzeRecord(row, context) {
  const { registry, glossary, quoteBases, pagesById } = context;
  const sentences = splitSentences(row.text);
  return sentences.map(sentence => {
    const base = {
      recordId: row.id,
      start: sentence.start,
      end: sentence.end,
      text: sentence.text,
      language: row.language
    };
    return { ...base, ...classifySentence(sentence.text, row, context, { start: sentence.start, end: sentence.end }) };
  });
}

function classifySentence(text, row, context, sentenceRange) {
  const { registry, glossary, quoteBases } = context;
  const nameMentions = findNameMentions(text, registry);
  const quotes = findQuotes(text, row, context, sentenceRange);
  const companionHits = termHits(text, COMPANION_TERMS);
  const occupationHits = termHits(text, OCCUPATION_TERMS);
  const placeHits = findPlaceHits(text, glossary);

  const clueRanges = [
    ...nameMentions.map(hit => ({ start: hit.start, end: hit.end, kind: 'name', value: hit.name, personId: hit.personId })),
    ...companionHits.map(hit => ({ ...hit, kind: 'companion' })),
    ...occupationHits.map(hit => ({ ...hit, kind: 'occupation' })),
    ...placeHits.map(hit => ({ ...hit, kind: 'place' }))
  ].sort((a, b) => a.start - b.start);

  // 引用句：含引号引用或经决定核对指向前页的句子
  const isQuote = quotes.length > 0;
  return {
    kind: isQuote ? 'quotation' : 'own-expression',
    nameMentions,
    quotes,
    clues: clueRanges,
    hasCompanionClue: companionHits.length > 0 || occupationHits.length > 0 || placeHits.length > 0
  };
}

/** 找句中的跨页引用。优先决定文件，其次词条对齐。 */
function findQuotes(text, row, context, sentenceRange) {
  const { glossary, pagesById } = context;
  const quotes = [];
  // 只保留落在当前句子范围内的引用，并把范围换算为句内相对位置
  const inSentence = range => range.start >= sentenceRange.start && range.end <= sentenceRange.end;
  const toLocal = range => ({ start: range.start - sentenceRange.start, end: range.end - sentenceRange.start });

  // 1) 展务已核对的引用
  for (const item of glossary?.引用核对 ?? []) {
    if (item.出处 !== row.id) continue;
    const range = locate(row.text, item.引用片段);
    if (range && inSentence(range)) {
      quotes.push({
        fragment: item.引用片段,
        ...toLocal(range),
        pointsTo: item.指向前页,
        basis: item.依据,
        confidence: 'confirmed'
      });
    }
  }

  // 2) 引号内文本，按词条对齐到前页
  const quoted = text.match(/[“"「]([^”"」]+)[”"」]/g) ?? [];
  for (const token of quoted) {
    const fragment = token.replace(QUOTE_MARK, '');
    if (quotes.some(q => q.fragment === fragment)) continue;
    const target = resolveAcrossLanguages(fragment, glossary, pagesById);
    if (target) {
      const range = locate(text, fragment);
      if (range) {
        quotes.push({
          fragment,
          ...range,
          pointsTo: target.recordId,
          basis: `词条对齐：${fragment} ↔ ${target.matched}`,
          confidence: 'glossary'
        });
      }
    }
  }
  return quotes;
}

/** 用词条表把一种语言的片段对应到另一条记录。 */
function resolveAcrossLanguages(fragment, glossary, pagesById) {
  for (const entry of glossary?.词条 ?? []) {
    const variants = [entry.中文, entry.拉丁].filter(Boolean);
    if (!variants.some(variant => fragment.includes(variant))) continue;
    for (const row of pagesById.values()) {
      const matched = variants.find(variant => row.text.includes(variant));
      if (matched) {
        return { recordId: row.id, matched };
      }
    }
  }
  return null;
}

function findPlaceHits(text, glossary) {
  const placeTerms = (glossary?.词条 ?? [])
    .flatMap(entry => [entry.中文, entry.拉丁])
    .filter(Boolean)
    .filter(term => /松灯|Pine Lamp/i.test(term));
  return termHits(text, placeTerms);
}

function termHits(text, terms) {
  const hits = [];
  for (const term of [...new Set(terms)].sort((a, b) => b.length - a.length)) {
    let from = 0;
    for (;;) {
      const index = text.indexOf(term, from);
      if (index < 0) break;
      const end = index + term.length;
      const overlaps = hits.some(hit => index < hit.end && end > hit.start);
      if (!overlaps) hits.push({ start: index, end, value: term });
      from = end;
    }
  }
  return hits.sort((a, b) => a.start - b.start);
}

/**
 * 分析译文记录：把每个译文句子对齐到来源手账的原文句子。
 * 对齐方式：词条锚点命中；同时核对译文署名/称呼与原文作者是否一致。
 */
export function analyzeTranslation(row, sourceRow, context) {
  const { glossary, registry } = context;
  const segments = splitSentences(row.text).map(sentence => {
    const anchors = [];
    for (const entry of glossary?.词条 ?? []) {
      const variants = [entry.中文, entry.拉丁].filter(Boolean);
      const hitInTranslation = variants.find(variant => sentence.text.includes(variant));
      const hitInSource = variants.find(variant => sourceRow.text.includes(variant));
      if (hitInTranslation && hitInSource) {
        anchors.push({ term: hitInTranslation, counterpart: hitInSource });
      }
    }
    const nameMentions = findNameMentions(sentence.text, registry);
    // 原文作者以同意登记的 contributor 为准；签名里的同行者称呼不算作者
    const authorIds = context.authorPersonIds?.get(sourceRow.id);
    // 译文中出现的人名若不属于原文作者，即为归属/同行者风险
    const foreignNames = nameMentions.filter(hit => !authorIds?.has(hit.personId));
    return {
      recordId: row.id,
      source: sourceRow.id,
      start: sentence.start,
      end: sentence.end,
      text: sentence.text,
      language: row.language,
      anchors,
      nameMentions,
      foreignNames,
      clues: [
        ...nameMentions.map(hit => ({ start: hit.start, end: hit.end, kind: 'name', value: hit.name, personId: hit.personId })),
        ...termHits(sentence.text, COMPANION_TERMS).map(hit => ({ ...hit, kind: 'companion' })),
        ...termHits(sentence.text, OCCUPATION_TERMS).map(hit => ({ ...hit, kind: 'occupation' })),
        ...findPlaceHits(sentence.text, glossary).map(hit => ({ ...hit, kind: 'place' }))
      ].sort((a, b) => a.start - b.start),
      attributionFault: foreignNames.length > 0
    };
  });
  return segments;
}
