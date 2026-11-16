# Changelog

Версии **инструмента**, не сайтов, которые он проверяет. Формат — Keep a
Changelog, версии — SemVer.

## [0.1.0] — 16.11.2026

### Added

- Канонический набор документации по схеме `D:\October CMS`: `AGENTS.md`,
  `README.md`, `project-context.md`, `docs/README.md` как карта,
  `docs/architecture.md`, `docs/checks.md`, `docs/report-format.md`,
  `docs/scope.md`, `docs/local-model.md`, `docs/installation.md`,
  `docs/qa-checklist.md`, `docs/roadmap.md`, `docs/archive/README.md`.
- Журнал `Что сделано.txt` и бэклог `Что доделать.txt` с ID `AUD-NN`.
- Срез для внешнего аудита: `test/Для анализа.txt` и `test/README.md`.
- Гейт документации `npm.cmd run check:docs` (`tools/check-docs.mjs`).
- Публикация репозитория: https://github.com/elips0675-web/scansite
  (коммит `c92795a`, ветка `main`).

### Not done

- Кода нет: каталога `scripts/` не существует (AUD-01).
- Сбор данных, шаблон отчёта, вызовы внешних API — в бэклоге, не в коде.
