# ТЗ — Рефакторинг `scripts/clean-site.ts`

> **Это техническое задание**, а не план продукта. Главный план проекта — `PLAN.md`.
> Текущий шаг по `PLAN.md`: **Шаг 2 (Clean Site, 🟡 PARTIAL)** — этот рефакторинг подготавливает площадку для дальнейшего расширения cleaning-правил.
>
> Делай **строго то, что описано здесь**. Никаких изменений в поведении, никаких новых правил очистки в этой итерации. Цель — структурный рефакторинг с **0% изменений в выходе на тестовом сайте**.

---

## 0. Контекст в одном абзаце

Файл `scripts/clean-site.ts` (1155 строк) делает очистку скачанного лендинга от трекеров, sourcemaps, обфусцированного кода и т.п. Файл монолитный и будет расти — нужно ещё ~5 правил (CDN-замена локальных библиотек, удаление `<frame>`, и др.). Mastra-tool `src/mastra/tools/clean-site-tool.ts` импортирует из него `cleanSite()` и `createBackup()`. CLI-точка входа — тоже в этом же файле.

**Решение:** разбить на модули в новой папке `src/mastra/cleaners/`, каждый pass — отдельный файл. Сохранить **публичный API без изменений**.

---

## 1. Жёсткие инварианты (чек-лист «не сломать»)

Эти пункты блокирующие. Если хоть один не выполнен — задача не сдана.

1. ✅ `npm run build` зелёный.
2. ✅ Существующий `src/mastra/tools/clean-site-tool.ts` **не редактируется**, кроме одной строки импорта.
3. ✅ Существующий `scripts/clean-site.ts` остаётся в репозитории как тонкая CLI-обёртка (~50 строк), импортирующая функционал из `src/mastra/cleaners/`.
4. ✅ Команда `npm run clean -- downloads/powergummies.shop_backup` (или любая другая тестовая директория) работает с тем же набором CLI-флагов: `--no-backup`.
5. ✅ Сигнатуры экспортируемых функций **полностью совпадают** с тем, что есть сейчас:
   - `export async function cleanSite(siteDir: string): Promise<CleanStats>`
   - `export async function createBackup(siteDir: string): Promise<string>`
   - `export interface CleanStats { ... }` — все 25 полей идентичны.
6. ✅ Регрессионный тест поведения (см. раздел 7) — стат-снимок до/после идентичен **байт-в-байт**.
7. ✅ Никаких новых зависимостей в `package.json`.
8. ✅ Никаких изменений в логике, regex'ах, списках хостов/ключевых слов. Только перемещение кода.
9. ✅ Никаких `any`. Импорт `import type` где возможно.
10. ✅ Все pass-функции — **pure**: не делают I/O, принимают строку и контекст, возвращают `{ html | js | css | svg, counts, logs? }`. I/O (read/write/walk/rm/cp) — только в `pipeline.ts` и `index.ts` модуля cleaners.

---

## 2. Целевая структура файлов

Создай **точно** такую структуру:

```
src/mastra/cleaners/
├── index.ts
├── pipeline.ts
├── types.ts
├── registry/
│   ├── tracker-hosts.ts
│   ├── trusted-hosts.ts
│   ├── tracker-keywords.ts
│   ├── tracker-filenames.ts
│   ├── meta-names.ts
│   ├── event-attrs.ts
│   ├── offer-patterns.ts
│   └── js-warning-patterns.ts
├── utils/
│   ├── url.ts
│   ├── walk.ts
│   ├── offer-detector.ts
│   └── changelog.ts
├── passes/
│   ├── html/
│   │   ├── remove-tracker-scripts.ts
│   │   ├── remove-inline-trackers.ts
│   │   ├── remove-tracker-jsonld.ts
│   │   ├── remove-noscript-trackers.ts
│   │   ├── remove-tracker-links.ts
│   │   ├── remove-tracker-metas.ts
│   │   ├── remove-meta-refresh.ts
│   │   ├── remove-tracker-iframes.ts
│   │   ├── remove-img-pixels.ts
│   │   ├── remove-base.ts
│   │   ├── remove-object-embed.ts
│   │   ├── strip-event-attrs.ts
│   │   └── replace-offer-links.ts
│   ├── svg/
│   │   └── clean-svg.ts
│   ├── js/
│   │   ├── remove-service-worker.ts
│   │   ├── remove-eval-obfuscation.ts
│   │   └── warn-suspicious-patterns.ts
│   ├── css/
│   │   ├── remove-tracker-imports.ts
│   │   └── remove-tracker-urls.ts
│   └── fs/
│       ├── remove-tracker-externals.ts
│       └── remove-source-maps.ts
└── README.md
```

И отредактируй **только эти два файла** вне `src/mastra/cleaners/`:

- `scripts/clean-site.ts` — оставить тонкую CLI-обёртку.
- `src/mastra/tools/clean-site-tool.ts` — единственное изменение: путь импорта.

---

## 3. Публичный API (что экспортирует `src/mastra/cleaners/index.ts`)

```ts
export type { CleanStats, ChangelogEntry, CleanSiteOptions } from './types.js';
export { cleanSite, createBackup } from './pipeline.js';
```

Сигнатуры:

```ts
// pipeline.ts
export async function cleanSite(siteDir: string): Promise<CleanStats>;
export async function createBackup(siteDir: string): Promise<string>;

// types.ts
export interface CleanStats { /* 25 полей, идентично текущему */ }
export interface ChangelogEntry { /* идентично текущему */ }
export interface CleanSiteOptions { /* зарезервировано на будущее, пока пустой объект */ }
```

> `CleanSiteOptions` пока не используется в `cleanSite()`. **Не добавляй параметр в сигнатуру** в этом рефакторинге — нарушит инвариант 5. Только тип.

---

## 4. Точный mapping строк исходника → новые файлы

Используй именно эти границы строк (1-indexed). Все номера строк ссылаются на ТЕКУЩИЙ `scripts/clean-site.ts` на момент создания этого ТЗ.

### registry/

| Файл | Что переносится | Строки исходника |
|---|---|---|
| `registry/tracker-hosts.ts` | `TRACKER_HOSTS`, `PRECONNECT_RELS` | 84–176, 349 |
| `registry/trusted-hosts.ts` | `TRUSTED_HOSTS` | 178–189 |
| `registry/event-attrs.ts` | `DANGEROUS_EVENT_ATTRS` | 191–198 |
| `registry/tracker-filenames.ts` | `TRACKER_FILENAME_PATTERNS` | 200–255 |
| `registry/tracker-keywords.ts` | `TRACKER_INLINE_KEYWORDS`, `TRACKER_NOSCRIPT_KEYWORDS` | 257–334 |
| `registry/meta-names.ts` | `TRACKER_META_NAMES` | 336–346 |
| `registry/offer-patterns.ts` | `OFFER_URL_PATTERNS`, `NON_OFFER_PATH_PATTERNS` | 449–482 |
| `registry/js-warning-patterns.ts` | `JS_WARNING_PATTERNS` | 796–813 |

Каждый файл — `export const` соответствующей константы, ничего больше. Никаких функций.

### utils/

| Файл | Что переносится | Строки исходника |
|---|---|---|
| `utils/url.ts` | `extractHostname`, `hostMatches`, `urlMatchesTracker`, `isExternalUrl`, `inlineLooksLikeTracker` | 355–416 |
| `utils/walk.ts` | `walkFiles` | 418–428 |
| `utils/offer-detector.ts` | `extractMainHostFromDir`, `looksLikeOfferUrl` | 484–517 |
| `utils/changelog.ts` | `writeChangelog` | 936–945 |

`utils/url.ts` импортирует `TRACKER_HOSTS`, `TRUSTED_HOSTS`, `TRACKER_FILENAME_PATTERNS` из `../registry/*`.
`utils/offer-detector.ts` импортирует `TRUSTED_HOSTS`, `OFFER_URL_PATTERNS`, `NON_OFFER_PATH_PATTERNS` и `extractHostname`, `hostMatches`.

### types.ts

Переносится:
- `interface CleanStats` (строки 44–70) → `export interface CleanStats`.
- `interface ChangelogEntry` (строки 72–78) → `export interface ChangelogEntry`.
- `interface HtmlCleanCounts` (строки 434–447) — **удалить**, заменить на `Partial<HtmlStatsDelta>` (см. ниже).

Добавляется (новое):

```ts
export interface PassContext {
  siteDir: string;
  mainHost: string;
  filePath: string;
  relPath: string;
  log: ChangelogEntry[];
}

// Поля CleanStats, относящиеся к HTML-проходам.
export type HtmlStatsKey =
  | 'scriptsRemoved'
  | 'inlineScriptsRemoved'
  | 'noscriptsRemoved'
  | 'linksRemoved'
  | 'metasRemoved'
  | 'jsonLdRemoved'
  | 'imgPixelsRemoved'
  | 'metaRefreshRemoved'
  | 'baseHrefRemoved'
  | 'objectEmbedsRemoved'
  | 'eventAttrsRemoved'
  | 'offerLinksReplaced';

export type HtmlStatsDelta = Partial<Record<HtmlStatsKey, number>>;

export interface HtmlPassResult {
  html: string;
  counts: HtmlStatsDelta;
}

export type HtmlPass = (html: string, ctx: PassContext) => HtmlPassResult;

export interface CleanSiteOptions {
  // Зарезервировано на будущее. В этом рефакторинге не использовать.
  readonly _reserved?: never;
}
```

### passes/html/ — каждый файл

Каждый HTML-pass — pure-функция `HtmlPass`. Внутри ровно одна `String.prototype.replace`-процедура из исходника. Имена констант (`counts.scripts++` и т.п.) меняются на ключи `HtmlStatsKey`.

| Файл | Имя экспорта | Строки исходника |
|---|---|---|
| `passes/html/remove-tracker-scripts.ts` | `removeTrackerScripts` (включает блок 1 и блок 6 — iframe, оба пишут в `scriptsRemoved`) | 535–546 + 633–643 |
| `passes/html/remove-inline-trackers.ts` | `removeInlineTrackers` (без JSON-LD ветки — она пойдёт в отдельный pass через флаг) | 548–574 |
| `passes/html/remove-tracker-jsonld.ts` | `removeTrackerJsonLd` | (логика из 555–566) |
| `passes/html/remove-noscript-trackers.ts` | `removeNoscriptTrackers` | 576–587 |
| `passes/html/remove-tracker-links.ts` | `removeTrackerLinks` | 589–606 |
| `passes/html/remove-tracker-metas.ts` | `removeTrackerMetas` | (только ветка с `name=` из 608–631) |
| `passes/html/remove-meta-refresh.ts` | `removeMetaRefresh` | (только ветка с `http-equiv=refresh` из 608–631) |
| `passes/html/remove-tracker-iframes.ts` | `removeTrackerIframes` | 633–643 (см. примечание ниже) |
| `passes/html/remove-img-pixels.ts` | `removeImgPixels` | 645–655 |
| `passes/html/remove-base.ts` | `removeBase` | 657–664 |
| `passes/html/remove-object-embed.ts` | `removeObjectEmbed` | 666–690 |
| `passes/html/strip-event-attrs.ts` | `stripEventAttrs` | 707–722 |
| `passes/html/replace-offer-links.ts` | `replaceOfferLinks` | 692–705 |

> **Важно про `<iframe>`:** в исходнике iframe-удаление сейчас инкрементит **тот же** счётчик `counts.scripts`, что и `<script>`. Это сохраняется как есть. То есть либо положи логику iframe **внутрь** `removeTrackerScripts`, либо сделай отдельный pass `removeTrackerIframes`, который тоже пишет в `scriptsRemoved`. **Выбери: всё в одном `removeTrackerScripts`** — так проще и точно повторяет текущее поведение. Файл `remove-tracker-iframes.ts` тогда не создавай. Обнови раздел структуры файлов в README, если убираешь его.

> **Важно про inline + JSON-LD:** в исходнике это один `replace`. Раздели на два **независимых** прохода: сначала `removeTrackerJsonLd` (только если `type="application/ld+json"`), затем `removeInlineTrackers` (только без `src=` и без `type=ld+json`). **Поведение должно остаться идентичным**: тот же inline-скрипт обрабатывается ровно одним из двух passes. Если сомневаешься — оставь это в одном файле `remove-inline-trackers.ts` с обеими ветками внутри.

### passes/svg/clean-svg.ts

Перенос `cleanSvgFile` (строки 951–966). Подпись:

```ts
import type { PassContext } from '../../types.js';
export async function cleanSvgFile(filePath: string): Promise<number>;
```

**Не делай pure-функцию для SVG** — оставь как файловую операцию. SVG-проход вызывается из `pipeline.ts` поштучно для каждого `.svg`-файла, как сейчас.

### passes/js/

| Файл | Экспорт | Источник |
|---|---|---|
| `passes/js/remove-service-worker.ts` | `removeServiceWorker(content, relPath, log)` → `{ content, removed }` | 824–832 |
| `passes/js/remove-eval-obfuscation.ts` | `removeEvalObfuscation(content, relPath, log)` → `{ content, removed }` | 834–852 |
| `passes/js/warn-suspicious-patterns.ts` | `warnSuspiciousPatterns(content, relPath, log)` → `void` | 854–875 |

И композитор:

- `passes/js/clean-js.ts` (новый файл): экспортирует `cleanJsFile(filePath, relPath, log) => Promise<number>` — оборачивает три выше плюс read/write. Логика **идентична** функции `cleanJsFile` из строк 815–879.

### passes/css/

| Файл | Экспорт | Источник |
|---|---|---|
| `passes/css/remove-tracker-imports.ts` | `removeTrackerImports(content, relPath, log)` → `{ content, removed }` | 894–909 |
| `passes/css/remove-tracker-urls.ts` | `removeTrackerUrls(content, relPath, log)` → `{ content, removed }` | 911–926 |

Композитор `passes/css/clean-css.ts` экспортирует `cleanCssFile(filePath, relPath, log) => Promise<number>` (логика 885–930).

### passes/fs/

| Файл | Экспорт | Источник |
|---|---|---|
| `passes/fs/remove-tracker-externals.ts` | `removeTrackerExternals(siteDir) => Promise<number>` | 734–756 |
| `passes/fs/remove-source-maps.ts` | `removeSourceMaps(siteDir) => Promise<{ mapsDeleted, filesStripped }>` | 762–790 |

### pipeline.ts

Реализует:

```ts
export async function createBackup(siteDir: string): Promise<string>; // строки 972–976
export async function cleanSite(siteDir: string): Promise<CleanStats>; // строки 982–1081
```

Внутри `cleanSite`:

1. Завести `stats: CleanStats` и `changelog: ChangelogEntry[]` — как сейчас.
2. Завести массив `HTML_PASSES: HtmlPass[]` в **точно том же порядке**, что в исходнике (см. ниже). Не меняй порядок.
3. Для каждого HTML/PHP файла:
   - прочитать в строку,
   - применить `applyHtmlPasses(html, ctx)` — функция, которая `reduce`-ит passes, складывая counts в `Partial<CleanStats>`,
   - записать обратно если изменилось,
   - влить counts в общий `stats`.
4. SVG / JS / CSS — как сейчас (через композиторы из `passes/js/clean-js.ts` и т.д.).
5. Послефайловые шаги: `removeTrackerExternals`, `removeSourceMaps`, `writeChangelog` — без изменений.

**Точный порядок HTML_PASSES (КОПИРУЙ КАК ЕСТЬ):**

```ts
const HTML_PASSES: HtmlPass[] = [
  removeTrackerScripts,      // 1: <script src> + <iframe src>
  removeTrackerJsonLd,       // 2a: JSON-LD ветка (если выделена)
  removeInlineTrackers,      // 2b: остальные inline <script>
  removeNoscriptTrackers,    // 3
  removeTrackerLinks,        // 4
  removeTrackerMetas,        // 5a
  removeMetaRefresh,         // 5b
  removeImgPixels,           // 7
  removeBase,                // 8
  removeObjectEmbed,         // 9+10
  replaceOfferLinks,         // 11
  stripEventAttrs,           // 12
];
// + блок косметики (collapse тройных пустых строк) — оставь как финальный шаг ВНЕ массива, прямо в applyHtmlPasses.
```

> Если объединил inline+jsonLd в один pass `removeInlineTrackers` — массив укорачивается на одну позицию, остальное идентично.

### index.ts

Реэкспортирует только публичное API (см. раздел 3). Никакой логики.

### README.md

Внутри `src/mastra/cleaners/README.md` — короткий гайд (50–80 строк):
- что такое pass,
- как добавить новый html-pass: создать файл, добавить в `HTML_PASSES` в `pipeline.ts`, добавить ключ в `HtmlStatsKey` и поле в `CleanStats` (если новый счётчик),
- что **не** надо класть в cleaners (verification, packaging, network).

---

## 5. Что становится с `scripts/clean-site.ts`

Заменить целиком на ~50 строк CLI-обёртки:

```ts
import { resolve, join } from 'node:path';
import { stat } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { cleanSite, createBackup } from '../src/mastra/cleaners/index.js';

function printUsageAndExit(): never {
  console.error('Usage: npm run clean -- <siteDir> [--no-backup]');
  process.exit(1);
}

async function main(): Promise<void> {
  // ... код из строк 1088–1146 без изменений ...
}

const __filename = fileURLToPath(import.meta.url);
if (resolve(process.argv[1] ?? '') === resolve(__filename)) {
  main().catch((err) => {
    console.error('[clean-site] Fatal:', err);
    process.exit(1);
  });
}
```

Никаких реэкспортов из этого файла — `clean-site-tool.ts` пойдёт напрямую в `cleaners/index.ts`.

---

## 6. Что становится с `src/mastra/tools/clean-site-tool.ts`

Изменение **только в одной строке импорта**:

```ts
// БЫЛО:
import { cleanSite, createBackup } from '../../../scripts/clean-site';

// СТАЛО:
import { cleanSite, createBackup } from '../cleaners/index.js';
```

Всё остальное (Zod-схемы, `execute`) — без правок.

---

## 7. Регрессионный тест (обязательно)

После рефакторинга прогони на двух тестовых сайтах из `downloads/` (они уже в репозитории):

### Подготовка

```bash
# Бэкап «эталонной» версии (на main / до рефакторинга)
git stash || true
cp -r downloads/powergummies.shop /tmp/baseline-powergummies
git stash pop || true
```

### Прогон до и после

```bash
# 1) Получить эталон
git checkout main -- scripts/clean-site.ts
cp -r /tmp/baseline-powergummies /tmp/before-test
npm run clean -- /tmp/before-test --no-backup > /tmp/before.log 2>&1

# 2) Применить рефактор и прогнать ещё раз на чистой копии
git checkout <твоя-ветка> -- src/mastra/cleaners scripts/clean-site.ts src/mastra/tools/clean-site-tool.ts
cp -r /tmp/baseline-powergummies /tmp/after-test
npm run clean -- /tmp/after-test --no-backup > /tmp/after.log 2>&1

# 3) Сравнить
diff -r /tmp/before-test /tmp/after-test     # должно быть пусто
diff <(grep -E '^\[clean-site\]' /tmp/before.log) <(grep -E '^\[clean-site\]' /tmp/after.log)  # должно быть пусто
```

**Acceptance:** оба `diff` пустые. Если есть расхождение — рефакторинг **не сдан**, ищи где сломал порядок passes или потерял ветку логики.

Дополнительно:

```bash
npm run build   # обязан быть зелёным
```

---

## 8. Чеклист «definition of done»

- [ ] Создана структура `src/mastra/cleaners/` ровно как в разделе 2.
- [ ] Все константы перемещены в `registry/*.ts` без изменений (см. раздел 4).
- [ ] Все утилиты перемещены в `utils/*.ts` без изменений.
- [ ] Каждый HTML-pass — отдельный файл, экспортирует pure-функцию типа `HtmlPass`.
- [ ] `pipeline.ts` содержит массив `HTML_PASSES` в указанном порядке.
- [ ] Публичный API из `cleaners/index.ts` совпадает с разделом 3.
- [ ] `scripts/clean-site.ts` — только CLI (~50 строк).
- [ ] `src/mastra/tools/clean-site-tool.ts` — изменена только одна строка импорта.
- [ ] `npm run build` зелёный.
- [ ] Регрессионный `diff -r` пустой на тестовом сайте `downloads/powergummies.shop`.
- [ ] Регрессионный `diff` логов очистки пустой.
- [ ] `src/mastra/cleaners/README.md` написан.
- [ ] Обновлён `progress.txt`: запись «refactor: clean-site → cleaners modules; behaviour identical».
- [ ] Обновлён `PLAN.md`: в разделе «Шаг 2» добавь строку «Рефакторинг архитектуры — DONE».

---

## 9. Чего НЕ делать в этой итерации

- ❌ Не добавлять новые правила очистки (CDN-замена, `<frame>`, проверка путей и т.п.) — это отдельные задачи **после** рефакторинга.
- ❌ Не менять regex'ы.
- ❌ Не менять списки трекеров / ключевых слов.
- ❌ Не менять формат `clean-site-changes.log`.
- ❌ Не делать `cleanSite()` принимающим опции — пока что сигнатура та же `(siteDir: string) => Promise<CleanStats>`.
- ❌ Не вносить изменения в Mastra-tool кроме строки импорта.
- ❌ Не добавлять зависимости в `package.json`.
- ❌ Не добавлять unit-тесты (отдельная задача после рефакторинга).
- ❌ Не вытаскивать парсинг HTML на cheerio/parse5 — только перемещение текущей regex-логики.

---

## 10. Подсказка по импортам

Проект собирается через Mastra (`mastra build`), `"type": "module"`, Node ≥22.13. Все TS-импорты пишем с расширением `.js` (не `.ts`):

```ts
// ✅
import { TRACKER_HOSTS } from '../registry/tracker-hosts.js';

// ❌
import { TRACKER_HOSTS } from '../registry/tracker-hosts';
import { TRACKER_HOSTS } from '../registry/tracker-hosts.ts';
```

---

## 11. Если что-то непонятно

Останавливайся и задавай вопрос **до** того, как начать кодить. Любая «улучшающая инициатива», не описанная в этом ТЗ, ломает инвариант 8 и делает сдачу невозможной — diff на регрессионном прогоне станет ненулевым.
