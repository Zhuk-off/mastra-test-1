/**
 * Скачивание лендинга в self-contained-вид. Воспроизводит и расширяет
 * поведение Chrome DevTools плагина "Save All Resources".
 *
 * Запуск:
 *   npm run download -- <url> [outputDir]
 *
 * Три фазы:
 *   Phase 1. Playwright перехватывает все сетевые ответы при загрузке страницы.
 *            Сохраняет HTML/CSS/JS/картинки/шрифты в структуру папок по URL pathname.
 *            Финальный HTML пишется из page.content() (пост-JS DOM).
 *   Phase 2. Сканирует скачанные HTML и CSS на упоминания URL ассетов,
 *            докачивает те, которые не загрузил браузер (lazy-load под условие,
 *            крупные media, ссылки в CSS под @media и т.д.). Через прямой fetch.
 *   Phase 3. Переписывает абсолютные URL (https://домен/...) и protocol-relative
 *            (//домен/...) на относительные пути в HTML и CSS — делает сайт
 *            переносимым и работоспособным локально / на любом хосте.
 */

import { chromium, type Response } from 'playwright';
import { mkdir, readFile, readdir, stat, writeFile } from 'node:fs/promises';
import { dirname, extname, join, relative, resolve, posix } from 'node:path';
import { URL, fileURLToPath } from 'node:url';

interface DownloadOptions {
  url: string;
  outputDir: string;
  headless?: boolean;
  userAgent?: string;
  viewport?: { width: number; height: number };
  sameDomainOnly?: boolean;
  timeout?: number;
}

export interface DownloadStats {
  saved: number;
  skipped: number;
  failed: number;
  byType: Record<string, number>;
}

interface Phase1Result {
  stats: DownloadStats;
  /** filePath (relative to outputDir) -> originalUrl */
  fileToUrl: Map<string, string>;
  seenUrls: Set<string>;
  mainHost: string;
  finalUrl: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// Утилиты
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Преобразует URL ресурса в относительный путь для записи на диск.
 * Файлы основного хоста кладём в корень outputDir; сторонние — в _external/<host>/...
 */
function urlToFilePath(resourceUrl: string, mainHost: string): string | null {
  let parsed: URL;
  try {
    parsed = new URL(resourceUrl);
  } catch {
    return null;
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null;

  const host = parsed.hostname;
  let pathname: string;
  try {
    pathname = decodeURIComponent(parsed.pathname);
  } catch {
    pathname = parsed.pathname;
  }

  if (pathname.endsWith('/') || pathname === '') {
    pathname += 'index.html';
  }
  const lastSegment = pathname.split('/').pop() ?? '';
  if (!lastSegment.includes('.')) {
    pathname += '/index.html';
  }

  const safeSegments = pathname
    .split('/')
    .filter((seg) => seg !== '' && seg !== '.' && seg !== '..');

  if (host === mainHost) {
    return safeSegments.join('/');
  }
  return posix.join('_external', host, ...safeSegments);
}

function categorize(resourceType: string): string {
  switch (resourceType) {
    case 'document':
      return 'html';
    case 'stylesheet':
      return 'css';
    case 'script':
      return 'js';
    case 'image':
      return 'image';
    case 'font':
      return 'font';
    case 'media':
      return 'media';
    case 'fetch':
    case 'xhr':
      return 'data';
    default:
      return resourceType || 'other';
  }
}

function categorizeByExt(filePath: string): string {
  const ext = extname(filePath).toLowerCase();
  if (['.html', '.htm'].includes(ext)) return 'html';
  if (ext === '.css') return 'css';
  if (['.js', '.mjs'].includes(ext)) return 'js';
  if (['.png', '.jpg', '.jpeg', '.webp', '.gif', '.svg', '.ico', '.avif'].includes(ext))
    return 'image';
  if (['.woff', '.woff2', '.ttf', '.otf', '.eot'].includes(ext)) return 'font';
  if (['.mp4', '.webm', '.ogg', '.mp3', '.wav'].includes(ext)) return 'media';
  return 'other';
}

// ─────────────────────────────────────────────────────────────────────────────
// Phase 1 — Playwright
// ─────────────────────────────────────────────────────────────────────────────

async function autoScroll(page: import('playwright').Page): Promise<void> {
  await page.evaluate(async () => {
    await new Promise<void>((res) => {
      let totalHeight = 0;
      const distance = 400;
      const interval = setInterval(() => {
        const { scrollHeight } = document.documentElement;
        window.scrollBy(0, distance);
        totalHeight += distance;
        if (totalHeight >= scrollHeight) {
          clearInterval(interval);
          window.scrollTo(0, 0);
          res();
        }
      }, 200);
    });
  });
}

async function phase1Browser(options: DownloadOptions): Promise<Phase1Result> {
  const {
    url,
    outputDir,
    headless = true,
    userAgent = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
      '(KHTML, like Gecko) Chrome/147.0.0.0 Safari/537.36',
    viewport = { width: 1440, height: 900 },
    sameDomainOnly = false,
    timeout = 60_000,
  } = options;

  const mainHost = new URL(url).hostname;
  const absoluteOutputDir = resolve(outputDir);
  await mkdir(absoluteOutputDir, { recursive: true });

  const stats: DownloadStats = { saved: 0, skipped: 0, failed: 0, byType: {} };
  const seenUrls = new Set<string>();
  const fileToUrl = new Map<string, string>();
  const writePromises: Promise<void>[] = [];

  console.log('[phase1] Запуск Chromium...');
  const browser = await chromium.launch({ headless });
  const context = await browser.newContext({ userAgent, viewport, acceptDownloads: false });
  const page = await context.newPage();

  const handleResponse = async (response: Response): Promise<void> => {
    const reqUrl = response.url();
    if (seenUrls.has(reqUrl)) return;
    seenUrls.add(reqUrl);

    if (response.status() < 200 || response.status() >= 400) {
      stats.skipped++;
      return;
    }

    const filePath = urlToFilePath(reqUrl, mainHost);
    if (!filePath) {
      stats.skipped++;
      return;
    }
    if (sameDomainOnly && new URL(reqUrl).hostname !== mainHost) {
      stats.skipped++;
      return;
    }

    const resourceType = response.request().resourceType();
    const category = categorize(resourceType);

    try {
      const body = await response.body();
      const fullPath = join(absoluteOutputDir, filePath);
      await mkdir(dirname(fullPath), { recursive: true });
      await writeFile(fullPath, body);
      stats.saved++;
      stats.byType[category] = (stats.byType[category] ?? 0) + 1;
      fileToUrl.set(filePath, reqUrl);
    } catch (err) {
      stats.failed++;
      console.warn(`[phase1] FAIL ${reqUrl}: ${(err as Error).message}`);
    }
  };

  page.on('response', (response) => {
    writePromises.push(handleResponse(response));
  });

  try {
    await page.goto(url, { waitUntil: 'networkidle', timeout });
  } catch (err) {
    console.warn(`[phase1] networkidle не дождались (${(err as Error).message})`);
  }

  console.log('[phase1] Авто-скролл для триггера lazy-load...');
  try {
    await autoScroll(page);
    await page.waitForLoadState('networkidle', { timeout: 15_000 }).catch(() => undefined);
  } catch (err) {
    console.warn(`[phase1] Скролл упал: ${(err as Error).message}`);
  }

  let finalUrl = url;
  console.log('[phase1] Сохранение финального HTML (после JS-рендера)...');
  try {
    const finalHtml = await page.content();
    finalUrl = page.url();
    const htmlRelPath = urlToFilePath(finalUrl, mainHost) ?? 'index.html';
    const htmlAbsPath = join(absoluteOutputDir, htmlRelPath);
    await mkdir(dirname(htmlAbsPath), { recursive: true });
    await writeFile(htmlAbsPath, finalHtml, 'utf8');
    fileToUrl.set(htmlRelPath, finalUrl);
    console.log(`[phase1] HTML записан: ${htmlRelPath}`);
  } catch (err) {
    console.warn(`[phase1] Не удалось сохранить финальный HTML: ${(err as Error).message}`);
  }

  await Promise.allSettled(writePromises);
  await context.close();
  await browser.close();

  return { stats, fileToUrl, seenUrls, mainHost, finalUrl };
}

// ─────────────────────────────────────────────────────────────────────────────
// Phase 2 — Докачка недостающих ассетов через прямой fetch
// ─────────────────────────────────────────────────────────────────────────────

/** URL'ы в CSS: url(...), @import "..." */
const CSS_URL_RE = /url\(\s*(['"]?)([^'")]+)\1\s*\)/gi;
const CSS_IMPORT_RE = /@import\s+(?:url\(\s*)?['"]([^'"]+)['"]/gi;

/**
 * HTML: ловим asset-теги — внутри них извлекаем URL атрибуты.
 * НЕ ловим <a href> (навигация), <form action>, <meta content>, JS-строки.
 */
const HTML_ASSET_TAG_RE =
  /<(link|script|img|source|video|audio|iframe|embed|object|track|input|use)\b([^>]*?)\/?>/gi;

/** Простые URL-атрибуты внутри asset-тега (одно значение). */
const HTML_URL_ATTR_RE =
  /\b(href|src|data-src|data-original|data-lazy|data-bg|data-background|data-image|poster|xlink:href)\s*=\s*(['"])([^'"]+)\2/gi;

/** srcset-атрибуты — список URL через запятую. */
const HTML_SRCSET_ATTR_RE =
  /\b(srcset|data-srcset|imagesrcset)\s*=\s*(['"])([^'"]+)\2/gi;

/** Допустимые расширения для Phase 2 (реальные ассеты). */
const ASSET_EXTENSIONS = new Set([
  '.css', '.js', '.mjs',
  '.png', '.jpg', '.jpeg', '.webp', '.gif', '.svg', '.ico', '.avif', '.bmp',
  '.woff', '.woff2', '.ttf', '.otf', '.eot',
  '.mp4', '.webm', '.ogg', '.mp3', '.wav', '.m4a',
  '.json', '.xml', '.txt',
]);

function extractUrlsFromCss(content: string): string[] {
  const out: string[] = [];
  for (const m of content.matchAll(CSS_URL_RE)) {
    const u = m[2]?.trim();
    if (u && !u.startsWith('data:')) out.push(u);
  }
  for (const m of content.matchAll(CSS_IMPORT_RE)) {
    const u = m[1]?.trim();
    if (u && !u.startsWith('data:')) out.push(u);
  }
  return out;
}

function isSkippableUrl(u: string): boolean {
  return (
    !u ||
    u.startsWith('data:') ||
    u.startsWith('javascript:') ||
    u.startsWith('#') ||
    u.startsWith('mailto:') ||
    u.startsWith('tel:') ||
    u.startsWith('blob:')
  );
}

function extractUrlsFromHtml(content: string): string[] {
  const out: string[] = [];
  for (const tagMatch of content.matchAll(HTML_ASSET_TAG_RE)) {
    const attrs = tagMatch[2] ?? '';
    for (const am of attrs.matchAll(HTML_URL_ATTR_RE)) {
      const u = am[3]?.trim();
      if (u && !isSkippableUrl(u)) out.push(u);
    }
    for (const am of attrs.matchAll(HTML_SRCSET_ATTR_RE)) {
      const list = am[3] ?? '';
      for (const part of list.split(',')) {
        const u = part.trim().split(/\s+/)[0];
        if (u && !isSkippableUrl(u)) out.push(u);
      }
    }
  }
  // Inline-стили <style>...</style>
  for (const m of content.matchAll(/<style\b[^>]*>([\s\S]*?)<\/style>/gi)) {
    out.push(...extractUrlsFromCss(m[1] ?? ''));
  }
  // Inline style="..." атрибуты
  for (const m of content.matchAll(/\sstyle\s*=\s*(['"])([^'"]+)\1/gi)) {
    out.push(...extractUrlsFromCss(m[2] ?? ''));
  }
  return out;
}

function resolveUrl(rawUrl: string, baseUrl: string): string | null {
  try {
    return new URL(rawUrl, baseUrl).href.split('#')[0]!;
  } catch {
    return null;
  }
}

async function fileExists(p: string): Promise<boolean> {
  try {
    await stat(p);
    return true;
  } catch {
    return false;
  }
}

async function fetchBinary(
  targetUrl: string,
  referer: string,
  userAgent: string,
): Promise<Uint8Array | null> {
  try {
    const res = await fetch(targetUrl, {
      headers: {
        'User-Agent': userAgent,
        Referer: referer,
        Accept: '*/*',
      },
      redirect: 'follow',
    });
    if (!res.ok) return null;
    const buf = await res.arrayBuffer();
    return new Uint8Array(buf);
  } catch {
    return null;
  }
}

/** Параллельный обход массива с ограничением concurrency. */
async function pMap<T, R>(
  items: T[],
  concurrency: number,
  fn: (item: T, idx: number) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (true) {
      const i = next++;
      if (i >= items.length) return;
      results[i] = await fn(items[i]!, i);
    }
  });
  await Promise.all(workers);
  return results;
}

async function phase2DownloadMissing(
  result: Phase1Result,
  outputDir: string,
  options: { maxIterations?: number; sameDomainOnly?: boolean; concurrency?: number } = {},
): Promise<{ saved: number; failed: number }> {
  const { maxIterations = 2, sameDomainOnly = true, concurrency = 8 } = options;
  const absoluteOutputDir = resolve(outputDir);
  const { seenUrls, mainHost, finalUrl } = result;
  const userAgent =
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
    '(KHTML, like Gecko) Chrome/147.0.0.0 Safari/537.36';

  let totalSaved = 0;
  let totalFailed = 0;

  for (let i = 0; i < maxIterations; i++) {
    const candidates: Array<{ url: string; filePath: string }> = [];

    const snapshot = Array.from(result.fileToUrl.entries());
    for (const [filePath, originalUrl] of snapshot) {
      const cat = categorizeByExt(filePath);
      if (cat !== 'html' && cat !== 'css') continue;

      const absPath = join(absoluteOutputDir, filePath);
      let content: string;
      try {
        content = await readFile(absPath, 'utf8');
      } catch {
        continue;
      }

      const rawUrls =
        cat === 'html' ? extractUrlsFromHtml(content) : extractUrlsFromCss(content);

      for (const raw of rawUrls) {
        const abs = resolveUrl(raw, originalUrl);
        if (!abs) continue;
        if (seenUrls.has(abs)) continue;

        // Фильтр по домену: по умолчанию тянем только основной хост,
        // чтобы не качать весь CDN-интернет.
        try {
          const parsed = new URL(abs);
          if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') continue;
          if (sameDomainOnly && parsed.hostname !== mainHost) {
            seenUrls.add(abs);
            continue;
          }
        } catch {
          continue;
        }

        const target = urlToFilePath(abs, mainHost);
        if (!target) continue;

        // Фильтр по расширению — только реальные ассеты, не .html / .php / etc.
        const ext = extname(target).toLowerCase();
        if (!ASSET_EXTENSIONS.has(ext)) {
          seenUrls.add(abs);
          continue;
        }

        seenUrls.add(abs);
        candidates.push({ url: abs, filePath: target });
      }
    }

    if (candidates.length === 0) {
      if (i === 0) console.log('[phase2] Недостающих ассетов не найдено.');
      break;
    }

    console.log(`[phase2] Итерация ${i + 1}: к докачке ${candidates.length} ассетов...`);

    let iterSaved = 0;
    let iterFailed = 0;
    let processed = 0;

    const tickEvery = Math.max(10, Math.floor(candidates.length / 10));

    await pMap(candidates, concurrency, async ({ url, filePath }) => {
      processed++;
      if (processed % tickEvery === 0) {
        console.log(`[phase2]   ${processed}/${candidates.length}...`);
      }
      const absPath = join(absoluteOutputDir, filePath);
      if (await fileExists(absPath)) {
        result.fileToUrl.set(filePath, url);
        return;
      }
      const body = await fetchBinary(url, finalUrl, userAgent);
      if (!body) {
        iterFailed++;
        return;
      }
      await mkdir(dirname(absPath), { recursive: true });
      await writeFile(absPath, body);
      result.fileToUrl.set(filePath, url);
      iterSaved++;
    });

    totalSaved += iterSaved;
    totalFailed += iterFailed;
    console.log(`[phase2] Итерация ${i + 1}: скачано ${iterSaved}, не удалось ${iterFailed}`);

    if (iterSaved === 0) break;
  }

  return { saved: totalSaved, failed: totalFailed };
}

// ─────────────────────────────────────────────────────────────────────────────
// Phase 3 — Rewrite абсолютных URL на относительные
// ─────────────────────────────────────────────────────────────────────────────

interface RewriteCtx {
  /** absolute URL -> relative target file path (posix-separated) */
  urlToTarget: Map<string, string>;
  /** Реально существующие файлы в outputDir (relative posix paths). */
  existingFiles: Set<string>;
}

function buildRewriteCtx(result: Phase1Result): RewriteCtx {
  const urlToTarget = new Map<string, string>();
  for (const [filePath, originalUrl] of result.fileToUrl) {
    urlToTarget.set(originalUrl, filePath);
  }
  return { urlToTarget, existingFiles: new Set(result.fileToUrl.keys()) };
}

/**
 * Возвращает относительный путь от файла `fromFile` до целевого `toRel` (оба
 * относительно outputDir). Использует posix-разделители.
 */
function relPath(fromFile: string, toRel: string): string {
  const fromDir = posix.dirname(fromFile.replace(/\\/g, '/'));
  const rel = posix.relative(fromDir, toRel.replace(/\\/g, '/'));
  return rel.startsWith('.') ? rel : `./${rel}`;
}

/** Универсальная замена одного URL внутри строкового контента. */
function rewriteOneUrl(
  rawUrl: string,
  fromFile: string,
  baseUrl: string,
  mainHost: string,
  ctx: RewriteCtx,
): string | null {
  // Не трогаем data:, mailto:, tel:, javascript:, фрагменты, пустоту
  const trimmed = rawUrl.trim();
  if (!trimmed) return null;
  if (
    trimmed.startsWith('data:') ||
    trimmed.startsWith('mailto:') ||
    trimmed.startsWith('tel:') ||
    trimmed.startsWith('javascript:') ||
    trimmed.startsWith('#')
  ) {
    return null;
  }

  const abs = resolveUrl(trimmed, baseUrl);
  if (!abs) return null;

  // Сначала пробуем явный маппинг из ctx
  let target = ctx.urlToTarget.get(abs);
  if (!target) {
    const candidate = urlToFilePath(abs, mainHost);
    if (!candidate) return null;
    target = candidate;
  }

  // Критично: переписываем URL только если файл реально лежит на диске.
  // Иначе оставляем абсолютный URL — он хотя бы попробует загрузиться с сайта.
  if (!ctx.existingFiles.has(target)) return null;

  return relPath(fromFile, target);
}

function rewriteHtmlContent(
  content: string,
  fromFile: string,
  baseUrl: string,
  mainHost: string,
  ctx: RewriteCtx,
): string {
  // Если в HTML есть <base href="...">, используем его для резолвинга
  // относительных URL, а сам тег потом удалим.
  const baseMatch = /<base\b[^>]*\bhref\s*=\s*(['"])([^'"]+)\1[^>]*\/?>/i.exec(content);
  const effectiveBaseUrl = baseMatch
    ? resolveUrl(baseMatch[2]!, baseUrl) ?? baseUrl
    : baseUrl;

  // Переписываем URL только внутри asset-тегов (link/script/img/source/video/etc).
  // <a href>, <form action>, <meta content> — НЕ трогаем.
  content = content.replace(HTML_ASSET_TAG_RE, (whole, _tag: string, attrs: string) => {
    let newAttrs = attrs;

    // Одиночные URL-атрибуты
    newAttrs = newAttrs.replace(
      HTML_URL_ATTR_RE,
      (m: string, name: string, q: string, val: string) => {
        const nv = rewriteOneUrl(val, fromFile, effectiveBaseUrl, mainHost, ctx);
        return nv ? `${name}=${q}${nv}${q}` : m;
      },
    );

    // srcset
    newAttrs = newAttrs.replace(
      HTML_SRCSET_ATTR_RE,
      (m: string, name: string, q: string, val: string) => {
        const parts = val.split(',').map((p) => p.trim()).filter(Boolean);
        let changed = false;
        const newParts = parts.map((p) => {
          const [u, ...sizeRest] = p.split(/\s+/);
          if (!u) return p;
          const nv = rewriteOneUrl(u, fromFile, effectiveBaseUrl, mainHost, ctx);
          if (nv) {
            changed = true;
            return [nv, ...sizeRest].join(' ');
          }
          return p;
        });
        return changed ? `${name}=${q}${newParts.join(', ')}${q}` : m;
      },
    );

    return newAttrs === attrs ? whole : whole.replace(attrs, newAttrs);
  });

  // Inline <style>...</style>
  content = content.replace(/<style\b[^>]*>([\s\S]*?)<\/style>/gi, (m, css: string) => {
    const newCss = rewriteCssContent(css, fromFile, effectiveBaseUrl, mainHost, ctx);
    return m.replace(css, newCss);
  });

  // Inline style="..." атрибуты
  content = content.replace(
    /(\sstyle\s*=\s*)(['"])([^'"]+)\2/gi,
    (m: string, prefix: string, q: string, val: string) => {
      const nv = rewriteCssContent(val, fromFile, effectiveBaseUrl, mainHost, ctx);
      return nv === val ? m : `${prefix}${q}${nv}${q}`;
    },
  );

  // Inline <script>...</script> — переписываем абсолютные URL на файлы,
  // которые реально лежат на диске. Нужно для случаев, когда WordPress/Divi
  // динамически инжектит CSS/JS через JSON-escaped URL внутри JS-кода.
  content = content.replace(
    /<script\b([^>]*)>([\s\S]*?)<\/script>/gi,
    (whole: string, attrs: string, body: string) => {
      // Пропускаем <script src=...> — это не inline JS
      if (/\bsrc\s*=/i.test(attrs)) return whole;
      // Пропускаем JSON-LD (структурированные данные)
      if (/type\s*=\s*['"]application\/ld\+json['"]/i.test(attrs)) return whole;

      const newBody = rewriteAbsoluteUrlsInJs(body, fromFile, mainHost, ctx);
      return newBody === body ? whole : whole.replace(body, newBody);
    },
  );

  // Удаляем <base> — он больше не нужен (все URL уже резолвнуты с его учётом)
  content = content.replace(/<base\b[^>]*\/?>\s*/gi, '');

  return content;
}

/**
 * Переписывает абсолютные URL внутри JS-строк — оба формата:
 *   "https://host/..."        — обычный
 *   "https:\/\/host\/..."     — JSON-escaped (часто в WP-инжектах)
 * Только если URL принадлежит mainHost И файл реально на диске.
 */
function rewriteAbsoluteUrlsInJs(
  body: string,
  fromFile: string,
  mainHost: string,
  ctx: RewriteCtx,
): string {
  const escapedHost = mainHost.replace(/\./g, '\\.');

  // 1. JSON-escaped URL: "https:\/\/<host>\/path"
  const jsonEscapedRe = new RegExp(
    `https:\\\\/\\\\/${escapedHost}(\\\\/[^"'\\s\\\\]+)`,
    'gi',
  );
  body = body.replace(jsonEscapedRe, (match, escapedPath: string) => {
    // Декодируем экранирование для resolve
    const realPath = escapedPath.replace(/\\\//g, '/');
    const absUrl = `https://${mainHost}${realPath}`;
    const nv = rewriteOneUrl(absUrl, fromFile, `https://${mainHost}/`, mainHost, ctx);
    if (!nv) return match;
    // Реэкранируем результат для JSON-формата
    return nv.replace(/\//g, '\\/');
  });

  // 2. Обычный абсолютный URL в строке: "https://<host>/path" или 'https://...'
  const plainRe = new RegExp(`https?://${escapedHost}(/[^"'\\s\`<>()]+)`, 'gi');
  body = body.replace(plainRe, (match, path: string) => {
    const absUrl = `https://${mainHost}${path}`;
    const nv = rewriteOneUrl(absUrl, fromFile, `https://${mainHost}/`, mainHost, ctx);
    return nv ?? match;
  });

  return body;
}

function rewriteCssContent(
  content: string,
  fromFile: string,
  baseUrl: string,
  mainHost: string,
  ctx: RewriteCtx,
): string {
  content = content.replace(CSS_URL_RE, (match, quote: string, value: string) => {
    const newVal = rewriteOneUrl(value, fromFile, baseUrl, mainHost, ctx);
    return newVal ? `url(${quote}${newVal}${quote})` : match;
  });
  content = content.replace(CSS_IMPORT_RE, (match, value: string) => {
    const newVal = rewriteOneUrl(value, fromFile, baseUrl, mainHost, ctx);
    return newVal ? match.replace(value, newVal) : match;
  });
  return content;
}

async function phase3RewriteUrls(
  result: Phase1Result,
  outputDir: string,
): Promise<{ rewrittenFiles: number }> {
  const absoluteOutputDir = resolve(outputDir);
  const ctx = buildRewriteCtx(result);
  let rewrittenFiles = 0;

  for (const [filePath, originalUrl] of result.fileToUrl) {
    const cat = categorizeByExt(filePath);
    if (cat !== 'html' && cat !== 'css') continue;

    const absPath = join(absoluteOutputDir, filePath);
    let content: string;
    try {
      content = await readFile(absPath, 'utf8');
    } catch {
      continue;
    }

    const before = content;
    if (cat === 'html') {
      content = rewriteHtmlContent(content, filePath, originalUrl, result.mainHost, ctx);
    } else {
      content = rewriteCssContent(content, filePath, originalUrl, result.mainHost, ctx);
    }
    if (content !== before) {
      await writeFile(absPath, content, 'utf8');
      rewrittenFiles++;
    }
  }

  return { rewrittenFiles };
}

// ─────────────────────────────────────────────────────────────────────────────
// Phase 4 — Проверка целостности URL
// ─────────────────────────────────────────────────────────────────────────────

interface MissingResource {
  file: string;
  url: string;
  type: 'external-no-local' | 'local-missing';
  suggestion?: string;
}

interface Phase4Result {
  urlsFixed: number;
  missingReport: MissingResource[];
  reportPath: string;
}

/**
 * Строит индекс: basename → массив относительных путей ко всем файлам
 * с таким именем в outputDir.
 */
async function buildBasenameIndex(outputDir: string): Promise<Map<string, string[]>> {
  const index = new Map<string, string[]>();
  const absoluteOutputDir = resolve(outputDir);

  async function walk(dir: string): Promise<void> {
    const entries = await readdir(dir, { withFileTypes: true });
    for (const e of entries) {
      const full = join(dir, e.name);
      if (e.isDirectory()) {
        await walk(full);
      } else if (e.isFile()) {
        const rel = relative(absoluteOutputDir, full);
        const bn = e.name.toLowerCase();
        const existing = index.get(bn) ?? [];
        existing.push(rel);
        index.set(bn, existing);
      }
    }
  }

  await walk(absoluteOutputDir);
  return index;
}

/**
 * Ищет файл с таким же basename в индексе. Возвращает лучший кандидат:
 * предпочитает файлы на том же хосте (не в _external/), потом ближайшие по пути.
 */
function findBestCandidate(
  basename: string,
  fromFile: string,
  index: Map<string, string[]>,
): string | undefined {
  const candidates = index.get(basename.toLowerCase());
  if (!candidates || candidates.length === 0) return undefined;

  // Исключаем сам fromFile из кандидатов
  const others = candidates.filter((c) => c !== fromFile);
  if (others.length === 0) return undefined;

  // Приоритет: локальные файлы (не _external/)
  const local = others.filter((c) => !c.startsWith('_external/'));
  const best = local.length > 0 ? local : others;

  // Выбираем с кратчайшим относительным путём
  let shortest = best[0]!;
  let shortestLen = posix.relative(posix.dirname(fromFile), best[0]!).length;
  for (const c of best.slice(1)) {
    const len = posix.relative(posix.dirname(fromFile), c).length;
    if (len < shortestLen) {
      shortest = c;
      shortestLen = len;
    }
  }
  return shortest;
}

async function phase4IntegrityCheck(
  result: Phase1Result,
  outputDir: string,
): Promise<Phase4Result> {
  const absoluteOutputDir = resolve(outputDir);
  const index = await buildBasenameIndex(absoluteOutputDir);
  let urlsFixed = 0;
  const missingReport: MissingResource[] = [];

  for (const [filePath, originalUrl] of result.fileToUrl) {
    const cat = categorizeByExt(filePath);
    if (cat !== 'html' && cat !== 'css') continue;

    const absPath = join(absoluteOutputDir, filePath);
    let content: string;
    try {
      content = await readFile(absPath, 'utf8');
    } catch {
      continue;
    }

    const before = content;

    if (cat === 'html') {
      content = await fixHtmlUrls(content, filePath, originalUrl, result.mainHost, index, absoluteOutputDir, missingReport, () => urlsFixed++);
    } else {
      content = await fixCssUrls(content, filePath, originalUrl, result.mainHost, index, absoluteOutputDir, missingReport, () => urlsFixed++);
    }

    if (content !== before) {
      await writeFile(absPath, content, 'utf8');
    }
  }

  // Пишем отчёт о недостающих ресурсах
  let reportPath = '';
  if (missingReport.length > 0) {
    reportPath = join(absoluteOutputDir, 'missing-resources.log');
    const lines = [
      'Файл | Тип | Исходный URL | Рекомендация',
      '-'.repeat(120),
      ...missingReport.map((m) =>
        `${m.file} | ${m.type} | ${m.url} | ${m.suggestion ?? '— требуется ручная загрузка'}`,
      ),
    ];
    await writeFile(reportPath, lines.join('\n') + '\n', 'utf8');
  }

  return { urlsFixed, missingReport, reportPath };
}

async function fixHtmlUrls(
  content: string,
  fromFile: string,
  baseUrl: string,
  mainHost: string,
  index: Map<string, string[]>,
  outputDir: string,
  report: MissingResource[],
  onFixed: () => void,
): Promise<string> {
  // Обрабатываем URL в asset-тегах
  content = content.replace(HTML_ASSET_TAG_RE, (whole, _tag: string, attrs: string) => {
    let newAttrs = attrs;

    newAttrs = newAttrs.replace(
      HTML_URL_ATTR_RE,
      (m: string, name: string, q: string, val: string) => {
        const fixed = fixOneUrl(val, fromFile, baseUrl, mainHost, index, outputDir, report);
        if (fixed !== null && fixed !== val) {
          onFixed();
          return `${name}=${q}${fixed}${q}`;
        }
        return m;
      },
    );

    newAttrs = newAttrs.replace(
      HTML_SRCSET_ATTR_RE,
      (m: string, name: string, q: string, val: string) => {
        const parts = val.split(',').map((p) => p.trim()).filter(Boolean);
        let changed = false;
        const newParts = parts.map((p) => {
          const [u, ...sizeRest] = p.split(/\s+/);
          if (!u) return p;
          const fixed = fixOneUrl(u, fromFile, baseUrl, mainHost, index, outputDir, report);
          if (fixed !== null && fixed !== u) {
            changed = true;
            onFixed();
            return [fixed, ...sizeRest].join(' ');
          }
          return p;
        });
        return changed ? `${name}=${q}${newParts.join(', ')}${q}` : m;
      },
    );

    return newAttrs === attrs ? whole : whole.replace(attrs, newAttrs);
  });

  // Inline style="..."
  content = content.replace(
    /(\sstyle\s*=\s*)(['"])([^'"]+)\2/gi,
    (m: string, prefix: string, q: string, val: string) => {
      const nv = fixCssUrlsInline(val, fromFile, baseUrl, mainHost, index, outputDir, report, onFixed);
      return nv === val ? m : `${prefix}${q}${nv}${q}`;
    },
  );

  return content;
}

async function fixCssUrls(
  content: string,
  fromFile: string,
  baseUrl: string,
  mainHost: string,
  index: Map<string, string[]>,
  outputDir: string,
  report: MissingResource[],
  onFixed: () => void,
): Promise<string> {
  return fixCssUrlsInline(content, fromFile, baseUrl, mainHost, index, outputDir, report, onFixed);
}

function fixCssUrlsInline(
  content: string,
  fromFile: string,
  baseUrl: string,
  mainHost: string,
  index: Map<string, string[]>,
  outputDir: string,
  report: MissingResource[],
  onFixed: () => void,
): string {
  content = content.replace(CSS_URL_RE, (match, quote: string, value: string) => {
    const fixed = fixOneUrl(value, fromFile, baseUrl, mainHost, index, outputDir, report);
    if (fixed !== null && fixed !== value) {
      onFixed();
      return `url(${quote}${fixed}${quote})`;
    }
    return match;
  });
  content = content.replace(CSS_IMPORT_RE, (match, value: string) => {
    const fixed = fixOneUrl(value, fromFile, baseUrl, mainHost, index, outputDir, report);
    if (fixed !== null && fixed !== value) {
      onFixed();
      return match.replace(value, fixed);
    }
    return match;
  });
  return content;
}

/**
 * Проверяет и исправляет один URL:
 * - Если абсолютный внешний → ищет локальную копию, если нет → в отчёт
 * - Если относительный → проверяет существование, если нет → ищет по basename
 * Возвращает исправленный URL или null если не требует изменений.
 */
function fixOneUrl(
  rawUrl: string,
  fromFile: string,
  baseUrl: string,
  mainHost: string,
  index: Map<string, string[]>,
  outputDir: string,
  report: MissingResource[],
): string | null {
  const trimmed = rawUrl.trim();
  if (!trimmed) return null;
  if (
    trimmed.startsWith('data:') ||
    trimmed.startsWith('mailto:') ||
    trimmed.startsWith('tel:') ||
    trimmed.startsWith('javascript:') ||
    trimmed.startsWith('#')
  ) {
    return null;
  }

  const isAbsolute = /^https?:\/\//i.test(trimmed) || trimmed.startsWith('//');

  if (isAbsolute) {
    // Внешний URL — ищем локальную копию по basename
    const absUrl = resolveUrl(trimmed, baseUrl);
    if (!absUrl) return null;

    let basename: string;
    try {
      const pathname = new URL(absUrl).pathname;
      basename = posix.basename(pathname).toLowerCase();
    } catch {
      return null;
    }

    if (!basename || !basename.includes('.')) return null;

    const candidate = findBestCandidate(basename, fromFile, index);
    if (candidate) {
      return relPath(fromFile, candidate);
    }

    // Не нашли локальную копию — в отчёт
    report.push({
      file: fromFile,
      url: trimmed,
      type: 'external-no-local',
      suggestion: 'файл не найден в локальных ресурсах — требуется ручная загрузка',
    });
    return null;
  }

  // Относительный URL — проверяем существование файла
  const targetPath = posix.join(posix.dirname(fromFile), trimmed.split('?')[0]!);
  const absTarget = join(outputDir, targetPath);

  if (fileExistsSync(absTarget)) return null; // файл есть, всё ок

  // Файла нет — ищем по basename
  const basename = posix.basename(trimmed.split('?')[0]!).toLowerCase();
  if (!basename || !basename.includes('.')) {
    // Не можем определить файл — оставляем как есть
    return null;
  }

  const candidate = findBestCandidate(basename, fromFile, index);
  if (candidate) {
    return relPath(fromFile, candidate);
  }

  // Не нашли нигде — в отчёт
  report.push({
    file: fromFile,
    url: trimmed,
    type: 'local-missing',
    suggestion: 'файл не найден в дереве проекта',
  });
  return null;
}

function fileExistsSync(p: string): boolean {
  try {
    const { statSync } = require('node:fs') as typeof import('node:fs');
    statSync(p);
    return true;
  } catch {
    return false;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Main
// ─────────────────────────────────────────────────────────────────────────────

export interface DownloadResult {
  outputDir: string;
  phase1: DownloadStats;
  phase2: { saved: number; failed: number };
  phase3: { rewrittenFiles: number };
  phase4: Phase4Result;
}

export async function downloadSite(url: string, outputDir?: string): Promise<DownloadResult> {
  if (!/^https?:\/\//i.test(url)) {
    throw new Error(`URL must start with http:// or https://: ${url}`);
  }

  const resolvedOutputDir = outputDir ?? `./downloads/${new URL(url).hostname.replace(/[^a-z0-9.-]/gi, '_')}`;

  const result = await phase1Browser({ url, outputDir: resolvedOutputDir });
  const phase2 = await phase2DownloadMissing(result, resolvedOutputDir);
  const phase3 = await phase3RewriteUrls(result, resolvedOutputDir);
  const phase4 = await phase4IntegrityCheck(result, resolvedOutputDir);

  return {
    outputDir: resolve(resolvedOutputDir),
    phase1: result.stats,
    phase2,
    phase3,
    phase4,
  };
}

function printUsageAndExit(): never {
  console.error('Usage: npm run download -- <url> [outputDir]');
  process.exit(1);
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  if (args.length < 1) printUsageAndExit();

  const url = args[0]!;
  let outputDir = args[1];

  if (!/^https?:\/\//i.test(url)) {
    console.error('URL должен начинаться с http:// или https://');
    process.exit(1);
  }
  if (!outputDir) {
    const host = new URL(url).hostname.replace(/[^a-z0-9.-]/gi, '_');
    outputDir = `./downloads/${host}`;
  }

  console.log(`[download-site] URL:    ${url}`);
  console.log(`[download-site] Output: ${resolve(outputDir)}`);

  const start = Date.now();

  // Phase 1
  const result = await phase1Browser({ url, outputDir });

  // Phase 2
  const phase2 = await phase2DownloadMissing(result, outputDir);

  // Phase 3
  const phase3 = await phase3RewriteUrls(result, outputDir);

  // Phase 4
  const phase4 = await phase4IntegrityCheck(result, outputDir);

  const seconds = ((Date.now() - start) / 1000).toFixed(1);
  console.log('');
  console.log(`[download-site] Готово за ${seconds}s`);
  console.log(`[download-site] Phase1 saved:   ${result.stats.saved}`);
  console.log(`[download-site] Phase1 skipped: ${result.stats.skipped}`);
  console.log(`[download-site] Phase1 failed:  ${result.stats.failed}`);
  console.log(`[download-site] Phase2 saved:   ${phase2.saved}`);
  console.log(`[download-site] Phase2 failed:  ${phase2.failed}`);
  console.log(`[download-site] Phase3 rewritten files: ${phase3.rewrittenFiles}`);
  console.log(`[download-site] Phase4 urls fixed:      ${phase4.urlsFixed}`);
  console.log(`[download-site] Phase4 missing resources: ${phase4.missingReport.length}`);
  if (phase4.reportPath) {
    console.log(`[download-site] Phase4 report: ${phase4.reportPath}`);
  }
  console.log('[download-site] По типам (phase 1):');
  for (const [type, count] of Object.entries(result.stats.byType).sort((a, b) => b[1] - a[1])) {
    console.log(`  - ${type.padEnd(8)} ${count}`);
  }
}

const __filename = fileURLToPath(import.meta.url);
if (resolve(process.argv[1] ?? '') === resolve(__filename)) {
  main().catch((err) => {
    console.error('[download-site] Fatal:', err);
    process.exit(1);
  });
}
