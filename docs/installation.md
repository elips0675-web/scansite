# Установка и первый запуск

Состояние на 16.11.2026: код готов, ставить нечего — зависимостей ноль. Раздел
фиксирует, что на машине уже есть, чего нет и в каком порядке запускается прогон.

## 1. Что уже есть (проверено 16.11.2026)

| Компонент | Значение | Команда проверки |
|---|---|---|
| Node.js | v24.16.0 | `node -v` |
| npm | идёт с Node | `npm -v` |
| Python | 3.14.6 (не используется) | `python --version` |
| curl | 8.13.0, Windows, Schannel | `curl.exe --version` |
| Docker | установлен | `Get-Command docker` |
| Chrome | `C:\Program Files\Google\Chrome\Application\chrome.exe` | `Test-Path` |
| Ollama | 0.40.13, **не запущен** | `ollama --version` |

## 2. Чего нет

| Компонент | Статус | Обход |
|---|---|---|
| `openssl` | нет в PATH | `node:tls` (`docs/checks.md`) |
| `whatweb` | нет | сигнатуры в `audit-collect.mjs` (AUD-02) |
| `php` | нет | не нужен |
| `lighthouse` | не установлен | отложено (`docs/roadmap.md`) |
| `git`-репозиторий | есть, `origin` → `github.com/elips0675-web/scansite` | `git remote -v` |
| `nvidia-smi` | нет на этой машине | 3060 на другой (`docs/local-model.md`) |

## 3. Порядок установки

1. **Node.** Уже стоит. Ничего не делать.
2. **Репозиторий.** Создан и связан: `origin` →
   `https://github.com/elips0675-web/scansite`, ветка `main`, `.gitignore`
   на месте (Stage 1, 16.11.2026).
3. **Гейты.** `node tools/check-docs.mjs` — exit 0; `node --check` обоих скриптов.
4. **Первый прогон.** `node scripts/audit-collect.mjs --url https://example.com/`
   → `audit-report/audit_data.json`, затем `node scripts/audit-render.mjs`
   → `audit-report/audit-report.html`. Зависимостей нет, `npm install` не нужен.
5. **Ollama** (когда понадобится стадия 4): запустить приложение из трея,
   проверить `ollama list`. Моделей на этой машине пока нет.
6. **Профиль модели** (на машине с 3060, не здесь): по
   `D:\3060OllamaClineOpenCode-main 1\02-Установить-локально.bat`, профиль [1],
   затем `ollama ps` → `100% GPU`.

## 4. Проверка, что всё встало

```powershell
cd "D:\OpenCode сканер сайтов"
node -v                          # v24.x
node tools/check-docs.mjs        # exit 0, без FAIL
node scripts/audit-collect.mjs --url https://example.com/   # audit-report/audit_data.json
node scripts/audit-render.mjs    # audit-report/audit-report.html
ollama ps                        # пусто — нормально, модель не запущена
```

## 5. Частые сбои

| Симптом | Причина | Что делать |
|---|---|---|
| `curl: unknown --write-out format` | в PowerShell `curl` — алиас | вызывать `curl.exe` или Node |
| `openssl: не является внутренней командой` | нет OpenSSL | `node:tls`, не ставить OpenSSL ради одного поля |
| `ollama ps` пусто | сервис не запущен | запустить Ollama из трея |
| Кириллица в консоли — кракозябры | кодовая страница PowerShell | `node -e`, запись в файл и чтение файла |
| `npm.cmd run check:docs` падает после правки доков | файл не упомянут в `docs/README.md` | добавить строку в карту |
