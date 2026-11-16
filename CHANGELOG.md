# Changelog

Версии **инструмента**, не сайтов, которые он проверяет. Формат — Keep a
Changelog, версии — SemVer.

## [0.6.0] — 16.11.2026

### Added

- Подраздел 4.1 «PageSpeed Insights — внешний отчёт, снят вручную»:
  `scripts/audit-render.mjs:27` читает `audit-report/pagespeed.json` (если файл
  лежит рядом), а `:180` рисует четыре оценки, метрики FCP/LCP/TBT/CLS/Speed
  Index и списки «что делать»; каждое число подписано ссылкой, датой,
  устройством и версией Lighthouse.
- `pagespeed.json` — необязательный артефакт: нет файла — нет подраздела,
  битый JSON — предупреждение в stderr и пропуск блока. Пороги Google
  (90/50) превращаются в `ok`/`warn`/`fail` только для цвета бейджа, в общие
  счётчики `ok/warn/fail/unknown` эти числа не попадают.

### Changed

- Документация: `docs/architecture.md` §1в (стадия 1в), `docs/report-format.md`
  §1 (раздел 4), `docs/checks.md` §2 (строка «внешний отчёт»), `README.md`,
  `AGENTS.md` §5 и §9, `Что доделать.txt` (AUD-06 — частично закрыт вручную).

## [0.5.0] — 16.11.2026

### Added

- Перенос проверок из `D:\nlbopt-main` и `D:\October CMS`: идеи и пороги взяты
  оттуда, код переписан на встроенные модули Node.
- `scripts/mail-policy.mjs` — чистые функции разбора SPF (`-all` → `ok`,
  `~all` → `warn`, `+all`/`?all` → `fail`, нет `all` → `warn`) и DMARC
  (`p=reject` → `ok`, `p=quarantine` → `warn`, `p=none` → `fail`).
- `readDns` читает CAA (`resolveCaa`) и TXT `_mta-sts.<host>`, считает число
  SPF-записей; находки `caa`, `mta_sts`, `spf_multiple`.
- Статические находки по уже скачанному HTML: `lang`, `viewport` (нет →
  `fail`), OG и `twitter:card`, favicon, `meta robots`, длина `title` и
  `description`, `alt`, `width/height`, `loading="lazy"`, подписи полей формы,
  mixed content, версия в `server`/`x-powered-by`, `Cache-Control` и сжатие
  с `Vary: Accept-Encoding`.
- SEO-периметр: директива `Sitemap:` в `robots.txt`, тип и XML-пролог
  `sitemap.xml`, проба несуществующего пути (мягкая 404), редирект
  `http://` → `https://`.
- Поле `requests` — сколько HTTP-запросов сделал сбор по адресу (5 на живой
  прогон, потолок `docs/scope.md` §3).
- `docs/checks.md` §1 — 15 новых строк с основанием (RFC 7208, RFC 7489,
  RFC 8659, RFC 8461, WCAG) и ссылками на источники идей.
- `docs/qa-checklist.md` — этап 6: 18 ожидаемых уровней на локальной фикстуре.

### Changed

- `docs/architecture.md` §3 — новые поля `requests`, `dns.caa`, `dns.mta_sts`,
  `dns.spf_count`, `content.*`, `seo.*`; §4 — ветки «порт 80 закрыт» и «проба
  404 вернула 200».
- `docs/report-format.md` §1 — разделы 3.1, 4, 5 и 6 описывают новые строки.
- `templates/audit-report.html` не менялся: находки живут в существующих
  разделах, отчёт остаётся восьмираздельным.
- Версия инструмента 0.4.0 → 0.5.0.

## [0.4.0] — 16.11.2026

### Added

- `scripts/audit-summary.mjs` — раздел «Выводы» локальной моделью (Ollama):
  `audit_data.json` → компактный промт (только не-`ok` находки с `id`) →
  `audit-report/conclusions.json` с метаданными `model, words, truncated,
  ids_cited, ids[], prompt_chars`. Обрезка по 300 словам, отказ записывать
  файл без ссылок на `id`; `--model`, `--host`, `--data`, `--out`, `--dry-run`
  (AUD-04).
- Подстановка выводов в раздел 7: абзацы через `esc()`, подпись «модель,
  N слов, M ссылок»; битый `conclusions.json` не роняет рендер.
- `npm run summary` и версия инструмента 0.3.0 → 0.4.0.

### Changed

- `docs/architecture.md` §1 — стадия 4 описана как реализованная;
  `docs/report-format.md` §1 — раздел 3 дополнен ALPN и подразделом DNS;
  `docs/local-model.md` §7 — эта машина без карты, CPU-модель;
  `docs/qa-checklist.md` — этап 3 сверяется по `conclusions.json`.

## [0.3.0] — 16.11.2026

### Added

- DNS и почта в сборе (`node:dns/promises`): A, AAAA, MX, NS, TXT, SPF, DMARC,
  коды ошибок по каждой ветке; при отказе резолвера — `unknown`, а не сбой
  (AUD-16, код готов, ветви `ok`/`fail` ждут машины с открытым UDP 53).
- ALPN в TLS-объекте (`tls.alpn`) и находка `alpn`: `h2` → `ok`,
  `http/1.1` → `warn`.
- Подраздел отчёта «3.1 DNS и почта» и строка «HTTP/2 (ALPN)».
- `.opencode/commands/audit.md` — команда `/audit <url>`: сбор, рендер, запрет
  активного сканирования и внешних API (AUD-09).

### Changed

- `docs/checks.md` §1 — три новых строки (DNS, SPF/DMARC, ALPN) с основанием
  «нет в источнике (расширение)».
- `docs/architecture.md` §3 — поле `dns` и `tls.alpn` в контракте.
- README и `test/Для анализа.txt` — команда `/audit` и фактические числа
  прогона (17 находок: 15 `ok`, 1 `fail`, 1 `unknown`).

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
