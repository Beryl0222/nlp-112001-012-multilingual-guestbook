/**
 * 展务决定的读取。这些文件只服务展务审阅：人物对齐、词条对齐、组合线索。
 * 决定文件缺失时回退为空决定，工具仍可运行，只是没有人工核对结论。
 */
import { readFile } from 'node:fs/promises';

const decisionFiles = {
  people: '人物对齐.json',
  glossary: '词条对齐.json',
  clusters: '组合线索.json',
  recertification: '重新认证.json'
};

async function readOptional(directory, name) {
  try {
    return JSON.parse(await readFile(new URL(name, directory), 'utf8'));
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw error;
  }
}

export async function readDecisions(directory) {
  const [people, glossary, clusters] = await Promise.all(
    Object.values(decisionFiles).map(name => readOptional(directory, name))
  );
  return { people, glossary, clusters };
}
