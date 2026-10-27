# Getting started

This project is already scaffolded (all files from `staging-e2e-playwright-guide.md` section 4 exist, `npm run typecheck` is clean, and `npx playwright test --list` finds 88 tests). What's left is wiring it up to a real staging environment and running it.

## 1. Prerequisites

- Node.js 20+ (`node --version`)
- A **dedicated** staging user for the BackOffice UI (not a real person's account) — `adjuster` role is enough
- An account SID and secret key owned by that user, used to request an access token to create test data through the API
- Know whether staging runs with `Rails.env.production?` — if so, the Pricing menu is hidden and `prices*.spec.ts` + the Pricing navbar test will fail
- A running background worker (Sidekiq) and working object storage (S3) on staging — needed for `tests/app/assessments.spec.ts` and `tests/app/gallery.spec.ts`

## 2. Get the account SID and secret key

Obtain an account SID and secret key for that user from the API/platform team. These are the `E2E_ACCOUNT_SID` / `E2E_SECRET_KEY` values — the test suite exchanges them for a short-lived bearer token by calling `POST /oauth/token`, and caches that token until it expires.

## 3. Configure `.env`

```bash
cp .env.example .env
```

Fill in:

| Variable | Value |
|---|---|
| `BASE_URL` | Staging URL, no trailing slash |
| `E2E_USER_EMAIL` / `E2E_USER_PASSWORD` | The dedicated staging user from step 1 |
| `E2E_ACCOUNT_SID` / `E2E_SECRET_KEY` | From step 2 |
| `E2E_BASIC_AUTH_USER` / `E2E_BASIC_AUTH_PASSWORD` | Only if staging sits behind HTTP basic auth |

Leave `E2E_EXPIRED_PATHS` and `E2E_ALLOW_SEND` commented out for now — they're opt-in (see step 6).

`.env` is gitignored; never commit it.

## 4. Install and verify

```bash
npm install
npx playwright install --with-deps chromium
npm run typecheck
```

## 5. First run against staging

Run the safest subset first — it skips anything that uploads files or creates extra records beyond the API test data:

```bash
npm run test:readonly
```

If that's green, run everything:

```bash
npm test
```

Open the HTML report for details on any failure:

```bash
npm run report
```

If something only fails against the real environment, open its trace rather than loosening the assertion:

```bash
npx playwright show-trace test-results/<test-folder>/trace.zip
```

See `staging-e2e-playwright-guide.md` section 11 (Troubleshooting) for common first-run issues (401 on API calls from an expired/invalid JWT, Pricing menu hidden, worker not running, etc).

## 6. Opt-in tests (skipped by default)

| Switch | Enables | Caution |
|---|---|---|
| `E2E_ALLOW_SEND=true` | `tests/app/send-flow.spec.ts` | Makes the app call the **real** damage-prediction service. Only enable on an environment whose service is a stub/sandbox. |
| `E2E_EXPIRED_PATHS=/damage_photo/baselines/<uuid>,...` | `tests/guest/expired-links.spec.ts` | Point it at customer links that have **already** expired (baselines/rentals: 2 weeks, damage events: 12 months), or backdate `created_at` on a throwaway record from a console. |

## 7. CI

`.github/workflows/e2e.yml` runs on `workflow_dispatch` and weekdays at 01:00 UTC. Before triggering it, add these repository secrets:

- `E2E_BASE_URL`, `E2E_USER_EMAIL`, `E2E_USER_PASSWORD`, `E2E_ACCOUNT_SID`, `E2E_SECRET_KEY`
- Optionally `E2E_BASIC_AUTH_USER`, `E2E_BASIC_AUTH_PASSWORD`

The opt-in switches (`E2E_ALLOW_SEND`, `E2E_EXPIRED_PATHS`) are deliberately **not** set in the workflow — add them to its `env:` block only if you've confirmed it's safe for that environment.

Trigger the workflow once manually (Actions tab → "E2E (staging)" → Run workflow) to confirm it's wired up correctly.

## 8. What test data gets left behind

- Baselines, rentals and damage events created via the API have no delete in the UI — they accumulate on staging. All VINs are prefixed (e.g. `E2E-`, `FLT-`, `PAGE-`) so they're easy to find and purge later.
- Pricing tests clean up after themselves (create → delete).
- Decide on a purge strategy for `E2E-*`/test-prefixed records before running this regularly against a shared environment.

For the full file-by-file reference, coverage matrix, and known app bugs found while building the suite, see [`staging-e2e-playwright-guide.md`](./staging-e2e-playwright-guide.md).
