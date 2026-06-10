import { describe, it, expect } from 'vitest';
import { parseHtml, serializeHtml } from '../../../utils/html-dom.js';
import type { PassContext } from '../../../types.js';
import { stripDangerousHrefs } from '../strip-dangerous-hrefs.js';

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

function run(html: string, ctx: PassContext = makeCtx()) {
  const $ = parseHtml(html);
  const counts = stripDangerousHrefs($, ctx);
  return { out: serializeHtml($), counts, ctx };
}

describe('stripDangerousHrefs — опасные схемы в href (<a>/<area>) — 2D-6', () => {
  it('javascript: в href нейтрализуется (href снят, текст кнопки сохранён)', () => {
    const { out, counts, ctx } = run(`<a href="javascript:location='//evil.com'">Купить</a>`);
    expect(out).not.toContain('javascript:');
    expect(out).not.toContain('evil.com');
    expect(out).toContain('Купить'); // видимый текст кнопки сохранён
    expect(out).toContain('<a'); // сам элемент остался — ломать вёрстку нельзя
    expect(counts.dangerousHrefsNeutralized).toBe(1);
    expect(ctx.quarantine!.some((q) => q.kind === 'anchor-href')).toBe(true);
  });

  it('vbscript: в href нейтрализуется', () => {
    const { out } = run(`<a href="vbscript:msgbox(1)">x</a>`);
    expect(out).not.toContain('vbscript:');
    expect(out).toContain('>x<');
  });

  it('data:text/html в href нейтрализуется + карантин (восстановимо)', () => {
    const { out, ctx } = run(`<a href="data:text/html;base64,PHNjcmlwdD4=">читать</a>`);
    expect(out).not.toContain('data:text/html');
    expect(out).toContain('читать');
    expect(ctx.quarantine!.length).toBe(1);
    expect(ctx.quarantine![0]!.snippet).toContain('data:text/html'); // оригинал сохранён в карантине
  });

  it('<area href="javascript:"> в image-map нейтрализуется', () => {
    const { out, counts } = run(`<map><area href="javascript:steal()" coords="0,0,10,10"></map>`);
    expect(out).not.toContain('javascript:');
    expect(out).toContain('coords'); // сам <area> сохранён
    expect(counts.dangerousHrefsNeutralized).toBe(1);
  });

  it('обфускация: ведущий пробел + регистр (  JavaScript:) нейтрализуется', () => {
    const { out } = run(`<a href="  JavaScript:alert(1)">y</a>`);
    expect(out).not.toContain('alert(1)');
  });

  it('обфускация: таб внутри схемы (java\\tscript:) нейтрализуется (как видит браузер)', () => {
    const { out } = run(`<a href="java\tscript:alert(1)">y</a>`);
    expect(out).not.toContain('alert(1)');
  });

  // ── РОБАСТНОСТЬ: легитимные href НЕ трогаем (это зона offer-detector / обычных страниц) ──
  it('РОБАСТНОСТЬ: внешний http(s)-хост НЕ трогаем (зона offer-detector, иначе ломаем легит-ссылки)', () => {
    const { out, counts } = run(`<a href="https://partner.example/article">Статья</a>`);
    expect(out).toContain('https://partner.example/article');
    expect(counts.dangerousHrefsNeutralized ?? 0).toBe(0);
  });

  it('РОБАСТНОСТЬ: относительная/локальная ссылка сохранена', () => {
    const { out } = run(`<a href="/privacy">Политика</a>`);
    expect(out).toContain('/privacy');
  });

  it('РОБАСТНОСТЬ: mailto:/tel: сохранены (легитимные не-http схемы)', () => {
    const { out } = run(`<a href="mailto:hi@example.com">mail</a><a href="tel:+15551234567">call</a>`);
    expect(out).toContain('mailto:hi@example.com');
    expect(out).toContain('tel:+15551234567');
  });

  it('РОБАСТНОСТЬ: фрагмент (#top) и пустой href сохранены', () => {
    const { out, counts } = run(`<a href="#top">наверх</a><a href="">пусто</a>`);
    expect(out).toContain('href="#top"');
    expect(counts.dangerousHrefsNeutralized ?? 0).toBe(0);
  });

  it('несколько опасных среди легитимных → корректный счётчик', () => {
    const { counts } = run(
      `<a href="javascript:a()">1</a><a href="data:text/html,x">2</a><a href="/ok">3</a><a href="https://x.com">4</a>`,
    );
    expect(counts.dangerousHrefsNeutralized).toBe(2);
  });

  it('нет опасных href → пустой результат (без шума в карантине)', () => {
    const { counts, ctx } = run(`<a href="/a">a</a><a href="https://x.com">b</a>`);
    expect(counts.dangerousHrefsNeutralized ?? 0).toBe(0);
    expect(ctx.quarantine!.length).toBe(0);
  });
});
