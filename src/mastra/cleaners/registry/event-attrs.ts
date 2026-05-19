/** Event-атрибуты, удаляемые если содержат внешние вызовы. */
export const DANGEROUS_EVENT_ATTRS: readonly string[] = [
  'onclick', 'ondblclick', 'onmousedown', 'onmouseup', 'onmouseover',
  'onmouseout', 'onmousemove', 'onkeydown', 'onkeyup', 'onkeypress',
  'onload', 'onunload', 'onabort', 'onerror', 'onresize', 'onscroll',
  'onfocus', 'onblur', 'onchange', 'onsubmit', 'onreset', 'onselect',
  'oncontextmenu', 'oninput', 'oninvalid', 'onsearch',
];
