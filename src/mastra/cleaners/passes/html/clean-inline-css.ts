import type { DomPass } from '../../types.js';
import { removeTrackerImports } from '../css/remove-tracker-imports.js';
import { removeTrackerUrls } from '../css/remove-tracker-urls.js';

/**
 * CSS-2: чистит трекер-`url()`/`@import` в INLINE CSS — в `<style>`-блоках и `style=`-атрибутах.
 * Раньше CSS-очистка (`clean-css`) применялась ТОЛЬКО к `.css`-файлам; inline-CSS в HTML вообще
 * не сканировался → `<style>body{background:url(//tracker)}</style>` и
 * `style="background:url(//tracker)"` проходили нетронутыми.
 *
 * Переиспользует те же проходы, что и для файлов (теперь по белому списку — см. CSS-1):
 * `removeTrackerImports` + `removeTrackerUrls`. Видимость — через changelog (как и в .css).
 */
export const cleanInlineCss: DomPass = ($, ctx) => {
  $('style').each((_, el) => {
    const css = $(el).html() ?? '';
    if (!css.trim()) return;
    const imp = removeTrackerImports(css, ctx.relPath, ctx.log);
    const urls = removeTrackerUrls(imp.content, ctx.relPath, ctx.log);
    if (urls.content !== css) $(el).html(urls.content);
  });

  $('[style]').each((_, el) => {
    const style = $(el).attr('style') ?? '';
    if (!style.includes('url')) return; // @import в style-атрибуте не валиден — только url()
    const urls = removeTrackerUrls(style, ctx.relPath, ctx.log);
    if (urls.content !== style) $(el).attr('style', urls.content);
  });

  return {};
};
