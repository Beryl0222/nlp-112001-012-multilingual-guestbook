import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildPersonRegistry } from '../src/person-registry.js';
import { buildConsentLedger } from '../src/consent.js';
import { buildCuration } from '../src/curation.js';

/**
 * 合成数据：两条各自匿名后不明显的祝愿都含同一线索簇词条，
 * 并列展示时可重新指认同一人，应按展务决定撤下并保留窄化祝愿说明。
 */
function syntheticFixture() {
  const materials = {
    '手账.json': [
      { id: 'p1', page: '1', signature: 'Ana', language: 'en', text: 'Good light to you.' },
      { id: 'p2', page: '2', signature: 'Ben', language: 'en', text: 'Good light again.' }
    ],
    '释译.json': [{ id: 'x1', source: 'p1', language: 'zh', text: '天光正好，给你。' }],
    '同意登记.json': [
      { id: 'c1', contributor: 'Ana', source: 'p1', scope: '双语网页', text: '可公开祝词，不公开本人标识。' },
      { id: 'c2', contributor: 'Ben', source: 'p2', scope: '双语网页', text: '可公开祝词，不公开本人标识。' }
    ],
    '展区.json': [{ id: 'g1', medium: '双语网页', languages: 'zh、en', audience: '公众' }]
  };
  const decisions = {
    people: null,
    glossary: null,
    clusters: {
      线索簇: [{
        编号: 'cx',
        线索: ['Good', 'light'],
        出现于: ['p1', 'p2'],
        风险: '两条祝愿并列可重新指认同一人',
        处置: 'private-only',
        替代解释: '改用通用祝愿说明',
        窄化祝愿: '祝好。'
      }]
    }
  };
  return { materials, decisions };
}

test('两条各含同一簇线索的公开项并列时被撤下并标注组合重新指认', () => {
  const { materials, decisions } = syntheticFixture();
  const registry = buildPersonRegistry(materials, decisions);
  const ledger = buildConsentLedger(materials);
  const curation = buildCuration(materials, registry, decisions, ledger, materials['展区.json']);
  const venue = curation.venues[0];

  // 撤下后公开版不再含这两条
  assert.equal(venue.public.some(i => i.recordId === 'p1'), false);
  assert.equal(venue.public.some(i => i.recordId === 'p2'), false);

  // 私人记录保留原因与窄化祝愿依据
  const withdrawn = venue.private.filter(i => ['p1', 'p2'].includes(i.recordId));
  assert.equal(withdrawn.length, 2);
  for (const item of withdrawn) {
    assert.ok(item.reasons.some(r => r.code === 'combination-reidentification'));
  }
  const report = venue.combinationReport.find(c => c.clusterId === 'cx');
  assert.equal(report.residualRisk, true);
  assert.equal(report.narrowedWish, '祝好。');
  assert.equal(report.alternative, '改用通用祝愿说明');
});

/**
 * 合成数据：原来源对译文无许可，但另一条原文能独立支持该译文片段，
 * 且编辑登记了状态有效的重新认证；片段可凭重新认证公开并重新核对归属。
 */
function recertFixture(status) {
  const materials = {
    '手账.json': [
      { id: 'p1', page: '1', signature: 'Ana', language: 'zh', text: '借用一句祝词。' },
      { id: 'p2', page: '2', signature: 'Cleo', language: 'en', text: 'Good light today.' }
    ],
    '释译.json': [{ id: 'x1', source: 'p1', language: 'en', text: 'Good light today.' }],
    '同意登记.json': [
      { id: 'c1', contributor: 'Ana', source: 'p1', scope: '双语网页', text: '不公开本页译文。' },
      { id: 'c2', contributor: 'Cleo', source: 'p2', scope: '双语网页', text: '可公开祝词，不公开本人标识。' }
    ],
    '展区.json': [{ id: 'g1', medium: '双语网页', languages: 'zh、en', audience: '公众' }]
  };
  const decisions = {
    people: null,
    glossary: null,
    clusters: null,
    recertification: {
      认证: [{
        编号: 'rc1',
        状态: status,
        译文: 'x1',
        片段: 'Good light today',
        原来源: 'p1',
        独立支持来源: 'p2',
        重新认证表达: 'x1 片段与 p2 祝词逐词对应，可独立支持',
        重新认证归属: 'P-Cleo',
        依据: 'p2 明确同意公开祝词',
        适用展区: '双语网页'
      }]
    }
  };
  return { materials, decisions };
}

test('有效的重新认证可让被撤回来源的译文片段公开，并重新核对归属', () => {
  const { materials, decisions } = recertFixture('有效');
  const registry = buildPersonRegistry(materials, decisions);
  const ledger = buildConsentLedger(materials);
  const curation = buildCuration(materials, registry, decisions, ledger, materials['展区.json']);
  const item = curation.venues[0].public.find(i => i.recordId === 'x1');
  assert.ok(item, '有效重新认证的译文片段应公开');
  assert.equal(item.publicText, 'Good light today.');
  assert.equal(item.recertification.code, 'recertified-expression');
});

test('失效的重新认证不放行，译文片段维持私人记录', () => {
  const { materials, decisions } = recertFixture('失效');
  const registry = buildPersonRegistry(materials, decisions);
  const ledger = buildConsentLedger(materials);
  const curation = buildCuration(materials, registry, decisions, ledger, materials['展区.json']);
  assert.equal(curation.venues[0].public.some(i => i.recordId === 'x1'), false);
  const item = curation.venues[0].private.find(i => i.recordId === 'x1');
  assert.ok(item.reasons.some(r => r.code === 'translation-not-licensed'));
});
