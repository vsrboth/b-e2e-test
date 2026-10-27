import { defineConfig, devices } from '@playwright/test'
import dotenv from 'dotenv'

dotenv.config()

const baseURL = process.env.BASE_URL
if (!baseURL) throw new Error('BASE_URL is not set. Copy .env.example to .env and fill it in.')

const httpCredentials = process.env.E2E_BASIC_AUTH_USER
  ? { username: process.env.E2E_BASIC_AUTH_USER, password: process.env.E2E_BASIC_AUTH_PASSWORD ?? '' }
  : undefined

export const AUTH_FILE = 'playwright/.auth/user.json'

export default defineConfig({
  testDir: './tests',
  timeout: 30_000,
  expect: { timeout: 7_000 },
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 2 : undefined,
  reporter: process.env.CI ? [['github'], ['html', { open: 'never' }]] : [['list'], ['html', { open: 'never' }]],
  use: {
    baseURL,
    httpCredentials,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
    // the customer upload flow asks for the camera; headless Chromium has none, so without a fake
    // device getUserMedia() fails and the app's own failure-cleanup path leaves it unable to save a
    // photo picked from the gallery either - see support/customer.ts for the full story.
    permissions: ['camera'],
    launchOptions: { args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'] }
  },
  projects: [
    // logs in once through the UI and stores the session
    { name: 'setup', testMatch: /auth\.setup\.ts/ },

    // pages that need a signed-in BackOffice user
    {
      name: 'app',
      testDir: './tests/app',
      use: { ...devices['Desktop Chrome'], viewport: { width: 1920, height: 1080 }, storageState: AUTH_FILE },
      dependencies: ['setup']
    },

    // anonymous visitors and customer-facing pages
    {
      name: 'guest',
      testDir: './tests/guest',
      use: { ...devices['Desktop Chrome'], viewport: { width: 1920, height: 1080 } }
    }
  ]
})
