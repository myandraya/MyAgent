import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  timeout: 45_000,
  fullyParallel: false,
  workers: 1,
  reporter: "line",
  use: {
    baseURL: "http://127.0.0.1:3100",
    channel: "chrome",
    headless: true,
    trace: "retain-on-failure"
  },
  webServer: {
    command: "DEEPSEEK_API_KEY=sk-placeholder-replace-me npm run dev -- --hostname 127.0.0.1 --port 3100",
    url: "http://127.0.0.1:3100",
    reuseExistingServer: false,
    timeout: 120_000
  },
  projects: [
    { name: "desktop-chrome", use: { viewport: { width: 1440, height: 900 } } },
    { name: "mobile-chrome", use: { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true } }
  ]
});
