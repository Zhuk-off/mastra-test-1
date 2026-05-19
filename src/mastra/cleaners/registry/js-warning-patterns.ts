/** Паттерны в JS, требующие ручной проверки — добавляются только в changelog. */
export const JS_WARNING_PATTERNS: ReadonlyArray<{ re: RegExp; label: string }> = [
  { re: /\bfetch\s*\(/g,                                        label: 'fetch()' },
  { re: /new\s+XMLHttpRequest\s*\(/g,                           label: 'XMLHttpRequest' },
  { re: /navigator\.sendBeacon\s*\(/g,                          label: 'sendBeacon' },
  { re: /new\s+WebSocket\s*\(/g,                                label: 'WebSocket' },
  { re: /document\.write\s*\(/g,                                label: 'document.write' },
  { re: /\blocalStorage\s*\./g,                                 label: 'localStorage' },
  { re: /\bsessionStorage\s*\./g,                               label: 'sessionStorage' },
  { re: /document\.addEventListener\s*\(\s*['"]key/g,           label: 'keylogger (addEventListener key*)' },
  { re: /\batob\s*\(/g,                                         label: 'atob()' },
  { re: /String\.fromCharCode\s*\(/g,                           label: 'String.fromCharCode' },
  { re: /window\.location\s*=/g,                                label: 'window.location redirect' },
  { re: /location\.href\s*=/g,                                  label: 'location.href redirect' },
  { re: /location\.replace\s*\(/g,                              label: 'location.replace redirect' },
  { re: /navigator\.clipboard\s*\./g,                           label: 'Clipboard API' },
  { re: /\bpostMessage\s*\(/g,                                  label: 'postMessage' },
];
