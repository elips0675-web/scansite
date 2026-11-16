import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { resolve4, resolve6, resolveMx, resolveNs, resolveTxt } from 'node:dns/promises';
import tls from 'node:tls';

const UA = 'site-audit/0.1 (+https://github.com/elips0675-web/scansite)';
const TIMEOUT_MS = 10000;
const MAX_REDIRECTS = 5;
const HSTS_MIN = 15552000;
const HTML_WARN_BYTES = 500_000;

const flag = (name, fallback = null) => {
  const i = process.argv.indexOf(`--${name}`);
  return i === -1 ? fallback : process.argv[i + 1];
};

const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));

const input = [];
const single = flag('url');
const sitesFile = flag('sites');
const out = flag('out', 'audit-report/audit_data.json');

if (single) input.push(single);
if (sitesFile) {
  const parsed = JSON.parse(readFileSync(sitesFile, 'utf8'));
  const list = Array.isArray(parsed) ? parsed : parsed.sites || [];
  for (const item of list) input.push(typeof item === 'string' ? item : item.url);
}

if (input.length === 0) {
  console.error('нужен --url <адрес> или --sites <sites.json>');
  process.exit(2);
}

const finding = (id, level, check, message, evidence) => ({ id, level, check, message, evidence });
const text = (value) => (value === null || value === undefined ? '' : String(value));

const pick = (res, names) => {
  const out = {};
  for (const name of names) {
    if (res.headers.has(name)) out[name] = res.headers.get(name);
  }
  return out;
};

const HEADER_NAMES = [
  'strict-transport-security',
  'content-security-policy',
  'content-security-policy-report-only',
  'x-frame-options',
  'x-content-type-options',
  'referrer-policy',
  'permissions-policy',
  'cross-origin-opener-policy',
  'cache-control',
  'content-encoding',
  'server',
  'x-vercel-cache',
  'x-powered-by',
  'vary',
  'age',
];

const readTls = (hostname) =>
  new Promise((resolve) => {
    const socket = tls.connect(
      {
        host: hostname,
        servername: hostname,
        port: 443,
        timeout: TIMEOUT_MS,
        ALPNProtocols: ['h2', 'http/1.1'],
      },
      () => {
        const cert = socket.getPeerCertificate();
        resolve({
          protocol: socket.getProtocol(),
          alpn: socket.alpnProtocol || null,
          issuer: cert?.issuer?.O || cert?.issuer?.CN || null,
          subject: cert?.subject?.CN || null,
          not_before: cert?.valid_from || null,
          not_after: cert?.valid_to || null,
          days_left: cert?.valid_to
            ? Math.round((new Date(cert.valid_to).getTime() - Date.now()) / 86400000)
            : null,
          san: cert?.subjectaltname ? cert.subjectaltname.split(',').map((s) => s.trim()) : [],
        });
        socket.end();
      },
    );
    socket.on('error', (error) => resolve({ error: error.message }));
    socket.on('timeout', () => {
      socket.destroy();
      resolve({ error: 'timeout' });
    });
  });

const readDns = async (hostname) => {
  const codes = {};
  const safe = async (name, query) => {
    try {
      return await query();
    } catch (error) {
      codes[name] = error.code || 'ERR';
      return null;
    }
  };

  const [a, aaaa, mx, ns, txt, dmarcTxt] = await Promise.all([
    safe('a', () => resolve4(hostname)),
    safe('aaaa', () => resolve6(hostname)),
    safe('mx', () => resolveMx(hostname)),
    safe('ns', () => resolveNs(hostname)),
    safe('txt', () => resolveTxt(hostname)),
    safe('dmarc', () => resolveTxt(`_dmarc.${hostname}`)),
  ]);

  const flatten = (records) => (records || []).map((chunks) => chunks.join(''));
  const txtFlat = flatten(txt);
  const dmarcFlat = flatten(dmarcTxt);
  const resolverDown = [codes.a, codes.aaaa].some((code) =>
    ['ECONNREFUSED', 'ETIMEOUT', 'ESERVFAIL', 'ECANCELLED'].includes(code),
  );

  return {
    a: a || [],
    aaaa: aaaa || [],
    mx: (mx || []).map((record) => `${record.priority} ${record.exchange}`),
    ns: ns || [],
    txt: txtFlat,
    spf: txtFlat.find((value) => /^v=spf1/i.test(value)) || null,
    dmarc: dmarcFlat.find((value) => /^v=DMARC1/i.test(value)) || null,
    codes,
    error: resolverDown ? `resolver: ${codes.a || codes.aaaa}` : null,
  };
};

const parseHtml = (body, base) => {
  const title = (body.match(/<title[^>]*>([\s\S]*?)<\/title>/i) || [, ''])[1].trim();
  const description = (
    body.match(/<meta[^>]+name=["']description["'][^>]*content=["']([^"']*)/i) || [, '']
  )[1];
  const canonical = (
    body.match(/<link[^>]+rel=["']canonical["'][^>]*href=["']([^"']*)/i) || [, '']
  )[1];
  const lang = (body.match(/<html[^>]*lang=["']([^"']+)/i) || [, ''])[1];
  const generator = (
    body.match(/<meta[^>]+name=["']generator["'][^>]*content=["']([^"']*)/i) || [, '']
  )[1];
  const h1 = [...body.matchAll(/<h1[^>]*>([\s\S]*?)<\/h1>/gi)].map((m) =>
    m[1].replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim(),
  );
  const scripts = [...body.matchAll(/<script[^>]+src=["']([^"']+)/gi)].map((m) => m[1]);
  const styles = [
    ...body.matchAll(/<link[^>]+rel=["']stylesheet["'][^>]*href=["']([^"']+)/gi),
  ].map((m) => m[1]);
  const images = [...body.matchAll(/<img[^>]+src=["']([^"']+)/gi)].map((m) => m[1]);
  const inlineStyleBytes = [...body.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/gi)].reduce(
    (sum, m) => sum + Buffer.byteLength(m[1]),
    0,
  );
  const jsonld = [...body.matchAll(/<script[^>]+application\/ld\+json[^>]*>([\s\S]*?)<\/script>/gi)]
    .map((m) => {
      try {
        const parsed = JSON.parse(m[1]);
        const types = [];
        const walk = (node) => {
          if (!node || typeof node !== 'object') return;
          if (Array.isArray(node)) return node.forEach(walk);
          if (node['@type']) types.push(node['@type']);
          if (node['@graph']) walk(node['@graph']);
        };
        walk(parsed);
        return { valid: true, types };
      } catch {
        return { valid: false, types: [] };
      }
    });

  const hosts = new Set();
  for (const asset of [...scripts, ...styles, ...images]) {
    try {
      hosts.add(new URL(asset, base).host);
    } catch {
      hosts.add(asset);
    }
  }

  return {
    title,
    description,
    canonical,
    lang,
    generator,
    h1,
    scripts,
    styles,
    images,
    inlineStyleBytes,
    jsonld,
    external_hosts: [...hosts],
  };
};

const techOf = (body, headers, generator) => {
  const tech = [];
  if (generator) tech.push(generator.toLowerCase());
  if (/wp-content|wp-includes/i.test(body)) tech.push('wordpress');
  if (/\/bitrix\/|bitrix24/i.test(body)) tech.push('bitrix');
  if (/_next\/|__NEXT_DATA__/i.test(body)) tech.push('nextjs');
  if (/csrf-token/i.test(body) && /laravel/i.test(body)) tech.push('laravel');
  if (/drupal/i.test(body)) tech.push('drupal');
  if (headers['x-powered-by']) tech.push(text(headers['x-powered-by']).toLowerCase());
  if ((headers.server || '').toLowerCase().includes('vercel')) tech.push('vercel');
  const seen = new Set();
  const deduped = [];
  for (const entry of tech) {
    const base = entry.split(/[\s/]/)[0];
    if (seen.has(base)) continue;
    seen.add(base);
    deduped.push(entry);
  }
  return deduped;
};

const auditSite = async (url) => {
  const result = {
    url,
    final_url: null,
    status: null,
    error: null,
    redirects: [],
    headers: {},
    tls: null,
    timing: { ttfb_ms: null, total_ms: null },
    content: {
      bytes: null,
      title: null,
      meta_description: null,
      canonical: null,
      lang: null,
      h1_count: null,
      h1: [],
      generator: null,
      inline_style_bytes: null,
    },
    assets: {
      scripts: 0,
      styles: 0,
      images: 0,
      inline_scripts: 0,
      svg: 0,
      external_hosts: [],
      third_party: [],
    },
    seo: {
      robots_status: null,
      sitemap_status: null,
      sitemap_urls: null,
      sitemap_lastmod: null,
      has_jsonld: false,
      jsonld_types: [],
    },
    tech: [],
    dns: {
      a: [],
      aaaa: [],
      mx: [],
      ns: [],
      txt: [],
      spf: null,
      dmarc: null,
      codes: {},
      error: null,
    },
    findings: [],
  };

  let current = url;
  let response = null;
  let body = '';
  let ttfb = null;
  let total = null;

  try {
    for (let hop = 0; hop <= MAX_REDIRECTS; hop += 1) {
      const started = performance.now();
      response = await fetch(current, {
        redirect: 'manual',
        headers: { 'user-agent': UA },
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      if (ttfb === null) ttfb = performance.now() - started;
      const location = response.headers.get('location');

      if (response.status >= 300 && response.status < 400 && location) {
        const next = new URL(location, current).toString();
        result.redirects.push({ from: current, to: next, status: response.status });
        current = next;
        continue;
      }

      body = await response.text();
      total = performance.now() - started;
      break;
    }
  } catch (error) {
    const code = error?.cause?.code || error?.code || '';
    result.error =
      code === 'ENOTFOUND' || code === 'EAI_AGAIN' || code === 'EAI_NONAME'
        ? 'dns'
        : /timeout|ETIMEDOUT|UND_ERR_CONNECT_TIMEOUT/i.test(`${code} ${error.message}`)
          ? 'timeout'
          : 'network';
    result.findings.push(
      finding('fetch', 'fail', 'Доступность', `Запрос не выполнен: ${error.message}`, `${current} (${result.error})`),
    );
    return result;
  }

  if (result.redirects.length > MAX_REDIRECTS) {
    result.error = 'redirect_loop';
    return result;
  }

  result.final_url = current;
  result.status = response.status;
  result.timing = { ttfb_ms: Math.round(ttfb), total_ms: Math.round(total) };
  result.content.bytes = Buffer.byteLength(body);

  if (response.status !== 200) {
    result.findings.push(
      finding('status', response.status === 403 || response.status === 429 ? 'unknown' : 'fail', 'Код ответа', `HTTP ${response.status}`, current),
    );
  } else {
    result.findings.push(finding('status', 'ok', 'Код ответа', 'HTTP 200', current));
  }

  result.headers = pick(response, HEADER_NAMES);

  const host = new URL(current).hostname;
  if (new URL(current).protocol === 'https:') {
    result.tls = await readTls(host);
  }
  result.dns = await readDns(host);

  const parsed = parseHtml(body, current);
  result.content = {
    ...result.content,
    title: parsed.title || null,
    meta_description: parsed.description || null,
    canonical: parsed.canonical || null,
    lang: parsed.lang || null,
    h1_count: parsed.h1.length,
    h1: parsed.h1,
    generator: parsed.generator || null,
    inline_style_bytes: parsed.inlineStyleBytes,
  };

  const thirdParty = parsed.external_hosts.filter((h) => h && h !== host);
  result.assets = {
    scripts: parsed.scripts.length,
    styles: parsed.styles.length,
    images: parsed.images.length,
    inline_scripts: [...body.matchAll(/<script(?![^>]*\bsrc=)[^>]*>/gi)].length,
    svg: [...body.matchAll(/<svg[\s>]/gi)].length,
    external_hosts: parsed.external_hosts,
    third_party: thirdParty,
  };

  result.tech = techOf(body, result.headers, parsed.generator);

  const hsts = result.headers['strict-transport-security'];
  const csp = result.headers['content-security-policy'];
  const hstsAge = hsts ? Number((hsts.match(/max-age=(\d+)/) || [, 0])[1]) : null;

  result.findings.push(
    hsts
      ? hstsAge >= HSTS_MIN
        ? finding('hsts', 'ok', 'HSTS', 'HSTS с длинным max-age и preload', hsts)
        : finding('hsts', 'warn', 'HSTS', 'HSTS есть, но max-age меньше полугода', hsts)
      : finding('hsts', 'fail', 'HSTS', 'Заголовок HSTS отсутствует', 'strict-transport-security: —'),
  );

  result.findings.push(
    csp
      ? /unsafe-inline|unsafe-eval/.test(csp)
        ? finding('csp', 'warn', 'CSP', 'CSP есть, но допускает unsafe-inline/unsafe-eval', csp.slice(0, 120))
        : finding('csp', 'ok', 'CSP', 'Политика CSP задана', csp.slice(0, 120))
      : finding(
          'csp',
          'fail',
          'CSP',
          'Content-Security-Policy отсутствует: нет защиты от внедрения скриптов',
          'content-security-policy: —',
        ),
  );

  const simpleHeaders = [
    ['x-frame-options', 'X-Frame-Options', 'clickjacking'],
    ['x-content-type-options', 'X-Content-Type-Options', 'MIME-sniffing'],
    ['referrer-policy', 'Referrer-Policy', 'утечка адреса во внешние ресурсы'],
    ['permissions-policy', 'Permissions-Policy', 'доступ к камере и геолокации'],
  ];

  for (const [name, label, why] of simpleHeaders) {
    const value = result.headers[name];
    result.findings.push(
      value
        ? finding(name, 'ok', label, `${label} задан (${why} закрыт)`, value)
        : finding(name, 'warn', label, `${label} отсутствует: ${why}`, `${name}: —`),
    );
  }

  if (result.tls && !result.tls.error) {
    const weak = /TLSv1(\s|$)|TLSv1\.1/.test(result.tls.protocol || '');
    result.findings.push(
      finding(
        'tls_protocol',
        weak ? 'fail' : 'ok',
        'TLS',
        weak ? `Устаревший протокол ${result.tls.protocol}` : `Протокол ${result.tls.protocol}`,
        result.tls.protocol || '',
      ),
    );
    const days = result.tls.days_left;
    const level = days === null ? 'unknown' : days > 30 ? 'ok' : days > 7 ? 'warn' : 'fail';
    result.findings.push(
      finding(
        'cert_expiry',
        level,
        'Сертификат',
        days === null ? 'Срок сертификата не прочитан' : `До истечения ${days} дней (издатель: ${result.tls.issuer || '—'})`,
        `${result.tls.not_before || '—'} → ${result.tls.not_after || '—'}`,
      ),
    );
    const alpn = result.tls.alpn;
    result.findings.push(
      alpn === 'h2'
        ? finding('alpn', 'ok', 'HTTP/2', 'ALPN согласовал h2', 'h2')
        : alpn
          ? finding('alpn', 'warn', 'HTTP/2', `ALPN согласовал ${alpn}`, alpn)
          : finding('alpn', 'unknown', 'HTTP/2', 'ALPN не согласован', 'alpn: —'),
    );
  } else {
    result.findings.push(
      finding('tls_protocol', 'unknown', 'TLS', 'TLS-соединение не проверено', result.tls?.error || 'нет данных'),
    );
  }

  const ttfbMs = result.timing.ttfb_ms;
  result.findings.push(
    finding(
      'ttfb',
      ttfbMs < 500 ? 'ok' : ttfbMs < 1500 ? 'warn' : 'fail',
      'Скорость',
      `TTFB ${ttfbMs} мс`,
      `полный ответ ${result.timing.total_ms} мс`,
    ),
  );

  if (result.content.bytes > HTML_WARN_BYTES) {
    result.findings.push(
      finding('html_weight', 'warn', 'Вес HTML', `HTML ${Math.round(result.content.bytes / 1024)} КБ`, 'порог 500 КБ'),
    );
  }

  if (thirdParty.length > 0) {
    result.findings.push(
      finding('third_party', 'warn', 'Сторонние ресурсы', `${thirdParty.length} внешних хостов`, thirdParty.join(', ')),
    );
  }

  if (!result.content.title) {
    result.findings.push(finding('title', 'fail', 'SEO', 'Нет <title>', 'title: —'));
  } else {
    result.findings.push(finding('title', 'ok', 'SEO', 'Title есть', `${result.content.title.length} символов`));
  }

  if (!result.content.meta_description) {
    result.findings.push(finding('description', 'warn', 'SEO', 'Нет meta description', 'description: —'));
  }

  if (!result.content.canonical) {
    result.findings.push(finding('canonical', 'warn', 'SEO', 'Нет canonical', 'canonical: —'));
  }

  result.findings.push(
    result.content.h1_count === 1
      ? finding('h1', 'ok', 'SEO', 'Ровно один h1', result.content.h1[0] || '')
      : result.content.h1_count === 0
        ? finding('h1', 'fail', 'SEO', 'Нет h1', 'h1: 0')
        : finding('h1', 'warn', 'SEO', `h1 больше одного: ${result.content.h1_count}`, result.content.h1.join(' | ')),
  );

  const seoBase = new URL(current);
  try {
    const robots = await fetch(new URL('/robots.txt', seoBase), {
      headers: { 'user-agent': UA },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    result.seo.robots_status = robots.status;
  } catch {
    result.seo.robots_status = null;
  }

  try {
    const sitemap = await fetch(new URL('/sitemap.xml', seoBase), {
      headers: { 'user-agent': UA },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    result.seo.sitemap_status = sitemap.status;
    if (sitemap.status === 200) {
      const xml = await sitemap.text();
      result.seo.sitemap_urls = (xml.match(/<loc>/g) || []).length;
      const lastmods = [...xml.matchAll(/<lastmod>([^<]+)<\/lastmod>/g)].map((m) => m[1]);
      result.seo.sitemap_lastmod = lastmods.length ? lastmods.sort().at(-1) : null;
    }
  } catch {
    result.seo.sitemap_status = null;
  }

  result.findings.push(
    result.seo.robots_status === 200
      ? finding('robots', 'ok', 'SEO', 'robots.txt отвечает 200', 'robots.txt')
      : finding('robots', 'warn', 'SEO', 'robots.txt недоступен', `status: ${text(result.seo.robots_status) || '—'}`),
  );

  if (result.seo.sitemap_status === 200) {
    const stale = result.seo.sitemap_lastmod
      ? Date.now() - new Date(result.seo.sitemap_lastmod).getTime() > 365 * 86400000
      : false;
    result.findings.push(
      finding(
        'sitemap',
        stale ? 'warn' : 'ok',
        'SEO',
        stale ? 'sitemap.xml не обновлялся больше года' : `sitemap.xml: ${result.seo.sitemap_urls} адресов`,
        `lastmod: ${result.seo.sitemap_lastmod || '—'}`,
      ),
    );
  } else {
    result.findings.push(
      finding('sitemap', 'warn', 'SEO', 'sitemap.xml недоступен', `status: ${text(result.seo.sitemap_status) || '—'}`),
    );
  }

  result.seo.has_jsonld = parsed.jsonld.length > 0 && parsed.jsonld.every((b) => b.valid);
  result.seo.jsonld_types = [...new Set(parsed.jsonld.flatMap((b) => b.types))];
  result.findings.push(
    result.seo.has_jsonld
      ? finding('jsonld', 'ok', 'Микроразметка', `JSON-LD: ${result.seo.jsonld_types.join(', ') || 'без @type'}`, 'application/ld+json')
      : finding('jsonld', 'warn', 'Микроразметка', 'JSON-LD не найден или повреждён', 'application/ld+json: —'),
  );

  const likelySubdomain = host.split('.').length > 2;
  const mailLevel = (present) => (present ? 'ok' : likelySubdomain ? 'unknown' : 'fail');
  const mailNote = likelySubdomain ? ' (поддомен: записи обычно на апексе)' : '';

  if (result.dns.error) {
    result.findings.push(
      finding('dns', 'unknown', 'DNS', 'DNS-запросы не выполнены: резолвер недоступен', result.dns.error),
    );
  } else {
    result.findings.push(
      result.dns.a.length > 0
        ? finding('dns_a', 'ok', 'DNS', `A-записи: ${result.dns.a.length}`, result.dns.a.join(', '))
        : finding('dns_a', 'unknown', 'DNS', 'A-записи не найдены напрямую (возможен CNAME)', 'A: —'),
      result.dns.aaaa.length > 0
        ? finding('ipv6', 'ok', 'IPv6', `AAAA-записи: ${result.dns.aaaa.length}`, result.dns.aaaa.join(', '))
        : finding('ipv6', 'warn', 'IPv6', 'Нет AAAA-записи: сайт недоступен по IPv6', 'AAAA: —'),
      finding(
        'mx',
        mailLevel(result.dns.mx.length > 0),
        'Почта',
        result.dns.mx.length ? `MX-записей: ${result.dns.mx.length}` : `MX-записи нет${mailNote}`,
        result.dns.mx.length ? result.dns.mx.join('; ') : 'MX: —',
      ),
      finding(
        'spf',
        mailLevel(Boolean(result.dns.spf)),
        'Почта',
        result.dns.spf ? 'SPF задан' : `SPF не найден${mailNote}`,
        result.dns.spf || 'TXT: —',
      ),
      finding(
        'dmarc',
        mailLevel(Boolean(result.dns.dmarc)),
        'Почта',
        result.dns.dmarc ? 'DMARC задан' : `DMARC не найден${mailNote}`,
        result.dns.dmarc || '_dmarc TXT: —',
      ),
    );
  }

  return result;
};

const sites = [];
for (const url of input) {
  sites.push(await auditSite(url));
  await new Promise((resolve) => setTimeout(resolve, 1000));
}

const data = {
  meta: {
    generated_at: new Date().toISOString(),
    tool_version: pkg.version,
    node: process.version,
    sites_count: sites.length,
  },
  sites,
};

mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, `${JSON.stringify(data, null, 2)}\n`, 'utf8');
console.log(`audit_data.json: ${sites.length} адрес(ов), находок ${sites.reduce((n, s) => n + s.findings.length, 0)} → ${out}`);
