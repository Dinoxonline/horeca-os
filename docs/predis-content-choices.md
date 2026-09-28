# Predis content choices

Verified 2026-09-28.

Marketing opens a neutral choice screen. Choosing a type never generates or publishes content. Own media/caption preparation remains separate from paid AI generation; existing saved preparations and generation jobs are retained.

- Own photo and text: prepare/save in Horeca OS, then manually upload the original file and paste the caption in Predis.
- Image, carousel, video: open the existing generation form with the selected media type. Explicit credit consent and the generation button are still required. Existing result-recovery limitations are not repaired by this UI change.
- Product advertisement video, UGC, faceless video, product photoshoot: labelled external choices. Links open the observed Predis type chooser; they do not select a special mode or transfer event data automatically.

Observed Predis UI: Make new → choose a media type → “Heb je al een ontwerp? Uploaden en inplannen” → “Upload inhoud vanaf apparaat”. The browser stays at `https://app.predis.ai/app/new_post/create`; no unsupported deep-link parameters are invented.

The documented REST create-content API generates a new design, including when `media_urls` supplies an existing flyer. It is not an unchanged-file import. SDK `createPost` documents `manual` as a post type and `customAssets`, but does not document an exact caption-prefill field. SDK production licensing is separate; no SDK was installed or enabled.

Sources:
- https://predis.ai/developers/docs/predis-api/API%20reference/create-content-api/
- https://predis.ai/developers/docs/predis-sdk/API%20reference/createPost/
- https://predis.ai/developers/docs/predis-sdk/SDKPricing/

Tests cover the neutral default, all three initial AI formats, unsaved-input confirmation, no paid request on choice, manual handoff order, and preservation of existing save/confirmation behaviour.
