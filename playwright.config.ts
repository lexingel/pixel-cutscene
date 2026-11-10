import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./test/e2e",
  // channel "chrome": the bundled Chromium 1140 fails to start on the dev machine (Windows side-by-side error)
  use: { channel: "chrome", baseURL: "http://localhost:5179", viewport: { width: 1280, height: 800 } },
  webServer: { command: "npx vite --port 5179 --strictPort", url: "http://localhost:5179", reuseExistingServer: true },
});
