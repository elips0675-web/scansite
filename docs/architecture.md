# Архитектура конвейера

Четыре стадии, каждая — отдельный файл и отдельный пункт бэклога. Между
стадиями только файлы: JSON и HTML. Скрытого состояния нет.

## 1. Стадии

| № | Вход | Кто делает | Выход | Пункт |
|---|---|---|---|---|
| 1 | `sites.json` | `scripts/audit-collect.mjs` | `audit-report/audit_data.json` | AUD-01, AUD-02 |
| 1б | тот же адрес | браузер сессии (`browser.*`), вручную | `audit-report/browser_data.json` | AUD-14 |
| 1в | отчёт PageSpeed Insights в браузере | человек переносит цифры в файл | `audit-report/pagespeed.json` → подраздел 4.1 | AUD-06 (вручную) |
| 2 | `audit_data.json` | `scripts/audit-external.mjs` (если есть ключи) | тот же JSON, блок `external` | AUD-06 |
| 3 | `audit_data.json` + `templates/audit-report.html` | `scripts/audit-render.mjs` | `audit-report/audit-report.html` | AUD-03 |
| 4 | `audit_data.json` | `scripts/audit-summary.mjs` (Ollama) | `audit-report/conclusions.json` → раздел «Выводы» | AUD-04 |

Стадии 1–3 работают без интернета модели и без Ollama. Стадия 4 — опциональная:
`node scripts/audit-summary.mjs` пишет `audit-report/conclusions.json`, рендер
подставляет его в раздел «Выводы» и указывает модель, число слов и число ссылок
на `id`; без файла в разделе стоит строка «модель не запускалась».
Скрипт отказывается писать файл, если модель не сослалась ни на один `id`
находки, и обрезает текст по 300 словам, помечая `truncated`.

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

## 1в. PageSpeed Insights вручную (опционально, вне CI)

API PageSpeed требует ключа и без него отвечает `429` (AUD-06), но сам отчёт
Google виден в браузере. Поэтому цифры переносятся человеком в
`audit-report/pagespeed.json`: `meta` (ссылка, дата, устройство, версия
Lighthouse), `scores` (четыре оценки), `metrics` (FCP, LCP, TBT, CLS, Speed
Index), `opportunities`, `diagnostics`, `accessibility`, `best_practices`,
`seo`. Файл опционален: нет его — подраздела нет, рендер не падает. Битый JSON
даёт предупреждение в stderr и пропуск блока, а не отказ сборки.

Правило разделения: в разделах 1–6 только наши измерения, в подразделе 4.1 —
только **цитата** Google с датой, устройством и ссылкой. Числа не смешиваются,
потому что PSI эмулирует Moto G Power и медленную 4G, а наш сбор ходит как
есть. Балл 100 не обещается: часть аудитов Lighthouse проходится вручную, а
оценка зависит от эмуляции.

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
| `requests` | число | сколько HTTP-запросов сделал сбор по этому адресу |
| `headers` | объект | только нужные заголовки, в нижнем регистре |
| `tls` | объект или `null` | `protocol`, `alpn`, `issuer`, `not_before`, `not_after`, `days_left`, `san[]` |
| `dns` | объект | `a[]`, `aaaa[]`, `mx[]`, `ns[]`, `txt[]`, `spf`, `spf_count`, `dmarc`, `caa[]`, `mta_sts`, `codes{}`, `error` |
| `timing` | объект | `ttfb_ms`, `total_ms` |
| `content` | объект | `bytes`, `title`, `meta_description`, `canonical`, `lang`, `h1_count`, `h1[]`, `generator`, `viewport`, `robots_meta`, `og_title`, `og_image`, `twitter_card`, `favicon`, `images_no_alt`, `images_no_dim`, `images_lazy`, `controls_no_label`, `controls_total`, `mixed_content[]`, `inline_style_bytes` |
| `assets` | объект | `scripts`, `styles`, `images`, `inline_scripts`, `svg`, `external_hosts[]`, `third_party[]` |
| `seo` | объект | `robots_status`, `robots_sitemap`, `sitemap_status`, `sitemap_type`, `sitemap_prolog`, `sitemap_urls`, `sitemap_lastmod`, `soft_404_status`, `soft_404_title`, `https_redirect`, `https_redirect_status`, `https_redirect_to`, `has_jsonld`, `jsonld_types[]` |
| `tech` | массив | сигнатуры: `wordpress`, `bitrix`, `nextjs`, `laravel`, `drupal`, `vercel`, `x-powered-by` |
| `external` | объект | `pagespeed`, `observatory`, `ssllabs` — по наличию ключей (AUD-06). Браузерные данные сюда не пишутся: рендер принимает их отдельным `browser_data.json` (AUD-14) |
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
| Порт 80 закрыт | `seo.https_redirect: null`, находка `unknown` | не считаем редирект настроенным |
| Проба 404 получила 200 | находка `soft_404` уровня `warn`/`fail` | не путаем с недоступностью сайта |
| Резолвер DNS не отвечает | `dns.error`, находка `unknown`; CAA и MTA-STS не проверяются | не пишем `ok` |

Итоговый код выхода: `0` — собрано всё, `1` — не собрано ничего (нет
`sites.json`, все адреса упали), `2` — ошибка аргументов.

## 5. Идемпотентность и сравнение

- `audit-report/audit_data.json` перезаписывается целиком; суточная копия
  складывается в `audit-report/<дата>/audit_data.json` (папка в `.gitignore`).
- Сравнение двух прогонов — `scripts/audit-render.mjs --compare <старый>`:
  дельта `ttfb_ms`, пропавшие и появившиеся заголовки, изменения сертификата.
- Время прогона не влияет на порядок элементов: сортировка по `sites.json`.
