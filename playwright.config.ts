import { defineConfig, devices } from '@playwright/test';

/**
 * Playwright configuration for E2E testing of P2P functionality
 * 
 * This configuration enables testing across multiple browser contexts
 * to simulate different users/machines connecting via P2P.
 */
export default defineConfig({
  testDir: './e2e',
  
  // Maximum time one test can run
  timeout: 120 * 1000, // 2 minutes (P2P connections can be slow)
  
  // Run tests in files in parallel
  fullyParallel: false, // P2P tests need sequential execution
  
  // Fail the build on CI if you accidentally left test.only
  forbidOnly: !!process.env.CI,
  
  // Retry on CI only
  retries: process.env.CI ? 2 : 0,
  
  // Opt out of parallel tests on CI
  workers: process.env.CI ? 1 : 1, // P2P tests work better sequentially
  
  // Reporter to use
  reporter: [
    ['html'],
    ['list'],
    ['json', { outputFile: 'e2e/test-results.json' }]
  ],
  
  // Shared settings for all the projects below
  use: {
    // Base URL to use in actions like `await page.goto('/')`
    baseURL: 'http://localhost:3099',
    
    // Collect trace when retrying the failed test
    trace: 'on-first-retry',
    
    // Screenshot on failure
    screenshot: 'only-on-failure',
    
    // Video on failure
    video: 'retain-on-failure',
    
    // Allow permissions needed for P2P
    permissions: ['clipboard-read', 'clipboard-write'],
    
    // Longer action timeout for P2P operations
    actionTimeout: 30 * 1000,
  },
  
  // Configure projects for major browsers
  projects: [
    {
      name: 'chromium',
      use: { 
        ...devices['Desktop Chrome'],
        // Enable WebRTC and related features
        launchOptions: {
          // Allow pointing at a preinstalled browser (e.g. in sandboxed CI containers)
          ...(process.env.PLAYWRIGHT_CHROMIUM_PATH
            ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_PATH }
            : {}),
          args: [
            '--use-fake-ui-for-media-stream',
            '--use-fake-device-for-media-stream',
            '--disable-web-security', // For local testing only
          ],
        },
      },
    },
    
    // Uncomment to test with Firefox
    // {
    //   name: 'firefox',
    //   use: { 
    //     ...devices['Desktop Firefox'],
    //   },
    // },
    
    // Uncomment to test with WebKit (Safari)
    // {
    //   name: 'webkit',
    //   use: { ...devices['Desktop Safari'] },
    // },
  ],
  
  // Run your local dev servers before starting the tests: the app, and the old
  // address's hand-off page on another origin (e2e/handoff.spec.ts, spec HO-3…HO-7).
  // In dev builds each defaults to the other's address (src/handoff/origins.ts).
  webServer: [
    {
      command: 'yarn start --port 3099 --strictPort',
      url: 'http://localhost:3099',
      timeout: 120 * 1000,
      reuseExistingServer: !process.env.CI,
      stdout: 'pipe',
      stderr: 'pipe',
    },
    {
      command: 'yarn start:handoff --port 3098 --strictPort',
      url: 'http://127.0.0.1:3098',
      timeout: 120 * 1000,
      reuseExistingServer: !process.env.CI,
      stdout: 'pipe',
      stderr: 'pipe',
    },
  ],
});
