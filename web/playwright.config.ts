import { defineConfig, devices } from "@playwright/test";

// Overridable so e2e can boot its own mock-backed dev server even while a developer's live
// (bridge-connected) server occupies the default port — real repo data would break the fixtures.
const PORT = process.env.E2E_PORT ?? "5173";

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  reporter: "list",
  use: {
    baseURL: `http://localhost:${PORT}`,
    trace: "on-first-retry",
  },
  webServer: {
    command: `npm run dev -- --port ${PORT} --strictPort`,
    url: `http://localhost:${PORT}`,
    reuseExistingServer: !process.env.CI,
  },
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"] } },
  ],
});
