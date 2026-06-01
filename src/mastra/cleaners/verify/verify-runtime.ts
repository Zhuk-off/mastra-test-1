/**
 * Рантайм-проверка очищенного лендинга: поднимает локальный сервер, открывает
 * страницу в headless Chromium, и ЛОВИТ ПОПЫТКИ запросов на ЧУЖИЕ домены
 * (phone home) + ошибки консоли. Запрос на доверенный CDN (например, репиннутый
 * code.jquery.com) — ожидаем, не алармим. Запрос на хост вне белого списка — аларм.
 */
import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { join, resolve, extname } from 'node:path';
import type { AddressInfo } from 'node:net';
import { extractHostname, hostMatches } from '../utils/url.js';
import { ALL_TRUSTED_HOSTS } from '../registry/policy.js';

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8', '.htm': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.js': 'application/javascript; charset=utf-8',
  '.mjs': 'application/javascript; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp',
  '.gif': 'image/gif', '.svg': 'image/svg+xml', '.ico': 'image/x-icon',
  '.woff': 'font/woff', '.woff2': 'font/woff2', '.ttf': 'font/ttf', '.otf': 'font/otf',
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
      res.writeHead(200, { 'Content-Type': MIME[extname(filePath).toLowerCase()] ?? 'application/octet-stream' });
      res.end(data);
    } catch {
      res.writeHead(404);
      res.end('Not found');
    }
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  return { port: (server.address() as AddressInfo).port, close: () => new Promise<void>((r) => server.close(() => r())) };
}

function isTrustedHost(host: string): boolean {
  for (const t of ALL_TRUSTED_HOSTS) if (hostMatches(host, t)) return true;
  return false;
}

export interface VerifyResult {
  pageUrl: string;
  consoleErrors: string[];
  failedRequests: string[];
  /** Все внешние запросы (не localhost) — host + url. */
  externalRequests: string[];
  /** ЧУЖИЕ запросы: внешние И хост вне белого списка — это аларм «звонит на сторону». */
  foreignRequests: string[];
  screenshotPath: string;
  /** ok = нет чужих запросов и нет JS-ошибок страницы. */
  ok: boolean;
}

export async function verifySiteRuntime(
  siteDir: string,
  pagePath = 'index.html',
  screenshotName = '_verify-screenshot.png',
): Promise<VerifyResult> {
  const { port, close } = await startServer(siteDir);
  const pageUrl = `http://127.0.0.1:${port}/${pagePath}`;

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await context.newPage();

  const consoleErrors: string[] = [];
  const failedRequests: string[] = [];
  const externalRequests = new Set<string>();
  const foreignRequests = new Set<string>();
  let pageErrored = false;

  page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(m.text()); });
  page.on('pageerror', (e) => { consoleErrors.push(`[pageerror] ${e.message}`); pageErrored = true; });
  page.on('requestfailed', (r) => failedRequests.push(`${r.failure()?.errorText ?? ''} ${r.url()}`.trim()));
  page.on('request', (req) => {
    const u = req.url();
    if (/^(https?:\/\/127\.0\.0\.1|data:|blob:|about:)/.test(u)) return;
    externalRequests.add(u);
    const host = extractHostname(u);
    if (host && !isTrustedHost(host)) foreignRequests.add(`${host}  ${u.slice(0, 140)}`);
  });

  try {
    await page.goto(pageUrl, { waitUntil: 'networkidle', timeout: 30_000 });
  } catch {
    // networkidle не дождались — продолжаем
  }

  // Скролл, чтобы триггернуть lazy-load
  await page.evaluate(async () => {
    await new Promise<void>((res) => {
      let y = 0;
      const id = setInterval(() => {
        window.scrollBy(0, 500);
        y += 500;
        if (y >= document.documentElement.scrollHeight) { clearInterval(id); window.scrollTo(0, 0); res(); }
      }, 80);
    });
  }).catch(() => undefined);
  await page.waitForLoadState('networkidle', { timeout: 8_000 }).catch(() => undefined);

  const screenshotPath = resolve(siteDir, screenshotName);
  await page.screenshot({ path: screenshotPath, fullPage: true }).catch(() => undefined);

  await context.close();
  await browser.close();
  await close();

  const foreign = [...foreignRequests];
  return {
    pageUrl,
    consoleErrors,
    failedRequests,
    externalRequests: [...externalRequests],
    foreignRequests: foreign,
    screenshotPath,
    ok: foreign.length === 0 && !pageErrored,
  };
}
