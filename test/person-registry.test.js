import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readMaterials } from '../materials.js';
import { readDecisions } from '../src/decisions.js';
import { buildPersonRegistry, splitSignature, findNameMentions } from '../src/person-registry.js';

const decisionsDir = new URL('../展务/', import.meta.url);

async function setup() {
  const materials = await readMaterials();
  const decisions = await readDecisions(decisionsDir);
  return { materials, registry: buildPersonRegistry(materials, decisions) };
}

test('签名按顿号拆词，拉丁全名整体保留', () => {
  assert.deepEqual(splitSignature('Mei、小伊'), ['Mei', '小伊']);
  assert.deepEqual(splitSignature('May Lin'), ['May Lin']);
});

test('人物对齐把 Mei/May Lin 与 小伊/Yi 归并到同一访客', async () => {
  const { registry } = await setup();
  assert.equal(registry.personIdFor('Mei'), registry.personIdFor('May Lin'));
  assert.equal(registry.personIdFor('小伊'), registry.personIdFor('Yi'));
  assert.notEqual(registry.personIdFor('Nari'), registry.personIdFor('Mei'));
  const p1 = registry.people.find(p => p.id === registry.personIdFor('Mei'));
  assert.deepEqual([...p1.names].sort(), ['May Lin', 'Mei']);
});

test('正文称呼可被定位并指向对应访客', async () => {
  const { registry } = await setup();
  const hits = findNameMentions('小伊陪我来，她在松灯摊做木刻。', registry);
  assert.equal(hits.length, 1);
  assert.equal(hits[0].name, '小伊');
  assert.equal(hits[0].personId, registry.personIdFor('Yi'));
});

test('最长匹配优先，May Lin 不会被拆成 May', async () => {
  const { registry } = await setup();
  const hits = findNameMentions('May Lin wrote here', registry);
  assert.deepEqual(hits.map(h => h.name), ['May Lin']);
});
