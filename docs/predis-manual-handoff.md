# Predis manual handoff — 2026-09-30

Based on Predis Support's replies supplied by the user: the API cannot import a finished design and exact caption unchanged. Current get_posts filtering returns API-created posts only. The newer mention of a created_from default does not establish a supported alternate filter, so none is guessed or added.

The event workspace now opens the manual preparation directly. Existing drafts and confirmations are retained. Optional AI generation, own-media generation and API-result retrieval remain behind Other workflow, with explicit limitations. No automatic generation, retrieval, scheduling or publishing is added.

## User flow

1. Select original event assets and enter the caption. Saved-only assets are retained; new files still use the existing event upload. Reorder carousel assets with the numbered up/down controls.
2. Download the original file(s), without image conversion. Click **Bewaren, tekst kopiëren en Predis openen**. This copies the literal caption, saves changed preparation through the existing scoped, revision-checked endpoint, and opens the Predis chooser. No dates or API credentials are required for the manual workflow; existing Horeca OS permissions still apply.
3. In Predis, select the correct brand and **Heb je al een ontwerp? Uploaden en inplannen**, upload the downloaded files, paste the caption and review. Then schedule or publish there manually.
4. Optionally expand dates/channels in Horeca OS and record actual moments. Save with Concept bewaren and explicitly confirm each channel. Opening Predis never confirms publication.

The handoff opens an empty tab synchronously to retain browser user-activation eligibility. It removes the opener reference, navigates only after save confirmation and closes the tab on save failure or unmount. Popup/clipboard denial has explicit fallback controls. Copying may already succeed when saving fails; input is retained and the failure is not presented as success. Blank captions, missing assets and mixed image/video selections are rejected. A lock prevents duplicate saves/tabs. Changes to previously confirmed content still require confirmation and reset only affected local confirmations.

Caption normalization no longer trims whitespace: saving and copying preserve supplied text including leading/trailing whitespace and line endings. Media are not transformed. A download-start message does not claim the browser actually saved the file.

## Verification

Component/route tests cover handoff success, unchanged drafts, duplicate clicks, save conflicts, clipboard/popup denial, cancelled confirmation resets, exact caption preservation, original media bytes and carousel ordering. Existing auth/MFA/tenant/CAS and generation safeguards are retained. No real Predis generation, upload or publishing is exercised by these tests.
