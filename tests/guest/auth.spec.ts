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
