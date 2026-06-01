import type { DomPass } from '../../types.js';
import { looksLikeOfferUrl } from '../../utils/offer-detector.js';

/** Ссылки на оффер → макрос {offer} (трекер подставит реальный URL). */
export const replaceOfferLinks: DomPass = ($, ctx) => {
  let offerLinksReplaced = 0;
  $('a[href]').each((_, el) => {
    const href = $(el).attr('href') ?? '';
    if (looksLikeOfferUrl(href, ctx.mainHost)) {
      $(el).attr('href', '{offer}');
      offerLinksReplaced++;
    }
  });
  return offerLinksReplaced ? { offerLinksReplaced } : {};
};
