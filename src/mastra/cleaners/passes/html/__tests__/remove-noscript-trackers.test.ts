import { describe, it, expect } from 'vitest';
import { parseHtml, serializeHtml } from '../../../utils/html-dom.js';
import type { PassContext } from '../../../types.js';
import { removeNoscriptTrackers } from '../remove-noscript-trackers.js';

function makeCtx(): PassContext {
  return { siteDir: '/site', mainHost: 'mysite.com', filePath: '/site/index.html', relPath: 'index.html', log: [], quarantine: [] };
}

function run(html: string, ctx: PassContext = makeCtx()) {
  const $ = parseHtml(html);
  const counts = removeNoscriptTrackers($, ctx);
  return { out: serializeHtml($), counts, ctx };
}

describe('removeNoscriptTrackers — allowlist по содержимому <noscript> (2A-4)', () => {
  it('НЕИЗВЕСТНЫЙ трекер-пиксель в <noscript> вырезается (раньше blocklist пропускал)', () => {
    const { out, ctx } = run(`<noscript><img src="//evil-analytics.xyz/p.gif"></noscript>`);
    expect(out).not.toContain('evil-analytics.xyz');
    expect(ctx.quarantine!.length).toBeGreaterThanOrEqual(1);
  });

  it('известный трекер-iframe (GTM) в <noscript> вырезается', () => {
    const { out } = run(`<noscript><iframe src="https://www.googletagmanager.com/ns.html?id=GTM-X"></iframe></noscript>`);
    expect(out).not.toContain('googletagmanager.com');
  });

  it('ХИРУРГИЧНО: чужой пиксель вырезан, легитимный локальный fallback сохранён', () => {
    const { out } = run(`<noscript><img src="images/ok.png"><img src="//evil/p"></noscript>`);
    expect(out).toContain('images/ok.png'); // легит fallback цел
    expect(out).not.toContain('evil/p'); // трекер вырезан
  });

  // ── РОБАСТНОСТЬ ──
  it('локальный <img> в <noscript> сохранён', () => {
    const { out } = run(`<noscript><img src="images/hero.png"></noscript>`);
    expect(out).toContain('images/hero.png');
  });

  it('текстовый fallback ("включите JavaScript") не трогаем', () => {
    const { out } = run(`<noscript>Пожалуйста, включите JavaScript</noscript>`);
    expect(out).toContain('Пожалуйста, включите JavaScript');
  });

  it('доверенный CDN-ресурс в <noscript> сохранён', () => {
    const { out } = run(`<noscript><img src="https://d4tncaiqdi48w.cloudfront.net/p.png"></noscript>`);
    expect(out).toContain('cloudfront.net/p.png');
  });
});
