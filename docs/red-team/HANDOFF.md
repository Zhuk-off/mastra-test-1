# Передача задачи: red-team фиксы чистильщика лендингов (для новой сессии)

> Скопируй весь этот файл как стартовый промпт новой сессии. Он самодостаточен: что уже
> сделано, какие решения владельца зафиксированы (НЕ переспрашивай), что осталось и как продолжать.

## Контекст

Проект — AI-агент очистки лендингов для арбитража трафика (Mastra, TypeScript, ESM, WSL).
Путь: `/home/asus/projects/me-projects/mastra/learn-mastra-2`
Идёт кампания фиксов по результатам red-team разбора (карта — `docs/red-team/00-summary.md`,
полный реестр находок со статусами — `docs/red-team/_index.md`). **Реестр `_index.md` — источник
правды**: 🆕 новая · 🛠 частично · ✅ закрыта.

Все правки лежат на ветке **`redteam-fixes`** (19 атомарных коммитов, один коммит = одна находка/кластер).
Перед продолжением — отревьюй/смерджи её при необходимости.

## Окружение и запуск (ВАЖНО)

cmd.exe с UNC-путём ломается. Все команды — через PowerShell + WSL + nvm:
```
wsl.exe -d Ubuntu-24.04 -e bash -lc 'export NVM_DIR=$HOME/.nvm; . "$NVM_DIR/nvm.sh"; cd /home/asus/projects/me-projects/mastra/learn-mastra-2 && <cmd>'
```
- Тесты: `npx vitest run` (сейчас **410 зелёных + 1 skipped**).
- Типы: `npx tsc --noEmit -p tsconfig.json` (должен быть EXIT=0).
- Очистка: `npm run clean -- <dir>` (добавь `-- --advanced` для AST-анализа).
- Проверка: `npm run verify -- <dir>` (теперь ИНТЕРАКТИВНАЯ — прокликивает).
- Реальный тестовый лендинг: `downloads/1753_landing_archive` (копируй в /tmp перед прогоном).

## Дисциплина фикса (на каждую находку)

1. **TDD**: сперва падающий регресс-тест рядом с существующими в `__tests__/`, потом фикс.
2. Держать ВСЕ тесты зелёными и `tsc --noEmit` чистым.
3. Конвенции: TS strict, ESM-импорты с суффиксом `.js`, без новых зависимостей без нужды.
4. **HTML — только cheerio** (`utils/html-dom.ts`), НЕ regex (краевой regex — причина PIPE-2/SW-1/EVAL-2).
5. `classifyResource` — чистая функция (без I/O). Чинить ВХОД в неё, не модель.
6. После фикса: обнови статус в `_index.md` (🆕→✅/🛠), коротко отметь в per-file доке, коммит на `redteam-fixes`.

## Что НЕ ломать (сильные стороны)

Белый список default-deny (`classifyResource`); cheerio для HTML; карантин-вместо-удаления (теперь и
для JS); репин либ на офиц. CDN + SRI; verify-детектор чужих хостов; base-aware загрузчик; AST-скан.

## ✅ РЕШЕНИЯ ВЛАДЕЛЬЦА (зафиксированы — НЕ переспрашивай, применяй везде)

1. **Редирект/keylogger на чужой хост = всегда кража, НИКОГДА не легит** → авто-удалять/нейтрализовать
   (не WARN). Уже сделано (`detect-redirect`/`detect-keylogger` → `shouldRemove:true`,
   `neutralize-detections.ts`). Любые новые детекторы такого рода — тоже действие, не варн.
2. **Серверный код (PHP/ASP) в чужом лендинге не используется** → вырезать ВСЕ серверные теги ПЕРВЫМ
   делом и чистить файл полностью (не пропускать). Уже сделано (`stripServerTags`). Свой PHP у владельца
   только: 1 строка spysecure сверху + файл отправки формы — добавляются на этапе АДАПТАЦИИ (не очистки).
3. **Человек отчёты обычно НЕ читает** → всё максимально автоматически; «оставить как WARN для ревью» —
   плохой выбор, предпочитать действие (удаление/карантин/нейтрализация).
4. **Лендинги одностраничные.** verify прокликивает; квиз → флаг `hasQuiz` (ручная перепроверка), это ок.
5. **Артефакты (`_quarantine/`, `clean-report.md`, лог) — ВНУТРИ папки лендинга. QUAR-1 НЕ делать**
   (владелец хочет один контекст; лендинги не в поиске, только внутренняя реклама FB).
6. Макросы (`{offer}`, `{_offer_value:...}`) — владелец активно использует; карта макросов важна.

## Что уже закрыто (ветка redteam-fixes, 19 коммитов)

- **P0:** C1 (allowlist: нормализация URL + классификация схем — AL-1/AL-2/2A-1/2A-2/2D-1),
  C2/C2-redo (серверные теги вырезаются+чистятся; PIPE-1/DOM-1/NORM-2/2D-4), C3а (path traversal NORM-1),
  REP-1 (отчёт: удаления + PHP-бэкдор).
- **Детекторы (C4):** DET-3 (единый `isExternalUrl` c `//`), DEC-1+RIE-1 (reference-safe removal `void 0`),
  DET-2 (member/bracket: `window.fetch` и т.п. — 🛠 без алиасов/2-строчного Image), DEC-2 (локальные имена
  не трекеры), DOC-1 (`document.write` iframe/img+склейка), RED-1/KEY-1 (авто-нейтрализация), EUF-2
  (statement-level exfil во внешних .js).
- **Destructive→карантин (C5):** CJS-1 (перепарс AST), CJS-2 (obfuscated/metric → карантин не unlink),
  EUF-1 (reference-safe: тело→`{}`).
- **Прочее:** EXT-1 (`_external/` через allowlist), PIPE-2/PIPE-4 (удаление ссылок через DOM),
  WALK-1 (обход не падает), C8/VR-1 (verify прокликивает), CST-1 (reportPath).

Ключевые новые модули: `passes/js-advanced/neutralize-detections.ts`,
`passes/js-advanced/detectors/helpers.ts`, `utils/html-dom.ts::stripServerTags`,
`verify/verify-runtime.ts::autoInteract`.

## Что осталось — приоритетный порядок для новой сессии

**Высокий приоритет (🟧) — делать первыми:**
- **2D-6 ✅ ЗАКРЫТА** — новый проход `passes/html/strip-dangerous-hrefs.ts` зовёт
  `classifyResource(href,'anchor')` для `a[href]`/`area[href]` и нейтрализует опасную схему
  (снимает только href, текст кнопки сохраняется, оригинал → карантин). Гейт — `dangerousSchemeOf()` в
  `allowlist.ts` (трогаем ТОЛЬКО схемы, не внешние хосты). Подключён перед `replaceOfferLinks`.
- **DET-1 ✅ ЗАКРЫТА** — `extractStringArg`→`extractStringish` в `detect-exfil-calls` (fetch/WebSocket/Image)
  и `detect-redirect`: склейка схемы (`'htt'+'ps://evil'`) и template-литералы резолвятся и идут через
  `isExternalUrl`. Новый `obfuscatedDecoderIn` (`helpers.ts`): `atob`/`unescape`/`String.fromCharCode` в
  аргументе URL → нейтрализация. `decodeURIComponent`/`btoa` исключены; голая `fetch(var)` не шумит.
- **DET-2 ✅ ЗАКРЫТА** — `collectExfilBindings` (пре-пасс в `detect-exfil-calls`) резолвит алиасы
  (`const f=fetch; f(evil)` через `referencedGlobalName`) и переменные-стоки (`var img=new Image()`,
  `document.createElement('script'|'img')`); `srcAssignmentKind` ловит `<sink>.src=` в 2-строчной и инлайн
  форме. Новый threatType `exfil-script-src`. FP-гейт — внешний/обфусцированный URL (DET-1).
- **AL-3 + CDN-1 + POL-2 ✅ ЗАКРЫТЫ** — `MULTITENANT_CDNS`+`TRUSTED_CDN_PACKAGES` в `policy.ts`;
  `classifyResource` сверяет путь jsdelivr/unpkg (`/gh/`→quarantine, npm-пакет по whitelist);
  `cdn-detector` убрал структуру `jsdelivr-gh` и гейтит `jsdelivr-npm` по whitelist; CSP остаётся
  defense-in-depth (POL-2 митигирован на уровне очистки). cdnjs оставлен по-хостовым (курируем).
- **NORM-3 ✅ ЗАКРЫТА** — в `collectResources` добавлены `data-src`/`data-srcset`/`data-bg`/`poster`/
  `<use href>`/bare `@import`; для @import — своё правило переписывания; `#`-фрагмент `<use>` сохраняется.
  Остаток: некавыченные атрибуты (`src=logo.png`) — не покрыто (реже встречается); bare `@import` в самих
  CSS-файлах — это NORM-7.
- **URL-1 ✅ ЗАКРЫТА** — `extractHostname` теперь возвращает `null` для относительных/без-authority
  URL (был footgun: `example.com`). Все вызыватели гардированы (аудит T-2). Новый `url.test.ts`.
- **UCDN-1 ✅ ЗАКРЫТА (+ UCDN-2)** — `buildUnversionedCdnReplacements` зовёт `fetchOfficial(cdnUrl)`
  (экспортирован из `cdn-detector`): SRI от ОФИЦИАЛЬНОГО CDN-файла; если CDN 404/недоступен — замена не
  добавляется (локальный файл остаётся фолбэком). Тесты: `unversioned-cdn-detector.test.ts` (мок fetch).
- **COV-1 ✅ ЗАКРЫТА (+ ANA-1)** — мёртвый по coverage JS теперь идёт в карантин (`quarantineFile`)
  перед `rm` (C5, восстановимо); непарсимый файл (`!ast`) больше не считается мёртвым (ANA-1).
  ⇒ **Весь 🟧 (High) тир закрыт.** Дальше — 🟨 (C6 и средний приоритет).

**C6 — «блок-лист → белый список» (FN-карманы, средний приоритет):**
- **2A-3 ✅ ЗАКРЫТА** — `remove-tracker-links` через `classifyResource` (kind по `as`/rel; modulepreload+мульти-rel покрыты; preload/preconnect на неизвестный хост → карантин).
- **2A-4 ✅ ЗАКРЫТА** — `<noscript>` разбирается `parseFragment` + allowlist (хирургично, fallback цел); практически закрывает DOM-3.
- **CSS-1/CSS-2 ✅ ЗАКРЫТЫ** — `removeTrackerUrls` через `classifyResource`; новый проход `clean-inline-css` для `<style>`/`style=`.
- **MAC-1/CSS-3/CJS-5 ✅ ЗАКРЫТЫ** — `utils/macro-scan.ts` (`scanJsFileMacros`/`scanCssFileMacros`);
  `cleanJsFile`/`cleanCssFile` сканируют внешние файлы и кладут макросы в общую карту. ⇒ **кластер C6 полностью закрыт.**

**Средний/низкий (🟨/🟩) — по желанию:**
- **OBF-1/MET-1 soundness** — точнее детект (идентификаторы/«полезность» по AST). Срочность СНИЖЕНА:
  удаления теперь обратимы (карантин), FP не фатален.
- **PIPE-3** — per-file try/catch в главном цикле `cleanSite` (один кривой файл не валит прогон). Нужен
  аккуратный wrap тела цикла или extract в `processFile()`.
- **CJS-3/CJS-4** (не глушить AST-анализ молча; regex SW/eval не должен ломать парс — перевести SW/eval
  на AST: SW-1/EVAL-2/EVAL-1/SW-2), **PARSE-1/PARSE-2** (Annex B `<!--`; непарсимое → флаг, не тихий null).
- **2D-2/2D-3** (`on*`-обработчики: обфускация + реестр touch/pointer/wheel для мобайла),
  **2D-5** (непарсимый inline-script — флагать), **DOM-3/DOM-4** (noscript-текст, `</script>` в строке).
- **OFFER-1/2/3** (оффер-детектор: соцсети/правовые ломаются в `{offer}`; same-host оффер сохраняет чужой URL),
  **2B-1/2B-2** (base/meta-refresh), **NORM-4/5/6** (контекстно-слепая замена, `stripPhpCode` рвёт разметку,
  выбор главного файла), **POL-1** (CSP `unsafe-inline` слаба).
- Мелочи: SM-1, REP-2/REP-4, QUAR-2, CHG-1, WARN-1, IDX-1, COV-2/3/4, VIS-2/3, URL-2/3/4, POL-3/4, RLL-1/2/3,
  CDN-2/3/4/5, UCDN-2/3/4, 2B-3/4/5/6, MAC-2/3/4/5, EUF-3, PARSE-3, PIPE-5/6, CJS-6, DEC-… (см. `_index.md`).

## Как начать новую сессию

1. Прочитай `docs/red-team/_index.md` (статусы) и `00-summary.md` (кластеры).
2. **Весь 🟧 (High) тир + кластер C6 закрыты** (2A-3, 2A-4, CSS-1, CSS-2, MAC-1/CSS-3/CJS-5).
   **SVG-1/2 ✅ закрыты** (clean-svg: self-closing `<script>`, неквотированные `on*`, plain href/SVG2,
   `javascript:`-схема, `<style>` url() в SVG). Дальше — средний 🟨: **C7** (regex-в-JS: SW-1/EVAL-1/2,
   PARSE-1/2, CJS-3/4), **OFFER-1/2/3** (соцсети/правовые ломаются в `{offer}`), **2D-2/2D-3**
   (обфускация в `on*`, мобильные события), PIPE-3, AL-4, и формально-🟧 **POL-1** (CSP — гигиена).
   Полный список — в реестре `_index.md`.
3. TDD → фикс → зелёные тесты + чистый tsc → обнови `_index.md` + per-file док → коммит на `redteam-fixes`.
4. После пачки фиксов — прогон `npm run clean -- <copy> -- --advanced` и `npm run verify -- <copy>` на
   копии реального лендинга (без регресса).
