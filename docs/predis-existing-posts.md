# Existing Predis posts: manual upload, then link

The Predis chooser now offers **Bestaande post uit Predis ophalen** in both the
marketing event details and the saved event/campaign list.

1. Upload finished image/carousel/video and caption manually in the correct
   Predis brand's content library using **Heb je al een ontwerp?**.
2. Open the corresponding event in Horeca OS, select the existing-post option,
   choose a media type and click **Posts ophalen uit Predis**.
3. Inspect the returned media/caption, choose the post and explicitly confirm
   linking. This stores a snapshot in `campaign_distribution.predis_library`.
4. Schedule in Predis itself. Linking does not schedule, publish or confirm either.

## Provider limitation: not yet verified with a manual upload

The official [Get All Posts reference](https://predis.ai/developers/docs/predis-api/API%20reference/get-all-posts/)
describes retrieving generated posts. It does **not** explicitly guarantee that
manually uploaded designs are returned. The UI calls this out, even when the
returned page is empty. Do not claim the manual-upload workflow is proven until
a known manual upload is visible through the real connected brand.

User-supplied acceptance candidate: Caribbean Corner, caption beginning
“DONDERDAG 24 SEPTEMBER – CARIBBEAN SOCIAL CLUB”, featuring Patricia Colon,
shown in Predis as September 22, 2026, 15:43. Do not generate, edit, schedule or
publish a replacement for this test. Live confirmation is still outstanding.

## Safety and behavior

- Authenticated MFA session and workspace/business-scoped marketing or social
  management permission required. Location-only roles cannot bypass scope.
- Brand is selected from the server's connected integration; never from client
  input. API key remains on the server. No integration updates during reads.
- Provider calls only use `GET get_posts`, 20 results/page, explicit media type,
  bounded pagination and timeout. No background polling or paid generation.
- Confirming a choice re-fetches the page and verifies brand+content fingerprint;
  client-supplied caption/assets cannot override the provider response.
- The database stores caption and media references, not downloaded media files.
  References can expire; snapshots do not automatically track Predis edits.
- Exact brand+post identity prevents duplicate links. A repeated link leaves
  the original snapshot unchanged, rather than silently replacing it.
- Version-guarded writes preserve unrelated channels, manual drafts and AI jobs.
  Campaign draft editing preserves the imported-post field.
- Opening only reads saved associations. Listing occurs only on an explicit
  click. Closing/switching scope aborts requests and rejects stale UI responses.

## Verification

`node --test tests/predis-library.test.cjs tests/predis-content.test.cjs tests/manual-predis.test.cjs tests/marketing-publications.test.cjs`

Additional targeted event-panel regressions:

`node --test --test-name-pattern="event layout starts|channel tiles open|Marketing does not run dashboard" tests/session-regression.test.cjs`

Tests use fake provider data, no production credentials and no content creation.
Passing tests establish local behavior, not Predis manual-upload availability.
