/**
 * Очистка скачанного лендинга от вредоносного и трекерного кода.
 *
 * Запуск:
 *   npm run clean -- <siteDir> [--no-backup]
 *
 * Что удаляется:
 *   HTML/PHP:
 *   - <script src="..."> с доменами из TRACKER_HOSTS
 *   - inline <script> с трекерными ключевыми словами (gtag, fbq, ym, и т.п.)
 *   - <noscript> с iframe-ами/пикселями трекеров
 *   - <link rel="dns-prefetch|preconnect|prefetch"> на трекерные хосты
 *   - <meta name="..."> с верификациями (google-site-verification, и т.п.)
 *   - <meta http-equiv="refresh"> с внешним redirect-URL
 *   - <base href="..."> с внешним доменом (не в TRUSTED_HOSTS)
 *   - <object data="..."> и <embed src="..."> с внешними ресурсами
 *   - Event-атрибуты (onclick, onload и др.) содержащие внешние вызовы
 *   - JSON-LD <script type="application/ld+json"> с трекерным контентом
 *   - <img> tracking-пиксели с трекерными src
 *   SVG:
 *   - <script> блоки
 *   - <foreignObject> блоки
 *   - Event-атрибуты (on*)
 *   - xlink:href на внешние домены
 *   Прочее:
 *   - папки _external/<tracker-host>/ целиком
 *   - .map файлы (source maps) из всего дерева
 *   - комментарии sourceMappingURL= из JS/CSS
 *
 * Резервная копия создаётся в <siteDir>_backup (отключить: --no-backup).
 */

import {
  readFile,
  writeFile,
  rm,
  readdir,
  stat,
  cp,
} from 'node:fs/promises';
import { extname, join, resolve, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

export interface CleanStats {
  htmlFilesProcessed: number;
  phpFilesProcessed: number;
  scriptsRemoved: number;
  inlineScriptsRemoved: number;
  noscriptsRemoved: number;
  linksRemoved: number;
  metasRemoved: number;
  jsonLdRemoved: number;
  imgPixelsRemoved: number;
  metaRefreshRemoved: number;
  baseHrefRemoved: number;
  objectEmbedsRemoved: number;
  eventAttrsRemoved: number;
  svgFilesProcessed: number;
  svgItemsRemoved: number;
  jsFilesScanned: number;
  jsItemsRemoved: number;
  cssFilesScanned: number;
  cssItemsRemoved: number;
  externalDirsRemoved: number;
  sourceMapsDeleted: number;
  sourceMapRefsStripped: number;
  bytesBefore: number;
  bytesAfter: number;
}

interface ChangelogEntry {
  file: string;
  type: string;
  description: string;
  codeSnippet?: string;
  lineNumber?: number;
}

// ─────────────────────────────────────────────────────────────────────────────
// Списки трекеров
// ─────────────────────────────────────────────────────────────────────────────

/** Хосты, при совпадении с которыми <script>/<link>/<iframe> вырезается. */
const TRACKER_HOSTS: string[] = [
  // Google
  'google-analytics.com',
  'googletagmanager.com',
  'googletagservices.com',
  'googleadservices.com',
  'googlesyndication.com',
  'doubleclick.net',
  'g.doubleclick.net',
  'stats.g.doubleclick.net',
  'region1.analytics.google.com',
  'analytics.google.com',
  'googleoptimize.com',
  // Yandex
  'mc.yandex.ru',
  'mc.yandex.com',
  'yandex.ru/metrika',
  'metrika.yandex.ru',
  // Facebook
  'connect.facebook.net',
  'facebook.com/tr',
  // Hotjar / CrazyEgg
  'static.hotjar.com',
  'hotjar.com',
  'crazyegg.com',
  // Mixpanel / Segment / Amplitude
  'cdn.mxpnl.com',
  'api.mixpanel.com',
  'cdn.segment.com',
  'api.segment.io',
  'api.amplitude.com',
  // Intercom / HubSpot / Drift
  'widget.intercom.io',
  'js.intercomcdn.com',
  'js.hsforms.net',
  'hubspot.com',
  'js.hs-scripts.com',
  'js.hs-banner.com',
  'js.driftt.com',
  // Tawk / Crisp
  'embed.tawk.to',
  'client.crisp.chat',
  // OptiMonk (попапы)
  'optimonk.com',
  'cdn-asset.optimonk.com',
  'cdn-account.optimonk.com',
  'cdn-limit.optimonk.com',
  'front.optimonk.com',
  'gs-cdn.optimonk.com',
  // SplitHero
  'splithero.com',
  'app.splithero.com',
  // PostAffiliatePro
  'postaffiliatepro.com',
  // Прочее
  'cloudflareinsights.com',
  'static.cloudflareinsights.com',
  'snapchat.com/p',
  'analytics.tiktok.com',
  'tiktok.com/i18n/pixel',
  'pinterest.com/ct',
  'ct.pinterest.com',
  'bat.bing.com',
  'sentry.io',
  'browser.sentry-cdn.com',
  // Microsoft Clarity
  'www.clarity.ms',
  'clarity.ms',
  // LinkedIn Insight Tag
  'snap.licdn.com',
  'px.ads.linkedin.com',
  // Twitter / X Pixel
  'static.ads-twitter.com',
  'analytics.twitter.com',
  // VK Pixel
  'mc.vk.com',
  'vk.com/rtrg',
  // Taboola / Outbrain
  'cdn.taboola.com',
  'amplify.outbrain.com',
  // Cookie consent banners
  'consent.cookiebot.com',
  'consentcdn.cookiebot.com',
  'cdn.cookielaw.org',
  'cookiehub.com',
  // Live-chat / Support widgets
  'static.zdassets.com',
  'cdn.livechatinc.com',
  // Heap Analytics
  'cdn.heapanalytics.com',
  'heapanalytics.com',
];

/** Доверенные CDN-хосты — их внешние URL не считаются угрозой. */
const TRUSTED_HOSTS = new Set<string>([
  'code.jquery.com',
  'cdn.jsdelivr.net',
  'cdnjs.cloudflare.com',
  'unpkg.com',
  'fonts.googleapis.com',
  'fonts.gstatic.com',
  'ajax.googleapis.com',
  'stackpath.bootstrapcdn.com',
  'maxcdn.bootstrapcdn.com',
]);

/** Event-атрибуты, удаляемые если содержат внешние вызовы. */
const DANGEROUS_EVENT_ATTRS: readonly string[] = [
  'onclick', 'ondblclick', 'onmousedown', 'onmouseup', 'onmouseover',
  'onmouseout', 'onmousemove', 'onkeydown', 'onkeyup', 'onkeypress',
  'onload', 'onunload', 'onabort', 'onerror', 'onresize', 'onscroll',
  'onfocus', 'onblur', 'onchange', 'onsubmit', 'onreset', 'onselect',
  'oncontextmenu', 'oninput', 'oninvalid', 'onsearch',
];

/** Ключевые слова в inline <script> — если есть, скрипт удаляется. */
const TRACKER_INLINE_KEYWORDS: string[] = [
  // Google
  'gtag(',
  'gtag.js',
  'GoogleAnalyticsObject',
  '_gaq.push',
  'window.dataLayer',
  'dataLayer.push',
  // Facebook
  'fbq(',
  '!function(f,b,e,v,n,t,s)',
  'connect.facebook.net',
  // Yandex
  'ym(',
  '(function(m,e,t,r,i,k,a)',
  'yandex_metrika',
  // Hotjar / Mixpanel / Segment / Amplitude / Intercom
  'hjid',
  'hotjar',
  'mixpanel',
  'analytics.load',
  'amplitude.getInstance',
  'Intercom(',
  'window.Intercom',
  // Прочее
  'PostAffTracker',
  'PAPCookie',
  'OptiMonk',
  'window.OptiMonk',
  'SplitHero',
  'splithero',
  'crazyegg',
  '_paq.push',
  '_hsq.push',
  // CloudFlare insights
  'beacon.min.js',
  'cf-beacon',
  // Microsoft Clarity
  'clarity(',
  'window.clarity',
  // LinkedIn
  '_linkedin_data_partner_id',
  'lintrk(',
  // Twitter / X pixel
  'twq(',
  // Cookie consent
  'CookieConsent',
  'Cookiebot',
  'OneTrust',
  'OptanonWrapper',
  // Heap Analytics
  'heap.load(',
  'window.heap',
  // VK Pixel
  'VK.Retargeting',
  // Zendesk / LiveChat widgets
  'zE(',
  'zEmbed',
  'LiveChatWidget',
];

/** Ключевые слова для удаления <noscript>. */
const TRACKER_NOSCRIPT_KEYWORDS: string[] = [
  'google-analytics',
  'googletagmanager',
  'doubleclick',
  'facebook.com/tr',
  'mc.yandex',
  'tiktok.com',
  'bat.bing',
  'clarity.ms',
  'linkedin.com',
  'ads-twitter.com',
  'cookiebot',
  'onetrust',
  'vk.com/rtrg',
];

/** Имена <meta name="..."> которые удаляем (верификации). */
const TRACKER_META_NAMES: string[] = [
  'google-site-verification',
  'msvalidate.01',
  'yandex-verification',
  'facebook-domain-verification',
  'p:domain_verify',
  'norton-safeweb-site-verification',
  'alexaVerifyID',
  'wot-verification',
];

/** Имя <link rel="..."> для проверки на удаление. */
const PRECONNECT_RELS = new Set(['dns-prefetch', 'preconnect', 'prefetch', 'preload']);

// ─────────────────────────────────────────────────────────────────────────────
// Утилиты
// ─────────────────────────────────────────────────────────────────────────────

/** Извлекает hostname из произвольной строки с URL (включая //x.com/y и просто путь). */
function extractHostname(raw: string): string | null {
  try {
    const u = new URL(raw, 'https://example.com');
    return u.hostname.toLowerCase();
  } catch {
    return null;
  }
}

/** host совпадает с t или является его поддоменом. */
function hostMatches(host: string, t: string): boolean {
  return host === t || host.endsWith('.' + t);
}

function urlMatchesTracker(url: string): boolean {
  const lowerUrl = url.toLowerCase();

  // 1) Путевые спички (формат 'host.com/path') — substring анализ.
  for (const t of TRACKER_HOSTS) {
    if (t.includes('/') && lowerUrl.includes(t)) return true;
  }

  // 2) Абсолютные / protocol-relative URL — по hostname.
  if (/^https?:\/\//i.test(url) || url.startsWith('//')) {
    const host = extractHostname(url);
    if (host) {
      for (const t of TRACKER_HOSTS) {
        if (!t.includes('/') && hostMatches(host, t)) return true;
      }
    }
  }

  // 3) Относительные URL с _external/<host>/ — извлекаем host из пути.
  const m = /(?:^|\/)_external\/([^/?#]+)/i.exec(url);
  if (m) {
    const host = m[1]!.toLowerCase();
    for (const t of TRACKER_HOSTS) {
      if (!t.includes('/') && hostMatches(host, t)) return true;
    }
  }

  return false;
}

/** Возвращает true если URL абсолютный и хост не в TRUSTED_HOSTS. */
function isExternalUrl(url: string): boolean {
  if (!url) return false;
  if (!/^https?:\/\//i.test(url) && !url.startsWith('//')) return false;
  const host = extractHostname(url);
  if (!host) return false;
  return !Array.from(TRUSTED_HOSTS).some((t) => hostMatches(host, t));
}

function inlineLooksLikeTracker(scriptBody: string): boolean {
  // Пропускаем JSON-LD как отдельный кейс
  return TRACKER_INLINE_KEYWORDS.some((kw) => scriptBody.includes(kw));
}

async function* walkFiles(dir: string): AsyncGenerator<string> {
  const entries = await readdir(dir, { withFileTypes: true });
  for (const e of entries) {
    const full = join(dir, e.name);
    if (e.isDirectory()) {
      yield* walkFiles(full);
    } else if (e.isFile()) {
      yield full;
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Основная очистка HTML
// ─────────────────────────────────────────────────────────────────────────────

interface HtmlCleanCounts {
  scripts: number;
  inlineScripts: number;
  noscripts: number;
  links: number;
  metas: number;
  jsonLd: number;
  imgPixels: number;
  metaRefresh: number;
  baseHref: number;
  objectEmbeds: number;
  eventAttrs: number;
}

function cleanHtml(content: string): { html: string; counts: HtmlCleanCounts } {
  const counts: HtmlCleanCounts = {
    scripts: 0,
    inlineScripts: 0,
    noscripts: 0,
    links: 0,
    metas: 0,
    jsonLd: 0,
    imgPixels: 0,
    metaRefresh: 0,
    baseHref: 0,
    objectEmbeds: 0,
    eventAttrs: 0,
  };

  // 1. <script src="..."> — внешние трекеры
  // Также захватим самозакрывающиеся варианты типа <script src="..."/>
  content = content.replace(
    /<script\b([^>]*?)\bsrc\s*=\s*(['"])([^'"]+)\2([^>]*?)>([\s\S]*?)<\/script>/gi,
    (whole, _pre, _q, src: string) => {
      if (urlMatchesTracker(src)) {
        counts.scripts++;
        return '';
      }
      return whole;
    },
  );

  // 2. inline <script> (без src) с трекерным контентом
  content = content.replace(
    /<script\b([^>]*?)>([\s\S]*?)<\/script>/gi,
    (whole, attrs: string, body: string) => {
      // Пропускаем те, где есть src= — они уже обработаны выше
      if (/\bsrc\s*=/i.test(attrs)) return whole;

      // JSON-LD: type="application/ld+json"
      if (/type\s*=\s*['"]application\/ld\+json['"]/i.test(attrs)) {
        // Удалим ld+json только если это явно трекерный (Google Tag Manager, и т.п.)
        if (
          /googletagmanager|google-analytics|gtm-/i.test(body) ||
          /"@type"\s*:\s*"WebSite"\s*,[\s\S]*?"potentialAction"[\s\S]*?"SearchAction"/i.test(body)
        ) {
          counts.jsonLd++;
          return '';
        }
        return whole;
      }

      if (inlineLooksLikeTracker(body)) {
        counts.inlineScripts++;
        return '';
      }
      return whole;
    },
  );

  // 3. <noscript> с трекерным контентом
  content = content.replace(
    /<noscript\b[^>]*>([\s\S]*?)<\/noscript>/gi,
    (whole, body: string) => {
      const lower = body.toLowerCase();
      if (TRACKER_NOSCRIPT_KEYWORDS.some((kw) => lower.includes(kw))) {
        counts.noscripts++;
        return '';
      }
      return whole;
    },
  );

  // 4. <link rel="dns-prefetch|preconnect|prefetch|preload" href="..."> на трекеров
  content = content.replace(
    /<link\b([^>]*?)\/?>/gi,
    (whole, attrs: string) => {
      const relMatch = /\brel\s*=\s*(['"])([^'"]+)\1/i.exec(attrs);
      const hrefMatch = /\bhref\s*=\s*(['"])([^'"]+)\1/i.exec(attrs);
      if (!relMatch || !hrefMatch) return whole;
      const rel = relMatch[2]?.toLowerCase() ?? '';
      const href = hrefMatch[2] ?? '';
      // Удаляем preconnect/dns-prefetch/preload на трекеров
      if (PRECONNECT_RELS.has(rel) && urlMatchesTracker(href)) {
        counts.links++;
        return '';
      }
      // pingback / RSS feed / oembed — оставляем, ничего не делаем
      return whole;
    },
  );

  // 5. <meta name="..."> для верификаций + <meta http-equiv="refresh">
  content = content.replace(
    /<meta\b([^>]*?)\/?>/gi,
    (whole, attrs: string) => {
      const nameMatch = /\bname\s*=\s*(['"])([^'"]+)\1/i.exec(attrs);
      if (nameMatch) {
        const name = nameMatch[2]?.toLowerCase() ?? '';
        if (TRACKER_META_NAMES.includes(name)) {
          counts.metas++;
          return '';
        }
      }
      const httpEquivMatch = /\bhttp-equiv\s*=\s*(['"])refresh\1/i.exec(attrs);
      if (httpEquivMatch) {
        const contentMatch = /\bcontent\s*=\s*(['"])([^'"]+)\1/i.exec(attrs);
        const urlInContent = /url\s*=\s*(.+)/i.exec(contentMatch?.[2] ?? '');
        if (!urlInContent || isExternalUrl(urlInContent[1]!.trim())) {
          counts.metaRefresh++;
          return '';
        }
      }
      return whole;
    },
  );

  // 6. <iframe src="..."> на трекеры (например, GTM noscript-iframe)
  content = content.replace(
    /<iframe\b([^>]*?)\bsrc\s*=\s*(['"])([^'"]+)\2([^>]*?)>([\s\S]*?)<\/iframe>/gi,
    (whole, _pre, _q, src: string) => {
      if (urlMatchesTracker(src)) {
        counts.scripts++;
        return '';
      }
      return whole;
    },
  );

  // 7. <img> tracking-пиксели с трекерными src
  content = content.replace(
    /<img\b([^>]*?)\bsrc\s*=\s*(['"])([^'"]+)\2([^>]*?)\/?>/gi,
    (whole, _pre, _q, src: string) => {
      if (urlMatchesTracker(src)) {
        counts.imgPixels++;
        return '';
      }
      return whole;
    },
  );

  // 8. <base href="..."> с внешним доменом
  content = content.replace(
    /<base\b([^>]*?)\/?>/gi,
    (whole, attrs: string) => {
      const hrefMatch = /\bhref\s*=\s*(['"])([^'"]*)\1/i.exec(attrs);
      if (hrefMatch && isExternalUrl(hrefMatch[2]!)) {
        counts.baseHref++;
        return '';
      }
      return whole;
    },
  );

  // 9. <object data="..."> с внешними ресурсами
  content = content.replace(
    /<object\b([^>]*?)>([\s\S]*?)<\/object>/gi,
    (whole, attrs: string) => {
      const dataMatch = /\bdata\s*=\s*(['"])([^'"]+)\1/i.exec(attrs);
      if (dataMatch && isExternalUrl(dataMatch[2]!)) {
        counts.objectEmbeds++;
        return '';
      }
      return whole;
    },
  );

  // 10. <embed src="..."> с внешними ресурсами
  content = content.replace(
    /<embed\b([^>]*?)\/?>/gi,
    (whole, attrs: string) => {
      const srcMatch = /\bsrc\s*=\s*(['"])([^'"]+)\1/i.exec(attrs);
      if (srcMatch && isExternalUrl(srcMatch[2]!)) {
        counts.objectEmbeds++;
        return '';
      }
      return whole;
    },
  );

  // 11. Event-атрибуты с внешними вызовами или трекерными функциями
  const attrPattern = new RegExp(
    `\\b(${DANGEROUS_EVENT_ATTRS.join('|')})\\s*=\\s*('[^']*'|"[^"]*")`,
    'gi',
  );
  content = content.replace(attrPattern, (whole, _attr: string, val: string) => {
    const inner = val.slice(1, -1);
    if (
      /https?:\/\//i.test(inner) ||
      TRACKER_INLINE_KEYWORDS.some((kw) => inner.includes(kw))
    ) {
      counts.eventAttrs++;
      return '';
    }
    return whole;
  });

  // 12. Подчищаем пустые строки, оставшиеся после удалений (косметика)
  content = content.replace(/\n[ \t]*\n[ \t]*\n+/g, '\n\n');

  return { html: content, counts };
}

// ─────────────────────────────────────────────────────────────────────────────
// Удаление _external/<tracker-host>/ папок
// ─────────────────────────────────────────────────────────────────────────────

async function removeTrackerExternals(siteDir: string): Promise<number> {
  const externalDir = join(siteDir, '_external');
  let removed = 0;
  try {
    const entries = await readdir(externalDir, { withFileTypes: true });
    for (const e of entries) {
      if (!e.isDirectory()) continue;
      const host = e.name.toLowerCase();
      // Строгое совпадение по хосту/поддомену.
      const matches = TRACKER_HOSTS.some((t) => {
        if (t.includes('/')) return false; // путевые спички не соответствуют имени папки
        return hostMatches(host, t);
      });
      if (matches) {
        await rm(join(externalDir, e.name), { recursive: true, force: true });
        removed++;
      }
    }
  } catch {
    // _external может не существовать — окей
  }
  return removed;
}

// ─────────────────────────────────────────────────────────────────────────────
// Удаление source maps
// ─────────────────────────────────────────────────────────────────────────────

async function removeSourceMaps(
  siteDir: string,
): Promise<{ mapsDeleted: number; filesStripped: number }> {
  let mapsDeleted = 0;
  let filesStripped = 0;

  for await (const file of walkFiles(siteDir)) {
    const ext = extname(file).toLowerCase();

    if (ext === '.map') {
      await rm(file, { force: true });
      mapsDeleted++;
      continue;
    }

    if (ext === '.js' || ext === '.mjs' || ext === '.css') {
      const original = await readFile(file, 'utf8');
      const cleaned = original
        .replace(/\/\/[#@][ \t]*sourceMappingURL\s*=\s*\S+/g, '')
        .replace(/\/\*#[ \t]*sourceMappingURL\s*=\s*[^*]*\*\//g, '');
      if (cleaned !== original) {
        await writeFile(file, cleaned, 'utf8');
        filesStripped++;
      }
    }
  }

  return { mapsDeleted, filesStripped };
}

// ─────────────────────────────────────────────────────────────────────────────
// JS-очистка
// ─────────────────────────────────────────────────────────────────────────────

/** Паттерны в JS, требующие ручной проверки — добавляются только в changelog. */
const JS_WARNING_PATTERNS: ReadonlyArray<{ re: RegExp; label: string }> = [
  { re: /\bfetch\s*\(/g,                                        label: 'fetch()' },
  { re: /new\s+XMLHttpRequest\s*\(/g,                           label: 'XMLHttpRequest' },
  { re: /navigator\.sendBeacon\s*\(/g,                          label: 'sendBeacon' },
  { re: /new\s+WebSocket\s*\(/g,                                label: 'WebSocket' },
  { re: /document\.write\s*\(/g,                                label: 'document.write' },
  { re: /\blocalStorage\s*\./g,                                 label: 'localStorage' },
  { re: /\bsessionStorage\s*\./g,                               label: 'sessionStorage' },
  { re: /document\.addEventListener\s*\(\s*['"]key/g,           label: 'keylogger (addEventListener key*)' },
  { re: /\batob\s*\(/g,                                         label: 'atob()' },
  { re: /String\.fromCharCode\s*\(/g,                           label: 'String.fromCharCode' },
  { re: /window\.location\s*=/g,                                label: 'window.location redirect' },
  { re: /location\.href\s*=/g,                                  label: 'location.href redirect' },
  { re: /location\.replace\s*\(/g,                              label: 'location.replace redirect' },
  { re: /navigator\.clipboard\s*\./g,                           label: 'Clipboard API' },
  { re: /\bpostMessage\s*\(/g,                                  label: 'postMessage' },
];

async function cleanJsFile(
  filePath: string,
  relPath: string,
  log: ChangelogEntry[],
): Promise<number> {
  const original = await readFile(filePath, 'utf8');
  let content = original;
  let removed = 0;

  // Service Worker — перехватывает все запросы браузера
  content = content.replace(
    /navigator\.serviceWorker\.register\s*\([^)]*\)(?:\s*\.then\s*\([^)]*\))?\s*;?/g,
    () => {
      removed++;
      log.push({ file: relPath, type: 'JS удалён', description: 'navigator.serviceWorker.register(...)' });
      return '';
    },
  );

  // eval(atob(...)) / eval(unescape(...)) — обфусцированный код
  content = content.replace(
    /\beval\s*\(\s*(?:atob|unescape|decodeURIComponent)\s*\([^)]*\)\s*\)\s*;?/g,
    () => {
      removed++;
      log.push({ file: relPath, type: 'JS удалён', description: 'eval(atob/unescape(...))' });
      return '';
    },
  );

  // eval() с подозрительным контентом (base64-строки)
  content = content.replace(
    /\beval\s*\(\s*["'][A-Za-z0-9+/]{40,}={0,2}["']\s*\)\s*;?/g,
    () => {
      removed++;
      log.push({ file: relPath, type: 'JS удалён', description: 'eval("<base64-string>")' });
      return '';
    },
  );

  // Предупреждения для паттернов, требующих ручной проверки
  for (const { re, label } of JS_WARNING_PATTERNS) {
    re.lastIndex = 0;
    let match;
    while ((match = re.exec(content)) !== null) {
      const matchStart = Math.max(0, match.index - 150);
      const matchEnd = Math.min(content.length, match.index + match[0]!.length + 150);
      const snippet = content.slice(matchStart, matchEnd).replace(/\s+/g, ' ').trim();
      
      // Вычисляем номер строки
      const beforeMatch = content.slice(0, match.index);
      const lineNumber = beforeMatch.split('\n').length;
      
      log.push({ 
        file: relPath, 
        type: 'JS предупреждение', 
        description: `Найдено: ${label}`,
        codeSnippet: snippet,
        lineNumber
      });
    }
  }

  if (content !== original) await writeFile(filePath, content, 'utf8');
  return removed;
}

// ─────────────────────────────────────────────────────────────────────────────
// CSS-очистка
// ─────────────────────────────────────────────────────────────────────────────

async function cleanCssFile(
  filePath: string,
  relPath: string,
  log: ChangelogEntry[],
): Promise<number> {
  const original = await readFile(filePath, 'utf8');
  let content = original;
  let removed = 0;

  // @import с внешними нетрастовыми URL
  content = content.replace(
    /@import\s+(?:url\s*\(\s*['"]?|['"])(https?:\/\/[^'")\s;]+)['"]?\s*\)?\s*[^;]*;/gi,
    (whole, url: string) => {
      if (isExternalUrl(url)) {
        removed++;
        const snippet = whole.replace(/\s+/g, ' ').trim();
        const matchIndex = content.indexOf(whole);
        const beforeMatch = content.slice(0, matchIndex);
        const lineNumber = beforeMatch.split('\n').length;
        log.push({ file: relPath, type: 'CSS @import удалён', description: url, codeSnippet: snippet, lineNumber });
        return '';
      }
      return whole;
    },
  );

  // url() с трекерными доменами (фоны, шрифты, пиксели в CSS)
  content = content.replace(
    /url\s*\(\s*['"]?(https?:\/\/[^'")\s]+)['"]?\s*\)/gi,
    (whole, url: string) => {
      if (urlMatchesTracker(url)) {
        removed++;
        const snippet = whole.replace(/\s+/g, ' ').trim();
        const matchIndex = content.indexOf(whole);
        const beforeMatch = content.slice(0, matchIndex);
        const lineNumber = beforeMatch.split('\n').length;
        log.push({ file: relPath, type: 'CSS url() удалён', description: url, codeSnippet: snippet, lineNumber });
        return "url('')";
      }
      return whole;
    },
  );

  if (content !== original) await writeFile(filePath, content, 'utf8');
  return removed;
}

// ─────────────────────────────────────────────────────────────────────────────
// Лог изменений
// ─────────────────────────────────────────────────────────────────────────────

async function writeChangelog(siteDir: string, entries: ChangelogEntry[]): Promise<void> {
  if (entries.length === 0) return;
  const header = 'Файл | Строка | Тип изменения | Описание | Код';
  const sep = '-'.repeat(120);
  const rows = entries
    .map((e) => `${e.file} | ${e.lineNumber ?? '-'} | ${e.type} | ${e.description} | ${e.codeSnippet || '-'}`)
    .join('\n');
  const logPath = join(siteDir, 'clean-site-changes.log');
  await writeFile(logPath, header + '\n' + sep + '\n' + rows + '\n', 'utf8');
}

// ─────────────────────────────────────────────────────────────────────────────
// SVG-очистка
// ─────────────────────────────────────────────────────────────────────────────

async function cleanSvgFile(filePath: string): Promise<number> {
  const original = await readFile(filePath, 'utf8');
  let content = original;
  let removed = 0;

  content = content.replace(/<script\b[\s\S]*?<\/script>/gi, () => { removed++; return ''; });
  content = content.replace(/<foreignObject\b[\s\S]*?<\/foreignObject>/gi, () => { removed++; return ''; });
  content = content.replace(/\s+on\w+\s*=\s*(?:'[^']*'|"[^"]*")/gi, () => { removed++; return ''; });
  content = content.replace(/\bxlink:href\s*=\s*(['"])([^'"]+)\1/gi, (whole, _q, href: string) => {
    if (isExternalUrl(href)) { removed++; return ''; }
    return whole;
  });

  if (content !== original) await writeFile(filePath, content, 'utf8');
  return removed;
}

// ─────────────────────────────────────────────────────────────────────────────
// Резервная копия
// ─────────────────────────────────────────────────────────────────────────────

export async function createBackup(siteDir: string): Promise<string> {
  const backupDir = siteDir.replace(/\/+$/, '') + '_backup';
  await cp(siteDir, backupDir, { recursive: true });
  return backupDir;
}

// ─────────────────────────────────────────────────────────────────────────────
// Main
// ─────────────────────────────────────────────────────────────────────────────

export async function cleanSite(siteDir: string): Promise<CleanStats> {
  const stats: CleanStats = {
    htmlFilesProcessed: 0,
    phpFilesProcessed: 0,
    scriptsRemoved: 0,
    inlineScriptsRemoved: 0,
    noscriptsRemoved: 0,
    linksRemoved: 0,
    metasRemoved: 0,
    jsonLdRemoved: 0,
    imgPixelsRemoved: 0,
    metaRefreshRemoved: 0,
    baseHrefRemoved: 0,
    objectEmbedsRemoved: 0,
    eventAttrsRemoved: 0,
    svgFilesProcessed: 0,
    svgItemsRemoved: 0,
    jsFilesScanned: 0,
    jsItemsRemoved: 0,
    cssFilesScanned: 0,
    cssItemsRemoved: 0,
    externalDirsRemoved: 0,
    sourceMapsDeleted: 0,
    sourceMapRefsStripped: 0,
    bytesBefore: 0,
    bytesAfter: 0,
  };

  const changelog: ChangelogEntry[] = [];

  for await (const file of walkFiles(siteDir)) {
    const ext = extname(file).toLowerCase();
    const relPath = relative(siteDir, file);

    if (ext === '.html' || ext === '.htm' || ext === '.php') {
      const before = await readFile(file, 'utf8');
      stats.bytesBefore += before.length;

      const { html: after, counts } = cleanHtml(before);
      if (after !== before) {
        await writeFile(file, after, 'utf8');
      }
      stats.bytesAfter += after.length;

      if (ext === '.php') {
        stats.phpFilesProcessed++;
      } else {
        stats.htmlFilesProcessed++;
      }
      stats.scriptsRemoved += counts.scripts;
      stats.inlineScriptsRemoved += counts.inlineScripts;
      stats.noscriptsRemoved += counts.noscripts;
      stats.linksRemoved += counts.links;
      stats.metasRemoved += counts.metas;
      stats.jsonLdRemoved += counts.jsonLd;
      stats.imgPixelsRemoved += counts.imgPixels;
      stats.metaRefreshRemoved += counts.metaRefresh;
      stats.baseHrefRemoved += counts.baseHref;
      stats.objectEmbedsRemoved += counts.objectEmbeds;
      stats.eventAttrsRemoved += counts.eventAttrs;
      continue;
    }

    if (ext === '.svg') {
      const removed = await cleanSvgFile(file);
      stats.svgFilesProcessed++;
      stats.svgItemsRemoved += removed;
      continue;
    }

    if (ext === '.js' || ext === '.mjs') {
      const removed = await cleanJsFile(file, relPath, changelog);
      stats.jsFilesScanned++;
      stats.jsItemsRemoved += removed;
      continue;
    }

    if (ext === '.css') {
      const removed = await cleanCssFile(file, relPath, changelog);
      stats.cssFilesScanned++;
      stats.cssItemsRemoved += removed;
    }
  }

  // Удаляем папки _external/<tracker-host>/
  stats.externalDirsRemoved = await removeTrackerExternals(siteDir);

  // Удаляем source maps
  const { mapsDeleted, filesStripped } = await removeSourceMaps(siteDir);
  stats.sourceMapsDeleted = mapsDeleted;
  stats.sourceMapRefsStripped = filesStripped;

  // Пишем лог изменений
  await writeChangelog(siteDir, changelog);

  return stats;
}

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
  const reduction = stats.bytesBefore - stats.bytesAfter;
  const pct = stats.bytesBefore > 0 ? ((reduction / stats.bytesBefore) * 100).toFixed(1) : '0.0';
  console.log(
    `[clean-site] HTML/PHP размер: ${stats.bytesBefore} → ${stats.bytesAfter} байт (-${reduction}, ${pct}%)`,
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
