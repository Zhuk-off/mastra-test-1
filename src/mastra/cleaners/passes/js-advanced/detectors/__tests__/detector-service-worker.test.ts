import { describe, it, expect } from 'vitest';
import { parseJs } from '../../ast/parse.js';
import { detectServiceWorker } from '../detect-service-worker.js';
import type { DetectorContext } from '../../ast/types.js';

const ctx = (source: string): DetectorContext => ({ source, relPath: 't.js', mainHost: 'mysite.com' });
const sw = (src: string): boolean => {
  const ast = parseJs(src, 't.js')!;
  return detectServiceWorker(ast, ctx(src)).some((r) => r.threatType === 'service-worker');
};

describe('SW-1/SW-2 — detectServiceWorker (AST вместо regex)', () => {
  it('классический navigator.serviceWorker.register', () => {
    expect(sw(`navigator.serviceWorker.register('/sw.js')`)).toBe(true);
  });
  it('SW-1: вложенные скобки register(getURL()) (regex ломал)', () => {
    expect(sw(`navigator.serviceWorker.register(getURL())`)).toBe(true);
  });
  it('SW-1: register(...).then(...)', () => {
    expect(sw(`navigator.serviceWorker.register('/sw.js').then(function(r){ r.update(); })`)).toBe(true);
  });
  it('SW-2: bracket-форма navigator[\'serviceWorker\']', () => {
    expect(sw(`navigator['serviceWorker'].register('/sw.js')`)).toBe(true);
  });
  it('SW-2: optional chaining navigator?.serviceWorker?.register', () => {
    expect(sw(`navigator?.serviceWorker?.register('/sw.js')`)).toBe(true);
  });
  it('SW-2: window.navigator.serviceWorker.register', () => {
    expect(sw(`window.navigator.serviceWorker.register('/sw.js')`)).toBe(true);
  });
  it('SW-2: алиас const s = navigator.serviceWorker; s.register(...)', () => {
    expect(sw(`var s = navigator.serviceWorker; s.register('/sw.js')`)).toBe(true);
  });

  it('НЕ-регресс: чужой .register не флагается', () => {
    expect(sw(`myPlugin.register('x')`)).toBe(false);
  });
  it('НЕ-регресс: serviceWorker без register не флагается', () => {
    expect(sw(`navigator.serviceWorker.ready.then(function(){ done(); })`)).toBe(false);
  });
});
