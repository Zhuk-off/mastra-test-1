import type { DomPass } from '../../types.js';

/** Удаляем JSON-LD только если он явно трекерный (GTM/GA) или SearchAction-разметка. */
export const removeTrackerJsonLd: DomPass = ($) => {
  let jsonLdRemoved = 0;
  $('script[type="application/ld+json"]').each((_, el) => {
    const body = $(el).text() ?? '';
    if (
      /googletagmanager|google-analytics|gtm-/i.test(body) ||
      /"@type"\s*:\s*"WebSite"\s*,[\s\S]*?"potentialAction"[\s\S]*?"SearchAction"/i.test(body)
    ) {
      $(el).remove();
      jsonLdRemoved++;
    }
  });
  return jsonLdRemoved ? { jsonLdRemoved } : {};
};
