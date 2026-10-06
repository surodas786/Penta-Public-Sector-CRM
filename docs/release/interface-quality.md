# Interface quality (FR-010–FR-015, NFR-012)

**Date:** 06 October 2026. Automated checks in `e2e/m8.spec.ts`, run with
`npm run test:browsers` in three browsers on Windows 11; screenshots in
`docs/evidence/m8/`. Earlier milestones' screenshots (`docs/evidence/01`–`47`)
and their recorded deviations are the design comparison against the approved
prototype.

## Browsers

| Browser | Version | How | Result |
| --- | --- | --- | --- |
| Chromium | Playwright build 1243 (Chrome-equivalent) | `--project=chromium` | **5/5 passed** |
| Microsoft Edge | installed stable (`channel: 'msedge'`) | `--project=msedge` | **5/5 passed** |
| Firefox | Playwright build 1543 (Firefox 155) | `--project=firefox` | **5/5 passed** |

Google Chrome itself was not driven (Chromium is its engine; Chrome is
installed on this machine and can be added as `channel: 'chrome'`). Safari is
outside NFR-012. Mobile browsers on real devices were not tested; the 360 px
checks use desktop engines at that width.

## What was checked, in each browser

| Check | Requirement | Result |
| --- | --- | --- |
| Dashboard, opportunity table, opportunity detail, Activities & Follow-ups and Tender Tracker at **1440, 768 and 360 px**: no page-level horizontal scroll; wide tables and the stage chart scroll inside their own panel | FR-015, NFR-012 | Pass (15 screen × width combinations per browser) |
| Navigation reachable at every width (menu button below the large breakpoint) | FR-015 | Pass |
| Sign in with the keyboard only (Tab order email → password → button, Enter submits) | FR-015 | Pass |
| A visible focus indicator on the focused control | FR-015, NFR-012 | Pass |
| A dialog (Log Activity) opened from the keyboard takes focus and closes with Escape | FR-015 | Pass |
| A failed sign-in reads as one plain message in an alert region | FR-013, SEC-030 | Pass ("Email address or password is incorrect.") |
| A server-side field error (422) appears beside its field, nothing saved | FR-013 | Pass ("Enter a subject.") |
| Bangla subject and notes saved and shown | FR-010, NFR-012 | Pass |
| BDT in full with Indian digit grouping (৳ 4,20,00,000.00) beside the crore shorthand | §20, NFR-012 | Pass |
| **Network failure:** a save that never reached the server shows "could not be reached", keeps the entered values, shows no success | FR-013, NFR-012 | Pass |
| **Uncertain failure:** the server applied the save but the response was lost; the error is shown, no success; the user's retry sends the **same idempotency key** and the server replays — exactly one record | NFR-012, BR-091 | Pass |
| Offline while saving an edit: error, never a confirmation | NFR-012 | Pass |
| From a filtered list, open a record, then **Back to Opportunities**: the same filters, sort and view | FR-013 | Pass (fixed in M8) |

## Defects found and fixed in M8

1. **The navigation landmark had no name.** "Main navigation" labelled the
   surrounding `<aside>` (announced as a *complementary* region) while the
   `<nav>` itself was unnamed. The label is now on the `<nav>`. (The demo
   prototype's sidebar is unchanged, by rule.)
2. **The Edit dialog said stage, status and ownership changes were "not
   available in this release".** They have existed since Milestones 2 and 3.
   It now says they are changed through their own actions on the page.
3. **"Back to Opportunities" dropped the list's filters** (FR-013: back
   navigation preserves filters). It went to the bare list; the browser's own
   Back button was fine. The list now hands its own address to the record
   page, which returns to it (only an `/opportunities…` address is accepted).

## Findings recorded, not changed

- At 360 px the top-bar search shrinks to a short field showing only "Se…"
  of its placeholder. Searching at that width was not tested. An icon button
  that expands the field would read better — a design decision for the
  approved layout.
- The Activities & Follow-ups **calendar view** is not built; the page says
  so (FR-043, partial).

## Not done — needs people or tools not available here

- **Visual sign-off against the approved prototype (AT-17).** Deviations are
  recorded milestone by milestone in `docs/progress.md`; Penta must approve
  them. No pixel comparison against the MagicPatterns site was made.
- **Screen-reader testing** (NVDA/JAWS/Narrator) and an automated
  accessibility scan (e.g. axe): not run. The checks above cover keyboard
  operation, focus, labels used by the tests (`getByLabel`) and alert
  regions, not a full WCAG audit.
- **Colour contrast** was not measured.
- **User acceptance by management, a lead and a salesperson** (AT-17): the
  scenarios are in `pilot-handover.md` §4.
