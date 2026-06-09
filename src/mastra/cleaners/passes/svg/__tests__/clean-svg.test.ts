import { describe, it, expect } from 'vitest';
import { cleanSvgContent } from '../clean-svg.js';

const clean = (svg: string) => cleanSvgContent(svg).content;

describe('cleanSvgContent — SVG как вектор сокрытия JS (SVG-1/SVG-2)', () => {
  it('закрытый <script> вырезается', () => {
    expect(clean(`<svg><script>alert(1)</script></svg>`)).not.toContain('alert(1)');
  });

  it('SVG-1: self-closing <script xlink:href> (внешний скрипт) вырезается', () => {
    const out = clean(`<svg><script xlink:href="https://evil.com/x.js"/></svg>`);
    expect(out).not.toContain('evil.com/x.js');
    expect(out).not.toContain('<script');
  });

  it('SVG-1: неквотированный on* (onload=...) снимается', () => {
    const out = clean(`<svg onload=steal()><rect/></svg>`);
    expect(out).not.toContain('onload');
    expect(out).not.toContain('steal()');
  });

  it('квотированный on* снимается (не-регресс)', () => {
    expect(clean(`<svg><rect onclick="x()"/></svg>`)).not.toContain('onclick');
  });

  it('SVG-2: plain href (SVG2) на внешний хост снимается', () => {
    const out = clean(`<svg><image href="https://evil.com/p.png"/></svg>`);
    expect(out).not.toContain('evil.com/p.png');
  });

  it('SVG-2: javascript: в href снимается', () => {
    const out = clean(`<svg><a xlink:href="javascript:alert(1)"><text>x</text></a></svg>`);
    expect(out).not.toContain('javascript:');
  });

  it('SVG-2: protocol-relative <use href="//evil"> снимается', () => {
    expect(clean(`<svg><use href="//evil.com/s#a"/></svg>`)).not.toContain('evil.com');
  });

  it('SVG-2: трекер-url() в <style> внутри SVG нейтрализуется', () => {
    const out = clean(`<svg><style>rect{fill:url(https://evil.xyz/p.png)}</style><rect/></svg>`);
    expect(out).not.toContain('evil.xyz');
  });

  it('<foreignObject> вырезается (не-регресс)', () => {
    expect(clean(`<svg><foreignObject><div>x</div></foreignObject></svg>`)).not.toContain('foreignObject');
  });

  // ── РОБАСТНОСТЬ: легитимный SVG не ломается ──
  it('локальный href и фрагмент #icon сохранены', () => {
    const out = clean(`<svg><use href="#icon"/><image href="images/local.png"/></svg>`);
    expect(out).toContain('#icon');
    expect(out).toContain('images/local.png');
  });

  it('обычный SVG без угроз не меняется (removed=0)', () => {
    const svg = `<svg viewBox="0 0 10 10"><rect x="0" y="0" width="10" height="10" fill="red"/></svg>`;
    const r = cleanSvgContent(svg);
    expect(r.removed).toBe(0);
    expect(r.content).toBe(svg);
  });
});
