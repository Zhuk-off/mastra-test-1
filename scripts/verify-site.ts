/**
 * Локальная проверка скачанного сайта:
 *   1. Поднимает простой HTTP-сервер на содержимом папки
 *   2. Открывает указанный путь в headless Chromium
 *   3. Делает скриншот и собирает console errors / failed requests
 *
 * Запуск:
 *   npm run verify -- ./downloads/test1 lander/erectobust-free/index.html
 */

import { chromium, type ConsoleMessage } from 'playwright';
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { join, resolve, extname } from 'node:path';
import { AddressInfo } from 'node:net';
import { autoInteract } from '../src/mastra/cleaners/verify/verify-runtime.js';

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.htm': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.mjs': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.otf': 'font/otf',
};

async function startServer(rootDir: string): Promise<{ port: number; close: () => Promise<void> }> {
  const root = resolve(rootDir);
  const server = createServer(async (req, res) => {
    try {
      const urlPath = decodeURIComponent((req.url ?? '/').split('?')[0]!);
      let filePath = join(root, urlPath);
      const s = await stat(filePath).catch(() => null);
      if (s?.isDirectory()) filePath = join(filePath, 'index.html');
      const data = await readFile(filePath);
      const ext = extname(filePath).toLowerCase();
      res.writeHead(200, { 'Content-Type': MIME[ext] ?? 'application/octet-stream' });
      res.end(data);
    } catch {
      res.writeHead(404);
      res.end('Not found');
    }
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const port = (server.address() as AddressInfo).port;
  return {
    port,
    close: () => new Promise<void>((r) => server.close(() => r())),
  };
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  if (args.length < 1) {
    console.error('Usage: npm run verify -- <siteDir> [pagePath]');
    process.exit(1);
  }
  const siteDir = args[0]!;
  const pagePath = args[1] ?? 'index.html';

  const { port, close } = await startServer(siteDir);
  const url = `http://127.0.0.1:${port}/${pagePath}`;
  console.log(`[verify] Сервер: http://127.0.0.1:${port}`);
  console.log(`[verify] Открываем: ${url}`);

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();

  const consoleErrors: string[] = [];
  const failedRequests: string[] = [];

  page.on('console', (msg: ConsoleMessage) => {
    if (msg.type() === 'error') consoleErrors.push(msg.text());
  });
  page.on('pageerror', (err) => consoleErrors.push(`[pageerror] ${err.message}`));
  page.on('requestfailed', (req) =>
    failedRequests.push(`${req.failure()?.errorText} ${req.url()}`),
  );
  const externalRequests: string[] = [];
  page.on('response', (res) => {
    if (res.status() >= 400) failedRequests.push(`HTTP ${res.status()} ${res.url()}`);
    const u = res.url();
    if (!u.startsWith('http://127.0.0.1')) externalRequests.push(`[${res.status()}] ${u}`);
  });

  try {
    await page.goto(url, { waitUntil: 'networkidle', timeout: 30_000 });
  } catch (err) {
    console.warn(`[verify] networkidle не дождались: ${(err as Error).message}`);
  }

  // Скролл, чтобы триггернуть lazy-load и увидеть полную страницу
  await page.evaluate(async () => {
    await new Promise<void>((res) => {
      let y = 0;
      const id = setInterval(() => {
        window.scrollBy(0, 400);
        y += 400;
        if (y >= document.documentElement.scrollHeight) {
          clearInterval(id);
          window.scrollTo(0, 0);
          res();
        }
      }, 100);
    });
  });
  await page.waitForLoadState('networkidle', { timeout: 10_000 }).catch(() => undefined);

  const screenshotPath = resolve(siteDir, '_verify-screenshot.png');
  await page.screenshot({ path: screenshotPath, fullPage: true });
  console.log(`[verify] Скриншот: ${screenshotPath}`);

  // C8/VR-1: прокликиваем интерактив — ловим phone-home/редирект по клику (внешние запросы ниже).
  const { hasQuiz, clicked } = await autoInteract(page);

  await context.close();
  await browser.close();
  await close();

  console.log('');
  console.log(`[verify] Console errors:    ${consoleErrors.length}`);
  consoleErrors.slice(0, 20).forEach((e) => console.log(`  - ${e}`));
  console.log(`[verify] Failed requests:   ${failedRequests.length}`);
  failedRequests.slice(0, 20).forEach((e) => console.log(`  - ${e}`));
  console.log(`[verify] External requests: ${externalRequests.length}`);
  externalRequests.slice(0, 30).forEach((e) => console.log(`  - ${e}`));
  console.log(`[verify] Кликов по интерактиву: ${clicked}`);
  if (hasQuiz) {
    console.log('[verify] ⚠️  Лендинг содержит квиз/интерактив — ПЕРЕПРОВЕРЬТЕ прокликивание ВРУЧНУЮ.');
  }
}

main().catch((err) => {
  console.error('[verify] Fatal:', err);
  process.exit(1);
});
