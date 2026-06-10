import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { walkFiles } from '../walk.js';

let tmp: string;
beforeEach(async () => {
  tmp = await mkdtemp(join(tmpdir(), 'walk-'));
});
afterEach(async () => {
  await rm(tmp, { recursive: true, force: true });
});

describe('walkFiles', () => {
  it('WALK-1: несуществующая/нечитаемая директория → пусто, без исключения', async () => {
    const out: string[] = [];
    // Не должно бросать ENOENT и ронять весь обход cleanSite.
    for await (const f of walkFiles(join(tmp, 'no-such-subdir-xyz'))) out.push(f);
    expect(out).toEqual([]);
  });

  it('обходит вложенные файлы', async () => {
    await mkdir(join(tmp, 'sub'), { recursive: true });
    await writeFile(join(tmp, 'a.txt'), 'x', 'utf8');
    await writeFile(join(tmp, 'sub', 'b.txt'), 'y', 'utf8');
    const out: string[] = [];
    for await (const f of walkFiles(tmp)) out.push(f);
    expect(out.some((p) => p.endsWith('a.txt'))).toBe(true);
    expect(out.some((p) => p.endsWith('b.txt'))).toBe(true);
  });
});
