import type { DomPass } from '../../types.js';
import { classifyResource } from '../../utils/allowlist.js';
import { quarantineNode, logChange } from '../../utils/quarantine.js';

/**
 * <img src>: трекинг-пиксели и картинки с чужих хостов. Своя инфраструктура
 * (CloudFront/S3) и доверенные CDN — остаются; чужой хост — карантин;
 * трекинг-пиксель (по имени файла) — удаляем.
 */
export const removeImgPixels: DomPass = ($, ctx) => {
  let imgPixelsRemoved = 0;
  $('img[src]').each((_, el) => {
    const src = $(el).attr('src') ?? '';
    const c = classifyResource(src, 'img');
    if (c.action === 'remove') {
      logChange(ctx, 'IMG_PIXEL_REMOVED', c.reason, src);
      $(el).remove();
      imgPixelsRemoved++;
    } else if (c.action === 'quarantine') {
      quarantineNode($, el, ctx, 'img', `${c.reason} (src=${src})`);
      imgPixelsRemoved++;
    }
  });
  return imgPixelsRemoved ? { imgPixelsRemoved } : {};
};
