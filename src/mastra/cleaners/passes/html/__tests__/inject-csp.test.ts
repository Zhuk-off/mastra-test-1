import { describe, it, expect } from 'vitest';
import { parseHtml, serializeHtml } from '../../../utils/html-dom.js';
import type { PassContext } from '../../../types.js';
import { injectCsp } from '../inject-csp.js';

const ctx = (): PassContext => ({
  siteDir: '/s', mainHost: 'm', filePath: '/s/index.html', relPath: 'index.html', log: [], quarantine: [],
});

function run(html: string): string {
  const $ = parseHtml(html);
  injectCsp($, ctx());
  return serializeHtml($);
}

describe('injectCsp', () => {
  it('вставляет CSP-meta в head', () => {
    const out = run('<!DOCTYPE html><html><head><meta charset="utf-8"><title>t</title></head><body></body></html>');
    expect(out).toContain('Content-Security-Policy');
    expect(out).toContain("default-src 'self'");
    expect(out).toContain('https://code.jquery.com');
  });

  it('идемпотентность: повторный запуск не дублирует CSP', () => {
    let html = '<!DOCTYPE html><html><head><meta charset="utf-8"></head><body></body></html>';
    html = run(html);
    html = run(html);
    const occurrences = html.split('Content-Security-Policy').length - 1;
    expect(occurrences).toBe(1);
  });

  it('работает без charset', () => {
    const out = run('<!DOCTYPE html><html><head><title>t</title></head><body></body></html>');
    expect(out).toContain('Content-Security-Policy');
  });
});
