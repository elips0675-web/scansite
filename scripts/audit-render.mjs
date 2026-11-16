import { readFileSync, writeFileSync, statSync, existsSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

const flag = (name, fallback = null) => {
  const i = process.argv.indexOf(`--${name}`);
  return i === -1 ? fallback : process.argv[i + 1];
};

const OUT_DIR = 'audit-report';
const dataPath = flag('data', `${OUT_DIR}/audit_data.json`);
const browserDefault = existsSync(`${OUT_DIR}/browser_data.json`) ? `${OUT_DIR}/browser_data.json` : null;
const browserPath = flag('browser', browserDefault);
const outPath = flag('out', `${OUT_DIR}/audit-report.html`);
const templatePath = flag('template', 'templates/audit-report.html');
const MAX_REPORT_BYTES = 150 * 1024;

const data = JSON.parse(readFileSync(dataPath, 'utf8'));
const site = data.sites?.[0];

if (!site) {
  console.error('в данных нет sites[0]');
  process.exit(2);
}

const browser = browserPath ? JSON.parse(readFileSync(browserPath, 'utf8')) : null;

const conclusionsPath = flag('conclusions', `${OUT_DIR}/conclusions.json`);
const modelText = (() => {
  if (!existsSync(conclusionsPath)) return null;
  try {
    const parsed = JSON.parse(readFileSync(conclusionsPath, 'utf8'));
    return parsed && parsed.text ? parsed : null;
  } catch {
    console.error(`файл выводов ${conclusionsPath} не разобран — раздел останется с заглушкой`);
    return null;
  }
})();

const esc = (value) =>
  String(value ?? '').replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c],
  );

const byId = new Map((site.findings || []).map((f) => [f.id, f]));
const get = (id) => byId.get(id) || null;
const badge = (level) => `<span class="badge ${esc(level)}">${esc(level)}</span>`;
const statusOf = (id) => {
  const finding = get(id);
  return finding ? badge(finding.level) : badge('unknown');
};
const cell = (value) => (value === null || value === undefined || value === '' ? '—' : esc(value));
const num = (value, unit = '') =>
  value === null || value === undefined ? '—' : `<td class="num">${esc(value)}${esc(unit)}</td>`;

const counts = { ok: 0, warn: 0, fail: 0, unknown: 0 };
for (const finding of site.findings || []) {
  if (counts[finding.level] !== undefined) counts[finding.level] += 1;
}
const counters = ['fail', 'warn', 'unknown', 'ok']
  .map((level) => `<span class="badge ${level}">${level} ${counts[level]}</span>`)
  .join('\n  ');

const priority = { fail: 0, warn: 1, unknown: 2, ok: 3 };
const top = (site.findings || [])
  .slice()
  .sort((a, b) => priority[a.level] - priority[b.level])
  .slice(0, 3)
  .map((finding) => `<li>${badge(finding.level)} <strong>${esc(finding.check)}</strong> — ${esc(finding.message)}</li>`)
  .join('\n    ') || '<li>находок нет</li>';

const verdictLevel = counts.fail > 0 ? 'fail' : counts.warn > 0 ? 'warn' : counts.unknown > 0 ? 'unknown' : 'ok';
const verdictText = {
  fail: `Есть ${counts.fail} нарушение(й) порога: см. красные строки в разделах 2–6.`,
  warn: `Нарушений порога нет; ${counts.warn} замечание(й) к качеству настройки.`,
  unknown: 'Часть проверок не выполнена — отчёт не подтверждает, что с сайтом всё в порядке.',
  ok: 'Все выполненные проверки в пределах порогов.',
}[verdictLevel];

const HEADER_ROWS = [
  ['hsts', 'Strict-Transport-Security', 'max-age ≥ 15552000 плюс includeSubDomains'],
  ['csp', 'Content-Security-Policy', 'базовая политика: default-src \'self\'; frame-ancestors \'none\''],
  ['x-frame-options', 'X-Frame-Options', 'DENY или SAMEORIGIN'],
  ['x-content-type-options', 'X-Content-Type-Options', 'nosniff'],
  ['referrer-policy', 'Referrer-Policy', 'strict-origin-when-cross-origin'],
  ['permissions-policy', 'Permissions-Policy', 'перечислять только реально нужные API'],
];

const headersTable = HEADER_ROWS.map(([id, label, advice]) => {
  const value = site.headers?.[id] || '—';
  const shown = value.length > 90 ? `${value.slice(0, 90)}…` : value;
  return `      <tr><td><code>${esc(label)}</code></td><td>${cell(shown)}</td><td>${statusOf(id)}</td><td class="note">${esc(advice)}</td></tr>`;
}).join('\n');

const tls = site.tls || {};
const tlsBlock = tls.error
  ? `<p class="note">TLS-соединение не проверено: ${esc(tls.error)}.</p>`
  : `<table>
    <tbody>
      <tr><th>Протокол</th><td>${cell(tls.protocol)}</td><td>${statusOf('tls_protocol')}</td></tr>
      <tr><th>HTTP/2 (ALPN)</th><td>${cell(tls.alpn)}</td><td>${statusOf('alpn')}</td></tr>
      <tr><th>Издатель</th><td>${cell(tls.issuer)}</td><td></td></tr>
      <tr><th>Домен в сертификате</th><td>${cell(tls.subject)}</td><td></td></tr>
      <tr><th>Действует</th><td>${cell(tls.not_before)} → ${cell(tls.not_after)}</td><td></td></tr>
      <tr><th>Осталось дней</th><td>${cell(tls.days_left)}</td><td>${statusOf('cert_expiry')}</td></tr>
      <tr><th>SAN</th><td>${cell((tls.san || []).slice(0, 6).join(', '))}</td><td></td></tr>
    </tbody>
  </table>`;

const dns = site.dns || {};
const dnsBlock = dns.error
  ? `<p class="note">DNS-проверки не выполнены: ${esc(dns.error)}. Статус — <code>unknown</code>, а не «всё хорошо».</p>`
  : `<table>
    <tbody>
      <tr><th>A</th><td>${cell((dns.a || []).slice(0, 3).join(', '))}</td><td>${statusOf('dns_a')}</td></tr>
      <tr><th>AAAA (IPv6)</th><td>${cell((dns.aaaa || []).slice(0, 3).join(', '))}</td><td>${statusOf('ipv6')}</td></tr>
      <tr><th>MX</th><td>${cell((dns.mx || []).slice(0, 3).join('; '))}</td><td>${statusOf('mx')}</td></tr>
      <tr><th>NS</th><td>${cell((dns.ns || []).slice(0, 3).join(', '))}</td><td></td></tr>
      <tr><th>SPF</th><td>${cell(dns.spf)}</td><td>${statusOf('spf')}</td></tr>
      <tr><th>DMARC</th><td>${cell(dns.dmarc)}</td><td>${statusOf('dmarc')}</td></tr>
    </tbody>
  </table>
  <p class="note">DNS и почта проверяются на самом имени, без обхода апекса: для поддомена отсутствие SPF/DMARC — <code>unknown</code>, а не <code>fail</code>. DNSSEC не проверяется: Node не отдаёт AD-bit. Запросов к сайту эта проверка не добавляет.</p>`;

const speedBlock = `<table>    <tbody>
      <tr><th>TTFB</th>${num(site.timing?.ttfb_ms, ' мс')}<td>${statusOf('ttfb')}</td></tr>
      <tr><th>Полный ответ</th>${num(site.timing?.total_ms, ' мс')}<td></td></tr>
      <tr><th>Вес HTML</th>${num(site.content?.bytes ? Math.round(site.content.bytes / 1024) : null, ' КБ')}<td>${statusOf('html_weight')}</td></tr>
      <tr><th>Инлайн-CSS</th>${num(site.content?.inline_style_bytes ? Math.round(site.content.inline_style_bytes / 1024) : 0, ' КБ')}<td></td></tr>
      <tr><th>Скрипты / стили / картинки из HTML</th><td class="num">${esc(site.assets?.scripts ?? 0)} / ${esc(site.assets?.styles ?? 0)} / ${esc(site.assets?.images ?? 0)}</td><td></td></tr>
      <tr><th>SVG в разметке</th>${num(site.assets?.svg, ' шт.')}<td></td></tr>
      <tr><th>Внешние хосты</th>${num((site.assets?.external_hosts || []).length)}<td>${statusOf('third_party')}</td></tr>
    </tbody>
  </table>`;

const browserBlock = browser
  ? `<table>
    <tbody>
      <tr><th>Lighthouse: accessibility</th>${num(browser.lighthouse?.accessibility)}<td>${badge(browser.lighthouse?.accessibility >= 90 ? 'ok' : browser.lighthouse?.accessibility >= 70 ? 'warn' : 'fail')}</td></tr>
      <tr><th>Lighthouse: best practices</th>${num(browser.lighthouse?.best_practices)}<td></td></tr>
      <tr><th>Lighthouse: SEO</th>${num(browser.lighthouse?.seo)}<td></td></tr>
      <tr><th>Запросов в сети браузера</th>${num(browser.network?.requests)}<td></td></tr>
      <tr><th>Передано по сети</th>${num(browser.network?.transfer_bytes ? Math.round(browser.network.transfer_bytes / 1024) : null, ' КБ')}<td></td></tr>
      <tr><th>Ошибки JS / console</th>${num(browser.console?.errors)}<td></td></tr>
      <tr><th>Долгие задачи (трейс)</th>${num(browser.trace?.long_tasks)}<td></td></tr>
      <tr><th>Блокировка долгими задачами</th>${num(browser.trace?.blocking_ms, ' мс')}<td></td></tr>
      <tr><th>Длительность записи трейса</th>${num(browser.trace?.duration_ms ? Math.round(browser.trace.duration_ms) : null, ' мс')}<td></td></tr>
    </tbody>
  </table>
  <p class="note">Прогон выполнен в браузере сессии OpenCode — <strong>вне CI</strong>, вручную. Эмуляции устройства и сети нет: оценки Lighthouse нельзя сравнивать с PageSpeed Insights, только прогон с прогоном. Категория Performance в Lighthouse недоступна; время исполнения берётся из трейса.</p>`
  : '<p class="note">Браузерный прогон не выполнялся. Стадия опциональна, в CI не заходит (AUD-14): Lighthouse, трейс и сеть собираются вручную в живой сессии.</p>';

const techList = (site.tech || []).length ? (site.tech || []).map((t) => `<code>${esc(t)}</code>`).join(', ') : '—';
const techBlock = `<p>Сигнатуры: ${techList}</p>
  <table>
    <tbody>
      <tr><th>Внешние хосты в разметке</th><td>${(site.assets?.external_hosts || []).length ? esc(site.assets.external_hosts.join(', ')) : 'нет'}</td></tr>
      <tr><th>Сторонние (не основной домен)</th><td>${(site.assets?.third_party || []).length ? esc(site.assets.third_party.join(', ')) : 'нет'}</td></tr>
      <tr><th>Инлайн-скрипты (без src)</th><td>${esc(site.assets?.inline_scripts ?? 0)}</td></tr>
      <tr><th>Generator из meta</th><td>${cell(site.content?.generator)}</td></tr>
    </tbody>
  </table>`;

const seoBlock = `<table>
    <tbody>
      <tr><th>Title</th><td>${cell(site.content?.title)}</td><td>${statusOf('title')}</td></tr>
      <tr><th>Description</th><td>${cell(site.content?.meta_description)}</td><td>${statusOf('description')}</td></tr>
      <tr><th>Canonical</th><td>${cell(site.content?.canonical)}</td><td>${statusOf('canonical')}</td></tr>
      <tr><th>Язык</th><td>${cell(site.content?.lang)}</td><td></td></tr>
      <tr><th>H1</th><td>${esc(site.content?.h1_count ?? 0)}: ${cell((site.content?.h1 || []).join(' | '))}</td><td>${statusOf('h1')}</td></tr>
      <tr><th>robots.txt</th><td>HTTP ${cell(site.seo?.robots_status)}</td><td>${statusOf('robots')}</td></tr>
      <tr><th>sitemap.xml</th><td>HTTP ${cell(site.seo?.sitemap_status)}, ${esc(site.seo?.sitemap_urls ?? 0)} адресов, lastmod ${cell(site.seo?.sitemap_lastmod)}</td><td>${statusOf('sitemap')}</td></tr>
      <tr><th>JSON-LD</th><td>${(site.seo?.jsonld_types || []).length ? esc(site.seo.jsonld_types.join(', ')) : 'нет'}</td><td>${statusOf('jsonld')}</td></tr>
    </tbody>
  </table>`;

const paragraphs = (value) =>
  String(value)
    .split(/\n{2,}/)
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => `<p>${esc(part).replace(/\n/g, '<br>')}</p>`)
    .join('\n    ');

const conclusions = modelText
  ? `<div class="model-text">
    ${paragraphs(modelText.text)}
  </div>
  <p class="note">Текст модели <code>${esc(modelText.meta?.model || '—')}</code>: ${esc(modelText.meta?.words ?? '—')} слов при лимите 300, ссылок на <code>id</code> — ${esc(modelText.meta?.ids_cited ?? 0)}. Сгенерирован ${esc(String(modelText.meta?.generated_at || '').slice(0, 16).replace('T', ' '))}. Числа — из разделов 1–6, а не из текста модели.</p>`
  : browser
    ? `<p class="note">Модель не запускалась: раздел заполняется локальной моделью (≤ 300 слов) через <code>node scripts/audit-summary.mjs</code> или вручную по <code>id</code> находок. Факты для текста — выше, в разделах 1–6.</p>`
    : `<p class="note">Модель не запускалась. Раздел заполняется командой <code>node scripts/audit-summary.mjs</code>; каждая рекомендация обязана ссылаться на <code>id</code> находки из разделов 1–6.</p>`;

const notChecked = `<ul>
    <li>Активные проверки (ZAP, k6, брутфорс путей) — только с письменного разрешения владельца сайта.</li>
    <li>Внешние API: PageSpeed Insights, Mozilla Observatory, SSL Labs — ключей нет, запросы не отправлялись.</li>
    <li>${browser ? 'Браузерный прогон выполнен вручную и вне CI; page-веса картинок и видео не измерялись, если их нет в разметке.' : 'Браузерный прогон (Lighthouse, трейс, сеть) не запускался.'}</li>
    <li>Страницы за авторизацией, формами и параметрами запроса — не проверялись.</li>
    <li>Поддомены и пути вне <code>sitemap.xml</code> — не обходились.</li>
    <li>Соответствие заявленных заголовков безопасности реальному поведению (XSS, clickjacking в деле) — не проверялось.</li>
  </ul>`;

const host = (() => {
  try {
    return new URL(site.url).host;
  } catch {
    return site.url;
  }
})();

const generated = data.meta?.generated_at || '';

const values = {
  host: esc(host),
  url: esc(site.final_url || site.url),
  generated_at: esc(generated),
  generated_short: esc(generated.slice(0, 16).replace('T', ' ')),
  tool_version: esc(data.meta?.tool_version),
  node: esc(data.meta?.node),
  counters,
  verdict_level: verdictLevel,
  verdict_text: esc(verdictText),
  top_issues: top,
  headers_table: headersTable,
  tls_block: tlsBlock,
  dns_block: dnsBlock,
  speed_block: speedBlock,
  browser_block: browserBlock,
  tech_block: techBlock,
  seo_block: seoBlock,
  conclusions,
  not_checked: notChecked,
};

const template = readFileSync(templatePath, 'utf8');
const html = template.replace(/\{\{([a-z_]+)\}\}/g, (match, key) =>
  Object.hasOwn(values, key) ? values[key] : match,
);

const leftovers = [...html.matchAll(/\{\{[a-z_.]+\}\}/g)].map((m) => m[0]);
if (leftovers.length > 0) {
  console.error(`незаполненные плейсхолдеры: ${[...new Set(leftovers)].join(', ')}`);
  process.exit(1);
}

mkdirSync(dirname(outPath), { recursive: true });
writeFileSync(outPath, html, 'utf8');

const size = statSync(outPath).size;
if (size > MAX_REPORT_BYTES) {
  console.error(`отчёт ${Math.round(size / 1024)} КБ превышает бюджет ${MAX_REPORT_BYTES / 1024} КБ`);
  process.exit(1);
}

const forbidden = [
  [/<script/i, '<script>'],
  [/<link\b/i, '<link>'],
  [/\ssrc=/i, 'src='],
  [/@import/i, '@import'],
  [/url\(\s*['"]?https?:/i, 'url(http…)'],
];
for (const [pattern, label] of forbidden) {
  if (pattern.test(html)) {
    console.error(`в отчёте найден внешний ресурс (${label}) — бюджет «0 внешних запросов» нарушен`);
    process.exit(1);
  }
}

console.log(`${outPath}: ${Math.round(size / 1024)} КБ, статусов ok ${counts.ok} / warn ${counts.warn} / fail ${counts.fail} / unknown ${counts.unknown}`);
