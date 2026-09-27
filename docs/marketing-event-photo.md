# Facebook event photo → Horeca OS → website

Open a stored event in Marketing. The fold **Foto overnemen — Facebook → Horeca OS → website** is separate from text selection and text publication.

1. Fetch the current photo from the linked native Facebook event. This is a preview, not an import.
2. Save the reviewed photo as the Horeca OS main image. The server re-reads the authorized Page event and verifies its bytes against the reviewed hash. It stores a separate immutable file in `marketing-assets`. Variant images, text, Instagram publication history and other events remain untouched. For a series, only this occurrence becomes an exception.
3. Check the website's existing image. Confirm replacement, then publish the saved image. The server uploads it to WordPress Media and updates only `featured_media` on the linked `etn` post. Success requires readback of both WordPress's featured attachment and Eventin's banner attachment ID. No full Eventin-record update, ticket changes or publication-status changes are made.

Access requires an authenticated workspace owner with MFA. All content reads/writes are scoped to workspace, business and row, using the user's RLS-bound client and a precise `updated_at` compare-and-swap. Existing permissions, credentials and database schema are unchanged.

The server accepts no arbitrary download URL or destination. Facebook downloads require HTTPS Facebook CDN hosts, no redirects, a timeout, a streamed 10 MB bound and JPEG/PNG/WebP magic bytes. Website credentials only go to the configured Caribbean Corner origin. The website image is version-checked before and after media upload; its remote API does not offer an atomic conditional photo update.

A website update reserves its status before external writes. A timeout is not treated as a rollback. **Websitefoto controleren** reconciles the stored attachment ID with both website APIs. A live reservation stays locked for two minutes; after that an unconfirmed operation can be retried with a new preview and confirmation. When known, the uploaded attachment ID is reused. Old images and uncertain/orphaned uploads are not automatically deleted. The small hourly database export does not itself contain image bytes; this feature uses the existing storage/file backup route without changing its configuration.

Tests: `node --test tests/event-photo.test.cjs tests/event-editor.test.cjs tests/manual-event-content.test.cjs tests/session-regression.test.cjs tests/marketing-navigation.test.cjs tests/instagram-publishing.test.cjs`.

Live evidence before implementation: event 9440's WordPress `featured_media` and Eventin `event_banner_id` both equal 9382; its description contains no embedded image. Production photo replacement is left to the user's explicit confirmation.
