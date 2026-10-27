import { test, expect, Page } from '@playwright/test'
import { createBaseline, createDamageEvent, createRental, deliverPredictionResult } from '../../support/api'
import { uniquePrefix } from '../../support/env'
import { authenticatedPage, expectFlash, recordIdFromIndex } from '../../support/pages'

// A record only has assessments once the prediction service has delivered a result. Each describe block below
// plays the part of that service (deliverPredictionResult) for its own resource, so the whole pipeline is
// exercised: callback -> background job -> assessments -> BackOffice page. Needs the environment's background
// worker (Sidekiq) to be running.
//
// The assessment table/modal markup (#newAssessmentModal, .assessment-table, .btn-edit-assessment, ...) is an
// identical shared partial across baselines, rentals and damage events - confirmed against the real pages, not
// assumed - so the CRUD tests themselves (sharedAssessmentCrudTests) are written once and reused by all three
// describe blocks below. What does NOT generalise: only damage events expose the labor/paint rate form
// (#damage_event_labor_rate), so that test stays in the damage-events block alone.
//
// Each describe block shares one seeded record (beforeAll) instead of every test creating its own, to keep the
// shared staging environment's footprint down. That only works because every test that adds a human assessment
// also removes it before finishing, so each test still starts from the same baseline: exactly the one AI
// assessment from the seed. Serial mode is required - the tests are not independent, they rely on running in
// this order with no overlap.

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

async function fillAssessment(modal: ReturnType<Page['locator']>, values: { carPart: string; side1: string; side2: string; treatment: string }) {
  await modal.locator('#damage_prediction_assessment_car_part').selectOption({ label: values.carPart })
  await modal.locator('#damage_prediction_assessment_side1').selectOption({ label: values.side1 })
  await modal.locator('#damage_prediction_assessment_side2').selectOption({ label: values.side2 })
  await modal.locator('#damage_prediction_assessment_treatment').selectOption({ label: values.treatment })
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

/** Undoes addHumanAssessment, restoring the shared record to its baseline of just the AI assessment. */
async function deleteHumanAssessment(page: Page) {
  page.once('dialog', dialog => dialog.accept())
  await humanRow(page).locator('.btn-delete-assessment').click()
  await expect(humanRow(page)).toHaveCount(0)
  await expect(rows(page)).toHaveCount(1)
}

/** The CRUD tests every resource's assessment table supports. `recordPath` re-reads the current record's URL. */
function sharedAssessmentCrudTests(recordPath: () => string) {
  test('@writes the prediction result shows up as an assessment and moves the record to "resulted"', async ({ page }) => {
    await expect(rows(page).first()).toContainText(/Front Door\s*Missing\s*1\s*0\.79\s*Replace/)
    await expect(page.locator('table.basic-info')).toContainText('Damage prediction resulted')
  })

  test('@writes I can add an assessment with a damage detail', async ({ page }) => {
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

    await deleteHumanAssessment(page)
  })

  test('@writes I cannot add an assessment with a negative labor value', async ({ page }) => {
    await openNewAssessmentModal(page)

    const modal = page.locator('#newAssessmentModal')
    await fillAssessment(modal, { carPart: 'Hood', side1: 'Rear', side2: 'Left', treatment: 'Repair' })
    await modal.locator('#damage_prediction_assessment_labor_hour').fill('-3')
    await modal.getByRole('button', { name: 'Save' }).click()

    await expect(modal).toContainText('must be greater than 0')
    await expect(rows(page)).toHaveCount(1)
  })

  test('@writes I cannot add a damage detail with an out-of-range confidence', async ({ page }) => {
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
    await expect(rows(page).first().locator('.btn-edit-assessment')).toHaveCount(0)
    await expect(rows(page).first().locator('.btn-delete-assessment')).toHaveCount(0)
    await expect(rows(page).first()).toContainText('AI')
  })

  test('@writes I can edit an assessment', async ({ page }) => {
    await addHumanAssessment(page)

    await humanRow(page).locator('.btn-edit-assessment').click()
    const modal = page.locator('#editAssessmentModal')
    await expect(modal).toBeVisible()
    await modal.locator('#damage_prediction_assessment_labor_hour').fill('1.89')
    await modal.locator('#damage_prediction_assessment_material_cost').fill('600.66')
    await modal.getByRole('button', { name: 'Save' }).click()

    await expectFlash(page, 'Assessment was successfully updated')
    await expect(humanRow(page)).toContainText(/1\.89\s*600\.66/)

    await deleteHumanAssessment(page)
  })

  test('@writes an invalid edit is rejected and the assessment is unchanged', async ({ page }) => {
    await addHumanAssessment(page)

    await humanRow(page).locator('.btn-edit-assessment').click()
    const modal = page.locator('#editAssessmentModal')
    await expect(modal).toBeVisible()
    await modal.locator('#damage_prediction_assessment_labor_hour').fill('-1')
    await modal.getByRole('button', { name: 'Save' }).click()

    await expect(modal).toContainText('must be greater than 0')
    await modal.locator('.btn-close').first().click()
    await expect(humanRow(page)).toContainText(/Hood\s*Crack/)

    await deleteHumanAssessment(page)
  })

  test('@writes the assessment stays when I dismiss the delete confirmation, and goes when I accept', async ({ page }) => {
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
    await addHumanAssessment(page)
    const checkbox = humanRow(page).locator('input[type="checkbox"]')
    const wasChecked = await checkbox.isChecked()

    await checkbox.click()
    await expect(checkbox).toBeChecked({ checked: !wasChecked })

    await page.goto(recordPath())
    await expect(humanRow(page).locator('input[type="checkbox"]')).toBeChecked({ checked: !wasChecked })

    await deleteHumanAssessment(page)
  })
}

test.describe('assessments (damage events)', () => {
  test.describe.configure({ mode: 'serial' })

  test.beforeEach(({}, testInfo) => {
    testInfo.annotations.push({ type: 'writes', description: 'creates a damage event with assessments' })
  })

  let damageEventId: number

  test.beforeAll(async ({ browser }) => {
    const record = await createDamageEvent({ vin: uniquePrefix('ASSESS') })
    await deliverPredictionResult(record, [
      { carpart: 'door', side_1: 'front', side_2: 'n_a', treatment: 'replace', confidence: [0.79], damage: [['missing', 1]] }
    ])
    const page = await authenticatedPage(browser)
    damageEventId = await recordIdFromIndex(page, '/damage_events', record.vin)
    await page.goto(`/damage_events/${damageEventId}`)
    await expect(page.locator('.assessment-table tbody tr')).toHaveCount(1)
    await page.context().close()
  })

  test.beforeEach(async ({ page }) => {
    await page.goto(`/damage_events/${damageEventId}`)
  })

  sharedAssessmentCrudTests(() => `/damage_events/${damageEventId}`)

  test('@writes I can update the labor and paint rates', async ({ page }) => {
    await page.locator('#damage_event_labor_rate').fill('12.50')
    await page.locator('#damage_event_paint_rate').fill('16.50')
    await page.getByRole('button', { name: 'Update Rates' }).click()

    await expectFlash(page, 'Labor rate and Paint labor rate was successfully updated')
  })
})

test.describe('assessments (baselines)', () => {
  test.describe.configure({ mode: 'serial' })

  test.beforeEach(({}, testInfo) => {
    testInfo.annotations.push({ type: 'writes', description: 'creates a baseline with assessments' })
  })

  let baselineId: number

  test.beforeAll(async ({ browser }) => {
    const record = await createBaseline({ vin: uniquePrefix('ASSESS') })
    await deliverPredictionResult(record, [
      { carpart: 'door', side_1: 'front', side_2: 'n_a', treatment: 'replace', confidence: [0.79], damage: [['missing', 1]] }
    ])
    const page = await authenticatedPage(browser)
    baselineId = await recordIdFromIndex(page, '/baselines', record.vin)
    await page.goto(`/baselines/${baselineId}`)
    await expect(page.locator('.assessment-table tbody tr')).toHaveCount(1)
    await page.context().close()
  })

  test.beforeEach(async ({ page }) => {
    await page.goto(`/baselines/${baselineId}`)
  })

  sharedAssessmentCrudTests(() => `/baselines/${baselineId}`)
})

test.describe('assessments (rentals)', () => {
  test.describe.configure({ mode: 'serial' })

  test.beforeEach(({}, testInfo) => {
    testInfo.annotations.push({ type: 'writes', description: 'creates a rental with assessments' })
  })

  let rentalId: number

  test.beforeAll(async ({ browser }) => {
    const record = await createRental({ vin: uniquePrefix('ASSESS') })
    await deliverPredictionResult(record, [
      { carpart: 'door', side_1: 'front', side_2: 'n_a', treatment: 'replace', confidence: [0.79], damage: [['missing', 1]] }
    ])
    const page = await authenticatedPage(browser)
    rentalId = await recordIdFromIndex(page, '/rentals', record.vin)
    await page.goto(`/rentals/${rentalId}`)
    await expect(page.locator('.assessment-table tbody tr')).toHaveCount(1)
    await page.context().close()
  })

  test.beforeEach(async ({ page }) => {
    await page.goto(`/rentals/${rentalId}`)
  })

  sharedAssessmentCrudTests(() => `/rentals/${rentalId}`)
})
