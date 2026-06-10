import { describe, it, expect } from 'vitest';
import { parseHtml, serializeHtml } from '../../../utils/html-dom.js';
import type { PassContext } from '../../../types.js';
import { replaceOfferLinks } from '../replace-offer-links.js';

function makeCtx(): PassContext {
  return { siteDir: '/site', mainHost: 'mysite.com', filePath: '/site/index.html', relPath: 'index.html', log: [], quarantine: [], macros: [] };
}

function run(html: string, ctx: PassContext = makeCtx()) {
  const $ = parseHtml(html);
  const counts = replaceOfferLinks($, ctx);
  return { out: serializeHtml($), counts, ctx };
}

describe('replaceOfferLinks — агрессивная политика «всё → {offer}»', () => {
  it('внешняя offer-ссылка → {offer}', () => {
    const { out } = run(`<a href="https://offer.network/buy?cid=1">Купить</a>`);
    expect(out).toContain('{offer}');
    expect(out).not.toContain('offer.network');
  });

  it('внешняя соцсеть/партнёрка → {offer} (чужой трафик не уводим)', () => {
    const { out } = run(`<a href="https://facebook.com/some-profile">FB</a>`);
    expect(out).not.toContain('facebook.com');
    expect(out).toContain('{offer}');
  });

  it('ОТНОСИТЕЛЬНАЯ ссылка (/privacy) → {offer}', () => {
    expect(run(`<a href="/privacy">Политика</a>`).out).toContain('href="{offer}"');
  });

  it('relative-файл (terms.html) → {offer}', () => {
    expect(run(`<a href="terms.html">Условия</a>`).out).toContain('href="{offer}"');
  });

  it('ссылка на свой домен (same-host) → {offer}', () => {
    expect(run(`<a href="https://mysite.com/info">x</a>`).out).toContain('{offer}');
  });

  it('<area href> тоже → {offer}', () => {
    const { counts } = run(`<map><area href="https://x.com/y" coords="0,0,9,9"></map>`);
    expect(counts.offerLinksReplaced).toBe(1);
  });

  it('оригинальные URL попадают в карту макросов (для отчёта/ручного возврата)', () => {
    const { ctx } = run(`<a href="https://offer.net/x">Buy</a>`);
    expect(ctx.macros!.some((m) => m.kind === 'link' && m.token.includes('offer.net/x'))).toBe(true);
  });

  // ── ИСКЛЮЧЕНИЯ ──
  it('якорь #form (прокрутка) сохранён', () => {
    const { out } = run(`<a href="#form">Заполнить</a>`);
    expect(out).toContain('href="#form"');
  });

  it('пустой "#" сохранён', () => {
    expect(run(`<a href="#">x</a>`).out).toContain('href="#"');
  });

  it('mailto:/tel: сохранены (контакт)', () => {
    const { out } = run(`<a href="mailto:a@b.com">m</a><a href="tel:+15551234567">t</a>`);
    expect(out).toContain('mailto:a@b.com');
    expect(out).toContain('tel:+15551234567');
  });

  it('href с макросом не трогаем (его разбирает detect-macros)', () => {
    const { out } = run(`<a href="{offer}">a</a><a href="{_offer_value:offername}">b</a>`);
    expect(out).toContain('href="{offer}"');
    expect(out).toContain('{_offer_value:offername}');
  });

  it('несколько ссылок: корректный счётчик', () => {
    const { counts } = run(`<a href="/a">1</a><a href="https://x.com">2</a><a href="#s">3</a><a href="tel:+1">4</a>`);
    expect(counts.offerLinksReplaced).toBe(2); // /a и x.com; #s и tel: — нет
  });
});
