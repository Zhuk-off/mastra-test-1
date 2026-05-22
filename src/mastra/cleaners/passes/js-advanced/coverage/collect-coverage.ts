import * as http from 'node:http';
import * as path from 'node:path';
import * as fs from 'node:fs';
import { chromium, type Browser, type Page } from 'playwright';

export interface ScriptCoverage {
  /** URL скрипта как на странице (абсолютный или относительный) */
  url: string;
  /** Относительный путь к файлу в siteDir (или null если inline) */
  relPath: string | null;
  /** Количество символов в файле */
  totalChars: number;
  /** Количество символов в выполненных диапазонах */
  coveredChars: number;
  /** Процент покрытия (0–100) */
  percent: number;
}

/** Поднимает статический HTTP-сервер на случайном порту */
async function serveDir(siteDir: string): Promise<{ url: string; close: () => void }> {
  const server = http.createServer((req, res) => {
    const safePath = path.join(siteDir, decodeURIComponent(req.url!.split('?')[0]!));
    if (!safePath.startsWith(siteDir)) { res.writeHead(403); res.end(); return; }
    const file = fs.existsSync(safePath) && fs.statSync(safePath).isFile()
      ? safePath
      : path.join(siteDir, 'index.html'); // fallback
    const content = fs.readFileSync(file);
    const ext = path.extname(file).toLowerCase();
    const mime: Record<string, string> = { '.js': 'application/javascript', '.html': 'text/html', '.css': 'text/css' };
    res.writeHead(200, { 'Content-Type': mime[ext] ?? 'application/octet-stream' });
    res.end(content);
  });
  return new Promise(resolve => {
    server.listen(0, '127.0.0.1', () => {
      const port = (server.address() as { port: number }).port;
      resolve({ url: `http://127.0.0.1:${port}`, close: () => server.close() });
    });
  });
}

/** Вычисляет покрытые символы из V8-формата coverage (Playwright 1.x) */
function calcCoveredChars(
  functions: Array<{ ranges: Array<{ count: number; startOffset: number; endOffset: number }> }>,
): number {
  const executed: Array<{ start: number; end: number }> = [];
  for (const fn of functions) {
    for (const range of fn.ranges) {
      if (range.count > 0) {
        executed.push({ start: range.startOffset, end: range.endOffset });
      }
    }
  }
  if (executed.length === 0) return 0;

  executed.sort((a, b) => a.start - b.start);
  let covered = 0;
  let curStart = executed[0]!.start;
  let curEnd = executed[0]!.end;
  for (let i = 1; i < executed.length; i++) {
    const r = executed[i]!;
    if (r.start <= curEnd) {
      curEnd = Math.max(curEnd, r.end);
    } else {
      covered += curEnd - curStart;
      curStart = r.start;
      curEnd = r.end;
    }
  }
  covered += curEnd - curStart;
  return covered;
}

export async function collectCoverage(siteDir: string): Promise<ScriptCoverage[]> {
  const { url: baseUrl, close } = await serveDir(siteDir);
  let browser: Browser | null = null;
  let page: Page | null = null;

  try {
    browser = await chromium.launch({ headless: true });
    page = await browser.newPage();

    // Блокируем внешние запросы — нас интересует только локальный код
    await page.route('**/*', (route) => {
      const url = route.request().url();
      if (url.startsWith(baseUrl)) return route.continue();
      return route.abort(); // блокировать внешние
    });

    await page.coverage.startJSCoverage({ resetOnNavigation: false });

    await page.goto(baseUrl, { waitUntil: 'networkidle', timeout: 30000 });

    // Автоскролл до конца страницы (триггер lazy-load)
    await page.evaluate(() => {
      return new Promise<void>(resolve => {
        let totalHeight = 0;
        const distance = 300;
        const timer = setInterval(() => {
          window.scrollBy(0, distance);
          totalHeight += distance;
          if (totalHeight >= document.body.scrollHeight) {
            clearInterval(timer);
            resolve();
          }
        }, 100);
      });
    });

    // Кликаем по интерактивным элементам в режиме preventDefault
    const clickables = await page.$$('button, [role="button"], .btn, .cta');
    for (const el of clickables.slice(0, 5)) { // не более 5 кликов
      try {
        await el.dispatchEvent('click');
      } catch { /* ignore */ }
    }

    await page.waitForTimeout(1000);

    const rawCoverage = await page.coverage.stopJSCoverage();

    return rawCoverage.map(entry => {
      const totalChars = entry.source?.length ?? 0;
      const coveredChars = calcCoveredChars(entry.functions);
      const percent = totalChars > 0 ? (coveredChars / totalChars) * 100 : 0;

      // Определяем relPath: убираем baseUrl из URL
      const relPath = entry.url.startsWith(baseUrl)
        ? decodeURIComponent(entry.url.slice(baseUrl.length + 1))
        : null;

      return { url: entry.url, relPath, totalChars, coveredChars, percent };
    });
  } finally {
    await page?.close().catch(() => {});
    await browser?.close().catch(() => {});
    close();
  }
}
