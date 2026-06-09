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
