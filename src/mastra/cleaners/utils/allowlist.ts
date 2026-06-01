/**
 * Классификатор ресурсов по принципу БЕЛОГО СПИСКА (default-deny).
 *
 * Чистая функция — ядро решения «оставить / удалить / в карантин». Переиспользуется
 * и regex-проходами, и DOM-проходами, и детекторами JS. Не имеет side-effects.
 */
import { extractHostname, hostMatches, urlMatchesTracker } from './url.js';
import { TRUSTED_LIB_CDNS, OWN_ASSET_HOSTS, POLICY } from '../registry/policy.js';

export type ResourceKind =
  | 'script'
  | 'iframe'
  | 'stylesheet'
  | 'preconnect'
  | 'img'
  | 'media';

export type CleanAction = 'keep' | 'remove' | 'quarantine';

export interface Classification {
  action: CleanAction;
  reason: string;
  /** hostname, если URL абсолютный и распарсился. */
  host?: string;
}

/** Абсолютный (http/https) или протокол-относительный (//host/...) URL. */
export function isAbsoluteUrl(url: string): boolean {
  return /^https?:\/\//i.test(url) || url.startsWith('//');
}

function hostInSet(host: string, set: Set<string>): boolean {
  for (const t of set) {
    if (hostMatches(host, t)) return true;
  }
  return false;
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
 * Локальные/относительные ссылки → keep (их разбирают другие проходы: репин/JS-анализ).
 * Внешний доверенный хост → keep.
 * Внешний известный трекер → remove.
 * Внешний прочий (вне белого списка) → quarantine (по умолчанию) — НЕ молчаливое удаление.
 */
export function classifyResource(url: string, kind: ResourceKind): Classification {
  if (!url || !url.trim()) return { action: 'keep', reason: 'пустой URL' };
  if (!isAbsoluteUrl(url)) return { action: 'keep', reason: 'локальный/относительный URL' };

  const host = extractHostname(url);
  if (!host) {
    return { action: POLICY.onUncertain, reason: 'нераспознанный абсолютный URL' };
  }

  if (trustedSetsFor(kind).some((s) => hostInSet(host, s))) {
    return { action: 'keep', reason: `доверенный хост: ${host}`, host };
  }

  if (POLICY.autoRemoveKnownTrackers && urlMatchesTracker(url)) {
    return { action: 'remove', reason: `известный трекер: ${host}`, host };
  }

  return {
    action: POLICY.onUncertain,
    reason: `внешний хост вне белого списка: ${host}`,
    host,
  };
}
