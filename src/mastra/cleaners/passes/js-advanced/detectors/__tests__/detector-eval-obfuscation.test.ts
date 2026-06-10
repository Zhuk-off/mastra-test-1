import { describe, it, expect } from 'vitest';
import { parseJs } from '../../ast/parse.js';
import { detectEvalObfuscation } from '../detect-eval-obfuscation.js';
import type { DetectorContext } from '../../ast/types.js';

const ctx = (source: string): DetectorContext => ({ source, relPath: 't.js', mainHost: 'mysite.com' });
const evalObf = (src: string): boolean => {
  const ast = parseJs(src, 't.js')!;
  return detectEvalObfuscation(ast, ctx(src)).some((r) => r.threatType === 'eval-obfuscation');
};
const B64 = 'QQQQ'.repeat(12); // ≥40 base64-символов

describe('EVAL-1/EVAL-2 — detectEvalObfuscation (AST вместо regex)', () => {
  it('классический eval(atob(...))', () => {
    expect(evalObf(`eval(atob('QQQ'))`)).toBe(true);
  });
  it('EVAL-1: eval(window.atob(...))', () => {
    expect(evalObf(`eval(window.atob('QQQ'))`)).toBe(true);
  });
  it('EVAL-1: new Function(atob(...))()', () => {
    expect(evalObf(`new Function(atob('QQQ'))()`)).toBe(true);
  });
  it('EVAL-1: (0,eval)(atob(...))', () => {
    expect(evalObf(`(0,eval)(atob('QQQ'))`)).toBe(true);
  });
  it("EVAL-1: window['eval'](unescape(...))", () => {
    expect(evalObf(`window['eval'](unescape('%41%42'))`)).toBe(true);
  });
  it('EVAL-1: setTimeout(atob(...), 0)', () => {
    expect(evalObf(`setTimeout(atob('QQQ'), 0)`)).toBe(true);
  });
  it('EVAL-1: eval(String.fromCharCode(...))', () => {
    expect(evalObf(`eval(String.fromCharCode(97,98,99))`)).toBe(true);
  });
  it('eval("<base64 ≥40>")', () => {
    expect(evalObf(`eval('${B64}')`)).toBe(true);
  });

  it('НЕ-регресс: eval короткой строки не флагается', () => {
    expect(evalObf(`eval('a()')`)).toBe(false);
  });
  it('НЕ-регресс: setTimeout(fn, ms) не флагается', () => {
    expect(evalObf(`setTimeout(function(){ poll(); }, 1000)`)).toBe(false);
  });
  it('НЕ-регресс: Function("return this")() (sloppy globalThis) не флагается', () => {
    expect(evalObf(`Function('return this')()`)).toBe(false);
  });
});
