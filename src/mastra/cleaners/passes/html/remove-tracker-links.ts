import type { DomPass } from '../../types.js';
import { classifyResource, type ResourceKind } from '../../utils/allowlist.js';
import { quarantineNode, logChange } from '../../utils/quarantine.js';

/** Тип ресурса для `<link rel=preload as=...>` → kind для classifyResource. */
function preloadAsToKind(as: string | undefined): ResourceKind {
  switch ((as ?? '').toLowerCase()) {
    case 'style':
      return 'stylesheet';
    case 'image':
      return 'img';
    case 'video':
    case 'audio':
      return 'media';
    case 'font':
      return 'stylesheet'; // шрифты обычно с TRUSTED_LIB_CDNS (gstatic) либо локальные
    default:
      return 'script'; // script/worker/fetch/неизвестное — строгий дефолт (только lib-CDN)
  }
}

/**
 * `<link>` через БЕЛЫЙ СПИСОК (2A-3). Раньше preconnect/preload/prefetch чистились только
 * блок-листом известных трекеров → `<link rel=preload as=script href=//evil/x.js>` (preload
 * СКАЧИВАЕТ ресурс) и `<link rel=preconnect href=//evil>` с неизвестным хостом выживали.
 * Теперь все ресурс-несущие rel идут через `classifyResource`:
 *  - stylesheet → kind stylesheet;
 *  - preload/modulepreload/prefetch → kind по `as` (modulepreload → script);
 *  - preconnect/dns-prefetch → kind preconnect (доверяем по хосту: соединение без пути).
 * Мульти-значный `rel` (`preload stylesheet`) и `modulepreload` теперь покрыты.
 * Прочие rel (icon/canonical/manifest/alternate/…) не трогаем — это не загрузка трекеров.
 */
export const removeTrackerLinks: DomPass = ($, ctx) => {
  let linksRemoved = 0;
  $('link[href]').each((_, el) => {
    const rels = ($(el).attr('rel') ?? '').toLowerCase().split(/\s+/).filter(Boolean);
    const href = $(el).attr('href') ?? '';
    if (rels.length === 0) return;

    let kind: ResourceKind | null = null;
    if (rels.includes('stylesheet')) kind = 'stylesheet';
    else if (rels.includes('preload') || rels.includes('modulepreload') || rels.includes('prefetch')) {
      kind = rels.includes('modulepreload') ? 'script' : preloadAsToKind($(el).attr('as'));
    } else if (rels.includes('preconnect') || rels.includes('dns-prefetch')) {
      kind = 'preconnect';
    }
    if (!kind) return; // не ресурс-несущий rel

    const c = classifyResource(href, kind);
    if (c.action === 'remove') {
      logChange(ctx, 'LINK_REMOVED', c.reason, href);
      $(el).remove();
      linksRemoved++;
    } else if (c.action === 'quarantine') {
      quarantineNode($, el, ctx, `link-${kind}`, `${c.reason} (rel=${rels.join(' ')} href=${href})`);
      linksRemoved++;
    }
  });
  return linksRemoved ? { linksRemoved } : {};
};
