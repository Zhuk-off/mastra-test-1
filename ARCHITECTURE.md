# Архитектура проекта

AI-агент-«верстальщик»: **скачивает** чужой лендинг, **очищает** его от трекеров и
кражи трафика, **проверяет**, что очищенная копия не звонит на чужие домены — и отдаёт
готовый к заливу шаблон для арбитража.

Это карта проекта: что где лежит и за что отвечает. Держи её под рукой и **обновляй,
когда меняешь структуру** — это источник правды по архитектуре.

---

## 1. Ментальная модель

Проект — это **конвейер из 3 шагов** плюс **одна библиотека-ядро**, где живёт вся логика очистки:

```
скачать (download) → почистить (clean) → проверить (verify)
```

> Это **ядро** большего сквозного воркфлоу — от задачи в YouGile до залива в трекер.
> Полный список этапов и их статус — в §10.

Запустить конвейер можно двумя путями, и оба зовут одни и те же функции-ядро
(дублирования логики нет):

| Путь | Чем запускается | Для кого |
| --- | --- | --- |
| **CLI** | `npm run download/clean/verify` (папка `scripts/`) | руками, для отладки |
| **Агент** | `landing-agent` вызывает 3 инструмента (`tools/`) | через Mastra Studio / чат |

Три функции-ядро:

| Функция | Где | Что делает |
| --- | --- | --- |
| `downloadSite()` | [scripts/download-site.ts](scripts/download-site.ts) | качает сайт целиком (4 фазы, Playwright) |
| `cleanSite()` | [src/mastra/cleaners/pipeline.ts](src/mastra/cleaners/pipeline.ts) | очищает скачанную папку |
| `verifySiteRuntime()` | [src/mastra/cleaners/verify/verify-runtime.ts](src/mastra/cleaners/verify/verify-runtime.ts) | запускает в браузере, ловит звонки наружу |

---

## 2. Карта верхнего уровня

```
learn-mastra-2/
├── scripts/          ← CLI: запуск конвейера руками
├── src/mastra/       ← весь код (агент, инструменты, ядро очистки)
├── docs/             ← вся документация (спеки + red-team аудит)
├── downloads/        ← рабочие данные: сюда качаются и тут чистятся лендинги
├── .agents/          ← навык "mastra" для AI-ассистента (не продукт)
├── .mastra/          ← сборка Mastra (не трогаем)
├── node_modules/     ← зависимости (не трогаем)
├── package.json      ← npm-скрипты и зависимости
├── tsconfig.json     ← настройки TypeScript
├── vitest.config.ts  ← настройки тестов
├── .env / .env.example ← секреты (ключи моделей); в git не коммитятся
├── README.md         ← краткое описание + быстрый старт
├── ARCHITECTURE.md   ← этот файл
└── PLAN.md           ← роадмап будущих шагов (статусы внутри устарели)
```

---

## 3. `src/mastra/` — точка входа и обвязка Mastra

| Файл / папка | За что отвечает |
| --- | --- |
| [index.ts](src/mastra/index.ts) | главная сборка Mastra: регистрирует агентов, хранилище (LibSQL + DuckDB), логи, observability |
| [agents/landing-agent.ts](src/mastra/agents/landing-agent.ts) | **наш боевой агент**: инструкции, 3 инструмента, рабочая память |
| [tools/download-site-tool.ts](src/mastra/tools/download-site-tool.ts) | обёртка-инструмент над `downloadSite()` |
| [tools/clean-site-tool.ts](src/mastra/tools/clean-site-tool.ts) | обёртка над `cleanSite()` (+ бэкап перед очисткой) |
| [tools/verify-site-tool.ts](src/mastra/tools/verify-site-tool.ts) | обёртка над `verifySiteRuntime()` |
| [lib/http.ts](src/mastra/lib/http.ts) | общий HTTP-клиент (фетч страниц и файлов с CDN) |
| [memory/index.ts](src/mastra/memory/index.ts) | конфиг памяти агента |
| `tools/keitaro/`, `tools/modify/`, `tools/yougile/` | **пустые папки-заготовки** под будущие интеграции (JSON-доки API лежат в `docs/`) |

> **Остатки стартового шаблона Mastra** (к продукту отношения не имеют, кандидаты на удаление):
> `agents/weather-agent.ts`, `agents/my-agent.ts`, `workflows/weather-workflow.ts`,
> `scorers/weather-scorer.ts`, `tools/weather-tool.ts`. Они всё ещё зарегистрированы в `index.ts`.

---

## 4. `scripts/` — запуск из терминала

| Файл | За что отвечает |
| --- | --- |
| [download-site.ts](scripts/download-site.ts) | **самый большой модуль (~1180 строк)** — 4-фазный загрузчик. Это и CLI, и библиотека `downloadSite()`, которую зовёт инструмент |
| [clean-site.ts](scripts/clean-site.ts) | CLI очистки → зовёт `cleanSite()`. Флаги: `--no-backup`, `--no-advanced`, `--coverage`, `--coverage-threshold=` |
| [verify-site.ts](scripts/verify-site.ts) | CLI проверки. ⚠️ дублирует логику и считает чужие хосты иначе, чем инструмент агента (без allowlist) — рассинхрон, кандидат на унификацию |

---

## 5. `src/mastra/cleaners/` — ❤️ ядро очистки

Сердце проекта. Внутри 5 ролей: **дирижёр** + **проходы** + **списки/правила** + **утилиты** + **проверка**.

### 5.1. Дирижёр и типы

| Файл | За что отвечает |
| --- | --- |
| [pipeline.ts](src/mastra/cleaners/pipeline.ts) | **главный файл.** `cleanSite()` задаёт порядок проходов, обходит все файлы, удаляет опасное (с карантином), пишет отчёт. Хочешь понять «что в каком порядке» — читай отсюда |
| [types.ts](src/mastra/cleaners/types.ts) | все типы (`CleanStats`, `PassContext`, `DomPass`, `QuarantineItem`, `MacroFinding`) — словарь данных пайплайна |
| [index.ts](src/mastra/cleaners/index.ts) | публичный barrel: `cleanSite`, `createBackup`, типы |

### 5.2. `passes/` — проходы очистки

Каждый проход — небольшая функция «принять контент → вернуть очищенный». Сгруппированы по типу файла.

| Папка | Что чистит |
| --- | --- |
| `passes/html/` | **20 DOM-проходов** на cheerio (ссылки, скрипты, iframe, мета, CSP, макросы, offer-ссылки) |
| `passes/css/` | внешние `.css`: трекерные `@import` и `url()` |
| `passes/svg/` | JS, спрятанный внутри SVG |
| `passes/php/` | скан PHP-бэкдоров (только предупреждения) |
| `passes/js/` | базовая очистка `.js` (всегда) |
| `passes/js-advanced/` | продвинутый AST-анализ JS (см. ниже) |
| `passes/fs/` | файловые операции: удаление sourcemaps, разбор папок `_external/<host>/` |

**`passes/js-advanced/`** (включается по умолчанию через инструмент агента):

| Файл / папка | За что отвечает |
| --- | --- |
| `ast/` | парсинг JS через acorn (`parse.ts`, `types.ts`) |
| `detectors/` | детекторы угроз: exfil-вызовы, keylogger, редиректы, eval-обфускация, service-worker, document.write, metric-файлы, обфускация, unversioned-библиотеки |
| `coverage/` | определение «мёртвого» JS через прогон в браузере (опционально, `--coverage`) |
| `neutralize-detections.ts` | безопасное вырезание найденного (через MagicString, без поломки ссылок) |
| `extract-useful-functions.ts` | вырезает функции, делающие только exfil |
| `remove-inline-exfil.ts` | применяет детекторы к inline-`<script>` |
| `verify-visual.ts` | сравнение скриншотов оригинал/очистка (pixel-diff). Подключён в `verifySite()` |

### 5.3. `registry/` — списки и правила (данные, не логика)

Сюда лезешь, когда надо добавить хост/трекер/библиотеку в список.

| Файл | Содержит |
| --- | --- |
| [policy.ts](src/mastra/cleaners/registry/policy.ts) | **главный конфиг**: доверенные CDN, мультитенантные CDN, хосты владельца, CSP, политика (default-deny → карантин) |
| `trusted-hosts.ts` | доверенные хосты + `isTrustedHost()` |
| `tracker-hosts.ts` | ~90 хостов трекеров на авто-удаление |
| `tracker-filenames.ts` | паттерны имён файлов-трекеров |
| `tracker-keywords.ts` | ключевые слова трекеров для inline-кода |
| `meta-names.ts` | мета-теги верификации поисковиков/соцсетей |
| `cdn-libraries.ts` | библиотеки по имени файла + ссылки на официальный CDN |
| `known-libs.ts` | библиотеки по сигнатуре содержимого (для безверсионных) |
| `suspicious-globals.ts` | имена трекерных глобалов (fbq/gtag/…) |
| `js-warning-patterns.ts` | паттерны для предупреждений (fetch/XHR/keylogger/…) |
| `offer-patterns.ts` | паттерны offer-ссылок vs служебных страниц |

### 5.4. `utils/` — общие утилиты

| Файл | За что отвечает |
| --- | --- |
| [allowlist.ts](src/mastra/cleaners/utils/allowlist.ts) | **классификатор `classifyResource()`** — keep / remove / quarantine. Сердце «белого списка» |
| [normalize-landing-structure.ts](src/mastra/cleaners/utils/normalize-landing-structure.ts) | раскладка файлов: главный → `index.html`, ассеты по папкам, переписывание путей, защита от path-traversal |
| [cdn-detector.ts](src/mastra/cleaners/utils/cdn-detector.ts) | репин библиотек на официальный CDN + расчёт SRI |
| [unversioned-cdn-detector.ts](src/mastra/cleaners/utils/unversioned-cdn-detector.ts) | то же для безверсионных локальных библиотек |
| [html-dom.ts](src/mastra/cleaners/utils/html-dom.ts) | cheerio-обёртка (parse/serialize) + работа с серверными тегами |
| [quarantine.ts](src/mastra/cleaners/utils/quarantine.ts) | карантин: всё подозрительное сохраняется в `_quarantine/`, а не удаляется молча |
| [report.ts](src/mastra/cleaners/utils/report.ts) | человекочитаемый отчёт `clean-report.md` |
| [macro-scan.ts](src/mastra/cleaners/utils/macro-scan.ts) | поиск макросов `{...}` (наши vs чужие) в JS/CSS |
| [offer-detector.ts](src/mastra/cleaners/utils/offer-detector.ts) | определяет offer-ссылки + хост владельца из имени папки |
| [url.ts](src/mastra/cleaners/utils/url.ts) | разбор хостов, совпадение с трекерами |
| [walk.ts](src/mastra/cleaners/utils/walk.ts) | рекурсивный обход файлов (устойчив к ошибкам) |
| [changelog.ts](src/mastra/cleaners/utils/changelog.ts) | лог изменений `clean-site-changes.log` |

### 5.5. `verify/` — проверка наружу

| Файл | За что отвечает |
| --- | --- |
| [verify-runtime.ts](src/mastra/cleaners/verify/verify-runtime.ts) | `verifySite()` — прогон очищенного сайта в headless Chromium на **десктопе и мобайле**, по **всем HTML-страницам**; ловит запросы на чужие хосты, прокликивает интерактив, считает визуальный diff с оригиналом |

---

## 6. Что происходит за один прогон `cleanSite()`

Порядок (из [pipeline.ts](src/mastra/cleaners/pipeline.ts)):

1. **Нормализация** структуры (`normalizeLandingStructure`): главный файл → `index.html`, раскладка ассетов, пути.
2. *(advanced)* пре-скан безверсионных библиотек.
3. **Обход всех файлов**, по расширению:
   - `.html` / `.php` → вырезать серверный код → репин CDN → **20 DOM-проходов** → *(php, advanced)* скан бэкдоров;
   - `.svg` → вырезать спрятанный JS;
   - `.js` → AST-очистка (обфусцированные/metric-файлы помечаются на удаление);
   - `.css` → чистка трекерных `@import`/`url()`.
4. **Удаление** помеченных JS (metric/обфускация/безверсионные) — с карантином.
5. Разбор папок `_external/<host>/`, удаление sourcemaps.
6. *(опц., `--coverage`)* удаление «мёртвого» JS.
7. **Убрать ссылки** на удалённые файлы (один DOM-проход).
8. Записать карантин, лог изменений и `clean-report.md`.

**Порядок 20 DOM-проходов** (важно: репин CDN идёт ДО белого списка, чтобы библиотека с фейкового CDN
превратилась в доверенный URL и не ушла в карантин; CSP — последним):

```
removeBase → replaceLocalLibsWithCdn → removeTrackerScripts → removeTrackerJsonLd →
removeInlineTrackers → [removeInlineExfilPass*] → removeNoscriptTrackers → cleanInlineCss →
removeTrackerLinks → removeTrackerMetas → removeMetaRefresh → removeTrackerIframes →
removeImgPixels → removeObjectEmbed → removeFrames → stripDangerousHrefs →
replaceOfferLinks → detectMacros → stripEventAttrs → injectCsp
```
`*` — только в advanced-режиме.

---

## 7. Навигатор «хочу поменять X → иди в файл Y»

| Хочу… | Файл |
| --- | --- |
| Добавить трекер/хост в список | `registry/policy.ts` или `registry/tracker-*.ts` |
| Изменить, какие ссылки → `{offer}` | `passes/html/replace-offer-links.ts` + `utils/offer-detector.ts` |
| Поправить логику keep/remove/quarantine | `utils/allowlist.ts` |
| Добавить новый шаг очистки | создать файл в `passes/html/`, подключить в `BASE_DOM_PASSES` (`pipeline.ts`) |
| Изменить, что считается «опасным JS» | `passes/js-advanced/detectors/` |
| Поменять порядок очистки / отчёт | `pipeline.ts` + `utils/report.ts` |
| Скачивание (фазы, скролл, дозагрузка) | `scripts/download-site.ts` |
| Что проверяет verify (домены, клики) | `verify/verify-runtime.ts` |
| Настроить агента (модель, инструкции) | `agents/landing-agent.ts` |

---

## 8. Документация (`docs/`)

| Документ | Статус |
| --- | --- |
| [docs/cleaning-logic.md](docs/cleaning-logic.md) | ✅ актуальная спека очистки |
| [docs/js-cleaning-spec.md](docs/js-cleaning-spec.md) | ✅ большая спека JS-очистки |
| [docs/normalize-landing-structure-fixes.md](docs/normalize-landing-structure-fixes.md) | ✅ нормализация структуры |
| [docs/macro-and-localization-policy.md](docs/macro-and-localization-policy.md) | ✅ политика макросов + будущий Этап 2 (адаптация/локализация) |
| `docs/red-team/` | ✅ аудит безопасности; источник правды — `_index.md` + `README.md` |
| `docs/keitaro-api-docs.json`, `docs/yougile-api-docs.json` | референс API под будущие интеграции |

---

## 9. Окружение и запуск

Проект живёт в **WSL** (Ubuntu-24.04), node через nvm. Из Windows-терминала команды запускаются так:

```powershell
Set-Location C:\; wsl.exe -d Ubuntu-24.04 -e bash -lc 'export NVM_DIR=$HOME/.nvm; . "$NVM_DIR/nvm.sh"; cd /home/asus/projects/me-projects/mastra/learn-mastra-2 && <команда>'
```

| Команда | Что делает |
| --- | --- |
| `npm run download -- <url>` | скачать лендинг в `downloads/<host>/` |
| `npm run clean -- <dir>` | очистить папку |
| `npm run verify -- <dir>` | проверить очищенную папку |
| `npm run dev` | Mastra Studio (UI агента) на `localhost:4111` |
| `npx vitest run` | тесты |
| `npx tsc --noEmit` | проверка типов |

---

## 10. Полный воркфлоу (целевое видение) и статус

Реализованное ядро (скачать → почистить → проверить) — это **середина** большего сквозного
продуктового воркфлоу: от задачи в YouGile до залитого в трекер лендинга с метрикой.
Все этапы ниже; детальный пошаговый план — в [PLAN.md](PLAN.md).

| # | Этап | Статус | Где есть / будет жить |
| --- | --- | --- | --- |
| 1 | Вход: задание (текст + файлы) — **через чат** (copy-paste); YouGile опционально/позже | 🔴 не начато | чат-агент; `tools/yougile/` (на будущее); PLAN шаги 4–5 |
| 2 | Получение лендинга: **скачать** (Playwright) | ✅ готово | `scripts/download-site.ts` |
| 2б | …либо **забрать из трекера** Keitaro + выбор источника | 🔴 не начато | `tools/keitaro/` (пусто), `docs/keitaro-api-docs.json`; PLAN шаги 6–7 |
| 3 | Очистка (если скачан) | ✅ готово | `cleaners/` |
| 4 | Локальный запуск + проверка работы | ✅ готово | `verify/verify-runtime.ts` → `verifySite()`: десктоп + мобайл, все страницы, единый allowlist |
| 5 | Задания из YouGile: перевод / замена картинок / наши базовые скрипты | 🔴 не начато | Этап «адаптация» (translate-text, replace-image, inject-script); PLAN шаги 9–11 |
| 6 | Проверка отображения (финальный visual check) | 🟠 встроено в verify | визуальный diff очистки с оригиналом (`_backup`) — информационно; PLAN шаг 12 |
| 7 | Упаковка в zip + отправка в трекер | 🔴 не начато | PLAN шаги 13–14 (package-zip, upload Keitaro) |
| 8 | Проверка на проде (как выглядит/работает в трекере) | 🔴 не начато | PLAN шаг 15 |
| 9 | Отчёт о готовности (статус/описание) — через чат; YouGile API опционально/позже | 🔴 не начато | PLAN шаг 17 |
| 10 | Добавление метрики Microsoft Clarity | 🔴 не начато | PLAN шаг 16 (inject-clarity) |
| — | **Сквозной оркестратор** всего (workflow `landingPipeline`) + E2E | 🔴 не начато | PLAN шаги 18–19 |

**Итого реализовано:** этапы 2–4 (скачивание, очистка, базовая проверка). Всё остальное — впереди.

> **Про скачивание:** раньше лендинги тянулись вручную через Chrome-плагин. Наш
> Playwright-загрузчик (`scripts/download-site.ts`) реализует тот же инструментарий
> программно и полнее — это осознанная замена плагина, а не временное решение.
>
> **Про YouGile:** ввод/вывод заданий начинаем через **чат** (скопировал задание + файлы →
> отдал агенту), без возни с API. Полноценную интеграцию с YouGile добавим позже, если понадобится.

### Мелкий техдолг
- weather-скаффолдинг в `index.ts` (остатки стартового шаблона);
- смешанный href (`url+{macro}`) не переписывается в `{offer}` (только флаг).
