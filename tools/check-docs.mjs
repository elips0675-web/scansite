import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const problems = [];
const notes = [];

const abs = (rel) => join(root, rel);
const exists = (rel) => existsSync(abs(rel));
const text = (rel) => readFileSync(abs(rel), 'utf8');

const required = [
  'README.md',
  'AGENTS.md',
  'project-context.md',
  'CHANGELOG.md',
  'Что доделать.txt',
  'Что сделано.txt',
  '.gitignore',
  'package.json',
  'docs/README.md',
  'docs/architecture.md',
  'docs/checks.md',
  'docs/report-format.md',
  'docs/scope.md',
  'docs/local-model.md',
  'docs/installation.md',
  'docs/qa-checklist.md',
  'docs/roadmap.md',
  'docs/archive/README.md',
  'test/README.md',
  'test/Для анализа.txt',
  'tools/check-docs.mjs',
];

for (const rel of required) {
  if (exists(rel)) notes.push(`есть ${rel}`);
  else problems.push(`нет файла: ${rel}`);
}

if (exists('docs/README.md')) {
  const map = text('docs/README.md');
  const listed = new Set([...map.matchAll(/`([^`\s]+\.md)`/g)].map((m) => m[1]));

  for (const token of listed) {
    const rel = join('docs', token);
    if (!exists(rel)) problems.push(`карта ссылается на отсутствующий файл: ${rel}`);
  }

  const docsFiles = readdirSync(abs('docs'), { recursive: true })
    .map((p) => String(p).split('\\').join('/'))
    .filter((p) => p.endsWith('.md') && p !== 'README.md');

  for (const rel of docsFiles) {
    const base = rel.split('/').pop();
    if (!listed.has(rel) && !listed.has(base)) {
      problems.push(`документ не указан в карте: docs/${rel}`);
    }
  }

  notes.push(`карта: ${listed.size} ссылок, ${docsFiles.length} документов в docs/`);
}

if (exists('README.md')) {
  const readme = text('README.md');
  for (const file of readdirSync(root).filter((f) => f.endsWith('.md'))) {
    if (!readme.includes(file)) problems.push(`README.md не упоминает ${file}`);
  }
}

for (const forbidden of ['Что сделать.txt', '.env']) {
  if (exists(forbidden)) problems.push(`лишний файл: ${forbidden}`);
}

if (exists('Что доделать.txt')) {
  const blocks = text('Что доделать.txt').split(/^### /m).slice(1);
  const evidence = /\.(html|md|txt|mjs|js|json):\d+/;
  let count = 0;

  for (const block of blocks) {
    const id = (block.split('.')[0] || '').trim();
    if (!/^AUD-\d+$/.test(id)) continue;
    count += 1;
    if (!evidence.test(block) && !block.includes('проверено')) {
      problems.push(`пункт ${id} без доказательства (нужен file:line или «проверено»)`);
    }
  }

  if (count === 0) problems.push('бэклог пуст: нет ни одного пункта AUD-NN');
  else notes.push(`бэклог: ${count} открытых пунктов`);
}

if (exists('Что доделать.txt')) {
  const body = text('Что доделать.txt');
  if (/^### (?!AUD-)/m.test(body)) problems.push('в бэклоге есть пункт без ID формата AUD-NN');
}

if (exists('Что сделано.txt')) {
  const journal = text('Что сделано.txt');
  if (!/\(Stage \d+ — \d{2}\.\d{2}\.\d{4}\)/.test(journal)) {
    problems.push('журнал: нет записи формата «(Stage N — ДД.ММ.ГГГГ)»');
  }
}

const placeholders = [/требует описания/i, /<заполнить>/i, /\bTODO:/];
const scanned = [
  'README.md',
  'AGENTS.md',
  'project-context.md',
  'docs/README.md',
  'docs/architecture.md',
  'docs/checks.md',
  'docs/report-format.md',
  'docs/scope.md',
  'docs/local-model.md',
  'docs/installation.md',
  'docs/qa-checklist.md',
  'docs/roadmap.md',
  'Что доделать.txt',
  'Что сделано.txt',
  'test/Для анализа.txt',
];

for (const rel of scanned) {
  if (!exists(rel)) continue;
  const body = text(rel);
  for (const pattern of placeholders) {
    if (pattern.test(body)) problems.push(`заготовка в ${rel}: ${pattern.source}`);
  }
}

if (exists('.gitignore')) {
  const ignore = text('.gitignore');
  for (const entry of ['node_modules/', '.env', 'audit_data.json', 'audit-report.html']) {
    if (!ignore.includes(entry)) problems.push(`.gitignore не содержит ${entry}`);
  }
}

console.log('check:docs — сканер сайтов');
for (const note of notes) console.log(`  ок: ${note}`);

if (problems.length === 0) {
  console.log(`  итог: ${notes.length} проверок пройдено, 0 проблем`);
  process.exit(0);
}

for (const problem of problems) console.log(`  FAIL: ${problem}`);
console.log(`  итог: ${problems.length} проблем`);
process.exit(1);
