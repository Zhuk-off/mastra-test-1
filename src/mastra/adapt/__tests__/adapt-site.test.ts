import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, writeFile, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { adaptSite } from '../adapt-site.js';
import { PRODUCT_IMAGE_BASE, PRODUCT_NAME_MACRO } from '../../cleaners/registry/policy.js';

const PAGE = `<!doctype html><html><head><title>PowerGummies official</title>
<meta name="description" content="PowerGummies for energy"></head>
<body>
<h1>PowerGummies</h1>
<a href="{offer}"><img src="images/prod.png" alt="PowerGummies pack" srcset="images/prod@2x.png 2x"></a>
<p>Order PowerGummies now</p>
<a href="{offer}" target="_blank"><img src="images/logo.webp" class="brand-logo"></a>
</body></html>`;

let dir: string;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'adapt-test-'));
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe('adaptSite — оркестратор этапа 5', () => {
  it('подставляет картинку и имя, пишет отчёт, без предупреждений', async () => {
    await writeFile(join(dir, 'index.html'), PAGE, 'utf8');
    const stats = await adaptSite(dir, { vertical: 'Adult', name: { productName: 'PowerGummies' } });

    expect(stats.htmlFilesProcessed).toBe(1);
    expect(stats.imagesReplaced).toBe(1); // продуктовый <img>, лого пропущено
    expect(stats.namesReplaced).toBeGreaterThanOrEqual(4); // title, meta, h1, p, alt
    expect(stats.warnings).toEqual([]);

    const out = await readFile(join(dir, 'index.html'), 'utf8');
    expect(out).toContain(PRODUCT_IMAGE_BASE.Adult);
    expect(out).toContain(PRODUCT_NAME_MACRO);
    expect(out).not.toContain('images/prod.png');
    expect(out).not.toContain('PowerGummies');
    expect(out).toContain('images/logo.webp'); // лого не тронуто

    // отчёт пишется всегда
    const reportStat = await stat(join(dir, 'adapt-report.md'));
    expect(reportStat.isFile()).toBe(true);
    expect(stats.reportPath).toBe(join(dir, 'adapt-report.md'));
  });

  it('идемпотентность: повторный прогон не меняет файл', async () => {
    await writeFile(join(dir, 'index.html'), PAGE, 'utf8');
    await adaptSite(dir, { vertical: 'Adult', name: { productName: 'PowerGummies' } });
    const first = await readFile(join(dir, 'index.html'), 'utf8');
    const stats2 = await adaptSite(dir, { vertical: 'Adult', name: { productName: 'PowerGummies' } });
    const second = await readFile(join(dir, 'index.html'), 'utf8');
    expect(second).toBe(first);
    expect(stats2.imagesReplaced).toBe(0);
    expect(stats2.namesReplaced).toBe(0);
  });

  it('нет productName → предупреждение про имя', async () => {
    await writeFile(join(dir, 'index.html'), PAGE, 'utf8');
    const stats = await adaptSite(dir, { vertical: 'Adult' });
    expect(stats.namesReplaced).toBe(0);
    expect(stats.warnings.some((w) => w.includes('productName'))).toBe(true);
  });

  it('нет offer-якоря и макроса → предупреждение про картинку', async () => {
    await writeFile(join(dir, 'index.html'), `<body><img src="images/hero.png"></body>`, 'utf8');
    const stats = await adaptSite(dir, { vertical: 'WeightLoss', image: { mode: 'macro' }, name: { mode: 'skip' } });
    expect(stats.imagesReplaced).toBe(0);
    expect(stats.warnings.some((w) => w.toLowerCase().includes('картинк'))).toBe(true);
  });

  it('вертикаль по умолчанию берётся из конфига (бриф без vertical)', async () => {
    const cfg = join(dir, 'adapt.config.json');
    await writeFile(cfg, JSON.stringify({ defaultVertical: 'WeightLoss' }), 'utf8');
    await writeFile(join(dir, 'index.html'), `<a href="{offer}"><img src="p.png"></a>`, 'utf8');
    const stats = await adaptSite(dir, { name: { mode: 'skip' } }, { configPath: cfg });
    expect(stats.vertical).toBe('WeightLoss');
    expect(stats.configSource).toBe('file');
    const out = await readFile(join(dir, 'index.html'), 'utf8');
    expect(out).toContain(PRODUCT_IMAGE_BASE.WeightLoss);
  });

  it('re-point: повторный прогон с другой вертикалью перенацеливает картинку', async () => {
    await writeFile(join(dir, 'index.html'), `<a href="{offer}"><img src="p.png"></a>`, 'utf8');
    await adaptSite(dir, { vertical: 'Adult', name: { mode: 'skip' } });
    expect(await readFile(join(dir, 'index.html'), 'utf8')).toContain(PRODUCT_IMAGE_BASE.Adult);

    const stats2 = await adaptSite(dir, { vertical: 'WeightLoss', name: { mode: 'skip' } });
    const out = await readFile(join(dir, 'index.html'), 'utf8');
    expect(out).toContain(PRODUCT_IMAGE_BASE.WeightLoss);
    expect(out).not.toContain('/Adult/');
    expect(stats2.imagesReplaced).toBe(1);
  });
});
