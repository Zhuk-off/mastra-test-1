# Red Team: Тир 3a — оркестрация очистки JS

- [`clean-js.ts`](src/mastra/cleaners/passes/js/clean-js.ts) — оркестратор очистки `.js`/`.mjs`
- [`remove-eval-obfuscation.ts`](src/mastra/cleaners/passes/js/remove-eval-obfuscation.ts) (regex)
- [`remove-service-worker.ts`](src/mastra/cleaners/passes/js/remove-service-worker.ts) (regex)
- [`warn-suspicious-patterns.ts`](src/mastra/cleaners/passes/js/warn-suspicious-patterns.ts) (+ `registry/js-warning-patterns.ts`)

**Порядок в `cleanJsFile`:** SW(regex) → eval-obf(regex) → warn(regex) → [advanced:] detectObfuscation
(удалить файл) → `parseJs` → detectMetricFile (удалить) → extractUsefulFunctions (вырезать exfil-функции)
→ keylogger/redirect (warn) → docWriteScript (вырезать). Соундность самих детекторов — Тир 3c; здесь —
оркестрация и regex-слой.

**Сильные стороны:** `MagicString` + сортировка позиций по убыванию в docWrite-удалении (правильная
техника против сдвигов); `detectObfuscation` до `parseJs` (не парсим заведомо обфусцированное).

---

## clean-js.ts

### [CJS-1] 🟡 Robustness/Correctness · 🟧 High · УСТАРЕВШИЙ AST: режем по старым позициям после мутации content

- **Сейчас:** `ast` парсится один раз ([:57](src/mastra/cleaners/passes/js/clean-js.ts:57)). Затем
  `extractUsefulFunctions` **мутирует** `content` ([:72–75](src/mastra/cleaners/passes/js/clean-js.ts:72)).
  После этого `detectKeylogger(ast, content)`, `detectRedirect(ast, …)` и **`detectDocWriteScript(ast, …)`**
  получают **старый** `ast` + **новый** `content`.
- **Последствие:** `detectDocWriteScript` возвращает `r.start`/`r.end` из старого AST, а
  `ms = new MagicString(content)` строится на **мутированном** content и
  `ms.remove(r.start, end)` ([:108–124](src/mastra/cleaners/passes/js/clean-js.ts:108)) режет
  **смещённый** диапазон → **порча файла** (вырезается не то). Срабатывает, когда в одном файле
  `extractUsefulFunctions` что-то удалил **и** есть `document.write(<script>)` — правдоподобно для
  зловреда. Плюс keylogger/redirect warnings получают неверные номера строк/сниппеты.
  Иронично: внутри docWrite-удаления позиции сортируют по убыванию (учли сдвиг **внутри** прохода),
  но межпроходный сдвиг от `extractUsefulFunctions` упустили.
- **Рекомендация:** **перепарсить** после `extractUsefulFunctions` (новый `ast` от нового `content`)
  перед keylogger/redirect/docWrite; либо прогонять детекторы до извлечения; либо вести все правки
  одним `MagicString` и сериализовать один раз.
- **Уверенность:** подтверждено чтением кода (ast не переприсваивается после мутации).

### [CJS-2] 🟡 Robustness · 🟨 Medium · `detectObfuscation` удаляет ВЕСЬ файл (без карантина)

- **Сейчас:** `if (detectObfuscation(content)) return { isObfuscated: true }`
  ([:47–55](src/mastra/cleaners/passes/js/clean-js.ts:47)) → `pipeline` `unlink`-ает файл и режет
  `<script src>` регэкспом (PIPE-2).
- **Последствие:** агрессивное действие (полное удаление) на эвристике. FP на тяжело
  минифицированной **легитимной** либе (uglify-имена `_0x…`, плотный `fromCharCode`), которую не
  репинули → файл удалён → сайт сломан, а ссылка вырезана хрупким регэкспом. Нет карантина — нельзя
  отыграть точечно (только общий бэкап).
- **Рекомендация:** вместо `unlink` — карантинить обфусцированный файл (в `_quarantine/`) и громко
  флагать; соундность детекта — [3c](#).
- **Уверенность:** подтверждено чтением кода; FP-частота — за `detect-obfuscation` (3c).

### [CJS-3] 🟡 Robustness · 🟨 Medium · парс не удался → ВСЕ AST-детекторы молча пропущены

- **Сейчас:** `const ast = parseJs(content); if (ast) { …все детекторы… }`
  ([:57–58](src/mastra/cleaners/passes/js/clean-js.ts:57)). Нет `else`/лога.
- **Последствие:** файл с синтаксисом, который acorn не берёт (ES-next, намеренно «хитрый»),
  проходит только regex-слой (SW/eval/warn), а metric/exfil/keylogger/redirect/docwrite **не
  проверяются** — и без предупреждения. Атакующий может дожать синтаксисом. Та же болезнь, что
  [2D-5](2d-defensive.md).
- **Рекомендация:** при `!ast` — лог `JS_NOT_ANALYZED` + флаг в отчёт/карантин, а не тишина.
- **Уверенность:** подтверждено чтением кода.

### [CJS-4] 🟡 Robustness · 🟨 Medium · regex SW/eval может сломать JS → каскадом отключить AST

- **Сейчас:** `removeServiceWorker`/`removeEvalObfuscation` — чистый regex по сырому content **до**
  `parseJs` (см. ниже SW-1/EVAL-2).
- **Последствие:** их некорректная правка (вложенные скобки, контекст присваивания) делает content
  синтаксически битым → `parseJs(content)` падает → срабатывает CJS-3 (AST-детекторы пропущены).
  Один кривой regex-проход глушит весь advanced-анализ файла.
- **Рекомендация:** проверять валидность после regex-правок (или делать их через AST); при поломке —
  откатывать regex-правку и флагать.
- **Уверенность:** подтверждено чтением кода (порядок: regex → parse).

### [CJS-5] 🟢 Soundness (FN) · 🟨 Medium · макросы во внешних `.js` не сканируются (T-8 ✅)

- **Сейчас:** `cleanJsFile` ищет трекеры/exfil/обфускацию, но **не** макросы (нет `MACRO_RE`/`isOwnMacro`).
- **Последствие:** подтверждает [MAC-1](2c-macros-offer.md)/нить T-8: `{offer}`/чужие макросы в внешних
  `.js` нигде не находятся — карта макросов неполна.
- **Рекомендация:** добавить скан макросов по строковым литералам в `cleanJsFile`, складывать в общую
  карту (ctx.macros доступен только в DOM-проходах — здесь нужен отдельный канал).
- **Уверенность:** подтверждено чтением кода (T-8 резолвлен).

### [CJS-6] 🟢 Soundness · 🟩 Low · warn-слой не гейтит выгрузку

`warnSuspiciousPatterns` только пишет в changelog; подозрительный файл выгружается как есть, если
человек не вмешается. Это by design (предупреждение), но стоит убедиться, что `clean-site-tool`
громко поднимает `detectorWarnings` (он поднимает — см. описание тула).

---

## remove-eval-obfuscation.ts

### [EVAL-1] 🟢 Soundness (FN) · 🟨 Medium · очень узкая регулярка

Ловит лишь `eval(atob|unescape|decodeURIComponent(...))` и `eval("<base64≥40>")`
([:11–28](src/mastra/cleaners/passes/js/remove-eval-obfuscation.ts:11)). Обходы:
`eval(window.atob(...))`, `new Function(atob(...))()`, `setTimeout("…",0)`, `(0,eval)(…)`,
`window['eval'](…)`, `eval(varWithBase64)`, `eval(decodeURI(...))`. Реальная защита — `detectObfuscation`
(3c); этот проход опортунистичен.

### [EVAL-2] 🟡 Robustness · 🟨 Medium · удаление eval в контексте выражения ломает JS

`var x = eval(atob('...'));` → регулярка вырезает `eval(atob('...'));`, оставляя `var x = ` →
синтаксическая ошибка → каскад CJS-4. Рекомендация: удалять только eval-**стейтменты**, не выражения.

---

## remove-service-worker.ts

### [SW-1] 🟡 Robustness · 🟨 Medium · вложенные скобки корёжат JS

`/…register\s*\(([^)]*)\)…/` — `[^)]*` стопится на первой `)`. Для
`navigator.serviceWorker.register(getURL())` вырежет `…register(getURL()` и оставит `);` → битый JS.

### [SW-2] 🟢 Soundness (FN) · 🟩 Low-Med · только литеральный путь

Обходят `navigator['serviceWorker'].register`, `navigator?.serviceWorker?.register(...)`, алиас
`const sw = navigator.serviceWorker; sw.register(...)`. SW из статического лендинга менее опасен
(нет push-бэкенда), поэтому Low-Med.

---

## warn-suspicious-patterns.ts

### [WARN-1] 🟩 Low (латентный footgun) · цикл требует флага `g`

`re.lastIndex = 0; while (re.exec(content))` ([:11–12](src/mastra/cleaners/passes/js/warn-suspicious-patterns.ts:11))
корректен **только** пока все паттерны глобальные. Сейчас все `JS_WARNING_PATTERNS` с `/g` (ок), но
добавление паттерна без `g` → **бесконечный цикл / зависание** на любом JS-файле. Рекомендация:
конструировать regex с принудительным `g` или ассертить флаг.

### [WARN-2] 🟢 Граница · warn-слой шумит и пропускает

Подстрочные паттерны (`fetch(`, `localStorage.`) дают FP в комментариях/строках и FN на обфускации.
Это эвристический warn-уровень — нормально, но не считать его защитой.

---

## Пробелы в тестах

Нужны: CJS-1 (extractUsefulFunctions + docWrite в одном файле → проверить, что режется верный диапазон),
CJS-3 (непарсимый JS → флаг, не тишина), EVAL-2/SW-1 (regex ломает JS со вложенными скобками/
присваиванием), CJS-2 (минифицированная легит-либа не должна удаляться целиком — но это 3c).

## Итог

1. **CJS-1** — High: перепарсить AST после `extractUsefulFunctions` (или единый MagicString) — иначе
   `detectDocWriteScript` режет по смещённым позициям.
2. **CJS-3 + CJS-4** — не глушить AST-анализ молча; regex-правки не должны ломать парс.
3. **CJS-2** — обфусцированный файл в карантин, а не `unlink` по эвристике.

---

## ✅ Статус фиксов (C5)

- **CJS-1 ✅** — `clean-js` перепарсивает AST после `extractUsefulFunctions` (если что-то вырезано):
  `let ast`, `ast = parseJs(content)`, а keylogger/redirect/docWrite вынесены во второй `if (ast)` на
  актуальном дереве. Раньше старые позиции на укоротившемся `content` давали порчу файла /
  `MagicString: Character is out of bounds` (краш). Тест: `passes/js/__tests__/clean-js.test.ts`.
- **CJS-2 / OBF-1 / MET-1** 🛠 — карантин-вместо-`unlink` для obfuscated/metric (C5б) — следующий шаг.
- **CJS-3, CJS-4** — не трогали (не глушить AST молча; regex не должен ломать парс) — отдельно.
