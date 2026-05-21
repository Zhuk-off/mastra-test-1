import { resolve, join } from 'node:path';
import { stat } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { cleanSite, createBackup } from '../src/mastra/cleaners/index.js';

function printUsageAndExit(): never {
  console.error('Usage: npm run clean -- <siteDir> [--no-backup]');
  process.exit(1);
}

async function main(): Promise<void> {
  const rawArgs = process.argv.slice(2);
  const flags = new Set(rawArgs.filter((a) => a.startsWith('--')));
  const args = rawArgs.filter((a) => !a.startsWith('--'));

  if (args.length < 1) printUsageAndExit();
  const siteDir = resolve(args[0]!);

  const s = await stat(siteDir).catch(() => null);
  if (!s || !s.isDirectory()) {
    console.error(`[clean-site] Не директория: ${siteDir}`);
    process.exit(1);
  }

  console.log(`[clean-site] Site: ${siteDir}`);

  if (!flags.has('--no-backup')) {
    const backupDir = await createBackup(siteDir);
    console.log(`[clean-site] Резервная копия: ${backupDir}`);
  }

  const start = Date.now();
  const stats = await cleanSite(siteDir);
  const seconds = ((Date.now() - start) / 1000).toFixed(1);

  console.log('');

  if (stats.normalize && stats.normalize.mainFileFound) {
    console.log('[clean-site] === Нормализация структуры ===');
    console.log(`[clean-site] Главный файл: ${stats.normalize.mainFileFound}`);
    if (stats.normalize.mainFileMoved && stats.normalize.mainFileRenamed) {
      console.log(`[clean-site] Переименован и перемещён → index.${stats.normalize.mainFileExtension}`);
    } else if (stats.normalize.mainFileMoved) {
      console.log(`[clean-site] Перемещён в корень → index.${stats.normalize.mainFileExtension}`);
    } else if (stats.normalize.mainFileRenamed) {
      console.log(`[clean-site] Переименован → index.${stats.normalize.mainFileExtension}`);
    }
    if (stats.normalize.phpStripped) {
      console.log('[clean-site] PHP-код удалён из главного файла');
    }
    console.log(`[clean-site] Файлов перемещено: ${stats.normalize.filesMoved}`);
    console.log(`[clean-site] Путей переписано:  ${stats.normalize.pathsRewritten}`);
    console.log(`[clean-site] CSS-путей переписано: ${stats.normalize.cssPathsRewritten}`);
    console.log('');
  }

  console.log(`[clean-site] Готово за ${seconds}s`);
  console.log(`[clean-site] HTML обработано:         ${stats.htmlFilesProcessed}`);
  console.log(`[clean-site] PHP обработано:          ${stats.phpFilesProcessed}`);
  console.log(`[clean-site] SVG обработано:          ${stats.svgFilesProcessed}`);
  console.log(`[clean-site] SVG элементов удалено:   ${stats.svgItemsRemoved}`);
  console.log(`[clean-site] <script src> удалено:    ${stats.scriptsRemoved}`);
  console.log(`[clean-site] inline <script> удалено: ${stats.inlineScriptsRemoved}`);
  console.log(`[clean-site] <noscript> удалено:      ${stats.noscriptsRemoved}`);
  console.log(`[clean-site] <link> удалено:          ${stats.linksRemoved}`);
  console.log(`[clean-site] <meta> удалено:          ${stats.metasRemoved}`);
  console.log(`[clean-site] meta refresh удалено:    ${stats.metaRefreshRemoved}`);
  console.log(`[clean-site] <base href> удалено:     ${stats.baseHrefRemoved}`);
  console.log(`[clean-site] <object>/<embed> удал.:  ${stats.objectEmbedsRemoved}`);
  console.log(`[clean-site] <frame> удалено:       ${stats.framesRemoved}`);
  console.log(`[clean-site] libs → CDN заменено:   ${stats.localLibsReplaced}`);
  console.log(`[clean-site] event-атрибутов удал.:   ${stats.eventAttrsRemoved}`);
  console.log(`[clean-site] JSON-LD удалено:         ${stats.jsonLdRemoved}`);
  console.log(`[clean-site] img-пиксели удалено:     ${stats.imgPixelsRemoved}`);
  console.log(`[clean-site] JS файлов просканировано: ${stats.jsFilesScanned}`);
  console.log(`[clean-site] JS элементов удалено:    ${stats.jsItemsRemoved}`);
  console.log(`[clean-site] CSS файлов просканировано:${stats.cssFilesScanned}`);
  console.log(`[clean-site] CSS элементов удалено:   ${stats.cssItemsRemoved}`);
  console.log(`[clean-site] _external/ удалено:      ${stats.externalDirsRemoved}`);
  console.log(`[clean-site] .map файлов удалено:     ${stats.sourceMapsDeleted}`);
  console.log(`[clean-site] sourceMappingURL убрано: ${stats.sourceMapRefsStripped}`);
  console.log(`[clean-site] оффер-ссылок заменено:  ${stats.offerLinksReplaced}`);
  const reduction = stats.bytesBefore - stats.bytesAfter;
  const pct = stats.bytesBefore > 0 ? Math.abs((reduction / stats.bytesBefore) * 100).toFixed(1) : '0.0';
  const sign = reduction >= 0 ? '-' : '+';
  console.log(
    `[clean-site] HTML/PHP размер: ${stats.bytesBefore} → ${stats.bytesAfter} байт (${sign}${Math.abs(reduction)}, ${sign}${pct}%)`,
  );
  if (stats.jsFilesScanned > 0 || stats.cssFilesScanned > 0) {
    console.log(`[clean-site] Лог изменений: ${join(siteDir, 'clean-site-changes.log')}`);
  }
}

const __filename = fileURLToPath(import.meta.url);
if (resolve(process.argv[1] ?? '') === resolve(__filename)) {
  main().catch((err) => {
    console.error('[clean-site] Fatal:', err);
    process.exit(1);
  });
}
