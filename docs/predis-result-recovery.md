# Predis result recovery — 28 September 2026

The first single-image API request was accepted, but no usable post was returned by repeated `get_posts` checks. Runtime logs show a webhook at 00:14:49 UTC receiving HTTP 400 on the old `meta-config-validation` preview deployment. Predis account settings confirmed its webhook URL still pointed at that preview. The payload is unavailable, so the provider's final success/failure cannot be inferred from the HTTP 400 alone.

The current receiver also only supported legacy `provider_delivery.predis.post_ids`, not the newer `predis_content.jobs[].postIds` records. It now handles both. New job results use exact provider IDs, validate the brand when supplied, reject unsafe/incomplete media, use compare-and-swap updates, and preserve event details and other channels. Reconciled copies of the same job are allowed only within the same workspace/business/job/brand identity. A completed job is not downgraded by a replay or later error.

Polling remains available for recovering completed content. After 15 minutes without a usable result, the job becomes uncertain rather than claiming confirmed ongoing generation. No automatic retry or publication is introduced. Diagnostic logs contain counts and fixed codes, not keys, media URLs, captions, or raw provider payloads.

Predis documents that callbacks are sent exactly once, even after a failed response. Updating the receiver/URL does not recover an already rejected callback. If `get_posts` does not return the original result, ask Predis support to inspect the existing provider post ID before authorizing another paid generation.

Configure the callback on the stable production hostname `horeca-os-le-club.vercel.app` with the existing protected token; never log or commit that token. Verify after saving by reopening the REST API settings and checking only hostname/path. No API-key regeneration is needed.

Sources: https://predis.ai/developers/docs/predis-api/configure-webhook/ and https://predis.ai/developers/docs/predis-api/API%20reference/get-all-posts/
