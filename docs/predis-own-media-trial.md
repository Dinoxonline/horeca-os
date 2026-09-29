# Predis own-media trial

The separate **Eigen beeld gebruiken — proef voorbereiden** option opens a trial using saved event images/videos. It does not replace unchanged manual uploads or start a paid request on opening.

The prompt asks Predis to preserve the original design and caption without overlays. This is a request, not a preservation guarantee. Source selection is mandatory for this mode, credit consent is explicit and editing resets consent. Existing event upload controls are used to add files; this panel selects already-saved event assets, not arbitrary URLs or files from other events.

Server validation re-reads the event in the authorized workspace/business, checks the selected assets and stores their original URLs/types together with the reviewed prompt. Video sources are allowed only for video output, because Predis documents that it ignores video sources for single-image and carousel requests. `media_urls` is JSON encoded in the form body, `model_version` is 2 and `n_posts` is 1. Originals and provider results remain separate and are shown together for inspection. No publication or scheduling request is sent.

The create response accepts the reference's `post_ids` array and the custom-assets example's legacy singular `post_id` when the plural field is absent. Malformed plural fields are not overridden. Existing scoped access, MFA, reservation-before-send, idempotency, cooldown, uncertain-result handling and result polling/webhook recovery remain in force.

References:
- https://predis.ai/developers/docs/predis-api/Examples/custom-assets-post/
- https://predis.ai/developers/docs/predis-api/API%20reference/create-content-api/

Verification: `node --test tests/predis-content.test.cjs tests/predis-library.test.cjs tests/manual-predis.test.cjs`. These tests simulate provider replies; they do not establish whether Predis preserves the design in a real paid generation. A live trial requires the user to select/confirm the source, text and credit use. Existing empty-library retrieval is not claimed to be fixed by this feature.

## Full API documentation review — 2026-09-30

Read all 19 content pages linked from the API category: Quick Start, Pricing, Authorization, Configuring Webhooks, Setting Up Your Brand, Rate Limiting; all four reference pages (Create Content, Get All Posts, Get Templates, Error Codes); all nine examples (long video, brand palette, quotes, memes, languages, bulk, own assets, AI palette, custom headlines).

Important limits:
- `headlines` can override the generated heading/subheading/CTA in model 2 (200 characters per heading/subheading). This is not an exact-caption field or a documented no-overlay mode. Empty headlines are not documented as disabling all overlays, so the trial does not silently rely on that assumption.
- `text` is documented as the topic/prompt, not a verbatim caption. The request to preserve a caption remains best-effort.
- `template_ids` can select an existing model-2 template; the reference does not document a raw unchanged-file import endpoint.
- The pricing page states generated media is removed from Predis servers one hour after delivery. The UI now warns to download immediately. Automatic durable binary storage is not part of this change. Original source assets remain unchanged.
- The pricing page also mentions no content when credits are unavailable, but does not establish that this explains a HTTP-200 empty post list. Do not present that or retention as the proven cause.
- Get All Posts does not explicitly state whether manual app uploads are included. No such capability or exclusion has been confirmed.

Source: https://predis.ai/developers/docs/predis-api/api-pricing/

User chose to select the source and text in Horeca OS themselves; no paid provider request has been issued during implementation.
