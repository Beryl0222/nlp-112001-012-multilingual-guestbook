import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readMaterials } from '../materials.js';
import {
  parseConsent,
  buildConsentLedger,
  scopeMatchesVenue,
  hasLiveConsent,
  elementDecision
} from '../src/consent.js';

const g1 = { id: 'g1', medium: '纸展', languages: 'zh', audience: '园区来宾' };
const g2 = { id: 'g2', medium: '双语网页', languages: 'zh、en', audience: '公众' };

test('r3 的次日改定拆成初始与修订两个事件，初始事件被覆盖', () => {
  const r3 = {
    id: 'r3', contributor: 'Yi', source: 'b4', scope: '园区纸展',
    text: '同意保留祝词和昵称。次日改为只可留祝词。'
  };
  const parsed = parseConsent(r3);
  assert.equal(parsed.events.length, 2);
  assert.equal(parsed.events[0].phase, 'initial');
  assert.equal(parsed.events[1].phase, 'revision');
  assert.equal(parsed.events[0].supersededBy, parsed.events[1].eventId);
});

test('当前规则中 r3 的昵称被撤回，但祝词仍允许', async () => {
  const materials = await readMaterials();
  const ledger = buildConsentLedger(materials);
  assert.equal(elementDecision(ledger, 'b4', g1, 'nickname')?.decision, 'deny');
  assert.equal(elementDecision(ledger, 'b4', g1, 'greeting')?.decision, 'allow');
});

test('初始事件切片中 r3 的昵称仍允许（退役版本依据）', async () => {
  const materials = await readMaterials();
  const ledger = buildConsentLedger(materials);
  const entry = ledger.forSource('b4')[0];
  const initial = entry.events.find(e => e.phase === 'initial');
  const nicknameRule = initial.rules.find(r => r.element === 'nickname');
  assert.equal(nicknameRule.decision, 'allow');
});

test('scope 匹配：园区纸展覆盖纸展，双语网页独立', () => {
  assert.equal(scopeMatchesVenue('园区纸展', g1), true);
  assert.equal(scopeMatchesVenue('纸展', g1), true);
  assert.equal(scopeMatchesVenue('双语网页', g2), true);
  assert.equal(scopeMatchesVenue('双语网页', g1), false);
});

test('一页的许可不随人物合并扩大到另一页', async () => {
  const materials = await readMaterials();
  const ledger = buildConsentLedger(materials);
  // Mei 与 May Lin 是同一访客，但 b1 只同意纸展、b3 只同意双语网页
  assert.equal(hasLiveConsent(ledger, 'b1', g1), true);
  assert.equal(hasLiveConsent(ledger, 'b1', g2), false);
  assert.equal(hasLiveConsent(ledger, 'b3', g2), true);
  assert.equal(hasLiveConsent(ledger, 'b3', g1), false);
});

test('同行者信息在 r1/r2 均为 deny', async () => {
  const materials = await readMaterials();
  const ledger = buildConsentLedger(materials);
  assert.equal(elementDecision(ledger, 'b1', g1, 'companion')?.decision, 'deny');
  assert.equal(elementDecision(ledger, 'b3', g2, 'companion')?.decision, 'deny');
});

test('Nari 本人标识在网页被 deny，但祝词允许', async () => {
  const materials = await readMaterials();
  const ledger = buildConsentLedger(materials);
  assert.equal(elementDecision(ledger, 'b2', g2, 'nickname')?.decision, 'deny');
  assert.equal(elementDecision(ledger, 'b2', g2, 'greeting')?.decision, 'allow');
});
