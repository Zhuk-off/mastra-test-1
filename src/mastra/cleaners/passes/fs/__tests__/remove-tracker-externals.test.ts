import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, mkdir, writeFile, access, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { removeTrackerExternals } from '../remove-tracker-externals.js';
import type { QuarantineItem } from '../../../types.js';

let tmp: string;
beforeEach(async () => {
  tmp = await mkdtemp(join(tmpdir(), 'ext-'));
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

async function seedExternal(host: string, file = 'x.js', body = 'data'): Promise<void> {
  await mkdir(join(tmp, '_external', host), { recursive: true });
  await writeFile(join(tmp, '_external', host, file), body, 'utf8');
}

describe('EXT-1 — _external/<host> через allowlist (не блок-лист)', () => {
  it('неизвестный чужой хост → карантин (перемещён, не оставлен локально)', async () => {
    await seedExternal('evil-unknown.xyz');
    const quarantine: QuarantineItem[] = [];

    const removed = await removeTrackerExternals(tmp, quarantine);

    expect(removed).toBeGreaterThanOrEqual(1);
    // убран из деплоя
    expect(await exists(join(tmp, '_external', 'evil-unknown.xyz'))).toBe(false);
    // но сохранён в карантине (восстановимо)
    expect(await exists(join(tmp, '_quarantine', '_external', 'evil-unknown.xyz', 'x.js'))).toBe(true);
    expect(quarantine.length).toBeGreaterThanOrEqual(1);
  });

  it('доверенный CDN остаётся локально', async () => {
    await seedExternal('cdn.jsdelivr.net', 'lib.js', 'ok');
    const quarantine: QuarantineItem[] = [];

    await removeTrackerExternals(tmp, quarantine);

    expect(await exists(join(tmp, '_external', 'cdn.jsdelivr.net', 'lib.js'))).toBe(true);
    expect(quarantine.length).toBe(0);
  });
});
