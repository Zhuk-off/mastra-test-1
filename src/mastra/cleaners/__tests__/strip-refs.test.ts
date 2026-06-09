import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { stripRefsToDeletedFiles } from '../pipeline.js';

let tmp: string;
beforeEach(async () => {
  tmp = await mkdtemp(join(tmpdir(), 'strip-'));
});
afterEach(async () => {
  await rm(tmp, { recursive: true, force: true });
});

describe('PIPE-2 — stripRefsToDeletedFiles (DOM, не regex)', () => {
  it('убирает ссылки на удалённые файлы: query-string, подпапка ../, доп.атрибуты', async () => {
    await mkdir(join(tmp, 'sub'), { recursive: true });
    await writeFile(
      join(tmp, 'index.html'),
      '<!doctype html><html><head>' +
        '<script src="js/a.js?v=3"></script>' + // query-string — regex промахивался
        '<script src="js/c.js" defer></script>' + // доп. атрибут
        '<script src="js/keep.js"></script>' + // НЕ удалён — остаётся
        '</head><body></body></html>',
      'utf8',
    );
    await writeFile(
      join(tmp, 'sub', 'page.html'),
      '<!doctype html><html><head><script src="../js/b.js?x=1"></script></head><body></body></html>',
      'utf8',
    );

    const deleted = new Set([resolve(tmp, 'js/a.js'), resolve(tmp, 'js/b.js'), resolve(tmp, 'js/c.js')]);
    await stripRefsToDeletedFiles(tmp, deleted);

    const idx = await readFile(join(tmp, 'index.html'), 'utf8');
    expect(idx).not.toContain('a.js');
    expect(idx).not.toContain('c.js');
    expect(idx).toContain('keep.js'); // не тронут

    const page = await readFile(join(tmp, 'sub', 'page.html'), 'utf8');
    expect(page).not.toContain('b.js');
  });

  it('PIPE-4: серверный файл (hasServerTags) не трогается', async () => {
    await writeFile(join(tmp, 'index.php'), '<?php echo 1; ?><script src="js/a.js"></script>', 'utf8');
    const deleted = new Set([resolve(tmp, 'js/a.js')]);
    await stripRefsToDeletedFiles(tmp, deleted);
    const out = await readFile(join(tmp, 'index.php'), 'utf8');
    expect(out).toContain('a.js'); // серверный файл не парсим/не трогаем
    expect(out).toContain('<?php'); // PHP цел
  });
});
