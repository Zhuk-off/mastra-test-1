import type { DomPass } from '../../types.js';
import { classifyResource } from '../../utils/allowlist.js';
import { quarantineNode, logChange } from '../../utils/quarantine.js';

/** <object> — удаляем все; <embed src> — внешние по белому списку. */
export const removeObjectEmbed: DomPass = ($, ctx) => {
  let objectEmbedsRemoved = 0;

  $('object').each((_, el) => {
    logChange(ctx, 'OBJECT_REMOVED', '<object> удалён безусловно');
    $(el).remove();
    objectEmbedsRemoved++;
  });

  $('embed[src]').each((_, el) => {
    const src = $(el).attr('src') ?? '';
    const c = classifyResource(src, 'iframe');
    if (c.action !== 'keep') {
      quarantineNode($, el, ctx, 'embed', `${c.reason} (src=${src})`);
      objectEmbedsRemoved++;
    }
  });

  return objectEmbedsRemoved ? { objectEmbedsRemoved } : {};
};
