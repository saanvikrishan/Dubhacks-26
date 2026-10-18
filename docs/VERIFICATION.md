# Verification — October 17, 2026

## Automated checks

- `npm test`: **35 tests pass**.
- `npm run build`: production bundle passes.
- `npm run lint`: passes.

Coverage includes hard food constraints, full activity duration, explicit comparisons, disabled weighted scoring, nutrition basis/portion math, partial nutrient coverage, consumption idempotency/edit/remove/undo, legacy-state migration, independent meal slots, calendar conflicts/free windows, recurring ICS events, EXDATE/moved exceptions, IANA time zones, all-day exclusive boundaries, DST, overlap layout, month navigation, read-only imports, and local API origin/method/range guards.

## Browser and native verification

Used the actual app UI and native bridge. Existing personal meal records were preserved; write tests ran at the separate `localhost` origin with initially empty demo storage. The user's `127.0.0.1` preview retained its four original logs and existing meal plan.

| Scenario | Observed result |
| --- | --- |
| Apple Calendar | Native helper compiled; permission authorized; actual events loaded and refreshed successfully into Today/My Plan |
| Today | Shows an ongoing calendar activity, complete chronological agenda, separate Cook/Eat at school choices and compact intake |
| Calendar | Week/month switch, October→November→October navigation, imported events, all-day row, overlapping columns and selected-day agenda work |
| Swipe | Actual horizontal left drag passes; right drag opens named replacement confirmation; arrow keys and Undo pass also work |
| Select | Choosing tofu creates a meal block, without adding consumption |
| Time change | 65→50 minutes retains the 60-minute tofu plan and shows the feasibility failure |
| Replacement | Explicit confirmation replaces tofu with the 45-minute tofu/cucumber recipe in the same slot |
| Nutrition/log/undo | Half a tofu bowl adds 260 kcal and 13.5 g protein; Undo returns the isolated log to zero entries |
| Data preservation | Personal preview still has four original logs, 1,670 kcal and 73 g protein after isolated tests |
| UW venues | Real venue, location, published hours/menu prices, straight-line HUB distance, source limits and nutrition/review links shown |
| Directions | Accept navigates to the Google Maps walking-directions URL from HUB to Center Table |
| Responsive | Desktop and 390/320 px widths inspected; no horizontal document overflow; calendar scrolls internally and reveals the selected day |

Apple Calendar reads are local and read-only. Refresh is manual. No source calendar events, messages, orders, payments or account data were written. Screenshots are outside the source archive; no private calendar records are packaged.

## Remaining boundaries

- Cook nutrients/costs are illustrative; images are representative AI illustrations.
- Numeric restaurant ratings, routed travel times, exact dish nutrients/allergens and live queues/stock are not loaded. Maps/UW source links are available.
- UW visits reserve time but do not fabricate a dish or log unknown nutrients.
- Apple Calendar requires this Mac's local development server and permission. Static hosting supports the frontend and ICS import only.
- Browser-local storage has no multi-tab or cross-device synchronization. Apple Reminders is not connected.
- Gemini, Atlas, Photon, authentication and background workers need actual implementation plus team credentials/account access, as described in ARCHITECTURE.md.

Transferred into the requested Downloads repository on `codex/daywell-calendar-workflow`, based on team commit `cd6d653`. Existing backend files, the local root README edits, and the separate untracked `daywell/` folder were preserved.
