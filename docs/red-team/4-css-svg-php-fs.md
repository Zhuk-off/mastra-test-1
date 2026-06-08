# Red Team: Тир 4 — CSS / SVG / PHP / FS

- CSS: [`clean-css`](src/mastra/cleaners/passes/css/clean-css.ts), [`remove-tracker-imports`](src/mastra/cleaners/passes/css/remove-tracker-imports.ts), [`remove-tracker-urls`](src/mastra/cleaners/passes/css/remove-tracker-urls.ts)
- SVG: [`clean-svg`](src/mastra/cleaners/passes/svg/clean-svg.ts)
- PHP: [`detect-php-backdoors`](src/mastra/cleaners/passes/php/detect-php-backdoors.ts)
- FS: [`remove-tracker-externals`](src/mastra/cleaners/passes/fs/remove-tracker-externals.ts), [`remove-source-maps`](src/mastra/cleaners/passes/fs/remove-source-maps.ts)

---

## FS / containment

### [EXT-1] 🔴 Bypass · 🟧 High · `_external/` ломает модель «relative = keep»

- **Сейчас:** загрузчик зеркалит внешние ресурсы в `_external/<host>/…`. `removeTrackerExternals`
  удаляет такие папки **только** для **известных** трекер-хостов (блок-лист `TRACKER_HOSTS`)
  ([:15–18](src/mastra/cleaners/passes/fs/remove-tracker-externals.ts:15)). А ссылки на них в HTML —
  **относительные** (`src="_external/<host>/x.js"`), значит `classifyResource` их **keep**
  (relative → keep, [allowlist.ts:57](src/mastra/cleaners/utils/allowlist.ts:57)).
- **Последствие:** зеркалированный ресурс с **неизвестного** хоста (`_external/evil-cdn.xyz/steal.js`)
  → папка не удаляется (хост не в блок-листе) + относительная ссылка остаётся → **скрипт выживает и
  отдаётся локально**. То есть `_external/` переносит чужой (потенциально зловредный) контент в разряд
  «локальный», обходя весь белый список. Защита остаётся только на (слабом, см. [DET-1/2/3](3c-detectors.md))
  JS-чистильщике, который пройдётся по `_external/*.js`.
- **Рекомендация:** трактовать `_external/<host>/` как ВНЕШНИЙ ресурс соответствующего хоста и гонять
  через `classifyResource` (host из имени папки) — не-trusted → карантин; известный трекер → удалить
  И вырезать ссылку.
- **Уверенность:** подтверждено чтением (relative-keep + блок-лист удаления).

### [EXT-2] 🟡 Robustness · 🟩 Low · висячие ссылки после удаления `_external/`

Удаление папки известного трекера не сопровождается вырезанием `<script src="_external/…">` из HTML
(пост-обработка PIPE-2 чистит только metric/obfuscated/unversioned/dead) → остаётся 404. Безвредно,
но грязно.

### [SM-1] 🟩 Low · `remove-source-maps` — второй полный обход + двойной I/O

`removeSourceMaps` снова обходит **все** файлы и перечитывает/перезаписывает каждый `.js`/`.css`
(после того как их уже обработал clean-js/clean-css). Логика корректна (удаляет `.map`, срезает
`sourceMappingURL`, включая data:-инлайн), но это лишний проход I/O. Низкий приоритет.

---

## CSS

### [CSS-1] 🔴 Bypass · 🟨 Medium · CSS `url()` чистится блок-листом — неизвестный внешний ресурс остаётся

- **Сейчас:** `removeTrackerUrls` убирает `url(http(s)://…)` только если `urlMatchesTracker`
  (блок-лист) ([:14](src/mastra/cleaners/passes/css/remove-tracker-urls.ts:14)). `classifyResource`
  (белый список) к CSS `url()` НЕ применяется.
- **Последствие:** `body{background:url(https://evil.xyz/track.gif)}` с **неизвестным** хостом → не
  матчит блок-лист → **остаётся** → запрос-маяк на хост атакующего при рендере (утечка pageview/IP).
  CSS — это resource-load вектор, а тут только блок-лист.
- **Рекомендация:** применять `classifyResource(url,'img')` к внешним CSS `url()` (не-trusted →
  карантин/убрать).
- **Уверенность:** подтверждено чтением кода.

### [CSS-2] 🔴 Bypass · 🟨 Medium · inline `<style>`/`style=""` не чистятся от трекер-url()

- **Сейчас:** `removeTrackerUrls`/`removeTrackerImports` работают только по **внешним `.css` файлам**
  (`cleanCssFile`). Inline `<style>` и `style=""` в HTML их не проходят (DOM-проходы 2a–2d трекер-url
  в CSS не чистят; `detect-macros` смотрит inline-CSS только на **макросы**).
- **Последствие:** `<style>body{background:url(https://tracker/p)}</style>` → не вычищается.
  Асимметрия: внешний CSS чистится, инлайновый — нет.
- **Рекомендация:** прогонять inline-CSS через ту же логику (или DOM-проход по `<style>`/`style=`).
- **Уверенность:** подтверждено (нет прохода для inline-CSS трекер-url).

### [CSS-3] 🟢 Soundness · 🟨 Medium · макросы во внешнем CSS не сканируются (T-8 ✅ полностью)

`cleanCssFile` ищет трекер-`@import`/`url()`, но не макросы. Подтверждает [MAC-1](2c-macros-offer.md):
`url({offerimage})` в внешнем `.css` не находится. T-8 закрыт (и для JS [CJS-5], и для CSS).

### [CSS-4] 🟩 Low-Med · протокол-относительный обход + relative @import

Регэкспы требуют `https?://`. `url(//evil/x)` и `@import url(//evil/x.css)` не матчатся → **остаются**
(тот же `//`-пробел, что в [DET-3](3c-detectors.md)). Относительный `@import "x.css"` не трогается
(локаль). Плюс `content.indexOf(whole)` для номера строки находит первое вхождение, а не текущее
(косметика лога).

---

## SVG (твой чек-лист: «там прячут JS»)

### [SVG-1] 🔴 Bypass · 🟨 Medium · пропускает self-closing/`href`-only `<script>` и неквотированные `on*`

- **Сейчас:** `/\<script\b[\s\S]*?<\/script>/` требует закрывающий тег; `on*` снимается только в
  кавычках ([:9–11](src/mastra/cleaners/passes/svg/clean-svg.ts:9)).
- **Последствие:** в SVG (XML) `<script xlink:href="evil.js"/>` (self-closing, внешний скрипт через
  href) **не матчит** `<script>…</script>` → выживает. `<svg onload=alert(1)>` (без кавычек) →
  не матчит quoted-`on*` → выживает.
- **Рекомендация:** убирать `<script ...>` и без закрывающего тега; снимать `on*` и без кавычек;
  лучше — XML-парсер вместо regex.
- **Уверенность:** подтверждено чтением кода.

### [SVG-2] 🔴 Bypass · 🟨 Medium · plain `href` (SVG2), `javascript:` и `<style>` в SVG не покрыты

- **Сейчас:** внешний линк убирается только для `xlink:href` ([:12](src/mastra/cleaners/passes/svg/clean-svg.ts:12)).
- **Последствие:** SVG2 использует **plain `href`**: `<image href="https://evil/x">`,
  `<use href="//evil#a">` — не проверяются. `<a xlink:href="javascript:…">` (схема javascript:) и
  `<style>@import url(tracker)</style>` внутри SVG — не покрыты.
- **Рекомендация:** проверять и `href` (не только `xlink:href`); ловить `javascript:`-схему;
  чистить `<style>` внутри SVG.
- **Уверенность:** подтверждено чтением кода.

> Хорошо: `isExternalUrl` для `xlink:href` корректно ловит `//host` (в отличие от JS-детекторов);
> `<foreignObject>` и квотированные `on*` снимаются. Дыры — в формах, не в самой идее.

---

## PHP

### [PHP-1] 🟢 Soundness (FN) · 🟨 Medium · обфусцированные бэкдоры мимо; узкое покрытие расширений

- **Сейчас:** 10 regex прямых форм (`eval($_POST)`, `system($_GET)`, …), **WARN-only**, и только для
  `ext === '.php'` (pipeline).
- **Последствие:** реальные бэкдоры обфусцируют: `$f='ev'.'al'; $f($_POST[x])`,
  `call_user_func('system',$_GET)`, `${'_'.'POST'}`, переменные-функции → **не ловятся**. И
  `.phtml`/`.php5`/`.inc` не сканируются. Это WARN (никогда не удаляет) — бэкдор уезжает, если человек
  не среагировал на `phpBackdoorWarning`. В связке с [PIPE-1](pipeline.md) PHP-файл может вообще не
  чиститься.
- **Рекомендация:** расширить расширения; добавить эвристики обфускации (concatenated eval,
  variable-functions); поднимать флаг громко (тул это делает).
- **Уверенность:** подтверждено чтением кода. PHP — не основной путь (лендинги статичны), потому Medium.

---

## Пробелы в тестах

Нужны: EXT-1 (`_external/<unknown-host>/x.js` → не должен молча оставаться), CSS-1 (неизвестный
`url()` в CSS), CSS-2 (inline `<style>` трекер-url), SVG-1 (self-closing `<script>`, неквотированный
`onload`), SVG-2 (plain `href`, `javascript:`), PHP-1 (обфусцированный бэкдор).

## Итог

1. **EXT-1** — High: `_external/` сводит чужой контент в «локальный» и обходит белый список —
   классифицировать по хосту из имени папки.
2. **CSS-1 + CSS-2** — применить белый список к CSS `url()` и к **inline** CSS (сейчас блок-лист и
   только внешние файлы).
3. **SVG-1 + SVG-2** — закрыть формы (self-closing script, неквотированные `on*`, plain `href`,
   `javascript:`) — SVG это твой явный вектор «там прячут JS».
