import { test, expect } from "@playwright/test";
import { clickBlockName, gotoApp } from "./helpers";

// root -> folder -> folder -> folder -> file: expanding in place never navigates (FR-002-FR-004),
// and every ancestor along the path stays expanded simultaneously (FR-003, FR-004).
test("expands in place from root down to a leaf with no navigation", async ({ page }) => {
  await gotoApp(page);
  const urlBefore = page.url();

  await clickBlockName(page, "examples"); // root folder
  await clickBlockName(page, "shadow-app"); // folder
  await clickBlockName(page, "backend"); // folder
  await clickBlockName(page, "clients"); // folder

  expect(page.url()).toBe(urlBefore);
  await expect(
    page.locator('[data-node-id="file::shadow-app/backend/clients/email_client.py"]'),
  ).toBeVisible();

  for (const nodeId of [
    "root",
    "folder::shadow-app",
    "folder::shadow-app/backend",
    "folder::shadow-app/backend/clients",
  ]) {
    await expect(page.locator(`[data-node-id="${nodeId}"]`)).toHaveAttribute(
      "data-expand-state",
      "expanded",
    );
  }

  // A file is no longer a leaf — it opens onto its own symbols. What this spec is actually about
  // still holds there: the expansion happens in place, so the URL is untouched and every ancestor
  // above it stays open.
  await clickBlockName(page, "email_client.py");
  await expect(
    page.locator('[data-node-id="file::shadow-app/backend/clients/email_client.py"]'),
  ).toHaveAttribute("data-expand-state", "expanded");
  expect(page.url()).toBe(urlBefore);
  await expect(
    page.locator('[data-node-id="folder::shadow-app/backend/clients"]'),
  ).toHaveAttribute("data-expand-state", "expanded");
});
