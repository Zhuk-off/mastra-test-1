import type { HtmlPass } from '../../types.js';
import { urlMatchesTracker } from '../../utils/url.js';

/**
 * Удаляет <iframe src="..."> с трекерных доменов (например, GTM noscript-iframe).
 *
 * ВАЖНО: пишет в счётчик `scriptsRemoved` (так было в оригинале), и должен
 * запускаться ПОСЛЕ removeNoscriptTrackers — иначе noscript-обёртка вокруг
 * GTM-iframe останется пустой висячей в DOM.
 */
export const removeTrackerIframes: HtmlPass = (html, _ctx) => {
  const counts: Partial<Record<'scriptsRemoved', number>> = {};
  let scriptsRemoved = 0;

  html = html.replace(
    /<iframe\b([^>]*?)\bsrc\s*=\s*(['"])([^'"]+)\2([^>]*?)>([\s\S]*?)<\/iframe>/gi,
    (whole, _pre, _q, src: string) => {
      if (urlMatchesTracker(src)) {
        scriptsRemoved++;
        return '';
      }
      return whole;
    },
  );

  if (scriptsRemoved > 0) counts.scriptsRemoved = scriptsRemoved;
  return { html, counts };
};
