# WhatsCooking.ai verification — 2026-10-18

Verified in the isolated release worktree based on main `64c8d17`, with all providers mocked for automated tests.

| Check | Result |
| --- | --- |
| Frontend `npm test` | 171 passed, zero failures |
| Backend `python -m unittest discover -s tests` | 90 passed, zero failures |
| Full ESLint | Passed |
| Vite production build | Passed, no warnings |
| Production Chrome flows | 10 passed, zero page exceptions |
| Diff whitespace check | Passed |

Browser flows cover spoken onboarding preview/save; custom allergy add/remove and budget select/clear/reload; assistant multi-action confirmation/cancel/Undo; recipe review and plan persistence; insufficient-time rejection without partial mutations; replacement confirmation; campus pass/Undo; Cook pass; local flavor fallback/exact matches; teammate grocery-session retention across modes. They also load historical browser state through branding migration.

Regression tests confirm custom restrictions and null budget reach recipe requests, unsafe model output is rejected, new allergies invalidate old review coverage, unknown custom absence is not invented, numeric budgets remain mandatory, and empty responses do not trigger paid retries. Mocks intercepted 58 browser API requests, with no provider calls or outbound writes.

Local evidence: `/tmp/whatscooking-final-frontend.log`, `/tmp/whatscooking-final-backend.log`, `/tmp/whatscooking-final-lint.log`, `/tmp/whatscooking-final-build.log`, `/tmp/whatscooking-final-browser.mjs`, `/tmp/whatscooking-final-browser.json`. These machine-local artifacts are not part of the application source or pushed release.

Build chunks retain the complete food reference (~604 kB uncompressed / 54 kB gzip), campus data (~260 kB), vendor code (~296 kB), and app code (~308 kB). The existing 650 kB warning threshold accommodates the reference module; this is not a claim of reduced total data coverage.

Limits: real Gemini speech/generation, live Backboard/database, new Kroger/Routes quotes, Google authorization and reminder delivery were not retested. The preceding rename audit compiled/signed the native helper without reading calendars; finalization changes its display capitalization only. Known OAuth/reminder/data-coverage limitations are documented in the main README. No `.env` files were modified.
