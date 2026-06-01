import type { DomPass } from '../../types.js';
import { parseJs } from '../js-advanced/ast/parse.js';
import { removeInlineExfil } from '../js-advanced/remove-inline-exfil.js';

/**
 * AST-хирургия inline <script>: вырезает exfil-вызовы (fetch/sendBeacon/WebSocket/
 * new Image().src/document.write(<script src>)) на ВНЕШНИЕ хосты, сохраняя
 * остальной код. Только в advanced-режиме. Содержимое <script> ставится сырым
 * (cheerio не экранирует текст внутри raw-text элементов).
 */
export const removeInlineExfilPass: DomPass = ($, ctx) => {
  let inlineExfilRemoved = 0;

  $('script:not([src])').each((_, el) => {
    const type = ($(el).attr('type') ?? '').toLowerCase();
    if (type === 'application/ld+json') return;

    const body = $(el).text();
    if (!body || !body.trim()) return;

    const ast = parseJs(body, ctx.relPath);
    if (!ast) return; // не парсится — не трогаем

    const { code, removed } = removeInlineExfil(
      body,
      { source: body, relPath: ctx.relPath, mainHost: ctx.mainHost },
      ast,
      ctx.log,
    );
    if (removed === 0) return;

    inlineExfilRemoved += removed;
    if (!code.trim()) {
      $(el).remove();
    } else {
      $(el).text(code);
    }
  });

  return inlineExfilRemoved ? { inlineExfilRemoved } : {};
};
