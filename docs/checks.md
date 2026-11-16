# Инвентарь проверок

Одна таблица на вопрос «чем мерим и почему именно так». Колонка «Основание» —
строка из входного материала, а не пересказ.

Обозначения: **код** — Node без зависимостей; **API** — внешний сервис;
**вручную** — не автоматизируется.

## 1. Что делаем

| Проверка | Чем | Поле в JSON | Порог | Основание |
|---|---|---|---|---|
| Код ответа и цепочка редиректов | **код**: `fetch` с `redirect: 'manual'` | `status`, `redirects[]` | 200 → `ok`; 3xx-цепочка > 3 → `warn` | `Аудит…Qwen.html:148` |
| HSTS | **код**: `strict-transport-security` | `headers`, находка `hsts` | есть `max-age` ≥ 15 552 000 → `ok`; нет → `fail` | `:155`, `:216-219` |
| CSP | **код**: `content-security-policy` | находка `csp` | нет → `fail`; есть `unsafe-inline` → `warn` | `:216` |
| `X-Frame-Options`, `X-Content-Type-Options`, `Referrer-Policy`, `Permissions-Policy` | **код** | `findings` | отсутствие → `warn` (не `fail`) | `:216-219` |
| TLS-протокол | **код**: `node:tls`, `getProtocol()` | `tls.protocol` | TLSv1.2+ → `ok`; TLSv1/1.1 → `fail` | `:151`, `:246` |
| Сертификат: срок и издатель | **код**: `getPeerCertificate()` | `tls.days_left`, `tls.issuer` | > 30 дней `ok`; 7–30 `warn`; < 7 `fail` | `:151` |
| TTFB и полное время | **код**: `performance.now()` до первого байта | `timing.ttfb_ms`, `timing.total_ms` | < 500 мс `ok`; 500–1500 `warn`; > 1500 `fail` | `:153` |
| Вес HTML и число внешних хостов | **код** | `content.bytes`, `assets.external_hosts[]` | > 500 КБ `warn`; > 10 хостов `warn` | `:200-202` |
| Сторонние скрипты | **код**: разбор `<script src>` | `assets.third_party[]` | ≥ 1 → `warn` со списком | `:232-234` |
| Технологии | **код**: сигнатуры `wp-content`, `/bitrix/`, `_next/`, `generator` | `tech[]` | эвристика: максимум `warn`, никогда `ok` | `:149` |
| `robots.txt`, `sitemap.xml` | **код**: `fetch` | `seo.robots_status`, `seo.sitemap_status`, `seo.sitemap_lastmod` | 200 → `ok`; 404 → `warn`; `lastmod` старше 12 мес → `warn` | `:249` |
| `title`, `description`, `canonical`, `h1` | **код**: регэксп по HTML | `content.*`, находки | пусто → `fail`; два `h1` → `warn` | `:227-229` |
| PageSpeed Insights | **API** | `external.pagespeed` | оценка < 50 → `fail`, 50–89 → `warn` | `:155-156`, `:186-187` |
| Mozilla Observatory | **API** | `external.observatory` | < 50 → `fail`, 50–89 → `warn` | `:206-208`, `:155` |
| SSL Labs | **API**, асинхронно | `external.ssllabs` | grade B и ниже → `warn` | `:211-213` |
| DNS: A, AAAA, NS, MX, TXT | **код**: `node:dns/promises` | `dns{}` | нет AAAA → `warn`; резолвер недоступен → `unknown` | нет в источнике (расширение) |
| SPF и DMARC | **код**: TXT и `_dmarc.<host>` | `dns.spf`, `dns.dmarc` | нет на апексе → `fail`; нет на поддомене → `unknown` | нет в источнике (расширение) |
| SPF: квалификатор `all` | **код**: разбор TXT | `dns.spf`, находка `spf` | `-all` → `ok`; `~all` → `warn`; `+all`/`?all` → `fail`; нет `all` → `warn` | нет в источнике (RFC 7208) |
| Несколько SPF-записей | **код** | `dns.spf_count`, находка `spf_multiple` | больше одной → `warn` | нет в источнике (RFC 7208) |
| DMARC: политика `p=` | **код**: разбор TXT | `dns.dmarc`, находка `dmarc` | `reject` → `ok`; `quarantine` → `warn`; `none` → `fail`; нет `p` → `warn` | нет в источнике (RFC 7489) |
| CAA | **код**: `resolveCaa` | `dns.caa[]`, находка `caa` | запись есть → `ok`; нет на апексе → `warn`; на поддомене → `unknown` | нет в источнике (RFC 8659) |
| MTA-STS | **код**: TXT `_mta-sts.<host>` | `dns.mta_sts`, находка `mta_sts` | запись есть → `ok`; нет на апексе → `warn`; на поддомене → `unknown` | нет в источнике (RFC 8461) |
| `lang`, `viewport`, OG, `twitter:card`, favicon, `meta robots` | **код**: разбор HTML | `content.lang`, `viewport`, `og_title`, `og_image`, `twitter_card`, `favicon`, `robots_meta` | нет viewport → `fail`; нет остального → `warn`; `noindex` → `warn` | нет в источнике (HTML spec, WCAG 3.1.1) |
| Длина `title` и `description` | **код** | `content.title`, `meta_description`, находки `title_length`, `description_length` | title 30–60, description 70–160 → `ok`; иначе `warn` | нет в источнике (расширение) |
| `alt`, `width/height`, `loading="lazy"` у картинок | **код**: разбор `<img>` | `content.images_no_alt`, `images_no_dim`, `images_lazy` | пропуск → `warn`; меньше 5 картинок — `lazy` не оценивается (`unknown`) | нет в источнике (WCAG 1.1.1, CLS) |
| Подписи полей формы | **код**: `<label for>`, `aria-label`, `aria-labelledby` | `content.controls_no_label`, `controls_total`, находка `form_label` | поле без подписи → `warn`; полей нет → `unknown` | нет в источнике (WCAG 1.3.1) |
| Mixed content | **код** | `content.mixed_content[]`, находка `mixed_content` | `http://` подресурс на https-странице → `fail` | нет в источнике (W3C mixed content) |
| Раскрытие версии сервера | **код**: `server`, `x-powered-by` | `headers`, находка `version_disclosure` | версия вида `x.y` в заголовке → `warn` | нет в источнике (расширение) |
| `Cache-Control` и сжатие HTML | **код**: `cache-control`, `content-encoding`, `vary` | `headers`, находки `html_cache`, `compression` | нет сжатия или нет `Vary: Accept-Encoding` → `warn` | нет в источнике (расширение) |
| Директива `Sitemap` в robots | **код**: текст `robots.txt` | `seo.robots_sitemap`, находка `robots` | 200 без `Sitemap:` → `warn` | `D:\October CMS\tools\check-seo.mjs:293-294` |
| Тип и пролог `sitemap.xml` | **код** | `seo.sitemap_type`, `sitemap_prolog`, находка `sitemap` | не XML или нет `<?xml` → `warn` | `D:\October CMS\tools\check-seo.mjs:305-309` |
| Мягкая 404 | **код**: GET `/__audit_probe_no_such_page__` | `seo.soft_404_status`, находка `soft_404` | 404/410 → `ok`; 200 → `warn`; 200 с `title` главной → `fail`; 3xx → `warn` | `D:\nlbopt-main\scripts\live-audit.mjs:45,54` |
| Редирект HTTP→HTTPS | **код**: GET по `http://` | `seo.https_redirect`, находка `https_redirect` | 3xx на https → `ok`; 200 → `fail`; ошибка соединения → `unknown` | нет в источнике (расширение) |
| Число запросов на адрес | **код**: счётчик | `requests` | справочное поле: документ, `robots.txt`, `sitemap.xml`, проба 404, `http://`-проба | нет в источнике (расширение) |
| HTTP/2 по ALPN | **код**: `tls.connect` с `ALPNProtocols` | `tls.alpn` | `h2` → `ok`; `http/1.1` → `warn` | нет в источнике (расширение) |

Все проверки этой таблицы реализованы в `scripts/audit-collect.mjs` (16.11.2026):
`node scripts/audit-collect.mjs --url <адрес>` (по умолчанию пишет
`audit-report/audit_data.json`). Чего нет в
коде — того нет и в отчёте: таблица и скрипт обновляются одной правкой.

Строки после SPF/DMARC добавлены Stage 6 (16.11.2026). Идеи и пороги взяты из
`D:\nlbopt-main\scripts\check-mail.mjs` (SPF/DMARC/CAA/MTA-STS, soft-404) и
`D:\October CMS\tools\check-seo.mjs` (директива `Sitemap`, тип карты), код
переписан на встроенные модули Node. Сбор делает **пять** запросов на адрес:
документ с цепочкой редиректов, `robots.txt`, `sitemap.xml`, проба
несуществующего пути и проба `http://`; счётчик — поле `requests`.

Разбор почтовых политик вынесен в `scripts/mail-policy.mjs` (чистые функции без
сети): `-all`/`~all`/`+all`/`?all` и `p=reject`/`quarantine`/`none` проверены
отдельным прогоном — 11 случаев, 0 провалов.

DNS-строки добавлены 16.11.2026 и проверены только до ветки `unknown`: на машине
разработки `node:dns` получает `ECONNREFUSED` (UDP 53 закрыт), поэтому `ok`/`fail`
для SPF и DMARC ещё не наблюдались живьём (`Что доделать.txt`, AUD-16).

### 1.1 Браузерный прогон (вручную, вне CI)

Живой сайт открывается в Chromium сессии OpenCode. Это **дополнение** к §1, а не
замена: в `scripts/` браузер не встраивается, в CI его нет (AUD-14).

| Проверка | Инструмент | Поле в JSON | Порог | Основание |
|---|---|---|---|---|
| Lighthouse: accessibility, SEO, best practices | `browser.lighthouse` | `external.browser.lighthouse` | 0–1 нормализуются в проценты: < 90 → `warn`, < 50 → `fail` | `:200-202` |
| Совпадение адреса браузерного прогона | `browser_data.json` (`url`) ↔ `audit_data.json` (`final_url`) | — | хост не совпал → блок пропускается с явной пометкой, а не подставляется молча | нет в источнике |
| Долгие задачи и раскладка времени | `browser.trace.start/stop/analyze` | `external.browser.trace` | long task > 200 мс → `warn` | `:200-202` |
| Сеть: запросы, сторонние хосты, вес | `browser.network.list` | `assets`, `external.browser.network` | > 50 запросов → `warn` | `:232-234` |
| Ошибки JS и console | `browser.console` | `external.browser.console` | любая ошибка → `warn` | нет в источнике |
| DOM после JS: `title`, `h1`, `canonical`, JSON-LD | `browser.snapshot`, `browser.evaluate` | `content`, `seo` | как в §1 | `:227-229` |
| Скриншот страницы | `browser.screenshot` | файл рядом с отчётом | — | нет в источнике |
| JS-профиль, горячие функции | `browser.cpu.start/stop/analyze` | `external.browser.cpu` | — | нет в источнике |
| PageSpeed Insights (внешний отчёт) | вручную: отчёт в браузере → `audit-report/pagespeed.json` | подраздел 4.1 | цифры Google цитируются как есть, в наши статусы не пересчитываются | нет в источнике |

Ограничения, которые нельзя забывать:

- `browser.lighthouse` **не эмулирует устройство и сеть** — его цифры не равны
  PageSpeed Insights; сравнивать можно только прогон с прогоном.
- Категории — accessibility, SEO, best practices. Performance собирается из
  `browser.trace`, а не из оценки Lighthouse.
- Одна вкладка за раз: обход 50 страниц — это 50 ручных шагов, а не краулер.
- Скриншоты и трейсы остаются на машине сессии: в git не идут, в отчёт
  попадает только встроенное изображение или ссылка.

## 2. Что НЕ делаем и почему

| Инструмент | Почему нет | Основание |
|---|---|---|
| `curl -sI` как основа | PowerShell подменяет `curl` алиасом `Invoke-WebRequest`, флаги падают; `curl.exe` есть, но Node даёт тот же результат без внешнего процесса | `:148` |
| `openssl s_client` | в PATH отсутствует (`Get-Command openssl`, 16.11.2026); `node:tls` отдаёт протокол, издателя и срок | `:151` |
| `whatweb` | Ruby-гем, на Windows не ставится (`Get-Command whatweb` — нет); замена — сигнатуры в коде | `:149` |
| Lighthouse **CLI** / headless Chrome | требует установки и 30–60 с на страницу; в CI дорого. Браузерный прогон — отдельно, §1.1 | `:200-202` |
| W3C Validator | SOAP/REST отдаёт шум по HTML5; сначала нужен разбор `title/h1/canonical` | `:227-229` |
| urlscan.io | полезен, но требует токен и раскрывает адрес третьей стороне | `:232-234` |
| Screaming Frog / Sitebulb | десктопные приложения, вне CLI | `:237-239` |
| OWASP ZAP, k6 | активное сканирование и нагрузка — только с письменного разрешения владельца | `:221-223`, `:145` |

## 3. Порядок запуска проверок

Источник задаёт приоритет (`:246-250`), и он же — порядок в отчёте:

1. заголовки и TLS (дешёвые, ловят главные дыры);
2. скорость (`ttfb_ms`, вес, сторонние скрипты);
3. SEO-периметр (`robots`, `sitemap`, `canonical`);
4. внешние API — последними, потому что они медленные и с лимитами;
5. браузерный прогон — только по запросу: медленно, невоспроизводимо и
   требует живой сессии (§1.1).

## 4. Лимиты и вежливость

- Не больше 1 запроса в секунду к одному домену (AUD-10).
- Свой `User-Agent` с контактом: `site-audit/<версия> (+контакт)`.
- Таймаут 10 с на адрес; общий прогон — не больше 5 минут на 20 адресов.
- Редиректы — до 5 шагов, потом `redirect_loop`.
- `robots.txt` уважается для внутренних страниц; корневой документ и
  `robots.txt`/`sitemap.xml` запрашиваются всегда: это не краулинг.
