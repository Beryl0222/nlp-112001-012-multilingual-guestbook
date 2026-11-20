#!/usr/bin/env node
/**
 * 展务命令行。
 *
 * 用法：
 *   node src/cli.js build                         生成公开/退役/审阅输出
 *   node src/cli.js inquiry <记录编号>            来宾查询：使用场地、批准范围、展示状态
 *   node src/cli.js locate <记录编号>             在线展面定位受影响的引用与组合线索
 *   node src/cli.js review                        展务审阅报告（含退役版本）
 */
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import { runPipeline, publicInquiry, locateAffected } from './pipeline.js';
import { staffReview } from './inquiry.js';
import { readMaterials } from '../materials.js';
import { readDecisions } from './decisions.js';
import { buildPersonRegistry } from './person-registry.js';
import { buildConsentLedger } from './consent.js';
import { buildReleases } from './versioning.js';

const root = new URL('../', import.meta.url);
const materialsDir = new URL('资料/', root);
const decisionsDir = new URL('展务/', root);
const outputDir = new URL('输出/', root);

async function loadReleases() {
  const materials = await readMaterials(materialsDir);
  const decisions = await readDecisions(decisionsDir);
  const registry = buildPersonRegistry(materials, decisions);
  const ledger = buildConsentLedger(materials);
  return buildReleases(materials, registry, decisions, ledger, materials['展区.json']);
}

async function main() {
  const [command, arg] = process.argv.slice(2);
  switch (command) {
    case 'build': {
      await runPipeline({
        materialsDir,
        decisionsDir,
        outputDir,
        log: message => process.stdout.write(`${message}\n`)
      });
      break;
    }
    case 'inquiry': {
      if (!arg) throw new Error('用法：inquiry <记录编号>，例如 inquiry b3');
      const releases = await loadReleases();
      process.stdout.write(`${JSON.stringify(publicInquiry(releases, arg), null, 2)}\n`);
      break;
    }
    case 'locate': {
      if (!arg) throw new Error('用法：locate <记录编号>，例如 locate b2');
      const releases = await loadReleases();
      process.stdout.write(`${JSON.stringify(locateAffected(releases, arg), null, 2)}\n`);
      break;
    }
    case 'review': {
      const releases = await loadReleases();
      process.stdout.write(`${JSON.stringify(staffReview(releases), null, 2)}\n`);
      break;
    }
    default:
      process.stderr.write('未知命令。可用：build | inquiry <编号> | locate <编号> | review\n');
      process.exitCode = 1;
  }
}

main().catch(error => {
  process.stderr.write(`${error.message}\n`);
  process.exitCode = 1;
});
