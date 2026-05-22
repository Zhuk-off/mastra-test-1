import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { resolve, dirname, relative } from 'node:path';
import type { DetectedLib } from '../passes/js-advanced/detectors/detect-unversioned-lib.js';
import type { CdnReplacement } from '../types.js';

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

    let content: Buffer;
    try {
      content = await readFile(localPath);
    } catch {
      continue;
    }

    const hash = createHash('sha384').update(content).digest('base64');
    const integrity = `sha384-${hash}`;
    const cdnUrl = detected.lib.cdnUrl(detected.version);

    result.set(url, { cdnUrl, integrity });
  }

  return result;
}
