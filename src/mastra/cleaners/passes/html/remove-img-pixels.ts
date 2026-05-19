import type { HtmlPass } from '../../types.js';
import { urlMatchesTracker } from '../../utils/url.js';

export const removeImgPixels: HtmlPass = (html, _ctx) => {
  const counts: Partial<Record<'imgPixelsRemoved', number>> = {};
  let imgPixelsRemoved = 0;

  html = html.replace(
    /<img\b([^>]*?)\bsrc\s*=\s*(['"])([^'"]+)\2([^>]*?)\/?>/gi,
    (whole, _pre, _q, src: string) => {
      if (urlMatchesTracker(src)) {
        imgPixelsRemoved++;
        return '';
      }
      return whole;
    },
  );

  if (imgPixelsRemoved > 0) counts.imgPixelsRemoved = imgPixelsRemoved;
  return { html, counts };
};
