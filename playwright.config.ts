import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: "./tests/e2e",
  workers: 1,
  timeout: 30000,
  use: {
    baseURL: "http://127.0.0.1:4179",
    channel: "chrome",
    viewport: { width: 1440, height: 1000 },
    acceptDownloads: true,
  },
  webServer: {
    command: "npm run dev -- --port 4179",
    url: "http://127.0.0.1:4179",
    reuseExistingServer: !process.env.CI,
    env: { MINDMAP_DATA_DIR: resolve(tmpdir(), "web-mindmap-e2e-data") },
  },
});
