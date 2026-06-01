import { describe, it, expect } from 'vitest';
import { renderReport } from '../report.js';
import type { CleanStats, ChangelogEntry, QuarantineItem } from '../../types.js';

function baseStats(over: Partial<CleanStats> = {}): CleanStats {
  return {
    htmlFilesProcessed: 1, phpFilesProcessed: 0, scriptsRemoved: 0, inlineScriptsRemoved: 0,
    noscriptsRemoved: 0, linksRemoved: 0, metasRemoved: 0, jsonLdRemoved: 0, imgPixelsRemoved: 0,
    metaRefreshRemoved: 0, baseHrefRemoved: 0, objectEmbedsRemoved: 0, framesRemoved: 0,
    localLibsReplaced: 0, eventAttrsRemoved: 0, svgFilesProcessed: 0, svgItemsRemoved: 0,
    jsFilesScanned: 0, jsItemsRemoved: 0, cssFilesScanned: 0, cssItemsRemoved: 0,
    externalDirsRemoved: 0, sourceMapsDeleted: 0, sourceMapRefsStripped: 0, offerLinksReplaced: 0,
    bytesBefore: 0, bytesAfter: 0, deadJsFilesRemoved: 0, partialJsCleaned: 0, inlineExfilRemoved: 0,
    unversionedLibsCdn: 0, metricFilesRemoved: 0, detectorWarnings: 0, obfuscatedFilesRemoved: 0,
    quarantinedItems: 0, cspInjected: 0, phpBackdoorWarning: false, ...over,
  };
}

describe('renderReport', () => {
  it('секция карантина показывает элементы на ревью', () => {
    const q: QuarantineItem[] = [
      { kind: 'script', reason: 'внешний хост вне белого списка: ad.xyz', snippet: '<script>', file: 'index.html' },
    ];
    const md = renderReport(baseStats({ quarantinedItems: 1, localLibsReplaced: 2, cspInjected: 1 }), [], q);
    expect(md).toContain('НУЖНО РЕВЬЮ');
    expect(md).toContain('ad.xyz');
    expect(md).toContain('Библиотек репиннуто');
  });

  it('пустой карантин — явно пишет, что пусто', () => {
    const md = renderReport(baseStats({}), [], []);
    expect(md).toContain('Пусто');
  });

  it('показывает репин и предупреждения из changelog', () => {
    const log: ChangelogEntry[] = [
      { file: 'index.html', type: 'LIB_REPINNED', description: 'x → code.jquery.com' },
      { file: 'app.js', type: 'REDIRECT_WARN', description: 'подозрительный редирект', lineNumber: 10 },
    ];
    const md = renderReport(baseStats({ localLibsReplaced: 1 }), log, []);
    expect(md).toContain('Репин библиотек');
    expect(md).toContain('code.jquery.com');
    expect(md).toContain('REDIRECT_WARN');
  });
});
