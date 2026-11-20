import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readMaterials } from '../materials.js';
import { readDecisions } from '../src/decisions.js';
import { buildPersonRegistry } from '../src/person-registry.js';
import { buildConsentLedger } from '../src/consent.js';
import { analyzeRecord, analyzeTranslation } from '../src/references.js';

async function setup() {
  const materials = await readMaterials();
  const decisions = await readDecisions(new URL('../展务/', import.meta.url));
  const registry = buildPersonRegistry(materials, decisions);
  const ledger = buildConsentLedger(materials);
  const pagesById = new Map(materials['手账.json'].map(r => [r.id, r]));
  const authorPersonIds = new Map();
  for (const entry of ledger.entries) {
    const personId = registry.personIdFor(entry.contributor);
    if (!personId) continue;
    const set = authorPersonIds.get(entry.source) ?? new Set();
    set.add(personId);
    authorPersonIds.set(entry.source, set);
  }
  return {
    materials, decisions, registry, pagesById,
    context: { registry, glossary: decisions.glossary, pagesById, authorPersonIds }
  };
}

test('b1 引用句识别为跨页引用并指向前页 b2', async () => {
  const { materials, decisions, registry, pagesById, context } = await setup();
  const segments = analyzeRecord(pagesById.get('b1'), context);
  const quoteSegment = segments[0];
  assert.equal(quoteSegment.kind, 'quotation');
  assert.equal(quoteSegment.quotes[0].pointsTo, 'b2');
  assert.equal(quoteSegment.quotes[0].confidence, 'confirmed');
});

test('b1 第二句识别同行者、地点与职业线索', async () => {
  const { materials, decisions, registry, pagesById, context } = await setup();
  const segments = analyzeRecord(pagesById.get('b1'), context);
  const kinds = segments[1].clues.map(c => c.kind).sort();
  assert.ok(kinds.includes('name'));
  assert.ok(kinds.includes('companion'));
  assert.ok(kinds.includes('place'));
  assert.ok(kinds.includes('occupation'));
});

test('b4 木刻被识别为职业线索', async () => {
  const { materials, decisions, registry, pagesById, context } = await setup();
  const segments = analyzeRecord(pagesById.get('b4'), context);
  assert.ok(segments[0].clues.some(c => c.kind === 'occupation' && c.value === '木刻'));
});

test('t1 译文出现不属于原文作者的称呼，标记归属错误', async () => {
  const { materials, decisions, registry, pagesById, context } = await setup();
  const t1 = materials['释译.json'].find(r => r.id === 't1');
  const segments = analyzeTranslation(t1, pagesById.get('b1'), context);
  const faulty = segments.some(s => s.attributionFault);
  assert.equal(faulty, true);
});

test('t2 译文通过词条锚点对齐到 b3，且无归属错误', async () => {
  const { materials, decisions, registry, pagesById, context } = await setup();
  const t2 = materials['释译.json'].find(r => r.id === 't2');
  const segments = analyzeTranslation(t2, pagesById.get('b3'), context);
  const first = segments[0];
  assert.ok(first.anchors.length >= 1);
  assert.equal(first.attributionFault, false);
});
