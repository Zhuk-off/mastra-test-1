import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// PIPE-3: один файл, бросающий ошибку при обработке, не должен ронять весь прогон.
// Заставляем SVG-чистильщик бросать исключение и проверяем, что остальное обработано.
vi.mock('../passes/svg/clean-svg.js', () => ({
  cleanSvgFile: async () => {
    throw new Error('boom-svg');
  },
  cleanSvgContent: () => ({ content: '', removed: 0 }),
}));

import { cleanSite } from '../pipeline.js';

let tmp: string;
beforeEach(async () => {
  tmp = await mkdtemp(join(tmpdir(), 'pipe3-'));
});
afterEach(async () => {
  await rm(tmp, { recursive: true, force: true });
});

describe('PIPE-3 — один кривой файл не валит весь прогон', () => {
  it('SVG бросает ошибку → cleanSite не падает, HTML всё равно обработан, ошибка в логе', async () => {
    await writeFile(
      join(tmp, 'index.html'),
      '<!doctype html><html><head><title>t</title></head><body><p>hi</p></body></html>',
      'utf8',
    );
    await writeFile(join(tmp, 'bad.svg'), '<svg><rect/></svg>', 'utf8');

    // Не должно бросить, несмотря на падение обработки bad.svg.
    const stats = await cleanSite(tmp, { runAdvanced: false });

    expect(stats.htmlFilesProcessed).toBe(1); // HTML обработан, цикл продолжился
    expect(stats.svgFilesProcessed).toBe(0); // SVG упал до инкремента счётчика

    const log = await readFile(join(tmp, 'clean-site-changes.log'), 'utf8');
    expect(log).toContain('boom-svg'); // ошибка зафиксирована, а не проглочена
  });
});
