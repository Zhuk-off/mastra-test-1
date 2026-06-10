import type { DomPass } from '../../types.js';
import type { Element } from 'domhandler';
import { TRACKER_INLINE_KEYWORDS } from '../../registry/tracker-keywords.js';

/**
 * Снимаем ЛЮБОЙ `on*`-обработчик (по префиксу `on…` — 2D-3: фиксированный список всегда неполон,
 * а лендинги арбитража мобильные → нужны и `ontouch*`/`onpointer*`/`onwheel`/clipboard/history/media),
 * НО только если значение содержит внешний URL или трекерное ключевое слово. Простые обработчики
 * квиза (`onclick="next()"`, `ontouchstart="nextStep()"`) остаются — `on*` по префиксу не трогает их,
 * пока в значении нет внешнего вызова. FP исключён: не-обработчиков с именем `on…` в HTML нет.
 *
 * Граница: обфусцированный/протокол-относительный exfil в `on*` (`location='//evil'`, `atob(...)`)
 * этот блок-лист по значению пока не ловит — это 2D-2 (в идеале гнать значение через AST inline-exfil).
 */
export const stripEventAttrs: DomPass = ($) => {
  let eventAttrsRemoved = 0;
  $('*').each((_, node) => {
    const el = node as Element;
    const attribs = el.attribs;
    if (!attribs) return;
    for (const name of Object.keys(attribs)) {
      if (!/^on[a-z]/i.test(name)) continue;
      const val = attribs[name] ?? '';
      if (/https?:\/\//i.test(val) || TRACKER_INLINE_KEYWORDS.some((kw) => val.includes(kw))) {
        $(el).removeAttr(name);
        eventAttrsRemoved++;
      }
    }
  });
  return eventAttrsRemoved ? { eventAttrsRemoved } : {};
};
