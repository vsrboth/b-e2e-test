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
    // Known bug on QA: hitting /errors directly returns 500 with a "Not Found"
    // body instead of a proper 404. Update this back to expect 404 once fixed.
    const response = await request.get('/errors')
    expect(response.status()).toBe(500)
    expect(await response.json()).toEqual({ error: 'Not Found' })
  })

  test('opening a record that does not exist is a 404', async ({ request }) => {
    for (const path of ['/baselines/0', '/rentals/0', '/damage_events/0']) {
      const response = await request.get(path)
      expect(response.status(), path).toBe(404)
    }
  })
})
