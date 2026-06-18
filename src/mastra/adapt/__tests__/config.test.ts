import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadAdaptConfig, BUILTIN_ADAPT_CONFIG } from '../config.js';

let dir: string;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'adapt-cfg-'));
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe('loadAdaptConfig', () => {
  it('нет файла → встроенные дефолты, без предупреждений', async () => {
    const r = await loadAdaptConfig({ configPath: join(dir, 'nope.json') });
    expect(r.source).toBe('builtin');
    expect(r.config).toEqual(BUILTIN_ADAPT_CONFIG);
    expect(r.warnings).toEqual([]);
  });

  it('файл мерджится поверх дефолтов (свой дефолт + новая вертикаль, встроенные сохранены)', async () => {
    const p = join(dir, 'adapt.config.json');
    await writeFile(
      p,
      JSON.stringify({ defaultVertical: 'WeightLoss', verticals: { Skincare: { imageBase: 'https://cdn/x/{_offer_value:offerimage}' } } }),
      'utf8',
    );
    const r = await loadAdaptConfig({ configPath: p });
    expect(r.source).toBe('file');
    expect(r.config.defaultVertical).toBe('WeightLoss');
    expect(r.config.verticals.Skincare?.imageBase).toContain('cdn/x');
    expect(r.config.verticals.Adult).toBeDefined(); // встроенные не потеряны
    expect(r.config.nameMacro).toBe(BUILTIN_ADAPT_CONFIG.nameMacro);
  });

  it('$comment и прочие лишние ключи не ломают валидацию', async () => {
    const p = join(dir, 'adapt.config.json');
    await writeFile(p, JSON.stringify({ $comment: 'note', defaultVertical: 'Adult' }), 'utf8');
    const r = await loadAdaptConfig({ configPath: p });
    expect(r.source).toBe('file');
    expect(r.warnings).toEqual([]);
  });

  it('битый JSON → дефолты + предупреждение', async () => {
    const p = join(dir, 'adapt.config.json');
    await writeFile(p, '{ not json', 'utf8');
    const r = await loadAdaptConfig({ configPath: p });
    expect(r.source).toBe('builtin');
    expect(r.warnings.length).toBeGreaterThan(0);
  });

  it('невалидная схема (imageBase не строка) → дефолты + предупреждение', async () => {
    const p = join(dir, 'adapt.config.json');
    await writeFile(p, JSON.stringify({ verticals: { Bad: { imageBase: 123 } } }), 'utf8');
    const r = await loadAdaptConfig({ configPath: p });
    expect(r.source).toBe('builtin');
    expect(r.warnings.length).toBeGreaterThan(0);
  });
});
