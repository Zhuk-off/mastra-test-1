import type { DomPass } from '../../types.js';
import { classifyResource } from '../../utils/allowlist.js';
import { quarantineNode, logChange } from '../../utils/quarantine.js';

/**
 * Белый список для <script src>: внешний скрипт остаётся ТОЛЬКО если его хост в
 * доверенном списке (после репина библиотек). Известный трекер — удаляем,
 * прочий внешний — в карантин (не оставляем молча).
 */
export const removeTrackerScripts: DomPass = ($, ctx) => {
  let scriptsRemoved = 0;
  $('script[src]').each((_, el) => {
    const src = $(el).attr('src') ?? '';
    const c = classifyResource(src, 'script');
    if (c.action === 'remove') {
      logChange(ctx, 'SCRIPT_REMOVED', c.reason, src);
      $(el).remove();
      scriptsRemoved++;
    } else if (c.action === 'quarantine') {
      quarantineNode($, el, ctx, 'script', `${c.reason} (src=${src})`);
      scriptsRemoved++;
    }
  });
  return scriptsRemoved ? { scriptsRemoved } : {};
};
