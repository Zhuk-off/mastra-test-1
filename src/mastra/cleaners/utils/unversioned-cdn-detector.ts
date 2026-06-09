import { resolve, dirname, relative } from 'node:path';
import type { DetectedLib } from '../passes/js-advanced/detectors/detect-unversioned-lib.js';
import type { CdnReplacement } from '../types.js';
import { fetchOfficial } from './cdn-detector.js';

export async function buildUnversionedCdnReplacements(
  siteDir: string,
  htmlFilePath: string,
  html: string,
  unversionedLibMap: Map<string, DetectedLib>,
): Promise<Map<string, CdnReplacement>> {
  const result = new Map<string, CdnReplacement>();
  const fileDir = dirname(htmlFilePath);

  const scriptRe = /<script\b[^>]*?\bsrc\s*=\s*(['"])([^'"]+)\1/gi;
  const linkRe = /<link\b[^>]*?\bhref\s*=\s*(['"])([^'"]+)\2/gi;

  const urls = new Set<string>();
  let m;
  while ((m = scriptRe.exec(html)) !== null) urls.add(m[2]!);
  while ((m = linkRe.exec(html)) !== null) urls.add(m[2]!);

  for (const url of urls) {
    if (/^https?:\/\//i.test(url) || url.startsWith('//')) continue;

    const localPath = resolve(fileDir, url);
    const relPath = relative(siteDir, localPath);

    const detected = unversionedLibMap.get(relPath);
    if (!detected) continue;

    // UCDN-1: SRI обязан считаться от ОФИЦИАЛЬНОГО CDN-файла, а не от локального — браузер
    // качает CDN и сверяет хеш; локальная копия почти никогда не байт-в-байт идентична
    // (другой минификатор/патч) → mismatch → скрипт заблокирован. UCDN-2: если CDN-URL
    // недоступен (404/сеть) — НЕ репиним (локальный файл остаётся фолбэком), а не ломаем сайт.
    const cdnUrl = detected.lib.cdnUrl(detected.version);
    const { ok, sri } = await fetchOfficial(cdnUrl);
    if (!ok) continue;

    result.set(url, { cdnUrl, integrity: sri });
  }

  return result;
}
