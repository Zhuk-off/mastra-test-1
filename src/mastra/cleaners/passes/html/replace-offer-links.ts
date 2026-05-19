import type { HtmlPass } from '../../types.js';
import { looksLikeOfferUrl } from '../../utils/offer-detector.js';

export const replaceOfferLinks: HtmlPass = (html, ctx) => {
  const counts: Partial<Record<'offerLinksReplaced', number>> = {};
  let offerLinksReplaced = 0;

  html = html.replace(
    /<a\b([^>]*?)>/gi,
    (whole, attrs: string) => {
      const hrefMatch = /\bhref\s*=\s*(['"])([^'"]+)\1/i.exec(attrs);
      if (!hrefMatch) return whole;
      const href = hrefMatch[2]!;
      if (looksLikeOfferUrl(href, ctx.mainHost)) {
        offerLinksReplaced++;
        return whole.replace(hrefMatch[0], `href=${hrefMatch[1]!}{offer}${hrefMatch[1]!}`);
      }
      return whole;
    },
  );

  if (offerLinksReplaced > 0) counts.offerLinksReplaced = offerLinksReplaced;
  return { html, counts };
};
