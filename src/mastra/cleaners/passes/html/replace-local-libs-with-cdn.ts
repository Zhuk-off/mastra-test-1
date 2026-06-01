import type { DomPass } from '../../types.js';
import type { CdnReplacement } from '../../types.js';
import { logChange } from '../../utils/quarantine.js';

/**
 * Репин библиотек на официальный CDN + SRI. Карты замен (по исходному URL)
 * приходят в ctx из cdn-detector (локальные и абсолютные URL). Работает ПЕРЕД
 * allowlist-проходами: фиксируемая либа становится trusted-CDN и проходит белый список.
 */
export const replaceLocalLibsWithCdn: DomPass = ($, ctx) => {
  const reps = new Map<string, CdnReplacement>([
    ...(ctx.cdnReplacements ?? []),
    ...(ctx.unversionedLibReplacements ?? []),
  ]);
  if (reps.size === 0) return {};

  let localLibsReplaced = 0;

  const pin = (el: any, attr: 'src' | 'href') => {
    const url = $(el).attr(attr) ?? '';
    const rep = reps.get(url);
    if (!rep) return;
    $(el).attr(attr, rep.cdnUrl);
    // SRI ставим только если удалось посчитать хеш официального файла (онлайн).
    if (rep.integrity) {
      $(el).attr('integrity', rep.integrity).attr('crossorigin', 'anonymous');
    }
    logChange(ctx, 'LIB_REPINNED', `${url} → ${rep.cdnUrl}`, rep.integrity || '(без SRI: офлайн)');
    localLibsReplaced++;
  };

  $('script[src]').each((_, el) => pin(el, 'src'));
  $('link[href]').each((_, el) => pin(el, 'href'));

  return localLibsReplaced ? { localLibsReplaced } : {};
};
