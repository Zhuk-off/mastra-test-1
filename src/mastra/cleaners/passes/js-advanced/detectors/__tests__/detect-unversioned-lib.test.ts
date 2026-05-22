import { describe, it, expect } from 'vitest';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { detectUnversionedLib } from '../detect-unversioned-lib.js';

async function createTempFile(content: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'unversioned-lib-test-'));
  const path = join(dir, 'test.js');
  await writeFile(path, content, 'utf8');
  return path;
}

describe('detectUnversionedLib', () => {
  it('детектирует jQuery без версии в имени', async () => {
    const content = '/*! jQuery JavaScript Library v3.6.0 */\n(function(){})';
    const path = await createTempFile(content);
    const result = await detectUnversionedLib(path);
    expect(result).not.toBeNull();
    expect(result!.lib.name).toBe('jquery');
    expect(result!.version).toBe('3.6.0');
  });

  it('детектирует jQuery с fallback версией', async () => {
    const content = '/*! jQuery JavaScript Library */\n(function(){})';
    const path = await createTempFile(content);
    const result = await detectUnversionedLib(path);
    expect(result).not.toBeNull();
    expect(result!.lib.name).toBe('jquery');
    expect(result!.version).toBe('3.7.1');
  });

  it('детектирует Bootstrap без версии в имени', async () => {
    const content = '/*! Bootstrap v5.2.3 (https://getbootstrap.com/) */';
    const path = await createTempFile(content);
    const result = await detectUnversionedLib(path);
    expect(result).not.toBeNull();
    expect(result!.lib.name).toBe('bootstrap-js');
    expect(result!.version).toBe('5.2.3');
  });

  it('НЕ детектирует обычный JS', async () => {
    const content = 'function init() { console.log("hello"); }';
    const path = await createTempFile(content);
    const result = await detectUnversionedLib(path);
    expect(result).toBeNull();
  });

  it('НЕ детектирует несуществующий файл', async () => {
    const result = await detectUnversionedLib('/nonexistent/path/file.js');
    expect(result).toBeNull();
  });
});
