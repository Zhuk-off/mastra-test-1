import { describe, it, expect } from 'vitest';
import { removeTrackerUrls } from '../remove-tracker-urls.js';
import type { ChangelogEntry } from '../../../types.js';

function run(css: string) {
  const log: ChangelogEntry[] = [];
  const { content, removed } = removeTrackerUrls(css, 'style.css', log);
  return { content, removed, log };
}

describe('removeTrackerUrls — CSS url() через allowlist (CSS-1)', () => {
  it('НЕИЗВЕСТНЫЙ внешний url() нейтрализуется (раньше blocklist пропускал)', () => {
    const { content, removed } = run(`body{background:url(https://evil-cdn.xyz/bg.png)}`);
    expect(content).not.toContain('evil-cdn.xyz');
    expect(content).toContain("url('')");
    expect(removed).toBe(1);
  });

  it('известный трекер-url() нейтрализуется', () => {
    const { content } = run(`div{background:url("https://www.google-analytics.com/p.gif")}`);
    expect(content).not.toContain('google-analytics.com');
  });

  // ── РОБАСТНОСТЬ: легитимные внешние ресурсы остаются ──
  it('доверенный шрифт (fonts.gstatic) сохранён', () => {
    const css = `@font-face{src:url(https://fonts.gstatic.com/s/roboto/v1/x.woff2)}`;
    const { content, removed } = run(css);
    expect(content).toContain('fonts.gstatic.com');
    expect(removed).toBe(0);
  });

  it('own-asset (cloudfront) сохранён', () => {
    const css = `body{background:url(https://d4tncaiqdi48w.cloudfront.net/bg.png)}`;
    expect(run(css).content).toContain('cloudfront.net/bg.png');
  });

  it('локальный url() не трогаем (regex матчит только http(s))', () => {
    const css = `body{background:url(images/local.png)}`;
    expect(run(css).content).toContain('images/local.png');
  });
});
