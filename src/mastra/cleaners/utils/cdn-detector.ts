import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { CDN_LIBRARIES } from '../registry/cdn-libraries.js';
import type { CdnReplacement } from '../types.js';

export async function buildCdnReplacements(
  siteDir: string,
  htmlFilePath: string,
  html: string,
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

    const basename = url.split('/').pop() ?? '';

    for (const lib of CDN_LIBRARIES) {
      const match = lib.filePattern.exec(basename);
      if (!match) continue;

      const version = lib.extractVersion(match);
      if (!version) continue;

      const localPath = resolve(fileDir, url);
      let content: Buffer;
      try {
        content = await readFile(localPath);
      } catch {
        continue;
      }

      const hash = createHash('sha384').update(content).digest('base64');
      const integrity = `sha384-${hash}`;
      const cdnUrl = lib.getCdnUrl(version);

      result.set(url, { cdnUrl, integrity });
      break;
    }
  }

  return result;
}
