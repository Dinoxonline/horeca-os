# Info-mailbox calendar channel

The event detail view exposes `Agenda info@leclubbbq.nl` immediately after Instagram. Opening the panel performs a read/check; creating, linking or changing requires explicit user confirmation. Other channels are unchanged.

- The search relevance threshold is **10% only for this mailbox**. Title similarity uses normalized character bigrams. Same-date appointments qualify even with a different title, explicitly labelled as date-only suggestions. This is not a probability or a confirmed match.
- Search covers the event day and surrounding days (one day before through two days after), with bounded, trusted Microsoft pagination. It does not search an unlimited mailbox history or email messages.
- Suggestions never automatically link or mutate appointments. Users can select an existing entry, or explicitly confirm that all suggestions are different appointments before creating a new one. Creation rechecks for newly appearing candidates.
- Exact linked IDs are checked directly. A vanished ID is not automatically recreated. Read errors are not treated as absent appointments.
- Existing `calendar_delivery` links to this mailbox are reused. Other mailbox links are left intact.
- State is stored in `campaign_distribution.calendar_channel`, using row-version compare-and-swap while preserving unrelated fields. An operation is reserved before Microsoft mutation; uncertain writes stay blocked until reconciled by event ID or transaction ID.
- Updates require the current Microsoft etag and patch only title, body, times and location. Meetings with participants, online meetings, all-day and recurring entries remain editable in Outlook only.
- Endpoint requires authenticated MFA, workspace owner, scoped business/event and this user's exact Microsoft mailbox connection. No migration or additional credentials are required.

Tests: `node --test tests/event-calendar.test.cjs`. These use mock calendars; they do not create real appointments.
