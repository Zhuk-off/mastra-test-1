import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import { resolve } from 'node:path';
import { verifySiteRuntime } from '../cleaners/verify/verify-runtime.js';

export const verifySiteTool = createTool({
  id: 'verify-site',
  description:
    'Рантайм-проверка очищенного лендинга в headless-браузере. Проверяет ГЛАВНОЕ: ' +
    'не «звонит» ли страница на ЧУЖИЕ домены (foreignRequests — запросы на хосты вне белого списка), ' +
    'есть ли ошибки консоли (часто = сломанный JS), и делает скриншот. Запросы на доверенные CDN ' +
    '(например, репиннутый code.jquery.com) — ожидаемы и не алармят. Запускать ПОСЛЕ clean-site. ' +
    'Если ok=false — НЕ выгружать лендинг, показать foreignRequests пользователю.',
  inputSchema: z.object({
    siteDir: z.string().describe('Путь к очищенной папке лендинга'),
    pagePath: z.string().optional().default('index.html').describe('Страница относительно корня (по умолчанию index.html)'),
  }),
  outputSchema: z.object({
    ok: z.boolean(),
    verdict: z.string(),
    pageUrl: z.string(),
    foreignRequests: z.array(z.string()),
    foreignRequestCount: z.number(),
    externalRequestCount: z.number(),
    consoleErrors: z.array(z.string()),
    consoleErrorCount: z.number(),
    failedRequestCount: z.number(),
    screenshotPath: z.string(),
    /** Найден квиз/интерактив — нужна РУЧНАЯ перепроверка прокликивания. */
    hasQuiz: z.boolean(),
  }),
  execute: async ({ siteDir, pagePath }) => {
    const dir = resolve(siteDir);
    const res = await verifySiteRuntime(dir, pagePath ?? 'index.html');

    const parts: string[] = [];
    parts.push(
      res.foreignRequests.length === 0
        ? '✅ запросов на чужие домены НЕТ'
        : `🚨 ${res.foreignRequests.length} запрос(ов) на ЧУЖИЕ домены`,
    );
    if (res.consoleErrors.length) parts.push(`${res.consoleErrors.length} ошибок консоли`);
    if (res.failedRequests.length) parts.push(`${res.failedRequests.length} неуспешных запросов`);
    if (res.hasQuiz) parts.push('⚠️ есть квиз/интерактив — перепроверьте прокликивание вручную');

    return {
      ok: res.ok,
      verdict: parts.join('; '),
      pageUrl: res.pageUrl,
      foreignRequests: res.foreignRequests,
      foreignRequestCount: res.foreignRequests.length,
      externalRequestCount: res.externalRequests.length,
      consoleErrors: res.consoleErrors.slice(0, 30),
      consoleErrorCount: res.consoleErrors.length,
      failedRequestCount: res.failedRequests.length,
      screenshotPath: res.screenshotPath,
      hasQuiz: res.hasQuiz,
    };
  },
});
