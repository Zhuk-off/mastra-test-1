import type { DomPass } from '../../types.js';
import { parseJs } from '../js-advanced/ast/parse.js';
import { removeInlineExfil } from '../js-advanced/remove-inline-exfil.js';

/** Типы <script>, которые браузер ИСПОЛНЯЕТ как JS. Остальное (ld+json/json/template) — не наша забота. */
const JS_TYPE_RE = /^(?:text|application)\/(?:x-)?(?:java|ecma)script$/;

/**
 * Грубые индикаторы exfil/обфускации для НЕПАРСИМОГО inline-<script> (2D-5): AST-хирургия
 * невозможна, поэтому по подстрокам решаем, подозрителен ли он. Набор совпадает с тем, что
 * ищут AST-детекторы exfil/redirect/obfuscation (fetch/beacon/WS/eval/Function/atob/...).
 */
const INLINE_SUSPICION_RE =
  /\bfetch\s*\(|\bXMLHttpRequest\b|\bsendBeacon\b|\bWebSocket\b|\beval\s*\(|\bnew\s+Function\b|\batob\s*\(|\bunescape\s*\(|\bfromCharCode\b|\bimportScripts\b|\bdocument\s*\.\s*write\b|\bnew\s+Image\b|\.\s*src\s*=|location\s*\.\s*(?:href|replace|assign)\b|\blocation\s*=/i;

/**
 * AST-хирургия inline <script>: вырезает exfil-вызовы (fetch/sendBeacon/WebSocket/
 * new Image().src/document.write(<script src>)) на ВНЕШНИЕ хосты, сохраняя
 * остальной код. Только в advanced-режиме. Содержимое <script> ставится сырым
 * (cheerio не экранирует текст внутри raw-text элементов).
 *
 * 2D-5: непарсимый inline-<script> больше НЕ пропускается молча. Если в теле есть индикаторы
 * exfil/обфускации (намеренно «хитрый» синтаксис в обход AST), скрипт КАРАНТИНИТСЯ целиком —
 * он и в браузере не исполнится корректно, так что удаление не теряет рабочую логику, а оригинал
 * восстановим. Benign непарсимое (макро-шаблоны `{{offer}}`, битая безобидная вёрстка) индикаторов
 * не содержит → не трогаем (без FP и шума). Не-JS типы (json/template) пропускаются заранее.
 */
export const removeInlineExfilPass: DomPass = ($, ctx) => {
  let inlineExfilRemoved = 0;

  $('script:not([src])').each((_, el) => {
    const type = ($(el).attr('type') ?? '').toLowerCase().trim();
    if (type !== '' && type !== 'module' && !JS_TYPE_RE.test(type)) return; // не исполняемый JS

    const body = $(el).text();
    if (!body || !body.trim()) return;

    const ast = parseJs(body, ctx.relPath);
    if (!ast) {
      // 2D-5: подозрительный непарсимый inline-скрипт → карантин (действие, восстановимо), не тишина.
      if (INLINE_SUSPICION_RE.test(body)) {
        const snippet = body.slice(0, 2000);
        (ctx.quarantine ??= []).push({
          kind: 'inline-script-unparsed',
          reason: 'Непарсимый inline <script> с индикаторами exfil/обфускации — изолирован (AST-проверка невозможна)',
          snippet,
          file: ctx.relPath,
        });
        ctx.log.push({
          file: ctx.relPath,
          type: 'INLINE_JS_NOT_ANALYZED',
          description: 'Непарсимый inline <script> с индикаторами exfil/обфускации помещён в карантин — проверить вручную.',
          codeSnippet: snippet.slice(0, 300),
        });
        $(el).remove();
      }
      return; // benign непарсимое (макро-шаблон / битая вёрстка) — оставляем
    }

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
