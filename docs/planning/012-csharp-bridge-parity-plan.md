# 012: полный паритет C# bridge с Python bridge

## Контекст

Правило проекта: каждая функция Python bridge должна работать в C# bridge так же, потому что десктоп поставляется только с C#. Раньше сверка шла по устаревшей ветке `docs/agents-md-bridge-parity`: она на 28 коммитов отстаёт от `origin/stage` и содержит 85 незакоммиченных правок. Поэтому в «недостающее» попадало то, что в stage уже перенесено: digest/route, вопросы и `/mcp`, `/llm/default`, `/llm/features`, sequence context, foreground probe.

Эта инвентаризация сделана **по `origin/stage` (f9cefb0)** в чистом worktree `C:\Users\UshakovDV\PycharmProjects\code-chroma-stage`. Сверены маршрут за маршрутом (все 120+), каждый модуль `src/codechroma/bridge/*`, все watcher'ы и события, bootstrap'ы и хуки агентов.

**Где работаем:** в worktree `code-chroma-stage`, новая ветка `feat/csharp-bridge-parity` от `stage`. Грязное дерево `code-chroma` не трогаем.

## Что уже совпадает (проверено, ничего не делаем)

Все HTTP/WS маршруты Python есть в C#, включая `/mcp`, questions/*, `/llm/default`, `/llm/features`, digests, `route`, `sequence/context`, wiki-general (все 9), wiki-context, `{kind}/review` (в Python review-ось тоже только у impact), generate-kinds (`c1` и `impact-changes`, как в Python), layout (только `hierarchy`, как в Python). Также совпадают: `ensure_excluded` и skill sync, `PrepareNewRun` с синхронизацией plain wiki, plain wiki bootstrap. Watcher репозитория не читает `.gitignore` ни в Python, ни в C#. Внешние пути epics в Python не настраиваются, так что паритет есть.

## Что переносим (реальные пробелы на stage)

### 1. `dependency-digest.json` не пишется на диск
Python пишет `.codechroma/dependency-digest.json` после каждого analyze/reanalyze (`engine.py:318,434`). Его читают агенты (CLAUDE.md), на нём держится staleness у custom-диаграмм. C# строит digest только в маршруте.
- `dotnet/CodeChroma.Bridge/Engine/CoreGraphEngine.cs`: после `_core.Analyze` и `_core.Reanalyze` (только если `_root` непустой) вызывать `CodeChroma.Core.DependencyDigest.Write(_root, DependencyDigest.Build(_core.Snapshot))`. Ошибку записи поймать и залогировать, как это делает Python `_write_dependency_digest`.
- `Diagrams/DiagramMigration.DigestFingerprint` сделать как Python `_digest_fingerprint` (`diagram_registry.py:56`). Тогда staleness перестанет быть константой.
- Тест: xUnit `CoreGraphEngineTests`: файл появляется после создания и обновляется после `Reanalyze`. Контракт: fs-проверка, если раннер умеет читать файлы, иначе только xUnit.

### 2. Bootstrap диаграмм при первом открытии (`bridge/bootstrap_diagrams.py`)
Python при подъёме workspace (`workspaces.py:467`, сразу после wiki bootstrap) делает две вещи. Для read-only (PR) workspace пропускает обе.
- **c1**: детерминированный шаблон `context/c1_template.py` (таблица `KNOWN_EXTERNAL_SYSTEMS` и узел system, `draft: true`) из context-digest. Пишется, только если `c1.json` отсутствует.
- **patterns**: один LLM-вызов (`context/patterns_generator.py`, call site `initial_diagram_bootstrap`, prompt `patterns_generator`). Подтверждает эвристических кандидатов и пишет `patterns.json`, только если файла нет, есть кандидаты и есть провайдер.
- Новый `dotnet/CodeChroma.Bridge/Diagrams/DiagramBootstrap.cs`: `IfMissing(Workspace)` вызывается в `WorkspaceRegistry.cs:218` рядом с `WikiBootstrap.IfMissing`. Ошибка никогда не роняет подъём workspace.
  - `C1Template.Generate(JsonObject digest)` — перенос таблицы 1:1. Вход: `CodeChroma.Core.ContextDigest.Build` (уже есть).
  - `PatternsGenerator.Generate(candidates, ILlmCompletion?)`: merge подтверждений. Узлы и связи через существующий `Core.Patterns.PatternSerialize` (instance/participant node, fingerprint). Prompt из embedded `Prompts.cs`.
  - Quick-path провайдер (нужен только здесь), как Python `build_provider` (`context/llm_provider.py`):
    - `offline` → null;
    - `api` → `LlmCompletion.For(provider)`;
    - cli/claude с ключом → anthropic;
    - legacy → ключ из assistant settings или env через `LlmCompletion.ForAssistant`.
    - Assignment берётся из `CallSiteStore`: override, иначе `ResolveDefault("quick")`. Это та же логика, что в `Skills/CliResolver.LoadAssignment`; вынести её в общий метод и не дублировать.
    - Модель и max_tokens из `settings.patterns_generator` вынести в константы в `BridgeLimits.cs`.
- Тесты:
  - xUnit `C1TemplateTests`: таблица, дедупликация по имени, Go-модули.
  - xUnit `PatternsGeneratorTests`: stub `ILlmCompletion`; нет кандидатов, плохой JSON или нет совпадений → null; merge.
  - xUnit `DiagramBootstrapTests`: файл существует → не трогаем; PR workspace → пропуск; offline → patterns не пишется.
  - Контракт: в `diagrams.cases.json` новый кейс «свежий репозиторий: `GET /repos/main/c1` отдаёт `draft: true` и узел `system`» (проходит на обоих backend'ах).

### 3. События watcher'ов (`bridge/workspaces.py:198-287` против `Workspaces/WorkspaceWatchers.cs`)
- `.codechroma/impact-changes.json` → `{"type":"impact-changes"}` (в C# нет).
- `.codechroma/wiki-general/index.md` → `{"type":"wiki-general"}` при изменении файла (в C# только при смене HEAD).
- Любое изменение под `diagrams/custom/**` или `diagrams/feature-plan/**`, включая `projection.json`: Python шлёт `custom`/`feature-plan` **плюс `canvas`**. В C# ловится только `<id>/<id>.json` и без `canvas`.
- Правка: новые ветки в `Route()` и debouncer'ы с `BridgeLimits.WatcherDebounceMs`; `NotifyNewDirectories` учитывает новые пути.
- Тест: кейсы в `transport.cases.json` по образцу существующего «diagram file change → `{type:c1}`»: impact-changes, wiki-general index, custom projection (ожидаются `custom` и `canvas`).

### 4. Хук `AskUserQuestion` в собранном приложении
Python ставит PreToolUse-хук через `hooks/hooks.json` плагина (`--plugin-dir`), а хук написан на Python. Папка плагина C# bridge (рядом с exe) содержит только `skills/`, без `hooks/` и `.claude-plugin/`, поэтому в десктопе хук не срабатывает. Об этом сказано в `desktop-app.md:150`.
- Перенос по образцу `Agents/AgentSessionOwnership` (бинарь bridge сам выступает хуком, Python не нужен):
  - `HookSettings()` получает второй хук `PreToolUse` с matcher `AskUserQuestion`, command `<bridge> ask-user-question`, timeout 15.
  - Логика в новом `Questions/AskUserQuestionHook.cs`, 1:1 с `hooks/ask_user_question_hook.py`:
    - env `CODECHROMA_BRIDGE_URL`, `CODECHROMA_QUESTION_TOKEN`, `CODECHROMA_WORKSPACE_ID` с legacy-написанием;
    - в stdin есть `tool_input.questions` и `/mcp/` отвечает за 0.5 с (любой HTTP-статус считается ответом) → deny JSON с тем же `DENY_REASON`;
    - при любой ошибке выход 0.
  - Подкоманда регистрируется в `BridgeCli.cs` рядом с `agent-session`.
  - `TerminalAgents.OwnedLaunch` передаёт `--settings`, когда есть трекинг или MCP endpoint. Сейчас передаёт только при трекинге.
- Тесты:
  - xUnit `AskUserQuestionHookTests`: нет env → пусто; нет questions → пусто; bridge недоступен → пусто; bridge отвечает → deny.
  - Тест на форму `HookSettings` (два события).
  - Тест в `TerminalAgentsBareTests`: в bare-окне хука нет.

### 5. PR и агентские worktree: `c1_source_root` не читается
Python использует `ws.c1_root` (`workspaces.py:81`, `diagram_registry.py:290`) в двух местах: проверка `has_artifact` у `c1/generate?only_if_missing` и `ready` у c1 в `diagrams/status`. В C# `Workspace.C1SourceRoot` хранится, но не читается.
- Правка:
  - добавить `Workspace.C1Root => C1SourceRoot ?? Root`;
  - использовать в `DiagramRoutes.cs:49` (generate `HasArtifact`) и `DiagramRoutes.cs:156` (status `ready` для `c1`);
  - сам путь артефакта не трогаем: в Python `diagram_artifact_path` тоже свой.
- Тест: xUnit на workspace с `C1SourceRoot`: c1 у main есть → `ready: true`, `only_if_missing` не стартует.

## Документация (в этом же изменении)
- `docs/planning/012-csharp-bridge.md`:
  - переписать «Phase 5» и «Remaining work» под фактическое состояние;
  - удалить устаревшие строки 70, 95-107, 109, 124-128;
  - добавить итоговую таблицу паритета, включая «проверено, совпадает»;
  - статус: Done по паритету; открытыми остаются только пункты ниже.
- `docs/architecture/desktop-app.md` «Bridge gaps»: хук перенесён, bootstrap и watcher-события есть.
- `docs/architecture/ai-questions.md:150` и `docs/planning/021-…:3`: C# `/mcp` и хук есть.
- `docs/architecture/engine.md` и `graph-bridge-core.md`: digest пишет и C#; bootstrap в C#; события watcher'ов.
- `docs/planning/017-finish-electron-removal.md`: строки 2 и 7 таблицы A.

## Сознательно не входит (не функциональный паритет bridge; явно указать в отчёте)
- **012, пункт 6**: trimmed/AOT publish и замер размера. Это упаковка, а не функции.
- **023, Stage 3**: веб-диалог default-модели. Это `web/`, а в C# маршруты уже есть.
- **017, строка 4**: проверочный прогон wiki-general на реальном Claude. Он платный, запускать только по команде.
- Решения владельца из 017 таблицы A: offline-summaries, граф в памяти, захват трассировки остаётся в Python, foreground probe не работает на Windows (в Python так же).

## Проверка
1. `dotnet test dotnet/CodeChroma.Bridge.sln`: дважды, без `CODECHROMA_PYTHON` и с ним (real-engine кейсы).
2. `poetry run pytest tests/contract -n auto`: новые кейсы зелёные на Python, то есть эталон подтверждён.
3. `poetry run pytest -n auto` и `poetry run ruff check .`
4. `dotnet test dotnet` (Core parity не сломан).
5. Ручная проверка: `dotnet run --project dotnet/CodeChroma.Bridge -- --repo <tmp-копия sample_repo>`:
   - после старта есть `c1.json` (`draft`) и `.codechroma/dependency-digest.json`;
   - запись `impact-changes.json` приходит в `/events`;
   - `echo '{"tool_input":{"questions":[1]}}' | <bridge> ask-user-question` с env отдаёт deny.
6. Коммиты Conventional: `feat(bridge): …` по пунктам 1–5 и `docs: …`.
