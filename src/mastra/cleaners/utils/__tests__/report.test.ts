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
    dangerousHrefsNeutralized: 0,
    bytesBefore: 0, bytesAfter: 0, deadJsFilesRemoved: 0, partialJsCleaned: 0, inlineExfilRemoved: 0,
    unversionedLibsCdn: 0, metricFilesRemoved: 0, detectorWarnings: 0, obfuscatedFilesRemoved: 0,
    quarantinedItems: 0, macrosFlagged: 0, cspInjected: 0, phpBackdoorWarning: false,
    serverTagsFilesStripped: 0, ...over,
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

  it('серверные файлы (теги вырезаны + очищены) перечислены в отчёте (C2)', () => {
    const log: ChangelogEntry[] = [
      { file: 'checkout.php', type: 'SERVER_TAGS_STRIPPED', description: 'серверные теги удалены' },
      { file: 'inc/header.php', type: 'SERVER_TAGS_STRIPPED', description: 'серверные теги удалены' },
    ];
    const md = renderReport(baseStats({ serverTagsFilesStripped: 2, phpFilesProcessed: 2 }), log, []);
    expect(md).toContain('Серверные теги удалены');
    expect(md).toContain('checkout.php');
    expect(md).toContain('inc/header.php');
  });

  it('REP-1: PHP-бэкдор (тип PHP_BACKDOOR_WARN) попадает в раздел предупреждений', () => {
    const log: ChangelogEntry[] = [
      { file: 'shell.php', type: 'PHP_BACKDOOR_WARN', description: 'eval($_POST[...])', lineNumber: 3 },
    ];
    const md = renderReport(baseStats({ phpBackdoorWarning: true, phpFilesProcessed: 1 }), log, []);
    // Раньше фильтр искал 'PHP_BACKDOOR' (без _WARN) → детали терялись.
    expect(md).toContain('PHP_BACKDOOR_WARN');
    expect(md).toContain('shell.php');
    expect(md).toContain('eval($_POST[...])');
  });

  it('REP-1: удалённые целиком файлы перечислены с путями (не только счётчик)', () => {
    const log: ChangelogEntry[] = [
      { file: 'js/metric.js', type: 'METRIC_FILE', description: 'metric-сигнатура' },
      { file: 'js/packed.js', type: 'OBFUSCATED_JS', description: 'обфускация (_0x / packer)' },
      { file: 'js/unused.js', type: 'DEAD_JS_FILE', description: '0% coverage' },
    ];
    const md = renderReport(baseStats({ metricFilesRemoved: 1, obfuscatedFilesRemoved: 1, deadJsFilesRemoved: 1 }), log, []);
    expect(md).toContain('Удалённые файлы');
    expect(md).toContain('js/metric.js');
    expect(md).toContain('js/packed.js');
    expect(md).toContain('js/unused.js');
    expect(md).toContain('_backup');
  });

  it('список предупреждений обрезается на 100 с пометкой «…и ещё N» (REP-2)', () => {
    const log: ChangelogEntry[] = Array.from({ length: 130 }, (_, i) => ({
      file: `f${i}.js`,
      type: 'JS предупреждение',
      description: `warn ${i}`,
    }));
    const md = renderReport(baseStats({ detectorWarnings: 130 }), log, []);
    expect(md).toContain('130 шт.');
    expect(md).toContain('…и ещё 30');
  });
});
