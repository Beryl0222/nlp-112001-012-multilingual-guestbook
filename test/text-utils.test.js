import assert from 'node:assert/strict';
import { test } from 'node:test';
import { splitSentences, locate, mergeRanges, redactText } from '../src/text-utils.js';

test('分句保留相对原文的字符范围并去掉前导空白', () => {
  const text = 'Good light today. This greeting is from me, Nari.';
  const sentences = splitSentences(text);
  assert.equal(sentences.length, 2);
  assert.deepEqual(sentences[0], { start: 0, end: 17, text: 'Good light today.' });
  assert.equal(sentences[1].start, 18);
  assert.equal(text.slice(sentences[1].start, sentences[1].end), 'This greeting is from me, Nari.');
});

test('中文按句读切分', () => {
  const sentences = splitSentences('借用上一页的“天光正好”。小伊陪我来，她在松灯摊做木刻。');
  assert.equal(sentences.length, 2);
  assert.equal(sentences[0].text, '借用上一页的“天光正好”。');
});

test('locate 返回半开区间，找不到返回 null', () => {
  assert.deepEqual(locate('abcdef', 'cd'), { start: 2, end: 4 });
  assert.equal(locate('abc', 'z'), null);
});

test('mergeRanges 合并相交与相邻范围', () => {
  assert.deepEqual(mergeRanges([{ start: 0, end: 2 }, { start: 2, end: 5 }, { start: 8, end: 9 }]),
    [{ start: 0, end: 5 }, { start: 8, end: 9 }]);
});

test('redactText 用占位替换遮蔽范围', () => {
  assert.equal(redactText('小伊陪我来', [{ start: 0, end: 2 }]), '[已抹除]陪我来');
});
