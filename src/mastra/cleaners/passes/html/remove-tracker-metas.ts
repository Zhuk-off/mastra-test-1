import type { DomPass } from '../../types.js';
import { TRACKER_META_NAMES } from '../../registry/meta-names.js';

const LOWER_NAMES = TRACKER_META_NAMES.map((n) => n.toLowerCase());

/** <meta name="...verification"> поисковиков/соцсетей — не нужны (сайты не индексируются). */
export const removeTrackerMetas: DomPass = ($) => {
  let metasRemoved = 0;
  $('meta[name]').each((_, el) => {
    const name = ($(el).attr('name') ?? '').toLowerCase();
    if (LOWER_NAMES.includes(name)) {
      $(el).remove();
      metasRemoved++;
    }
  });
  return metasRemoved ? { metasRemoved } : {};
};
