import { createHash } from 'node:crypto';
import { CDN_LIBRARIES, type CdnLibraryDef } from '../registry/cdn-libraries.js';
import type { CdnReplacement } from '../types.js';
import { classifyResource, isAbsoluteUrl } from './allowlist.js';

export interface IdentifiedLib {
  lib: CdnLibraryDef;
  version: string;
  cdnUrl: string;
}

/** Распознаёт библиотеку (ядро) по URL — локальному или абсолютному (вкл. фейковые CDN). */
export function identifyLibrary(url: string): IdentifiedLib | null {
  for (const lib of CDN_LIBRARIES) {
    const version = lib.identify(url);
    if (version) {
      return { lib, version, cdnUrl: lib.getCdnUrl(version) };
    }
  }
  return null;
}

// Кэш SRI-хешей официальных файлов (по cdnUrl) на время процесса.
const sriCache = new Map<string, string>();

/**
 * Best-effort: качает официальный файл и считает sha384 для integrity.
 * ВАЖНО: хешируем именно ОФИЦИАЛЬНЫЙ файл (не локальный/фейковый) — иначе SRI
 * не имеет смысла. Если оффлайн/ошибка — возвращаем '' (репин без SRI).
 */
async function fetchSriHash(cdnUrl: string): Promise<string> {
  if (sriCache.has(cdnUrl)) return sriCache.get(cdnUrl)!;
  let sri = '';
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 3000);
    const res = await fetch(cdnUrl, { signal: ctrl.signal, redirect: 'follow' });
    clearTimeout(timer);
    if (res.ok) {
      const buf = Buffer.from(await res.arrayBuffer());
      sri = `sha384-${createHash('sha384').update(buf).digest('base64')}`;
    }
  } catch {
    sri = '';
  }
  sriCache.set(cdnUrl, sri);
  return sri;
}

function collectResourceUrls(html: string): Set<string> {
  const urls = new Set<string>();
  const scriptRe = /<script\b[^>]*?\bsrc\s*=\s*(['"])([^'"]+)\1/gi;
  const linkRe = /<link\b[^>]*?\bhref\s*=\s*(['"])([^'"]+)\2/gi;
  let m: RegExpExecArray | null;
  while ((m = scriptRe.exec(html)) !== null) urls.add(m[2]!);
  while ((m = linkRe.exec(html)) !== null) urls.add(m[2]!);
  return urls;
}

/**
 * Строит карту замен «исходный URL → официальный CDN + SRI».
 * Репиним локальные библиотеки И абсолютные с НЕдоверенных хостов (фейковые CDN).
 * URL, уже на доверенном CDN, не трогаем (минимальный diff).
 */
export async function buildCdnReplacements(
  _siteDir: string,
  _htmlFilePath: string,
  html: string,
): Promise<Map<string, CdnReplacement>> {
  const result = new Map<string, CdnReplacement>();

  for (const url of collectResourceUrls(html)) {
    // Уже на доверенном CDN (абсолютный, классификатор → keep) — оставляем как есть.
    if (isAbsoluteUrl(url) && classifyResource(url, 'script').action === 'keep') continue;

    const id = identifyLibrary(url);
    if (!id) continue;

    const integrity = await fetchSriHash(id.cdnUrl);
    result.set(url, { cdnUrl: id.cdnUrl, integrity });
  }

  return result;
}
