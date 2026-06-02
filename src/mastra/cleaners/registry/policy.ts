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
