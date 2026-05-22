import { describe, it, expect } from 'vitest';
import { analyzeDeadFiles } from '../analyze-coverage.js';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';

function createTempSite(files: Record<string, string>): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'coverage-test-'));
  for (const [relPath, content] of Object.entries(files)) {
    const absPath = path.join(dir, relPath);
    fs.mkdirSync(path.dirname(absPath), { recursive: true });
    fs.writeFileSync(absPath, content, 'utf8');
  }
  return dir;
}

describe('analyzeDeadFiles', () => {
  it('помечает файл с 0% покрытия и без event handlers как мёртвый', () => {
    const siteDir = createTempSite({
      'js/dead.js': 'console.log("never loaded");',
    });
    const coverages = [{ relPath: 'js/dead.js', percent: 0 }];
    const results = analyzeDeadFiles(coverages, siteDir);
    expect(results).toHaveLength(1);
    expect(results[0]!.isDead).toBe(true);
    expect(results[0]!.hasEventHandlers).toBe(false);
    expect(results[0]!.reason).toContain('мёртвый код');
  });

  it('НЕ помечает файл с event handlers как мёртвый (защита lazy-init)', () => {
    const siteDir = createTempSite({
      'js/lazy.js': "document.addEventListener('click', function() { console.log('click'); });",
    });
    const coverages = [{ relPath: 'js/lazy.js', percent: 0 }];
    const results = analyzeDeadFiles(coverages, siteDir);
    expect(results).toHaveLength(1);
    expect(results[0]!.isDead).toBe(false);
    expect(results[0]!.hasEventHandlers).toBe(true);
    expect(results[0]!.reason).toContain('lazy');
  });

  it('пропускает файлы с покрытием выше порога', () => {
    const siteDir = createTempSite({
      'js/alive.js': 'console.log("loaded");',
    });
    const coverages = [{ relPath: 'js/alive.js', percent: 50 }];
    const results = analyzeDeadFiles(coverages, siteDir);
    expect(results).toHaveLength(0);
  });

  it('пропускает inline-скрипты (relPath === null)', () => {
    const siteDir = createTempSite({});
    const coverages = [{ relPath: null, percent: 0 }];
    const results = analyzeDeadFiles(coverages, siteDir);
    expect(results).toHaveLength(0);
  });

  it('пропускает несуществующие файлы', () => {
    const siteDir = createTempSite({});
    const coverages = [{ relPath: 'js/missing.js', percent: 0 }];
    const results = analyzeDeadFiles(coverages, siteDir);
    expect(results).toHaveLength(0);
  });

  it('реагирует на window.onload как event handler', () => {
    const siteDir = createTempSite({
      'js/onload.js': 'window.onload = function() { init(); };',
    });
    const coverages = [{ relPath: 'js/onload.js', percent: 0 }];
    const results = analyzeDeadFiles(coverages, siteDir);
    expect(results).toHaveLength(1);
    expect(results[0]!.isDead).toBe(false);
    expect(results[0]!.hasEventHandlers).toBe(true);
  });

  it('поддерживает кастомный порог', () => {
    const siteDir = createTempSite({
      'js/low.js': 'console.log("low");',
    });
    const coverages = [{ relPath: 'js/low.js', percent: 2 }];
    // Порог 5% — файл должен быть мёртвым
    const results = analyzeDeadFiles(coverages, siteDir, 5);
    expect(results).toHaveLength(1);
    expect(results[0]!.isDead).toBe(true);
  });
});
