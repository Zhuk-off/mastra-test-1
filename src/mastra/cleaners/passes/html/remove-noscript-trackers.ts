import type { HtmlPass } from '../../types.js';
import { TRACKER_NOSCRIPT_KEYWORDS } from '../../registry/tracker-keywords.js';

export const removeNoscriptTrackers: HtmlPass = (html, _ctx) => {
  const counts: Partial<Record<'noscriptsRemoved', number>> = {};
  let noscriptsRemoved = 0;

  html = html.replace(
    /<noscript\b[^>]*>([\s\S]*?)<\/noscript>/gi,
    (whole, body: string) => {
      const lower = body.toLowerCase();
      if (TRACKER_NOSCRIPT_KEYWORDS.some((kw) => lower.includes(kw))) {
        noscriptsRemoved++;
        return '';
      }
      return whole;
    },
  );

  if (noscriptsRemoved > 0) counts.noscriptsRemoved = noscriptsRemoved;
  return { html, counts };
};
