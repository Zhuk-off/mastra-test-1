import type { DomPass } from '../../types.js';
import { TRACKER_NOSCRIPT_KEYWORDS } from '../../registry/tracker-keywords.js';

/** <noscript> с трекерным содержимым (GTM/GA/FB noscript-iframe и пр.). */
export const removeNoscriptTrackers: DomPass = ($) => {
  let noscriptsRemoved = 0;
  $('noscript').each((_, el) => {
    const lower = ($(el).html() ?? '').toLowerCase();
    if (TRACKER_NOSCRIPT_KEYWORDS.some((kw) => lower.includes(kw))) {
      $(el).remove();
      noscriptsRemoved++;
    }
  });
  return noscriptsRemoved ? { noscriptsRemoved } : {};
};
