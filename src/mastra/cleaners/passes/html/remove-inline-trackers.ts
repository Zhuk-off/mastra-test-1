import type { DomPass } from '../../types.js';
import { inlineLooksLikeTracker } from '../../utils/url.js';

/** Inline <script> без src, содержащий трекерные ключевые слова (gtag, fbq, ym, ...). */
export const removeInlineTrackers: DomPass = ($) => {
  let inlineScriptsRemoved = 0;
  $('script:not([src])').each((_, el) => {
    const type = ($(el).attr('type') ?? '').toLowerCase();
    if (type === 'application/ld+json') return; // отдельный pass
    const body = $(el).text() ?? '';
    if (inlineLooksLikeTracker(body)) {
      $(el).remove();
      inlineScriptsRemoved++;
    }
  });
  return inlineScriptsRemoved ? { inlineScriptsRemoved } : {};
};
