import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, writeFile, readFile, access, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { cleanSite } from '../pipeline.js';

let tmp: string;
beforeEach(async () => {
  tmp = await mkdtemp(join(tmpdir(), 'pipe-quar-'));
});
afterEach(async () => {
  await rm(tmp, { recursive: true, force: true });
});

async function exists(p: string): Promise<boolean> {
  try {
    await access(p);
    return true;
  } catch {
    return false;
  }
}

describe('C5б — destructive-delete JS уходит в карантин, а не unlink', () => {
  it('обфусцированный .js: убран со страницы, но сохранён в _quarantine', async () => {
    const obf = `var x = String['fromCharCode'](104, 105); window.payload = x;`;
    await writeFile(
      join(tmp, 'index.html'),
      '<!doctype html><html><head><title>t</title></head><body><p>hi</p></body></html>',
      'utf8',
    );
    await writeFile(join(tmp, 'app.js'), obf, 'utf8');

    const stats = await cleanSite(tmp, { runAdvanced: true });

    expect(stats.obfuscatedFilesRemoved).toBe(1);
    // оригинал убран с деплоя
    expect(await exists(join(tmp, 'app.js'))).toBe(false);
    // но содержимое сохранено в карантине (восстановимо), а не уничтожено
    expect(stats.quarantinedItems).toBeGreaterThanOrEqual(1);
    expect(await exists(join(tmp, '_quarantine', 'INDEX.md'))).toBe(true);
    const idx = await readFile(join(tmp, '_quarantine', 'INDEX.md'), 'utf8');
    expect(idx).toContain('app.js');
  });
});

describe('C2 — серверные теги: вырезать + полностью очистить (не пропускать)', () => {
  it('файл с <?php …?> и трекером: PHP вырезан И трекер удалён (раньше скипался)', async () => {
    await writeFile(
      join(tmp, 'index.html'),
      '<!doctype html><html><head><title>t</title></head><body><a href="page2.php">go</a></body></html>',
      'utf8',
    );
    await writeFile(
      join(tmp, 'page2.php'),
      '<?php session_start(); ?><!doctype html><html><head>' +
        '<script src="https://www.google-analytics.com/analytics.js"></script>' +
        '</head><body><p>page2</p></body></html>',
      'utf8',
    );

    const stats = await cleanSite(tmp, { runAdvanced: true });

    expect(stats.serverTagsFilesStripped).toBeGreaterThanOrEqual(1);
    const page2 = await readFile(join(tmp, 'page2.php'), 'utf8');
    expect(page2).not.toContain('<?php'); // серверный код вырезан
    expect(page2).not.toContain('google-analytics'); // и файл ОЧИЩЕН (трекер удалён) — раньше скипался
    expect(page2).toContain('page2'); // полезный контент цел
  });
});
