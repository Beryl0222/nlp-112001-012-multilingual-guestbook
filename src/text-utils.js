/**
 * 文本定位与分句工具。
 * 所有公开/私人片段都带字符范围，范围相对该记录的原始 text 字段，
 * 使在线展面能定位受影响的引用与组合线索。
 */

/** 按中文句读与英文句末标点切句，保留每句在原文中的起止位置（不含前导空白）。 */
export function splitSentences(text) {
  const sentences = [];
  const pattern = /[^。！？!?\.]+[。！？!?\.]*/g;
  let match;
  while ((match = pattern.exec(text)) !== null) {
    const raw = match[0];
    const leading = raw.length - raw.replace(/^\s+/, '').length;
    const start = match.index + leading;
    const end = match.index + raw.length;
    const content = raw.slice(leading);
    if (content.trim().length > 0) {
      sentences.push({ start, end, text: content });
    }
  }
  return sentences;
}

/** 在原文中定位子串，返回半开区间 [start, end)；找不到返回 null。 */
export function locate(text, fragment) {
  const index = text.indexOf(fragment);
  if (index < 0) return null;
  return { start: index, end: index + fragment.length };
}

/** 取原文指定范围。 */
export function sliceRange(text, range) {
  return text.slice(range.start, range.end);
}

/** 把若干不相交或相邻范围合并为最少数量的连续范围。 */
export function mergeRanges(ranges) {
  const sorted = ranges
    .filter(range => range && Number.isInteger(range.start) && Number.isInteger(range.end))
    .sort((a, b) => a.start - b.start);
  const merged = [];
  for (const range of sorted) {
    const last = merged[merged.length - 1];
    if (last && range.start <= last.end) {
      last.end = Math.max(last.end, range.end);
    } else {
      merged.push({ start: range.start, end: range.end });
    }
  }
  return merged;
}

/** 按遮蔽范围生成公开文本：范围内字符替换为等长占位（中文用 █，拉丁词用 [已抹除]）。 */
export function redactText(text, ranges) {
  const merged = mergeRanges(ranges);
  let output = '';
  let cursor = 0;
  for (const range of merged) {
    output += text.slice(cursor, range.start);
    output += '[已抹除]';
    cursor = range.end;
  }
  output += text.slice(cursor);
  return output;
}
