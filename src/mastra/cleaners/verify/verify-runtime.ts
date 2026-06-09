/**
 * Рантайм-проверка очищенного лендинга: поднимает локальный сервер, открывает
 * страницу в headless Chromium, и ЛОВИТ ПОПЫТКИ запросов на ЧУЖИЕ домены
 * (phone home) + ошибки консоли. Запрос на доверенный CDN (например, репиннутый
 * code.jquery.com) — ожидаем, не алармим. Запрос на хост вне белого списка — аларм.
 */
import { chromium, type Page } from 'playwright';
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
  /** Найден ли квиз/много кнопок — нужна РУЧНАЯ перепроверка интерактива. */
  hasQuiz: boolean;
  /** ok = нет чужих запросов и нет JS-ошибок страницы (после прокликивания). */
  ok: boolean;
}

/**
 * C8/VR-1: ИНТЕРАКТИВНАЯ проверка. Пассивная загрузка не ловит phone-home/редирект,
 * который срабатывает ПО КЛИКУ (клик по офферу/квизу — главный вектор арбитража).
 * Прокликиваем кликабельные элементы (с preventDefault на навигацию/сабмит, чтобы не
 * уйти со страницы) — их JS-обработчики срабатывают, и любой запрос на чужой хост
 * ловится теми же page.on('request')-хендлерами. Возвращает, найден ли квиз.
 */
export async function autoInteract(page: Page): Promise<{ hasQuiz: boolean; clicked: number }> {
  // Не даём кликам/сабмитам реально увести со страницы (JS-редирект location.href= всё
  // равно зафиксируется как запрос на чужой хост — это и нужно).
  await page
    .evaluate(() => {
      document.addEventListener(
        'click',
        (e) => {
          const t = e.target as HTMLElement | null;
          if (t?.closest?.('a,button,[role="button"],input[type="button"],input[type="submit"],label')) {
            e.preventDefault();
          }
        },
        true,
      );
      document.addEventListener('submit', (e) => e.preventDefault(), true);
    })
    .catch(() => undefined);

  const result = await page
    .evaluate(() => {
      const sel = [
        'a[href]', 'button', '[role="button"]', '[onclick]',
        'input[type="button"]', 'input[type="submit"]',
        '.cta', '[class*="btn" i]', '[class*="quiz" i] *', '[class*="answer" i]', '[class*="option" i]',
      ].join(',');
      const els = Array.from(new Set(Array.from(document.querySelectorAll(sel)) as HTMLElement[])).slice(0, 80);
      let clicked = 0;
      for (const el of els) {
        try {
          el.click();
          clicked++;
        } catch {
          /* ignore */
        }
      }
      const hasQuiz =
        !!document.querySelector(
          '[class*="quiz" i],[id*="quiz" i],[class*="step" i],[class*="answer" i],[class*="option" i]',
        ) || document.querySelectorAll('button,[role="button"]').length >= 4;
      return { hasQuiz, clicked };
    })
    .catch(() => ({ hasQuiz: false, clicked: 0 }));

  // Подождать таймеры/сеть, спровоцированные кликами.
  await page.waitForTimeout(1500).catch(() => undefined);
  await page.waitForLoadState('networkidle', { timeout: 5_000 }).catch(() => undefined);
  return result;
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

  // C8/VR-1: после пассивной загрузки — прокликиваем, чтобы поймать phone-home по клику.
  const interaction = await autoInteract(page);

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
    hasQuiz: interaction.hasQuiz,
    ok: foreign.length === 0 && !pageErrored,
  };
}
