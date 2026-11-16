import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

const flag = (name, fallback = null) => {
  const i = process.argv.indexOf(`--${name}`);
  return i === -1 ? fallback : process.argv[i + 1];
};

const OUT_DIR = 'audit-report';
const HOST = flag('host', process.env.OLLAMA_HOST || 'http://127.0.0.1:11434');
const MODEL = flag('model', process.env.OLLAMA_MODEL || 'qwen2.5:3b');
const dataPath = flag('data', `${OUT_DIR}/audit_data.json`);
const outPath = flag('out', `${OUT_DIR}/conclusions.json`);
const dryRun = process.argv.includes('--dry-run');
const MAX_WORDS = 300;
const MAX_PROMPT_CHARS = 12000;

const data = JSON.parse(readFileSync(dataPath, 'utf8'));
const site = data.sites?.[0];

if (!site) {
  console.error('в данных нет sites[0]');
  process.exit(2);
}

const counts = { ok: 0, warn: 0, fail: 0, unknown: 0 };
for (const finding of site.findings || []) {
  counts[finding.level] = (counts[finding.level] || 0) + 1;
}

const url = site.final_url || site.url;
const ids = (site.findings || []).map((finding) => finding.id);
const actionable = (site.findings || []).filter((finding) => finding.level !== 'ok');
const passiveOk = (site.findings || [])
  .filter((finding) => finding.level === 'ok')
  .map((finding) => finding.id);

const clipper = (value, limit) => {
  const text = String(value ?? '').replace(/\s+/g, ' ').trim();
  return text.length > limit ? `${text.slice(0, limit)}…` : text;
};

const facts = actionable
  .map(
    (finding) =>
      `- ${finding.level} | ${finding.id} | ${clipper(finding.message, 160)} | ${clipper(finding.evidence, 120)}`,
  )
  .join('\n');

const prompt = `Ты пишешь раздел «Выводы» отчёта о пассивном аудите сайта. Все числа уже измерены скриптом, пересчитывать и угадывать их нельзя.

Правила:
- Ровно три пункта, в порядке приоритета: сначала level=fail, затем warn, затем SEO/скорость.
- Весь текст не больше 300 слов.
- Каждый пункт заканчивается ссылкой на id находки в квадратных скобках, например [csp]. Разрешены только id из списка ниже, чужие id запрещены.
- Не выдумывай технологии, заголовки, числа и причины: используй только строки ниже.
- unknown означает «не проверено», а не «в порядке».
- Без markdown-заголовков, без HTML, без вступления, без пересказа всего списка.
- Пиши по-русски, обращайся к владельцу сайта, императивом: «Включите…», «Сократите…», «Добавьте…».

Сайт: ${url}
Итог проверки: ok ${counts.ok}, warn ${counts.warn}, fail ${counts.fail}, unknown ${counts.unknown}.

Находки, требующие решения (level | id | что | подтверждение):
${facts || '- нет: все находки ok'}

Находки со статусом ok (перечислять не нужно, действий не требуют): ${passiveOk.join(', ') || '—'}.

Если fail нет — начни с самого дорогого warn. Не предлагай активное сканирование, ZAP, k6, покупку сервисов и внешние API: инструмент пассивный.`;

if (prompt.length > MAX_PROMPT_CHARS) {
  console.error(`промт ${prompt.length} символов превышает лимит ${MAX_PROMPT_CHARS}`);
  process.exit(2);
}

if (dryRun) {
  console.log(prompt);
  console.log(`\n--- dry-run: ${prompt.length} символов, модель ${MODEL}, хост ${HOST}, ничего не отправлено`);
  process.exit(0);
}

const clean = (raw) =>
  String(raw ?? '')
    .replace(/```[a-z]*/gi, '')
    .replace(/<[^>]+>/g, '')
    .replace(/\{\{|\}\}/g, '')
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/[ \t]+$/gm, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();

const trimToWords = (text) => {
  const words = text.split(/\s+/).filter(Boolean);
  if (words.length <= MAX_WORDS) return { text, words: words.length, truncated: false };
  const clipped = words.slice(0, MAX_WORDS).join(' ');
  const lastStop = Math.max(clipped.lastIndexOf('. '), clipped.lastIndexOf('! '), clipped.lastIndexOf('? '));
  const text2 = lastStop > clipped.length * 0.6 ? clipped.slice(0, lastStop + 1) : `${clipped}…`;
  return { text: text2, words: text2.split(/\s+/).filter(Boolean).length, truncated: true };
};

const citedIds = (text) => ids.filter((id) => new RegExp(`(^|[\\s(\\[,;:])${id}([\\s)\\].,;:!?]|$)`).test(text));

let payload;
try {
  const response = await fetch(`${HOST}/api/generate`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      model: MODEL,
      prompt,
      stream: false,
      options: { temperature: 0.2, num_ctx: 4096, num_predict: 700 },
    }),
    signal: AbortSignal.timeout(600000),
  });

  if (response.status === 404) {
    console.error(`модель ${MODEL} не найдена на ${HOST}. Скачайте: ollama pull ${MODEL}`);
    process.exit(1);
  }
  if (!response.ok) {
    console.error(`Ollama ответила HTTP ${response.status}: ${(await response.text()).slice(0, 300)}`);
    process.exit(1);
  }

  payload = await response.json();
} catch (error) {
  const code = error?.cause?.code || error?.code || '';
  console.error(`Ollama недоступна по ${HOST} (${code || error.message}). Проверьте: ollama serve и ollama list`);
  process.exit(1);
}

const raw = clean(payload.response);
if (!raw) {
  console.error('Ollama вернула пустой ответ');
  process.exit(1);
}

const { text, words, truncated } = trimToWords(raw);
const cited = citedIds(text);

if (cited.length === 0) {
  console.error('в тексте модели нет ни одной ссылки на id находки — раздел не записан');
  process.exit(1);
}
if (cited.length < 3) {
  console.error(`предупреждение: ссылок на id только ${cited.length} (ожидалось 3): ${cited.join(', ')}`);
}

const result = {
  meta: {
    model: payload.model || MODEL,
    host: HOST,
    generated_at: new Date().toISOString(),
    words,
    truncated,
    ids_cited: cited.length,
    ids: cited,
    prompt_chars: prompt.length,
    source: dataPath,
  },
  text,
};

mkdirSync(dirname(outPath), { recursive: true });
writeFileSync(outPath, `${JSON.stringify(result, null, 2)}\n`, 'utf8');

console.log(
  `${outPath}: ${words} слов, ссылок на id ${cited.length} (${cited.join(', ')}), модель ${result.meta.model}` +
    (truncated ? ', текст обрезан по лимиту 300 слов' : ''),
);
