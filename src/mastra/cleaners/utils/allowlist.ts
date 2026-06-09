/**
 * Классификатор ресурсов по принципу БЕЛОГО СПИСКА (default-deny).
 *
 * Чистая функция — ядро решения «оставить / удалить / в карантин». Переиспользуется
 * и regex-проходами, и DOM-проходами, и детекторами JS. Не имеет side-effects.
 */
import { extractHostname, hostMatches, urlMatchesTracker } from './url.js';
import {
  TRUSTED_LIB_CDNS,
  OWN_ASSET_HOSTS,
  POLICY,
  MULTITENANT_CDNS,
  TRUSTED_CDN_PACKAGES,
} from '../registry/policy.js';

export type ResourceKind =
  | 'script'
  | 'iframe'
  | 'stylesheet'
  | 'preconnect'
  | 'img'
  | 'media'
  /** Навигационный href (`<a>`/`<area>`). Сейчас используется для классификации
   *  опасных схем (javascript:/vbscript:); проводка прохода по `<a href>` — отдельно. */
  | 'anchor';

export type CleanAction = 'keep' | 'remove' | 'quarantine';

export interface Classification {
  action: CleanAction;
  reason: string;
  /** hostname, если URL абсолютный и распарсился. */
  host?: string;
}

/**
 * Нормализует URL так же, как это делает браузер перед загрузкой ресурса из
 * атрибута: вырезает ВСЕ таб/CR/LF (URL-спецификация удаляет их из любого места)
 * и срезает ведущие/хвостовые управляющие символы и пробелы.
 *
 * Без этого `" https://evil"`, `"ht\ttps://evil"`, `"//ev\nil.com"` обходят
 * `isAbsoluteUrl` и классификацию схемы и уходят в `keep`, хотя браузер их
 * вычистит и загрузит чужой хост. (AL-2 / 2A-1)
 */
export function normalizeUrl(url: string): string {
  return url.replace(/[\t\n\r]/g, '').replace(/^[\x00-\x20]+|[\x00-\x20]+$/g, '');
}

/** Абсолютный (http/https) или протокол-относительный (//host/...) URL. */
export function isAbsoluteUrl(url: string): boolean {
  const u = normalizeUrl(url);
  return /^https?:\/\//i.test(u) || u.startsWith('//');
}

/**
 * Опасные схемы: несут исполняемый код или встраивают произвольный контент.
 * Не матчатся как http(s)/`//`, поэтому без явной обработки утекали в `keep`.
 */
const DANGEROUS_SCHEMES = new Set(['javascript', 'vbscript', 'data', 'blob', 'filesystem']);

/** Схема URL в нижнем регистре (часть до первого `:`), либо null если её нет. */
function schemeOf(url: string): string | null {
  const m = /^([a-zA-Z][a-zA-Z0-9+.-]*):/.exec(url);
  return m ? m[1]!.toLowerCase() : null;
}

/**
 * Имя ОПАСНОЙ схемы URL (`javascript`/`vbscript`/`data`/`blob`/`filesystem`) в нижнем
 * регистре — после браузерной нормализации (trim + вырезание \t\r\n) — либо null,
 * если схема не опасна (http(s), относительный путь, `mailto:`/`tel:`/`#фрагмент` и т.п.).
 *
 * Нужна проходам, которым важно отличить «опасная схема» от «внешний хост»: напр.
 * нейтрализация href у `<a>`/`<area>` (2D-6) касается ТОЛЬКО схем, а внешние http(s)-хосты
 * остаются зоной offer-detector (иначе ломались бы легитимные внешние ссылки).
 */
export function dangerousSchemeOf(url: string): string | null {
  const scheme = schemeOf(normalizeUrl(url));
  return scheme && DANGEROUS_SCHEMES.has(scheme) ? scheme : null;
}

/**
 * Решение по опасной схеме с учётом типа ресурса.
 *
 * Эталон «что легитимно» — CSP владельца (policy.ts): `img-src data:` и
 * `media-src blob:` разрешены, для script/iframe/style таких послаблений нет.
 * Поэтому:
 *  - `data:` в `<img>` и `blob:` в media → keep (частые легитимные кейсы);
 *  - `javascript:`/`vbscript:` в навигационном href → remove (нет ценности);
 *  - всё прочее (исполняемый/встраиваемый чужой контент) → quarantine.
 */
function classifyScheme(scheme: string, kind: ResourceKind): Classification {
  if (scheme === 'data' && kind === 'img') {
    return { action: 'keep', reason: 'data:-изображение (inline, допустимо)' };
  }
  if (scheme === 'blob' && kind === 'media') {
    return { action: 'keep', reason: 'blob:-медиа (CSP media-src blob:)' };
  }
  if (kind === 'anchor' && (scheme === 'javascript' || scheme === 'vbscript')) {
    return { action: 'remove', reason: `опасная схема в href: ${scheme}:` };
  }
  return { action: POLICY.onUncertain, reason: `опасная схема для ${kind}: ${scheme}:` };
}

function hostInSet(host: string, set: Set<string>): boolean {
  for (const t of set) {
    if (hostMatches(host, t)) return true;
  }
  return false;
}

/** Типы, где путь мультитенантного CDN решает доверие (исполняемый/встраиваемый контент). */
const CDN_PATH_CHECK_KINDS = new Set<ResourceKind>(['script', 'stylesheet', 'iframe', 'media']);

/** pathname абсолютного/протокол-относительного URL (без query/fragment), либо ''. */
function cdnPathnameOf(url: string): string {
  try {
    return new URL(url.startsWith('//') ? 'https:' + url : url).pathname;
  } catch {
    return '';
  }
}

/**
 * Доверенный ли ПУТЬ на мультитенантном CDN (AL-3). jsDelivr `/gh/` (любой GitHub-репо)
 * и неизвестные npm-пакеты (jsdelivr `/npm/...`, unpkg `/...`) → НЕ доверенный. Имя пакета
 * сверяется с `TRUSTED_CDN_PACKAGES`. (cdnjs курируем и в `MULTITENANT_CDNS` не входит —
 * сюда не попадает.)
 */
function isWhitelistedCdnPath(host: string, url: string): boolean {
  const path = cdnPathnameOf(url);
  if (host === 'cdn.jsdelivr.net') {
    if (/^\/gh\//i.test(path)) return false; // произвольный GitHub-репозиторий
    const m = /^\/npm\/((?:@[^/]+\/)?[^/@]+)/i.exec(path);
    return m ? TRUSTED_CDN_PACKAGES.has(m[1]!.toLowerCase()) : false;
  }
  if (host === 'unpkg.com') {
    const m = /^\/((?:@[^/]+\/)?[^/@]+)/i.exec(path);
    return m ? TRUSTED_CDN_PACKAGES.has(m[1]!.toLowerCase()) : false;
  }
  return true; // не путе-зависимый CDN — доверяем по хосту
}

/** Доверенные хосты для конкретного типа ресурса. */
function trustedSetsFor(kind: ResourceKind): Set<string>[] {
  // Картинки/медиа могут лежать на нашей инфраструктуре (CloudFront/S3).
  if (kind === 'img' || kind === 'media') return [TRUSTED_LIB_CDNS, OWN_ASSET_HOSTS];
  // Скрипты/стили/фреймы — только библиотечные CDN.
  return [TRUSTED_LIB_CDNS];
}

/**
 * Главное решение по внешнему ресурсу.
 *
 * URL нормализуется как в браузере (trim + вырезание \t\r\n) — иначе пробел/таб
 * обходят классификацию. Опасные схемы (data:/blob:/javascript:/…) решаются ДО
 * проверки isAbsoluteUrl, по типу ресурса. Дальше:
 *  Локальные/относительные ссылки → keep (их разбирают другие проходы).
 *  Внешний доверенный хост → keep.
 *  Внешний известный трекер → remove.
 *  Внешний прочий (вне белого списка) → quarantine — НЕ молчаливое удаление.
 */
export function classifyResource(url: string, kind: ResourceKind): Classification {
  const normalized = normalizeUrl(url);
  if (!normalized) return { action: 'keep', reason: 'пустой URL' };

  const scheme = schemeOf(normalized);
  if (scheme && DANGEROUS_SCHEMES.has(scheme)) {
    return classifyScheme(scheme, kind);
  }

  if (!isAbsoluteUrl(normalized)) return { action: 'keep', reason: 'локальный/относительный URL' };

  const host = extractHostname(normalized);
  if (!host) {
    return { action: POLICY.onUncertain, reason: 'нераспознанный абсолютный URL' };
  }

  if (trustedSetsFor(kind).some((s) => hostInSet(host, s))) {
    // Мультитенантный CDN (jsdelivr/unpkg): доверять по хосту нельзя — тенант задаёт путь.
    // Для исполняемых/встраиваемых типов сверяем путь; /gh/ и неизвестный пакет → карантин.
    if (MULTITENANT_CDNS.has(host) && CDN_PATH_CHECK_KINDS.has(kind) && !isWhitelistedCdnPath(host, normalized)) {
      return { action: POLICY.onUncertain, reason: `мультитенантный CDN, путь вне whitelist: ${host}`, host };
    }
    return { action: 'keep', reason: `доверенный хост: ${host}`, host };
  }

  if (POLICY.autoRemoveKnownTrackers && urlMatchesTracker(normalized)) {
    return { action: 'remove', reason: `известный трекер: ${host}`, host };
  }

  return {
    action: POLICY.onUncertain,
    reason: `внешний хост вне белого списка: ${host}`,
    host,
  };
}
