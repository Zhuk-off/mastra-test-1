import { describe, it, expect } from 'vitest';
import { parseHtml, serializeHtml } from '../../../cleaners/utils/html-dom.js';
import { PRODUCT_IMAGE_BASE } from '../../../cleaners/registry/policy.js';
import { replaceProductImage } from '../replace-product-image.js';
import type { AdaptBrief, AdaptContext } from '../../types.js';

const ADULT = PRODUCT_IMAGE_BASE.Adult;

function makeCtx(brief: Partial<AdaptBrief> = {}): AdaptContext {
  return { siteDir: '/site', relPath: 'index.html', brief: { vertical: 'Adult', ...brief }, changes: [] };
}

function run(html: string, brief: Partial<AdaptBrief> = {}) {
  const ctx = makeCtx(brief);
  const $ = parseHtml(html);
  const counts = replaceProductImage($, ctx);
  return { out: serializeHtml($), counts, ctx };
}

describe('replaceProductImage — подстановка макроса картинки', () => {
  it('T2: <img> внутри <a href="{offer}"> → src = макрос', () => {
    const { out, counts } = run(`<a href="{offer}"><img src="images/prod.png" alt=""></a>`);
    expect(out).toContain(`src="${ADULT}"`);
    expect(out).not.toContain('images/prod.png');
    expect(counts.imagesReplaced).toBe(1);
  });

  it('T2: вертикаль WeightLoss даёт свой базовый URL', () => {
    const { out } = run(`<a href="{offer}"><img src="p.png"></a>`, { vertical: 'WeightLoss' });
    expect(out).toContain(PRODUCT_IMAGE_BASE.WeightLoss);
  });

  it('T2: лого/иконку внутри offer-якоря НЕ трогаем', () => {
    const { out, counts } = run(`<a href="{offer}"><img src="images/logo.webp" class="brand-logo"></a>`);
    expect(out).toContain('images/logo.webp');
    expect(counts.imagesReplaced ?? 0).toBe(0);
  });

  it('T2: крошечную картинку (width<=48) внутри якоря считаем иконкой и пропускаем', () => {
    const { counts } = run(`<a href="{offer}"><img src="x.png" width="24" height="24"></a>`);
    expect(counts.imagesReplaced ?? 0).toBe(0);
  });

  it('T2: srcset/sizes/lazy-атрибуты снимаются при подстановке', () => {
    const { out } = run(`<a href="{offer}"><img src="p.png" srcset="p@2x.png 2x" sizes="100vw" data-src="p.png"></a>`);
    expect(out).toContain(`src="${ADULT}"`);
    expect(out).not.toContain('srcset');
    expect(out).not.toContain('sizes');
    expect(out).not.toContain('data-src');
  });

  it('T2: <picture> — <source> вырезается, <img> получает макрос', () => {
    const { out } = run(
      `<a href="{offer}"><picture><source srcset="p.webp"><img src="p.png" srcset="p@2x.png 2x"></picture></a>`,
    );
    expect(out).not.toContain('<source');
    expect(out).toContain(`src="${ADULT}"`);
  });

  it('T1: чужой макрос в src → наш макрос', () => {
    const { out, counts } = run(`<img src="{some_old_offerimage}" alt="">`);
    expect(out).toContain(`src="${ADULT}"`);
    expect(out).not.toContain('{some_old_offerimage}');
    expect(counts.imagesReplaced).toBe(1);
  });

  it('T1: чужой макрос в <source srcset> → схлопывание <picture> на <img> с макросом', () => {
    const { out } = run(`<picture><source srcset="{old_img}"><img src="real.png"></picture>`);
    expect(out).toContain(`src="${ADULT}"`);
    expect(out).not.toContain('{old_img}');
    expect(out).not.toContain('real.png');
    expect(out).not.toContain('<source');
  });

  it('T1: чужой макрос в data-srcset у <source> не остаётся (схлопывание picture)', () => {
    const { out } = run(`<picture><source data-srcset="{old_img}" srcset="ph.webp"><img src="r.png"></picture>`);
    expect(out).not.toContain('{old_img}');
    expect(out).not.toContain('data-srcset');
    expect(out).toContain(`src="${ADULT}"`);
  });

  it('T1: одиночный <source> (без <img> в picture) с макросом в data-srcset → srcset=макрос, data-srcset снят', () => {
    const { out } = run(`<picture><source data-srcset="{old_img}"></picture>`);
    expect(out).toContain(`srcset="${ADULT}"`);
    expect(out).not.toContain('{old_img}');
    expect(out).not.toContain('data-srcset');
  });

  it('T1b: чужой макрос в url() инлайн-стиля → наш макрос', () => {
    const { out, counts } = run(`<div style="background:url({bg_offer}) center"></div>`);
    expect(out).toContain(ADULT);
    expect(out).not.toContain('{bg_offer}');
    expect(counts.imagesReplaced).toBe(1);
  });

  it('наш макрос уже стоит — идемпотентность (0 замен, без изменений)', () => {
    const { out, counts } = run(`<a href="{offer}"><img src="${ADULT}"></a>`);
    expect(counts.imagesReplaced ?? 0).toBe(0);
    expect(out).toContain(ADULT);
  });

  it('режим file — вписывает реальный URL вместо макроса', () => {
    const { out } = run(`<a href="{offer}"><img src="p.png"></a>`, { image: { mode: 'file', file: 'https://cdn.me/x.png' } });
    expect(out).toContain('src="https://cdn.me/x.png"');
  });

  it('режим skip — картинки не трогаем', () => {
    const { out, counts } = run(`<a href="{offer}"><img src="p.png"></a>`, { image: { mode: 'skip' } });
    expect(out).toContain('p.png');
    expect(counts.imagesReplaced ?? 0).toBe(0);
  });

  it('наш {offer} в href не считается «чужим макросом» картинки', () => {
    // <img> с href нет; проверяем, что own-макрос {offer} в обычной ссылке не триггерит подстановку картинки
    const { counts } = run(`<a href="{offer}">текст без картинки</a><img src="images/hero.png">`);
    expect(counts.imagesReplaced ?? 0).toBe(0); // hero без якоря и без чужого макроса — не трогаем (это шаг 5.5)
  });

  it('изменения попадают в ctx.changes (для отчёта)', () => {
    const { ctx } = run(`<a href="{offer}"><img src="p.png"></a>`);
    expect(ctx.changes.some((c) => c.pass === 'image' && c.trigger === 'offer-anchor' && c.after === ADULT)).toBe(true);
  });

  // ── фиксы ревью этапа 5 ──
  it('иконку .svg внутри offer-якоря не считаем пакшотом', () => {
    const { counts, out } = run(`<a href="{offer}"><img src="assets/img/1.svg"></a>`);
    expect(counts.imagesReplaced ?? 0).toBe(0);
    expect(out).toContain('1.svg');
  });

  it('иконку по alt (alt="checkmark icon") внутри offer-якоря пропускаем', () => {
    const { counts } = run(`<a href="{offer}"><img src="a/b.png" alt="checkmark icon"></a>`);
    expect(counts.imagesReplaced ?? 0).toBe(0);
  });

  it('счётчик не двоится: <picture> с чужим макросом и на <img>, и на <source> → 1 замена', () => {
    const { counts, ctx } = run(`<picture><img src="{oldimg}"><source srcset="{oldsrc}"></picture>`);
    expect(counts.imagesReplaced).toBe(1);
    expect(ctx.changes.filter((c) => c.pass === 'image').length).toBe(1);
  });

  it('счётчик не двоится при обратном порядке (source перед img)', () => {
    const { counts } = run(`<picture><source srcset="{oldsrc}"><img src="{oldimg}"></picture>`);
    expect(counts.imagesReplaced).toBe(1);
  });

  it('режим file с пробелом в URL — url() оборачивается в кавычки (валидный CSS)', () => {
    const { out } = run(`<div style="background:url({bg})"></div>`, { image: { mode: 'file', file: 'https://cdn.me/a b.png' } });
    expect(out).toContain(`url('https://cdn.me/a b.png')`);
  });

  // ── re-point: наш старый URL другой вертикали → текущий target ──
  it('re-point: наш URL другой вертикали в src → текущий target', () => {
    const WL = PRODUCT_IMAGE_BASE.WeightLoss;
    const { out, counts, ctx } = run(`<img src="${WL}">`, { vertical: 'Adult' });
    expect(out).toContain(`src="${ADULT}"`);
    expect(out).not.toContain('WeightLoss');
    expect(counts.imagesReplaced).toBe(1);
    expect(ctx.changes.some((c) => c.trigger === 're-point')).toBe(true);
  });

  it('re-point: наш URL в фоне style url() → текущий target', () => {
    const WL = PRODUCT_IMAGE_BASE.WeightLoss;
    const { out } = run(`<div style="background:url('${WL}')"></div>`, { vertical: 'Adult' });
    expect(out).toContain(ADULT);
    expect(out).not.toContain('WeightLoss');
  });

  it('re-point идемпотентен: тот же target в src не трогаем', () => {
    const { counts } = run(`<img src="${ADULT}">`, { vertical: 'Adult' });
    expect(counts.imagesReplaced ?? 0).toBe(0);
  });
});
