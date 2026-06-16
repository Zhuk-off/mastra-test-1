# Cleaners

Модульная система очистки скачанных лендингов от трекеров, кражи трафика, sourcemaps и
обфусцированного кода. Принцип — **белый список + карантин** (неизвестное не удаляется молча).

Дирижёр — `pipeline.ts` (`cleanSite()`). Порядок проходов и поток данных описаны в
[../../../ARCHITECTURE.md](../../../ARCHITECTURE.md).

## Что такое pass

**Pass** — функция очистки. Тип зависит от обрабатываемого файла:

- **HTML (DOM) pass** — `DomPass`: `(dom: CheerioAPI, ctx: PassContext) => HtmlStatsDelta`.
  Мутирует cheerio-дерево на месте, возвращает счётчики удалённого. Это основной тип.
  (Старый строковый `HtmlPass` оставлен только для совместимости — не использовать.)
- **JS/CSS/SVG pass** — работает с содержимым файла, напр. `(file, relPath, log, ...) => removed`.
- **FS pass** — файловая операция над папкой сайта: `(siteDir) => Promise<...>`.

`PassContext` (см. `types.ts`) даёт проходу `siteDir`, `mainHost`, `filePath`, `relPath`,
а также общие аккумуляторы: `log` (changelog), `quarantine`, `macros`, карты CDN-репина.

## Как добавить новый HTML (DOM) pass

1. Создай файл в `passes/html/<name>.ts`, экспортируй функцию типа `DomPass`.
2. Добавь её в массив `BASE_DOM_PASSES` в `pipeline.ts` в нужном порядке.
   Порядок важен: репин CDN идёт ДО белого списка, CSP — последним проходом.
   Проходы только для advanced-режима подключаются в функции `getDomPasses()`.
3. Если нужен новый счётчик — добавь ключ в `HtmlStatsKey` и поле в `CleanStats` (`types.ts`)
   и выведи его в отчёт `utils/report.ts`.

## Что НЕ кладётся в cleaners

- Verification / packaging / network логика — это отдельные модули.
- Новые правила очистки добавляются **только** через новые passes.
