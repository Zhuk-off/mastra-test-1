import { describe, it, expect } from 'vitest';
import { parseHtml, serializeHtml } from '../../../cleaners/utils/html-dom.js';
import { PRODUCT_NAME_MACRO } from '../../../cleaners/registry/policy.js';
import { replaceProductName } from '../replace-product-name.js';
import type { AdaptBrief, AdaptContext } from '../../types.js';

const M = PRODUCT_NAME_MACRO; // {_offer_value:offername}

function makeCtx(brief: Partial<AdaptBrief> = {}): AdaptContext {
  return { siteDir: '/site', relPath: 'index.html', brief: { vertical: 'Adult', ...brief }, changes: [] };
}

function run(html: string, name: NonNullable<AdaptBrief['name']>) {
  const ctx = makeCtx({ name });
  const $ = parseHtml(html);
  const counts = replaceProductName($, ctx);
  return { out: serializeHtml($), counts, ctx };
}

describe('replaceProductName — все имена продукта → макрос', () => {
  it('заменяет вхождение в тексте', () => {
    const { out, counts } = run(`<h2>Buy PowerGummies today</h2>`, { productName: 'PowerGummies' });
    expect(out).toContain(`Buy ${M} today`);
    expect(counts.namesReplaced).toBe(1);
  });

  it('заменяет ВСЕ вхождения', () => {
    const { out, counts } = run(`<p>PowerGummies is great. Order PowerGummies now.</p>`, { productName: 'PowerGummies' });
    expect(counts.namesReplaced).toBe(2);
    expect(out).not.toContain('PowerGummies');
  });

  it('регистронезависимо', () => {
    const { counts } = run(`<p>POWERGUMMIES and powergummies</p>`, { productName: 'PowerGummies' });
    expect(counts.namesReplaced).toBe(2);
  });

  it('не рвёт слова: "Vital" не трогает "Vitality"', () => {
    const { out } = run(`<p>Vital boost vs Vitality</p>`, { productName: 'Vital' });
    expect(out).toContain('Vitality');
    expect(out).toContain(`${M} boost`);
  });

  it('многословное название с пробелами', () => {
    const { out, counts } = run(`<h1>Vital Boost XL Gummies</h1>`, { productName: 'Vital Boost XL' });
    expect(out).toContain(`${M} Gummies`);
    expect(counts.namesReplaced).toBe(1);
  });

  it('алиасы (мн. число)', () => {
    const { counts } = run(`<p>Keto gummy and Keto gummies</p>`, { productName: 'Keto gummy', aliases: ['Keto gummies'] });
    expect(counts.namesReplaced).toBe(2);
  });

  it('заменяет в alt/title', () => {
    const { out } = run(`<img alt="PowerGummies pack" title="PowerGummies"><span>x</span>`, { productName: 'PowerGummies' });
    expect(out).toContain(`alt="${M} pack"`);
    expect(out).toContain(`title="${M}"`);
  });

  it('заменяет в <title>', () => {
    const { out } = run(`<html><head><title>PowerGummies — official</title></head><body></body></html>`, {
      productName: 'PowerGummies',
    });
    expect(out).toContain(`<title>${M} — official</title>`);
  });

  it('заменяет в <meta name="description">', () => {
    const { out } = run(`<meta name="description" content="PowerGummies for energy">`, { productName: 'PowerGummies' });
    expect(out).toContain(`content="${M} for energy"`);
  });

  it('НЕ трогает <script>/<style>', () => {
    const { out, counts } = run(
      `<script>var x="PowerGummies"</script><style>.PowerGummies{}</style><p>PowerGummies</p>`,
      { productName: 'PowerGummies' },
    );
    expect(out).toContain('var x="PowerGummies"');
    expect(out).toContain('.PowerGummies{}');
    expect(counts.namesReplaced).toBe(1); // только <p>
  });

  it('НЕ трогает href/src', () => {
    const { out } = run(`<a href="/PowerGummies">link</a><img src="PowerGummies.png">`, { productName: 'PowerGummies' });
    expect(out).toContain('href="/PowerGummies"');
    expect(out).toContain('src="PowerGummies.png"');
  });

  it('идемпотентность: повторный прогон ничего не меняет', () => {
    const ctx1 = makeCtx({ name: { productName: 'PowerGummies' } });
    const $ = parseHtml(`<p>PowerGummies</p>`);
    replaceProductName($, ctx1);
    const ctx2 = makeCtx({ name: { productName: 'PowerGummies' } });
    const counts2 = replaceProductName($, ctx2);
    expect(counts2.namesReplaced ?? 0).toBe(0);
    expect(serializeHtml($)).toContain(M);
  });

  it('нет productName — ничего не делаем', () => {
    const { out, counts } = run(`<p>PowerGummies</p>`, {});
    expect(out).toContain('PowerGummies');
    expect(counts.namesReplaced ?? 0).toBe(0);
  });

  it('режим skip — ничего не делаем', () => {
    const { counts } = run(`<p>PowerGummies</p>`, { mode: 'skip', productName: 'PowerGummies' });
    expect(counts.namesReplaced ?? 0).toBe(0);
  });

  it('режим literal — подставляет строку, а не макрос', () => {
    const { out } = run(`<p>PowerGummies</p>`, { mode: 'literal', productName: 'PowerGummies', literal: 'SuperOffer' });
    expect(out).toContain('SuperOffer');
    expect(out).not.toContain(M);
  });

  // ── фиксы ревью этапа 5 ──
  it('НЕ трогает содержимое <noscript> (cheerio держит его как сырой текст → испортили бы src)', () => {
    const { out, counts } = run(`<noscript><img src="PowerGummies.png" alt="PowerGummies"></noscript><p>PowerGummies</p>`, {
      productName: 'PowerGummies',
    });
    expect(out).toContain('src="PowerGummies.png"');
    expect(counts.namesReplaced).toBe(1); // только <p>, не внутри noscript
  });

  it('НЕ трогает value скрытого input (данные формы)', () => {
    const { out, counts } = run(`<input type="hidden" name="sku" value="PowerGummies">`, { productName: 'PowerGummies' });
    expect(out).toContain('value="PowerGummies"');
    expect(counts.namesReplaced ?? 0).toBe(0);
  });

  it('у <option> правит текст, но НЕ value (value — отправляемые данные)', () => {
    const { out, counts } = run(`<select><option value="PowerGummies">PowerGummies</option></select>`, {
      productName: 'PowerGummies',
    });
    expect(out).toContain('value="PowerGummies"'); // value сохранён
    expect(out).toContain(`>${M}</option>`); // текст заменён
    expect(counts.namesReplaced).toBe(1);
  });

  it('многословное имя через &nbsp; матчится', () => {
    const { out, counts } = run(`<h1>Vital Boost XL Gummies</h1>`, { productName: 'Vital Boost XL' });
    expect(counts.namesReplaced).toBe(1);
    expect(out).toContain(`${M} Gummies`);
  });

  it('многословное имя через &nbsp; и несколько пробелов матчится (в одном текст-узле)', () => {
    expect(run(`<h1>Vital&nbsp;Boost&nbsp;XL</h1>`, { productName: 'Vital Boost XL' }).counts.namesReplaced).toBe(1);
    expect(run(`<h1>Vital   Boost  XL</h1>`, { productName: 'Vital Boost XL' }).counts.namesReplaced).toBe(1);
  });
});
