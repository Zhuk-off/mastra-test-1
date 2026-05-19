import { basename, resolve } from 'node:path';
import { TRUSTED_HOSTS } from '../registry/trusted-hosts.js';
import { OFFER_URL_PATTERNS, NON_OFFER_PATH_PATTERNS } from '../registry/offer-patterns.js';
import { extractHostname, hostMatches } from './url.js';

/** Извлекает основной домен из имени директории сайта (downloads/<hostname>/). */
export function extractMainHostFromDir(siteDir: string): string {
  return basename(resolve(siteDir));
}

export function looksLikeOfferUrl(url: string, mainHost: string): boolean {
  if (!/^https?:\/\//i.test(url) && !url.startsWith('//')) return false;

  // Декодируем HTML-entities (&amp; → &) которые встречаются в исходном HTML
  const decoded = url.replace(/&amp;/gi, '&');

  const host = extractHostname(decoded);
  if (!host) return false;

  // Если домен отличается от основного — это оффер (внешний)
  if (!hostMatches(host, mainHost)) {
    // Но не трогаем trusted-хосты (cdn, google, соцсети и т.д.)
    if (Array.from(TRUSTED_HOSTS).some((t) => hostMatches(host, t))) return false;
    return true;
  }

  // Тот же домен — проверяем путь на информационные страницы
  let pathname: string;
  try {
    pathname = new URL(decoded).pathname;
  } catch {
    return false;
  }

  if (NON_OFFER_PATH_PATTERNS.some((p) => p.test(pathname))) return false;

  // Проверяем на офферные паттерны в query string и path
  return OFFER_URL_PATTERNS.some((p) => p.test(decoded));
}
