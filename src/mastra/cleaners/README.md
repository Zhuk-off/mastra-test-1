# Cleaners

Модульная система очистки скачанных лендингов от трекеров, sourcemaps и обфусцированного кода.

## Что такое pass

**Pass** — чистая функция, которая принимает строку (html/js/css) и контекст, и возвращает результат очистки.

- **HTML pass** — `HtmlPass`: `(html: string, ctx: PassContext) => { html: string; counts: HtmlStatsDelta }`
- **JS/CSS pass** — обычно `(content, relPath, log) => { content, removed }`
- **FS pass** — асинхронная файловая операция `(siteDir) => Promise<...>`

## Как добавить новый HTML pass

1. Создай файл в `passes/html/<name>.ts`, экспортируй `HtmlPass`.
2. Добавь pass в массив `HTML_PASSES` в `pipeline.ts` в нужном порядке.
3. Если нужен новый счётчик — добавь ключ в `HtmlStatsKey` и поле в `CleanStats` в `types.ts`.

## Что НЕ кладётся в cleaners

- Verification / packaging / network логика — это отдельные модули.
- Новые правила очистки добавляются **только** через новые passes.
