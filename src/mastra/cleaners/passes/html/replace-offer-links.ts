import type { DomPass } from '../../types.js';

/** Схемы, которые НЕ уводят трафик с лендинга — оставляем (контакт). */
const KEEP_SCHEMES = new Set(['mailto', 'tel']);

/**
 * Агрессивная offer-политика (решение владельца): на арбитражном лендинге ВЕСЬ клик ведёт только
 * на оффер. Любой `<a>`/`<area>` href → `{offer}`, КРОМЕ:
 *  - якорей `#...` (прокрутка к форме/квизу на одностраничнике — это не навигация);
 *  - `mailto:`/`tel:` (контакт, не увод трафика);
 *  - href с макросом `{...}` — их разбирает `detect-macros` (наш макрос оставит, чужой pure-macro → {offer});
 *  - пустых. Опасные схемы (`javascript:`/`data:`) уже сняты `stripDangerousHrefs` (2D-6) до этого прохода.
 *
 * Почему агрессивно: чужие футер-ссылки (privacy/соцсети/партнёрские) чаще всего = спрятанное
 * воровство трафика прежнего владельца; уводить клик куда-либо, кроме оффера, не нужно. Это закрывает
 * OFFER-1/2/3. Оригинальные URL пишем в карту макросов (отчёт, раздел «Ссылки → {offer}») — чтобы
 * редкие легитимные ссылки можно было вернуть вручную.
 */
export const replaceOfferLinks: DomPass = ($, ctx) => {
  let offerLinksReplaced = 0;
  $('a[href], area[href]').each((_, el) => {
    const href = ($(el).attr('href') ?? '').trim();
    if (!href || href.startsWith('#') || href.includes('{')) return;
    const scheme = (/^([a-z][a-z0-9+.\-]*):/i.exec(href)?.[1] ?? '').toLowerCase();
    if (KEEP_SCHEMES.has(scheme)) return;

    const tag = ((el as { name?: string }).name ?? 'a').toLowerCase();
    (ctx.macros ??= []).push({
      kind: 'link',
      token: href,
      file: ctx.relPath,
      element: tag,
      attr: 'href',
      action: 'заменено на {offer} (вся навигация → оффер)',
    });
    $(el).attr('href', '{offer}');
    offerLinksReplaced++;
  });
  return offerLinksReplaced ? { offerLinksReplaced } : {};
};
