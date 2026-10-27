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
