import type { HtmlPass } from '../../types.js';

export const removeTrackerJsonLd: HtmlPass = (html, _ctx) => {
  const counts: Partial<Record<'jsonLdRemoved', number>> = {};
  let jsonLdRemoved = 0;

  html = html.replace(
    /<script\b([^>]*?)>([\s\S]*?)<\/script>/gi,
    (whole, attrs: string, body: string) => {
      // Пропускаем те, где есть src= — они уже обработаны
      if (/\bsrc\s*=/i.test(attrs)) return whole;

      // JSON-LD: type="application/ld+json"
      if (/type\s*=\s*['"]application\/ld\+json['"]/i.test(attrs)) {
        // Удалим ld+json только если это явно трекерный (Google Tag Manager, и т.п.)
        if (
          /googletagmanager|google-analytics|gtm-/i.test(body) ||
          /"@type"\s*:\s*"WebSite"\s*,[\s\S]*?"potentialAction"[\s\S]*?"SearchAction"/i.test(body)
        ) {
          jsonLdRemoved++;
          return '';
        }
      }
      return whole;
    },
  );

  if (jsonLdRemoved > 0) counts.jsonLdRemoved = jsonLdRemoved;
  return { html, counts };
};
