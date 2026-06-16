# Чистильщик лендингов

AI-агент-«верстальщик» для арбитража трафика: **скачивает** чужой лендинг, **очищает**
его от трекеров и кражи трафика, **проверяет**, что очищенная копия не звонит на чужие
домены — и отдаёт готовый к заливу шаблон.

Построен на [Mastra](https://mastra.ai/) (TypeScript). Очистка работает по принципу
**белого списка + карантина** (всё неизвестное не удаляется молча, а изолируется для ревью).

---

## Как это работает

Конвейер из 3 шагов:

```
скачать (download) → почистить (clean) → проверить (verify)
```

Запустить можно двумя путями — оба зовут одни и те же функции-ядро:

- **CLI** — команды `npm run download/clean/verify` (папка `scripts/`)
- **Агент** — `landing-agent` вызывает 3 инструмента (для Mastra Studio / чата)

Подробная карта проекта (что где лежит, за что отвечает каждый файл) — в
**[ARCHITECTURE.md](ARCHITECTURE.md)**.

---

## Быстрый старт

**Требования:** WSL (Ubuntu-24.04), Node `>=22.13.0` через nvm.

```bash
npm install                       # зависимости (+ playwright chromium)
cp .env.example .env              # вписать ключ модели

npm run download -- <url>         # скачать лендинг в downloads/<host>/
npm run clean    -- downloads/<host>   # очистить
npm run verify   -- downloads/<host>   # проверить, что не звонит наружу

npm run dev                       # Mastra Studio (UI агента) на localhost:4111
```

Флаги очистки: `--no-backup`, `--no-advanced`, `--coverage`, `--coverage-threshold=<n>`.

После очистки в папке появляются: `clean-report.md` (что сделано), `clean-site-changes.log`
(детальный лог) и `_quarantine/` (изолированное подозрительное — на ручное ревью).

<details>
<summary>Запуск из Windows-терминала (PowerShell)</summary>

```powershell
Set-Location C:\; wsl.exe -d Ubuntu-24.04 -e bash -lc 'export NVM_DIR=$HOME/.nvm; . "$NVM_DIR/nvm.sh"; cd /home/asus/projects/me-projects/mastra/learn-mastra-2 && <команда>'
```
</details>

---

## Структура проекта

| Папка | За что отвечает |
| --- | --- |
| `scripts/` | CLI: запуск конвейера руками |
| `src/mastra/` | весь код: агент, инструменты, ядро очистки |
| `src/mastra/cleaners/` | ❤️ ядро очистки (проходы, правила, утилиты, verify) |
| `docs/` | спеки очистки + аудит безопасности (red-team) |
| `downloads/` | рабочие данные: сюда качаются и тут чистятся лендинги |

Полная карта с разбором каждого файла — в [ARCHITECTURE.md](ARCHITECTURE.md).

---

## Документация

- **[ARCHITECTURE.md](ARCHITECTURE.md)** — карта проекта: что где и за что отвечает
- [docs/cleaning-logic.md](docs/cleaning-logic.md) — логика очистки
- [docs/js-cleaning-spec.md](docs/js-cleaning-spec.md) — спека очистки JS
- [docs/red-team/](docs/red-team/) — аудит безопасности (источник правды: `_index.md`)

---

## Статус

- ✅ **Готово:** скачивание, нормализация структуры, очистка, базовая верификация. Тесты зелёные, типы чистые.
- 🟠 **Частично:** verify без мобайла; visual-diff не подключён; нет сквозного запуска одной командой.
- 🔴 **Не начато:** Этап 2 «адаптация» (подстановка картинки/названия оффера по вертикали) и «локализация».

---

## Разработка

```bash
npx vitest run        # тесты
npx tsc --noEmit      # проверка типов
```

При добавлении нового агента/инструмента/воркфлоу — регистрируй его в `src/mastra/index.ts`.
Новые правила очистки добавляются **только** через новые проходы в `src/mastra/cleaners/passes/`.
