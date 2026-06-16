/**
 * Локальная проверка очищенного лендинга (CLI). Тонкая обёртка над verifySite():
 * прогоняет ВСЕ HTML-страницы в ДЕСКТОП + МОБАЙЛ профилях, ловит запросы на ЧУЖИЕ домены
 * (через тот же белый список, что и инструмент агента), и — если рядом есть `<dir>_backup`
 * от clean-site — считает визуальное расхождение очищенной версии с оригиналом.
 *
 * Запуск:
 *   npm run verify -- ./downloads/test1            (все страницы)
 *   npm run verify -- ./downloads/test1 index.html (одна страница)
 */
import { resolve } from 'node:path';
import { verifySite } from '../src/mastra/cleaners/verify/verify-runtime.js';

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  if (args.length < 1) {
    console.error('Usage: npm run verify -- <siteDir> [pagePath]');
    process.exit(1);
  }
  const siteDir = resolve(args[0]!);
  const pages = args[1] ? [args[1]] : undefined;

  console.log(`[verify] Проверяю: ${siteDir}`);
  const res = await verifySite(siteDir, pages ? { pages } : {});

  console.log(`[verify] Страницы (${res.pages.length}): ${res.pages.join(', ')}`);
  console.log(`[verify] Профили: ${res.profiles.join(', ')}`);
  console.log(`[verify] Загрузились: ${res.loaded ? 'да' : 'НЕТ'}`);
  console.log(`[verify] Чужие домены: ${res.foreignRequests.length}`);
  res.foreignRequests.slice(0, 30).forEach((f) => console.log(`  🚨 ${f}`));
  console.log(`[verify] Ошибок консоли: ${res.consoleErrorCount}`);
  console.log(`[verify] Неуспешных запросов: ${res.failedRequestCount}`);
  if (res.maxVisualDiffPercent != null) {
    console.log(`[verify] Визуальное расхождение с оригиналом: до ${res.maxVisualDiffPercent.toFixed(1)}%`);
  }
  if (res.hasQuiz) {
    console.log('[verify] ⚠️  Есть квиз/интерактив — ПЕРЕПРОВЕРЬТЕ прокликивание ВРУЧНУЮ.');
  }
  console.log(`[verify] Скриншоты: ${res.screenshotPaths.join(', ')}`);
  console.log(res.ok ? '[verify] ✅ OK' : '[verify] ❌ НЕ OK — см. проблемы выше');

  process.exit(res.ok ? 0 : 1);
}

main().catch((err) => {
  console.error('[verify] Fatal:', err);
  process.exit(1);
});
