import type { HtmlPass } from '../../types.js';
import { urlMatchesTracker } from '../../utils/url.js';

export const removeTrackerScripts: HtmlPass = (html, _ctx) => {
  const counts: Partial<Record<'scriptsRemoved', number>> = {};
  let scriptsRemoved = 0;

  // <script src="..."> — внешние трекеры
  html = html.replace(
    /<script\b([^>]*?)\bsrc\s*=\s*(['"])([^'"]+)\2([^>]*?)>([\s\S]*?)<\/script>/gi,
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
