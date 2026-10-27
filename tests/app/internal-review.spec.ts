import { test, expect, Page } from '@playwright/test'
import { createBaseline, createRental, deliverPredictionResult } from '../../support/api'
import { uniquePrefix } from '../../support/env'
import { authenticatedPage, recordIdFromIndex } from '../../support/pages'

// Classifying the result (No damage / Has damage / Nonsense) and marking Internal Reviewed is a
// Bosch-staff-only workflow, exposed for baselines and rentals (not damage events - that resource's
// #assessmentButtons renders empty in every state). The two resources differ in a few ways this file
// has to account for:
//   - baselines show the classification bar even with zero assessments (defaulting to "No damage");
//     rentals need at least one assessment before it renders at all, so every rental test here seeds one.
//   - baselines auto-default to "Has damage" once an assessment exists; rentals do NOT - they stay on
//     "No new damage" even with a real assessment present, confirmed below rather than assumed.
//   - the button labels differ ("Has damage" vs "New damage", "No damage" vs "No new damage"), though
//     the underlying damage_detected values and confirm-dialog text are identical.
//   - rentals have an extra "Show Price" toggle baselines don't have.
const activeClassification = (page: Page) => page.locator('#assessmentButtons .btn-success')
const classificationLink = (page: Page, label: string) => page.locator('.btn-new-damage-detected', { hasText: label })

async function classify(page: Page, label: string, confirmText: string) {
  page.once('dialog', dialog => {
    expect(dialog.message()).toBe(confirmText)
    return dialog.accept()
  })
  await classificationLink(page, label).click()
}

// Every action here is reversible (the app lets you switch classification, and even "unmark" Internal
// Reviewed), so each describe block below shares one seeded record across its tests via beforeAll and
// runs serially, instead of every test seeding its own - there is no cleanup step needed between tests
// the way assessments.spec.ts needs one.
test.describe('internal review (baselines)', () => {
  test.describe.configure({ mode: 'serial' })

  test.beforeEach(({}, testInfo) => {
    testInfo.annotations.push({ type: 'writes', description: 'classifies and reviews a baseline' })
  })

  let baselineId: number

  test.beforeAll(async ({ browser }) => {
    const record = await createBaseline({ vin: uniquePrefix('REVIEW') })
    await deliverPredictionResult(record, [])
    const page = await authenticatedPage(browser)
    baselineId = await recordIdFromIndex(page, '/baselines', record.vin)
    await page.context().close()
  })

  test.beforeEach(async ({ page }) => {
    await page.goto(`/baselines/${baselineId}`)
  })

  test('@writes a resulted baseline with no assessments defaults to "No damage"', async ({ page }) => {
    await expect(activeClassification(page)).toHaveText('No damage')
    await expect(classificationLink(page, 'Has damage')).toBeVisible()
    await expect(classificationLink(page, 'Nonsense')).toBeVisible()
  })

  test('@writes the classification stays when I dismiss the confirmation', async ({ page }) => {
    page.once('dialog', dialog => dialog.dismiss())
    await classificationLink(page, 'Has damage').click()

    await expect(activeClassification(page)).toHaveText('No damage')
  })

  test('@writes I can classify the baseline as "Has damage"', async ({ page }) => {
    await classify(page, 'Has damage', 'Would you like to update Damage Detected ?')

    await expect(activeClassification(page)).toHaveText('Has damage')
    await expect(classificationLink(page, 'No damage')).toBeVisible()

    await page.reload()
    await expect(activeClassification(page)).toHaveText('Has damage')
  })

  test('@writes I can classify the baseline as "Nonsense"', async ({ page }) => {
    await classify(page, 'Nonsense', 'Beware !!! Are you sure that all photos and assessments are not related ?')

    await expect(activeClassification(page)).toHaveText('Nonsense')
  })

  test('@writes marking Internal Reviewed locks the classification and finalizes the PDF', async ({ page }) => {
    page.once('dialog', dialog => {
      expect(dialog.message()).toBe('Would you like to mark Internal Reviewed ?')
      return dialog.accept()
    })
    await page.locator('.btn-internal-reviewed').click()

    await expect(page.locator('table.basic-info')).toContainText('Internal reviewed')
    // the classification becomes a fixed badge - no more "switch to X" links
    await expect(page.locator('.btn-new-damage-detected')).toHaveCount(0)
    await expect(page.locator('.btn-preview-pdf')).toHaveText(/Uploaded PDF/)
  })

  test('@writes unmarking Internal Reviewed re-opens the record for classification', async ({ page }) => {
    page.once('dialog', dialog => {
      expect(dialog.message()).toBe('Would you like to unmark Internal Reviewed ?')
      return dialog.accept()
    })
    await page.locator('.btn-internal-reviewed').click()

    await expect(page.locator('table.basic-info')).toContainText('Damage prediction resulted')
    await expect(page.locator('.btn-new-damage-detected')).toHaveCount(2)
    await expect(page.locator('.btn-preview-pdf')).toHaveText(/Preview PDF/)
  })
})

test.describe('internal review (rentals)', () => {
  test.describe.configure({ mode: 'serial' })

  test.beforeEach(({}, testInfo) => {
    testInfo.annotations.push({ type: 'writes', description: 'classifies and reviews a rental' })
  })

  let rentalId: number

  test.beforeAll(async ({ browser }) => {
    const record = await createRental({ vin: uniquePrefix('REVIEW') })
    // unlike baselines, the classification bar does not render for a rental with zero assessments
    await deliverPredictionResult(record, [
      { carpart: 'door', side_1: 'front', side_2: 'n_a', treatment: 'replace', confidence: [0.79], damage: [['missing', 1]] }
    ])
    const page = await authenticatedPage(browser)
    rentalId = await recordIdFromIndex(page, '/rentals', record.vin)
    await page.context().close()
  })

  test.beforeEach(async ({ page }) => {
    await page.goto(`/rentals/${rentalId}`)
  })

  test('@writes a resulted rental with an assessment still defaults to "No new damage"', async ({ page }) => {
    await expect(activeClassification(page)).toHaveText('No new damage')
    await expect(classificationLink(page, 'New damage')).toBeVisible()
    await expect(classificationLink(page, 'Nonsense')).toBeVisible()
  })

  test('@writes I can classify the rental as "New damage"', async ({ page }) => {
    await classify(page, 'New damage', 'Would you like to update Damage Detected ?')

    await expect(activeClassification(page)).toHaveText('New damage')

    await page.reload()
    await expect(activeClassification(page)).toHaveText('New damage')
  })

  test('@writes I can toggle whether the price is shown', async ({ page }) => {
    page.once('dialog', dialog => {
      expect(dialog.message()).toBe('Would you like to mark this rental do not show price ?')
      return dialog.accept()
    })
    await page.locator('.btn-show-price').click()
    await page.waitForTimeout(500) // the AJAX response updates data-confirm in place, no visible change to assert on

    page.once('dialog', dialog => {
      expect(dialog.message()).toBe('Would you like to mark this rental will show price ?')
      return dialog.accept()
    })
    await page.locator('.btn-show-price').click()
  })

  test('@writes marking Internal Reviewed locks the classification and finalizes the PDF', async ({ page }) => {
    page.once('dialog', dialog => {
      expect(dialog.message()).toBe('Would you like to mark Internal Reviewed ?')
      return dialog.accept()
    })
    await page.locator('.btn-internal-reviewed').click()

    await expect(page.locator('table.basic-info')).toContainText('Internal reviewed')
    await expect(page.locator('.btn-new-damage-detected')).toHaveCount(0)
    await expect(page.locator('.btn-preview-pdf')).toHaveText(/Uploaded PDF/)
  })

  test('@writes unmarking Internal Reviewed re-opens the record for classification', async ({ page }) => {
    page.once('dialog', dialog => {
      expect(dialog.message()).toBe('Would you like to unmark Internal Reviewed ?')
      return dialog.accept()
    })
    await page.locator('.btn-internal-reviewed').click()

    await expect(page.locator('table.basic-info')).toContainText('Damage prediction resulted')
    await expect(page.locator('.btn-new-damage-detected')).toHaveCount(2)
  })
})
