/**
 * 策展：为每个展区生成可核对的公开内容，并把不能公开的历史决定保留为私人记录。
 *
 * 片段级判定顺序（任一不过即不进入公开版）：
 *  1. 展区语言是否覆盖片段语言；
 *  2. 该 source 在本展区是否有当前有效的同意（许可不跨页、不随人物合并扩大）；
 *  3. 片段是否为跨页引用——引用内容需由被引用记录自己的同意覆盖本展区，
 *     否则整条引用只能留在私人记录；
 *  4. 元素级许可：昵称/同行者/地点等被 deny 的线索须抹除；
 *  5. 抹除后若句子无法独立理解、或读者会把话误归给另一人，则整条转私人；
 *  6. 译文还需：译文元素被原文同意覆盖、且不存在归属错误。
 *
 * 最后做组合线索分析：单条匿名后不明显、并列后可重新指认同一人的，
 * 按展务决定改用替代解释/拆开提示/窄化祝愿，残余风险仍在则撤下。
 */
import { analyzeRecord, analyzeTranslation } from './references.js';
import { elementDecision, hasLiveConsent, scopeMatchesVenue } from './consent.js';
import { redactText } from './text-utils.js';
import { splitSignature } from './person-registry.js';

export function buildCuration(materials, registry, decisions, ledger, venues) {
  const glossary = decisions.glossary;
  const pagesById = new Map(materials['手账.json'].map(row => [row.id, row]));
  // 每页的作者访客编号：以同意登记的 contributor 为准（签名中的同行者称呼排除在外）
  const authorPersonIds = new Map();
  for (const entry of ledger.entries) {
    const personId = registry.personIdFor(entry.contributor);
    if (!personId) continue;
    const set = authorPersonIds.get(entry.source) ?? new Set();
    set.add(personId);
    authorPersonIds.set(entry.source, set);
  }
  const context = { registry, glossary, pagesById, authorPersonIds };

  // 全部手账与译文的片段分析（展区无关的底稿）
  const pageSegments = materials['手账.json'].map(row => ({
    recordId: row.id,
    kind: 'page',
    row,
    segments: analyzeRecord(row, context)
  }));
  const translationSegments = materials['释译.json'].map(row => {
    const sourceRow = pagesById.get(row.source);
    return {
      recordId: row.id,
      kind: 'translation',
      row,
      sourceRow,
      segments: sourceRow
        ? analyzeTranslation(row, sourceRow, context)
        : []
    };
  });

  const venuesReport = venues.map(venue => buildVenue(venue, {
    pageSegments,
    translationSegments,
    pagesById,
    registry,
    decisions,
    ledger,
    authorPersonIds
  }));

  return {
    venues: venuesReport,
    // 展区无关的全量线索簇（展务审阅）
    staffClusters: buildStaffClusters(pageSegments, translationSegments, decisions)
  };
}

function buildVenue(venue, deps) {
  const { pageSegments, translationSegments, pagesById, registry, decisions, ledger, authorPersonIds } = deps;
  const venueLanguages = venue.languages.split(/[、,，]/).map(s => s.trim());
  const publicItems = [];
  const privateItems = [];

  const evaluate = (segment, ownerRow, isTranslation) => {
    const reasons = [];
    const source = isTranslation ? ownerRow.source : ownerRow.id;
    const sourceRow = isTranslation ? pagesById.get(ownerRow.source) : ownerRow;

    // 1. 语言
    if (!venueLanguages.includes(segment.language)) {
      reasons.push({ code: 'language-not-covered', detail: `片段语言 ${segment.language} 不在展区语言 ${venueLanguages.join('/')} 内` });
    }

    // 2. 本 source 的当前同意
    if (!hasLiveConsent(ledger, source, venue)) {
      reasons.push({ code: 'no-live-consent', detail: `${source} 在“${venue.medium}”无当前有效同意` });
    }

    // 3. 跨页引用：被引用记录需自己同意覆盖本展区
    const quoteBlocks = [];
    for (const quote of segment.quotes ?? []) {
      if (!hasLiveConsent(ledger, quote.pointsTo, venue)) {
        quoteBlocks.push({
          code: 'quoted-source-no-consent',
          detail: `引用“${quote.fragment}”指向前页 ${quote.pointsTo}，该记录未同意本展区`
        });
      }
    }
    reasons.push(...quoteBlocks);

    // 6b. 译文归属错误
    if (isTranslation && segment.attributionFault) {
      reasons.push({
        code: 'attribution-fault',
        detail: `译文出现不属于原文作者的称呼：${segment.foreignNames.map(n => n.name).join('、')}`
      });
    }

    // 6c. 译文须在本展区有明确的可译/祝词许可（不能搭源记录一般同意的便车）；
    //     若原来源撤回，只有登记在案、状态有效的重新认证才能让具体片段公开
    let recertified = null;
    if (isTranslation) {
      const greetingVerdict = elementDecision(ledger, source, venue, 'greeting');
      const languageVerdict = elementDecision(ledger, source, venue, 'language');
      const cleared = greetingVerdict?.decision === 'allow' || languageVerdict?.decision === 'allow';
      if (!cleared) {
        const recert = findRecertification(decisions, segment, venue);
        if (recert && recert.状态 === '有效' && !segment.attributionFault) {
          recertified = {
            code: 'recertified-expression',
            detail: `原来源 ${source} 无译文许可，凭重新认证 ${recert.编号} 由 ${recert.独立支持来源} 独立支持，归属重新核对为 ${recert.重新认证归属}`
          };
        } else {
          reasons.push({
            code: 'translation-not-licensed',
            detail: `${source} 未在“${venue.medium}”明确同意该译文/可译范围` +
              (recert ? `；重新认证 ${recert.编号} 状态为${recert.状态}或仍有归属问题` : '')
          });
        }
      }
    }

    // 4. 元素级许可与线索抹除
    const redactRanges = [];
    const authorIds = authorPersonIds.get(source);
    for (const clue of segment.clues ?? []) {
      if (clue.kind === 'name') {
        // 人名分流：本页作者的称呼走昵称元素；被谈论的同行者称呼走同行者元素
        const isAuthorName = clue.personId && authorIds?.has(clue.personId);
        const nameElement = isAuthorName ? 'nickname' : 'companion';
        const nameVerdict = elementDecision(ledger, source, venue, nameElement);
        if (nameVerdict?.decision === 'deny') {
          redactRanges.push({ start: clue.start, end: clue.end, reason: `${nameElement}-denied`, value: clue.value });
        } else if (nameVerdict?.decision !== 'allow') {
          redactRanges.push({ start: clue.start, end: clue.end, reason: isAuthorName ? 'name-not-cleared' : 'companion-name-not-cleared', value: clue.value });
        }
      } else {
        // 职业线索（如木刻/woodcut）与摊位、同行者身份绑定，按同行者元素处理
        const element = clueKindToElement(clue.kind);
        const verdict = element
          ? elementDecision(ledger, source, venue, element)
          : null;
        if (clue.kind === 'companion' || clue.kind === 'occupation' || clue.kind === 'place') {
          // 同行者/职业/地点线索：无明确 allow 即不公开；deny 时记录对应依据
          if (verdict?.decision === 'deny') {
            redactRanges.push({ start: clue.start, end: clue.end, reason: `${element}-denied`, value: clue.value });
          } else if (verdict?.decision !== 'allow') {
            redactRanges.push({ start: clue.start, end: clue.end, reason: `${clue.kind}-not-cleared`, value: clue.value });
          }
        }
      }
    }

    // 5. 抹除后是否仍可独立理解：去掉占位与停用词后必须仍有实词
    const redacted = redactText(segment.text, redactRanges);
    const standalone = hasStandaloneMeaning(redacted);
    if (redactRanges.length > 0 && !standalone) {
      reasons.push({ code: 'not-standalone-after-redaction', detail: '抹除线索后句子无法独立理解，整条保留私人记录' });
    }
    // 引用句若引用被挡，剩余文字也会把祝词误归本页作者 → 整条私人
    if (quoteBlocks.length > 0) {
      reasons.push({ code: 'misattribution-risk', detail: '去掉引用后读者会把前页祝词误归本页作者' });
    }

    const decision = reasons.length === 0 ? 'public' : 'private';
    const item = {
      recordId: segment.recordId,
      source,
      page: sourceRow?.page ?? null,
      kind: isTranslation ? 'translation' : 'page',
      language: segment.language,
      range: { start: segment.start, end: segment.end },
      originalText: segment.text,
      publicText: decision === 'public' ? (redactRanges.length ? redacted : segment.text) : null,
      redaction: redactRanges,
      signatureDisplay: isTranslation ? null : signaturePolicy(sourceRow, registry, ledger, venue),
      recertification: recertified,
      consentScope: ledger.forSource(source).map(e => ({ consentId: e.id, scope: e.scopeText })),
      quotations: segment.quotes ?? [],
      decision,
      reasons
    };
    (decision === 'public' ? publicItems : privateItems).push(item);
    return item;
  };

  for (const group of pageSegments) {
    for (const segment of group.segments) evaluate(segment, group.row, false);
  }
  for (const group of translationSegments) {
    if (!group.sourceRow) {
      privateItems.push({
        recordId: group.recordId,
        source: group.row.source,
        page: null,
        kind: 'translation',
        decision: 'private',
        reasons: [{ code: 'missing-source', detail: `译文来源 ${group.row.source} 在手账中不存在` }]
      });
      continue;
    }
    for (const segment of group.segments) evaluate(segment, group.row, true);
  }

  // 组合线索分析（针对本展区公开项）
  const combo = analyzeCombos(publicItems, decisions);
  for (const withdrawn of combo.withdraw) {
    const index = publicItems.findIndex(item => item === withdrawn.item);
    if (index >= 0) {
      publicItems.splice(index, 1);
      withdrawn.item.decision = 'private';
      withdrawn.item.reasons.push({
        code: 'combination-reidentification',
        detail: `线索簇 ${withdrawn.clusterId} 并列可重新指认同一人，按展务决定撤下并改用窄化祝愿`
      });
      privateItems.push(withdrawn.item);
    }
  }

  return {
    venueId: venue.id,
    medium: venue.medium,
    audience: venue.audience,
    languages: venueLanguages,
    public: publicItems,
    private: privateItems,
    combinationReport: combo.report
  };
}

function clueKindToElement(kind) {
  if (kind === 'name') return 'nickname';
  // 职业线索（木刻/woodcut）与同行者身份绑定，归入同行者元素
  if (kind === 'companion' || kind === 'occupation') return 'companion';
  if (kind === 'place') return 'place';
  return null;
}

/**
 * 查找适用于某译文片段、且覆盖本展区的重新认证。
 * 要求认证片段确实出现在译文中，且独立支持来源与原来源不同。
 */
function findRecertification(decisions, segment, venue) {
  const entries = decisions.recertification?.认证 ?? [];
  return entries.find(entry =>
    entry.译文 === segment.recordId &&
    segment.text.includes(entry.片段) &&
    entry.独立支持来源 &&
    entry.独立支持来源 !== segment.source &&
    (entry.适用展区 === venue.medium || entry.适用展区 === undefined)
  ) ?? null;
}

/**
 * 签名展示策略：逐个称呼判断。
 * - 作者本人的称呼按昵称元素许可（allow 显示，否则匿名）；
 * - 出现在签名里的同行者称呼（如 b1 的“小伊”）按同行者元素处理，未确认不显示。
 * 返回公开签名文本与每个称呼的依据。
 */
function signaturePolicy(pageRow, registry, ledger, venue) {
  const tokens = splitSignature(pageRow.signature);
  const parts = tokens.map(name => {
    const nicknameVerdict = elementDecision(ledger, pageRow.id, venue, 'nickname');
    const companionVerdict = elementDecision(ledger, pageRow.id, venue, 'companion');
    // 该称呼是否属于本页登记的同意人本人
    const isAuthor = ledger.forSource(pageRow.id)
      .some(entry => entry.contributor === name
        || registry.namesOf(registry.personIdFor(entry.contributor) ?? '').includes(name));
    if (isAuthor) {
      return nicknameVerdict?.decision === 'allow'
        ? { token: name, display: name, basis: 'nickname-allowed' }
        : { token: name, display: null, basis: nicknameVerdict?.decision === 'deny' ? 'nickname-denied' : 'name-not-cleared' };
    }
    // 非同意人 = 被谈论的同行者
    return {
      token: name,
      display: null,
      basis: companionVerdict?.decision === 'deny' ? 'companion-denied' : 'companion-not-cleared'
    };
  });
  const visible = parts.filter(part => part.display !== null).map(part => part.display);
  return {
    original: pageRow.signature,
    publicSignature: visible.length > 0 ? visible.join('、') : '匿名访客',
    tokens: parts
  };
}

/** 英文虚词/句法骨架：抹除后若只剩这些词，句子不再承载可独立理解的信息。 */
const STOP_WORDS = new Set([
  'a', 'an', 'the', 'from', 'to', 'of', 'in', 'on', 'at', 'and', 'or',
  'was', 'were', 'is', 'are', 'with', 'me', 'my', 'this', 'that', 'it',
  'for', 'here', 'there', 'by', 'as', 'be', 'been'
]);

/** 中文功能词/句法骨架：单独留下不构成可独立理解的信息。 */
const CJK_STOP_CHARS = new Set([
  '的', '了', '和', '与', '及', '或', '是', '在', '也', '都', '就', '又',
  '把', '被', '让', '给', '向', '从', '到', '来', '去', '着', '过', '吗',
  '呢', '吧', '啊', '呀', '我', '你', '他', '她', '它', '们', '之', '其'
]);

/**
 * 判断抹除后的文本是否仍可独立理解。
 * 中文须保留至少 2 个实义字符（剔除功能词与句读）；
 * 英文须保留至少 1 个非虚词实义词；
 * 纯标点/占位/虚词骨架一律视为不可独立理解。
 */
export function hasStandaloneMeaning(redacted) {
  const withoutMarks = redacted.replace(/\[已抹除\]/g, '');
  const cjk = withoutMarks.match(/[一-鿿]/g) ?? [];
  const contentCjk = cjk.filter(char => !CJK_STOP_CHARS.has(char));
  if (contentCjk.length >= 2) return true;
  const latinWords = withoutMarks
    .toLowerCase()
    .match(/[a-z]+/g) ?? [];
  const contentWords = latinWords.filter(word => !STOP_WORDS.has(word) && word.length > 1);
  return contentWords.length >= 1;
}

/**
 * 组合线索：把展务决定的线索簇与公开项命中情况对照。
 * 若同一簇的线索出现在两条及以上公开项中，标记残余风险并按决定撤下。
 */
function analyzeCombos(publicItems, decisions) {
  const clusters = decisions.clusters?.线索簇 ?? [];
  const report = [];
  const withdraw = [];
  for (const cluster of clusters) {
    const hits = [];
    for (const item of publicItems) {
      const matched = cluster.线索.filter(term =>
        item.originalText.includes(term) || (item.publicText ?? '').includes(term)
      );
      if (matched.length > 0) hits.push({ recordId: item.recordId, matched });
    }
    const exposed = hits.filter(hit =>
      hit.matched.some(term => {
        const item = publicItems.find(i => i.recordId === hit.recordId);
        return (item?.publicText ?? '').includes(term);
      })
    );
    const entry = {
      clusterId: cluster.编号,
      risk: cluster.风险,
      handling: cluster.处置,
      alternative: cluster.替代解释,
      narrowedWish: cluster.窄化祝愿,
      exposedIn: exposed.map(hit => hit.recordId),
      residualRisk: exposed.length >= 2
    };
    report.push(entry);
    if (entry.residualRisk) {
      for (const hit of exposed) {
        const item = publicItems.find(i => i.recordId === hit.recordId);
        if (item) withdraw.push({ item, clusterId: cluster.编号 });
      }
    }
  }
  return { report, withdraw };
}

/** 展区无关的全量线索簇审阅（含每条记录的原始命中）。 */
function buildStaffClusters(pageSegments, translationSegments, decisions) {
  const clusters = decisions.clusters?.线索簇 ?? [];
  return clusters.map(cluster => ({
    clusterId: cluster.编号,
    terms: cluster.线索,
    risk: cluster.风险,
    handling: cluster.处置,
    occurrences: [...pageSegments, ...translationSegments].flatMap(group =>
      group.segments
        .filter(segment => cluster.线索.some(term => segment.text.includes(term)))
        .map(segment => ({ recordId: segment.recordId, range: { start: segment.start, end: segment.end } }))
    )
  }));
}
