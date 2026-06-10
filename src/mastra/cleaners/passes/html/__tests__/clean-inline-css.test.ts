import { describe, it, expect } from 'vitest';
import { parseHtml, serializeHtml } from '../../../utils/html-dom.js';
import type { PassContext } from '../../../types.js';
import { cleanInlineCss } from '../clean-inline-css.js';

function makeCtx(): PassContext {
  return { siteDir: '/site', mainHost: 'mysite.com', filePath: '/site/index.html', relPath: 'index.html', log: [], quarantine: [] };
}

function run(html: string, ctx: PassContext = makeCtx()) {
  const $ = parseHtml(html);
  cleanInlineCss($, ctx);
  return { out: serializeHtml($), ctx };
}

describe('cleanInlineCss — трекер-url() в inline <style>/style= (CSS-2)', () => {
  it('<style> с неизвестным внешним url() нейтрализуется', () => {
    const { out } = run(`<style>body{background:url(https://evil-cdn.xyz/p.gif)}</style>`);
    expect(out).not.toContain('evil-cdn.xyz');
    expect(out).toContain("url('')");
  });

  it('<style> с внешним @import (трекер) вырезается', () => {
    const { out } = run(`<style>@import url("https://www.google-analytics.com/x.css");body{}</style>`);
    expect(out).not.toContain('google-analytics.com');
  });

  it('style="" атрибут с трекер-url() нейтрализуется', () => {
    const { out } = run(`<div style="background:url(https://evil.xyz/bg.png)">x</div>`);
    expect(out).not.toContain('evil.xyz');
    expect(out).toContain("url('')");
  });

  // ── РОБАСТНОСТЬ ──
  it('<style> с локальным url() не трогаем', () => {
    const { out } = run(`<style>body{background:url(images/bg.png)}</style>`);
    expect(out).toContain('images/bg.png');
  });

  it('style= с доверенным шрифтом сохранён', () => {
    const { out } = run(`<div style="background:url(https://d4tncaiqdi48w.cloudfront.net/b.png)">y</div>`);
    expect(out).toContain('cloudfront.net/b.png');
  });
});
