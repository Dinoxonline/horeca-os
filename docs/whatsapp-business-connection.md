# WhatsApp Business: shared now, one number per venue later

## What is implemented

- Koppelingen offers a shared inbox and one separate slot per visible business.
- Existing Business App onboarding only: Embedded Signup with `whatsapp_business_app_onboarding`.
- The browser loads the Meta SDK only after a deliberate click, validates the exact message origin, and waits for both the login code and coexistence completion event (either arrival order).
- The server checks authenticated business-scoped roles, verifies the phone belongs to the returned WABA and `is_on_biz_app === true`, subscribes to webhooks, encrypts credentials, and marks connected only after credential persistence.
- Shared accounts/messages have `business_id = NULL`. Existing database RLS permits only workspace-wide assignments, not venue/location-only assignments. Separate numbers retain the existing venue boundary.
- Database constraints prevent two inboxes claiming the same phone, including across workspaces. A different existing number is never silently replaced or reassigned.
- Incoming individual messages and Business App message echoes appear as inbox items. Text replies require explicit confirmation and a verified inbound message within 24 hours. Delivery callbacks preserve original metadata.
- No new phone registration, migration, automated marketing, group import, historical chat import, or test message is performed.

## Configuration and activation still required

Server variables: `META_APP_ID`, `META_APP_SECRET`, `META_TOKEN_ENCRYPTION_KEY`, `WHATSAPP_CONFIG_ID`, `WHATSAPP_VERIFY_TOKEN`. If a separate `WHATSAPP_APP_SECRET` exists, it must match the WhatsApp webhook's Meta app.

The Facebook Login for Business configuration must support WhatsApp Business App coexistence and grant `whatsapp_business_management` and `whatsapp_business_messaging`. Meta must allow the app/domain/number to use this flow. A variable being present does not prove approval or eligibility.

Configure the Meta webhook URL `/api/integrations/whatsapp/webhook` and the appropriate `messages` and `smb_message_echoes` subscriptions. Complete the official Meta consent from the owner’s signed-in browser. Stop if Meta requests deleting/migrating the existing app number.

When switching to two numbers, connect each *different* number under its venue. Existing shared history stays in its original inbox. Reassigning the existing shared phone to a venue is intentionally blocked: requires a deliberate migration design so old history is not exposed to venue-only staff.

## Limitations and verification

This release is an inbox-items view, not a complete threaded WhatsApp client. Inbox refresh is manual. Media messages without text appear as type labels; downloading attachments, outbound attachments, templates and per-conversation venue assignment are not implemented here. WhatsApp echo/history availability depends on Meta subscriptions and eligibility.

Automated tests: `node --test tests/whatsapp-business.test.cjs tests/whatsapp-share.test.cjs`. They mock Meta and database calls, test authorization, callback order, scope/phone safeguards, signed webhooks, duplicate/retry handling, reply window, and UI scope selection. No customer account login or real send is part of these tests. Browser verification remains unavailable because the app browser could not verify saved permissions; no alternate browser workaround is used.

Database migration retains credential RLS with no client policies (service-role only). Existing advisor warnings about staff-ticket functions/password protection are unrelated and unchanged.
