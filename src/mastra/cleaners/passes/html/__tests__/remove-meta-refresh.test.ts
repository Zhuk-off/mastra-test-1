import { describe, it, expect } from 'vitest';
import { parseHtml, serializeHtml } from '../../../utils/html-dom.js';
import type { PassContext } from '../../../types.js';
import { removeMetaRefresh } from '../remove-meta-refresh.js';

function ctx(): PassContext {
  return { siteDir: '/site', mainHost: 'mysite.com', filePath: '/site/index.html', relPath: 'index.html', log: [], quarantine: [] };
}
function run(html: string): string {
  const $ = parseHtml(html);
  removeMetaRefresh($, ctx());
  return serializeHtml($);
}

describe('removeMetaRefresh — 2B-2: любой redirect/timer снимается', () => {
  it('внешний redirect снимается (не-регресс)', () => {
    expect(run(`<meta http-equiv="refresh" content="0;url=https://evil.com">`)).not.toContain('refresh');
  });

  it('2B-2: ОТНОСИТЕЛЬНЫЙ redirect снимается (раньше выживал — клоакинг лендинг→оффер)', () => {
    expect(run(`<meta http-equiv="refresh" content="0;url=offer.html">`)).not.toContain('offer.html');
  });

  it('2B-2: ЗАКАВЫЧЕННЫЙ url снимается (кавычка ломала ^https?)', () => {
    expect(run(`<meta http-equiv="refresh" content="0;url='https://evil.com'">`)).not.toContain('evil.com');
  });

  it('2B-2: protocol-relative redirect снимается', () => {
    expect(run(`<meta http-equiv="refresh" content="0; url = //evil.com/go">`)).not.toContain('evil.com');
  });

  it('чистый таймер (без url) снимается', () => {
    expect(run(`<meta http-equiv="refresh" content="30">`)).not.toContain('refresh');
  });

  it('регистр/пробелы в http-equiv учитываются', () => {
    expect(run(`<meta http-equiv="  ReFresh  " content="0;url=offer.html">`)).not.toContain('offer.html');
  });

  it('НЕ-регресс: другой http-equiv (content-type) не трогается', () => {
    expect(run(`<meta http-equiv="content-type" content="text/html; charset=utf-8">`)).toContain('content-type');
  });

  it('оригинальный целевой URL уходит в карантин для ручной привязки к офферу', () => {
    const $ = parseHtml(`<meta http-equiv="refresh" content="0;url=https://partner.example/offer">`);
    const c = ctx();
    removeMetaRefresh($, c);
    expect(c.quarantine!.some((q) => q.kind === 'meta-refresh' && q.reason.includes('partner.example'))).toBe(true);
  });
});
