import type { HtmlPass } from '../../types.js';

export const removeBase: HtmlPass = (html, _ctx) => {
  const counts: Partial<Record<'baseHrefRemoved', number>> = {};
  let baseHrefRemoved = 0;

  html = html.replace(
    /<base\b[^>]*\/?>/gi,
    () => {
      baseHrefRemoved++;
      return '';
    },
  );

  if (baseHrefRemoved > 0) counts.baseHrefRemoved = baseHrefRemoved;
  return { html, counts };
};
