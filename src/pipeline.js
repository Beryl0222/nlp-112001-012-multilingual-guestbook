/**
 * 端到端流水线：读取资料与展务决定 → 人物对齐 → 许可台账 →
 * 策展（公开/私人）→ 版本发布 → 写出可核对的 JSON。
 *
 * 输出目录：
 *   公开/<版本>/<展区>.json   在线展面与来宾可见内容
 *   公开/当前.json            当前版本指针与来宾查询入口
 *   退役/<版本>/<展区>.json   仅展务审阅的历史版本与决定依据
 *   展务/审阅报告.json        展务审阅：私人记录、线索簇、撤回原因
 */
import { mkdir, writeFile, rm } from 'node:fs/promises';
import { readMaterials } from '../materials.js';
import { readDecisions } from './decisions.js';
import { buildPersonRegistry } from './person-registry.js';
import { buildConsentLedger } from './consent.js';
import { buildReleases } from './versioning.js';
import { publicInquiry, staffReview, locateAffected } from './inquiry.js';

export async function runPipeline({ materialsDir, decisionsDir, outputDir, log = () => {} }) {
  const materials = await readMaterials(materialsDir);
  const decisions = await readDecisions(decisionsDir);
  const registry = buildPersonRegistry(materials, decisions);
  const ledger = buildConsentLedger(materials);
  const venues = materials['展区.json'];
  const releases = buildReleases(materials, registry, decisions, ledger, venues);

  await rm(outputDir, { recursive: true, force: true });
  const written = [];

  for (const release of releases.all) {
    const base = release.status === 'current'
      ? new URL('公开/', outputDir)
      : new URL(`退役/${release.version}/`, outputDir);
    for (const venue of release.curation.venues) {
      const payload = release.status === 'current'
        ? {
            version: release.version,
            venue: { id: venue.venueId, medium: venue.medium, audience: venue.audience, languages: venue.languages },
            access: 'public',
            items: venue.public,
            combinationNotice: venue.combinationReport.filter(c => c.exposedIn.length > 0)
          }
        : {
            version: release.version,
            access: 'staff-only',
            basis: release.basis,
            venue: { id: venue.venueId, medium: venue.medium },
            items: venue.public,
            private: venue.private
          };
      const target = new URL(`${venue.medium}.json`, base);
      await mkdir(new URL('.', target), { recursive: true });
      await writeFile(target, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
      written.push(target);
    }
  }

  // 当前版本指针
  const pointer = {
    currentVersion: releases.current.version,
    generatedFrom: {
      pages: materials['手账.json'].length,
      translations: materials['释译.json'].length,
      consents: materials['同意登记.json'].length,
      venues: venues.length
    },
    venues: releases.current.curation.venues.map(v => ({
      medium: v.medium,
      file: `${v.medium}.json`,
      publicItems: v.public.length,
      privateItems: v.private.length
    }))
  };
  await mkdir(outputDir, { recursive: true });
  await writeFile(new URL('公开/当前.json', outputDir), `${JSON.stringify(pointer, null, 2)}\n`, 'utf8');

  // 展务审阅报告
  const review = staffReview(releases);
  await mkdir(new URL('展务/', outputDir), { recursive: true });
  await writeFile(new URL('展务/审阅报告.json', outputDir), `${JSON.stringify(review, null, 2)}\n`, 'utf8');

  log(`公开版本 ${releases.current.version}：${releases.current.curation.venues.map(v => `${v.medium} ${v.public.length} 条公开/${v.private.length} 条私人`).join('；')}`);
  log(`退役版本：${releases.retired.map(r => r.version).join('、')}（仅展务）`);
  return { materials, registry, ledger, releases, written };
}

export { publicInquiry, locateAffected };
