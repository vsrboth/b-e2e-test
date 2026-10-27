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
