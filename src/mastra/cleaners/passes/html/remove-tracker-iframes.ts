import type { DomPass } from '../../types.js';
import { classifyResource } from '../../utils/allowlist.js';
import { quarantineNode, logChange } from '../../utils/quarantine.js';

/** Белый список для <iframe src>. Считаем в scriptsRemoved (как в оригинале). */
export const removeTrackerIframes: DomPass = ($, ctx) => {
  let scriptsRemoved = 0;
  $('iframe[src]').each((_, el) => {
    const src = $(el).attr('src') ?? '';
    const c = classifyResource(src, 'iframe');
    if (c.action === 'remove') {
      logChange(ctx, 'IFRAME_REMOVED', c.reason, src);
      $(el).remove();
      scriptsRemoved++;
    } else if (c.action === 'quarantine') {
      quarantineNode($, el, ctx, 'iframe', `${c.reason} (src=${src})`);
      scriptsRemoved++;
    }
  });
  return scriptsRemoved ? { scriptsRemoved } : {};
};
