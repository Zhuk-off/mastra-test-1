import { describe, it, expect } from 'vitest';
import { parseHtml, serializeHtml } from '../../../utils/html-dom.js';
import type { PassContext, MacroFinding } from '../../../types.js';
import { detectMacros } from '../detect-macros.js';

function makeCtx(): PassContext & { macros: MacroFinding[] } {
  return { siteDir: '/s', mainHost: 'm', filePath: '/s/index.html', relPath: 'index.html', log: [], quarantine: [], macros: [] };
}

function run(html: string, ctx: PassContext) {
  const $ = parseHtml(html);
  detectMacros($, ctx);
  return serializeHtml($);
}

describe('detectMacros', () => {
  it('href, состоящий целиком из чужого макроса → {offer}', () => {
    const ctx = makeCtx();
    const out = run('<a href="{_fbclid}">Buy</a>', ctx);
    expect(out).toContain('href="{offer}"');
    expect(out).not.toContain('{_fbclid}');
    expect(ctx.macros.some((m) => m.kind === 'link')).toBe(true);
  });

  it('наш {offer} в href — не трогаем', () => {
    const ctx = makeCtx();
    const out = run('<a href="{offer}">Buy</a>', ctx);
    expect(out).toContain('href="{offer}"');
    expect(ctx.macros.some((m) => m.kind === 'own')).toBe(true);
  });

  it('чужой макрос в img src → флаг image, src НЕ меняем (подстановка на этапе адаптации)', () => {
    const ctx = makeCtx();
    const out = run('<img src="https://trk.example/img/{product_id}.jpg">', ctx);
    expect(out).toContain('{product_id}'); // оставлен как маркер
    const img = ctx.macros.find((m) => m.kind === 'image');
    expect(img).toBeTruthy();
    expect(img!.attr).toBe('src');
  });

  it('наш {_offer_value:offerimage} в img src — это own, не флагается', () => {
    const ctx = makeCtx();
    run('<img src="https://d4tncaiqdi48w.cloudfront.net/Aquarium/Images/Adult/ProductImages/{_offer_value:offerimage}">', ctx);
    expect(ctx.macros.some((m) => m.kind === 'own')).toBe(true);
    expect(ctx.macros.some((m) => m.kind === 'image')).toBe(false);
  });

  it('чужой макрос в data-* → флаг other', () => {
    const ctx = makeCtx();
    run('<div data-track="{sub_id}"></div>', ctx);
    expect(ctx.macros.some((m) => m.kind === 'other')).toBe(true);
  });

  it('инлайн JS/CSS с {...} НЕ ловится (текст внутри script/style пропускаем)', () => {
    const ctx = makeCtx();
    run('<style>.a{color:red}</style><script>const o={a:1};</script>', ctx);
    expect(ctx.macros.length).toBe(0);
  });

  it('РЕГРЕССИЯ: чужой макрос в тексте body ({_fbclid}) удаляется', () => {
    const ctx = makeCtx();
    const out = run('<body><p>Hi</p>\n    {_fbclid}\n</body>', ctx);
    expect(out).not.toContain('{_fbclid}');
    expect(ctx.macros.some((m) => m.kind === 'text')).toBe(true);
  });

  it('наш {offer} в тексте — остаётся', () => {
    const ctx = makeCtx();
    const out = run('<body>{offer}</body>', ctx);
    expect(out).toContain('{offer}');
  });
});
