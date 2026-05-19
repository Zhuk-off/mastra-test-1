import type { HtmlPass } from '../../types.js';

export const removeFrames: HtmlPass = (html, _ctx) => {
  const counts: Partial<Record<'framesRemoved', number>> = {};
  let framesRemoved = 0;

  // <frameset ...>...</frameset>
  html = html.replace(/<frameset\b[^>]*>([\s\S]*?)<\/frameset>/gi, () => {
    framesRemoved++;
    return '';
  });

  // <frame ... />
  html = html.replace(/<frame\b[^>]*\/?>/gi, () => {
    framesRemoved++;
    return '';
  });

  // <noframes ...>...</noframes>
  html = html.replace(/<noframes\b[^>]*>([\s\S]*?)<\/noframes>/gi, () => {
    framesRemoved++;
    return '';
  });

  if (framesRemoved > 0) counts.framesRemoved = framesRemoved;
  return { html, counts };
};
