# Red Team: `utils/url.ts`

**Роль.** Низкоуровневые URL-утилиты под `classifyResource` и regex-проходы:
`extractHostname`, `hostMatches`, `urlMatchesTracker`, `isExternalUrl`, `inlineLooksLikeTracker`.

---

## Находки

### [URL-1] 🔴 Bypass · 🟧 High · `extractHostname` врёт на относительных URL

- **Сценарий:** любой относительный путь, напр. `extractHostname('js/app.js')` или `'../a/b.js'`.
- **Сейчас:** `new URL(raw, 'https://example.com')` ([:9](src/mastra/cleaners/utils/url.ts:9))
  резолвит относительный путь против базы → возвращает `example.com` **для любого относительного
  URL**, а не `null`.
- **Последствие:** любой прямой вызыватель `extractHostname` (в обход `isAbsoluteUrl`-гварда из
  `classifyResource`), который сравнивает результат с trusted/tracker-списками, обманывается:
  относительный путь выглядит как «хост example.com». Сам `classifyResource` защищён гвардом, но
  функция экспортируется и зовётся напрямую.
- **Рекомендация:** возвращать `null`, если `raw` не абсолютный (без `//` и без `scheme:`), либо
  принимать флаг `requireAbsolute`. Заодно убрать footgun на будущее.
- **Уверенность:** подтверждено чтением кода; масштаб — по числу прямых вызывателей → нить **T-2**.

### [URL-2] 🟢 Soundness · 🟨 Medium · два расходящихся оракула доверия

- **Сценарий:** `<script src="https://d4tncaiqdi48w.cloudfront.net/app.js">` (own-asset хост).
- **Сейчас:** `isExternalUrl` ([:56](src/mastra/cleaners/utils/url.ts:56)) и `isTrustedHost`
  используют `TRUSTED_HOSTS` = `ALL_TRUSTED_HOSTS` = `TRUSTED_LIB_CDNS ∪ OWN_ASSET_HOSTS`
  ([trusted-hosts.ts:9](src/mastra/cleaners/registry/trusted-hosts.ts:9)) — **для всех типов**.
  А `classifyResource` доверяет `OWN_ASSET_HOSTS` **только для img/media**
  ([allowlist.ts:42](src/mastra/cleaners/utils/allowlist.ts:42)).
- **Последствие:** для скрипта с CloudFront `isExternalUrl` → `false` (не внешний, «свой»), а
  `classifyResource(...,'script')` → `quarantine`. Если какой-то проход решает судьбу `<script>`
  через `isExternalUrl`, он **оставит** то, что белый список отправил бы в карантин. Рассинхрон
  двух источников правды — будущий источник тихих дыр.
- **Рекомендация:** один kind-aware оракул. `isExternalUrl` либо переписать поверх
  `classifyResource`, либо явно задокументировать, что он намеренно «свой = вся инфраструктура» и
  не годится для gate скриптов.
- **Уверенность:** расхождение в коде подтверждено; эксплуатируемость — где `isExternalUrl` гейтит
  скрипт → нить **T-2**.

### [URL-3] 🟢 Soundness · 🟩 Low · подстрочный матч трекера даёт FP

- **Сценарий:** `https://shop.example/page?ref=facebook.com/tr`.
- **Сейчас:** шаг 1 `urlMatchesTracker` ([:25](src/mastra/cleaners/utils/url.ts:25)) для записей
  с `/` делает `lowerUrl.includes(t)` — подстрочно, без границ.
- **Последствие:** ложное срабатывание. Но в `classifyResource` трекер-матч лишь переключает
  `remove` ↔ `quarantine` (не влияет на `keep`), так что вред ограничен: легитимный внешний ресурс
  уедет в `remove` вместо `quarantine`. Урон низкий.
- **Рекомендация:** для path-записей матчить по `host+path` распарсенного URL, а не по всей строке.
- **Уверенность:** подтверждено чтением кода.

### [URL-4] 🔴 Bypass · 🟩 Low · нет нормализации IDN/punycode

- **Сценарий:** трекер на хосте-омоглифе (`gоogle-analytics.com` с кириллической `о`) или punycode.
- **Сейчас:** `extractHostname` лишь `toLowerCase`, без `toASCII`/нормализации Unicode.
- **Последствие:** для **keep**-решений это **безопасно** (омоглиф доверенного хоста не совпадёт с
  trusted по точному/суффиксному матчу → уедет в quarantine — правильный исход). Для **remove**:
  омоглиф известного трекера не распознается → попадёт в quarantine вместо remove (приемлемо при
  default-deny). Поэтому Low.
- **Рекомендация:** прогонять хост через `URL`-нормализацию (она и так даёт punycode) и при желании
  детектить mixed-script хосты как сигнал.
- **Уверенность:** подтверждено; влияние ограничено архитектурой default-deny.

---

## Заметки по `inlineLooksLikeTracker` и реестрам

- `inlineLooksLikeTracker` ([:64](src/mastra/cleaners/utils/url.ts:64)) — чистый
  `body.includes(kw)` по `TRACKER_INLINE_KEYWORDS`. Это **блок-лист**: ловит только знакомые
  сигнатуры; новый/переименованный inline-трекер пройдёт. Это осознанный trade-off (детальный
  разбor — в анализе `remove-inline-trackers`), здесь лишь фиксируем границу.
- `TRACKER_*` реестры — удобство, не граница безопасности (как и `cdn-libraries`). Главная защита —
  default-deny белого списка. Разбор полноты реестров отложен в Тир 5.

## Пробелы в тестах

Прямых юнит-тестов на `url.ts` не нашёл (тестируется опосредованно через `allowlist.test.ts`).
Нет тестов на: `extractHostname` относительного пути (URL-1), расхождение `isExternalUrl` vs
`classifyResource` (URL-2), FP подстрочного матча (URL-3).

## Итог

1. **URL-1** — вернуть `null` на относительных, убрать footgun (дёшево).
2. **URL-2** — свести к одному kind-aware оракулу (после аудита вызывателей, T-2).
