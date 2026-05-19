import type { HtmlPass } from '../../types.js';
import { isExternalUrl } from '../../utils/url.js';

export const removeObjectEmbed: HtmlPass = (html, _ctx) => {
  const counts: Partial<Record<'objectEmbedsRemoved', number>> = {};
  let objectEmbedsRemoved = 0;

  // <object data="..."> с внешними ресурсами
  html = html.replace(
    /<object\b([^>]*?)>([\s\S]*?)<\/object>/gi,
    (whole, attrs: string) => {
      const dataMatch = /\bdata\s*=\s*(['"])([^'"]+)\1/i.exec(attrs);
      if (dataMatch && isExternalUrl(dataMatch[2]!)) {
        objectEmbedsRemoved++;
        return '';
      }
      return whole;
    },
  );

  // <embed src="..."> с внешними ресурсами
  html = html.replace(
    /<embed\b([^>]*?)\/?>/gi,
    (whole, attrs: string) => {
      const srcMatch = /\bsrc\s*=\s*(['"])([^'"]+)\1/i.exec(attrs);
      if (srcMatch && isExternalUrl(srcMatch[2]!)) {
        objectEmbedsRemoved++;
        return '';
      }
      return whole;
    },
  );

  if (objectEmbedsRemoved > 0) counts.objectEmbedsRemoved = objectEmbedsRemoved;
  return { html, counts };
};
