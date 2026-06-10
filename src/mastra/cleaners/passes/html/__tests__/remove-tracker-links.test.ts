import { describe, it, expect } from 'vitest';
import { parseHtml, serializeHtml } from '../../../utils/html-dom.js';
import type { PassContext } from '../../../types.js';
import { removeTrackerLinks } from '../remove-tracker-links.js';

function makeCtx(): PassContext {
  return { siteDir: '/site', mainHost: 'mysite.com', filePath: '/site/index.html', relPath: 'index.html', log: [], quarantine: [] };
}

function run(html: string, ctx: PassContext = makeCtx()) {
  const $ = parseHtml(html);
  const counts = removeTrackerLinks($, ctx);
  return { out: serializeHtml($), counts, ctx };
}

describe('removeTrackerLinks — preconnect/preload через allowlist (2A-3)', () => {
  it('preconnect на неизвестный хост → карантин (было: keep)', () => {
    const { out, ctx } = run(`<link rel="preconnect" href="https://evil-analytics.xyz">`);
    expect(out).not.toContain('evil-analytics.xyz');
    expect(ctx.quarantine!.length).toBe(1);
  });

  it('preload as=script на неизвестный хост → карантин (preload СКАЧИВАЕТ ресурс)', () => {
    const { out, ctx } = run(`<link rel="preload" as="script" href="https://evil.com/x.js">`);
    expect(out).not.toContain('evil.com/x.js');
    expect(ctx.quarantine!.length).toBe(1);
  });

  it('modulepreload на неизвестный хост → карантин (раньше не покрыт)', () => {
    const { out } = run(`<link rel="modulepreload" href="https://evil.com/m.js">`);
    expect(out).not.toContain('evil.com/m.js');
  });

  it('мульти-значный rel="preload stylesheet" → классифицируется (раньше проваливался мимо обеих веток)', () => {
    const { out } = run(`<link rel="preload stylesheet" href="https://evil.com/x.css">`);
    expect(out).not.toContain('evil.com/x.css');
  });

  it('dns-prefetch на известный трекер → удаляется (blocklist всё ещё работает)', () => {
    const { out } = run(`<link rel="dns-prefetch" href="//www.google-analytics.com">`);
    expect(out).not.toContain('google-analytics.com');
  });

  // ── РОБАСТНОСТЬ: легитимное остаётся ──
  it('preconnect на доверенный хост (fonts.gstatic) → keep', () => {
    const { out } = run(`<link rel="preconnect" href="https://fonts.gstatic.com">`);
    expect(out).toContain('fonts.gstatic.com');
  });

  it('preload as=style на googleapis → keep', () => {
    const { out } = run(`<link rel="preload" as="style" href="https://fonts.googleapis.com/css?family=Roboto">`);
    expect(out).toContain('fonts.googleapis.com');
  });

  it('preload as=image на own-asset (cloudfront) → keep', () => {
    const { out } = run(`<link rel="preload" as="image" href="https://d4tncaiqdi48w.cloudfront.net/p.png">`);
    expect(out).toContain('cloudfront.net/p.png');
  });

  it('preload as=font на локальный путь → keep', () => {
    const { out } = run(`<link rel="preload" as="font" href="fonts/x.woff2" crossorigin>`);
    expect(out).toContain('fonts/x.woff2');
  });

  it('локальный stylesheet → keep (не-регресс)', () => {
    const { out } = run(`<link rel="stylesheet" href="css/local.css">`);
    expect(out).toContain('css/local.css');
  });

  it('rel=icon на любой хост → не трогаем (не ресурс-трекер)', () => {
    const { out } = run(`<link rel="icon" href="https://whatever.example/fav.ico">`);
    expect(out).toContain('whatever.example/fav.ico');
  });
});
