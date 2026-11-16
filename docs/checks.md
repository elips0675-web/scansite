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

## 2. Что НЕ делаем и почему

| Инструмент | Почему нет | Основание |
|---|---|---|
| `curl -sI` как основа | PowerShell подменяет `curl` алиасом `Invoke-WebRequest`, флаги падают; `curl.exe` есть, но Node даёт тот же результат без внешнего процесса | `:148` |
| `openssl s_client` | в PATH отсутствует (`Get-Command openssl`, 16.11.2026); `node:tls` отдаёт протокол, издателя и срок | `:151` |
| `whatweb` | Ruby-гем, на Windows не ставится (`Get-Command whatweb` — нет); замена — сигнатуры в коде | `:149` |
| Lighthouse CLI / headless Chrome | требует Chromium-профиля и 30–60 с на страницу; в агентном цикле дорого. Отложено (`docs/roadmap.md`) | `:200-202` |
| W3C Validator | SOAP/REST отдаёт шум по HTML5; сначала нужен разбор `title/h1/canonical` | `:227-229` |
| urlscan.io | полезен, но требует токен и раскрывает адрес третьей стороне | `:232-234` |
| Screaming Frog / Sitebulb | десктопные приложения, вне CLI | `:237-239` |
| OWASP ZAP, k6 | активное сканирование и нагрузка — только с письменного разрешения владельца | `:221-223`, `:145` |

## 3. Порядок запуска проверок

Источник задаёт приоритет (`:246-250`), и он же — порядок в отчёте:

1. заголовки и TLS (дешёвые, ловят главные дыры);
2. скорость (`ttfb_ms`, вес, сторонние скрипты);
3. SEO-периметр (`robots`, `sitemap`, `canonical`);
4. внешние API — последними, потому что они медленные и с лимитами.

## 4. Лимиты и вежливость

- Не больше 1 запроса в секунду к одному домену (AUD-10).
- Свой `User-Agent` с контактом: `site-audit/<версия> (+контакт)`.
- Таймаут 10 с на адрес; общий прогон — не больше 5 минут на 20 адресов.
- Редиректы — до 5 шагов, потом `redirect_loop`.
- `robots.txt` уважается для внутренних страниц; корневой документ и
  `robots.txt`/`sitemap.xml` запрашиваются всегда: это не краулинг.
