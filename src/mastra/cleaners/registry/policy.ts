/**
 * Единый источник правды для политики очистки (allowlist + контейнмент).
 *
 * Здесь два РАЗНЫХ списка, не путать:
 *  - TRUSTED_LIB_CDNS — куда репинятся / откуда допускаются БИБЛИОТЕКИ.
 *  - CSP_META — финальная политика страницы (вкл. вашу аналитику), применяется
 *    как страховка в браузере. Аналитика (*.clarity.ms, *.bing.com, facebook)
 *    в TRUSTED_LIB_CDNS НЕ входит: в скачанном чужом лендинге это трекер прежнего
 *    владельца и должен удаляться; свою аналитику вы добавляете уже после очистки.
 */

/** Доверенные CDN для библиотек/шрифтов. Скрипты/стили только отсюда (или local). */
export const TRUSTED_LIB_CDNS = new Set<string>([
  'cdn.jsdelivr.net',
  'code.jquery.com',
  'cdnjs.cloudflare.com',
  'unpkg.com',
  'cdn.tailwindcss.com',
  'vjs.zencdn.net',
  'fonts.googleapis.com',
  'fonts.gstatic.com',
  'ajax.googleapis.com',
  'stackpath.bootstrapcdn.com',
  'maxcdn.bootstrapcdn.com',
]);

/**
 * Мультитенантные CDN: один хост раздаёт чужой контент, тенант определяется ПУТЁМ
 * (`/gh/<user>/<repo>` — любой GitHub-репо; `/npm/<pkg>`, unpkg — любой npm-publish).
 * Доверять им по одному ХОСТУ нельзя (AL-3/CDN-1) — путь сверяется с TRUSTED_CDN_PACKAGES.
 *
 * cdnjs.cloudflare.com СОЗНАТЕЛЬНО не здесь: он курируем (либы добавляются через ревью,
 * произвольный аплоад невозможен), поэтому доверие по хосту для него приемлемо.
 */
export const MULTITENANT_CDNS = new Set<string>(['cdn.jsdelivr.net', 'unpkg.com']);

/**
 * Имена npm-пакетов, которым доверяем на мультитенантных CDN (нижний регистр). Это ровно
 * то, на что мы РЕПИНИМ (cdn-libraries.ts) + jQuery + пара частых в лендингах. Неизвестный
 * пакет/`/gh/` → карантин (default-deny; восстановимо). Расширяйте по мере необходимости —
 * держите в синхроне с `CDN_LIBRARIES`.
 */
export const TRUSTED_CDN_PACKAGES = new Set<string>([
  'jquery',
  'bootstrap',
  '@popperjs/core',
  'popper.js',
  'swiper',
  'slick-carousel',
  'owl.carousel',
  'aos',
  'gsap',
  'lodash',
  '@fortawesome/fontawesome-free',
  'font-awesome',
  'animate.css',
  'normalize.css',
]);

/** Ваша инфраструктура для картинок/медиа (img-src / media-src). */
export const OWN_ASSET_HOSTS = new Set<string>([
  'd4tncaiqdi48w.cloudfront.net',
  'hurryholebucket.s3.eu-west-3.amazonaws.com',
]);

/** Объединение — для общей проверки «внешний ли это URL» (isExternalUrl/isTrustedHost). */
export const ALL_TRUSTED_HOSTS = new Set<string>([
  ...TRUSTED_LIB_CDNS,
  ...OWN_ASSET_HOSTS,
]);

/**
 * CSP-страховка, внедряется в <head> как <meta http-equiv>.
 * Источник: рабочий шаблон владельца. Правится здесь, в одном месте.
 *
 * POL-2: `script-src` разрешает весь `https://cdn.jsdelivr.net` (CSP по хосту не умеет
 * надёжно ограничивать путь). Это лишь defense-in-depth: фактический контроль —
 * `classifyResource` (AL-3), который ещё на этапе очистки убирает/карантинит
 * непривилегированные пути jsdelivr (`/gh/`, неизвестные пакеты) до выкладки. То есть до
 * браузера «плохой» jsdelivr-URL не доходит, и широкое CSP-разрешение по нему не страшно.
 */
export const CSP_META =
  `<meta http-equiv="Content-Security-Policy" content="` +
  `default-src 'self'; ` +
  `object-src 'none'; ` +
  `frame-src 'self'; ` +
  `form-action 'self'; ` +
  `script-src 'self' 'unsafe-inline' https://cdn.tailwindcss.com https://cdn.jsdelivr.net https://code.jquery.com https://vjs.zencdn.net https://*.clarity.ms https://*.bing.com; ` +
  `worker-src 'self' blob:; ` +
  `style-src 'self' 'unsafe-inline' https://fonts.googleapis.com https://vjs.zencdn.net; ` +
  `font-src 'self' data: https://fonts.googleapis.com https://fonts.gstatic.com https://vjs.zencdn.net; ` +
  `media-src 'self' blob: https://d4tncaiqdi48w.cloudfront.net https://hurryholebucket.s3.eu-west-3.amazonaws.com; ` +
  `img-src 'self' data: https://d4tncaiqdi48w.cloudfront.net https://hurryholebucket.s3.eu-west-3.amazonaws.com https://www.facebook.com https://*.clarity.ms https://*.bing.com; ` +
  `connect-src 'self' blob: https://d4tncaiqdi48w.cloudfront.net https://hurryholebucket.s3.eu-west-3.amazonaws.com https://*.clarity.ms https://*.bing.com;` +
  `" />`;

/** Поведение чистильщика. */
export const POLICY = {
  /** Что делать с сомнительным (внешний хост вне белого списка, неузнанный код). */
  onUncertain: 'quarantine' as 'quarantine' | 'remove',
  /** Известные трекеры удалять автоматически. */
  autoRemoveKnownTrackers: true,
  /** Узнаваемые библиотеки репинить на официальный CDN + SRI. */
  repinLibraries: true,
} as const;

// ─────────────────────────────────────────────────────────────────────────
// МАКРОСЫ
// На этапе ОЧИСТКИ: наши макросы сохраняем, чужие — нормализуем/выносим в отчёт.
// Подстановку значений (offername/offerimage по вертикали) делает этап АДАПТАЦИИ.
// См. docs/macro-and-localization-policy.md
// ─────────────────────────────────────────────────────────────────────────

/**
 * Наши макросы — трекер подставит значения. Всё остальное в {...} — чужое.
 *
 * Раньше здесь была регулярка `/^\{_offer_value:[^}]*\}$/i`, которая ловила
 * ЛЮБОЕ `{_offer_value:...}`. Мы убрали её, чтобы контролировать точный
 * список макросов вручную и не пропускать неожиданные токены от трекера.
 *
 * Если трекер добавит новые поля (например `{_offer_value:offerdesc}`) и
 * вы захотите вернуть автоматический захват всего семейства — замените
 * `isOwnMacro` на:
 *   return OWN_MACROS.has(token) || /^\{_offer_value:[^}]*\}$/i.test(token);
 */
export const OWN_MACROS = new Set<string>(['{offer}', '{_offer_value:offername}', '{_offer_value:offerimage}']);

/** Проверка: токен — наш макрос? */
export function isOwnMacro(token: string): boolean {
  return OWN_MACROS.has(token);
}

/**
 * Этап АДАПТАЦИИ (не очистки): базовый URL продуктового изображения по вертикали.
 * Вертикаль (Adult/WeightLoss) берётся из задачи/контекста.
 */
export const PRODUCT_IMAGE_BASE: Record<'Adult' | 'WeightLoss', string> = {
  Adult: 'https://d4tncaiqdi48w.cloudfront.net/Aquarium/Images/Adult/ProductImages/{_offer_value:offerimage}',
  WeightLoss: 'https://d4tncaiqdi48w.cloudfront.net/Aquarium/Images/WeightLoss/ProductImages/{_offer_value:offerimage}',
};

/** Этап адаптации: макрос названия товара. */
export const PRODUCT_NAME_MACRO = '{_offer_value:offername}';
