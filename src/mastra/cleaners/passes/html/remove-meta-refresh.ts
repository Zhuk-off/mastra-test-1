import type { HtmlPass } from '../../types.js';
import { isExternalUrl } from '../../utils/url.js';

export const removeMetaRefresh: HtmlPass = (html, _ctx) => {
  const counts: Partial<Record<'metaRefreshRemoved', number>> = {};
  let metaRefreshRemoved = 0;

  html = html.replace(
    /<meta\b([^>]*?)\/?>/gi,
    (whole, attrs: string) => {
      const httpEquivMatch = /\bhttp-equiv\s*=\s*(['"])refresh\1/i.exec(attrs);
      if (httpEquivMatch) {
        const contentMatch = /\bcontent\s*=\s*(['"])([^'"]+)\1/i.exec(attrs);
        const urlInContent = /url\s*=\s*(.+)/i.exec(contentMatch?.[2] ?? '');
        if (!urlInContent || isExternalUrl(urlInContent[1]!.trim())) {
          metaRefreshRemoved++;
          return '';
        }
      }
      return whole;
    },
  );

  if (metaRefreshRemoved > 0) counts.metaRefreshRemoved = metaRefreshRemoved;
  return { html, counts };
};
