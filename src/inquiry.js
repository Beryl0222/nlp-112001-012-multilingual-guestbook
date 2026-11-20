/**
 * 来宾查询与展务审阅视图。
 *
 * 来宾询问时可查：某条记录/引用在各展区的使用场地、批准范围与展示状态。
 * 来宾视图只返回公开信息；退役版本、抹除原因细节、线索簇仅展务可见。
 */

/** 来宾视图：某手账记录在当前版本各展区的公开使用情况。 */
export function publicInquiry(releases, recordId) {
  const current = releases.current;
  const venues = current.curation.venues.map(venue => {
    const items = venue.public.filter(item => item.source === recordId || item.recordId === recordId);
    const references = venue.public
      .filter(item => (item.quotations ?? []).some(q => q.pointsTo === recordId))
      .map(item => ({ usedBy: item.recordId, fragments: item.quotations.map(q => q.fragment) }));
    return {
      venue: venue.medium,
      audience: venue.audience,
      displayStatus: items.length > 0 ? 'on-display' : 'not-displayed',
      shownTexts: items.map(item => ({ language: item.language, text: item.publicText })),
      referencedBy: references,
      approvalScope: items[0]?.consentScope.map(c => c.scope) ?? []
    };
  });
  return { recordId, version: current.version, venues };
}

/** 展务视图：含私人记录、退役版本与全部决定依据。 */
export function staffReview(releases) {
  return {
    currentVersion: releases.current.version,
    venues: releases.current.curation.venues.map(venue => ({
      venue: venue.medium,
      publicCount: venue.public.length,
      privateCount: venue.private.length,
      privateItems: venue.private.map(item => ({
        recordId: item.recordId,
        range: item.range ?? null,
        originalText: item.originalText ?? null,
        reasons: item.reasons
      })),
      combinations: venue.combinationReport
    })),
    staffClusters: releases.current.curation.staffClusters,
    retiredVersions: releases.retired.map(release => ({
      version: release.version,
      label: release.label,
      basis: release.basis,
      venues: release.curation.venues.map(venue => ({
        venue: venue.medium,
        publicCount: venue.public.length,
        items: venue.public.map(item => ({ recordId: item.recordId, publicText: item.publicText }))
      }))
    }))
  };
}

/** 在线展面定位：返回受某条记录/线索影响的全部公开片段与引用位置。 */
export function locateAffected(releases, recordId) {
  const affected = [];
  for (const venue of releases.current.curation.venues) {
    for (const item of venue.public) {
      const isOwner = item.source === recordId || item.recordId === recordId;
      const isQuoted = (item.quotations ?? []).some(q => q.pointsTo === recordId);
      if (isOwner || isQuoted) {
        affected.push({
          venue: venue.medium,
          recordId: item.recordId,
          range: item.range,
          text: item.publicText,
          relation: isQuoted ? 'quotation' : 'owner'
        });
      }
    }
  }
  return affected;
}
