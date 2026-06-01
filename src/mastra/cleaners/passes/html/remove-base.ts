import type { DomPass } from '../../types.js';

/** Удаляем <base> — он ломает относительные пути после переноса лендинга. */
export const removeBase: DomPass = ($) => {
  const n = $('base').length;
  if (n > 0) $('base').remove();
  return n ? { baseHrefRemoved: n } : {};
};
