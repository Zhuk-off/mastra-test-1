import type { HtmlPass } from '../../types.js';
import { TRACKER_META_NAMES } from '../../registry/meta-names.js';

export const removeTrackerMetas: HtmlPass = (html, _ctx) => {
  const counts: Partial<Record<'metasRemoved', number>> = {};
  let metasRemoved = 0;

  html = html.replace(
    /<meta\b([^>]*?)\/?>/gi,
    (whole, attrs: string) => {
      const nameMatch = /\bname\s*=\s*(['"])([^'"]+)\1/i.exec(attrs);
      if (nameMatch) {
        const name = nameMatch[2]?.toLowerCase() ?? '';
        if (TRACKER_META_NAMES.includes(name)) {
          metasRemoved++;
          return '';
        }
      }
      return whole;
    },
  );

  if (metasRemoved > 0) counts.metasRemoved = metasRemoved;
  return { html, counts };
};
