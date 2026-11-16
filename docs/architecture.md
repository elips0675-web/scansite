# Архитектура конвейера

Четыре стадии, каждая — отдельный файл и отдельный пункт бэклога. Между
стадиями только файлы: JSON и HTML. Скрытого состояния нет.

## 1. Стадии

| № | Вход | Кто делает | Выход | Пункт |
|---|---|---|---|---|
| 1 | `sites.json` | `scripts/audit-collect.mjs` | `audit_data.json` | AUD-01, AUD-02 |
| 1б | `sites.json` | браузер сессии (`browser.*`), вручную | тот же JSON, блок `external.browser` | AUD-14 |
| 2 | `audit_data.json` | `scripts/audit-external.mjs` (если есть ключи) | тот же JSON, блок `external` | AUD-06 |
| 3 | `audit_data.json` + `templates/audit-report.html` | `scripts/audit-render.mjs` | `audit-report.html` | AUD-03 |
| 4 | `audit_data.json` | `scripts/audit-summary.mjs` (модель) | раздел «Выводы» внутри отчёта | AUD-04 |

Стадии 1–3 работают без интернета модели и без Ollama. Стадия 4 — опциональная:
без неё отчёт валиден, в разделе «Выводы» стоит строка «модель не запускалась».

## 1б. Браузерный прогон (опционально, вне CI)

Стадия 1б не запускается скриптом: браузер принадлежит desktop-приложению
OpenCode, поэтому прогон идёт в живой сессии агента и в CI не заходит. Нужна
там, где `fetch` бессилен: сайт отдаёт контент только после JS.

| Что делает | Инструмент |
|---|---|
| открыть адрес и дождаться загрузки | `browser.tabs.open`, `browser.navigate` |
| Lighthouse: accessibility, SEO, best practices | `browser.lighthouse` |
| трейс: long tasks, scripting/rendering/painting | `browser.trace.start/stop/analyze` |
| сеть: запросы, хосты, коды, размеры | `browser.network.list`, `browser.network.get` |
| ошибки JS | `browser.console` |
| DOM после гидратации, JSON-LD | `browser.snapshot`, `browser.evaluate` |
| скриншот в отчёт | `browser.screenshot` |

Результат складывается в `sites[].external.browser`, а отчёт помечает такие
данные строкой «браузерный прогон, вне CI»: читатель должен видеть, что число
получено не тем же путём, что остальные. Эмуляции устройства нет, поэтому
сравнивать с PageSpeed Insights нельзя — только прогон с прогоном.

## 2. Почему именно так

- **Детерминированность.** Один и тот же сайт в одну и ту же минуту даёт
  одинаковый HTML. Значит регресс отчёта виден диффом, а не «модель сегодня
  другая».
- **Контекст модели.** В промпт стадии 4 едет `audit_data.json` (2–5 КБ), а не
  HTML сайта и не 14 453 байта шаблона отчёта (`Аудит сайтов через OpenCode
  Генерация HTML-отчётов Qwen.html:258`).
- **Цена.** Прогон 20 сайтов не тратит токены вообще, пока включена только
  стадия 1.
- **Проверяемость.** Каждое число в отчёте прослеживается до поля JSON.

## 3. Контракт `audit_data.json`

Верхний уровень:

| Поле | Тип | Смысл |
|---|---|---|
| `meta.generated_at` | ISO-строка | время прогона |
| `meta.tool_version` | строка | версия из `package.json` |
| `meta.node` | строка | `process.version`, для воспроизводимости |
| `meta.sites_count` | число | сколько адресов на входе |
| `sites` | массив | по элементу на адрес, порядок как в `sites.json` |

Элемент `sites[]`:

| Поле | Тип | Смысл |
|---|---|---|
| `url` | строка | адрес как во входе |
| `final_url` | строка или `null` | после редиректов |
| `status` | число или `null` | HTTP-код последнего ответа |
| `error` | строка или `null` | причина, если прогон не удался |
| `redirects` | массив | цепочка `{from, to, status}` |
| `headers` | объект | только нужные заголовки, в нижнем регистре |
| `tls` | объект или `null` | `protocol`, `issuer`, `not_before`, `not_after`, `days_left`, `san[]` |
| `timing` | объект | `ttfb_ms`, `total_ms` |
| `content` | объект | `bytes`, `title`, `meta_description`, `canonical`, `h1_count`, `generator` |
| `assets` | объект | `scripts`, `styles`, `images`, `external_hosts[]`, `third_party[]` |
| `seo` | объект | `robots_status`, `sitemap_status`, `sitemap_lastmod`, `has_robots_txt` |
| `tech` | массив | сигнатуры: `wordpress`, `bitrix`, `nextjs`, `laravel`, `drupal` |
| `external` | объект | `pagespeed`, `observatory`, `ssllabs`, `browser` — по наличию ключа или прогона |
| `findings` | массив | `{id, level, check, message, evidence}` |

Правила контракта:

1. Поле существует всегда. Не смогли измерить — `null`, а не отсутствие ключа:
   иначе рендер падает на разных сайтах по-разному.
2. `findings[].evidence` — конкретика: имя заголовка, значение, миллисекунды.
   «Плохие заголовки» без значения — не находка.
3. `level` — только `ok`, `warn`, `fail`, `unknown` (`docs/report-format.md`).

## 4. Отказы

| Ситуация | Что пишем | Что не делаем |
|---|---|---|
| DNS не разрешается | `status: null`, `error: "dns"`, находка `fail` | не роняем прогон |
| TLS-рукопожатие падает | `tls: null`, `error: "tls"` | не подменяем на `ok` |
| Таймаут 10 с | `error: "timeout"`, `findings` пуст, `level: unknown` | не повторяем бесконечно |
| Редирект длиннее 5 шагов | `error: "redirect_loop"` | не идём дальше |
| Ответ 403/429 | `status`, `level: unknown` | не обходим защиту |
| Нет ключа API | `external.*: null`, находка `unknown` | не падаем с ошибкой |

Итоговый код выхода: `0` — собрано всё, `1` — не собрано ничего (нет
`sites.json`, все адреса упали), `2` — ошибка аргументов.

## 5. Идемпотентность и сравнение

- `audit_data.json` перезаписывается целиком; суточная копия складывается в
  `reports/<дата>/audit_data.json` (каталог в `.gitignore`).
- Сравнение двух прогонов — `scripts/audit-render.mjs --compare <старый>`:
  дельта `ttfb_ms`, пропавшие и появившиеся заголовки, изменения сертификата.
- Время прогона не влияет на порядок элементов: сортировка по `sites.json`.
