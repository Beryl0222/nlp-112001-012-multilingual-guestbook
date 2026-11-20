/**
 * 发布版本管理。
 *
 * 同意登记里的改定事件（如 r3“次日改为”）产生有序版本：
 * - v1 采用各登记的初始决定；
 * - v2 采用当前（改定后）决定，是在线展面使用的当前版本；
 * - 被取代的 v1 移入退役目录，仅向展务审阅者开放，并保留当时采用的决定依据。
 *
 * 版本内容由同意事件时间线确定性生成，不依赖运行时刻，便于核对。
 */
import { buildCuration } from './curation.js';

/**
 * 按指定事件切片重建许可台账视图。
 * phase 为 'initial' 时只看初始事件（修订事件视为尚未发生）；
 * 否则看全部当前事件。
 */
function ledgerAtPhase(ledger, phase) {
  if (phase === 'current') return ledger;
  return {
    entries: ledger.entries,
    forSource: ledger.forSource.bind(ledger),
    currentRules(source) {
      const result = [];
      for (const entry of ledger.forSource(source)) {
        const live = entry.events.filter(event =>
          phase === 'initial' ? event.phase === 'initial' || event.phase === 'sole' : event.supersededBy === null
        );
        for (const event of live) {
          result.push(...event.rules.map(rule => ({ ...rule, consentId: entry.id, scopeText: entry.scopeText })));
        }
      }
      return result;
    }
  };
}

export function buildReleases(materials, registry, decisions, ledger, venues) {
  const phases = [
    { version: 'v1', label: '初始发布版', phase: 'initial', status: 'retired', access: 'staff-only' },
    { version: 'v2', label: '当前发布版', phase: 'current', status: 'current', access: 'public' }
  ];

  const releases = phases.map(spec => {
    const slicedLedger = ledgerAtPhase(ledger, spec.phase);
    const curation = buildCuration(materials, registry, decisions, slicedLedger, venues);
    return {
      version: spec.version,
      label: spec.label,
      status: spec.status,
      access: spec.access,
      basis: collectBasis(ledger, spec.phase),
      curation
    };
  });

  return {
    current: releases.find(r => r.status === 'current'),
    retired: releases.filter(r => r.status === 'retired'),
    all: releases
  };
}

/** 保留该版本当时采用的决定依据（含被覆盖事件原文）。 */
function collectBasis(ledger, phase) {
  return ledger.entries.map(entry => ({
    consentId: entry.id,
    contributor: entry.contributor,
    source: entry.source,
    scope: entry.scopeText,
    appliedEvents: entry.events
      .filter(event => phase === 'initial'
        ? event.phase === 'initial' || event.phase === 'sole'
        : event.supersededBy === null)
      .map(event => ({ eventId: event.eventId, clause: event.clause, rules: event.rules })),
    retiredEvents: phase === 'current'
      ? entry.events.filter(event => event.supersededBy !== null).map(event => ({
          eventId: event.eventId,
          clause: event.clause,
          supersededBy: event.supersededBy
        }))
      : []
  }));
}
