import type { HtmlPass } from '../../types.js';
import { PRECONNECT_RELS } from '../../registry/tracker-hosts.js';
import { urlMatchesTracker } from '../../utils/url.js';

export const removeTrackerLinks: HtmlPass = (html, _ctx) => {
  const counts: Partial<Record<'linksRemoved', number>> = {};
  let linksRemoved = 0;

  html = html.replace(
    /<link\b([^>]*?)\/?>/gi,
    (whole, attrs: string) => {
      const relMatch = /\brel\s*=\s*(['"])([^'"]+)\1/i.exec(attrs);
      const hrefMatch = /\bhref\s*=\s*(['"])([^'"]+)\1/i.exec(attrs);
      if (!relMatch || !hrefMatch) return whole;
      const rel = relMatch[2]?.toLowerCase() ?? '';
      const href = hrefMatch[2] ?? '';
      // Удаляем preconnect/dns-prefetch/preload на трекеров
      if (PRECONNECT_RELS.has(rel) && urlMatchesTracker(href)) {
        linksRemoved++;
        return '';
      }
      // pingback / RSS feed / oembed — оставляем, ничего не делаем
      return whole;
    },
  );

  if (linksRemoved > 0) counts.linksRemoved = linksRemoved;
  return { html, counts };
};
