import { defineConfig } from '@playwright/test'

export default defineConfig({
    testDir: './e2e',
    testMatch: 'harness-ui.spec.ts',
    outputDir: './node_modules/.cache/harness-playwright',
    workers: 1,
    timeout: 90_000,
    expect: { timeout: 15_000 },
    reporter: 'list',
    use: {
        baseURL: 'http://127.0.0.1:5198',
        launchOptions: process.env.PLAYWRIGHT_CHROME_PATH
            ? { executablePath: process.env.PLAYWRIGHT_CHROME_PATH }
            : undefined,
    },
    webServer: {
        command: 'node node_modules/vite/bin/vite.js --host 127.0.0.1 --port 5198 --strictPort',
        url: 'http://127.0.0.1:5198/e2e-fixtures/harness-ui-fixture.html',
        reuseExistingServer: false,
    },
})
