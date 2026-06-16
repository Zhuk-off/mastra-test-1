import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import { resolve } from 'node:path';
import { verifySite } from '../cleaners/verify/verify-runtime.js';

/** Порог визуального расхождения с оригиналом, выше которого просим перепроверить вручную. */
const VISUAL_DIFF_WARN = 25;

export const verifySiteTool = createTool({
  id: 'verify-site',
  description:
    'Рантайм-проверка очищенного лендинга в headless-браузере на ДЕСКТОПЕ и МОБАЙЛЕ, по ВСЕМ HTML-страницам. ' +
    'Проверяет ГЛАВНОЕ: не «звонит» ли страница на ЧУЖИЕ домены (foreignRequests — хосты вне белого списка), ' +
    'есть ли ошибки консоли (часто = сломанный JS), загрузилась ли страница, и (если рядом есть бэкап ' +
    'до очистки) насколько визуально изменилась вёрстка. Запросы на доверенные CDN (например, репиннутый ' +
    'code.jquery.com) — ожидаемы и не алармят. Запускать ПОСЛЕ clean-site. ' +
    'Если ok=false — НЕ выгружать лендинг, показать foreignRequests/проблемы пользователю.',
  inputSchema: z.object({
    siteDir: z.string().describe('Путь к очищенной папке лендинга'),
    pagePath: z
      .string()
      .optional()
      .describe('Проверить только одну страницу (по умолчанию — все HTML-страницы в корне)'),
  }),
  outputSchema: z.object({
    ok: z.boolean(),
    loaded: z.boolean(),
    verdict: z.string(),
    pages: z.array(z.string()),
    profiles: z.array(z.string()),
    foreignRequests: z.array(z.string()),
    foreignRequestCount: z.number(),
    consoleErrorCount: z.number(),
    failedRequestCount: z.number(),
    /** % визуального расхождения с оригиналом (null, если бэкапа для сравнения нет). */
    visualDiffPercent: z.number().nullable(),
    screenshotPaths: z.array(z.string()),
    /** Найден квиз/интерактив — нужна РУЧНАЯ перепроверка прокликивания. */
    hasQuiz: z.boolean(),
  }),
  execute: async ({ siteDir, pagePath }) => {
    const dir = resolve(siteDir);
    const res = await verifySite(dir, pagePath ? { pages: [pagePath] } : {});

    const parts: string[] = [];
    if (!res.loaded) parts.push('🚨 страница(ы) НЕ загрузились — проверка недостоверна');
    parts.push(
      res.foreignRequests.length === 0
        ? '✅ запросов на чужие домены НЕТ'
        : `🚨 ${res.foreignRequests.length} запрос(ов) на ЧУЖИЕ домены`,
    );
    parts.push(`страниц: ${res.pages.length}, профили: ${res.profiles.join('+')}`);
    if (res.consoleErrorCount) parts.push(`${res.consoleErrorCount} ошибок консоли`);
    if (res.maxVisualDiffPercent != null) {
      parts.push(
        `визуальное расхождение с оригиналом до ${res.maxVisualDiffPercent.toFixed(1)}%` +
          (res.maxVisualDiffPercent > VISUAL_DIFF_WARN ? ' ⚠️ проверьте вёрстку вручную' : ''),
      );
    }
    if (res.hasQuiz) parts.push('⚠️ есть квиз/интерактив — перепроверьте прокликивание вручную');

    return {
      ok: res.ok,
      loaded: res.loaded,
      verdict: parts.join('; '),
      pages: res.pages,
      profiles: res.profiles,
      foreignRequests: res.foreignRequests,
      foreignRequestCount: res.foreignRequests.length,
      consoleErrorCount: res.consoleErrorCount,
      failedRequestCount: res.failedRequestCount,
      visualDiffPercent: res.maxVisualDiffPercent,
      screenshotPaths: res.screenshotPaths,
      hasQuiz: res.hasQuiz,
    };
  },
});
