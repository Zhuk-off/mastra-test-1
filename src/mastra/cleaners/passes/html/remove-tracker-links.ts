import type { DomPass } from '../../types.js';
import { PRECONNECT_RELS } from '../../registry/tracker-hosts.js';
import { urlMatchesTracker } from '../../utils/url.js';
import { classifyResource, isAbsoluteUrl } from '../../utils/allowlist.js';
import { quarantineNode, logChange } from '../../utils/quarantine.js';

/**
 * <link>: preconnect/dns-prefetch/preload на трекеры — удаляем; внешний
 * stylesheet вне белого списка — карантин (известный трекер — удаляем).
 */
export const removeTrackerLinks: DomPass = ($, ctx) => {
  let linksRemoved = 0;
  $('link[href]').each((_, el) => {
    const rel = ($(el).attr('rel') ?? '').toLowerCase().trim();
    const href = $(el).attr('href') ?? '';

    if (PRECONNECT_RELS.has(rel)) {
      if (urlMatchesTracker(href)) {
        logChange(ctx, 'LINK_REMOVED', `preconnect/prefetch трекер`, href);
        $(el).remove();
        linksRemoved++;
      }
      return;
    }

    if (rel === 'stylesheet' && isAbsoluteUrl(href)) {
      const c = classifyResource(href, 'stylesheet');
      if (c.action === 'remove') {
        logChange(ctx, 'LINK_REMOVED', c.reason, href);
        $(el).remove();
        linksRemoved++;
      } else if (c.action === 'quarantine') {
        quarantineNode($, el, ctx, 'link-stylesheet', `${c.reason} (href=${href})`);
        linksRemoved++;
      }
    }
  });
  return linksRemoved ? { linksRemoved } : {};
};
