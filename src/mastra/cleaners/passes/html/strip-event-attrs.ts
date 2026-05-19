import type { HtmlPass } from '../../types.js';
import { DANGEROUS_EVENT_ATTRS } from '../../registry/event-attrs.js';
import { TRACKER_INLINE_KEYWORDS } from '../../registry/tracker-keywords.js';

export const stripEventAttrs: HtmlPass = (html, _ctx) => {
  const counts: Partial<Record<'eventAttrsRemoved', number>> = {};
  let eventAttrsRemoved = 0;

  const attrPattern = new RegExp(
    `\\b(${DANGEROUS_EVENT_ATTRS.join('|')})\\s*=\\s*('[^']*'|"[^"]*")`,
    'gi',
  );
  html = html.replace(attrPattern, (whole, _attr: string, val: string) => {
    const inner = val.slice(1, -1);
    if (
      /https?:\/\//i.test(inner) ||
      TRACKER_INLINE_KEYWORDS.some((kw) => inner.includes(kw))
    ) {
      eventAttrsRemoved++;
      return '';
    }
    return whole;
  });

  if (eventAttrsRemoved > 0) counts.eventAttrsRemoved = eventAttrsRemoved;
  return { html, counts };
};
