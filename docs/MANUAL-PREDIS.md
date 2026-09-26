# Manual Predis handoff

Horeca OS remains the source and status workspace. Existing calendar, event creation,
website updates, Facebook handoff and Instagram publication remain available.

## User flow

- Marketing agenda: expand **Evenementen zoeken en publicatiestatus bekijken** to
  search loaded events/campaigns and filter the manual Predis worklist.
- Open an event and select the Predis tile or **Predis handmatig voorbereiden en plannen**.
- Prepare separate caption and select existing event/verified linked-source media.
- Add individual dates or weekdays within a bounded period, with Netherlands time
  and Facebook, Instagram, Google Business Profile and/or TikTok destinations.
- Save preparation, copy text or the complete handoff, open/save media, open Predis.
- Choose the correct brand/accounts and actually schedule in Predis. Then explicitly
  confirm each channel/time back in Horeca OS. A checked checkbox is required.

## Boundaries and safety

This is NOT a Predis publishing API integration. No Predis requests, jobs, email sends,
external scheduling or publication are triggered by saving/copying/opening links.
Dates are desired times, not external scheduling guarantees. Confirmations are
user-reported, never automatically verified or promoted to published by elapsed time.
Actual message type, media compatibility, crop and account access are checked in Predis.
Websites and email recipients for uitagenda submissions were deferred by the user.

Drafts and a capped confirmation history live in the existing campaign distribution
under `manual_predis`; direct publisher delivery fields are untouched. Endpoint GET/POST
requires authenticated AAL2 and scoped marketing/social management permissions.
Updates use scoped row-version CAS and a separate draft revision; unrelated concurrent
changes survive retries, conflicting draft changes fail closed. Caption/media changes
invalidate prior confirmations only after explicit reset approval. Removing local moments
does NOT cancel remote scheduled posts; the UI says to change those in Predis as well.

Limits: 10 assets, 10,000 caption characters, 160 channel/time entries, one-year date range,
100 history entries. Worklist searches the existing loaded item set (at most 500), not a
separate all-history database search. No database migration or new environment variables.

## Verification

`npm run test:manual-predis` covers date validation, DST wall-clock preservation,
permissions/MFA, exact confirmations, version conflicts, failed writes, invalidation,
lazy loading, token refresh, duplicate clicks, retained input and worklist navigation.
The existing navigation, session, event-content and Instagram suites cover integration.
Browser tests used an explicitly local in-memory fixture for month planning, saving,
per-channel confirmation and reopening; the fixture is removed before deployment.

Do not deploy the older recurring-marketing prototype from another worktree over this
implementation. Merge with the current production main first; it preserves agenda navigation.
