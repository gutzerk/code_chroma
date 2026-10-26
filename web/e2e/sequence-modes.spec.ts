import { test, expect } from "@playwright/test";
import { gotoApp } from "./helpers";

test("a sequence diagram flips Readable <-> Focus in place with no reload or console error", async ({ page }) => {
  const errors: string[] = [];
  page.on("console", (msg) => msg.type() === "error" && errors.push(msg.text()));
  page.on("pageerror", (err) => errors.push(err.message));
  await gotoApp(page, { files: false });
  await page.evaluate(async () => {
    const path = "/src/canvas/doc/canvasDocStore.ts";
    const { canvasDocStore } = await import(/* @vite-ignore */ path);
    const doc = canvasDocStore.getDoc();
    const base = { render: "sequence", layer: "sequence", description: "", node_id: null, size: null, group_id: null, created_by: "ai" };
    const phases = [{ id: "p1", name: "Prepare", kind: "prepare", from_order: 1, to_order: 2 }];
    const el = (id: string, label: string, x: number, y: number, meta: object) => [id, { ...base, id, label, position: { x: x + 400, y: y + 300 }, meta }];
    canvasDocStore.setDoc({
      ...doc,
      elements: Object.fromEntries([
        el("client", "Client", 130, 36, { role: "participant", recipe_key: "client", phases }),
        el("api", "API", 390, 36, { role: "participant", recipe_key: "api" }),
        el("m1", "POST /go", 260, 90, { role: "message", from: "client", to: "api", order: "1" }),
        el("m2", "200 OK", 260, 148, { role: "message", from: "api", to: "client", order: "2", return: true }),
        el("m3", "done", 260, 206, { role: "message", from: "client", to: "api", order: "3", hero: true }),
      ]),
    });
  });
  await page.evaluate(() => (window as unknown as { __marker: number }).__marker = 1);

  await expect(page.getByTestId("sequence-diagram")).toHaveAttribute("data-mode", "readable");
  await page.getByRole("button", { name: "Focus", exact: true }).click();
  await expect(page.getByTestId("sequence-diagram")).toHaveAttribute("data-mode", "focus");
  await page.getByTestId("sequence-phase-row").click();
  await expect(page.getByTestId("sequence-message")).toHaveCount(1);
  await page.getByRole("button", { name: "Readable", exact: true }).click();
  await expect(page.getByTestId("sequence-message")).toHaveCount(3);
  await page.getByTestId("sequence-play").click();
  await expect(page.locator(".sequence-message--active")).toHaveCount(1);

  expect(await page.evaluate(() => (window as unknown as { __marker: number }).__marker)).toBe(1);
  expect(errors.filter((e) => !/bridge|Not implemented/.test(e))).toEqual([]);
});
