# PLAN — Landing Page Automation Agent (Mastra)

> Главный канонический план разработки. Движемся **по шагам**, по одному за раз.
> Каждый шаг самодостаточен: имеет цель, вход/выход, место в кодовой базе, зависимости и критерии готовности.
>
> Все технические правки делают другие модели/агенты по этому документу. Этот файл — **только план**, не дневник.
> Текущий прогресс ведём в `progress.txt`, статусы дублируем в таблице ниже.

---

## 0. Бизнес-цель

Автоматизировать конвейер обработки лендингов:

```
YouGile (задача)
  → получение лендинга (Keitaro / URL / zip из вложений)
  → очистка (если скачан плагином / краулером)
  → локальная проверка
  → выполнение задания (перевод / замена картинок / инжект скриптов)
  → финальная визуальная проверка
  → упаковка в .zip
  → upload в Keitaro
  → production-проверка
  → инжект Microsoft Clarity
  → обновление статуса/комментария в YouGile
```

Минимальный «happy path» — одна задача в YouGile превращается в готовый, залитый в Keitaro и проверенный лендинг с минимальным вмешательством человека.

---

## 1. Архитектура: Workflow vs Agent (консультация)

### Концептуально (из официальных доков Mastra)

| | **Workflow** | **Agent** |
|---|---|---|
| Когда использовать | Шаги известны заранее, порядок фиксирован, важен контроль данных | Следующий шаг зависит от контекста, нужны решения «на лету» |
| Что определяет | Ты — жёсткой последовательностью `createStep().then(...)` | LLM — выбирая, какой tool вызвать |
| Сильные стороны | Детерминизм, suspend/resume, human-in-the-loop, retry, time-travel, schedule | Гибкость, понимание естественного языка, открытые задачи |
| Слабые стороны | Не умеет «понимать» свободный текст задачи | Недетерминизм, дороже, сложнее отлаживать длинные пайплайны |

Workflow умеет вызывать агентов как шаги, и агент умеет вызывать workflow как tool. Это не «или-или», а композиция.

### Рекомендация для нашего проекта

**Гибрид с workflow в роли «дирижёра»:**

```
landingPipelineWorkflow (createWorkflow)
├── step: fetchTaskFromYougile        ← детерминированный API-вызов (tool)
├── step: acquireSource               ← роутер: Keitaro / URL / zip-вложение (tool, ветвление)
│   ├── branch A: downloadSiteTool   (уже есть)
│   ├── branch B: pullFromKeitaro    (новый tool)
│   └── branch C: unpackUploadedZip  (новый tool)
├── step: cleanSite                   ← cleanSiteTool (уже есть)
├── step: localVerify                 ← verifySiteTool (на базе scripts/verify-site.ts)
├── step: applyTaskInstructions       ← ВЫЗОВ AGENT'а (taskExecutorAgent)
│   └── agent выбирает: translateTextTool / replaceImageTool / injectScriptTool
├── step: finalVisualCheck            ← Playwright скриншот + console errors (tool)
├── step: packageZip                  ← zipSiteTool (новый tool)
├── step: uploadToKeitaro             ← Keitaro API (tool)
├── step: productionCheck             ← Playwright по prod-URL (tool)
├── step: injectClarity               ← патч HTML, push снова в Keitaro (tool)
└── step: updateYougileStatus         ← YouGile API (tool)
```

#### Почему так

- **Pipeline-часть детерминирована** (скачать → очистить → проверить → запаковать → залить → проверить → инжект → статус). Это ровно то, для чего предназначен **Workflow**: контроль порядка, suspend между шагами на ревью человека, retry при сетевых ошибках, наблюдаемость в Studio.
- **Только один шаг открытый** — «выполнить задание из YouGile». Описание задачи в YouGile — свободный текст («перевести на польский, заменить хедер на новый.png, добавить наш FB-пиксель»). Решение «какие tools и в каком порядке вызывать» — это работа **Agent**'а с набором tool'ов.
- **Текущий `landingAgent` остаётся** как удобный фронт для ручного режима в Studio (попросить «скачай и почисти этот URL»). Workflow ≠ замена агенту, оба нужны параллельно.

#### Где что лежит (целевая структура)

```
src/mastra/
├── agents/
│   ├── weather-agent.ts            ← НЕ ТРОГАТЬ (тестовый)
│   ├── my-agent.ts                 ← НЕ ТРОГАТЬ (тестовый)
│   ├── landing-agent.ts            ← оставить, ручной режим в Studio
│   └── task-executor-agent.ts      ← НОВЫЙ, шаг 7 плана
├── tools/
│   ├── download-site-tool.ts       ← готов
│   ├── clean-site-tool.ts          ← готов
│   ├── verify-site-tool.ts         ← НОВЫЙ
│   ├── yougile/
│   │   ├── fetch-task-tool.ts
│   │   ├── update-task-tool.ts
│   │   └── get-attachment-tool.ts
│   ├── keitaro/
│   │   ├── pull-landing-tool.ts
│   │   └── upload-landing-tool.ts
│   ├── modify/
│   │   ├── translate-text-tool.ts
│   │   ├── replace-image-tool.ts
│   │   └── inject-script-tool.ts
│   ├── package-zip-tool.ts
│   └── inject-clarity-tool.ts
├── workflows/
│   ├── weather-workflow.ts         ← НЕ ТРОГАТЬ (тестовый)
│   └── landing-pipeline.ts         ← НОВЫЙ, шаг 15 плана
└── memory/, scorers/, public/      ← как сейчас
```

> Регистрация всего нового — обязательно в `src/mastra/index.ts`.

---

## 2. Дорожная карта (по шагам)

> **Принцип:** один шаг = одна осмысленная итерация (≈ 1 рабочая сессия). За один заход не лезем в несколько шагов, кроме случаев тривиальной зависимости (например, шаг 0 — это просто инфраструктурная подготовка).

### Легенда статусов
- ✅ DONE — реализовано и проверено
- 🟡 PARTIAL — реализовано, требует доп. тестов на реальных кейсах
- ⬜ TODO — не начато

### Сводная таблица

| #  | Шаг                                       | Тип            | Статус | Зависимости |
|----|-------------------------------------------|----------------|--------|-------------|
| 0  | Конвенции, env, регистрация               | infra          | ✅     | —           |
| 1  | Скачивание сайта по URL                   | tool           | ✅     | —           |
| 2  | Базовая очистка                           | tool           | 🟡    | 1           |
| 2.5| Advanced JS cleaning (8 этапов)           | cleaner        | ⬜     | 2           |
| 3  | Локальная верификация                     | tool           | 🟡    | 2           |
| 4  | YouGile: чтение задач                     | tool           | ⬜     | 0           |
| 5  | YouGile: вложения (zip)                   | tool           | ⬜     | 4           |
| 6  | Keitaro: вытащить существующий лендинг    | tool           | ⬜     | 0           |
| 7  | Source-router (URL / Keitaro / zip)       | step           | ⬜     | 1, 5, 6     |
| 8  | TaskExecutor agent                         | agent          | ⬜     | 0           |
| 9  | Tool: translate-text                      | tool           | ⬜     | 8           |
| 10 | Tool: replace-image                        | tool           | ⬜     | 8           |
| 11 | Tool: inject-script                        | tool           | ⬜     | 8           |
| 12 | Tool: final-visual-check                   | tool           | ⬜     | 3           |
| 13 | Tool: package-zip                          | tool           | ⬜     | 12          |
| 14 | Keitaro: upload-landing                    | tool           | ⬜     | 13          |
| 15 | Tool: production-check                     | tool           | ⬜     | 14          |
| 16 | Tool: inject-clarity                       | tool           | ⬜     | 15          |
| 17 | YouGile: обновление статуса/комментария   | tool           | ⬜     | 16          |
| 18 | Root workflow `landingPipeline`            | workflow       | ⬜     | все выше    |
| 19 | E2E прогон на реальной задаче              | testing        | ⬜     | 18          |

---

## Шаг 0 — Конвенции, env, регистрация

**Цель:** подготовить инфраструктуру под все остальные шаги, чтобы потом не отвлекаться.

**Действия:**
- В `.env.example` добавить заглушки:
  ```
  YOUGILE_API_TOKEN=
  YOUGILE_BOARD_ID=
  KEITARO_API_URL=
  KEITARO_API_KEY=
  CLARITY_PROJECT_ID=
  ```
- Создать пустые папки: `src/mastra/tools/yougile/`, `src/mastra/tools/keitaro/`, `src/mastra/tools/modify/`.
- Завести единый http-клиент-helper (например, `src/mastra/lib/http.ts`) с обработкой 401/429/5xx, чтобы YouGile- и Keitaro-инструменты не дублировали retry-логику.
- Договориться: **все Mastra-tools** валидируют вход и выход через Zod. **Все API-ответы** парсятся в типизированные DTO (никакого `any`).

**Acceptance criteria:**
- `npm run build` зелёный.
- `.env.example` обновлён.
- Helper-клиент покрыт юнит-тестом на retry/timeout (опционально на этом шаге, можно отложить).

---

## Шаг 1 — Download Site (✅ DONE)

Уже реализовано: `scripts/download-site.ts` + `src/mastra/tools/download-site-tool.ts`.
Никаких действий, кроме как **позже**, при тестах E2E, добавить кейсы в `verify-site.ts`.

---

## Шаг 2 — Clean Site (🟡 PARTIAL)

Уже реализовано: `scripts/clean-site.ts` + `src/mastra/tools/clean-site-tool.ts`.

**Что осталось до DONE:**
- Рефакторинг архитектуры — DONE (монолит scripts/clean-site.ts → модульная структура src/mastra/cleaners/, поведение идентично).
- Прогнать на 3–5 реальных рабочих лендингах разной структуры (статика, WordPress + Divi, Tilda-экспорт, плагин «Save All Resources»).
- Для каждого — задокументировать в `progress.txt` найденные дефекты и закрыть их апстрим-фиксами в `clean-site.ts` (а не патчами в HTML потом).
- Особое внимание: сохранение работоспособности форм/CTA после удаления трекеров (часто `onclick`/`onsubmit` зависит от `gtag`/`fbq` — нужно либо стабить, либо удалять обработчик целиком).

**Acceptance criteria:** на 5 разных лендингах после clean — 0 console errors и все CTA-кнопки кликаются.

---

## Шаг 2.5 — Advanced JS Cleaning (⬜ TODO)

**Цель:** расширить очистку JS файлов от трекеров, мёртвого кода и вредоносного кода с помощью AST-анализа и Playwright coverage.

**Полная спека:** `docs/js-cleaning-spec.md` — там подробное ТЗ по 8 этапам с кодом, тестами и acceptance criteria для middle-разработчика.

**Этапы (реализовывать в этом порядке):**
1. Foundation: `acorn` + `magic-string`, типы `DetectionResult`, обновление `CleanStats`
2. Metric-file remover: удаление файлов-метрик по AST-сигнатуре (расширение `TRACKER_FILENAME_PATTERNS`)
3. Unversioned libs → CDN: jQuery/Bootstrap без версии в имени → CDN по AST-детекту
4. Inline exfil в HTML: хирургическое AST-вырезание `fetch`/`sendBeacon`/трекер-глобалов из inline `<script>`
5. Coverage-based dead file detection: Playwright `startJSCoverage()` → удаление 0%-файлов
6. Partial useful extractor: удаление exfil-функций из смешанных файлов (call graph)
7. Advanced detectors: обфускация, кейлоггеры, PHP-бэкдоры (только WARN кроме обфускации)
8. Visual diff + полная интеграция, CLI флаг `--advanced`

**CLI после реализации:**
```bash
npm run clean -- <siteDir> --advanced            # AST-анализ
npm run clean -- <siteDir> --advanced --coverage # + Playwright coverage
```

**Acceptance criteria:** на 5 реальных лендингах — 0 console errors, CTA работают, размер JS уменьшается ≥ 30%.

---

## Шаг 3 — Локальная верификация (🟡)

Прототип есть: `scripts/verify-site.ts`.

**Что доделать:**
- Завернуть в Mastra-tool `verifySiteTool` (`src/mastra/tools/verify-site-tool.ts`).
- Input: `siteDir` (абсолютный путь).
- Output: `{ ok: boolean, consoleErrors: string[], brokenLinks: string[], missingAssets: string[], screenshotPath: string }`.
- Внутри: запустить локальный static-server (например, `serve` или встроенный Node http) на случайном порту, открыть Playwright, дождаться `networkidle`, собрать errors/404, сделать скриншот в `<siteDir>/.verify/screenshot.png`.
- Закрыть сервер и браузер в `finally`.

**Acceptance criteria:**
- Tool зарегистрирован в `index.ts`, виден в Studio.
- Возвращает структурированный отчёт за < 30 секунд для типичного лендинга.

---

## Шаг 4 — YouGile API: чтение задач

**Цель:** уметь забрать задачу из канбан-доски YouGile по её ID или забрать список задач из конкретной колонки.

**Источник API:** `docs/yougile-api-docs.json` (OpenAPI 3.0).

**Действия:**
- Изучить эндпоинты `/api-v2/tasks`, `/api-v2/columns/{id}/tasks` (точные пути — из openapi-доки).
- Создать `src/mastra/tools/yougile/fetch-task-tool.ts`:
  - Input: `{ taskId?: string, columnId?: string, status?: string }`.
  - Output: `{ tasks: Array<{ id, title, description, status, attachments, deadline, assignees }> }`.
- Auth — Bearer-токен из `YOUGILE_API_TOKEN`.

**Acceptance criteria:**
- Из Studio можно дернуть tool и получить реальную задачу с тестовой доски.
- Описание задачи (`description`) приходит в исходном Markdown, не парсится агрессивно.

---

## Шаг 5 — YouGile API: вложения

**Цель:** скачать прикреплённый к задаче zip-архив с лендингом (если задача начинается с него, а не с URL).

**Действия:**
- Создать `src/mastra/tools/yougile/get-attachment-tool.ts`:
  - Input: `{ taskId: string, attachmentId?: string }` (если `attachmentId` не указан — взять первый zip).
  - Output: `{ localPath: string, originalName: string, sizeBytes: number }`.
- Сохранять в `downloads/_yougile/<taskId>/<originalName>`.

**Acceptance criteria:** из тестовой задачи скачивается zip, файл лежит локально, размер совпадает.

---

## Шаг 6 — Keitaro API: pull existing landing

**Цель:** скачать лендинг, который уже залит в трекер, по ID лендинга или по slug.

**Источник API:** `docs/keitaro-api-docs.json`.

**Действия:**
- Создать `src/mastra/tools/keitaro/pull-landing-tool.ts`:
  - Input: `{ landingId: number }` либо `{ landingAlias: string }`.
  - Output: `{ localDir: string, files: number, manifest: object }`.
- Если Keitaro отдаёт zip — распаковать в `downloads/_keitaro/<landingId>/`.
- Если отдаёт список файлов — скачать параллельно (concurrency 8, как в download-site).

**Acceptance criteria:** из теста на реальном Keitaro-инстансе вытаскивается известный лендинг и совпадает с тем, что лежит на проде.

---

## Шаг 7 — Source Router (выбор источника)

**Цель:** один шаг workflow, который смотрит на задачу YouGile и решает, откуда брать лендинг.

**Действия:**
- Создать `createStep` (внутри `workflows/landing-pipeline.ts`) с именем `acquire-source`.
- Логика:
  1. Если в задаче есть валидный URL — вызвать `downloadSiteTool`.
  2. Иначе если есть zip-вложение — вызвать `getAttachmentTool` + распаковать (новый маленький tool `unzip-tool`).
  3. Иначе если есть `keitaro://landingId/123` — вызвать `pullLandingTool`.
  4. Иначе — fail с понятной ошибкой.
- Output: `{ siteDir: string, sourceType: 'url' | 'zip' | 'keitaro' }`.

**Acceptance criteria:** все три ветки работают; `siteDir` всегда указывает на готовую к очистке папку.

---

## Шаг 8 — TaskExecutor agent

**Цель:** агент, который читает `description` задачи и сам выбирает, какие tools вызвать (`translate`, `replace-image`, `inject-script`) и в каком порядке.

**Действия:**
- Создать `src/mastra/agents/task-executor-agent.ts`.
- Tools: `translateTextTool`, `replaceImageTool`, `injectScriptTool` (см. шаги 9–11).
- Memory: working memory со схемой `{ siteDir, plannedActions: Array<{type, params, status}>, completedActions: [...], errors: [...] }`.
- Instructions: «Прочитай описание задачи, разложи на список конкретных действий, вызови соответствующие tools, отчитайся структурированным JSON».
- Output schema (через `structuredOutput`): `{ actionsCompleted: number, errors: string[], summary: string }`.

**Acceptance criteria:**
- На задаче «Переведи кнопки на польский и замени hero.jpg на /tmp/new-hero.jpg» агент сам делает перевод + замену, отчитывается JSON'ом.
- Агент НЕ выходит за пределы `siteDir` (валидация путей).

---

## Шаг 9 — Tool: translate-text

**Цель:** заменить тексты в HTML/JSON-локалях согласно карте перевода.

**Действия:**
- `src/mastra/tools/modify/translate-text-tool.ts`.
- Input: `{ siteDir: string, translations: Array<{ selector?: string, find: string, replace: string }> }` или `{ siteDir, sourceLang, targetLang }` (тогда переводит сам через LLM).
- Поддержать оба режима: явные пары и LLM-перевод.
- Output: `{ filesChanged: number, replacementsCount: number, changelogPath: string }`.

**Acceptance criteria:** на тестовом лендинге заменяет «Buy Now» → «Kup Teraz» в HTML и в JS-строках, но не ломает атрибуты/URL.

---

## Шаг 10 — Tool: replace-image

**Цель:** заменить картинку в лендинге на новую (по имени файла, по alt, по селектору, или по позиции).

**Действия:**
- `src/mastra/tools/modify/replace-image-tool.ts`.
- Input: `{ siteDir, replacements: Array<{ targetPath: string, sourcePath: string, optimize?: boolean }> }`.
- Опционально через `sharp` пережимать в WebP/AVIF c сохранением размеров.
- Output: `{ replaced: number, skipped: number, sizeDeltaBytes: number }`.

**Acceptance criteria:** замена `hero.jpg` происходит, размеры верстки не ломаются (если включён `optimize` — поддерживается оригинальная ширина/высота).

---

## Шаг 11 — Tool: inject-script

**Цель:** вставить наш базовый скрипт (FB-пиксель, click-tracker, всплывашка и т.п.) в HTML лендинга.

**Действия:**
- `src/mastra/tools/modify/inject-script-tool.ts`.
- Input: `{ siteDir, scripts: Array<{ position: 'head-start' | 'head-end' | 'body-end', src?: string, inline?: string, async?: boolean }> }`.
- Завести каталог пресетов в `src/mastra/lib/script-presets.ts` (Clarity, FB Pixel, custom click-handler) — чтобы агент мог сослаться на пресет по имени, а не передавать сырой JS.

**Acceptance criteria:** скрипт корректно появляется в указанной позиции во всех HTML-файлах сайта (или в одном, если указан `entryFile`).

---

## Шаг 12 — Tool: final visual check

**Цель:** перед упаковкой ещё раз снять скриншот, проверить отсутствие console errors, проверить «не уехала ли вёрстка» после правок.

**Действия:**
- `src/mastra/tools/final-visual-check-tool.ts` (или расширить `verifySiteTool` флагом `compareWithBaseline`).
- Input: `{ siteDir, baselineScreenshot?: string }`.
- Если `baselineScreenshot` задан — diff через pixel-by-pixel (например, `pixelmatch`).
- Output: `{ ok, diffPercent, consoleErrors, screenshotPath }`.

**Acceptance criteria:** на сайте без правок diff = 0%; при замене картинки diff > 0% и точка изменения подсвечивается на маске.

---

## Шаг 13 — Tool: package-zip

**Цель:** упаковать `siteDir` в zip с правильной структурой для Keitaro.

**Действия:**
- `src/mastra/tools/package-zip-tool.ts`.
- Input: `{ siteDir, outputZip?: string, exclude?: string[] }`.
- По умолчанию исключать: `.verify/`, `*_backup/`, `clean-site-changes.log`, `.DS_Store`.
- Использовать `archiver` или `node:zlib` (предпочтительно `archiver`).
- Output: `{ zipPath, sizeBytes, filesIncluded }`.

**Acceptance criteria:** распаковка получившегося zip даёт работающий лендинг (повторный `verifySiteTool` на распакованной папке зелёный).

---

## Шаг 14 — Keitaro API: upload landing

**Цель:** залить zip обратно в трекер и получить production-URL.

**Действия:**
- `src/mastra/tools/keitaro/upload-landing-tool.ts`.
- Input: `{ zipPath: string, name: string, replace?: { landingId: number } }`.
- Если `replace.landingId` указан — обновить существующий, иначе создать новый.
- Output: `{ landingId: number, productionUrl: string, uploadedAt: string }`.

**Acceptance criteria:** на тестовом Keitaro лендинг появляется/обновляется, productionUrl открывается в браузере.

---

## Шаг 15 — Tool: production-check

**Цель:** проверить, что после заливки сайт реально работает на проде.

**Действия:**
- `src/mastra/tools/production-check-tool.ts`.
- Input: `{ productionUrl: string, expectScreenshotMatch?: string }`.
- Открыть URL в Playwright, убедиться, что 200, нет console errors, ключевые элементы (CTA-кнопки) присутствуют.
- Output: `{ ok, statusCode, consoleErrors, ctaFound, screenshotPath }`.

**Acceptance criteria:** возвращает `ok: true` для здорового лендинга и понятный список проблем для битого.

---

## Шаг 16 — Tool: inject-clarity

**Цель:** вшить Microsoft Clarity в production-копию (через перезаливку в Keitaro) — это последний шаг перед обновлением статуса в YouGile.

**Действия:**
- `src/mastra/tools/inject-clarity-tool.ts`.
- Input: `{ siteDir, projectId: string }` (projectId — из `.env` по умолчанию).
- Внутри: использует `injectScriptTool` с пресетом `clarity` → `packageZipTool` → `uploadToKeitaroTool` (с `replace.landingId`).
- Output: `{ productionUrl, clarityProjectId }`.

> Альтернатива: оставить инжект Clarity внутри workflow как комбинацию шагов 11+13+14, без отдельного tool. Решение принять во время реализации.

**Acceptance criteria:** на production-странице в DOM присутствует script с правильным projectId.

---

## Шаг 17 — YouGile API: обновление задачи

**Цель:** перевести задачу в нужную колонку, добавить комментарий со ссылкой на production и метрикой.

**Действия:**
- `src/mastra/tools/yougile/update-task-tool.ts`.
- Input: `{ taskId, newColumnId?, statusName?, comment?: string }`.
- Output: `{ ok, updatedAt }`.

**Acceptance criteria:** задача переезжает в колонку «Готово» (или иную, указанную в .env), комментарий с productionUrl + clarityProjectId появляется в задаче.

---

## Шаг 18 — Root workflow `landingPipeline`

**Цель:** связать все шаги в один Mastra-workflow с suspend/resume на ключевых точках.

**Действия:**
- Создать `src/mastra/workflows/landing-pipeline.ts`.
- Использовать `createWorkflow` + `createStep` (см. `docs/workflows/overview` в актуальной версии Mastra).
- Точки suspend (human-in-the-loop) — минимум две:
  1. После `final-visual-check` перед `package-zip` — на случай, если diff подозрительный.
  2. После `production-check` перед `update-yougile-status` — финальный «отпустить ли в продакшн».
- Workflow state: `{ taskId, siteDir, sourceType, productionUrl, landingId, errors }`.
- Зарегистрировать в `src/mastra/index.ts` в `workflows: { ..., landingPipeline }`.

**Acceptance criteria:**
- В Studio workflow виден, граф рисуется, по `inputSchema: { taskId }` запускается, suspend-точки реально приостанавливают и возобновляются.

---

## Шаг 19 — E2E прогон

**Цель:** прогнать workflow на реальной задаче от начала до конца.

**Действия:**
- Создать тестовую задачу в YouGile с понятным описанием («Возьми лендинг с URL X, переведи кнопки на польский, замени hero.jpg на этот вложенный файл, добавь FB-пиксель ID 12345, закинь в Keitaro»).
- Запустить workflow, пройти suspend-точки вручную.
- Зафиксировать в `progress.txt` все обнаруженные дефекты, по каждому — отдельная мини-итерация фикса.

**Acceptance criteria:** одна задача проходит весь pipeline без ручного вмешательства, кроме двух предусмотренных suspend-точек.

---

## 3. Что НЕ трогаем

- `weatherAgent`, `myAgent`, `weatherWorkflow`, `weatherTool`, `weather-scorer.ts` — оставлены как «учебные песочницы». Их удалит другая модель отдельной задачей, если решишь.
- `landingAgent` — остаётся как ручной режим. Workflow не заменяет его.

---

## 4. Конвенции (обязательно для всех шагов)

1. **Перед любой работой с Mastra** — загрузить skill `mastra` (см. `AGENTS.md`).
2. **Каждый tool** — Zod input + Zod output. Никакого `any`.
3. **Каждый tool** регистрируется явно в `src/mastra/index.ts` (либо напрямую, либо через `tools` агента/workflow'а).
4. **Никаких хардкод-секретов**. Только `.env`, `.env.example` обновляется параллельно с кодом.
5. **Минимальный апстрим-фикс** вместо downstream-патчей (правило из `AGENTS.md`).
6. **`npm run build`** должен оставаться зелёным после каждого шага.
7. **Каждый шаг закрывается** обновлением `progress.txt` и таблицы статусов в этом файле (`PLAN.md` → раздел «Сводная таблица»).

---

## 5. Открытые вопросы (решить когда дойдём)

- **Идемпотентность.** Если workflow упал на шаге 14 — как продолжить с того же места без повторной обработки? (Mastra `suspend/resume` + хранение state в storage решает 80% случаев, но нужен тест.)
- **Параллельные задачи.** Поддерживать одновременную обработку нескольких задач из YouGile? — пока нет, по очереди.
- **Хранение бэкапов.** Сейчас `clean-site` делает `_backup` рядом. На проде это не нужно — добавить флаг «production mode».
- **Авторизация Keitaro.** API-key vs sessions — уточнить по `docs/keitaro-api-docs.json` на шаге 6.
- **YouGile webhooks.** Запускать workflow по триггеру (карточка переехала в «In Progress») вместо ручного запуска — рассматривать после шага 19.
- **Перевод через LLM или таблицу.** Шаг 9: оставить оба режима или выбрать один? — решить после первого реального прогона.

---

## 6. Как давать задание следующей модели

Шаблон промпта на одну итерацию:

```
Делаем шаг N из PLAN.md.

Прочитай:
- PLAN.md (раздел «Шаг N»)
- progress.txt (последние записи)
- AGENTS.md
- src/mastra/index.ts (узнай, что уже зарегистрировано)

Реализуй ТОЛЬКО этот шаг. Не лезь в соседние шаги.
В конце:
1. Обнови таблицу статусов в PLAN.md (✅ или 🟡).
2. Допиши блок в progress.txt о том, что сделано и что осталось.
3. Покажи acceptance-criteria и как их проверить.
```

Этого достаточно, чтобы каждый шаг закрывался в одну сессию.
