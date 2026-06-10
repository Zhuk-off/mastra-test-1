import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { buildUnversionedCdnReplacements } from '../unversioned-cdn-detector.js';
import type { DetectedLib } from '../../passes/js-advanced/detectors/detect-unversioned-lib.js';

let tmp: string;
beforeEach(async () => {
  tmp = await mkdtemp(join(tmpdir(), 'ucdn-'));
});
afterEach(async () => {
  vi.unstubAllGlobals();
  await rm(tmp, { recursive: true, force: true });
});

/** DetectedLib с детерминированным cdnUrl (для перехвата fetch). */
function fakeLib(cdnUrl: string): DetectedLib {
  return {
    version: '9.9.9',
    lib: {
      name: 'test-lib',
      contentSignature: /never/,
      versionExtractor: /never/,
      fallbackVersion: '9.9.9',
      cdnUrl: () => cdnUrl,
    },
  };
}

const sri = (s: string): string => `sha384-${createHash('sha384').update(Buffer.from(s)).digest('base64')}`;

describe('buildUnversionedCdnReplacements — SRI от CDN-файла (UCDN-1/UCDN-2)', () => {
  it('UCDN-1: integrity хешируется от CDN-контента, НЕ от локального файла', async () => {
    const cdnUrl = 'https://cdn.test/ucdn-1.js';
    const LOCAL = 'LOCAL-BYTES-different';
    const CDN = 'CDN-OFFICIAL-BYTES';

    await mkdir(join(tmp, 'js'), { recursive: true });
    await writeFile(join(tmp, 'js', 'vendor.js'), LOCAL, 'utf8');
    vi.stubGlobal('fetch', vi.fn(async () => new Response(CDN, { status: 200 })));

    const map = new Map<string, DetectedLib>([['js/vendor.js', fakeLib(cdnUrl)]]);
    const html = `<script src="js/vendor.js"></script>`;
    const res = await buildUnversionedCdnReplacements(tmp, join(tmp, 'index.html'), html, map);

    const repl = res.get('js/vendor.js');
    expect(repl).toBeDefined();
    expect(repl!.cdnUrl).toBe(cdnUrl);
    expect(repl!.integrity).toBe(sri(CDN)); // хеш CDN-файла
    expect(repl!.integrity).not.toBe(sri(LOCAL)); // НЕ хеш локального (иначе mismatch в браузере)
  });

  it('UCDN-2: CDN-URL недоступен (404) → замена не добавляется (локальный файл остаётся фолбэком)', async () => {
    const cdnUrl = 'https://cdn.test/ucdn-2-missing.js';
    await mkdir(join(tmp, 'js'), { recursive: true });
    await writeFile(join(tmp, 'js', 'vendor.js'), 'LOCAL', 'utf8');
    vi.stubGlobal('fetch', vi.fn(async () => new Response('not found', { status: 404 })));

    const map = new Map<string, DetectedLib>([['js/vendor.js', fakeLib(cdnUrl)]]);
    const html = `<script src="js/vendor.js"></script>`;
    const res = await buildUnversionedCdnReplacements(tmp, join(tmp, 'index.html'), html, map);

    expect(res.size).toBe(0); // не репиним на 404 — не ломаем сайт
  });

  it('абсолютные URL и нераспознанные локальные не трогаются', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('x', { status: 200 })));
    const map = new Map<string, DetectedLib>([['js/vendor.js', fakeLib('https://cdn.test/x.js')]]);
    const html = `<script src="https://cdn.jsdelivr.net/npm/x/x.js"></script><script src="js/other.js"></script>`;
    const res = await buildUnversionedCdnReplacements(tmp, join(tmp, 'index.html'), html, map);
    expect(res.size).toBe(0); // absolute пропущен; js/other.js нет в map
  });
});
