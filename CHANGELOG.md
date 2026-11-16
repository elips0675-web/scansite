# Changelog

Версии **инструмента**, не сайтов, которые он проверяет. Формат — Keep a
Changelog, версии — SemVer.

## [0.2.0] — 16.11.2026

### Added

- `scripts/audit-collect.mjs` — пассивный сбор фактов (`fetch` + `node:tls`):
  заголовки, TLS, TTFB, вес HTML, ресурсы, `robots.txt`, `sitemap.xml`,
  JSON-LD, сигнатуры технологий. Зависимостей ноль, `--url` и `--sites`.
- `templates/audit-report.html` + `scripts/audit-render.mjs` — отчёт из JSON:
  восемь разделов, четыре статуса, проверки на `{{...}}`, внешние ресурсы и
  бюджет 150 КБ.
- Папка артефактов `audit-report/`: `audit_data.json`, `browser_data.json`,
  `audit-report.html` — в git не идёт.
- `.gitattributes` (`* text=auto eol=lf`) — конец предупреждений о CRLF.

### Changed

- README: реальные команды вместо «появится позже» (AUD-12).
- `test/Для анализа.txt`: фактические поля контракта, карта скриптов, пример
  находки, новые гейты (AUD-11).
- `.gitignore`: артефакты привязаны к корню — иначе шаблон
  `templates/audit-report.html` считался артефактом.

### Fixed

- Определение стека больше не дублирует CMS (`wordpress` + версия → одна
  запись), а ошибка DNS отличается от сетевой (`error: "dns"`).

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
- Браузерный прогон описан в документации: `docs/checks.md` §1.1,
  `docs/architecture.md` §1б, AUD-14 в бэклоге.

### Not done

- Раздел «Выводы» моделью (`scripts/audit-summary.mjs`) — AUD-04.
- `sites.json` и сравнение прогонов — AUD-05.
- Внешние API (PageSpeed, Observatory, SSL Labs) — AUD-06.
- Фикстуры и `--self-test` — AUD-10.
