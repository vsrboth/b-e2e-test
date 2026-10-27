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
