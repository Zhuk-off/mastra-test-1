import { describe, it, expect } from 'vitest';
import { scanJsFileMacros, scanCssFileMacros } from '../macro-scan.js';

describe('scanJsFileMacros — макросы во внешнем .js (CJS-5/MAC-1)', () => {
  it('наш макрос {offer} в строке → kind own', () => {
    const f = scanJsFileMacros(`var u = "https://t.com/click?o={offer}"; go(u);`, 'js/app.js');
    expect(f.some((x) => x.kind === 'own' && x.token.includes('{offer}'))).toBe(true);
  });

  it('чужой макрос {clickid} в строке → kind script (флаг ручной проверки)', () => {
    const f = scanJsFileMacros(`var c = "{clickid}"; track(c);`, 'js/app.js');
    expect(f.some((x) => x.kind === 'script' && x.token.includes('{clickid}'))).toBe(true);
  });

  it('наш {_offer_value:offername} распознаётся как own', () => {
    const f = scanJsFileMacros(`const n = "{_offer_value:offername}";`, 'js/app.js');
    expect(f.some((x) => x.kind === 'own')).toBe(true);
  });

  // ── анти-FP ──
  it('объектный литерал {a:1} (не строка) НЕ даёт макрос', () => {
    expect(scanJsFileMacros(`var o = {a:1, bc:2}; use(o);`, 'js/app.js')).toHaveLength(0);
  });

  it('код без "{" → пусто', () => {
    expect(scanJsFileMacros(`var x = 1 + 2; console.log(x);`, 'js/app.js')).toHaveLength(0);
  });

  it('непарсимый JS → пусто (консервативно, без сырого regex-FP)', () => {
    expect(scanJsFileMacros(`function ( { @#$ )))`, 'js/app.js')).toHaveLength(0);
  });
});

describe('scanCssFileMacros — макросы во внешнем .css (CSS-3/MAC-1)', () => {
  it('чужой макрос в url({offerimage}) → kind image', () => {
    const f = scanCssFileMacros(`.hero{background:url({offerimage})}`, 'css/style.css');
    expect(f.some((x) => x.kind === 'image' && x.token.includes('{offerimage}'))).toBe(true);
  });

  it('наш макрос в url("{offer}") → kind own', () => {
    const f = scanCssFileMacros(`.b{background:url("{offer}")}`, 'css/style.css');
    expect(f.some((x) => x.kind === 'own')).toBe(true);
  });

  it('обычный CSS без макросов → пусто', () => {
    expect(scanCssFileMacros(`.c{color:red;background:url(images/x.png)}`, 'css/style.css')).toHaveLength(0);
  });
});
