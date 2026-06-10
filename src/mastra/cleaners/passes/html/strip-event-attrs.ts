import type { DomPass } from '../../types.js';
import type { Element } from 'domhandler';
import type { Program } from 'acorn';
import { TRACKER_INLINE_KEYWORDS } from '../../registry/tracker-keywords.js';
import { parseJs } from '../js-advanced/ast/parse.js';
import { detectExfilCalls } from '../js-advanced/detectors/detect-exfil-calls.js';
import { detectRedirect } from '../js-advanced/detectors/detect-redirect.js';

/**
 * Значение `on*`-обработчика — это ТЕЛО функции-обработчика. Парсим его как тело функции
 * (`function __h(event){…}`), чтобы `return …`/`this`/`event` в обработчике были валидны, и
 * гоним через те же AST-детекторы exfil/redirect, что и inline-`<script>` (DET-1/DET-2 умеют
 * обфускацию и протокол-относительные `//host`). Ловит то, что блок-лист по литералу пропускает:
 * `location='//evil'`, `location=atob('aHR0…')`, `fetch(atob(...))`, `new Image().src='\x2f\x2fevil'`.
 *
 * Возвращает true, только если в обработчике есть exfil/редирект на ВНЕШНИЙ хост (same-host
 * навигация и обычный код → false: `isExternalUrl` не считает свой хост внешним). Непарсимое
 * значение → false (не трогаем; блок-лист по литералу остаётся первой линией, ср. ANA-1
 * «непарсимое не удаляем»). Чистая функция, без I/O. 2D-2.
 */
function handlerHasExternalExfil(value: string, mainHost: string, relPath: string): boolean {
  const wrapped = `function __h(event){\n${value}\n}`;
  const ast: Program | null = parseJs(wrapped, relPath);
  if (!ast) return false;
  const detCtx = { source: wrapped, relPath, mainHost };
  try {
    // detectExfilCalls: fetch/WebSocket/sendBeacon/трекер/document.write/.src-пиксель;
    // detectRedirect: location=…/.assign()/.replace(). Оба обфускация-aware (extractStringish
    // + obfuscatedDecoderIn + isExternalUrl с поддержкой `//`).
    return detectExfilCalls(ast, detCtx).length > 0 || detectRedirect(ast, detCtx).length > 0;
  } catch {
    return false; // непредвиденный узел не валит весь HTML-проход (robustness)
  }
}

/**
 * Снимаем ЛЮБОЙ `on*`-обработчик (по префиксу `on…` — 2D-3: фиксированный список всегда неполон,
 * а лендинги арбитража мобильные → нужны и `ontouch*`/`onpointer*`/`onwheel`/clipboard/history/media),
 * если значение либо (а) содержит литеральный внешний URL / трекер-ключевое слово, либо (б) по
 * AST-анализу делает exfil/редирект на чужой хост — в т.ч. обфусцированный/протокол-относительный
 * (2D-2). Простые обработчики квиза (`onclick="next()"`, `ontouchstart="nextStep()"`,
 * `onsubmit="return validate()"`) остаются: в них нет внешнего вызова. FP исключён: не-обработчиков
 * с именем `on…` в HTML нет.
 */
export const stripEventAttrs: DomPass = ($, ctx) => {
  let eventAttrsRemoved = 0;
  $('*').each((_, node) => {
    const el = node as Element;
    const attribs = el.attribs;
    if (!attribs) return;
    for (const name of Object.keys(attribs)) {
      if (!/^on[a-z]/i.test(name)) continue;
      const val = attribs[name] ?? '';
      const literalHit =
        /https?:\/\//i.test(val) || TRACKER_INLINE_KEYWORDS.some((kw) => val.includes(kw));
      if (literalHit || handlerHasExternalExfil(val, ctx.mainHost, ctx.relPath)) {
        $(el).removeAttr(name);
        eventAttrsRemoved++;
      }
    }
  });
  return eventAttrsRemoved ? { eventAttrsRemoved } : {};
};
