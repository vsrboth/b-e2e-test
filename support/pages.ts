import { Browser, Page, Locator, expect } from '@playwright/test'
import { AUTH_FILE } from '../playwright.config'

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
 * Finds a 'tbody tr' row containing hasText, starting from `${basePath}?${filterQuery}` and following
 * "Next" through pagination until it is found. Indexes like /prices have no per-record unique filter, so a
 * freshly created row can land on any page once the shared environment has more than one page of records
 * (will_paginate defaults to 20/page) - searching only the current page, as a plain locator would, is not
 * reliable on a shared environment.
 */
export async function findRow(page: Page, basePath: string, filterQuery: string, hasText: string): Promise<Locator> {
  await page.goto(`${basePath}?${filterQuery}`)
  for (;;) {
    const candidate = page.locator('tbody tr', { hasText })
    if (await candidate.count() > 0) return candidate
    const next = page.locator('.pagination a.next_page')
    if (await next.count() === 0) return candidate
    await next.click()
  }
}

/**
 * A signed-in page outside the per-test `page` fixture (which only exists inside a test), for seeding a
 * fixture shared by a whole describe block from `test.beforeAll`. Caller is responsible for closing the
 * returned page's context once done with it.
 */
export async function authenticatedPage(browser: Browser): Promise<Page> {
  const httpCredentials = process.env.E2E_BASIC_AUTH_USER
    ? { username: process.env.E2E_BASIC_AUTH_USER, password: process.env.E2E_BASIC_AUTH_PASSWORD ?? '' }
    : undefined
  const context = await browser.newContext({ storageState: AUTH_FILE, baseURL: process.env.BASE_URL, httpCredentials })
  return context.newPage()
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
