import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readMaterials } from '../materials.js';
import { readDecisions } from '../src/decisions.js';
import { buildPersonRegistry } from '../src/person-registry.js';
import { buildConsentLedger } from '../src/consent.js';
import { buildCuration, hasStandaloneMeaning } from '../src/curation.js';
import { buildReleases } from '../src/versioning.js';
import { publicInquiry, locateAffected } from '../src/inquiry.js';

async function setup() {
  const materials = await readMaterials();
  const decisions = await readDecisions(new URL('../展务/', import.meta.url));
  const registry = buildPersonRegistry(materials, decisions);
  const ledger = buildConsentLedger(materials);
  const venues = materials['展区.json'];
  return { materials, decisions, registry, ledger, venues };
}

const publicTexts = (venue) => venue.public.map(i => i.publicText);
const reasonCodes = (venue) => venue.private.flatMap(i => i.reasons.map(r => r.code));

test('独立理解判定：虚词骨架不算可独立理解', () => {
  assert.equal(hasStandaloneMeaning('A [已抹除] from [已抹除] [已抹除].'), false);
  assert.equal(hasStandaloneMeaning('[已抹除]的[已抹除]来。'), false);
  assert.equal(hasStandaloneMeaning('This greeting is from me, [已抹除].'), true);
  assert.equal(hasStandaloneMeaning('我喜欢旧市的[已抹除]。'), true);
});

test('纸展当前版只公开 b4 去除木刻线索后仍独立的两句', async () => {
  const { materials, decisions, registry, ledger, venues } = await setup();
  const curation = buildCuration(materials, registry, decisions, ledger, venues);
  const paper = curation.venues.find(v => v.medium === '纸展');
  const texts = publicTexts(paper);
  assert.deepEqual(texts, ['我喜欢旧市的[已抹除]。', '给大家留一句平安。']);
  // 木刻被抹除
  assert.ok(paper.public[0].redaction.some(r => r.value === '木刻'));
});

test('b1 引用句因前页 b2 未同意纸展而整条私人，且标注误归风险', async () => {
  const { materials, decisions, registry, ledger, venues } = await setup();
  const curation = buildCuration(materials, registry, decisions, ledger, venues);
  const paper = curation.venues.find(v => v.medium === '纸展');
  const quoteItem = paper.private.find(i => i.recordId === 'b1' && i.quotations.length > 0);
  const codes = quoteItem.reasons.map(r => r.code);
  assert.ok(codes.includes('quoted-source-no-consent'));
  assert.ok(codes.includes('misattribution-risk'));
});

test('双语网页公开版为四条独立可理解内容，b3 同行者句整条私人', async () => {
  const { materials, decisions, registry, ledger, venues } = await setup();
  const curation = buildCuration(materials, registry, decisions, ledger, venues);
  const web = curation.venues.find(v => v.medium === '双语网页');
  assert.deepEqual(publicTexts(web), [
    'Good light today.',
    'This greeting is from me, [已抹除].',
    'I came here to wish the market well.',
    '愿市集一切都好。'
  ]);
  const companion = web.private.find(i => i.originalText?.includes('companion'));
  assert.ok(companion.reasons.some(r => r.code === 'not-standalone-after-redaction'));
});

test('t1 译文因归属错误且无译文许可被私人封存', async () => {
  const { materials, decisions, registry, ledger, venues } = await setup();
  const curation = buildCuration(materials, registry, decisions, ledger, venues);
  const web = curation.venues.find(v => v.medium === '双语网页');
  const t1 = web.private.find(i => i.recordId === 't1');
  const codes = t1.reasons.map(r => r.code);
  assert.ok(codes.includes('attribution-fault'));
  assert.ok(codes.includes('translation-not-licensed'));
});

test('t2 仅祝愿句公开，同行者句私人；公开译文与原文同意范围一致', async () => {
  const { materials, decisions, registry, ledger, venues } = await setup();
  const curation = buildCuration(materials, registry, decisions, ledger, venues);
  const web = curation.venues.find(v => v.medium === '双语网页');
  const t2Public = web.public.filter(i => i.recordId === 't2');
  assert.deepEqual(t2Public.map(i => i.publicText), ['愿市集一切都好。']);
  assert.ok(reasonCodes(web).includes('not-standalone-after-redaction'));
});

test('组合线索簇在公开版无残余并指认可重新识别的词', async () => {
  const { materials, decisions, registry, ledger, venues } = await setup();
  const curation = buildCuration(materials, registry, decisions, ledger, venues);
  const cluster = curation.staffClusters.find(c => c.clusterId === 'c1');
  assert.ok(cluster.occurrences.length >= 3);
  for (const venue of curation.venues) {
    const report = venue.combinationReport.find(c => c.clusterId === 'c1');
    assert.equal(residualSafe(venue, report), true);
  }
});

function residualSafe(venue, report) {
  // 暴露在两条及以上公开项才算残余风险；当前公开项已去除全部簇线索
  return report.residualRisk === false;
}

test('版本发布：v2 为当前公开版，v1 退役且仅展务可见并保留依据', async () => {
  const { materials, decisions, registry, ledger, venues } = await setup();
  const releases = buildReleases(materials, registry, decisions, ledger, venues);
  assert.equal(releases.current.version, 'v2');
  assert.equal(releases.current.access, 'public');
  assert.equal(releases.retired[0].version, 'v1');
  assert.equal(releases.retired[0].access, 'staff-only');
  const basis = releases.retired[0].basis.find(b => b.consentId === 'r3');
  assert.ok(basis.appliedEvents[0].clause.includes('昵称'));
});

test('v1 纸展保留 Yi 昵称，v2 撤回为匿名', async () => {
  const { materials, decisions, registry, ledger, venues } = await setup();
  const releases = buildReleases(materials, registry, decisions, ledger, venues);
  const v1Paper = releases.retired[0].curation.venues.find(v => v.medium === '纸展');
  const v2Paper = releases.current.curation.venues.find(v => v.medium === '纸展');
  const v1Sig = v1Paper.public.find(i => i.recordId === 'b4').signatureDisplay.publicSignature;
  const v2Sig = v2Paper.public.find(i => i.recordId === 'b4').signatureDisplay.publicSignature;
  assert.equal(v1Sig, 'Yi');
  assert.equal(v2Sig, '匿名访客');
});

test('来宾查询返回使用场地、批准范围与展示状态，且不含抹除原因', async () => {
  const { materials, decisions, registry, ledger, venues } = await setup();
  const releases = buildReleases(materials, registry, decisions, ledger, venues);
  const view = publicInquiry(releases, 'b3');
  const web = view.venues.find(v => v.venue === '双语网页');
  assert.equal(web.displayStatus, 'on-display');
  assert.deepEqual(web.approvalScope, ['双语网页']);
  const paper = view.venues.find(v => v.venue === '纸展');
  assert.equal(paper.displayStatus, 'not-displayed');
  assert.equal(JSON.stringify(view).includes('reasons'), false);
});

test('locate 能在线定位受影响片段及其字符范围', async () => {
  const { materials, decisions, registry, ledger, venues } = await setup();
  const releases = buildReleases(materials, registry, decisions, ledger, venues);
  const affected = locateAffected(releases, 'b2');
  assert.ok(affected.every(a => Number.isInteger(a.range.start) && Number.isInteger(a.range.end)));
  assert.ok(affected.some(a => a.relation === 'owner'));
});
