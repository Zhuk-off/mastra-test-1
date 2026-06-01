import type { DomPass } from '../../types.js';
import type { Element } from 'domhandler';
import { DANGEROUS_EVENT_ATTRS } from '../../registry/event-attrs.js';
import { TRACKER_INLINE_KEYWORDS } from '../../registry/tracker-keywords.js';

const EVENT_SET = new Set(DANGEROUS_EVENT_ATTRS.map((a) => a.toLowerCase()));

/**
 * Снимаем on*-обработчики ТОЛЬКО если они содержат внешний URL или трекерные
 * ключевые слова. Простые обработчики (onclick="next()") квиза остаются.
 */
export const stripEventAttrs: DomPass = ($) => {
  let eventAttrsRemoved = 0;
  $('*').each((_, node) => {
    const el = node as Element;
    const attribs = el.attribs;
    if (!attribs) return;
    for (const name of Object.keys(attribs)) {
      if (!EVENT_SET.has(name.toLowerCase())) continue;
      const val = attribs[name] ?? '';
      if (/https?:\/\//i.test(val) || TRACKER_INLINE_KEYWORDS.some((kw) => val.includes(kw))) {
        $(el).removeAttr(name);
        eventAttrsRemoved++;
      }
    }
  });
  return eventAttrsRemoved ? { eventAttrsRemoved } : {};
};
