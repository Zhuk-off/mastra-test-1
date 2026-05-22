# Логика очистки лендинга (clean-site)

> Этот документ описывает точное поведение очистки на основе кода в `src/mastra/cleaners/`.
> Любое изменение логики должно сопровождаться обновлением этого файла.

---

## 1. Общее назначение

Очистка удаляет из скачанного лендинга всё, что связано с:
- **Веб-аналитикой и трекерами** (Google Analytics, GTM, Facebook Pixel, Yandex.Metrika, TikTok, Clarity и др.)
- **Внешними виджетами** (чаты, cookie-баннеры, попапы)
- **Source maps**
- **Обфусцированным/подозрительным JS**
- **Редиректами и офферными ссылками**

**Что остаётся нетронутым:** собственные стили, изображения, шрифты, локальные скрипты лендинга, HTML-разметка, формы (если не зависят от удалённых трекеров).

---

## 2. Архитектура

```
pipeline.ts          — оркестратор: walk файлов, вызов passes, агрегация stats
passes/html/*.ts     — 12 чистых функций (HtmlPass), обрабатывают строку HTML
passes/svg/*.ts      — файловая обработка .svg
passes/js/*.ts       — 3 анализатора + композитор cleanJsFile
passes/css/*.ts      — 2 анализатора + композитор cleanCssFile
passes/fs/*.ts       — удаление папок и файлов после обработки контента
registry/*.ts        — справочники хостов, ключевых слов, паттернов
utils/*.ts           — хелперы (URL, offer-detector, walk, changelog)
```

---

## 3. Порядок обработки файлов

`pipeline.ts` рекурсивно обходит `siteDir`. Для каждого файла:

1. `.html` / `.htm` / `.php` → 12 HTML-проходов
2. `.svg` → SVG-проход
3. `.js` / `.mjs` → JS-проходы
4. `.css` → CSS-проходы

После обхода:
5. FS: удаление `_external/<tracker-host>/`
6. FS: удаление `.map` + strip `sourceMappingURL`
7. Запись `clean-site-changes.log`

---

## 4. HTML/PHP — 12 проходов

**Критически важно:** порядок зафиксирован. Изменение порядка = изменение поведения.

### 4.1. `removeTrackerScripts` — внешние скрипты

**Что ищет:** `<script src="...">`

**Удаляет, если `src` указывает на трекер.** Проверка идёт в 4 этапа:

1. **Путевое совпадение** — если в `TRACKER_HOSTS` есть запись с `/` (например, `facebook.com/tr`), ищем её как подстроку в URL.
2. **Hostname** — для абсолютных URL (`http://`, `https://`, `//`) извлекаем хост и проверяем по `TRACKER_HOSTS` (точное совпадение или поддомен).
3. **`_external/`** — если путь содержит `_external/<host>/`, извлекаем `<host>` и проверяем по `TRACKER_HOSTS`.
4. **Имя файла** — для относительных URL берём basename и проверяем по `TRACKER_FILENAME_PATTERNS`.

**Оставляет:** локальные скрипты (`./main.js`, `/js/lib.js`), CDN-скрипты из доверенных хостов.

### 4.2. `removeTrackerJsonLd` — JSON-LD трекеры

**Что ищет:** inline `<script type="application/ld+json">` без `src=`.

**Удаляет, если внутри:**
- `googletagmanager`, `google-analytics`, `gtm-` (case-insensitive)
- Или структура `"@type": "WebSite"` с `"potentialAction"` → `"SearchAction"` (schema.org трекер)

**Оставляет:** обычные JSON-LD (Organization, Product, FAQ и т.д.), если не содержат трекерных слов.

### 4.3. `removeInlineTrackers` — inline-скрипты

**Что ищет:** `<script>` без `src=` и без `type="application/ld+json"`.

**Удаляет, если тело скрипта содержит любое ключевое слово из `TRACKER_INLINE_KEYWORDS`:**

- Google: `gtag(`, `GoogleAnalyticsObject`, `_gaq.push`, `dataLayer.push`
- Facebook: `fbq(`, `!function(f,b,e,v,n,t,s)`, `connect.facebook.net`
- Yandex: `ym(`, `(function(m,e,t,r,i,k,a)`, `yandex_metrika`
- Hotjar/Mixpanel/Segment/Amplitude/Intercom: `hjid`, `mixpanel`, `analytics.load`, `amplitude.getInstance`, `Intercom(`
- Прочее: `PostAffTracker`, `OptiMonk`, `SplitHero`, `crazyegg`, `_paq.push`, `_hsq.push`
- CloudFlare: `beacon.min.js`, `cf-beacon`
- Microsoft Clarity: `clarity(`, `window.clarity`
- LinkedIn: `_linkedin_data_partner_id`, `lintrk(`
- Twitter/X: `twq(`
- Cookie consent: `CookieConsent`, `Cookiebot`, `OneTrust`, `OptanonWrapper`
- Heap: `heap.load(`, `window.heap`
- VK: `VK.Retargeting`
- Zendesk/LiveChat: `zE(`, `zEmbed`, `LiveChatWidget`

**Оставляет:** inline-скрипты лендинга (валидация форм, слайдеры, меню), если не содержат этих ключевых слов.

### 4.4. `removeNoscriptTrackers` — noscript-блоки

**Что ищет:** `<noscript>...</noscript>`.

**Удаляет, если внутри (case-insensitive) есть любое слово из `TRACKER_NOSCRIPT_KEYWORDS`:**

- `google-analytics`, `googletagmanager`, `doubleclick`
- `facebook.com/tr`, `mc.yandex`, `tiktok.com`
- `bat.bing`, `clarity.ms`, `linkedin.com`
- `ads-twitter.com`, `cookiebot`, `onetrust`, `vk.com/rtrg`

**Оставляет:** `<noscript>` с простыми сообщениями "Please enable JavaScript".

### 4.5. `removeTrackerLinks` — трекерные link-теги

**Что ищет:** `<link ...>`.

**Удаляет, если:**
- `rel` = `dns-prefetch`, `preconnect`, `prefetch`, `preload` (список `PRECONNECT_RELS`)
- И `href` указывает на трекерный домен (проверка через `urlMatchesTracker`)

**Оставляет:** `stylesheet` (даже внешний — не трогаем), `icon`, `canonical`, `alternate`, `pingback`, RSS/oembed.

### 4.6. `removeTrackerMetas` — верификационные meta

**Что ищет:** `<meta name="...">`.

**Удаляет, если `name` в списке `TRACKER_META_NAMES`:**

- `google-site-verification`
- `msvalidate.01`
- `yandex-verification`
- `facebook-domain-verification`
- `p:domain_verify`
- `norton-safeweb-site-verification`
- `alexaVerifyID`
- `wot-verification`

**Оставляет:** `description`, `keywords`, `viewport`, `charset`, `robots`, Open Graph (`og:*`), Twitter Cards.

### 4.7. `removeMetaRefresh` — meta-редиректы

**Что ищет:** `<meta http-equiv="refresh">`.

**Удаляет, если:**
- `content` содержит `url=...` и этот URL — внешний (`isExternalUrl`)
- Или `content` вообще не содержит `url=` (безусловный refresh)

**Оставляет:** meta-refresh на внутренние страницы (если URL не внешний).

### 4.8. `removeTrackerIframes` — трекерные iframe

**Что ищет:** `<iframe src="...">`.

**Удаляет, если `src` указывает на трекер** (проверка `urlMatchesTracker`).

**Счётчик:** `scriptsRemoved` (для совместимости с оригинальным поведением).

**Оставляет:** iframe с YouTube/Vimeo (если хост не в `TRACKER_HOSTS`), карты, виджеты соцсетей (если хост в `TRUSTED_HOSTS`).

### 4.9. `removeImgPixels` — трекинг-пиксели

**Что ищет:** `<img src="...">`.

**Удаляет, если `src` указывает на трекер** (`urlMatchesTracker`).

**Примечание:** не проверяет размеры изображения. Типичные пиксели (1×1, 0×0) удаляются через совпадение хоста/имени файла.

**Оставляет:** обычные изображения, фото, иконки.

### 4.10. `removeBase` — base href

**Что ищет:** `<base ...>`.

**Удаляет unconditionally** — любой `<base>` тег вырезается полностью.

**Оставляет:** ничего. Всегда удаляет.

### 4.11. `removeObjectEmbed` — object/embed

**Что ищет:** `<object ...>` и `<embed src="...">`.

**`<object>` — удаляет безусловно** (любой `<object>` тег вырезается).

**`<embed>` — удаляет, только если `src` — внешний URL** (`isExternalUrl`).

**Оставляет:** `<embed>` с локальными ресурсами (PDF, Flash и т.д. внутри сайта).

### 4.12. `removeFrames` — frame/frameset/noframes

**Что ищет:** `<frameset ...>`, `<frame ...>` и `<noframes ...>`.

**Удаляет безусловно** — любые устаревшие frame-элементы вырезаются полностью.

**Оставляет:** ничего. Всегда удаляет.

### 4.13. `replaceLocalLibsWithCdn` — локальные библиотеки → CDN

**Что ищет:** `<script src="...">` и `<link rel="stylesheet" href="...">` с относительными путями.

**Заменяет на CDN, если имя файла совпадает с известной библиотекой:**
- **jQuery**: `jquery-3.5.1.min.js`, `jquery-3.6.0.min.js` и т.д. → `https://code.jquery.com/jquery-{version}.min.js`
- **Bootstrap JS**: `bootstrap-5.3.2.min.js`, `bootstrap-5.3.2.bundle.min.js` → `https://cdn.jsdelivr.net/npm/bootstrap@{version}/dist/js/bootstrap.bundle.min.js`
- **Bootstrap CSS**: `bootstrap-5.3.2.min.css` → `https://cdn.jsdelivr.net/npm/bootstrap@{version}/dist/css/bootstrap.min.css`
- **Popper.js**: `popper-2.11.8.min.js` → `https://cdn.jsdelivr.net/npm/@popperjs/core@{version}/dist/umd/popper.min.js`

**Для каждой замены:**
1. Определяет версию из имени файла (regex).
2. Читает локальный файл и вычисляет SHA-384.
3. Формирует `integrity="sha384-..." crossorigin="anonymous"`.

**Оставляет:** неизвестные библиотеки, скрипты без версии в имени файла, абсолютные URL.

### 4.14. `replaceOfferLinks` — замена офферных ссылок

**Что ищет:** `<a href="...">`.

**Заменяет `href` на `{offer}`, если:**

1. URL — абсолютный (`http://`, `https://`, `//`).
2. Декодирует `&amp;` → `&`.
3. Домен **отличается** от `mainHost` (домена лендинга) и **не** входит в `TRUSTED_HOSTS`.
4. Или домен тот же, но путь/параметры содержат офферные паттерны (`OFFER_URL_PATTERNS`).
5. При этом путь **не** совпадает с информационными страницами (`NON_OFFER_PATH_PATTERNS`).

**Офферные паттерны:** `_lp=`, `_token=`, `click_id=`, `subid=`, `affiliate=`, `offer=`, `order=`, `checkout=`, `buy=`, `redirect=`, `goto=`, `campaign=`, `adset=`, `pixel=`, `fbclid=`, `utm_`, `/click/`, `/redirect/`, `/go/`, `/offer/`, `/order/`, `/checkout/`, `/buy/`.

**Информационные страницы (не трогаем):** `/privacy*`, `/policy*`, `/terms*`, `/contact*`, `/about*`, `/faq*`, `/help*`, `/support*`, `/blog*`, `/news*`, `/wp-content/*`, `/wp-admin/*`.

**Оставляет:** внутренние ссылки, ссылки на trusted-хосты (CDN, Google Fonts, соцсети), информационные страницы.

### 4.15. `stripEventAttrs` — event-атрибуты

**Что ищет:** HTML-атрибуты из списка `DANGEROUS_EVENT_ATTRS`.

**Удаляет атрибут целиком, если его значение:**
- Содержит `http://` или `https://`
- Или содержит любое ключевое слово из `TRACKER_INLINE_KEYWORDS`

**Список атрибутов:** `onclick`, `ondblclick`, `onmousedown`, `onmouseup`, `onmouseover`, `onmouseout`, `onmousemove`, `onkeydown`, `onkeyup`, `onkeypress`, `onload`, `onunload`, `onabort`, `onerror`, `onresize`, `onscroll`, `onfocus`, `onblur`, `onchange`, `onsubmit`, `onreset`, `onselect`, `oncontextmenu`, `oninput`, `oninvalid`, `onsearch`.

**Оставляет:** event-атрибуты с локальными вызовами функций (`onclick="openModal()"`), если они не содержат трекерных ключевых слов и не являются URL.

### 4.16. Финальная косметика

После всех 14 проходов схлопываются тройные (и более) пустые строки в двойные.

---

## 5. SVG — `cleanSvgFile`

Обрабатывает каждый `.svg` файл:

1. Удаляет `<script>...</script>` (любой inline JS в SVG).
2. Удаляет `<foreignObject>...</foreignObject>`.
3. Удаляет event-атрибуты (`onload`, `onclick` и т.д.) в SVG-разметке.
4. Удаляет `xlink:href` на внешние URL (`isExternalUrl`).

**Оставляет:** локальные `xlink:href`, векторную графику, стили внутри SVG.

---

## 6. JS — `cleanJsFile`

Обрабатывает каждый `.js` / `.mjs` файл через три анализатора:

### 6.1. `removeServiceWorker`

**Удаляет:** `navigator.serviceWorker.register(...)` с последующим `.then(...)`.

**Оставляет:** всё остальное.

### 6.2. `removeEvalObfuscation`

**Удаляет:**
- `eval(atob(...))`, `eval(unescape(...))`, `eval(decodeURIComponent(...))`
- `eval("...")` где строка — base64 (>40 символов, `[A-Za-z0-9+/]`)

**Оставляет:** обычный `eval` с читаемыми строками, нормальные вызовы функций.

### 6.3. `warnSuspiciousPatterns`

**Не удаляет ничего.** Только добавляет записи в `clean-site-changes.log` с пометкой `JS предупреждение`.

**Ищет:**
- `fetch(`, `new XMLHttpRequest(`, `navigator.sendBeacon(`, `new WebSocket(`
- `document.write(`, `localStorage.`, `sessionStorage.`
- `document.addEventListener('key...` (потенциальный кейлоггер)
- `atob(`, `String.fromCharCode(`
- `window.location =`, `location.href =`, `location.replace(`
- `navigator.clipboard.`, `postMessage(`

**Оставляет:** всё (это только предупреждение для ручной проверки).

---

## 7. CSS — `cleanCssFile`

### 7.1. `removeTrackerImports`

**Удаляет:** `@import url('https://tracker-host/...')` или `@import 'https://...'`.

**Условие:** URL — внешний (`isExternalUrl`).

**Оставляет:** локальные `@import`, внутренние CSS-ссылки.

### 7.2. `removeTrackerUrls`

**Заменяет:** `url('https://tracker-host/...')` на `url('')`.

**Условие:** URL совпадает с трекером (`urlMatchesTracker`).

**Оставляет:** `url()` на локальные шрифты, изображения, CDN из trusted-хостов.

---

## 8. Файловая система (после контента)

### 8.1. `removeTrackerExternals`

Удаляет папки `_external/<host>/`, если `<host>` совпадает с трекерным хостом из `TRACKER_HOSTS`.

**Оставляет:** `_external/` с доверенными хостами (Google Fonts, CDN и т.д. — если они не в `TRACKER_HOSTS`).

### 8.2. `removeSourceMaps`

1. Удаляет файлы `*.map`.
2. Strip-ает `//# sourceMappingURL=...` и `/*# sourceMappingURL=... */` из `.js` и `.css`.

**Оставляет:** всё остальное.

---

## 9. Реестры (registry)

### `TRACKER_HOSTS` (`registry/tracker-hosts.ts`)

~60 хостов трекеров/аналитики: Google (Analytics, Tag Manager, Ads, Optimize, DoubleClick), Yandex (Metrika), Facebook, Hotjar, CrazyEgg, Mixpanel, Segment, Amplitude, Intercom, HubSpot, Drift, Tawk, Crisp, OptiMonk, SplitHero, PostAffiliatePro, Cloudflare Insights, Snapchat, TikTok, Pinterest, Bing, Sentry, Microsoft Clarity, LinkedIn, Twitter/X, VK, Taboola, Outbrain, Cookiebot, OneTrust, LiveChat, Zendesk, Heap Analytics.

### `TRUSTED_HOSTS` (`registry/trusted-hosts.ts`)

Хосты, которые **не считаются трекерами**: `fonts.googleapis.com`, `fonts.gstatic.com`, `cdnjs.cloudflare.com`, `unpkg.com`, `jsdelivr.net`, `cdn.jsdelivr.net`, `ajax.googleapis.com`, `code.jquery.com`, `stackpath.bootstrapcdn.com`, `maxcdn.bootstrapcdn.com`, `kit.fontawesome.com`, `use.fontawesome.com`, `cdn.tailwindcss.com`.

### `TRACKER_FILENAME_PATTERNS` (`registry/tracker-filenames.ts`)

~40 паттернов имён файлов: `fbevents`, `gtag`, `gtm`, `ga.js`, `analytics.js`, `metrika`, `hotjar`, `mixpanel`, `amplitude`, `segment`, `intercom`, `postaffiliate`, `optimonk`, `clarity`, `pixel`, `beacon`, `tracker`, `tracking`, `retarget`, `conversion`, `remarketing`, `linkedin-insight`, `twq`, `tiktok-pixel`, `cookiebot`, `hubspot`, `livechat`, `zendesk`, `sentry`, `heap`, `vk-pixel`.

### `TRACKER_INLINE_KEYWORDS` / `TRACKER_NOSCRIPT_KEYWORDS`

См. раздел 4.3 и 4.4.

### `TRACKER_META_NAMES`

См. раздел 4.6.

### `DANGEROUS_EVENT_ATTRS`

См. раздел 4.13.

### `OFFER_URL_PATTERNS` / `NON_OFFER_PATH_PATTERNS`

См. раздел 4.12.

### `JS_WARNING_PATTERNS`

См. раздел 6.3.

### `PRECONNECT_RELS`

`dns-prefetch`, `preconnect`, `prefetch`, `preload`.

---

## 10. Что точно оставляем

| Категория | Примеры |
|-----------|---------|
| Локальные скрипты | `./main.js`, `/assets/app.js` |
| Trusted CDN | Google Fonts, FontAwesome, jQuery CDN, Bootstrap CDN, jsDelivr, unpkg, Tailwind CDN |
| Стили | `.css`, inline `<style>`, `@import` на локальные файлы |
| Изображения | `.jpg`, `.png`, `.webp`, `.gif`, `.svg` (кроме трекерных src в `<img>`) |
| Шрифты | `.woff2`, `.woff`, `.ttf` |
| Видео/аудио | `<video>`, `<audio>` (не трогаем) |
| Формы | `<form>`, `<input>`, `<button>` (не трогаем) |
| Обычные ссылки | Внутренние, trusted-хосты, информационные страницы |
| Обычные meta | `description`, `viewport`, `charset`, `robots`, Open Graph |
| Обычные link | `stylesheet`, `icon`, `canonical`, `alternate` |
| Обычные inline-скрипты | Валидация, слайдеры, анимации (без трекерных ключевых слов) |
| Обычные event-атрибуты | `onclick="toggleMenu()"` (без URL и трекеров) |
| Обычные JSON-LD | Organization, Product, FAQ (без GTM/Analytics) |

---

## 11. Статистика и логи

### Статистика (`CleanStats`)

Поля счётчиков `CleanStats`:

**Базовые:**
- `htmlFilesProcessed` / `phpFilesProcessed`
- `scriptsRemoved` — `<script src>` + `<iframe>` (tracker)
- `inlineScriptsRemoved` — inline `<script>` (tracker)
- `noscriptsRemoved` — `<noscript>` (tracker)
- `linksRemoved` — `<link rel="preconnect/...">` (tracker)
- `metasRemoved` — `<meta name>` (верификации)
- `jsonLdRemoved` — JSON-LD (tracker)
- `imgPixelsRemoved` — `<img>` (tracker)
- `metaRefreshRemoved` — `<meta http-equiv="refresh">`
- `baseHrefRemoved` — `<base>`
- `objectEmbedsRemoved` — `<object>` (все) / `<embed>` (внешние)
- `framesRemoved` — `<frame>` / `<frameset>` / `<noframes>`
- `localLibsReplaced` — локальные библиотеки заменены на CDN
- `eventAttrsRemoved` — event-атрибуты (tracker)
- `svgFilesProcessed` / `svgItemsRemoved`
- `jsFilesScanned` / `jsItemsRemoved`
- `cssFilesScanned` / `cssItemsRemoved`
- `externalDirsRemoved` — `_external/<tracker>/`
- `sourceMapsDeleted` — `.map` файлы
- `sourceMapRefsStripped` — `sourceMappingURL` убрано
- `offerLinksReplaced` — ссылки заменены на `{offer}`
- `bytesBefore` / `bytesAfter` — размер HTML/PHP до и после

**Advanced (`--advanced` only):**
- `inlineExfilRemoved` — inline exfil-вызовов удалено из HTML-скриптов
- `metricFilesRemoved` — JS-файлы удалены как трекерные (по AST)
- `obfuscatedFilesRemoved` — JS-файлы удалены как обфусцированные
- `partialJsCleaned` — JS-файлов частично очищено (exfil-функции удалены)
- `unversionedLibsCdn` — библиотек без версии заменено на CDN
- `detectorWarnings` — предупреждений от детекторов (keylogger, redirect, PHP)
- `phpBackdoorWarning` — `true` если найдены PHP-бэкдоры

**Coverage (`--coverage` only):**
- `deadJsFilesRemoved` — мёртвых JS-файлов удалено (0% coverage)

### Лог изменений

`clean-site-changes.log` в корне сайда. Формат TSV:

```
Файл | Строка | Тип изменения | Описание | Код
```

Записываются: удалённые JS-элементы, CSS `@import`, CSS `url()`, JS предупреждения.

---

## 12. CLI

```bash
npm run clean -- <siteDir> [--no-backup] [--advanced] [--coverage] [--coverage-threshold=<percent>]
```

По умолчанию создаёт `siteDir_backup` перед очисткой.

| Флаг | Описание |
|------|----------|
| `--no-backup` | Не создавать резервную копию |
| `--advanced` | Включить AST-анализ JS (этапы 2–7): metric files, obfuscation, exfil extraction, inline exfil, unversioned libs, PHP backdoors |
| `--coverage` | Playwright coverage analysis — обнаружение и удаление мёртвых JS-файлов (медленно, 15–30 сек) |
| `--coverage-threshold=N` | Порог покрытия % ниже которого файл считается мёртвым (по умолчанию 1) |

---

## 13. Advanced JS-анализ (`--advanced`)

Включается флагом `--advanced`. Без него все эти проходы пропускаются.

### 13.1. `removeInlineExfilPass` (HTML, AST)

**Что делает:** В inline `<script>` блоках хирургически удаляет exfil-вызовы через `magic-string`, сохраняя остальной код.

**Удаляет:**
- `fetch('https://external...')` — внешний хост
- `navigator.sendBeacon(url)` — внешний хост
- `new WebSocket('wss://external...')` — внешний хост
- `new Image().src = 'https://...'` — tracking pixel
- Вызовы трекерных глобалов: `fbq(...)`, `gtag(...)`, `ym(...)` и др. (из `SUSPICIOUS_CALL_GLOBALS`)

**Оставляет:** `fetch('/api/...')` (внутренний), `fetch('https://fonts.googleapis.com/...')` (trusted), весь остальной код скрипта.

### 13.2. Unversioned libs → CDN (pre-scan)

**Что делает:** Pre-scan всех `.js` файлов без версии в имени. Определяет библиотеку по сигнатуре (первые 4 КБ). Передаёт карту в `replaceLocalLibsWithCdn`.

**Определяет:** jQuery, Bootstrap, Popper.js, Swiper, Lodash.

### 13.3. `detectMetricFile` (JS, AST)

**Что делает:** Удаляет JS-файлы, которые **только** регистрируют трекерные глобалы (`fbq`, `gtag`, `ym` и др.) без полезного кода.

**Критерии:** Присвоение `window.X` где X — трекерный глобал + нет `addEventListener`, `querySelector`, `module.exports`.

### 13.4. `detectObfuscation` (JS)

**Что делает:** Удаляет целиком JS-файлы с обфускацией.

**Признаки:** >15% идентификаторов вида `_0x...`, или `eval(function(p,a,c,k...`, или `String['fromCharCode']`.

### 13.5. `extractUsefulFunctions` (JS, AST)

**Что делает:** Из JS-файлов вырезает функции, которые **только** делают exfil-вызовы.

**Пример удаляемой:** `function trackPageView() { fbq('track', 'PageView'); }`.

**Пример сохраняемой:** `function trackAndSubmit() { fbq('track', e); submitForm(); }` — смешанная логика.

### 13.6. Detector warnings (JS, AST)

**Только логируют (не удаляют):**
- `KEYLOGGER_WARN` — `addEventListener('keydown', fn)` + сетевой вызов внутри
- `REDIRECT_WARN` — `window.location = 'https://external...'`

**Удаляют:**
- `DOC_WRITE_SCRIPT` — `document.write('<script src="https://external...">')` 

### 13.7. PHP backdoor scanner

**Что делает:** Сканирует `.php` файлы на паттерны бэкдоров. Только WARN, не удаляет.

**Паттерны:** `eval($_POST)`, `assert($_GET)`, `system($user_input)`, `preg_replace /e`, `gzinflate(base64_decode(...))`, `move_uploaded_file`, `passthru($_POST)`.

---

## 14. Coverage-based dead file detection (`--coverage`)

Запускает Playwright (headless Chromium), поднимает локальный HTTP-сервер, собирает JS-покрытие при автоскролле + кликах. Файлы с 0% покрытия без event-handlers — удаляются. Файлы с `addEventListener` — защищены (lazy-init).

---

## 15. Visual diff (`verifyVisualDiff`)

Утилита `verify-visual.ts` делает скриншоты до и после через Playwright, сравнивает через `pixelmatch` (порог 0.1), сохраняет diff-изображение. Используется для визуальной проверки отсутствия регрессий.
