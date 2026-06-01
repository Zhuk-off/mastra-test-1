import type { DomPass } from '../../types.js';

/** Удаляем frameset/frame/noframes. */
export const removeFrames: DomPass = ($) => {
  let framesRemoved = 0;
  for (const tag of ['frameset', 'frame', 'noframes']) {
    const sel = $(tag);
    framesRemoved += sel.length;
    sel.remove();
  }
  return framesRemoved ? { framesRemoved } : {};
};
