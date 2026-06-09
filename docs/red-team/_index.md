# Red Team анализ чистильщика лендингов

Реестр и методология поэтапного red team разбора системы очистки (`src/mastra/cleaners/**`).
Цель — найти **пропущенные** случаи и уязвимости: где злоумышленник протащит кражу трафика мимо
очистки, и где легитимный (но необычный) лендинг сломается.

> ▶ **Начни с [`00-summary.md`](00-summary.md)** — корневые кластеры (мало фиксов → много находок) и
> приоритетный порядок работ. Этот файл — детальный реестр.

## Методология: три угла на каждый файл

Мы red-team'им **чистильщик**, не лендинг. На каждый исходник смотрим под тремя углами:

- 🔴 **Bypass (наступление).** Я — автор зловредного лендинга. Как протащить макрос / exfil /
  редирект / трекер мимо этого прохода? Где спрятать payload, чтобы проход его не увидел?
- 🟡 **Robustness (сопутствующий урон).** Легитимный, но кривой лендинг (нет `<html>`/doctype,
  битая вёрстка, другая кодировка, гигантский файл, повторный прогон) — проход ломает страницу
  или падает?
- 🟢 **Soundness (точность детектора).** Ложные срабатывания (выкинули нужное) и пропуски
  (не заметили угрозу), и последствия каждого.

## Шкала severity

| Severity | Критерий |
|----------|----------|
| 🟥 Critical | Кража трафика/выполнение чужого кода переживает очистку «по умолчанию», без экзотики; либо очистка молча уничтожает рабочий лендинг |
| 🟧 High | Реалистичный обход или поломка при достижимом входе |
| 🟨 Medium | Нужны особые условия, или урон ограничен (FP/FN с умеренным эффектом) |
| 🟩 Low | Маловероятно или мелкий эффект; больше «гигиена» |

## Формат находки

```
[ID] 🔴/🟡/🟢 Категория · Severity · короткий заголовок
Сценарий:    конкретный вход (что подаём)
Сейчас:      что делает код (ссылка на файл:строку)
Последствие: что происходит в результате
Рекомендация: направление фикса
Уверенность: подтверждено чтением кода / гипотеза (проверить в …)
```

Каждая находка живёт в файле того исходника, **где должен лежать фикс**. Кросс-файловые
нити — в разделе «Сквозные нити» ниже, чтобы не потерять.

## Дорожная карта (по риску)

- [x] **Тир 0 · ядро белого списка** — [policy](policy.md), [url](url.md), [allowlist](allowlist.md)
- [x] **Тир 0 · оркестрация + DOM-ядро** — [pipeline](pipeline.md), [html-dom](html-dom.md)
- [x] **Тир 0 · структура** — [normalize-landing-structure](normalize-landing-structure.md)
- [x] **Тир 1 · репин/CDN** — [cdn-detector](cdn-detector.md), [unversioned-cdn](unversioned-cdn.md), [replace-local-libs-with-cdn](replace-local-libs-with-cdn.md)
- **Тир 2 · HTML-проходы** (порезан на подгруппы):
  - [x] **2a · allowlist по src** — [2a-allowlist-src](2a-allowlist-src.md) (scripts/iframes/img/links/inline/noscript)
  - [x] **2b · структурные** — [2b-structural](2b-structural.md) (base/object/frames/meta-refresh/metas/jsonld)
  - [x] **2c · макросы/оффер** — [2c-macros-offer](2c-macros-offer.md) (detect-macros, replace-offer-links, offer-detector)
  - [x] **2d · защитные** — [2d-defensive](2d-defensive.md) (strip-event-attrs, inject-csp, remove-inline-exfil-pass)
- **Тир 3 · JS/JS-advanced** (порезан на подгруппы):
  - [x] **3a · оркестрация JS** — [3a-js-orchestration](3a-js-orchestration.md) (clean-js, remove-eval-obfuscation, remove-service-worker, warn-suspicious)
  - [x] **3b · AST-ядро + inline-exfil** — [3b-ast-inline-exfil](3b-ast-inline-exfil.md) (ast/parse, index, remove-inline-exfil, extract-useful-functions)
  - [x] **3c · детекторы** — [3c-detectors](3c-detectors.md) (exfil-calls, redirect, keylogger, document-write, obfuscation, metric-file)
  - [x] **3d · coverage/visual** — [3d-coverage-visual](3d-coverage-visual.md) (collect-coverage, analyze-coverage, verify-visual)
- [x] **Тир 4 · CSS / SVG / PHP / FS** — [4-css-svg-php-fs](4-css-svg-php-fs.md) (clean-css/imports/urls, clean-svg, detect-php-backdoors, remove-tracker-externals, remove-source-maps)
- **Тир 5 · utils/registry/verify/tools** (порезан):
  - [x] **5a · utils-инфраструктура** — [5a-utils-infra](5a-utils-infra.md) (walk, quarantine, changelog, report)
  - [x] **5b · verify + tools** — [5b-verify-tools](5b-verify-tools.md) (verify-runtime, verify-site-tool, download-site-tool, clean-site-tool)
  - [x] **реестры (collective)** — [registries](registries.md) (tracker-hosts/keywords/filenames/meta-names/event-attrs/known-libs/etc.)

> 🏁 **Все тиры пройдены.** Корневые кластеры и приоритеты фиксов — в [`00-summary.md`](00-summary.md).

## Реестр находок

Статусы: 🆕 новая · 🔍 проверяется · 🛠 в работе · ✅ закрыта · 🚫 won't-fix.

| ID | Файл | Sev | Угол | Суть | Статус |
|----|------|-----|------|------|--------|
| AL-1 | allowlist.ts | 🟥 | Bypass | `data:`/`blob:`/`javascript:` в script/iframe → `keep` | ✅ |
| AL-2 | allowlist.ts | 🟧 | Bypass | Ведущие/внутренние пробел/таб/перевод строки обходят `isAbsoluteUrl` | ✅ |
| AL-3 | allowlist.ts | 🟧 | Bypass | Мультитенантные CDN (jsdelivr `/gh/`, unpkg) доверены пословно | 🆕 |
| AL-4 | allowlist.ts | 🟨 | Soundness | Плоский trust-set: font/CSS-хост доверен и для `script` | 🆕 |
| URL-1 | url.ts | 🟧 | Bypass | `extractHostname` для относительного URL возвращает `example.com` | 🆕 |
| URL-2 | url.ts | 🟨 | Soundness | Два оракула доверия расходятся (`isExternalUrl` vs `classifyResource`) | 🆕 |
| URL-3 | url.ts | 🟩 | Soundness | Подстрочный матч трекера → возможны FP (только remove↔quarantine) | 🆕 |
| URL-4 | url.ts | 🟩 | Bypass | Нет нормализации IDN/punycode (для keep безопасно, для remove — пропуск) | 🆕 |
| POL-1 | policy.ts | 🟧 | Soundness | CSP-«страховка» слаба: `script-src 'unsafe-inline'` + `img-src facebook` | 🆕 |
| POL-2 | policy.ts | 🟨 | Bypass | CSP доверяет мультитенантным CDN (jsdelivr/tailwind) | 🆕 |
| POL-3 | policy.ts | 🟨 | Robustness | Хосты/макросы захардкожены под одного владельца | 🆕 |
| POL-4 | policy.ts | 🟩 | Soundness | `isOwnMacro` регистрозависим (`{OFFER}` → чужой) | 🆕 |
| DOM-1 | html-dom.ts | 🟥 | Bypass/Robust | `hasServerTags` FP (`<%`, текст `<? `) → ВСЯ очистка пропущена | ✅ |
| DOM-2 | html-dom.ts | 🟨 | Robustness | cheerio фабрикует `html/head/body`, переписывает структуру | 🆕 |
| DOM-3 | html-dom.ts | 🟨 | Soundness | `<noscript>` = текст, DOM-селекторы не видят трекеры внутри | 🆕 |
| DOM-4 | html-dom.ts | 🟨 | Robustness | `</script>` в строке ломает round-trip | 🆕 |
| PIPE-1 | pipeline.ts | 🟥 | Bypass | Серверный тег → `applyHtmlPasses` тихо возвращает HTML как есть | ✅ |
| PIPE-2 | pipeline.ts | 🟧 | Bypass/Robust | Удаление `<script src>` регэкспом мимо DOM (query/`../`/self-close промахи) | ✅ |
| PIPE-3 | pipeline.ts | 🟨 | Robustness | Нет try/catch по файлу — один кривой файл роняет весь прогон | 🆕 |
| PIPE-4 | pipeline.ts | 🟨 | Bypass | Пост-обработка правит даже SKIP_DOM-нутые серверные файлы | ✅ |
| PIPE-6 | pipeline.ts | 🟨 | Robust/Perf | Сетевой репин-фетч в горячем цикле, фолбэк неясен | 🆕 |
| PIPE-5 | pipeline.ts | 🟩 | Low | `bytes*` = UTF-16 length; схлопывание `\n` задевает `<pre>` | 🆕 |
| NORM-1 | normalize-…ts | 🟥 | Bypass/Safety | Path traversal `../` → перенос+удаление файлов вне siteDir | ✅ |
| NORM-2 | normalize-…ts | 🟧 | Bypass/Robust | PHP-стрип только главного файла, требует `?>`; ASP/вторичные мимо | ✅ |
| NORM-3 | normalize-…ts | 🟧 | Robustness | Неполный сбор ссылок (lazy-load/poster/@import) + переезд → битые ссылки | 🆕 |
| NORM-4 | normalize-…ts | 🟨 | Robustness | Замена ссылок контекстно-слепа (бьёт inline-JS/meta) | 🆕 |
| NORM-5 | normalize-…ts | 🟨 | Robustness | `stripPhpCode` рвёт разметку (`href="<?…?>"` → `href=""`) | 🆕 |
| NORM-6 | normalize-…ts | 🟨 | Robustness | Выбор главного файла узкий (.html/.htm/.php) и недетерминирован | 🆕 |
| NORM-7 | normalize-…ts | 🟩 | Low | Пробел в URL; UTF-16 мисскоринг; `@import "x"` без url() | 🆕 |
| CDN-1 | cdn-detector.ts | 🟧 | Bypass | Генерик-репин отмывает чужой хост (`/npm`,`/gh`) в trusted jsdelivr | 🆕 |
| CDN-2 | cdn-detector.ts | 🟨 | Soundness | «Репин+SRI» = ложное чувство защиты (SRI ≠ происхождение) | 🆕 |
| CDN-3 | cdn-detector.ts | 🟨 | Soundness | Версия берётся из первого токена URL → мисверсия | 🆕 |
| CDN-4 | cdn-detector.ts | 🟨 | Robust/Perf | Кэш фиксирует сетевой сбой на весь прогон; нет TTL | 🆕 |
| CDN-5 | cdn-detector.ts | 🟩 | Low | Осиротевший локальный файл после hard-репина не удаляется | 🆕 |
| UCDN-1 | unversioned-cdn.ts | 🟧 | Robustness | SRI от ЛОКАЛЬНОГО файла, src→CDN → mismatch → блок скрипта | 🆕 |
| UCDN-2 | unversioned-cdn.ts | 🟨 | Robustness | Нет проверки существования CDN-URL (404 + mismatch) | 🆕 |
| UCDN-3 | unversioned-cdn.ts | 🟨 | Soundness | Версия из 4КБ + fallback → мисверсия минифицированных либ | 🆕 |
| UCDN-4 | unversioned-cdn.ts | 🟩 | Soundness | FP по баннеру (безопасно, но громко ломает через SRI) | 🆕 |
| RLL-1 | replace-local-libs…ts | 🟨 | Robustness | Ключ карты — сырой regex-URL, матч по cheerio → промах репина | 🆕 |
| RLL-2 | replace-local-libs…ts | 🟩 | Low | Ветка «без SRI: офлайн» фактически мёртвая | 🆕 |
| RLL-3 | replace-local-libs…ts | 🟨 | Архитектура | Полное доверие карте до allowlist — материализует CDN-1 | 🆕 |
| 2A-1 | remove-tracker-{scripts,iframes},img-pixels | 🟧 | Bypass | URL не нормализуется → whitespace-обход (AL-2, подтверждён) | ✅ |
| 2A-2 | remove-tracker-{scripts,iframes} | 🟧 | Bypass | `data:`/`javascript:` в src → keep (AL-1, в 2a не ловится) | ✅ |
| 2A-3 | remove-tracker-links | 🟨 | Bypass | preconnect/preload — блок-лист; modulepreload/мульти-rel мимо | 🆕 |
| 2A-4 | remove-noscript-trackers | 🟨 | Bypass | `<noscript>` allowlist-слеп: блок-лист → неизвестное выживает | 🆕 |
| 2A-5 | remove-inline-trackers | 🟨 | Soundness | Только вендор-сниппеты; кастомный inline-exfil не здесь (→2d) | 🆕 |
| 2B-1 | remove-base | 🟨 | Robustness | `<base>` вырезается вслепую + normalize base-неосведомлён → битые пути | 🆕 |
| 2B-2 | remove-meta-refresh | 🟨 | Bypass | Относительный и закавыченный url-refresh переживают | 🆕 |
| 2B-3 | remove-object-embed | 🟩 | Robustness | `<object>` с fallback удаляется целиком; embed наследует 2A | 🆕 |
| 2B-4 | remove-frames | 🟩 | Robustness | Настоящий frameset-лендинг → пустая страница | 🆕 |
| 2B-5 | remove-tracker-metas | 🟩 | Soundness | Узкий блок-лист (нет robots/индексации, `property=`) | 🆕 |
| 2B-6 | remove-tracker-jsonld | 🟩 | Soundness | Узко и инертно (regex по тексту, не JSON-parse) | 🆕 |
| MAC-1 | detect-macros | 🟨 | Soundness | Внешние `.js`/`.css` на макросы не сканируются (твой пример) | 🆕 |
| MAC-2 | detect-macros | 🟨 | Soundness | Только `{...}`; `[..]`/`%..%`/`{{..}}` мимо | 🆕 |
| MAC-3 | detect-macros | 🟨 | Soundness | Template-скрипты/непарсимый inline-JS пропускаются | 🆕 |
| MAC-4 | detect-macros | 🟩 | Soundness | В CSS макрос ищется только в `url()` (не `content:`) | 🆕 |
| MAC-5 | detect-macros | 🟩 | Soundness | Авто-`{offer}` только для `<a>`/`<area>` | 🆕 |
| OFFER-1 | offer-detector | 🟨 | Robustness | Любая внешняя не-trusted ссылка → `{offer}` (соцсети/правовые ломаются) | 🆕 |
| OFFER-2 | offer-detector | 🟨 | Soundness | Нераспознанный same-host оффер сохраняет ЧУЖОЙ URL | 🆕 |
| OFFER-3 | offer-detector | 🟩 | Soundness | Декод только `&amp;`; относительные офферы не ловятся | 🆕 |
| 2D-1 | allowlist.ts (сквозь) | 🟧 | Bypass | `data:`/`javascript:`/`blob:` в src/href не ловит НИКТО (T-3) | ✅ |
| 2D-2 | strip-event-attrs | 🟨 | Bypass | `on*` снимается только при литеральном url/keyword; обфускация мимо | 🆕 |
| 2D-3 | event-attrs.ts | 🟨 | Bypass | Реестр `on*` неполон — нет touch/pointer/wheel (mobile) | 🆕 |
| 2D-4 | inject-csp | 🟩 | Robustness | Размещение ок (T-4); но SKIP_DOM-файлы без CSP (← PIPE-1) | ✅ |
| 2D-5 | remove-inline-exfil-pass | 🟨 | Граница | Непарсимый inline-script молча пропущен; detect — Тир 3 | 🆕 |
| 2D-6 | replace-offer-links / new pass | 🟧 | Bypass | `<a href="javascript:/data:">` не проходит `classifyResource` → выживает (остаток C1: классификатор готов, проход не подключён) | 🆕 |
| CJS-1 | clean-js | 🟧 | Correctness | Устаревший AST: docWrite режет по смещённым позициям после extract | ✅ |
| CJS-2 | clean-js | 🟨 | Robustness | `detectObfuscation` удаляет весь файл (без карантина) — FP на минифик. либе | ✅ |
| CJS-3 | clean-js | 🟨 | Robustness | Парс не удался → все AST-детекторы молча пропущены | 🆕 |
| CJS-4 | clean-js | 🟨 | Robustness | regex SW/eval ломает JS → каскадом глушит AST | 🆕 |
| CJS-5 | clean-js | 🟨 | Soundness | Макросы во внешних `.js` не сканируются (T-8) | 🆕 |
| CJS-6 | clean-js | 🟩 | Soundness | warn-слой не гейтит выгрузку | 🆕 |
| EVAL-1 | remove-eval-obfuscation | 🟨 | Soundness | Узкая регулярка: `window.atob`/`new Function`/`(0,eval)` мимо | 🆕 |
| EVAL-2 | remove-eval-obfuscation | 🟨 | Robustness | Удаление eval в выражении ломает JS (`var x = eval…`) | 🆕 |
| SW-1 | remove-service-worker | 🟨 | Robustness | Вложенные скобки в register() корёжат JS | 🆕 |
| SW-2 | remove-service-worker | 🟩 | Soundness | Только литеральный `navigator.serviceWorker.register` | 🆕 |
| WARN-1 | js-warning-patterns | 🟩 | Robustness | `while(re.exec)` зависнет, если паттерн без `/g` (латентно) | 🆕 |
| PARSE-1 | ast/parse | 🟨 | Bypass | acorn не парсит Annex B `<!--` → AST-анализ пропущен | 🆕 |
| PARSE-2 | ast/parse | 🟨 | Robustness | Ошибка парса только в `console.warn`, не в отчёте | 🆕 |
| PARSE-3 | ast/parse | 🟩 | Robustness | module-first; нет лимита размера/времени парса | 🆕 |
| RIE-1 | remove-inline-exfil | 🟨 | Robustness | Удаление по узлу: `var x = fetch()` → `var x = ;` (зависит от 3c) | ✅ |
| EUF-1 | extract-useful-functions | 🟧 | Robustness | Удаляется объявление функции без мест вызова → ReferenceError | ✅ |
| EUF-2 | extract-useful-functions | 🟨 | Soundness | Внешние `.js`: режутся только целые функции, не рассыпанный exfil | ✅ |
| EUF-3 | extract-useful-functions | 🟩 | Soundness | Консервативные пропуски (мульти-декл/arrow-expr); узкий DOM-список | 🆕 |
| IDX-1 | js-advanced/index | 🟩 | Гигиена | Пустая заглушка (мёртвый плейсхолдер) | 🆕 |
| DET-1 | detectors (общее) | 🟧 | Bypass | Детект только ЛИТЕРАЛЬНОЙ строки-URL → вычисляемый URL мимо | 🆕 |
| DET-2 | detectors (общее) | 🟧 | Bypass | Только прямой вызов точной формы → алиас/`window.fetch`/`img.src` мимо | 🛠 |
| DET-3 | detectors (общее) | 🟨 | Bypass | `//host` обходит (new URL без базы); 3 копии isExternalUrl | ✅ |
| DEC-1 | detect-exfil-calls | 🟨 | Robustness | Узел = CallExpression → `var x=fetch()` → `var x=;` (T-9) | ✅ |
| DEC-2 | detect-exfil-calls | 🟨 | Soundness | Короткие `ga`/`hj`/`zE` → FP-удаление своей функции | ✅ |
| OBF-1 | detect-obfuscation | 🟨 | Soundness | 3 узкие сигнатуры: FN + FP-delete легит-минификата | 🛠 |
| MET-1 | detect-metric-file | 🟨 | Soundness | «Полезный код» = 5 подстрок → FP-delete файла с логикой | 🛠 |
| RED-1 | detect-redirect | 🟨 | Policy/FN | Редирект только WARN; `assign`/`top`/косвенность мимо | ✅ |
| KEY-1 | detect-keylogger | 🟨 | Policy/FN | Keylogger только WARN; `onkeydown=`-присваивание мимо | ✅ |
| DOC-1 | detect-document-write-script | 🟨 | Soundness | Только литерал + `<script src>`; склейка/iframe/img мимо | ✅ |
| COV-1 | collect/analyze-coverage | 🟧 | Robustness | Coverage удаляет интерактивный/утилитный JS как «мёртвый» | 🆕 |
| ANA-1 | analyze-coverage | 🟨 | Robustness | Непарсимый кандидат → «мёртвый» → удаление | 🆕 |
| COV-2 | collect-coverage | 🟨 | Robustness | Таймаут networkidle роняет весь cleanSite | 🆕 |
| COV-3 | collect-coverage | 🟩 | Security | `startsWith(siteDir)` — prefix-обход в статик-сервере | 🆕 |
| COV-4 | collect-coverage | 🟩 | Security | Исполняет остаточный JS (сеть наружу заблокирована) | 🆕 |
| VIS-2 | verify-visual | 🟨 | Robustness | Диф только вьюпорта (fullPage:false) — оффер ниже мимо | 🆕 |
| VIS-3 | verify-visual | 🟨 | Robustness | Скриншот без блока внешних → редирект/exfil искажает диф | 🆕 |
| VIS-1 | verify-visual | 🟩 | Гигиена | Не подключён в авто-очистку (утилита) | 🆕 |
| EXT-1 | remove-tracker-externals | 🟧 | Bypass | `_external/` ломает «relative=keep»: чужой хост выживает локально | ✅ |
| EXT-2 | remove-tracker-externals | 🟩 | Robustness | Висячие ссылки после удаления `_external/` | 🆕 |
| CSS-1 | remove-tracker-urls | 🟨 | Bypass | CSS `url()` — блок-лист; неизвестный внешний ресурс остаётся | 🆕 |
| CSS-2 | css (inline) | 🟨 | Bypass | Inline `<style>`/`style=` не чистятся от трекер-url() | 🆕 |
| CSS-3 | clean-css | 🟨 | Soundness | Макросы во внешнем CSS не сканируются (T-8) | 🆕 |
| CSS-4 | css | 🟩 | Bypass | `url(//evil)`/`@import //` обход; косметика номера строки | 🆕 |
| SVG-1 | clean-svg | 🟨 | Bypass | self-closing/`href`-only `<script>`, неквотированные `on*` мимо | 🆕 |
| SVG-2 | clean-svg | 🟨 | Bypass | plain `href` (SVG2), `javascript:`, `<style>` в SVG не покрыты | 🆕 |
| PHP-1 | detect-php-backdoors | 🟨 | Soundness | Обфусцированные бэкдоры мимо; `.phtml`/`.inc` не сканируются; WARN | 🆕 |
| SM-1 | remove-source-maps | 🟩 | Perf | Второй полный обход + двойной I/O | 🆕 |
| REP-1 | report.ts | 🟨 | Workflow | Отчёт скрывает удаления + баг типа `PHP_BACKDOOR_WARN` | ✅ |
| QUAR-1 | quarantine.ts | 🟨 | Robustness | `_quarantine/`/отчёт/лог внутри siteDir → уезжают в прод | 🆕 |
| WALK-1 | walk.ts | 🟨 | Robustness | Нет try/catch на обходе → одна папка роняет cleanSite | ✅ |
| QUAR-2 | quarantine.ts | 🟩 | Soundness | Сниппет обрезан 2000 — превью, не источник восстановления | 🆕 |
| REP-2 | report.ts | 🟩 | Robustness | Warnings обрезаны до 100 | 🆕 |
| REP-4 | report.ts | 🟩 | UX | «Всё классифицировано однозначно» при пустом карантине | 🆕 |
| CHG-1 | changelog.ts | 🟩 | Robustness | pipe-формат ломается на `|`/переносах в сниппете | 🆕 |
| WALK-2 | walk.ts | 🟩 | Strength/FN | Симлинки не следуются (хорошо для safety; минорный FN) | 🆕 |
| VR-1 | verify-runtime | 🟧 | Bypass | Verify только пассивная загрузка → exfil по клику не ловится (ложное ok) | ✅ |
| VR-2 | verify-runtime | 🟨 | Robustness | Проверяется только index.html (многостраничные мимо) | 🆕 |
| VR-3 | verify-runtime | 🟨 | Security | Verify исполняет (не блокирует) чужие запросы | 🆕 |
| DL-2 | download-site | 🟨 | Security | Загрузка исполняет грязный лендинг (exfil во время захвата) | 🆕 |
| CST-1 | clean-site-tool | 🟨 | Workflow | Не отдаёт путь к `clean-report.md` (safety-net теряется) | ✅ |
| CST-2 | clean-site-tool | 🟩 | Workflow | `noBackup` опасен при необратимых удалениях | 🆕 |
| DL-1 | download-site | 🟩 | Контекст | T-7 ✅ (base-aware) + EXT-1 подтверждён (`_external/`) | 🆕 |

## Сквозные нити (проверить в later-проходах)

Эти находки доказуемы только при просмотре вызывающих проходов — держим список открытым:

- **T-1 (для AL-2): ✅ ПОДТВЕРЖДЁН** ([2A-1](2a-allowlist-src.md)). Ни один проход не тримит `src`;
  cheerio сохраняет пробел/таб/`\n`, браузер их вычищает и грузит хост. Фикс — в `allowlist.ts`.
- **T-2 (для URL-2): ✅ РЕЗОЛВЛЕН, риск снижен** ([2A](2a-allowlist-src.md)). `isExternalUrl` не
  решает судьбу `<script>/<iframe>/<img>` (там `classifyResource`); живёт лишь в `remove-meta-refresh`
  (2b), CSS `@import` (Тир 4), `clean-svg` (Тир 4). Унификация оракулов — гигиена, не дыра.
- **T-3 (для AL-1): ✅ РЕЗОЛВЛЕН — дыра подтверждена** ([2D-1](2d-defensive.md)). Ни один проход
  (2a classify / strip-event / remove-inline-exfil / offer) не обрабатывает `data:`/`javascript:`/
  `blob:` в `src`/`href` → проходят сквозь. Фикс — классификация схемы в `allowlist.ts` (AL-1).
- **T-4 (для POL-1): ✅ РЕЗОЛВЛЕН — размещение ок** ([2D-4](2d-defensive.md)). `inject-csp` ставит
  мета после `charset`/первой в `head` → управляет последующим. Остаток: SKIP_DOM-файлы (PIPE-1)
  вообще без CSP. Слабость политики (`unsafe-inline`) — это POL-1, не размещение.
- **T-6 (для DOM-3): ✅ РЕЗОЛВЛЕН** ([2A-4](2a-allowlist-src.md)). `removeNoscriptTrackers` читает
  текст через `$(el).html()` (селекторная ловушка обойдена), но применяет **только блок-лист** —
  неизвестный трекер/exfil в `<noscript>` выживает.
- **T-7 (для 2B-1): ✅ РЕЗОЛВЛЕН** ([DL-1](5b-verify-tools.md)). `scripts/download-site.ts` base-aware:
  резолвит URL по `<base href>` и **удаляет** его. → 2B-1 актуален в основном для лендингов из ДРУГИХ
  источников (ручная копия/чужое зеркало), не из нашего загрузчика. Частота снижена, но не отменена.
- **T-8 (для MAC-1): ✅ РЕЗОЛВЛЕН ПОЛНОСТЬЮ** ([CJS-5](3a-js-orchestration.md) + [CSS-3](4-css-svg-php-fs.md)).
  Ни `clean-js`, ни `clean-css` макросы не сканируют → внешние `.js`/`.css` — слепая зона для карты
  макросов. `detect-macros` покрывает только inline.
- **T-9 (для RIE-1): ✅ РЕЗОЛВЛЕН — узел = CallExpression** ([DEC-1](3c-detectors.md)).
  `detect-exfil-calls` отдаёт `start/end` самого вызова, не охватывающего statement → `var x = fetch(evil)`
  после удаления станет `var x = ;` (битый JS). Фикс — подниматься до ExpressionStatement / `void 0`.
- **T-5 (для PIPE-1): ✅ РЕШЕНА** ([NORM-2](normalize-landing-structure.md)). `normalize` стрипает
  PHP только с **главного** файла, только при `.php`-расширении и только регуляркой **с закрывающим
  `?>`**. Незакрытый PHP, `<?php` в `.html`, ASP `<%`, и все вторичные файлы → серверные теги
  доживают до `pipeline` → срабатывает скип PIPE-1. Фиксить парно.
- **T-6 (для DOM-3):** парсит ли `remove-noscript-trackers` текстовое содержимое `<noscript>`
  отдельно, или ходит DOM-селекторами (тогда пропускает)? Проверить в Тир 2.
