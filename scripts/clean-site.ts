/**
 * Очистка скачанного лендинга от трекеров, аналитики и сторонних виджетов.
 *
 * Запуск:
 *   npm run clean -- <siteDir> [htmlPath]
 *
 * Что удаляется:
 *   - <script src="..."> с доменами из TRACKER_HOSTS
 *   - inline <script> с упоминанием функций трекинга (gtag, fbq, _gaq, ym,
 *     PostAffTracker, mixpanel, hotjar, optimonk, и т.п.)
 *   - <noscript> с iframe-ами трекеров
 *   - <link rel="dns-prefetch|preconnect|prefetch"> на трекерные хосты
 *   - <meta name="..."> с верификациями (google-site-verification, и т.п.)
 *   - JSON-LD <script type="application/ld+json"> с трекерным контентом
 *   - папки _external/<tracker-host>/ целиком
 *
 * Логика безопасности:
 *   - Не трогаем JS-файлы основного домена и общеизвестные библиотеки
 *     (jQuery, swiper, gsap, ...) — может работать функциональность лендинга.
 *   - Удаляем теги ТОЛЬКО по совпадению с явным белым/чёрным списком.
 */

import {
  readFile,
  writeFile,
  rm,
  readdir,
  stat,
} from 'node:fs/promises';
import { extname, join, resolve } from 'node:path';

interface CleanStats {
  htmlFilesProcessed: number;
  scriptsRemoved: number;
  inlineScriptsRemoved: number;
  noscriptsRemoved: number;
  linksRemoved: number;
  metasRemoved: number;
  jsonLdRemoved: number;
  externalDirsRemoved: number;
  bytesBefore: number;
  bytesAfter: number;
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
];

/** Имена <meta name="..."> которые удаляем (верификации). */
const TRACKER_META_NAMES: string[] = [
  'google-site-verification',
  'msvalidate.01',
  'yandex-verification',
  'facebook-domain-verification',
  'p:domain_verify',
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
}

function cleanHtml(content: string): { html: string; counts: HtmlCleanCounts } {
  const counts: HtmlCleanCounts = {
    scripts: 0,
    inlineScripts: 0,
    noscripts: 0,
    links: 0,
    metas: 0,
    jsonLd: 0,
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

  // 5. <meta name="..."> для верификаций
  content = content.replace(
    /<meta\b([^>]*?)\/?>/gi,
    (whole, attrs: string) => {
      const nameMatch = /\bname\s*=\s*(['"])([^'"]+)\1/i.exec(attrs);
      if (!nameMatch) return whole;
      const name = nameMatch[2]?.toLowerCase() ?? '';
      if (TRACKER_META_NAMES.includes(name)) {
        counts.metas++;
        return '';
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

  // 7. Подчищаем пустые строки, оставшиеся после удалений (косметика)
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
// Main
// ─────────────────────────────────────────────────────────────────────────────

async function cleanSite(siteDir: string): Promise<CleanStats> {
  const stats: CleanStats = {
    htmlFilesProcessed: 0,
    scriptsRemoved: 0,
    inlineScriptsRemoved: 0,
    noscriptsRemoved: 0,
    linksRemoved: 0,
    metasRemoved: 0,
    jsonLdRemoved: 0,
    externalDirsRemoved: 0,
    bytesBefore: 0,
    bytesAfter: 0,
  };

  // Проходим по всем HTML-файлам
  for await (const file of walkFiles(siteDir)) {
    const ext = extname(file).toLowerCase();
    if (ext !== '.html' && ext !== '.htm') continue;

    const before = await readFile(file, 'utf8');
    stats.bytesBefore += before.length;

    const { html: after, counts } = cleanHtml(before);
    if (after !== before) {
      await writeFile(file, after, 'utf8');
    }
    stats.bytesAfter += after.length;
    stats.htmlFilesProcessed++;
    stats.scriptsRemoved += counts.scripts;
    stats.inlineScriptsRemoved += counts.inlineScripts;
    stats.noscriptsRemoved += counts.noscripts;
    stats.linksRemoved += counts.links;
    stats.metasRemoved += counts.metas;
    stats.jsonLdRemoved += counts.jsonLd;
  }

  // Удаляем папки _external/<tracker-host>/
  stats.externalDirsRemoved = await removeTrackerExternals(siteDir);

  return stats;
}

function printUsageAndExit(): never {
  console.error('Usage: npm run clean -- <siteDir>');
  process.exit(1);
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  if (args.length < 1) printUsageAndExit();
  const siteDir = resolve(args[0]!);

  const s = await stat(siteDir).catch(() => null);
  if (!s || !s.isDirectory()) {
    console.error(`[clean-site] Не директория: ${siteDir}`);
    process.exit(1);
  }

  console.log(`[clean-site] Site: ${siteDir}`);
  const start = Date.now();
  const stats = await cleanSite(siteDir);
  const seconds = ((Date.now() - start) / 1000).toFixed(1);

  console.log('');
  console.log(`[clean-site] Готово за ${seconds}s`);
  console.log(`[clean-site] HTML обработано:        ${stats.htmlFilesProcessed}`);
  console.log(`[clean-site] <script src> удалено:   ${stats.scriptsRemoved}`);
  console.log(`[clean-site] inline <script> удалено: ${stats.inlineScriptsRemoved}`);
  console.log(`[clean-site] <noscript> удалено:     ${stats.noscriptsRemoved}`);
  console.log(`[clean-site] <link> удалено:         ${stats.linksRemoved}`);
  console.log(`[clean-site] <meta> удалено:         ${stats.metasRemoved}`);
  console.log(`[clean-site] JSON-LD удалено:        ${stats.jsonLdRemoved}`);
  console.log(`[clean-site] _external/ удалено:     ${stats.externalDirsRemoved}`);
  const reduction = stats.bytesBefore - stats.bytesAfter;
  const pct = stats.bytesBefore > 0 ? ((reduction / stats.bytesBefore) * 100).toFixed(1) : '0.0';
  console.log(
    `[clean-site] HTML размер: ${stats.bytesBefore} → ${stats.bytesAfter} байт (-${reduction}, ${pct}%)`,
  );
}

main().catch((err) => {
  console.error('[clean-site] Fatal:', err);
  process.exit(1);
});
