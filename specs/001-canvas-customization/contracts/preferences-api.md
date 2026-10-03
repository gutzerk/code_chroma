# Contract: Canvas Preferences API

**Feature**: [spec.md](../spec.md) | **Type**: HTTP (bridge backend, FastAPI)

Persistence contract following the existing `llm-settings` pattern
(`web/src/llm-settings/llmSettingsClient.ts` → `bridgeRequest`, `jsonInit`).

## Endpoints

### GET /preferences/canvas

Returns the current canvas appearance preferences.

**Response `200`**:
```json
{
  "background_color": "#1b1d23",
  "block_style": "default",
  "arrow_color": null,
  "element_limit": 400
}
```
`null` or omitted fields mean "use the sane default". `element_limit` is `>= 1`.

### PUT /preferences/canvas

Persists the canvas appearance preferences. Updates are atomic; the whole object is the
payload.

**Request body** (partial allowed — omitted fields revert to defaults):
```json
{
  "background_color": "#0d1117",
  "block_style": "high-contrast",
  "arrow_color": "#7ee09b",
  "element_limit": 250
}
```

**Response `200`**: the saved preferences object (same shape as GET).

**Validation**:
- `background_color`, `arrow_color`: valid hex color (`#RGB`/`#RRGGBB`) or `null`.
- `block_style`: one of `"default" | "minimal" | "high-contrast"`, else `400`.
- `element_limit`: integer `>= 1`, else `400`.

## Client shape (SPA)

```ts
interface CanvasPreferences {
  background_color: string | null;
  block_style: "default" | "minimal" | "high-contrast";
  arrow_color: string | null;
  element_limit: number | null;
}
getCanvasPreferences(): Promise<CanvasPreferences>
putCanvasPreferences(prefs: Partial<CanvasPreferences>): Promise<CanvasPreferences>
```

Errors surface via the existing `bridgeRequest` error handling; a failed read at load
falls back to defaults (spec FR-010).
