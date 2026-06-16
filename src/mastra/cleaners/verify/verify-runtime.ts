/**
 * Рантайм-проверка очищенного лендинга: поднимает локальный сервер, открывает
 * страницу в headless Chromium, и ЛОВИТ ПОПЫТКИ запросов на ЧУЖИЕ домены
 * (phone home) + ошибки консоли. Запрос на доверенный CDN (например, репиннутый
 * code.jquery.com) — ожидаем, не алармим. Запрос на хост вне белого списка — аларм.
 *
 * Два уровня:
 *  - verifySiteRuntime() — ОДНА страница в ОДНОМ профиле (низкий уровень).
 *  - verifySite() — ОРКЕСТРАТОР: все страницы лендинга × профили (десктоп + мобайл),
 *    плюс визуальный diff очищенной версии против оригинала (_backup). Это основной вход.
 */
import { chromium, devices, type Page, type BrowserContextOptions } from 'playwright';
import { createServer } from 'node:http';
import { readFile, readdir, stat } from 'node:fs/promises';
import { join, resolve, extname } from 'node:path';
import type { AddressInfo } from 'node:net';
import { extractHostname, hostMatches } from '../utils/url.js';
import { ALL_TRUSTED_HOSTS } from '../registry/policy.js';
import { takeScreenshot, verifyVisualDiff } from '../passes/js-advanced/verify-visual.js';

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

async function pathExists(p: string): Promise<boolean> {
  return stat(p).then(() => true).catch(() => false);
}

function sanitizeName(s: string): string {
  return s.replace(/[^\w.-]+/g, '_').replace(/^_+|_+$/g, '') || 'page';
}

// ─────────────────────────────────────────────────────────────────────────────
// Профили устройств
// ─────────────────────────────────────────────────────────────────────────────

export interface VerifyProfile {
  name: string;
  context: BrowserContextOptions;
}

export const DESKTOP_PROFILE: VerifyProfile = {
  name: 'desktop',
  context: { viewport: { width: 1280, height: 900 } },
};

const iphone = devices['iPhone 13'];
/** VR/мобайл: арбитражный трафик в основном мобильный — cloaking/редирект часто только под мобайл. */
export const MOBILE_PROFILE: VerifyProfile = {
  name: 'mobile',
  context: {
    viewport: iphone.viewport,
    userAgent: iphone.userAgent,
    deviceScaleFactor: iphone.deviceScaleFactor,
    isMobile: iphone.isMobile,
    hasTouch: iphone.hasTouch,
  },
};

export const DEFAULT_PROFILES: VerifyProfile[] = [DESKTOP_PROFILE, MOBILE_PROFILE];

export interface VerifyResult {
  pageUrl: string;
  /** Имя профиля устройства (desktop/mobile). */
  profile: string;
  consoleErrors: string[];
  failedRequests: string[];
  /** Все внешние запросы (не localhost) — host + url. */
  externalRequests: string[];
  /** ЧУЖИЕ запросы: внешние И хост вне белого списка — это аларм «звонит на сторону». */
  foreignRequests: string[];
  screenshotPath: string;
  /** Найден ли квиз/много кнопок — нужна РУЧНАЯ перепроверка интерактива. */
  hasQuiz: boolean;
  /** Загрузилась ли страница (HTTP < 400 + есть видимый контент). false → ok недостоверен. */
  loaded: boolean;
  /** HTTP-статус главного документа (0, если навигация упала). */
  httpStatus: number;
  /** ok = страница ЗАГРУЗИЛАСЬ И нет чужих запросов И нет JS-ошибок (после прокликивания). */
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
  opts: { profile?: VerifyProfile; screenshotName?: string } = {},
): Promise<VerifyResult> {
  const profile = opts.profile ?? DESKTOP_PROFILE;
  const screenshotName = opts.screenshotName ?? `_verify-${profile.name}.png`;
  const { port, close } = await startServer(siteDir);
  const pageUrl = `http://127.0.0.1:${port}/${pagePath}`;

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext(profile.context);
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

  let navOk = true;
  let httpStatus = 0;
  try {
    const resp = await page.goto(pageUrl, { waitUntil: 'domcontentloaded', timeout: 30_000 });
    httpStatus = resp?.status() ?? 0;
    if (!resp) {
      navOk = false;
      consoleErrors.push('[verify] страница не вернула ответ');
    } else if (!resp.ok()) {
      navOk = false;
      consoleErrors.push(`[verify] страница не загрузилась: HTTP ${httpStatus}`);
    }
  } catch (e) {
    // Раньше ошибка goto проглатывалась и ok мог быть true для незагрузившейся страницы
    // (ложно-зелёный verify). Теперь фиксируем провал навигации.
    navOk = false;
    consoleErrors.push(`[verify] навигация упала: ${(e as Error).message}`);
  }
  // Даём первоначальным запросам осесть (раньше это делал networkidle внутри goto).
  await page.waitForLoadState('networkidle', { timeout: 10_000 }).catch(() => undefined);

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

  // Sanity: страница реально отрисовала контент? Пустой body при «успешном» ответе — тоже провал.
  const rendered = await page
    .evaluate(() => !!document.body && (document.body.innerText || '').trim().length > 0)
    .catch(() => false);
  if (!rendered) {
    navOk = false;
    consoleErrors.push('[verify] страница пустая — нет видимого контента');
  }

  await context.close();
  await browser.close();
  await close();

  const foreign = [...foreignRequests];
  return {
    pageUrl,
    profile: profile.name,
    consoleErrors,
    failedRequests,
    externalRequests: [...externalRequests],
    foreignRequests: foreign,
    screenshotPath,
    hasQuiz: interaction.hasQuiz,
    loaded: navOk,
    httpStatus,
    ok: navOk && foreign.length === 0 && !pageErrored,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Оркестратор: все страницы × профили (+ визуальный diff против оригинала)
// ─────────────────────────────────────────────────────────────────────────────

/** Находит HTML-страницы в корне лендинга (index.html первой). */
async function discoverPages(siteDir: string): Promise<string[]> {
  const entries = await readdir(siteDir, { withFileTypes: true }).catch(() => []);
  const html = entries.filter((e) => e.isFile() && /\.html?$/i.test(e.name)).map((e) => e.name);
  if (html.length === 0) return ['index.html'];
  html.sort((a, b) => (a === 'index.html' ? -1 : b === 'index.html' ? 1 : a.localeCompare(b)));
  return html;
}

/**
 * Визуальный diff очищенной страницы против оригинала (_backup). Скриншоты делаются в
 * ФИКСИРОВАННОМ вьюпорте (fullPage:false) — иначе разная высота страниц ломает pixelmatch.
 * Возвращает % расхождения или null, если сравнить не удалось.
 */
async function computeVisualDiff(cleanedDir: string, baselineDir: string, page: string): Promise<number | null> {
  const c = await startServer(cleanedDir);
  const b = await startServer(baselineDir);
  try {
    const tag = sanitizeName(page);
    const afterShot = resolve(cleanedDir, `_visual-after-${tag}.png`);
    const beforeShot = resolve(cleanedDir, `_visual-before-${tag}.png`);
    const diffShot = resolve(cleanedDir, `_visual-diff-${tag}.png`);
    await takeScreenshot(`http://127.0.0.1:${b.port}/${page}`, beforeShot);
    await takeScreenshot(`http://127.0.0.1:${c.port}/${page}`, afterShot);
    const { diffPercent } = await verifyVisualDiff(beforeShot, afterShot, diffShot);
    return diffPercent;
  } catch {
    return null;
  } finally {
    await c.close();
    await b.close();
  }
}

export interface VerifyRunResult extends VerifyResult {
  page: string;
  /** % визуального расхождения с оригиналом (только для одного профиля на страницу), либо null. */
  visualDiffPercent: number | null;
}

export interface AggregateVerifyResult {
  /** ok = все прогоны загрузились, без чужих запросов и без JS-ошибок. */
  ok: boolean;
  loaded: boolean;
  pages: string[];
  profiles: string[];
  /** Объединённый список ЧУЖИХ запросов по всем страницам/профилям. */
  foreignRequests: string[];
  consoleErrorCount: number;
  failedRequestCount: number;
  hasQuiz: boolean;
  /** Максимальное визуальное расхождение с оригиналом по страницам (null, если diff не делался). */
  maxVisualDiffPercent: number | null;
  screenshotPaths: string[];
  runs: VerifyRunResult[];
}

/**
 * Основной вход проверки: прогоняет ВСЕ страницы лендинга в ДЕСКТОП + МОБАЙЛ профилях,
 * и (если рядом есть `<siteDir>_backup` от clean-site) считает визуальный diff очищенной
 * версии против оригинала. Агрегирует ok/foreign/ошибки по всем прогонам.
 */
export async function verifySite(
  siteDir: string,
  opts: { pages?: string[]; profiles?: VerifyProfile[]; baselineDir?: string } = {},
): Promise<AggregateVerifyResult> {
  const dir = resolve(siteDir);
  const pages = opts.pages?.length ? opts.pages : await discoverPages(dir);
  const profiles = opts.profiles?.length ? opts.profiles : DEFAULT_PROFILES;

  let baselineDir = opts.baselineDir;
  if (baselineDir === undefined) {
    const backup = dir.replace(/[\\/]+$/, '') + '_backup';
    if (await pathExists(backup)) baselineDir = backup;
  }

  const runs: VerifyRunResult[] = [];
  for (const page of pages) {
    // Визуальный diff считаем один раз на страницу (десктоп-вьюпорт) — привязываем к десктоп-прогону.
    const visualDiffPercent = baselineDir ? await computeVisualDiff(dir, baselineDir, page) : null;

    for (const profile of profiles) {
      const screenshotName = `_verify-${profile.name}-${sanitizeName(page)}.png`;
      const res = await verifySiteRuntime(dir, page, { profile, screenshotName });
      runs.push({
        ...res,
        page,
        visualDiffPercent: profile.name === DESKTOP_PROFILE.name ? visualDiffPercent : null,
      });
    }
  }

  const foreignRequests = [...new Set(runs.flatMap((r) => r.foreignRequests))];
  const diffs = runs.map((r) => r.visualDiffPercent).filter((v): v is number => v != null);

  return {
    ok: runs.length > 0 && runs.every((r) => r.ok),
    loaded: runs.length > 0 && runs.every((r) => r.loaded),
    pages,
    profiles: profiles.map((p) => p.name),
    foreignRequests,
    consoleErrorCount: runs.reduce((s, r) => s + r.consoleErrors.length, 0),
    failedRequestCount: runs.reduce((s, r) => s + r.failedRequests.length, 0),
    hasQuiz: runs.some((r) => r.hasQuiz),
    maxVisualDiffPercent: diffs.length ? Math.max(...diffs) : null,
    screenshotPaths: runs.map((r) => r.screenshotPath),
    runs,
  };
}
