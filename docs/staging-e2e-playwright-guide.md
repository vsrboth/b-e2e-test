# Staging E2E tests for the Bosch RideCare BackOffice: TypeScript + Playwright

A complete, copy-paste guide for building a **separate** end-to-end test project that runs against a deployed staging environment of the Bosch RideCare BackOffice (the Rails app in the `bosch` repository).

**Status of the code in this guide:** every file below was run, not just written. The suite type-checks with `tsc --noEmit` and was run against a local instance of the app (Rails test environment, throwaway database, mock prediction service):

- **Default run:** 83 tests pass, 5 are skipped (the opt-in tests, see section 7). Three consecutive runs, all green.
- **With every opt-in enabled:** 89 tests pass. Two consecutive runs, all green.

It has **not yet been run against your real staging environment.** The first run there may need small adjustments (see [Troubleshooting](#11-troubleshooting)). Section 12 lists exactly what was and was not verified locally.

---

## 1. Why a separate TypeScript + Playwright project

The `bosch` repository already has an in-process RSpec suite (Capybara driving Playwright). That suite relies on things that only exist inside the Rails process: FactoryBot, Warden's `login_as`, Timecop, the Sidekiq fake and transactional rollback. None of them exist on a deployed staging server, so a black-box suite is a different kind of test:

| | In-repo RSpec system specs | This project |
|---|---|---|
| Runs against | Rails booted in the test process | A deployed staging URL |
| Test data | FactoryBot, rolled back per test | The public API (OAuth), unique per run |
| Login | `login_as(user)` | Real login through the UI, session reused |
| Time and external services | Frozen / stubbed | Real |
| Counts toward SimpleCov 99% | Yes | No |
| Language | Ruby | TypeScript |

**Keep both.** The RSpec suite stays your fast regression and coverage suite; this project is the smoke and acceptance layer for staging.

---

## 2. Prerequisites

- **Node.js 20 or newer** (Playwright requires it).
- A **dedicated staging user** for the BackOffice UI (the default `adjuster` role is enough). Do not use a real person's account.
- An **account SID and secret key owned by that user** (`E2E_ACCOUNT_SID` / `E2E_SECRET_KEY`), exchanged for a short-lived bearer token via `POST /oauth/token` to create data through the API. The tests cache that token until it expires.
- The staging **base URL**, and HTTP basic-auth credentials if staging sits behind them.
- **A running background worker (Sidekiq) and working object storage (S3) on staging.** The assessment tests play the part of the prediction service: they deliver a result to the app, and the app processes it in a background job. Without a worker, those tests wait and then fail.
- Know whether staging has the **Pricing** menu. The app hides it only when `Rails.env.production?`. If your "staging" runs in production mode, skip the pricing tests (see section 11).

---

## 3. Create the project

```bash
mkdir bosch-e2e && cd bosch-e2e
git init
mkdir -p support tests/guest tests/app .github/workflows

# create every file from section 4 (same paths), then:
cp .env.example .env        # fill in your staging values
npm install
npx playwright install --with-deps chromium
npm run typecheck
npm run test:readonly       # safest first run: skips tests that upload files or create records
npm test
```

Commit `package-lock.json` (the CI workflow uses `npm ci`). `.env` is git-ignored.

---

## 4. Project files

Create each file at the path shown. File contents are exactly what was verified.

### `package.json`

```json
{
  "name": "bosch-e2e",
  "version": "1.0.0",
  "private": true,
  "description": "End-to-end tests for the Bosch RideCare BackOffice (staging)",
  "scripts": {
    "test": "playwright test",
    "test:headed": "playwright test --headed",
    "test:ui": "playwright test --ui",
    "test:readonly": "playwright test --grep-invert @writes",
    "report": "playwright show-report",
    "typecheck": "tsc --noEmit"
  },
  "devDependencies": {
    "@playwright/test": "^1.50.0",
    "@types/node": "^20.0.0",
    "dotenv": "^16.4.0",
    "typescript": "^5.5.0"
  },
  "engines": {
    "node": ">=20"
  }
}
```

### `tsconfig.json`

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "commonjs",
    "moduleResolution": "node",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "resolveJsonModule": true,
    "noEmit": true,
    "types": ["node"]
  },
  "include": ["**/*.ts"],
  "exclude": ["node_modules"]
}
```

### `.gitignore`

```text
node_modules/
test-results/
playwright-report/
playwright/.auth/
.env
```

### `.env.example`

```bash
# Base URL of the environment under test (no trailing slash)
BASE_URL=https://staging.example.com

# A dedicated staging user for the BackOffice UI (adjuster role is enough)
E2E_USER_EMAIL=e2e@example.com
E2E_USER_PASSWORD=change-me

# Account SID and secret key used to request a short-lived access token (POST /oauth/token)
# to create test data through the API
E2E_ACCOUNT_SID=change-me
E2E_SECRET_KEY=change-me

# Optional: HTTP basic auth in front of staging
# E2E_BASIC_AUTH_USER=
# E2E_BASIC_AUTH_PASSWORD=

# Optional: customer links that have ALREADY expired (comma separated), enables tests/guest/expired-links.spec.ts
# E2E_EXPIRED_PATHS=/damage_photo/baselines/<uuid>,/damage_photo/rentals/<uuid>

# Optional: set to true ONLY on an environment whose prediction service is a stub or sandbox.
# Enables tests/app/send-flow.spec.ts, which really "sends" photos for damage prediction.
# E2E_ALLOW_SEND=true
```

### `playwright.config.ts`

```ts
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
    video: 'retain-on-failure'
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
```

### `support/env.ts`

```ts
export function requireEnv(name: string): string {
  const value = process.env[name]
  if (!value) throw new Error(`Missing environment variable ${name}. See .env.example`)
  return value
}

export const credentials = {
  get email() { return requireEnv('E2E_USER_EMAIL') },
  get password() { return requireEnv('E2E_USER_PASSWORD') },
  get accountSid() { return requireEnv('E2E_ACCOUNT_SID') },
  get secretKey() { return requireEnv('E2E_SECRET_KEY') }
}

/** Unique, recognisable prefix so test data is easy to find and clean up on a shared environment. */
export function uniquePrefix(label = 'E2E'): string {
  const rand = Math.random().toString(36).slice(2, 7).toUpperCase()
  return `${label}-${Date.now().toString(36).toUpperCase()}-${rand}`
}

/**
 * A unique decimal used to find a pricing record in the table.
 * The app prints decimals without trailing zeros (925.00 -> "925.0"), so the last digit is never 0.
 */
export function uniqueCost(): string {
  const whole = 700 + Math.floor(Math.random() * 900)
  const tenths = Math.floor(Math.random() * 10)
  const hundredths = 1 + Math.floor(Math.random() * 9)
  return `${whole}.${tenths}${hundredths}`
}
```

### `support/api.ts`

```ts
import { APIRequestContext, expect, request } from '@playwright/test'
import { randomUUID } from 'node:crypto'
import { credentials } from './env'

export type RecordKind = 'baseline' | 'rental' | 'damage_event'

export interface CreatedRecord {
  kind: RecordKind
  vin: string
  /** relative path of the customer page, e.g. /damage_photo/baselines/<uuid> */
  customerPath: string
  uuid: string
}

const CALLBACK_URL = 'https://example.com/callback'

async function api(): Promise<APIRequestContext> {
  const httpCredentials = process.env.E2E_BASIC_AUTH_USER
    ? { username: process.env.E2E_BASIC_AUTH_USER, password: process.env.E2E_BASIC_AUTH_PASSWORD ?? '' }
    : undefined
  return request.newContext({ baseURL: process.env.BASE_URL, httpCredentials })
}

let cachedToken: { value: string; expiresAt: number } | undefined

/** Exchanges the account SID + secret key for a short-lived access token, caching it until it expires. */
export async function accessToken(): Promise<string> {
  if (cachedToken && cachedToken.expiresAt > Date.now()) {
    return cachedToken.value
  }
  const ctx = await api()
  const response = await ctx.post('/oauth/token', {
    data: { client_id: credentials.accountSid, client_secret: credentials.secretKey, grant_type: 'client_credentials' }
  })
  const text = await response.text()
  expect(response.status(), `POST /oauth/token -> ${text}`).toBe(200)
  await ctx.dispose()
  const json = JSON.parse(text)
  cachedToken = { value: json.access_token, expiresAt: Date.now() + (json.expires_in * 1000) - 5_000 }
  return cachedToken.value
}

async function post(path: string, body: object): Promise<any> {
  const ctx = await api()
  const response = await ctx.post(path, {
    data: body,
    headers: { Authorization: `Bearer ${await accessToken()}` }
  })
  const text = await response.text()
  expect(response.status(), `POST ${path} -> ${text}`).toBe(200)
  await ctx.dispose()
  return JSON.parse(text)
}

function toRecord(kind: RecordKind, vin: string, json: any): CreatedRecord {
  const customerPath = new URL(json.webApp.webUrl).pathname
  return { kind, vin, customerPath, uuid: customerPath.split('/').pop() as string }
}

export async function createBaseline(options: { vin: string; language?: string; company?: string; licensePlate?: string }): Promise<CreatedRecord> {
  const json = await post('/api/v1/baseline', {
    baseline: { vin: options.vin, callbackUrl: CALLBACK_URL, language: options.language ?? 'en', company: options.company, licensePlate: options.licensePlate }
  })
  return toRecord('baseline', options.vin, json)
}

export async function createRental(options: { vin: string; language?: string }): Promise<CreatedRecord> {
  const json = await post('/api/v1/rental', {
    rental: { rentalId: randomUUID(), vin: options.vin, timestamp: Date.now(), callbackUrl: CALLBACK_URL, language: options.language ?? 'en' }
  })
  return toRecord('rental', options.vin, json)
}

export async function createDamageEvent(options: { vin: string; location?: string; language?: string }): Promise<CreatedRecord> {
  const json = await post('/events/damage', {
    damageEvent: {
      messageId: randomUUID(),
      vin: options.vin,
      damageClass: 'A',
      location: options.location ?? 'loc_front',
      timestamp: Math.floor(Date.now() / 1000),
      callbackUrl: CALLBACK_URL,
      language: options.language ?? 'en'
    }
  })
  return toRecord('damage_event', options.vin, json)
}

export interface PredictionItem {
  carpart: string
  side_1: string
  side_2: string
  treatment: string
  /** one confidence per damage, same order */
  confidence: number[]
  /** [damage type, damage number] pairs */
  damage: [string, number][]
}

/**
 * Plays the part of the damage-prediction service: it delivers a result to the app's callback endpoint
 * (POST /damage_prediction/results, which is open to the service, no login). The app then turns the items
 * into assessments in a background job, so allow a moment before asserting on them.
 */
export async function deliverPredictionResult(record: CreatedRecord, items: PredictionItem[]): Promise<void> {
  const ctx = await api()
  const response = await ctx.post(`/damage_prediction/results?resource=${record.kind}&uuid=${record.uuid}`, {
    data: { payload: { items } }
  })
  expect(response.status(), `POST /damage_prediction/results -> ${await response.text()}`).toBe(200)
  await ctx.dispose()
}
```

### `support/pages.ts`

```ts
import { Page, expect } from '@playwright/test'

/** Text of the last flash message (the app renders them as [data-role=alert]). */
export async function flashMessage(page: Page): Promise<string> {
  const alert = page.locator('[data-role=alert]').last()
  await expect(alert).toBeVisible()
  return (await alert.innerText()).trim()
}

/** Waits until a flash message with exactly this text is shown (older messages may still be on screen). */
export async function expectFlash(page: Page, text: string) {
  await expect(page.locator('[data-role=alert]').filter({ hasText: new RegExp(`^\\s*${text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*$`) }).first()).toBeVisible()
}

/** Visible VIN values of an index table, in order (VIN is the 2nd column on baselines). */
export async function columnTexts(page: Page, column: number): Promise<string[]> {
  try {
    return await page.locator(`tbody tr td:nth-child(${column})`).allInnerTexts()
  } catch {
    return [] // the page was navigating (e.g. after clicking a sort link); callers poll until it settles
  }
}

export async function filterBy(page: Page, fields: Record<string, string>) {
  for (const [id, value] of Object.entries(fields)) {
    await page.locator(`#${id}`).fill(value)
  }
  await page.getByRole('button', { name: 'Filter' }).click()
}

/** Waits until the index heading shows the expected number of records, e.g. "Baselines - 2 records". */
export async function expectRecordCount(page: Page, title: string, count: number) {
  const noun = count === 1 ? 'record' : 'records'
  await expect(page.getByRole('heading', { name: `${title} - ${count} ${noun}`, exact: true })).toBeVisible()
}

/**
 * The API does not return numeric record ids, but some routes need them (/baselines/:id, /pdf?id=).
 * Find the record by its unique VIN on the index page and read the id from the row's link.
 */
export async function recordIdFromIndex(page: Page, indexPath: '/baselines' | '/rentals' | '/damage_events', vin: string): Promise<number> {
  await page.goto(`${indexPath}?query[vin]=${encodeURIComponent(vin)}`)
  const link = page.locator(`tbody tr a[href^="${indexPath}/"]`).first()
  await expect(link).toBeVisible()
  const href = (await link.getAttribute('href')) as string
  return Number(new RegExp(`${indexPath}/(\\d+)`).exec(href)![1])
}
```

### `support/guest.ts`

```ts
import { Browser, BrowserContext } from '@playwright/test'

/**
 * A browser context with NO session, for checking what an anonymous visitor can reach from inside the
 * signed-in "app" project. The empty storageState is required: new contexts inherit the project's session otherwise.
 */
export async function newGuestContext(browser: Browser, baseURL: string | undefined): Promise<BrowserContext> {
  return browser.newContext({
    baseURL,
    storageState: { cookies: [], origins: [] },
    httpCredentials: process.env.E2E_BASIC_AUTH_USER
      ? { username: process.env.E2E_BASIC_AUTH_USER, password: process.env.E2E_BASIC_AUTH_PASSWORD ?? '' }
      : undefined
  })
}
```

### `support/customer.ts`

```ts
import { Page, expect } from '@playwright/test'

export interface UploadFile {
  name: string
  mimeType: string
  buffer: Buffer
}

/** A real JPEG, rendered by the browser itself, so no binary fixture has to be committed. */
export async function makeJpeg(page: Page): Promise<Buffer> {
  const scratch = await page.context().newPage()
  await scratch.setContent('<body style="margin:0"><div style="width:640px;height:480px;background:linear-gradient(#889,#ccd)"></div></body>')
  const buffer = await scratch.screenshot({ type: 'jpeg', clip: { x: 0, y: 0, width: 640, height: 480 } })
  await scratch.close()
  return buffer
}

export async function openCamera(page: Page, carPart: string) {
  await page.locator(`.car-part.${carPart}`).click()
  // the first-time tooltip animates in; wait for it and dismiss it (it does not show again afterwards)
  const gotIt = page.locator('#takePictureTooltip .btn-got-it')
  await gotIt.click({ timeout: 3_000 }).catch(() => {})
  await expect(page.locator('#takePictureTooltip')).not.toHaveClass(/show/)
}

export async function chooseFromGallery(page: Page, file: UploadFile) {
  // the visible label only forwards to this hidden input, so set the file on the input itself
  await page.locator('#phoneGallery').setInputFiles(file)
}

/** Uploads one JPEG for a car part through the real customer page and waits until it is marked as uploaded. */
export async function uploadPhoto(page: Page, carPart: string, jpeg?: Buffer) {
  const buffer = jpeg ?? (await makeJpeg(page))
  await openCamera(page, carPart)
  await chooseFromGallery(page, { name: `${carPart}.jpg`, mimeType: 'image/jpeg', buffer })
  await page.locator('#picturePreviewContainer .btn-save-picture').click()
  if (carPart !== 'loc_unknown') await expect(page.locator(`.car-part.${carPart}.uploaded`)).toHaveCount(1)
}

/** Car parts the customer must photograph before they can send (the page marks them .required-loc). */
export async function requiredCarParts(page: Page): Promise<string[]> {
  // the car parts are loaded asynchronously after the page opens; reading too early returns an empty list
  await page.locator('.required-loc').first().waitFor({ state: 'attached' })
  const parts = await page.locator('.required-loc').evaluateAll(els => els.map(el => (el as HTMLElement).dataset.carPart as string))
  return parts.filter(Boolean)
}

export async function uploadAllRequiredPhotos(page: Page) {
  const jpeg = await makeJpeg(page)
  for (const carPart of await requiredCarParts(page)) {
    await uploadPhoto(page, carPart, jpeg)
  }
}

/** Waits for the send button to become enabled (it refreshes itself after every upload) and clicks it. */
export async function sendPhotos(page: Page) {
  const send = page.locator('#termOfService a.btn-send')
  await expect(send).not.toHaveClass(/disabled/)
  await send.click()
}
```

### `tests/auth.setup.ts`

```ts
import { test as setup, expect } from '@playwright/test'
import { AUTH_FILE } from '../playwright.config'
import { credentials } from '../support/env'

setup('sign in once and store the session', async ({ page }) => {
  await page.goto('/users/sign_in')
  await page.getByLabel('Email').fill(credentials.email)
  await page.getByLabel('Password').fill(credentials.password)
  await page.getByRole('button', { name: 'Log in' }).click()

  await expect(page.locator('.navbar')).toContainText('BackOffice - BOSCH')
  await page.context().storageState({ path: AUTH_FILE })
})
```

### `tests/guest/auth.spec.ts`

```ts
import { test, expect } from '@playwright/test'
import { credentials } from '../../support/env'

const PROTECTED_PAGES = ['/baselines', '/rentals', '/damage_events', '/prices']

test.describe('guest access', () => {
  for (const path of PROTECTED_PAGES) {
    test(`${path} redirects to the login page`, async ({ page }) => {
      await page.goto(path)
      await expect(page).toHaveURL(/\/users\/sign_in$/)
    })
  }

  test('a wrong password keeps me on the login page', async ({ page }) => {
    await page.goto('/users/sign_in')
    await page.getByLabel('Email').fill(credentials.email)
    await page.getByLabel('Password').fill('definitely-wrong')
    await page.getByRole('button', { name: 'Log in' }).click()

    await expect(page).toHaveURL(/\/users\/sign_in$/)
    await expect(page.locator('.navbar')).toHaveCount(0)
  })

  test('an unknown email keeps me on the login page', async ({ page }) => {
    await page.goto('/users/sign_in')
    await page.getByLabel('Email').fill('nobody@example.invalid')
    await page.getByLabel('Password').fill('whatever-123')
    await page.getByRole('button', { name: 'Log in' }).click()

    await expect(page).toHaveURL(/\/users\/sign_in$/)
  })

  test('after logging in I land on the page I originally asked for', async ({ page }) => {
    await page.goto('/rentals')
    await expect(page).toHaveURL(/\/users\/sign_in$/)

    await page.getByLabel('Email').fill(credentials.email)
    await page.getByLabel('Password').fill(credentials.password)
    await page.getByRole('button', { name: 'Log in' }).click()

    await expect(page).toHaveURL(/\/rentals$/)
  })

  test('I can log out and protected pages are locked again', async ({ page }) => {
    await page.goto('/users/sign_in')
    await page.getByLabel('Email').fill(credentials.email)
    await page.getByLabel('Password').fill(credentials.password)
    await page.getByRole('button', { name: 'Log in' }).click()
    await expect(page.locator('.navbar')).toBeVisible()

    await page.locator('#userMenu').click()
    await page.getByRole('link', { name: 'Log Out' }).click()
    await expect(page).toHaveURL(/\/users\/sign_in$/)

    await page.goto('/baselines')
    await expect(page).toHaveURL(/\/users\/sign_in$/)
  })

  test('a guest is not authorized to export CSV', async ({ request }) => {
    const response = await request.get('/baselines/export.csv')
    expect(response.status()).toBe(401)
  })

  test('the Sidekiq dashboard is not available to guests', async ({ request }) => {
    const response = await request.get('/sidekiq', { maxRedirects: 0 })
    expect(response.status()).not.toBe(200)
  })
})
```

### `tests/guest/customer-pages.spec.ts`

```ts
import { test, expect } from '@playwright/test'
import { createBaseline, createDamageEvent, createRental } from '../../support/api'
import { uniquePrefix } from '../../support/env'

test.describe('customer pages (no login)', () => {
  test('an unknown baseline link is a 404', async ({ request }) => {
    const response = await request.get('/damage_photo/baselines/00000000-0000-4000-8000-000000000000')
    expect(response.status()).toBe(404)
  })

  test('an unknown rental link is a 404', async ({ request }) => {
    const response = await request.get('/damage_photo/rentals/00000000-0000-4000-8000-000000000000')
    expect(response.status()).toBe(404)
  })

  test('the baseline page shows the VIN and the upload instructions', async ({ page }) => {
    const baseline = await createBaseline({ vin: uniquePrefix('BASE') })

    await page.goto(baseline.customerPath)

    await expect(page.locator('header')).toContainText('Vehicle Baseline')
    await expect(page.locator('body')).toContainText(`VIN: ${baseline.vin}`)
    await expect(page.locator('.required-loc')).toHaveCount(9)
  })

  test('the send button is disabled until all required photos are uploaded', async ({ page }) => {
    const baseline = await createBaseline({ vin: uniquePrefix('BASE') })

    await page.goto(baseline.customerPath)

    await expect(page.locator('#termOfService .btn-info.disabled')).toHaveCount(1)
  })

  test('the rental thank-you page is shown in English', async ({ page }) => {
    const rental = await createRental({ vin: uniquePrefix('RENT') })

    await page.goto(`${rental.customerPath}/thank_you`)

    await expect(page.locator('body')).toContainText('Thank you!')
    await expect(page.locator('body')).toContainText('Vehicle Rental')
    await expect(page.locator('body')).toContainText(rental.vin)
  })

  test('the rental thank-you page is shown in Japanese when the record language is ja', async ({ page }) => {
    const rental = await createRental({ vin: uniquePrefix('RENT'), language: 'ja' })

    await page.goto(`${rental.customerPath}/thank_you`)

    await expect(page.locator('body')).toContainText('ありがとうございました。')
    await expect(page.locator('body')).toContainText('車両レンタル')
  })

  test('the damage event thank-you page shows the VIN', async ({ page }) => {
    const damageEvent = await createDamageEvent({ vin: uniquePrefix('EVT') })

    await page.goto(`${damageEvent.customerPath}/thank_you`)

    await expect(page.locator('body')).toContainText('Thank you!')
    await expect(page.locator('body')).toContainText(damageEvent.vin)
  })
})
```

### `tests/guest/customer-upload.spec.ts`

```ts
import { test, expect } from '@playwright/test'
import { chooseFromGallery, makeJpeg, openCamera } from '../../support/customer'
import { createBaseline } from '../../support/api'
import { uniquePrefix } from '../../support/env'

test.describe('customer photo upload', () => {
  test('a non-image file is rejected before upload', async ({ page }) => {
    const baseline = await createBaseline({ vin: uniquePrefix('UPLOAD') })
    await page.goto(baseline.customerPath)

    await openCamera(page, 'loc_front')
    await chooseFromGallery(page, { name: 'notes.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.4 not an image') })

    await expect(page.locator('#alert span')).toContainText('File has an invalid content type')
    await expect(page.locator('.car-part.loc_front.uploaded')).toHaveCount(0)
  })

  // @writes: this really uploads a photo to the environment's storage
  test('@writes a valid photo is uploaded and the car part is marked as done', async ({ page }) => {
    const baseline = await createBaseline({ vin: uniquePrefix('UPLOAD') })
    await page.goto(baseline.customerPath)

    const jpeg = await makeJpeg(page)
    await openCamera(page, 'loc_front')
    await chooseFromGallery(page, { name: 'front.jpg', mimeType: 'image/jpeg', buffer: jpeg })
    await page.locator('#picturePreviewContainer .btn-save-picture').click()

    await expect(page.locator('.car-part.loc_front.uploaded')).toHaveCount(1)
  })

  test('@writes a valid photo still uploads after a rejected file', async ({ page }) => {
    const baseline = await createBaseline({ vin: uniquePrefix('UPLOAD') })
    await page.goto(baseline.customerPath)

    await openCamera(page, 'loc_front')
    await chooseFromGallery(page, { name: 'notes.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.4') })
    await expect(page.locator('#alert span')).toContainText('File has an invalid content type')

    await chooseFromGallery(page, { name: 'front.jpg', mimeType: 'image/jpeg', buffer: await makeJpeg(page) })
    await page.locator('#picturePreviewContainer .btn-save-picture').click()

    await expect(page.locator('.car-part.loc_front.uploaded')).toHaveCount(1)
  })
})
```

### `tests/guest/expired-links.spec.ts`

```ts
import { test, expect } from '@playwright/test'

// A customer link expires 2 weeks (baseline, rental) or 12 months (damage event) after creation.
// A test cannot create a record in the past, so these tests use links that ALREADY expired on the environment.
// Provide one or more customer paths, for example:
//   E2E_EXPIRED_PATHS=/damage_photo/baselines/<uuid>,/damage_photo/rentals/<uuid>
// Pick old records on staging (older than the expiry), or set created_at back on a throwaway record from a Rails console.
const expiredPaths = (process.env.E2E_EXPIRED_PATHS ?? '').split(',').map(p => p.trim()).filter(Boolean)

test.describe('expired customer links', () => {
  if (expiredPaths.length === 0) {
    // keep a visible, skipped test so the report says why nothing ran
    test('expired-link checks are not configured', () => {
      test.skip(true, 'Set E2E_EXPIRED_PATHS to run the expired-link checks')
    })
  }

  for (const path of expiredPaths) {
    test(`${path} returns 410 Gone`, async ({ request }) => {
      const response = await request.get(path)

      expect(response.status()).toBe(410)
      expect(await response.json()).toEqual({ error: 'Expired' })
    })

    test(`${path} cannot be used to open the upload page in the browser`, async ({ page }) => {
      await page.goto(path)

      await expect(page.locator('.car-part')).toHaveCount(0)
    })
  }
})
```

### `tests/app/navigation.spec.ts`

```ts
import { test, expect } from '@playwright/test'

test.describe('navigation', () => {
  test('the navbar links take me to each section', async ({ page }) => {
    await page.goto('/')
    await expect(page.locator('.navbar')).toContainText('BackOffice - BOSCH')

    await page.locator('.navbar').getByRole('link', { name: 'Rentals' }).click()
    await expect(page).toHaveURL(/\/rentals$/)

    await page.locator('.navbar').getByRole('link', { name: 'Damage Events' }).click()
    await expect(page).toHaveURL(/\/damage_events$/)

    await page.locator('.navbar').getByRole('link', { name: 'Baselines' }).click()
    await expect(page).toHaveURL(/\/baselines$/)
  })

  test('the Pricing link is available on non-production environments', async ({ page }) => {
    await page.goto('/')
    await page.locator('.navbar').getByRole('link', { name: 'Pricing' }).click()
    await expect(page).toHaveURL(/\/prices$/)
  })

  test('the navbar shows my name', async ({ page }) => {
    await page.goto('/')
    await expect(page.locator('#userMenu')).toBeVisible()
  })

  test('a signed-in user is redirected away from the login page', async ({ page }) => {
    await page.goto('/users/sign_in')
    await expect(page).not.toHaveURL(/\/users\/sign_in$/)
  })

  test('the /errors route is a 404', async ({ request }) => {
    const response = await request.get('/errors')
    expect(response.status()).toBe(404)
  })

  test('opening a record that does not exist is a 404', async ({ request }) => {
    for (const path of ['/baselines/0', '/rentals/0', '/damage_events/0']) {
      const response = await request.get(path)
      expect(response.status(), path).toBe(404)
    }
  })
})
```

### `tests/app/index-filters.spec.ts`

```ts
import { test, expect } from '@playwright/test'
import { createBaseline, createDamageEvent, createRental } from '../../support/api'
import { uniquePrefix } from '../../support/env'
import { columnTexts, expectRecordCount, filterBy } from '../../support/pages'

const VIN_COLUMN = 2

test.describe('baselines index', () => {
  test('filtering by VIN is case-insensitive and Reset clears it', async ({ page }) => {
    const prefix = uniquePrefix('FLT')
    await createBaseline({ vin: `${prefix}-A` })
    await createBaseline({ vin: `${prefix}-B` })

    await page.goto('/baselines')
    await filterBy(page, { query_vin: prefix.toLowerCase() })

    await expectRecordCount(page, 'Baselines', 2)
    expect(await columnTexts(page, VIN_COLUMN)).toEqual(expect.arrayContaining([`${prefix}-A`, `${prefix}-B`]))
    await expect(page.locator('#query_vin')).toHaveValue(prefix.toLowerCase())

    await page.getByRole('link', { name: 'Reset' }).click()
    await expect(page.locator('#query_vin')).toHaveValue('')
  })

  test('a filter that matches nothing shows zero records', async ({ page }) => {
    await page.goto('/baselines')
    await filterBy(page, { query_vin: `NO-SUCH-VIN-${Date.now()}` })

    await expectRecordCount(page, 'Baselines', 0)
    await expect(page.locator('tbody tr')).toHaveCount(0)
  })

  test('filters can be combined', async ({ page }) => {
    const prefix = uniquePrefix('CMB')
    await createBaseline({ vin: `${prefix}-A`, licensePlate: 'PLATE-ONE' })
    await createBaseline({ vin: `${prefix}-B`, licensePlate: 'PLATE-TWO' })

    await page.goto('/baselines')
    await filterBy(page, { query_vin: prefix, query_license_plate: 'PLATE-TWO' })

    await expectRecordCount(page, 'Baselines', 1)
    expect(await columnTexts(page, VIN_COLUMN)).toEqual([`${prefix}-B`])
  })

  test('I can sort by VIN ascending and then descending, and sorting survives filtering', async ({ page }) => {
    const prefix = uniquePrefix('SRT')
    await createBaseline({ vin: `${prefix}-A` })
    await createBaseline({ vin: `${prefix}-B` })

    await page.goto(`/baselines?query[vin]=${prefix}`)

    await page.locator('thead').getByRole('link', { name: /VIN/ }).click()
    await expect.poll(() => columnTexts(page, VIN_COLUMN)).toEqual([`${prefix}-A`, `${prefix}-B`])

    await page.locator('thead').getByRole('link', { name: /VIN/ }).click()
    await expect.poll(() => columnTexts(page, VIN_COLUMN)).toEqual([`${prefix}-B`, `${prefix}-A`])

    await filterBy(page, { query_vin: prefix })
    await expect.poll(() => columnTexts(page, VIN_COLUMN)).toEqual([`${prefix}-B`, `${prefix}-A`])
  })

  test('the CSV button keeps my filter', async ({ page }) => {
    await page.goto('/baselines?query[vin]=ABC')
    await expect(page.getByRole('link', { name: 'CSV' })).toHaveAttribute('href', /query%5Bvin%5D=ABC/)
  })
})

test.describe('rentals index', () => {
  test('I can filter by rental id', async ({ page }) => {
    const prefix = uniquePrefix('RNT')
    await createRental({ vin: `${prefix}-A` })
    await createRental({ vin: `${prefix}-B` })

    await page.goto('/rentals')
    await filterBy(page, { query_vin: `${prefix}-A` })

    await expectRecordCount(page, 'Rentals', 1)
  })
})

test.describe('damage events index', () => {
  test('I can filter by location', async ({ page }) => {
    const prefix = uniquePrefix('EVT')
    await createDamageEvent({ vin: `${prefix}-A`, location: 'loc_front' })
    await createDamageEvent({ vin: `${prefix}-B`, location: 'loc_rear' })

    await page.goto('/damage_events')
    await filterBy(page, { query_vin: prefix, query_location: 'rear' })

    await expectRecordCount(page, 'Damage Events', 1)
    await expect(page.locator('tbody')).toContainText(`${prefix}-B`)
  })
})
```

### `tests/app/state-filter.spec.ts`

```ts
import { test, expect } from '@playwright/test'
import { createBaseline, createDamageEvent, createRental } from '../../support/api'
import { uniquePrefix } from '../../support/env'
import { columnTexts, expectRecordCount, filterBy } from '../../support/pages'

// Records created through the API start in the "new" state. That is enough to prove the state filter
// works in both directions without needing to move records through the rest of the workflow.
test.describe('state filter', () => {
  test('baselines: only records in the selected state are listed', async ({ page }) => {
    const prefix = uniquePrefix('STATE')
    await createBaseline({ vin: `${prefix}-A` })
    await createBaseline({ vin: `${prefix}-B` })

    await page.goto('/baselines')
    await page.locator('#query_state').selectOption({ label: 'New' })
    await filterBy(page, { query_vin: prefix })
    await expectRecordCount(page, 'Baselines', 2)
    expect(await columnTexts(page, 4)).toEqual(['New', 'New'])

    await page.locator('#query_state').selectOption({ label: 'Internal reviewed' })
    await page.getByRole('button', { name: 'Filter' }).click()
    await expectRecordCount(page, 'Baselines', 0)
  })

  test('the state list offers every workflow state', async ({ page }) => {
    await page.goto('/baselines')

    const labels = await page.locator('#query_state option').allInnerTexts()
    expect(labels).toEqual(expect.arrayContaining(['New', 'Damage prediction requested', 'Damage prediction resulted', 'Internal reviewed']))
  })

  test('rentals: filtering by a state with no records shows none', async ({ page }) => {
    const prefix = uniquePrefix('STATE')
    await createRental({ vin: `${prefix}-A` })

    await page.goto('/rentals')
    await page.locator('#query_state').selectOption({ label: 'New' })
    await filterBy(page, { query_vin: prefix })
    await expectRecordCount(page, 'Rentals', 1)

    await page.locator('#query_state').selectOption({ label: 'Damage prediction resulted' })
    await page.getByRole('button', { name: 'Filter' }).click()
    await expectRecordCount(page, 'Rentals', 0)
  })

  test('damage events: the selected state is kept after filtering', async ({ page }) => {
    const prefix = uniquePrefix('STATE')
    await createDamageEvent({ vin: `${prefix}-A` })

    await page.goto('/damage_events')
    await page.locator('#query_state').selectOption({ label: 'New' })
    await filterBy(page, { query_vin: prefix })

    await expectRecordCount(page, 'Damage Events', 1)
    await expect(page.locator('#query_state option:checked')).toHaveText('New')
  })
})
```

### `tests/app/pagination.spec.ts`

```ts
import { test, expect } from '@playwright/test'
import { createBaseline } from '../../support/api'
import { uniquePrefix } from '../../support/env'
import { columnTexts } from '../../support/pages'

const PER_PAGE = 20 // WillPaginate.per_page in config/initializers/will_paginate.rb

test.describe('pagination', () => {
  // Pagination needs more than one page of records, so create exactly that many under our own unique prefix
  // and filter by the prefix. The test never depends on what else is on the shared environment.
  test('records are split into pages of 20 and the filter survives page changes', async ({ page }) => {
    test.setTimeout(90_000)
    const prefix = uniquePrefix('PAGE')
    const vins = Array.from({ length: PER_PAGE + 1 }, (_, i) => `${prefix}-${String(i).padStart(2, '0')}`)
    for (let i = 0; i < vins.length; i += 7) {
      await Promise.all(vins.slice(i, i + 7).map(vin => createBaseline({ vin })))
    }

    await page.goto(`/baselines?query[vin]=${prefix}&sort_column=vin&sort_direction=asc`)
    await expect(page.locator('tbody tr')).toHaveCount(PER_PAGE)
    await expect(page.locator('.pagination')).toBeVisible()
    expect(await columnTexts(page, 2)).toEqual(vins.slice(0, PER_PAGE))

    await page.locator('.pagination').getByRole('link', { name: 'Page 2' }).click()
    await expect(page).toHaveURL(/page=2/)
    await expect(page).toHaveURL(new RegExp(`query%5Bvin%5D=${prefix}`))
    await expect(page.locator('tbody tr')).toHaveCount(1)
    expect(await columnTexts(page, 2)).toEqual([vins[PER_PAGE]])

    await page.locator('.pagination').getByRole('link', { name: 'Page 1' }).click()
    await expect(page.locator('tbody tr')).toHaveCount(PER_PAGE)
  })

  test('there is no second page when the results fit on one', async ({ page }) => {
    const prefix = uniquePrefix('PAGE')
    await createBaseline({ vin: `${prefix}-A` })

    await page.goto(`/baselines?query[vin]=${prefix}`)

    await expect(page.locator('tbody tr')).toHaveCount(1)
    await expect(page.locator('.pagination').getByRole('link', { name: 'Page 2' })).toHaveCount(0)
  })
})
```

### `tests/app/dates.spec.ts`

```ts
import { test, expect } from '@playwright/test'
import { createBaseline } from '../../support/api'
import { uniquePrefix } from '../../support/env'
import { columnTexts, recordIdFromIndex } from '../../support/pages'

// The Ruby specs freeze the clock (Timecop) and compare exact dates. On a real environment the clock
// cannot be frozen, so these tests check the *format* and that the value is recent.
const DATE_FORMAT = /^\d{2} [A-Z][a-z]{2} \d{4}, \d{2}:\d{2} (AM|PM)$/

test.describe('date display', () => {
  test('the index shows the created date in "dd Mon yyyy, hh:mm AM/PM" format', async ({ page }) => {
    const baseline = await createBaseline({ vin: uniquePrefix('DATE') })

    await page.goto(`/baselines?query[vin]=${baseline.vin}`)
    const [created] = await columnTexts(page, 1)

    expect(created.trim()).toMatch(DATE_FORMAT)
  })

  test('a record created now is shown with today\'s date', async ({ page }) => {
    const baseline = await createBaseline({ vin: uniquePrefix('DATE') })

    await page.goto(`/baselines?query[vin]=${baseline.vin}`)
    const [created] = await columnTexts(page, 1)

    // compare the day only (time zone differences between the runner and the server can shift the hour)
    const shown = new Date(created.replace(',', ''))
    const ageInHours = Math.abs(Date.now() - shown.getTime()) / 36e5
    expect(ageInHours).toBeLessThan(36)
  })

  test('the record page shows the same format under "Created Date"', async ({ page }) => {
    const baseline = await createBaseline({ vin: uniquePrefix('DATE') })
    const id = await recordIdFromIndex(page, '/baselines', baseline.vin)

    await page.goto(`/baselines/${id}`)

    const created = page.locator('table.basic-info td', { hasText: 'Created Date' }).locator('.text-break')
    await expect(created).toHaveText(DATE_FORMAT)
  })

  test('the CSV export uses the same date format', async ({ page }) => {
    const baseline = await createBaseline({ vin: uniquePrefix('DATE') })

    const response = await page.request.get(`/baselines/export.csv?query[vin]=${baseline.vin}`)
    const firstValue = (await response.text()).trim().split('\n')[1].split(';')[0]

    expect(firstValue).toMatch(DATE_FORMAT)
  })
})
```

### `tests/app/csv-export.spec.ts`

```ts
import { readFile } from 'node:fs/promises'
import { test, expect } from '@playwright/test'
import { createBaseline } from '../../support/api'
import { uniquePrefix } from '../../support/env'

const HEADER = ['Created Date', 'UUID', 'VIN', 'License Plate', 'State', 'Car Type', 'Company', 'Country']

test.describe('CSV export', () => {
  test('the export respects my filter and uses ; as separator', async ({ page }) => {
    const prefix = uniquePrefix('CSV')
    await createBaseline({ vin: `${prefix}-A` })
    await createBaseline({ vin: `${prefix}-B` })

    await page.goto(`/baselines?query[vin]=${prefix}-A`)
    const [download] = await Promise.all([
      page.waitForEvent('download'),
      page.getByRole('link', { name: 'CSV' }).click()
    ])

    expect(download.suggestedFilename()).toMatch(/^baselines_\d+\.csv$/)
    const path = await download.path()
    const lines = (await readFile(path, 'utf8')).trim().split('\n')

    expect(lines[0].split(';')).toEqual(HEADER)
    expect(lines).toHaveLength(2)
    expect(lines[1]).toContain(`${prefix}-A`)
  })

  test('blank values are exported as a dash', async ({ page }) => {
    const prefix = uniquePrefix('CSV')
    await createBaseline({ vin: `${prefix}-A` })

    const response = await page.request.get(`/baselines/export.csv?query[vin]=${prefix}-A`)
    expect(response.status()).toBe(200)
    expect(response.headers()['content-type']).toContain('text/csv')

    const row = (await response.text()).trim().split('\n')[1].split(';')
    expect(row[HEADER.indexOf('License Plate')]).toBe('-')
    expect(row[HEADER.indexOf('Company')]).toBe('-')
  })
})
```

### `tests/app/pdf.spec.ts`

```ts
import { test, expect } from '@playwright/test'
import { createBaseline, createDamageEvent, createRental } from '../../support/api'
import { uniquePrefix } from '../../support/env'
import { newGuestContext } from '../../support/guest'
import { recordIdFromIndex } from '../../support/pages'

// /pdf needs the numeric record id, which the API does not return, so the id is read from the index page.
// The report only renders as .pdf (wkhtmltopdf); "debug=1" makes the server return the HTML it would print.
test.describe('PDF report', () => {
  test('a baseline report renders as HTML with the VIN (debug mode)', async ({ page }) => {
    const baseline = await createBaseline({ vin: uniquePrefix('PDF') })
    const id = await recordIdFromIndex(page, '/baselines', baseline.vin)

    const response = await page.request.get(`/pdf.pdf?resource=baseline&id=${id}&debug=1`)

    expect(response.status()).toBe(200)
    expect(await response.text()).toContain(baseline.vin)
  })

  test('a damage event report renders as HTML with the VIN (debug mode)', async ({ page }) => {
    const damageEvent = await createDamageEvent({ vin: uniquePrefix('PDF') })
    const id = await recordIdFromIndex(page, '/damage_events', damageEvent.vin)

    const response = await page.request.get(`/pdf.pdf?resource=damage_event&id=${id}&debug=1`)

    expect(response.status()).toBe(200)
    expect(await response.text()).toContain(damageEvent.vin)
  })

  test('a rental report renders as HTML with the VIN (debug mode)', async ({ page }) => {
    const rental = await createRental({ vin: uniquePrefix('PDF') })
    const id = await recordIdFromIndex(page, '/rentals', rental.vin)

    const response = await page.request.get(`/pdf.pdf?resource=rental&id=${id}&debug=1`)

    expect(response.status()).toBe(200)
    expect(await response.text()).toContain(rental.vin)
  })

  test('the real PDF is generated and is a valid PDF file', async ({ page }) => {
    const baseline = await createBaseline({ vin: uniquePrefix('PDF') })
    const id = await recordIdFromIndex(page, '/baselines', baseline.vin)

    const response = await page.request.get(`/pdf.pdf?resource=baseline&id=${id}`)

    expect(response.status()).toBe(200)
    expect(response.headers()['content-type']).toContain('application/pdf')
    expect((await response.body()).subarray(0, 5).toString()).toBe('%PDF-')
  })

  test('the report is available without logging in', async ({ page, browser, baseURL }) => {
    const baseline = await createBaseline({ vin: uniquePrefix('PDF') })
    const id = await recordIdFromIndex(page, '/baselines', baseline.vin)

    const guest = await newGuestContext(browser, baseURL)
    const response = await guest.request.get(`/pdf.pdf?resource=baseline&id=${id}&debug=1`)
    expect(response.status()).toBe(200)
    await guest.close()
  })

  test('the stored Bosch report (/pdf/:id) is for signed-in users only', async ({ browser, baseURL }) => {
    const guest = await newGuestContext(browser, baseURL)
    const guestPage = await guest.newPage()
    await guestPage.goto('/pdf/1?resource=baseline')

    await expect(guestPage).toHaveURL(/\/users\/sign_in$/)
    await guest.close()
  })

  test('an unknown record is a 404', async ({ request }) => {
    const response = await request.get('/pdf.pdf?resource=baseline&id=0&debug=1')
    expect(response.status()).toBe(404)
  })

  test('a missing resource parameter is a 400', async ({ request }) => {
    const response = await request.get('/pdf.pdf')
    expect(response.status()).toBe(400)
  })
})
```

### `tests/app/prices.spec.ts`

```ts
import { test, expect, Page } from '@playwright/test'
import { uniqueCost } from '../../support/env'
import { flashMessage } from '../../support/pages'

async function createPrice(page: Page, cost: string) {
  await page.goto('/prices/new')
  await page.locator('#price_car_part').selectOption('door')
  await page.locator('#price_labor_hour').fill('1.7')
  await page.locator('#price_material_cost').fill(cost)
  await page.locator('#price_paint_hour').fill('3.7')
  await page.locator('#price_paint_material_cost').fill('230.50')
  await page.getByRole('button', { name: 'Save' }).click()
}

function row(page: Page, cost: string) {
  return page.locator('tbody tr', { hasText: cost })
}

async function deletePrice(page: Page, cost: string) {
  await page.goto('/prices')
  page.once('dialog', dialog => dialog.accept())
  await row(page, cost).first().locator('.fa-trash-alt').click()
  await expect(row(page, cost)).toHaveCount(0)
}

test.describe('pricing', () => {
  test('I can create, update and delete a price', async ({ page }) => {
    const cost = uniqueCost()

    await createPrice(page, cost)
    expect(await flashMessage(page)).toContain('Price was successfully created.')
    await expect(row(page, cost)).toHaveCount(1)

    await row(page, cost).locator('.fa-pencil-alt').click()
    await page.locator('#price_labor_hour').fill('2.50')
    await page.getByRole('button', { name: 'Save' }).click()
    expect(await flashMessage(page)).toContain('Price was successfully updated.')
    await expect(row(page, cost)).toContainText('2.5')

    await deletePrice(page, cost)
  })

  test('I cannot create a price without a car part', async ({ page }) => {
    await page.goto('/prices/new')
    await page.getByRole('button', { name: 'Save' }).click()

    await expect(page.locator('body')).toContainText("can't be blank")
  })

  test('I cannot save a negative labour value', async ({ page }) => {
    await page.goto('/prices/new')
    await page.locator('#price_car_part').selectOption('door')
    await page.locator('#price_labor_hour').fill('-1')
    await page.getByRole('button', { name: 'Save' }).click()

    await expect(page.locator('body')).toContainText('must be greater than or equal to 0')
  })

  test('I cannot save a negative material cost', async ({ page }) => {
    await page.goto('/prices/new')
    await page.locator('#price_car_part').selectOption('door')
    await page.locator('#price_material_cost').fill('-5')
    await page.getByRole('button', { name: 'Save' }).click()

    await expect(page.locator('body')).toContainText('must be greater than or equal to 0')
  })

  test('the price stays when I dismiss the delete confirmation', async ({ page }) => {
    const cost = uniqueCost()
    await createPrice(page, cost)
    await expect(row(page, cost)).toHaveCount(1)

    page.once('dialog', dialog => {
      expect(dialog.message()).toBe('Would you like to delete this Pricing record?')
      return dialog.dismiss()
    })
    await row(page, cost).locator('.fa-trash-alt').click()

    await expect(row(page, cost)).toHaveCount(1)
    await deletePrice(page, cost)
  })

  test('an unknown price is a 404', async ({ request }) => {
    const response = await request.get('/prices/0/edit')
    expect(response.status()).toBe(404)
  })
})
```

### `tests/app/prices-import.spec.ts`

```ts
import { test, expect, Page } from '@playwright/test'
import { uniqueCost } from '../../support/env'
import { flashMessage } from '../../support/pages'

const HEADER = 'car_part,side1,side2,damage,treatment,paint_hour,labor_hour,material_cost,paint_material_cost\n'

async function importCsv(page: Page, content: string) {
  await page.goto('/prices/import')
  await page.locator('input[type=file]').setInputFiles({ name: 'prices.csv', mimeType: 'text/csv', buffer: Buffer.from(content) })
  await page.getByRole('button', { name: 'Import' }).click()
}

async function deletePrice(page: Page, cost: string) {
  await page.goto('/prices')
  page.once('dialog', dialog => dialog.accept())
  await page.locator('tbody tr', { hasText: cost }).first().locator('.fa-trash-alt').click()
  await expect(page.locator('tbody tr', { hasText: cost })).toHaveCount(0)
}

test.describe('pricing CSV import', () => {
  // @writes: creates a pricing record, which the test removes again
  test('@writes I can import a valid CSV file', async ({ page }) => {
    const cost = uniqueCost()

    await importCsv(page, `${HEADER}door,,,scratch,replace,1.5,2.5,${cost},175.00\n`)
    expect(await flashMessage(page)).toBe('Imported successfully')

    await deletePrice(page, cost)
  })

  test('rows with invalid values are reported', async ({ page }) => {
    await importCsv(page, `${HEADER}not_a_part,,,scratch,replace,1,1,1,1\n`)

    expect(await flashMessage(page)).toBe('Found some errors when importing')
    await expect(page.locator('body')).toContainText('The following errors were encountered:')
    await expect(page.locator('textarea')).toHaveValue(/not included in the list/)
  })

  test('negative values are reported', async ({ page }) => {
    await importCsv(page, `${HEADER}door,,,scratch,replace,1,-1,1,1\n`)

    await expect(page.locator('body')).toContainText('The following errors were encountered:')
  })

  test('a file that is not valid CSV is rejected', async ({ page }) => {
    await importCsv(page, 'car_part,side1\n"unclosed quote,front\n')

    expect(await flashMessage(page)).toContain('Your file is not valid.')
  })

  test('a header-only file imports nothing', async ({ page }) => {
    await importCsv(page, HEADER)

    expect(await flashMessage(page)).toBe('Imported successfully')
  })

  test('submitting without a file is rejected', async ({ page }) => {
    await page.goto('/prices/import')
    const [response] = await Promise.all([
      page.waitForResponse(r => r.url().endsWith('/prices/import') && r.request().method() === 'POST'),
      page.getByRole('button', { name: 'Import' }).click()
    ])

    expect(response.status()).toBe(400)
  })

  test('the back link returns to the pricing table', async ({ page }) => {
    await page.goto('/prices/import')
    await page.getByRole('link', { name: 'Back to Pricing table' }).click()

    await expect(page).toHaveURL(/\/prices$/)
  })
})
```

### `tests/app/assessments.spec.ts`

```ts
import { test, expect, Page } from '@playwright/test'
import { createDamageEvent, deliverPredictionResult } from '../../support/api'
import { uniquePrefix } from '../../support/env'
import { expectFlash, recordIdFromIndex } from '../../support/pages'

// A damage event only has assessments once the prediction service has delivered a result. The test plays the
// part of that service (deliverPredictionResult), so the whole pipeline is exercised: callback -> background job
// -> assessments -> BackOffice page. Needs the environment's background worker (Sidekiq) to be running.
test.describe('assessments', () => {
  test.beforeEach(({}, testInfo) => {
    testInfo.annotations.push({ type: 'writes', description: 'creates a damage event with assessments' })
  })

  async function seedDamageEventWithResult(page: Page) {
    const record = await createDamageEvent({ vin: uniquePrefix('ASSESS') })
    await deliverPredictionResult(record, [
      { carpart: 'door', side_1: 'front', side_2: 'n_a', treatment: 'replace', confidence: [0.79], damage: [['missing', 1]] }
    ])
    const id = await recordIdFromIndex(page, '/damage_events', record.vin)
    await page.goto(`/damage_events/${id}`)
    await expect(page.locator('.assessment-table tbody tr')).toHaveCount(1)
    return { record, id }
  }

  function rows(page: Page) {
    return page.locator('.assessment-table tbody tr')
  }

  async function openNewAssessmentModal(page: Page) {
    // the page's "add" button is hidden (d-none) on purpose: the photo editor drives it. Trigger it directly,
    // as the Ruby specs do with execute_script, instead of going through the editor.
    await page.locator('.assessments [data-bs-target="#newAssessmentModal"]').evaluate(el => (el as HTMLElement).click())
    await expect(page.locator('#newAssessmentModal')).toBeVisible()
  }

  /** Assessments from the prediction service ("AI") are read-only; only human ones can be edited, deleted or toggled. */
  function humanRow(page: Page) {
    return rows(page).filter({ has: page.locator('.btn-edit-assessment') })
  }

  async function addHumanAssessment(page: Page) {
    await openNewAssessmentModal(page)
    const modal = page.locator('#newAssessmentModal')
    await fillAssessment(modal, { carPart: 'Hood', side1: 'Rear', side2: 'Left', treatment: 'Repair' })
    await modal.locator('#damage_prediction_assessment_labor_hour').fill('2.4')
    await modal.locator('#damage_prediction_assessment_details_attributes_0_damage_type').selectOption({ label: 'Crack' })
    await modal.locator('#damage_prediction_assessment_details_attributes_0_damage_number').fill('2')
    await modal.locator('#damage_prediction_assessment_details_attributes_0_confidence').fill('0.84')
    await modal.getByRole('button', { name: 'Save' }).click()
    await expect(rows(page)).toHaveCount(2)
    await expect(humanRow(page)).toHaveCount(1)
  }

  async function fillAssessment(modal: ReturnType<Page['locator']>, values: { carPart: string; side1: string; side2: string; treatment: string }) {
    await modal.locator('#damage_prediction_assessment_car_part').selectOption({ label: values.carPart })
    await modal.locator('#damage_prediction_assessment_side1').selectOption({ label: values.side1 })
    await modal.locator('#damage_prediction_assessment_side2').selectOption({ label: values.side2 })
    await modal.locator('#damage_prediction_assessment_treatment').selectOption({ label: values.treatment })
  }

  test('@writes the prediction result shows up as an assessment and moves the record to "resulted"', async ({ page }) => {
    await seedDamageEventWithResult(page)

    await expect(rows(page).first()).toContainText(/Front Door\s*Missing\s*1\s*0\.79\s*Replace/)
    await expect(page.locator('table.basic-info')).toContainText('Damage prediction resulted')
  })

  test('@writes I can add an assessment with a damage detail', async ({ page }) => {
    await seedDamageEventWithResult(page)
    await openNewAssessmentModal(page)

    const modal = page.locator('#newAssessmentModal')
    await fillAssessment(modal, { carPart: 'Hood', side1: 'Rear', side2: 'Left', treatment: 'Repair' })
    await modal.locator('#damage_prediction_assessment_labor_hour').fill('2.4')
    await modal.locator('#damage_prediction_assessment_material_cost').fill('660')
    await modal.locator('#damage_prediction_assessment_details_attributes_0_damage_type').selectOption({ label: 'Crack' })
    await modal.locator('#damage_prediction_assessment_details_attributes_0_damage_number').fill('2')
    await modal.locator('#damage_prediction_assessment_details_attributes_0_confidence').fill('0.84')
    await modal.getByRole('button', { name: 'Save' }).click()

    await expectFlash(page, 'Assessment was successfully created')
    await expect(rows(page)).toHaveCount(2)
    await expect(page.locator('.assessment-table')).toContainText(/Rear Left Hood\s*Crack\s*2\s*0\.84\s*Repair/)
  })

  test('@writes I cannot add an assessment with a negative labor value', async ({ page }) => {
    await seedDamageEventWithResult(page)
    await openNewAssessmentModal(page)

    const modal = page.locator('#newAssessmentModal')
    await fillAssessment(modal, { carPart: 'Hood', side1: 'Rear', side2: 'Left', treatment: 'Repair' })
    await modal.locator('#damage_prediction_assessment_labor_hour').fill('-3')
    await modal.getByRole('button', { name: 'Save' }).click()

    await expect(modal).toContainText('must be greater than 0')
    await expect(rows(page)).toHaveCount(1)
  })

  test('@writes I cannot add a damage detail with an out-of-range confidence', async ({ page }) => {
    await seedDamageEventWithResult(page)
    await openNewAssessmentModal(page)

    const modal = page.locator('#newAssessmentModal')
    await fillAssessment(modal, { carPart: 'Hood', side1: 'Rear', side2: 'Left', treatment: 'Repair' })
    await modal.locator('#damage_prediction_assessment_details_attributes_0_damage_type').selectOption({ label: 'Scratch' })
    await modal.locator('#damage_prediction_assessment_details_attributes_0_damage_number').fill('0')
    await modal.locator('#damage_prediction_assessment_details_attributes_0_confidence').fill('5')
    await modal.getByRole('button', { name: 'Save' }).click()

    await expect(modal).toContainText('must be greater than or equal to 1')
    await expect(rows(page)).toHaveCount(1)
  })

  test('@writes the prediction (AI) assessment is read-only', async ({ page }) => {
    await seedDamageEventWithResult(page)

    await expect(rows(page).first().locator('.btn-edit-assessment')).toHaveCount(0)
    await expect(rows(page).first().locator('.btn-delete-assessment')).toHaveCount(0)
    await expect(rows(page).first()).toContainText('AI')
  })

  test('@writes I can edit an assessment', async ({ page }) => {
    await seedDamageEventWithResult(page)
    await addHumanAssessment(page)

    await humanRow(page).locator('.btn-edit-assessment').click()
    const modal = page.locator('#editAssessmentModal')
    await expect(modal).toBeVisible()
    await modal.locator('#damage_prediction_assessment_labor_hour').fill('1.89')
    await modal.locator('#damage_prediction_assessment_material_cost').fill('600.66')
    await modal.getByRole('button', { name: 'Save' }).click()

    await expectFlash(page, 'Assessment was successfully updated')
    await expect(humanRow(page)).toContainText(/1\.89\s*600\.66/)
  })

  test('@writes an invalid edit is rejected and the assessment is unchanged', async ({ page }) => {
    await seedDamageEventWithResult(page)
    await addHumanAssessment(page)

    await humanRow(page).locator('.btn-edit-assessment').click()
    const modal = page.locator('#editAssessmentModal')
    await expect(modal).toBeVisible()
    await modal.locator('#damage_prediction_assessment_labor_hour').fill('-1')
    await modal.getByRole('button', { name: 'Save' }).click()

    await expect(modal).toContainText('must be greater than 0')
    await modal.locator('.btn-close').first().click()
    await expect(humanRow(page)).toContainText(/Hood\s*Crack/)
  })

  test('@writes the assessment stays when I dismiss the delete confirmation, and goes when I accept', async ({ page }) => {
    await seedDamageEventWithResult(page)
    await addHumanAssessment(page)

    page.once('dialog', dialog => {
      expect(dialog.message()).toBe('Would you like to delete this assessment ?')
      return dialog.dismiss()
    })
    await humanRow(page).locator('.btn-delete-assessment').click()
    await expect(rows(page)).toHaveCount(2)

    page.once('dialog', dialog => dialog.accept())
    await humanRow(page).locator('.btn-delete-assessment').click()

    await expectFlash(page, 'Assessment was successfully deleted')
    await expect(rows(page)).toHaveCount(1)
    await expect(humanRow(page)).toHaveCount(0)
  })

  test('@writes including an assessment in the PDF can be switched off and the choice is kept after reload', async ({ page }) => {
    const { id } = await seedDamageEventWithResult(page)
    await addHumanAssessment(page)
    const checkbox = humanRow(page).locator('input[type="checkbox"]')
    const wasChecked = await checkbox.isChecked()

    await checkbox.click()
    await expect(checkbox).toBeChecked({ checked: !wasChecked })

    await page.goto(`/damage_events/${id}`)
    await expect(humanRow(page).locator('input[type="checkbox"]')).toBeChecked({ checked: !wasChecked })
  })

  test('@writes I can update the labor and paint rates', async ({ page }) => {
    await seedDamageEventWithResult(page)

    await page.locator('#damage_event_labor_rate').fill('12.50')
    await page.locator('#damage_event_paint_rate').fill('16.50')
    await page.getByRole('button', { name: 'Update Rates' }).click()

    await expectFlash(page, 'Labor rate and Paint labor rate was successfully updated')
  })
})
```

### `tests/app/gallery.spec.ts`

```ts
import { test, expect, Page } from '@playwright/test'
import { createDamageEvent } from '../../support/api'
import { makeJpeg, uploadPhoto } from '../../support/customer'
import { uniquePrefix } from '../../support/env'
import { recordIdFromIndex } from '../../support/pages'

// Photos can only come from the customer, so each test uploads real JPEGs through the customer page first
// (that is the only way to get photos onto a record from outside), then reviews them in the BackOffice.
test.describe('photo gallery and editor', () => {
  async function damageEventWithPhotos(page: Page, carParts: string[]) {
    const record = await createDamageEvent({ vin: uniquePrefix('GALLERY'), location: 'loc_front' })
    await page.goto(record.customerPath)
    const jpeg = await makeJpeg(page)
    for (const carPart of carParts) await uploadPhoto(page, carPart, jpeg)

    const id = await recordIdFromIndex(page, '/damage_events', record.vin)
    await page.goto(`/damage_events/${id}`)
    return { record, id }
  }

  /** Opens the editor on the first photo and waits until it has finished loading (it disables its panels meanwhile). */
  async function openEditor(page: Page) {
    await page.locator('[data-controller="damage-editor"] .photo .target').first().click()
    await expect(editor(page)).toBeVisible()
    await expect(editor(page).locator('.buttons-panel')).not.toHaveClass(/disabled/)
    await expect(editor(page).locator('.photos-panel')).not.toHaveClass(/disabled/)
  }

  const editor = (page: Page) => page.locator('.damage-editor.modal-backdrop')
  const thumbnails = (page: Page) => page.locator('.photos-panel .img-thumbnail')

  test('@writes a record without photos has nothing to open', async ({ page }) => {
    const record = await createDamageEvent({ vin: uniquePrefix('GALLERY') })
    const id = await recordIdFromIndex(page, '/damage_events', record.vin)
    await page.goto(`/damage_events/${id}`)

    await expect(page.locator('[data-controller="damage-editor"] .photo .target')).toHaveCount(0)
  })

  test('@writes uploaded photos are listed in the gallery', async ({ page }) => {
    await damageEventWithPhotos(page, ['loc_front', 'loc_rear'])

    await expect(page.locator('[data-controller="damage-editor"] .photo')).toHaveCount(2)
  })

  test('@writes I can open the editor, see its panels and close it without changing anything', async ({ page }) => {
    await damageEventWithPhotos(page, ['loc_front'])

    await openEditor(page)
    await expect(editor(page).locator('.photos-panel')).toBeVisible()
    await expect(editor(page).locator('.editor-panel')).toBeVisible()
    await expect(editor(page).locator('.buttons-panel')).toBeVisible()
    await expect(thumbnails(page)).toHaveCount(1)

    await editor(page).locator('[data-damage-editor-target="btnClose"]').click()
    await expect(editor(page)).toBeHidden()
    await expect(page.locator('[data-controller="damage-editor"] .photo')).toHaveCount(1)
  })

  test('@writes I can switch between photos inside the editor', async ({ page }) => {
    await damageEventWithPhotos(page, ['loc_front', 'loc_rear'])

    await openEditor(page)
    await expect(thumbnails(page)).toHaveCount(2)

    const ids = await thumbnails(page).evaluateAll(els => els.map(el => (el as HTMLElement).dataset.photoId as string))
    await thumbnails(page).nth(1).click()
    await expect(page.locator(`.photos-panel .img-thumbnail.selected[data-photo-id="${ids[1]}"]`)).toHaveCount(1)

    await thumbnails(page).nth(0).click()
    await expect(page.locator(`.photos-panel .img-thumbnail.selected[data-photo-id="${ids[0]}"]`)).toHaveCount(1)
    await expect(page.locator(`.photos-panel .img-thumbnail.selected[data-photo-id="${ids[1]}"]`)).toHaveCount(0)
  })

  test('@writes the assessment panel opens inside the editor', async ({ page }) => {
    await damageEventWithPhotos(page, ['loc_front'])

    await openEditor(page)
    await editor(page).locator('button[data-action="click->damage-editor#onBtnShowAssessment"]').click()

    await expect(editor(page).locator('.assessment-panel:not(.d-none)')).toBeVisible()
  })

  test('@writes a photo without an edited version cannot be excluded from the PDF', async ({ page }) => {
    await damageEventWithPhotos(page, ['loc_front'])

    await openEditor(page)
    const photoId = await thumbnails(page).first().getAttribute('data-photo-id')

    await expect(page.locator(`input#photo${photoId}`)).toBeDisabled()
  })
})
```

### `tests/app/send-flow.spec.ts`

```ts
import { test, expect } from '@playwright/test'
import { createBaseline, createDamageEvent } from '../../support/api'
import { sendPhotos, uploadAllRequiredPhotos } from '../../support/customer'
import { uniquePrefix } from '../../support/env'
import { expectRecordCount, filterBy } from '../../support/pages'

// "Sending" makes the app call the damage-prediction service for real. These tests are therefore OPT-IN:
// run them only against an environment whose prediction service is a stub or sandbox, by setting
//   E2E_ALLOW_SEND=true
// They are never run by default, so a normal run cannot trigger real predictions.
test.describe('sending photos for damage prediction', () => {
  test.skip(process.env.E2E_ALLOW_SEND !== 'true', 'Set E2E_ALLOW_SEND=true to run (calls the prediction service)')

  test('@writes the full customer flow: upload required photos, send, and return to the callback URL', async ({ page }) => {
    test.setTimeout(90_000)
    const record = await createDamageEvent({ vin: uniquePrefix('SEND'), location: 'loc_front' })
    await page.route('https://example.com/**', route => route.fulfill({ status: 200, contentType: 'text/html', body: '<h1>callback</h1>' }))

    await page.goto(record.customerPath)
    await expect(page.locator('#termOfService .btn-info.disabled')).toHaveCount(1)

    await uploadAllRequiredPhotos(page)

    await sendPhotos(page)

    // the page plays a short "sending" animation, then returns the customer to the callback URL
    await expect(page.locator('.damage-prediction-requested .loading')).toHaveCount(1)
    await expect(page.locator('.damage-prediction-requested .success')).toHaveCount(1, { timeout: 15_000 })
    await expect(page).toHaveURL('https://example.com/callback', { timeout: 15_000 })
  })

  test('@writes after sending, the record is listed as "Damage prediction requested"', async ({ page }) => {
    test.setTimeout(90_000)
    const record = await createDamageEvent({ vin: uniquePrefix('SEND'), location: 'loc_front' })
    await page.route('https://example.com/**', route => route.fulfill({ status: 200, contentType: 'text/html', body: 'ok' }))
    await page.goto(record.customerPath)
    await uploadAllRequiredPhotos(page)
    await sendPhotos(page)
    await expect(page).toHaveURL('https://example.com/callback', { timeout: 20_000 })

    await page.goto('/damage_events')
    await page.locator('#query_state').selectOption({ label: 'Damage prediction requested' })
    await filterBy(page, { query_vin: record.vin })
    await expectRecordCount(page, 'Damage Events', 1)
  })

  test('@writes after sending, the customer page no longer offers an enabled send button', async ({ page }) => {
    test.setTimeout(90_000)
    const record = await createDamageEvent({ vin: uniquePrefix('SEND'), location: 'loc_front' })
    await page.route('https://example.com/**', route => route.fulfill({ status: 200, contentType: 'text/html', body: 'ok' }))
    await page.goto(record.customerPath)
    await uploadAllRequiredPhotos(page)
    await sendPhotos(page)
    await expect(page).toHaveURL('https://example.com/callback', { timeout: 20_000 })

    await page.goto(record.customerPath)

    await expect(page.locator('a.btn-send:not(.disabled)')).toHaveCount(0)
  })

  // KNOWN APP BUG (see "App issues", item 10): the server does not check that the record is ready to send,
  // so a direct request succeeds even with no photos. This test describes the CORRECT behaviour and is marked
  // as an expected failure; when the app is fixed it will start "unexpectedly passing" - remove test.fail() then.
  test('@writes the server refuses to send a record that has no photos', async ({ request }) => {
    test.fail(true, 'Known bug: RequestsController#new does not check can_request_damage_prediction?')
    const record = await createBaseline({ vin: uniquePrefix('SEND') })

    const response = await request.get(`/damage_prediction/requests/new?resource=baseline&uuid=${record.uuid}`, {
      headers: { 'X-Requested-With': 'XMLHttpRequest', Accept: 'text/javascript' }
    })

    expect(response.status()).toBeGreaterThanOrEqual(400)
  })
})
```

### `.github/workflows/e2e.yml`

```yaml
name: E2E (staging)

on:
  workflow_dispatch:
    inputs:
      read_only:
        description: 'Skip tests that write files to storage (@writes)'
        type: boolean
        default: false
  schedule:
    - cron: '0 1 * * 1-5' # weekdays 01:00 UTC

concurrency:
  group: e2e-staging
  cancel-in-progress: false

jobs:
  e2e:
    runs-on: ubuntu-24.04
    timeout-minutes: 20
    env:
      BASE_URL: ${{ secrets.E2E_BASE_URL }}
      E2E_USER_EMAIL: ${{ secrets.E2E_USER_EMAIL }}
      E2E_USER_PASSWORD: ${{ secrets.E2E_USER_PASSWORD }}
      E2E_ACCOUNT_SID: ${{ secrets.E2E_ACCOUNT_SID }}
      E2E_SECRET_KEY: ${{ secrets.E2E_SECRET_KEY }}
      E2E_BASIC_AUTH_USER: ${{ secrets.E2E_BASIC_AUTH_USER }}
      E2E_BASIC_AUTH_PASSWORD: ${{ secrets.E2E_BASIC_AUTH_PASSWORD }}
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 20
          cache: npm
      - run: npm ci
      - run: npx playwright install --with-deps chromium
      - name: Run tests
        run: |
          if [ "${{ inputs.read_only }}" = "true" ]; then npm run test:readonly; else npm test; fi
      - uses: actions/upload-artifact@v4
        if: ${{ !cancelled() }}
        with:
          name: playwright-report
          path: |
            playwright-report/
            test-results/
          retention-days: 14
```

---

## 5. How it fits together

**Projects (`playwright.config.ts`)**

- `setup` logs in once through the real login form and stores the session in `playwright/.auth/user.json`.
- `app` runs `tests/app/**` already logged in (it reuses that session and depends on `setup`).
- `guest` runs `tests/guest/**` with no session: anonymous visitors and the customer-facing pages.

**Test data comes from the API (`support/api.ts`)**

1. `E2E_ACCOUNT_SID` / `E2E_SECRET_KEY` are exchanged for a short-lived bearer token via `POST /oauth/token`; `accessToken()` caches it until it expires.
2. `POST /api/v1/baseline`, `POST /api/v1/rental` and `POST /events/damage` create records. Keys are camelCase (`callbackUrl`, `licensePlate`, `damageEvent`), because the app converts them to snake_case.
3. The response contains `webApp.webUrl`, the customer link. The helper keeps only its path and UUID. The API does **not** return the numeric record id, so tests that need it (`/baselines/:id`, `/pdf?id=`) read it from the index page by searching for the record's unique VIN (`recordIdFromIndex`).

**Photos come from the customer page (`support/customer.ts`).** There is no API for photos, so tests upload real JPEGs through the customer page, exactly as a customer would. The JPEG is rendered by the browser itself, so no binary fixture is committed.

**Prediction results are delivered by the test (`deliverPredictionResult`).** The real prediction service reports back by calling an open endpoint, `POST /damage_prediction/results?resource=<type>&uuid=<uuid>`. The test makes that same call with a small payload. The app then creates assessments in a background job, which is the genuine production code path. Assessments created this way are marked "AI" and are read-only in the UI; tests that edit, delete or toggle an assessment first add a human one through the UI.

**Unique data (`uniquePrefix`)** gives every run its own VIN prefix such as `FLT-MABC12-X7Q2Z`. Filters are substring-based and case-insensitive, so a test can filter by its own prefix and never see anyone else's data. Pagination uses the same idea: the test creates its own 21 records and filters by its prefix.

---

## 6. Running the tests

| Goal | Command |
|---|---|
| Everything that is on by default | `npm test` |
| Skip tests that write files or records | `npm run test:readonly` |
| One file | `npx playwright test tests/app/prices.spec.ts` |
| One test by name | `npx playwright test -g "sort by VIN"` |
| Watch the browser | `npm run test:headed` |
| Interactive UI mode | `npm run test:ui` |
| Open the last HTML report | `npm run report` |
| Open a failure trace | `npx playwright show-trace test-results/<test-folder>/trace.zip` |
| Record a new test | `npx playwright codegen $BASE_URL` |

Failures keep a trace, screenshot and video in `test-results/`.

---

## 7. Opt-in tests and tags

**`@writes`** marks tests that leave something behind on the environment: an uploaded photo, a damage event with assessments, an imported price. Run `npm run test:readonly` to skip them. Note that every test creates records through the API (baselines, rentals, damage events), which cannot be deleted from the UI. The `@writes` tag is about the extra writes, so "readonly" still creates API records.

**Opt-in tests** are skipped unless you switch them on, because they need something the suite cannot safely assume.

| Switch | Enables | Why it is opt-in |
|---|---|---|
| `E2E_ALLOW_SEND=true` | `tests/app/send-flow.spec.ts` (5 tests): upload all required photos, press Send, see the animation and the redirect to the callback URL, state becomes "Damage prediction requested", send button disappears, plus the missing-server-check bug test | Pressing Send makes the app call the **real damage-prediction service**. Enable it only on an environment whose service is a stub or sandbox. |
| `E2E_EXPIRED_PATHS=/damage_photo/baselines/<uuid>,...` | `tests/guest/expired-links.spec.ts` (2 tests per path): the link returns 410 and the upload page does not open | A test cannot create a record in the past. Point it at records that already expired (baselines and rentals expire after 2 weeks, damage events after 12 months), or backdate `created_at` on a throwaway record from a console. |

Without these switches the report shows the tests as skipped, with the reason.

---

## 8. CI (GitHub Actions)

`.github/workflows/e2e.yml` (included in section 4) runs the suite on demand and on weekdays at 01:00 UTC. Create these repository secrets: `E2E_BASE_URL`, `E2E_USER_EMAIL`, `E2E_USER_PASSWORD`, `E2E_ACCOUNT_SID`, `E2E_SECRET_KEY`, and optionally `E2E_BASIC_AUTH_USER` / `E2E_BASIC_AUTH_PASSWORD`. The report and traces are uploaded as an artifact. The workflow was syntax-checked but not executed on GitHub. The opt-in switches are deliberately **not** set in the workflow; add them to its `env:` block only for an environment where that is safe.

---

## 9. What is covered

### Ported from the Ruby specs

| Area | Playwright file | Ruby spec it came from |
|---|---|---|
| Guest redirects, wrong password, unknown email, return-to page, logout, CSV 401, Sidekiq locked | `tests/guest/auth.spec.ts` | `authentication_edge_cases_spec.rb`, `user_login_spec.rb` |
| Customer pages: 404s, baseline page, send disabled, thank-you (EN/JA) | `tests/guest/customer-pages.spec.ts` | `customer_pages_spec.rb`, `send_flow_spec.rb` |
| Customer upload: rejected file, valid upload, valid after rejected | `tests/guest/customer-upload.spec.ts` | `upload_errors_spec.rb` |
| Navbar, login redirect, `/errors` 404, unknown record 404 | `tests/app/navigation.spec.ts` | `navigation_spec.rb` |
| Index filtering, sorting, combined filters, reset, CSV link | `tests/app/index-filters.spec.ts` | `index_filters_spec.rb` |
| CSV export (filter, separator, dashes) | `tests/app/csv-export.spec.ts` | `csv_export_spec.rb` |
| Pricing create / update / delete / validations / dismiss confirm | `tests/app/prices.spec.ts` | `prices_spec.rb` |
| Pricing CSV import (valid, invalid rows, malformed, header-only, no file) | `tests/app/prices-import.spec.ts` | `prices_import_spec.rb` |

### Previously "not ported", now covered

| Item | How it is done now | File |
|---|---|---|
| Expired links (410) | Cannot be created from outside, so the test uses links that already expired, supplied through `E2E_EXPIRED_PATHS` (opt-in, visible as skipped when unset) | `tests/guest/expired-links.spec.ts` |
| Exact date assertions | Asserts the **format** (`dd Mon yyyy, hh:mm AM/PM`) on the index, the record page and the CSV, and that a new record's date is recent, instead of freezing the clock | `tests/app/dates.spec.ts` |
| The "send" action | Full customer flow with real photo uploads, opt-in via `E2E_ALLOW_SEND` so it never calls a real prediction service by accident. Also an expected-failure test for the missing server-side check (bug 10) | `tests/app/send-flow.spec.ts` |
| Assessment CRUD | The test delivers a prediction result (as the real service would), then checks the AI assessment, adds, edits, deletes and toggles human assessments, validations, dismiss-confirm, and the labor/paint rates form | `tests/app/assessments.spec.ts` |
| Include-to-PDF toggles | Assessment include checkbox (persists after reload) and "a photo without an edited version cannot be excluded" | `tests/app/assessments.spec.ts`, `tests/app/gallery.spec.ts` |
| Gallery and editor | Photos uploaded through the customer page; open and close the editor, its panels, switch between photos, assessment panel, empty gallery | `tests/app/gallery.spec.ts` |
| Pagination | Creates 21 records under its own prefix, so it never depends on shared data; page 1 has 20 rows, page 2 has 1, the filter survives page changes | `tests/app/pagination.spec.ts` |
| `/pdf` report | The numeric id is read from the index page. Checks the HTML (debug) rendering for baseline, damage event and rental, that the real `.pdf` is a valid PDF, guest access, 404 and 400 | `tests/app/pdf.spec.ts` |
| State filter | New records start in "New", which is enough to prove the filter works in both directions (selecting another state shows none) | `tests/app/state-filter.spec.ts` |

### Still not covered (honest limits)

| Not covered | Why |
|---|---|
| Include/exclude toggle on a photo that **has** an edited version | The edited version is created by drawing in the photo editor and saving; that interaction is too fragile to drive reliably. It stays in the RSpec suite |
| The terms-of-service checkbox | Its card is hidden in the page markup (`d-none`), so there is nothing to click |
| Prior-photo toggles on a damage event | Needs a baseline in the "internal reviewed" state, which has no safe way to be set from outside |
| Calling the real prediction service | Never done by default; only the opt-in send tests do it |
| Photos the prediction service would annotate | In production the service writes annotated images to storage; the test only delivers the assessment data |

---

## 10. Conventions for writing more tests

- **Create data through `support/api.ts`**, with `uniquePrefix()` in the VIN, and find it in the UI by that prefix. Never assume the table is empty; staging is shared.
- **Clean up what you can.** Pricing tests delete their own record. Baselines, rentals and damage events have no delete in the UI, so they accumulate. The `E2E-`/test prefixes make them easy to purge later.
- **Use auto-waiting assertions** (`expect(locator).toHaveCount(...)`, `toContainText`). There are no `sleep` calls, so do not add any.
- **After an action that navigates, poll.** Reading `allInnerTexts()` right after a click can hit a page mid-navigation. Use `await expect.poll(() => columnTexts(...))`.
- **Wait for the specific flash message, not the last one.** Older messages stay on screen, so reading "the last alert" can return a stale one. Use `expectFlash(page, 'text')`.
- **Wait for async parts before reading them.** The customer page loads its car parts asynchronously (`requiredCarParts` waits for them), and the editor disables its panels while an image loads (`openEditor` waits for that). Reading too early returns an empty list or hits a disabled control.
- **New contexts inherit the project's signed-in session.** `browser.newContext()` and `playwright.request.newContext()` inside the `app` project are **not** guests. Use `newGuestContext()` (`support/guest.ts`), which passes an explicit empty `storageState`. A "guest" check that silently runs as a logged-in user proves nothing.
- **The app prints decimals without trailing zeros** (`925.00` appears as `925.0`). Tests that look a record up by a number must use values that do not end in 0 (`uniqueCost()` does this).
- **Number inputs cannot hold letters.** You cannot type `abc` into a number field in a real browser, so a "not a number" check has to be a negative-value check instead.
- **Table cell text has no spaces between cells** (`Front DoorMissing10.79Replace`). Match with `\s*`, not `\s+`.
- **Prefer roles, labels and ids** (`getByRole`, `getByLabel`, `#query_vin`) over CSS classes. Pagination links are named for accessibility (`Page 2`), not `2`.
- **Translating Capybara:** `within('#x') { click_on 'Save' }` becomes `page.locator('#x').getByRole('button', { name: 'Save' }).click()`; `accept_confirm` becomes `page.once('dialog', d => d.accept())` registered **before** the click; `attach_file` becomes `locator.setInputFiles(...)`, called on the hidden `<input>` when the visible control is only a label.
- **Do not weaken a test to make it pass.** If something fails only against a real environment, find out why (open the trace) rather than adding force-clicks or longer timeouts.

---

## 11. Troubleshooting

| Symptom | Likely cause and fix |
|---|---|
| `Missing environment variable ...` | `.env` is missing or incomplete; compare with `.env.example` |
| `POST /api/v1/baseline -> ...` 401 | `E2E_ACCOUNT_SID` / `E2E_SECRET_KEY` is invalid or belongs to a different environment |
| `POST /oauth/token -> ...` non-200 | `E2E_ACCOUNT_SID` / `E2E_SECRET_KEY` is wrong, or the account can't request a token on this environment |
| `POST /api/v1/baseline -> ...` 422 | Staging validation rejected the payload; the message is in the assertion text |
| Setup test fails at "Log in" | Wrong user credentials, or staging is behind basic auth (set `E2E_BASIC_AUTH_*`) |
| Pricing link/tests fail | The environment runs in production mode, where the Pricing menu is hidden; skip `prices*.spec.ts` and the Pricing test in `navigation.spec.ts` |
| Assessment tests time out waiting for the first row | The background worker is not running, or it failed processing the delivered result (check the worker log); also check that object storage is reachable, because the job lists annotated images from it |
| Gallery tests time out in the editor, or photos never load | The editor stays disabled while images fail to load. The app builds image URLs from its configured domain (`APP_DOMAIN`); if that does not match the URL you test against, images 404 or hit another host |
| Upload tests time out on save | Storage (S3) credentials missing on staging, or the first-time camera tooltip did not dismiss; open the trace |
| Send tests: the flow never leaves the page | The prediction service rejected or did not answer the call; check what `DAMAGE_ASSESSMENT_URL` points to on that environment |
| A "guest" test unexpectedly passes or sees logged-in content | The context inherited the project's session; use `newGuestContext()` |
| Intermittent failures | Run with `--repeat-each=5 -g "<name>"` to reproduce, then open the trace; add an `expect.poll` or a more specific wait, never a sleep |
| `crypto is not defined` | Node older than 20; upgrade |

---

## 12. What was verified, and how

The suite was run against a local copy of the app: Rails in its test environment, a throwaway PostgreSQL database, a user and OAuth application created with the console snippet from section 2, and a small mock HTTP server standing in for the prediction service. The project was then rebuilt in a clean folder from the files in section 4 and run again.

Two things were adapted **only for that local run** (they are not part of the app or of this project):

- The local app has no S3 and no worker. A small throwaway shim ran background jobs on the in-process async adapter and skipped the step that lists annotated images from S3. On staging both are real, so the first staging run is the real proof of that part of the pipeline (assessment tests).
- The app's configured domain was set to the local address so that image URLs resolve (see Troubleshooting).

What this means in practice: UI selectors, the API contract, the customer upload flow, the send flow (against a mock), pagination, filters, CSV, PDF and the expired-link responses were exercised against the real application code. Behaviour that depends on your staging infrastructure (worker, storage, the real prediction service, HTTP basic auth, production-mode settings) is what the first staging run will confirm.

---

## 13. App issues found while building the tests

These are real problems in the `bosch` app, found while writing both test suites. **None have been fixed.** Items marked (T) are currently encoded in a test, so that test must change when the app is fixed.

1. **No error on a failed login.** `app/views/layouts/devise.html.slim` never renders flash messages, so a wrong password shows nothing. (T) The login-failure tests only check that you stay on the login page; once fixed, assert the "Invalid Email or password" text.
2. **Pricing "Side2" column shows Side1.** `app/views/prices/index.html.slim` renders `price.side1` in the Side2 column.
3. **Duplicate sort scope.** `app/models/price.rb` defines `sorted_by_side1` twice; the second orders by `side2`, so sorting by Side1 actually sorts by Side2.
4. **Empty import is a bare 400.** Importing with no file selected returns JSON `{"error":"Parameter missing"}` instead of an on-page message. (T) `submitting without a file is rejected` expects 400.
5. **`PricesController` uses `CSV` without requiring it.** Import only works if another controller loaded the library first; in isolation it fails with `uninitialized constant PricesController::CSV`. Add `require 'csv'` to `app/controllers/prices_controller.rb`.
6. **Unsupported resource type crashes.** `/pdf?resource=user&id=1` raises an unhandled `KeyError` (500) in `RequiredResource` instead of a 4xx.
7. **The PDF report is `.pdf`-only.** `/pdf` returns 406 for HTML; it needs wkhtmltopdf and an explicit `.pdf` format.
8. **Guest CSV export gets a bare 401** instead of a redirect to login (Devise's default for non-HTML formats). (T) `a guest is not authorized to export CSV` expects 401.
9. **Pricing navbar markup.** In `app/views/layouts/_header.html.slim` the Pricing link sits outside its `li.nav-item` because of indentation.
10. **No server-side check before sending (most serious).** `DamagePrediction::RequestsController#new` never checks `can_request_damage_prediction?`. This was **confirmed against the real endpoint**: a direct request for a record with no photos returns 200, moves it to `damage_prediction_requested` and calls the prediction service. Only the browser button is guarded. (T) `tests/app/send-flow.spec.ts` has a test that describes the correct behaviour (status 400 or higher) and is marked `test.fail(...)`. When the app is fixed that test will report "expected to fail, but passed"; remove the `test.fail(...)` line then. In RSpec, the matching `pending` spec in `send_flow_spec.rb` does the same.
11. **Unreachable prediction service crashes.** The same controller lets the connection error through, so the customer sees nothing (the record's state does stay `new`).
12. **Decimals lose trailing zeros in the UI** (`925.00` shows as `925.0`), which is unexpected for money values in the Pricing table.

Not bugs, but worth knowing: assessments delivered by the prediction service are read-only in the UI; the page's "add assessment" button is hidden (`d-none`) and is driven by the photo editor; and the damage event page shows a "Not found baseline" warning when no baseline shares its VIN.

---

## 14. Quick checklist

- [ ] Staging user and OAuth app created; secrets collected
- [ ] Staging has a running background worker and working object storage
- [ ] Project created with the files from section 4; `.env` filled in
- [ ] `npm install`, `npx playwright install --with-deps chromium`
- [ ] `npm run typecheck` clean
- [ ] `npm run test:readonly` green against staging
- [ ] `npm test` green against staging (writes some records, uploaded photos and one price per related test)
- [ ] Decided whether the prediction service on staging is a stub; if so, try `E2E_ALLOW_SEND=true`
- [ ] Picked expired records for `E2E_EXPIRED_PATHS` (optional)
- [ ] CI secrets added and the workflow triggered once manually
- [ ] Decision made on data purge for the test records
