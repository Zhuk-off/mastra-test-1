import { createHash } from 'node:crypto';
import { CDN_LIBRARIES, type CdnLibraryDef } from '../registry/cdn-libraries.js';
import type { CdnReplacement } from '../types.js';
import { classifyResource, isAbsoluteUrl } from './allowlist.js';

export interface IdentifiedLib {
  lib: CdnLibraryDef;
  version: string;
  cdnUrl: string;
}

/** Распознаёт библиотеку (ядро) по URL — по списку известных имён. */
export function identifyLibrary(url: string): IdentifiedLib | null {
  for (const lib of CDN_LIBRARIES) {
    const version = lib.identify(url);
    if (version) {
      return { lib, version, cdnUrl: lib.getCdnUrl(version) };
    }
  }
  return null;
}

const VER = String.raw`(\d+\.\d+(?:\.\d+)?(?:[-+.][0-9A-Za-z.]+)?)`;

/**
 * Универсальный репин по СТРУКТУРЕ URL CDN (не по имени библиотеки).
 * Фейковые CDN обычно копируют путь настоящего — реконструируем официальный URL
 * на НАСТОЯЩЕМ хосте для ЛЮБОГО имени, даже незнакомого.
 * Существование URL проверяется отдельно (fetch) — гадание не репиним.
 */
const CDN_STRUCTURES: { name: string; re: RegExp; build: (m: RegExpMatchArray) => string }[] = [
  {
    name: 'cdnjs', // /ajax/libs/<name>/<ver>/<rest>
    re: new RegExp(String.raw`/ajax/libs/([^/]+)/${VER}/(.+?)(?:[?#]|$)`, 'i'),
    build: (m) => `https://cdnjs.cloudflare.com/ajax/libs/${m[1]}/${m[2]}/${m[3]}`,
  },
  {
    name: 'jsdelivr-npm', // /npm/<name>@<ver>/<rest>
    re: new RegExp(String.raw`/npm/((?:@[^/]+/)?[^/@]+)@${VER}/(.+?)(?:[?#]|$)`, 'i'),
    build: (m) => `https://cdn.jsdelivr.net/npm/${m[1]}@${m[2]}/${m[3]}`,
  },
  {
    name: 'jsdelivr-gh', // /gh/<user>/<repo>@<ver>/<rest>
    re: new RegExp(String.raw`/gh/([^/]+)/([^/@]+)@${VER}/(.+?)(?:[?#]|$)`, 'i'),
    build: (m) => `https://cdn.jsdelivr.net/gh/${m[1]}/${m[2]}@${m[3]}/${m[4]}`,
  },
  {
    name: 'unpkg', // <host>/<name>@<ver>/<rest> (только абсолютные)
    re: new RegExp(String.raw`^https?://[^/]+/((?:@[^/]+/)?[^/@]+)@${VER}/(.+?)(?:[?#]|$)`, 'i'),
    build: (m) => `https://unpkg.com/${m[1]}@${m[2]}/${m[3]}`,
  },
];

export function genericCdnRepin(url: string): string | null {
  for (const s of CDN_STRUCTURES) {
    const m = s.re.exec(url);
    if (m) return s.build(m);
  }
  return null;
}

// Кэш результатов проверки официальных файлов (по URL).
const sriCache = new Map<string, { ok: boolean; sri: string }>();

/**
 * Best-effort: качает официальный файл, считает sha384 (для integrity) и
 * сообщает, существует ли он (ok). Хешируем ОФИЦИАЛЬНЫЙ файл, не локальный/фейковый.
 */
async function fetchOfficial(cdnUrl: string): Promise<{ ok: boolean; sri: string }> {
  const cached = sriCache.get(cdnUrl);
  if (cached) return cached;
  let out = { ok: false, sri: '' };
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 4000);
    const res = await fetch(cdnUrl, { signal: ctrl.signal, redirect: 'follow' });
    clearTimeout(timer);
    if (res.ok) {
      const buf = Buffer.from(await res.arrayBuffer());
      out = { ok: true, sri: `sha384-${createHash('sha384').update(buf).digest('base64')}` };
    }
  } catch {
    out = { ok: false, sri: '' };
  }
  sriCache.set(cdnUrl, out);
  return out;
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
 * Карта замен «исходный URL → официальный CDN + SRI».
 * 1) известная библиотека (по имени) → канонический CDN, репин всегда (SRI best-effort);
 * 2) иначе — структурный репин (cdnjs/jsdelivr/unpkg), НО только если официальный URL реально
 *    существует (иначе оставляем allowlist'у → карантин, чтобы не подсунуть битую ссылку);
 * URL уже на доверенном CDN — не трогаем.
 */
export async function buildCdnReplacements(
  _siteDir: string,
  _htmlFilePath: string,
  html: string,
): Promise<Map<string, CdnReplacement>> {
  const result = new Map<string, CdnReplacement>();

  for (const url of collectResourceUrls(html)) {
    if (isAbsoluteUrl(url) && classifyResource(url, 'script').action === 'keep') continue;

    // 1) Известная библиотека — канонический URL (существование гарантируем).
    const hard = identifyLibrary(url);
    if (hard) {
      const { sri } = await fetchOfficial(hard.cdnUrl);
      result.set(url, { cdnUrl: hard.cdnUrl, integrity: sri });
      continue;
    }

    // 2) Структурный репин — только если реконструированный URL существует.
    const generic = genericCdnRepin(url);
    if (generic) {
      const { ok, sri } = await fetchOfficial(generic);
      if (ok) result.set(url, { cdnUrl: generic, integrity: sri });
      // если не существует — пропускаем: allowlist отправит в карантин.
    }
  }

  return result;
}
