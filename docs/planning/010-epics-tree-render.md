# 010 — Epics: вернуть «дерево epic→story» через новый skill-drawn процесс

## Проблема (что не так сейчас)

Epic-диаграмма после миграции на skill-drawn (`6525ea5`) рендерится плоским набором боксов:

- Каждый epic и каждая story — отдельный `CanvasNodeBox` с `name + description` (статус/приоритет/группа).
- Единственная визуальная группировка — `group`-label по business-domain (`platform`/`planning`/`settings`),
  которая рендерится как `GroupFrame` (фоновый прямоугольник), а **не** как дерево epic→story.
- Родительско-детская связь epic→его stories в `epics.json` сейчас вообще не задействована:
  у story стоит `group: "settings"` (домен), а не id родителя-эпика.
- Стрелки — только cross-epic `depends_on`; иерархии как дерева нет.

Пользователю хочется: **чистое дерево epic→story родитель-ребёнок на холсте**, статус в label,
без тяжёлых деталей внутри бокса (критерии/артефакты остаются за кликом → AI brief).

## Цель

Вернуть вид «дерево epic→story» (как в старом виде до 016), но **оставить новый процесс**:
skill-drawn `epics.json` в общем плоском формате `nodes[]/relations[]` + `reshape()` + `GroupFrame`.

НЕ возвращаем: `EpicsView.tsx`/`EpicBoxes.tsx`/`epicsGraph.ts`/`epicsLayout.ts`, `epics_index`-роут,
клиентскую portfolio-индексацию. Всё, что добавляется, — это то, как **skill авторит** `epics.json`
и как **резолвер/фронт** проецируют уже существующую группировку.

## Решение (3 части)

### Часть 1 — Skill авторит дерево через `group` = id родителя

Файл: `.claude/skills/codechroma-draw-diagram/references/type-epics.md` + `prompts/epics_agent.yaml`.

Сейчас skill ставит story `group` = домен (`settings`). Меняем правило на **`group` = родительский id**:

- У каждой `story` box: `group = <id её эпика>` (например `"EP-3"`).
- У каждого `epic` box: `group` = его домен (остаётся как есть; эпики верхнего уровня).
- В label каждого бокса статус — уже есть (`In progress`/`Planned`/`Done`/`Draft`) в `description`;
  поднимаем в `meta.status` (уже поддерживается) и, по желанию, в name.

Это единственное изменение данных, которое рисует дерево: `group`-рамка с label эпика
оборачивает его stories, вложенность «epic → его stories» становится визуальной.

Обновляем описание в `type-epics.md` (правило «group: shared label» → «group: parent epic id»)
и примеры в schema. Промпт `epics_agent.yaml` формулировку не меняет (всё в референсе), но
добавляем одну строку-напоминание про `group`=родитель.

### Часть 2 — Фронт: вложенные GroupFrame (вложенность уже поддержана)

Файл: `web/src/` (проверить существующий рендер вложенных групп).

`group` уже рендерится через `GroupFrame` (фоновый прямоугольник вокруг своих members).
Единственное, что нужно проверить/доработать — **вложенность** group-рамок:

- `settings` (домен, верхний уровень) содержит эпик `EP-3` → который содержит stories `EP-3-01`/`EP-3-02`.
- Раньше (в текущем `projection.json`) group-рамки были плоскими: `settings`, `planning`, `platform`,
  `EP-3`. Нужно, чтобы `EP-3` рисовалась **внутри** `settings`.
- `CanvasDocView` уже резолвит members по `group_id` и рисует GroupFrame; проверяем, что
  родительская рамка охватывает дочернюю (а не перекрывается с ней на плоскости).

Если вложенность уже поддерживается — часть 2 это только e2e-тест и, возможно, мелкая правка
z-index/размера родительской рамки. Если нет — небольшая доработка `GroupFrame` (расчёт rect по
bounds дочерних рамок).

### Часть 3 — Резолвер не трогаем; добавляем тесты

Резолвер `_resolve_epics` → `resolve_diagram` уже пассирует `group` насквозь (`_groups_of` собирает
все строковые `group`). Менять резолвер не нужно — он уже вернёт вложенные группы, когда skill
начнёт их авторить.

Добавляем:
- Юнит-тест `epics.json`-фикстуры: story имеет `group`=родительский id; id уникальны.
- Тест что `reshape()`/`graph_to_ops` прогоняет story в родительскую GroupFrame.
- E2e-проверка: боксы stories лежат внутри рамки своего эпика.
- Регенерировать `epics.json` под новый формат (запустить скилл или вручную поправить дату).

### Часть 4 — Жёсткая структура: запрет перетаскивания блоков

Файлы: `web/src/canvas/doc/CanvasNodeBox.tsx`, `elementRules.ts`, `useDragOffset.ts`, `CanvasDocView.tsx`.

Требование: **блоки epic-дерева нельзя двигать** — всё лежит в заранее структурированных рамках.

- Вводим в `elementRules.ts`/`BlockRule` флаг жёсткой раскладки (например `lockedLayout?: boolean`),
  по умолчанию `false` для всех рендер-видов; у `epic` (и, если понадобится, `group`) ставим `true`.
- `CanvasNodeBox`/`useDragOffset` при `lockedLayout: true` не инициализируют drag:
  ни solo-перетаскивание, ни group-drag, ни collision-сдвиг соседей не применяются.
- Позиция берётся только из авто-раскладки (`autoLayout`/`layerPositionCache`) и фит-лупа;
  пользователь не пишет позиции в `canvas.json` для этих элементов.
- Рамки (`GroupFrame`) тоже фиксированы: их rect — производный bounds членов, не перетаскиваются.

Это изолировано от остального холста: обычные (не-epic) блоки продолжают драг-перетаскиваться как раньше.

### Часть 5 — Клик по блоку → полный текст в правом меню

Файлы: `web/src/canvas/doc/CanvasNodeBox.tsx`, `canvas/InspectorPanel.tsx` (+ возможно
`descriptionPopupStore`/`CodePopup`).

Требование: по клику на блок в правом меню показывается полный текст блока.

- Сейчас у epic-бокса `activation: "epic-brief"` — клик открывает AI brief панель, а не правый инспектор.
- Делаем двухпозиционную активацию для epic/story блоков:
  1. правый инспектор (`InspectorPanel`) показывает полный текст блока — summary, acceptance criteria,
     описание, ссылки (берём из `WorkItem` по `meta.recipe_key`);
  2. сохраняем доступ к AI brief отдельно (кнопка/бейдж внутри инспектора), не конфликтуя с деревом.
- Для story/task используем тот же инспектор, но без epic-brief (обычный `inspector` путь или
  description-popup — по данным блока).
- Tasks-блоки (сворачиваемые) раскрытие делают in-place; текст задачи доступен и в правом меню.

## Что НЕ делаем (границы)

- Не возвращаем старый box-graph-вид с criteria/artifacts внутри бокса — остаётся за кликом → инспектор/AI brief.
- Не возвращаем `epics_index`-роут / клиентский portfolio index.
- Не добавляем drag-редактирование позиций epic-элементов (жёсткая раскладка, Часть 4).

## Файлы

| Файл | Действие |
|---|---|
| `.claude/skills/codechroma-draw-diagram/references/type-epics.md` | правило `group`=родитель, примеры |
| `prompts/epics_agent.yaml` | строка-напоминание про `group`=родитель |
| `web/src/canvas/doc/GroupFrame.tsx` / `CanvasDocView.tsx` | вложенность рамок (проверить/доработать) |
| `web/src/canvas/doc/CanvasNodeBox.tsx` / `elementRules.ts` / `useDragOffset.ts` | жёсткая раскладка (Часть 4) |
| `web/src/canvas/InspectorPanel.tsx` / `CanvasNodeBox.tsx` | полный текст в правом меню (Часть 5) |
| `.codechroma/diagrams/epics/epics.json` | регенерировать под новое правило |
| `tests/` + `web/` e2e | тесты на дерево epic→story |
| `docs/architecture/epics-view.md` | синхронизировать (правило группировки, lockedLayout) |

## Проверка

- `poetry run pytest tests/unit tests/contract tests/integration`
- `npm test` + `npm run e2e`
- Софт-диагностика `check_diagram.py --kind epics` без новых ISLAND/ORPHAN.
- Визуально: epic-рамка содержит свои story-рамки, стрелки только cross-epic.
