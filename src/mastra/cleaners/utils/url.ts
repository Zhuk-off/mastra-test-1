import { TRACKER_HOSTS } from '../registry/tracker-hosts.js';
import { TRUSTED_HOSTS } from '../registry/trusted-hosts.js';
import { TRACKER_FILENAME_PATTERNS } from '../registry/tracker-filenames.js';
import { TRACKER_INLINE_KEYWORDS } from '../registry/tracker-keywords.js';

/**
 * Извлекает hostname из АБСОЛЮТНОГО (`scheme://host`) или протокол-относительного
 * (`//host`) URL. Для относительных путей (`js/app.js`, `../a`, `/x`, `#frag`,
 * `mailto:`/`data:` без authority) возвращает null.
 *
 * URL-1: раньше `new URL(raw, 'https://example.com')` резолвил ЛЮБОЙ относительный
 * путь против базы и возвращал `example.com` — footgun: прямой вызыватель (в обход
 * `isAbsoluteUrl`-гварда) принимал относительный путь за «хост example.com».
 */
export function extractHostname(raw: string): string | null {
  const trimmed = raw.trim();
  if (!/^[a-z][a-z0-9+.\-]*:\/\//i.test(trimmed) && !trimmed.startsWith('//')) return null;
  try {
    const u = new URL(trimmed, 'https://example.com');
    return u.hostname.toLowerCase() || null;
  } catch {
    return null;
  }
}

/** host совпадает с t или является его поддоменом. */
export function hostMatches(host: string, t: string): boolean {
  return host === t || host.endsWith('.' + t);
}

export function urlMatchesTracker(url: string): boolean {
  const lowerUrl = url.toLowerCase();

  // 1) Путевые спички (формат 'host.com/path') — substring анализ.
  for (const t of TRACKER_HOSTS) {
    if (t.includes('/') && lowerUrl.includes(t)) return true;
  }

  // 2) Абсолютные / protocol-relative URL — по hostname.
  if (/^https?:\/\//i.test(url) || url.startsWith('//')) {
    const host = extractHostname(url);
    if (host) {
      for (const t of TRACKER_HOSTS) {
        if (!t.includes('/') && hostMatches(host, t)) return true;
      }
    }
  }

  // 3) Относительные URL с _external/<host>/ — извлекаем host из пути.
  const m = /(?:^|\/)_external\/([^/?#]+)/i.exec(url);
  if (m) {
    const host = m[1]!.toLowerCase();
    for (const t of TRACKER_HOSTS) {
      if (!t.includes('/') && hostMatches(host, t)) return true;
    }
  }

  // 4) Относительные URL — проверка имени файла на трекерные паттерны.
  const basename = lowerUrl.split('/').pop()?.split('?')[0] ?? '';
  if (TRACKER_FILENAME_PATTERNS.some((p) => basename.includes(p))) return true;

  return false;
}

/** Возвращает true если URL абсолютный и хост не в TRUSTED_HOSTS. */
export function isExternalUrl(url: string): boolean {
  if (!url) return false;
  if (!/^https?:\/\//i.test(url) && !url.startsWith('//')) return false;
  const host = extractHostname(url);
  if (!host) return false;
  return !Array.from(TRUSTED_HOSTS).some((t) => hostMatches(host, t));
}

export function inlineLooksLikeTracker(scriptBody: string): boolean {
  // Пропускаем JSON-LD как отдельный кейс
  return TRACKER_INLINE_KEYWORDS.some((kw) => scriptBody.includes(kw));
}
