import type { DomPass } from '../../types.js';
import { isExternalUrl } from '../../utils/url.js';

/** <meta http-equiv="refresh"> с внешним (или пустым) URL — редирект, удаляем. */
export const removeMetaRefresh: DomPass = ($) => {
  let metaRefreshRemoved = 0;
  $('meta[http-equiv]').each((_, el) => {
    const he = ($(el).attr('http-equiv') ?? '').toLowerCase().trim();
    if (he !== 'refresh') return;
    const content = $(el).attr('content') ?? '';
    const m = /url\s*=\s*(.+)/i.exec(content);
    if (!m || isExternalUrl(m[1]!.trim())) {
      $(el).remove();
      metaRefreshRemoved++;
    }
  });
  return metaRefreshRemoved ? { metaRefreshRemoved } : {};
};
