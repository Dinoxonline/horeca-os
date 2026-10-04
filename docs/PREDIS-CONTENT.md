# Event content generation through Predis

Marketing → event → Predis — content maken en planning → Content maken.
The existing manual planning flow remains a separate tab. This feature never
publishes, schedules, updates website content or changes the event's main photo.

## Configuration

Set `PREDIS_API_KEY` server-side only, then connect the correct Predis brand per
business under Koppelingen. Marketing users do not need integration-management
rights to generate content, but do need scoped marketing/social permission and MFA.
No schema migration is needed. Jobs live inside the event distribution's
`predis_content.jobs`; updates use the existing row `updated_at` compare-and-swap.
Original provider delivery data and the manual planning object are untouched.

## Contract and limits

- Explicit consent before sending an edited event prompt and selected photos to
  Predis; each request can consume credits. One generated post per request.
- Custom photos use model 2 (model 4 does not support `media_urls`); without photos,
  images/carousels use model 4. Video uses model 2 and short duration.
- Photos must belong to the stored event. No arbitrary client URLs are accepted.
- An operation ID is durably reserved before the paid call. Double clicks/retries
  cannot resend that operation. Uncertain outcomes stay visible and block a new
  request until separately acknowledged. A one-minute cooldown also applies.
- Results are fetched via `get_posts`, matching only stored IDs for that job's
  brand and media type. Three pages per check, persistent cursor, ten-second
  refresh interval, max 50 retained requests/event; no history is silently deleted.
- No webhook endpoint is needed for this initial explicit-refresh workflow.
  Absence from a results page is NOT proof of failure. Provider generation failures
  not returned by this endpoint cannot be automatically distinguished from delay.
- Captions and result URLs are persisted; media remains hosted by Predis, not copied
  to Supabase/Dropbox. The UI explicitly offers download and explains this limit.
- “Deze content gebruiken” seeds a separate manual preparation. The user saves it
  explicitly; existing moments stay, previous confirmations require reset consent.

## Verification

`node --test tests/predis-content.test.cjs tests/manual-predis.test.cjs`
uses mocked provider responses only, covering auth/scopes, missing configuration,
input validation, credit consent, idempotency, CAS, ambiguous responses, pagination,
exact result association, state preservation, and UI adoption. Real generation must
be tested after server key and brand configuration; tests do not spend real credits.

Sources: https://predis.ai/developers/docs/category/api-documentation/
and its Create Content / Get All Posts documentation (checked 2026-09-28).
