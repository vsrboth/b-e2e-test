# E2E Test Checklist

Generated from `npx playwright test --list`. 142 tests across 18 files — 135 passing, 7 skipped by
default (gated behind `E2E_ALLOW_SEND=true`, see `tests/app/send-flow.spec.ts`).

`✍️` marks a `@writes` test (creates/modifies data on the shared staging environment).

## tests/app/assessments.spec.ts — assessments

Shared CRUD test bodies run once and are reused across all three resources (the assessment table/modal
markup is identical for baselines, rentals and damage events); labor/paint rates are a damage-event-only
field.

**assessments (damage events)**
- [x] ✍️ the prediction result shows up as an assessment and moves the record to "resulted"
- [x] ✍️ I can add an assessment with a damage detail
- [x] ✍️ I cannot add an assessment with a negative labor value
- [x] ✍️ I cannot add a damage detail with an out-of-range confidence
- [x] ✍️ the prediction (AI) assessment is read-only
- [x] ✍️ I can edit an assessment
- [x] ✍️ an invalid edit is rejected and the assessment is unchanged
- [x] ✍️ the assessment stays when I dismiss the delete confirmation, and goes when I accept
- [x] ✍️ including an assessment in the PDF can be switched off and the choice is kept after reload
- [x] ✍️ I can update the labor and paint rates

**assessments (baselines)** and **assessments (rentals)**
- [x] ✍️ the same 9 CRUD tests as above, minus "I can update the labor and paint rates" (damage-event only)

## tests/app/csv-export.spec.ts — CSV export

- [x] the export respects my filter and uses `;` as separator
- [x] blank values are exported as a dash

## tests/app/dates.spec.ts — date display

- [x] the index shows the created date in "dd Mon yyyy, hh:mm AM/PM" format
- [x] a record created now is shown with today's date
- [x] the record page shows the same format under "Created Date"
- [x] the CSV export uses the same date format

## tests/app/gallery.spec.ts — photo gallery and editor

Shared test bodies run once and are reused across all three resources (the gallery/editor markup is
identical for baselines, rentals and damage events).

**photo gallery and editor (damage events / baselines / rentals)** — same 6 tests in each:
- [x] ✍️ a record without photos has nothing to open
- [x] ✍️ uploaded photos are listed in the gallery
- [x] ✍️ I can open the editor, see its panels and close it without changing anything
- [x] ✍️ I can switch between photos inside the editor
- [x] ✍️ the assessment panel opens inside the editor
- [x] ✍️ a photo without an edited version cannot be excluded from the PDF

## tests/app/index-filters.spec.ts

**baselines index**
- [x] filtering by VIN is case-insensitive and Reset clears it
- [x] a filter that matches nothing shows zero records
- [x] filters can be combined
- [x] I can sort by VIN ascending and then descending, and sorting survives filtering
- [x] the CSV button keeps my filter

**rentals index**
- [x] I can filter by rental id

**damage events index**
- [x] I can filter by location

## tests/app/internal-review.spec.ts

**internal review (baselines)**
- [x] ✍️ a resulted baseline with no assessments defaults to "No damage"
- [x] ✍️ the classification stays when I dismiss the confirmation
- [x] ✍️ I can classify the baseline as "Has damage"
- [x] ✍️ I can classify the baseline as "Nonsense"
- [x] ✍️ marking Internal Reviewed locks the classification and finalizes the PDF
- [x] ✍️ unmarking Internal Reviewed re-opens the record for classification

**internal review (rentals)**
- [x] ✍️ a resulted rental with an assessment still defaults to "No new damage"
- [x] ✍️ I can classify the rental as "New damage"
- [x] ✍️ I can toggle whether the price is shown
- [x] ✍️ marking Internal Reviewed locks the classification and finalizes the PDF
- [x] ✍️ unmarking Internal Reviewed re-opens the record for classification

> Damage events are not covered here — their `#assessmentButtons` panel renders empty in every
> state; there's no classification/review UI to test for that resource.

## tests/app/navigation.spec.ts — navigation

- [x] the navbar links take me to each section
- [x] the Pricing link is available on non-production environments
- [x] the navbar shows my name
- [x] a signed-in user is redirected away from the login page
- [x] the /errors route is a 404
- [x] opening a record that does not exist is a 404

## tests/app/pagination.spec.ts — pagination

- [x] records are split into pages of 20 and the filter survives page changes
- [x] there is no second page when the results fit on one

## tests/app/pdf.spec.ts — PDF report

- [x] a baseline report renders as HTML with the VIN (debug mode)
- [x] a damage event report renders as HTML with the VIN (debug mode)
- [x] a rental report renders as HTML with the VIN (debug mode)
- [x] the real PDF is generated and is a valid PDF file
- [x] the report is available without logging in
- [x] the stored Bosch report (/pdf/:id) is for signed-in users only
- [x] an unknown record is a 404
- [x] a missing resource parameter is a 400

## tests/app/prices-import.spec.ts — pricing CSV import

- [x] ✍️ I can import a valid CSV file
- [x] rows with invalid values are reported
- [x] negative values are reported
- [x] a file that is not valid CSV is rejected
- [x] a header-only file imports nothing
- [x] submitting without a file is rejected
- [x] the back link returns to the pricing table

## tests/app/prices.spec.ts — pricing

- [x] I can create, update and delete a price
- [x] I cannot create a price without a car part
- [x] I cannot save a negative labour value
- [x] I cannot save a negative material cost
- [x] the price stays when I dismiss the delete confirmation
- [x] an unknown price is a 404

## tests/app/send-flow.spec.ts — sending photos for damage prediction

> Skipped by default — set `E2E_ALLOW_SEND=true` to run (calls the real prediction service).

**sending photos for damage prediction (damage events)**
- [x] ✍️ the full customer flow: upload required photos, send, and return to the callback URL
- [x] ✍️ after sending, the record is listed as "Damage prediction requested"
- [x] ✍️ after sending, the customer page no longer offers an enabled send button
- [x] ✍️ the server refuses to send a record that has no photos *(known app bug — `test.fail()`)*

**sending photos for damage prediction (baselines)**
- [x] ✍️ the full customer flow: upload required photos, send, and return to the callback URL
- [x] ✍️ after sending, the record is listed as "Damage prediction requested"
- [x] ✍️ after sending, the customer page no longer offers an enabled send button

## tests/app/state-filter.spec.ts — state filter

- [x] baselines: only records in the selected state are listed
- [x] the state list offers every workflow state
- [x] rentals: filtering by a state with no records shows none
- [x] damage events: the selected state is kept after filtering

## tests/guest/auth.spec.ts — guest access

- [x] /baselines redirects to the login page
- [x] /rentals redirects to the login page
- [x] /damage_events redirects to the login page
- [x] /prices redirects to the login page
- [x] a wrong password keeps me on the login page
- [x] an unknown email keeps me on the login page
- [x] after logging in I land on the page I originally asked for
- [x] I can log out and protected pages are locked again
- [x] a guest is not authorized to export CSV
- [x] the Sidekiq dashboard is not available to guests

## tests/guest/customer-pages.spec.ts — customer pages (no login)

- [x] an unknown baseline link is a 404
- [x] an unknown rental link is a 404
- [x] the baseline page shows the VIN and the upload instructions
- [x] the send button is disabled until all required photos are uploaded
- [x] the rental thank-you page is shown in English
- [x] the rental thank-you page is shown in Japanese when the record language is ja
- [x] the damage event thank-you page shows the VIN

## tests/guest/customer-upload.spec.ts — customer photo upload

Shared test bodies run once and are reused across both resources (the upload page markup is identical).

**customer photo upload (baselines / rentals)** — same 4 tests in each:
- [x] a non-image file is rejected before upload
- [x] ✍️ a valid photo is uploaded and the car part is marked as done
- [x] ✍️ a HEIC photo is uploaded and the car part is marked as done
- [x] ✍️ a valid photo still uploads after a rejected file

## tests/guest/expired-links.spec.ts — expired customer links

Runs against 3 resource types (baseline / rental / damage event), 2 checks each:
- [x] returns 410 Gone
- [x] cannot be used to open the upload page in the browser

