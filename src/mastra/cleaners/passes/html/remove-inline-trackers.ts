import type { HtmlPass } from '../../types.js';
import { inlineLooksLikeTracker } from '../../utils/url.js';

export const removeInlineTrackers: HtmlPass = (html, _ctx) => {
  const counts: Partial<Record<'inlineScriptsRemoved', number>> = {};
  let inlineScriptsRemoved = 0;

  html = html.replace(
    /<script\b([^>]*?)>([\s\S]*?)<\/script>/gi,
    (whole, attrs: string, body: string) => {
      // Пропускаем те, где есть src= — они уже обработаны
      if (/\bsrc\s*=/i.test(attrs)) return whole;

      // JSON-LD — обработан отдельным pass
      if (/type\s*=\s*['"]application\/ld\+json['"]/i.test(attrs)) return whole;

      if (inlineLooksLikeTracker(body)) {
        inlineScriptsRemoved++;
        return '';
      }
      return whole;
    },
  );

  if (inlineScriptsRemoved > 0) counts.inlineScriptsRemoved = inlineScriptsRemoved;
  return { html, counts };
};
