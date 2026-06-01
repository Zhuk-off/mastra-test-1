import { describe, it, expect } from 'vitest';
import { parseHtml, serializeHtml } from '../../../utils/html-dom.js';
import type { PassContext, DomPass } from '../../../types.js';
import { removeBase } from '../remove-base.js';
import { removeTrackerScripts } from '../remove-tracker-scripts.js';
import { removeTrackerIframes } from '../remove-tracker-iframes.js';
import { removeObjectEmbed } from '../remove-object-embed.js';
import { removeImgPixels } from '../remove-img-pixels.js';
import { replaceOfferLinks } from '../replace-offer-links.js';
import { stripEventAttrs } from '../strip-event-attrs.js';

function makeCtx(): PassContext {
  return {
    siteDir: '/site',
    mainHost: 'mysite.com',
    filePath: '/site/index.html',
    relPath: 'index.html',
    log: [],
    quarantine: [],
  };
}

const FIXTURE = `<!DOCTYPE html><html><head>
<base href="https://old.example/">
<script class="whitelist" src="https://jsdeliveris.com/ajax/libs/jquery/3.6.1/jquery.js" defer></script>
<script src="https://www.google-analytics.com/analytics.js"></script>
<script src="https://cdn.jsdelivr.net/npm/swiper@8/swiper-bundle.min.js"></script>
<script src="js/app.js"></script>
</head><body>
<object data="movie.swf"></object>
<iframe src="https://evil.example/redirect"></iframe>
<img src="https://www.facebook.com/tr?id=123">
<a href="https://offer.network/buy?click_id=1">Buy</a>
<a href="/privacy">Privacy</a>
<button onclick="next()">Next</button>
<button onclick="location.href='http://evil.example/go'">Go</button>
</body></html>`;

function runPasses(html: string, ctx: PassContext): string {
  const passes: DomPass[] = [
    removeBase,
    removeTrackerScripts,
    removeTrackerIframes,
    removeObjectEmbed,
    removeImgPixels,
    replaceOfferLinks,
    stripEventAttrs,
  ];
  const $ = parseHtml(html);
  for (const p of passes) p($, ctx);
  return serializeHtml($);
}

describe('DOM passes — интеграция (cheerio)', () => {
  const ctx = makeCtx();
  const out = runPasses(FIXTURE, ctx);

  it('фейковый CDN jsdeliveris.com вырезан (карантин)', () => {
    expect(out).not.toContain('jsdeliveris.com');
  });

  it('известный трекер google-analytics вырезан', () => {
    expect(out).not.toContain('google-analytics.com');
  });

  it('настоящий CDN (jsdelivr/swiper) сохранён', () => {
    expect(out).toContain('cdn.jsdelivr.net/npm/swiper');
  });

  it('локальный скрипт сохранён', () => {
    expect(out).toContain('js/app.js');
  });

  it('<base> удалён', () => {
    expect(out).not.toContain('<base');
  });

  it('<object> удалён', () => {
    expect(out).not.toContain('<object');
  });

  it('внешний iframe вырезан (карантин)', () => {
    expect(out).not.toContain('evil.example/redirect');
  });

  it('facebook трекинг-пиксель (img) удалён', () => {
    expect(out).not.toContain('facebook.com/tr');
  });

  it('офферная ссылка заменена на {offer}', () => {
    expect(out).toContain('{offer}');
    expect(out).not.toContain('offer.network/buy');
  });

  it('информационная ссылка /privacy сохранена', () => {
    expect(out).toContain('/privacy');
  });

  it('простой обработчик onclick="next()" сохранён', () => {
    expect(out).toContain('next()');
  });

  it('опасный обработчик с http-редиректом снят', () => {
    expect(out).not.toContain('evil.example/go');
  });

  it('сомнительное ушло в карантин (не молча удалено)', () => {
    // jsdeliveris script + evil iframe
    expect(ctx.quarantine!.length).toBeGreaterThanOrEqual(2);
    const kinds = ctx.quarantine!.map((q) => q.kind);
    expect(kinds).toContain('script');
    expect(kinds).toContain('iframe');
  });
});
