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

## Simplified own-media preparation

The manual screen has four primary steps: Bericht maken, Publicatiemomenten kiezen, Bericht en planning bewaren, Verder in Predis. Media thumbnails are immediately visible and toggle their selection with an accessible pressed state. Saved/generated assets absent from the current event sources remain available until deselected. Only one save button and one caption-copy button appear in the default view. File-opening links are grouped with the explicit manual Predis handoff.

The date planner is visible immediately after the message editor. Choose a single date (add several one by one) or weekly repetition with one or more weekdays, an inclusive start/end date and a Dutch time. A preview lists dates and counts only new channel/moment pairs; overlapping additions are deduplicated. Save the message to persist the expanded moments in the agenda. Maximum 160 channel moments per event; no unbounded recurrence or automatic provider scheduling is implied.

The initially collapsed Meer opties section retains reload/reset, the detailed moment list, bulk copy and per-channel manual confirmations. Existing entries are not cleared by saving the simpler form. No scheduling, publishing or AI-generation requests have been added. Existing load-error, concurrent-edit and unsaved-input safeguards remain in place.

## Publication moments in the marketing calendar

The calendar opens with **Evenementen** only. **Berichtenplanning** shows saved publication moments on their own dates; **Beide** combines the two. This shared display filter applies before day/week/month/year and venue layouts. It does not delete or reschedule anything. Publication cards keep explicit preparation/manual-confirmation labels. The selected display mode is session-local and defaults to events when the calendar is reopened.

Saved manual Predis draft entries appear as separate publication cards on their Dutch date/time, with channel and status. The original event date remains unchanged. Pending means “Voorbereid · nog niet verstuurd”; scheduled/published labels explicitly remain manual confirmations. Time passing never changes that status. Historical saved moments remain visible when navigating back, including plans attached to past events. Deleted entries disappear after saving. The calendar uses the same loaded campaign scope (currently the most recent 500 campaigns) and venue filter; this is not an unlimited publication archive.

Day, week and month show the cards; the year view opens all items on the chosen day. Clicking a publication opens its original campaign’s own-media preparation with the planning options expanded. Calendar-only records are never written to the database or sent to publication-status checks. Neither scheduling requests to Predis nor Predis schedule imports have been added: local visibility does not imply delivery to Predis.
