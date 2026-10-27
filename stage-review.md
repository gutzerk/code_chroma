# Stage branch review — dead code, design patterns, architectural misalignment

- **Scope:** `git diff origin/main origin/stage` (116 files, +6258 / −2468). `origin/main` (3a4b664) is the merge-base. The local `stage` ref is 145 commits behind `origin/stage` and was not used.
- **Date:** 2026-10-23
- **Method:** the diff was split into 5 areas, each reviewed in parallel by a read-only subagent. Line numbers refer to the `origin/stage` version of each file. The two top findings (A-question `agent_id` stamping, workflow token scope) were re-verified by hand.

## Summary

| Part | Area | High | Medium | Low |
|---|---|---|---|---|
| A | Python agent-questions backend, skills, hooks | 2 | 4 | 12 |
| B | Web question UI + engine client | 2 | 3 | 9 |
| C | Workflows web UI | 1 | 5 | 10 |
| D | Agents activity panel, canvas layout & style | 0 | 8 | 12 |
| E | Model catalog, LLM settings, desktop updater, issue routes | 0 | 5 | 7 |

### Fix first

1. **B1:** terminal questions never reach real agents. The MCP server never sets `meta.agent_id`.
2. **C1:** workflow dialog buttons lose all colours, because the `--wf-*` tokens are scoped to `.workflows-tab` and the modals are portalled to `body`.
3. **A1 / A2:** `find_diagram_requested` hijacks unrelated cards, and `reask` leaves a stale label and stale `degraded` meta.
4. **B2:** the question selection is duplicated, so the diagram tab and the answer that gets sent can disagree.
5. **C2:** Escape in a nested confirm also closes the workflow editor.

### Cross-cutting themes

- **Python ↔ C# parity drift:**
  - The decision-diagram skill is synced by the C# bridge, which has no `/mcp` (A4).
  - `NonDiagramLayers` is missing `questions`/`decisions` (A4).
  - The issue route hardening exists in C# only (E3).
  - The static model lists are hand-copied (E1).
- **Same values defined in two places:**
  - Panel geometry is in both CSS and `layoutMetrics.ts` (D12).
  - The `--wf-*` hex values are repeated in `WorkflowEditorDialog.css` (C6).
  - The activity panel CSS hard-codes hex colours (D13).
- **Docs drift:**
  - `ai-questions.md` still says phases 3 and 4 are not done (A5, B13).
  - `workflows.md` cites constants that don't exist (C5).
  - `llm-settings.md` contradicts itself (E2).
  - `web-canvas-shell.md` and `parallel-agents.md` are stale (D17, D18).
- **One-line comment rule broken:** A15, E9, B14.
- **Arrange-Act-Assert breaks the hook doesn't catch:** A17, D19.

---

## Part A — Python agent-questions backend, skills, hooks

1. **High · Bug · `src/codechroma/questions/store.py:134-153`** (called from `mcp_server.py:124`)
   - `find_diagram_requested` falls back to "the only open diagram-requested card", so an unrelated `ask_user` (different session, different text) overwrites that card's options.
   - The test `test_find_diagram_requested_matches_a_reworded_ask_without_session` locks this behaviour in.
   - Although it's named `find_*`, it also marks older cards `skipped`, and it does so outside the canvas lock.

   *Fix:* match only on the same session (or the same text when there is no session), and drop the sole-card fallback. Move the stale-skip into `reask`, under one `canvas_lock`.
2. **High · Bug · `store.py:156-163`**
   - `reask` writes only `options/kind/diagram_requested/allow_*`, and meta is merged, so `label` keeps the old text.
   - A valid re-ask keeps stale `degraded` / `validation` keys.

   *Fix:* also write `label` and `session_id`/`total`, and always write `degraded`/`validation`.
3. **Medium · Dead code / Design · `models.py:36`, `mcp_server.py:144-145`, `bridge/routes/questions.py:62-75`**
   - `POST /questions/ask` and `AskRequest.degraded` have no non-test caller now that the hook stopped rerouting.
   - `degraded=True` is a caller-controlled switch that skips all validation.

   *Fix:* remove the flag and its branch, and remove the route or keep it as a test-only seam.
4. **Medium · Architecture (parity) · `dotnet/CodeChroma.Bridge/Agents/SkillSync.cs:18`**
   - The C# bridge syncs `codechroma-decision-diagram`, but it hosts no `/mcp`, so the skill tells agents to call tools that don't exist there.
   - C# `CanvasDocument.cs:195` `NonDiagramLayers` lacks `questions`/`decisions`, although the docs call it a mirror.

   *Fix:* gate the skill until C# hosts `/mcp`, and align the layer set.
5. **Medium · Docs drift · `docs/architecture/ai-questions.md`**
   - Lines 7-8 and 77 say phase 4 is not started.
   - Line 158 gives the wrong grill-skill path and says it is "not in `SKILL_NAMES`", but it is.
   - Line 167: the `store.draw_diagram` bullet is under the wrong section.
6. **Medium · Docs drift · `docs/planning/021-question-contract-and-diagrams.md`**
   - The decision table says the hook "keeps today's reroute", but the code fails open to the native dialog.
   - `docs/planning/README.md` doesn't index 020 or 021.
7. **Low · Dead config · `hooks/hooks.json`:** `"timeout": 600` was sized for the old 570 s reroute. The hook now does a 0.5 s probe; lower it to about 5-10 s.
8. **Low · Docs drift · `ai-questions.md:150`:** the hook also requires `CODECHROMA_BRIDGE_URL` and `CODECHROMA_WORKSPACE_ID` (`hook.py:46`), and the workspace id is otherwise unused.
9. **Low · Design · `store.py:182-187`:** `_next_band` reads the private `diagrams._BAND_H`. Expose a public helper or constant.
10. **Low · Design · `store.py:190-223`:** `draw_diagram` hand-builds a combined `BatchResult` from two `apply_batch` calls. That duplicates `_commit`, and it has an `assert` in production code. Add a multi-step `_commit` or an `apply_batches` helper.
11. **Low · Dead code · `questions/diagrams.py:42-43,115-116`:** the `title=None` branch is never used. Make `title: str` required.
12. **Low · Dead code · `validation.py:84-90`:** the return value of `RejectionTracker.record` is ignored by its only caller.
13. **Low · Design · `models.py` `QuestionResult.needs`, `diagrams.py:29` `DiagramNode.status`:** each has a single meaningful value. Use `Literal[...]`.
14. **Low · Config · `validation.py:10-13`, `diagrams.py:11-15`:** `max_rejections` moved to `QuestionsConfig`, but the related reset window and tracker cap are still hard-coded constants.
15. **Low · Convention · `mcp_server.py:222-226`:** `_draw_option_diagram_tool` has a multi-line docstring. Pass the text as the tool `description=` instead.
16. **Low · Contract drift:**
    - The grill skill says "2-3 options", while the server and the hook say 2-4.
    - `_INSTRUCTIONS` demands unique ranks, but `validate_ask` accepts `rank=None`.
17. **Low · Tests (AAA) · `tests/unit/test_question_validation.py:106-110, 125-133`:** these tests alternate act and assert steps. Split them or parametrize.
18. **Low · Bug · `bridge/routes/questions.py:111-113`:**
    - A question with no options gets the wrong 422 message.
    - `store.request_diagram` reads `diagram_requests` outside the lock, so two concurrent clicks can lose a count.

*Acceptable:* the validator is duplicated between `diagrams.py` and `check_decision_diagram.py`. The skill script must stay standalone, and a parity test pins the two together.

---

## Part B — Web question UI + engine client

1. **High · Architecture/Bug · `src/codechroma/questions/mcp_server.py:199,204` ↔ `web/src/canvas/doc/question/useOpenAgentQuestions.ts:12`**
   - Terminal questions are selected by `meta.agent_id`, but the server never sets it from the authenticated token's workspace id.
   - The agent isn't told its id, so with real agents `AgentQuestionHost` and the LED "?" badge never fire. Only the mock `devAskQuestion` sets it.

   *Fix:* stamp `request.agent_id = workspace_id` server-side in `QuestionMcp.ask`, remove it from the tool arguments, and add a route test. *(Verified by hand.)*
2. **High · Bug / Duplicated state · `web/src/agents/AgentQuestionHost.tsx:23,60,81` + `QuestionCard.tsx:37,41-43`**
   - The selection lives in both the card and the host, and is synced one way only (card → host).
   - The diagram tabs change the host's selection, so the UI shows option 2's diagram while Send answers option 1.

   *Fix:* make the selection a controlled prop owned by the host, and delete the sync effect.
3. **Medium · Bug · `QuestionDiagram.tsx:44,113`:** "Open on canvas" uses `useCanvasFocus()`, but the panel renders outside the provider (`RootCanvas.tsx:522` vs `:560/:584`), so in B1 the click does nothing. Lift the provider or hide the button.
4. **Medium · Bug · `QuestionCard.tsx:37`:**
   - The selection is initialised only on mount, but `reask` replaces the options in place under the same element id.
   - A stale option id is then sent, the route returns 422, and the user sees a generic error.

   *Fix:* key the card on its option ids, or validate the selection before sending.
5. **Medium · Architecture / Dead code · `web/src/engine-client/EngineClientContext.tsx:5,46-49` + `devAskQuestion.ts`**
   - The engine-client port now imports a canvas UI module and test fixtures, which reverses the dependency direction.
   - A capturing `keydown` listener turns every Enter in an agent terminal into a demo question on the dev server with the mock bridge, which is also what Playwright runs against.
   - It sends `layer: "default"` but the op says `"questions"`.
   - It relies on dead-code elimination to stay out of production builds.

   *Fix:* make it a dev-only dynamic import, opt-in, with the layer fixed and the demo options moved out of `fixtures.ts`.
6. **Low · Dead code · `questionStrings.ts:5,10,26-31,38`:** `askHint` (new), `decisionRecorded`, `tierBest/Middle/Last`, `pro`, `con`, `linkedDiagram` and `changeAnswer` are unused.
7. **Low · Dead export · `pickQuestionLayout.ts:3-4`:** `B1_MIN_WIDTH` and `A4_MIN_WIDTH` are exported, but the tests hard-code 1100 and 880.
8. **Low · Design · `AgentQuestionHost.tsx:27` + `ConnectedQuestionCard.tsx:25`:** `toQuestionView` runs twice per render. Compute it once and pass it down.
9. **Low · Bug · `QuestionCard.tsx:86-89`:** Esc skips even while `busy`, so it can send several skip requests. Guard it with `!busy`.
10. **Low · Design · `QuestionDiagram.tsx:66-71`:** the fit scale isn't recomputed when the pane is resized. Use a `ResizeObserver`.
11. **Low · Wire drift · `questionAdapter.ts:45-49` vs `routes/questions.py:34-36`:**
    - `QuestionAck` drops `waiting`.
    - The mock's `requestQuestionDiagram` (`mockBridge.ts:1790`) skips the route's 422 and 409 checks.
12. **Low · Bug · `web/src/agents/AgentLed.tsx:20`:** the label is always `questionCount(1)`. *(Also reported as D2.)*
13. **Low · Docs drift:**
    - `ai-questions.md:7,77` has a stale phase status, and the doc doesn't say who sets `agent_id`.
    - `web-engine-client.md` lacks `requestQuestionDiagram`.
14. **Low · Convention · `diagramCatalog.ts:42-44`, `QuestionElement.tsx:10-11`:** these are multi-line doc comments.

---

## Part C — Workflows web UI

1. **High · Bug (regression) · `web/src/workflows/workflows.css:2-16`**
   - The `--wf-*` tokens are declared only on `.workflows-tab`.
   - `.wf-btn*` and `.wf-menu-*` use them with no fallback.
   - `ModalDialog` portals to `document.body`, so ConfirmDialog, RunWorkflowDialog and RenameDialog render with transparent backgrounds and no primary or danger colours.

   *Fix:* move the tokens to `:root`, or add the dialog selectors to the token block. *(Verified by hand.)*
2. **Medium · Bug · `WorkflowEditorDialog.tsx:372, 718-735`:**
   - A nested ConfirmDialog and the editor modal both listen for Escape in the capture phase on `document`.
   - Escape on "Delete workflow" also runs the editor's `requestClose`.

   *Fix:* add a modal stack (only the topmost modal handles keys) or call `stopImmediatePropagation`.
3. **Medium · Bug · `AllWorkflows.tsx:24`:**
   - "Last run" is taken as `own[own.length - 1]`.
   - The bridge orders runs by file name, and run ids are `run-<guid>`, so the order is random.

   *Fix:* add `createdAt` to `Run` on the bridge and sort by it.
4. **Medium · Design · `WorkflowEditorDialog.tsx:308-326, 319, 338`:**
   - The editor calls the client directly and duplicates `workflowActions.createWorkflow`/`updateWorkflow`.
   - It detects failure by reading `workflowStore.getError()` afterwards, which is racy and shows the error twice.

   *Fix:* have `steer`/`mutate` return a result or rethrow, and use the store actions.
5. **Medium · Docs drift · `docs/architecture/workflows.md:6`:** cites `CONTEXT_WARN_RATIO` and `CONTEXT_WINDOW_TOKENS`, which don't exist. The badge actually uses `chainWarning ?? n > CHAIN_WARN_STEPS`.
6. **Medium · Design · `WorkflowEditorDialog.css`:**
   - It has 101 hex literals and no `var()`; they duplicate the `--wf-*` values (a workaround for C1).
   - It defines a second button system (`.wfe-*`, lines 637-686) and a second focus ring.

   *Fix:* switch to the tokens once C1 is fixed, and add `--wf-teal` for `#2dd4bf`.
7. **Low · Dead code · `WorkflowEditorDialog.tsx:161,703,708`:** no caller passes the `runAfterSave` prop.
8. **Low · Dead code · `runControls.ts:29` `KIND_META`, `:220` `finishedCount`:** both are unused.
9. **Low · Duplication:**
    - `stepSummary` (`AllWorkflows.tsx:11`) duplicates the editor's `summary` (`:137`).
    - `connector()` (`:125`) repeats the branching in `betweenLabel` (`runControls.ts:129`).
    - The delete-run confirm text is copied in `RunsList.tsx:196` and `RunDetail.tsx:308`; add `CONFIRM_MESSAGES.deleteRun`.
10. **Low · Architecture · `RunDetail.tsx:159,235`:** "Stop after step" is disabled while paused, but `RunStateMachine.cs` allows `(Paused, StopAfter)`. Add a `canStopAfter` helper.
11. **Low · UX · `WorkflowEditorDialog.tsx:313-316`:** "Save and run" on a workflow with inputs says "start it from the Workflows tab", but the user is already there. Open the run dialog instead.
12. **Low · Inconsistency · `runControls.ts:143` vs `:172`:** `stepMode` labels step 1 "hand-off", while the rail and the editor force "new".
13. **Low · Design · `RunDetail.tsx:120-123`:** an effect resets derived state (`pickedFrom`). Key that state by proposal instead.
14. **Low · Docs drift · `workflows.md:6`:** references `Desktop/chroma/design/workflow`, a local folder outside the repo.
15. **Low · Stale tests:**
    - The `RunsList.test.tsx` setup builds an unused `actions.stop` mock.
    - An absence test pins a testid that was removed.
    - Search and Duplicate are tested in both `AllWorkflows.test.tsx` and `WorkflowsTab.test.tsx`.
16. **Low · Dead export · `RunsList.tsx:17` `SegmentBar`:** it's only used locally now.

*Clean:* no unreferenced CSS selectors, all store getters and setters are used, run states and commands match `RunStateMachine.cs`, and there are no multi-line comments.

---

## Part D — Agents activity panel, canvas layout & style

1. **Medium · Bug · `web/src/agents/ActivityPanel.css:273-284`:**
   - The `.activity-ghost` rules are overridden by the later `.activity-icon-btn` rules, which have the same specificity.
   - Ghost buttons therefore render raised, at 32px with an 8px radius.

   *Fix:* reorder the rules, or use `.activity-icon-btn.activity-ghost`.
2. **Low · Bug · `web/src/agents/AgentLed.tsx:20`:** the label always says "1 question". *(Same as B12.)*
3. **Medium · Dead code · `activity/AgentSwitcherRow.tsx:79-80` + `ActivityPanel.tsx:161`:**
   - In full mode the row renders only an empty 40px spacer.
   - Don't render the row in full mode; then drop the `full` prop, the spacer and the grid rule.
4. **Medium · Dead code · `ActivityPanel.tsx:43-44`:** the `isFull` branches of `maxViewportFraction`/`onExceedMax` are unreachable, because the resize handle exists only in normal mode.
5. **Medium · Dead code · `ActivityPanel.tsx:52-53`:**
   - The inline `flexBasis` does nothing on an absolutely positioned panel.
   - The comment at line 21 says "Attached panel", but the panel is floating.
6. **Medium · Dead code · `web/src/canvas/layout/layoutMetrics.ts:62`:**
   - `agentsWideWidth(full=false)` is reached only by tests; the real path is untested.
   - It passes a made-up `agentsMode: "normal"` just to read one value.
7. **Medium · Dead code · `web/src/canvas/leftpanel/LeftPanel.css:5`:**
   - Nothing reads `--terminal-height` any more.
   - `TerminalPanel.tsx:38-45` still runs a ResizeObserver to set it.
8. **Low · Dead code · `web/src/styles.css:45`:** `--bg-track` is now unused, replaced by a literal `#1a1e27`.
9. **Low · Dead code:**
    - The `styles.css` `.question-hint` rule is unused.
    - `ActivityPanel.css:117-150` (`workflow-builder-*`, `workflow-field-error`) and `:613-623` (`.agent-stop-button`) are unused.
10. **Low · Dead code · `AgentLed.tsx:18-19`:** `agentId` is optional, but all six callers pass it. Make it required.
11. **Medium · Design · `activity/usePanelSize.ts:9-28`:**
    - It nearly duplicates `workflows/useContainerLayout.ts`.
    - The panel now runs 3 or 4 width mechanisms: `useResizableSize`, `usePanelSize`, `useStretchWidth`, and the workflows observer.

    *Fix:* one `useElementLayout` hook, or pass `data-size` down.
12. **Medium · Design / Architecture · `ActivityPanel.css:4-7,30` vs `layoutMetrics.ts:19-25`, `usePanelSize.ts:6`:**
    - The panel geometry is duplicated in CSS and TS: 400/424, 52/68, padding 12/24, the `right` inset, and 340 vs `minWidth: 320`.
    - `12px` hard-codes `--chrome-inset`.
    - This breaks "layoutMetrics is the one source"; export the values through `LAYOUT_CSS_VARS`.
13. **Low · Design · `ActivityPanel.css:165-284`:**
    - It has many hard-coded hex colours; `#1a1e27` is `--question-surface`.
    - `.question-title` in `styles.css` still has a literal `#e3d5f3`.
14. **Low · Design · `activity/useStretchWidth.ts:13`:**
    - It finds its measurement box with `closest(".canvas-area")`, which couples it to another component's class name.
    - On the first full-mode render the width is null, so the panel paints at 400px for a frame. Have `RootCanvas` provide the width instead.
15. **Low · Design · `ActivityPanel.tsx:103-113` + `PanelModeActions.tsx:19`:** normal mode has two collapse buttons with different labels.
16. **Low · Design · `canvas-style/CanvasStylePanel.tsx:129`:** the draft is seeded once, so an outside store change makes it stale. Re-seed it when it isn't dirty.
17. **Low · Docs drift · `docs/architecture/web-canvas-shell.md`:**
    - Line 529 references `useFullScreenAgentId.ts`, which no longer exists.
    - Line 4 says "Workflows N", but the tab now shows unfinished runs.
    - Line 6 describes the switcher row incorrectly.
18. **Low · Docs drift · `docs/architecture/parallel-agents.md:481-487`:** the full-mode span and the "single collapse control" text are stale.
19. **Low · Tests (AAA) · `ActivityPanel.test.tsx:85-92`, `CanvasStylePanel.test.tsx:55-65`:**
    - Both go assert → act → assert.
    - The ActivityPanel test's name doesn't match what it asserts.
20. **Low · Test coverage · `layoutStore.test.ts:28-35`:** `openLeft(tab)` in full mode lost its coverage after the rename.

---

## Part E — Model catalog, LLM settings, desktop updater, issue routes

1. **Medium · Design / Parity · `src/codechroma/llm/model_catalog.py:21-30` ↔ `dotnet/CodeChroma.Bridge/Stores/ModelCatalog.cs:41-51`:**
   - The static model lists are hand-copied, and a third copy is in `Agents/ModelSpecs.cs:18`.
   - There are no C# `ModelCatalog` tests.

   *Fix:* move the list into one data file, or at least add a parity test.
2. **Medium · Docs drift · `docs/architecture/llm-settings.md:298, 304-311, 340-342, 483-485`:**
   - The doc says both "Unsupported when base_url/key missing" and "now returns `static: true`".
   - The route docstring (`routes/llm_settings.py:97`) and the C# summary (`ModelCatalog.cs:5`) still say "queried live".
3. **Medium · Parity drift · `dotnet/CodeChroma.Bridge/Routes/IssueRoutes.cs:29-32,49-81` vs `src/codechroma/bridge/routes/issues.py:68`:** the C# route has `GH_PROMPT_DISABLED`, closes stdin and surfaces stderr; the Python route doesn't.
4. **Medium · Duplication · `IssueRoutes.cs:49` vs `Agents/GitSupport.cs:111` `Gh.Run`:**
   - The two `gh` process runners are near-copies, and the new hardening went into only one, so agent PR publishing can still hang on a `gh` prompt.
   - The `IssueRoutes` copy lacks `StandardErrorEncoding = UTF8`.
5. **Medium · Bug · `dotnet/CodeChroma.Shell.App/UpdateHost.cs:39-43`:**
   - The unconditional `Environment.Exit(0)` 10 s after quitting can kill `ShutdownAsync` partway through.
   - On POSIX, child processes then leak.

   *Fix:* cancel the timer once shutdown finishes.
6. **Low · Bug · `UpdateScripts.cs:65,171` + `Dialogs.cs:52`:** `updated ok` is written before the health check, so "started cleanly" can be shown and then the update rolled back.
7. **Low · Design · `Dialogs.cs:46-75`:** the dialog switches on raw `"updated"`, `"rolled-back"` and `"ok"` strings and ignores `InstallOutcome`. Its copy lives in the host, not in `UpdateConstants`.
8. **Low · Dead code · `Dialogs.cs:10`:** no caller passes the `okText` parameter.
9. **Low · Convention · `model_catalog.py:39-42`:** `fetch_models` has a multi-line docstring.
10. **Low · Design · `model_catalog.py:44-56` / `ModelCatalog.cs:20-29`:** a provider with a missing key or URL now looks supported, so the misconfiguration isn't shown. Add a `reason` and show it in `CallSitesSection.tsx:129-135`.
11. **Low · Stale fixture · `tests/unit/test_llm_model_catalog.py:30`:** the `cli_codex_adapter` case passes a leftover `base_url`.
12. **Low · Docs drift (adjacent) · `CLAUDE.md:134`:** the report-issue row says "no API/token", but it posts through the user's `gh` login and only falls back to a link.

*Verified OK:* the assistant-settings / llm-settings separation is intact, Python and C# catalog behaviour match, and the `llmSettingsClient.ts` `static` field matches the bridge payload.
