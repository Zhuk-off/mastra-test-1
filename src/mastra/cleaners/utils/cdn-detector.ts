import { createHash } from 'node:crypto';
import { CDN_LIBRARIES, type CdnLibraryDef } from '../registry/cdn-libraries.js';
import { TRUSTED_CDN_PACKAGES } from '../registry/policy.js';
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
 * Универсальный репин по СТРУКТУРЕ пути CDN (не по имени библиотеки).
 * ВАЖНО (безопасность): сопоставляем ТОЛЬКО pathname (не query/fragment) и якорим к началу
 * пути — иначе structure в query-параметре давала бы ложный репин. Паттерн «host/<name>@<ver>»
 * (unpkg-стиль) НАМЕРЕННО убран: он срабатывал на любом хосте и допускал dependency-confusion
 * (подмену внутреннего пакета публичным). Существование URL проверяется отдельно (fetch).
 */
const CDN_STRUCTURES: {
  name: string;
  re: RegExp;
  build: (m: RegExpMatchArray) => string;
  /** Доп. условие на матч (напр. имя пакета в whitelist). */
  guard?: (m: RegExpMatchArray) => boolean;
}[] = [
  {
    name: 'cdnjs', // ^/ajax/libs/<name>/<ver>/<rest> — cdnjs курируем, репин по структуре ок
    re: new RegExp(String.raw`^/ajax/libs/([^/]+)/${VER}/(.+)$`, 'i'),
    build: (m) => `https://cdnjs.cloudflare.com/ajax/libs/${m[1]}/${m[2]}/${m[3]}`,
  },
  {
    name: 'jsdelivr-npm', // ^/npm/<name>@<ver>/<rest> — ТОЛЬКО известные пакеты (CDN-1)
    re: new RegExp(String.raw`^/npm/((?:@[^/]+/)?[^/@]+)@${VER}/(.+)$`, 'i'),
    build: (m) => `https://cdn.jsdelivr.net/npm/${m[1]}@${m[2]}/${m[3]}`,
    guard: (m) => TRUSTED_CDN_PACKAGES.has(m[1]!.toLowerCase()),
  },
  // CDN-1: структура `jsdelivr-gh` (^/gh/<user>/<repo>) УБРАНА намеренно — она отмывала
  // ЛЮБОЙ GitHub-репозиторий атакующего в «доверенный» cdn.jsdelivr.net. Теперь такой URL
  // не репинится → уходит в карантин через allowlist (AL-3).
];

/** Возвращает pathname без query/fragment (для абсолютных, протокол-относительных и относительных URL). */
function urlPathname(url: string): string {
  try {
    if (/^https?:\/\//i.test(url)) return new URL(url).pathname;
    if (url.startsWith('//')) return new URL('https:' + url).pathname;
    const path = (url.split(/[?#]/)[0] ?? '');
    return path.startsWith('/') ? path : '/' + path;
  } catch {
    return '';
  }
}

export function genericCdnRepin(url: string): string | null {
  const pathname = urlPathname(url);
  if (!pathname) return null;
  for (const s of CDN_STRUCTURES) {
    const m = s.re.exec(pathname);
    if (m && (!s.guard || s.guard(m))) return s.build(m);
  }
  return null;
}

// ── LRU-кэш результатов проверки официальных файлов (защита от роста памяти) ──
const SRI_CACHE_LIMIT = 1000;
const MAX_SRI_BYTES = 5 * 1024 * 1024; // 5 МБ
const sriCache = new Map<string, { ok: boolean; sri: string }>();

function cacheGet(key: string): { ok: boolean; sri: string } | undefined {
  const v = sriCache.get(key);
  if (v) {
    sriCache.delete(key); // переставляем в конец (most-recently-used)
    sriCache.set(key, v);
  }
  return v;
}
function cacheSet(key: string, value: { ok: boolean; sri: string }): { ok: boolean; sri: string } {
  if (sriCache.has(key)) sriCache.delete(key);
  else if (sriCache.size >= SRI_CACHE_LIMIT) {
    const oldest = sriCache.keys().next().value;
    if (oldest !== undefined) sriCache.delete(oldest);
  }
  sriCache.set(key, value);
  return value;
}

/**
 * Best-effort проверка официального файла: стримовое хеширование (sha384) с лимитом 5 МБ
 * и таймаутом 4 c. Возвращает ok=false при недоступности/404/превышении лимита/ошибке.
 * Тело НЕ загружается целиком в память.
 */
async function fetchOfficial(cdnUrl: string): Promise<{ ok: boolean; sri: string }> {
  const cached = cacheGet(cdnUrl);
  if (cached) return cached;

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 4000);
  try {
    const res = await fetch(cdnUrl, { signal: ctrl.signal, redirect: 'follow' });
    if (!res.ok || !res.body) return cacheSet(cdnUrl, { ok: false, sri: '' });

    const hash = createHash('sha384');
    let total = 0;
    const reader = (res.body as ReadableStream<Uint8Array>).getReader();
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;
      total += value.byteLength;
      if (total > MAX_SRI_BYTES) {
        await reader.cancel().catch(() => {});
        return cacheSet(cdnUrl, { ok: false, sri: '' });
      }
      hash.update(value);
    }
    return cacheSet(cdnUrl, { ok: true, sri: `sha384-${hash.digest('base64')}` });
  } catch {
    return cacheSet(cdnUrl, { ok: false, sri: '' });
  } finally {
    clearTimeout(timer);
  }
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
 * Карта замен «исходный URL → официальный CDN + SRI». Репин ТОЛЬКО если официальный
 * URL реально существует (fetch ok) — иначе не добавляем (пустой integrity недопустим;
 * битую ссылку не подсовываем; allowlist отправит ресурс в карантин). URL, уже на
 * доверенном CDN, не трогаем.
 */
export async function buildCdnReplacements(
  _siteDir: string,
  _htmlFilePath: string,
  html: string,
): Promise<Map<string, CdnReplacement>> {
  const result = new Map<string, CdnReplacement>();

  for (const url of collectResourceUrls(html)) {
    if (isAbsoluteUrl(url) && classifyResource(url, 'script').action === 'keep') continue;

    // 1) Известная библиотека — канонический URL, но репин только если URL доступен.
    const hard = identifyLibrary(url);
    if (hard) {
      const { ok, sri } = await fetchOfficial(hard.cdnUrl);
      if (ok) result.set(url, { cdnUrl: hard.cdnUrl, integrity: sri });
      continue;
    }

    // 2) Структурный репin — только если реконструированный URL существует.
    const generic = genericCdnRepin(url);
    if (generic) {
      const { ok, sri } = await fetchOfficial(generic);
      if (ok) result.set(url, { cdnUrl: generic, integrity: sri });
    }
  }

  return result;
}
