import { randomUUID } from "node:crypto";
import { EVENT_MAILBOX, INFO_CALENDAR_MATCH_THRESHOLD, infoCalendarMatch, calendarDistribution, calendarDraft, validateCalendarDraft, calendarRemote } from "./event-calendar";

const same = (a, b) => JSON.stringify(a || null) === JSON.stringify(b || null);
const base = `users/${EVENT_MAILBOX}/calendar`;
const select = "id,subject,body,start,end,location,webLink,isCancelled,isAllDay,isOnlineMeeting,recurrence,type,attendees,isOrganizer,transactionId";
const failure = (message, status = 409) => Object.assign(new Error(message), { status });

// repo is always workspace + business + event scoped. No other channel fields change.
export async function eventCalendarAction({ repo, graph, input, now = () => new Date().toISOString() }) {
  let row = await repo.read();
  if (!row?.updated_at || !calendarDistribution(row).kind) throw failure("Dit evenement is niet toegankelijk.", 404);
  let dist = calendarDistribution(row), state = dist.calendar_channel || null;
  if (input.action !== "check" && !same(input.revision, state?.revision || null)) throw failure("De agendastatus is gewijzigd. Controleer opnieuw voordat je verdergaat.");
  const expectedCommon = JSON.stringify(dist.common || {});
  const legacy = dist.calendar_delivery?.mailbox?.toLowerCase() === EVENT_MAILBOX ? dist.calendar_delivery : null;
  let eventId = state?.event_id || legacy?.event_id || "";

  async function save(next, syncLegacy = false) {
    for (let i = 0; i < 3; i++) {
      const current = await repo.read(), d = calendarDistribution(current);
      if (!current?.updated_at || !same(d.calendar_channel, state) || (input.action !== "check" && JSON.stringify(d.common || {}) !== expectedCommon)) throw failure("Het evenement is ondertussen gewijzigd. Controleer de agenda opnieuw.");
      const updated = { ...next, revision: randomUUID(), mailbox: EVENT_MAILBOX };
      const part = { ...d, calendar_channel: updated };
      if (syncLegacy && (!d.calendar_delivery?.mailbox || d.calendar_delivery.mailbox.toLowerCase() === EVENT_MAILBOX)) part.calendar_delivery = { ...d.calendar_delivery, mailbox: EVENT_MAILBOX, event_id: updated.event_id, web_link: updated.remote?.web_link || "", status: updated.status === "present" ? "confirmed" : "failed", checked_at: updated.checked_at, updated_at: now() };
      if (await repo.write(current.updated_at, current.media.map(p => p === d ? part : p))) { state = updated; return updated; }
    }
    throw failure("De agendastatus kon niet veilig worden bewaard. Controleer opnieuw.");
  }
  async function get(id) { return graph(`${base}/events/${encodeURIComponent(id)}?$select=${select}`, {}, true); }
  async function search(draft) {
    if (!/^\d{4}-\d\d-\d\d/.test(draft.start)) throw failure("Vul eerst een begindatum in om de agenda te controleren.", 400);
    const day = new Date(draft.start.slice(0,10) + "T00:00:00Z");
    if (!Number.isFinite(day.getTime())) throw failure("De begindatum is ongeldig.", 400);
    const start = new Date(day.getTime() - 86400000).toISOString(), end = new Date(day.getTime() + 3 * 86400000).toISOString();
    let path = `${base}/calendarView?startDateTime=${encodeURIComponent(start)}&endDateTime=${encodeURIComponent(end)}&$top=100&$select=${select}`;
    const events = [];
    for (let page = 0; path && page < 5; page++) {
      const result = await graph(path);
      if (!Array.isArray(result?.value)) throw failure("De agenda gaf geen volledige lijst terug.");
      events.push(...result.value);
      path = "";
      if (result["@odata.nextLink"]) {
        const next = new URL(result["@odata.nextLink"]);
        if (next.origin !== "https://graph.microsoft.com" || decodeURIComponent(next.pathname) !== `/v1.0/${base}/calendarView`) throw failure("De vervolgpagina van de agenda is niet vertrouwd.");
        path = next.pathname.slice("/v1.0/".length) + next.search;
      }
    }
    if (path) throw failure("De agenda is te groot voor een volledige controle. Er wordt niets aangemaakt.");
    return events;
  }
  const matches = (events, draft) => events.filter(e => !e.isCancelled && infoCalendarMatch(e, draft).score >= INFO_CALENDAR_MATCH_THRESHOLD).sort((a, b) => infoCalendarMatch(b, draft).score - infoCalendarMatch(a, draft).score);
  const present = async event => {
    const remote = calendarRemote(event);
    return save({ status: remote.cancelled ? "cancelled" : "present", event_id: remote.id, remote, checked_at: now(), operation: null }, true);
  };

  if (state?.operation) {
    if (input.action !== "check") throw failure("Een eerdere agenda-actie is nog niet bevestigd. Controleer eerst; maak geen tweede afspraak.");
    if (Date.now() - Date.parse(state.operation.started_at) < 60000) return { saved: state, message: "De agenda-actie wordt verwerkt. Controleer over een minuut opnieuw." };
    if (eventId) {
      const event = await get(eventId);
      if (event) return { saved: await present(event), message: "De bestaande afspraak is opnieuw teruggelezen." };
    } else {
      const recovered = (await search(state.operation.draft)).filter(e => e.transactionId === state.operation.transaction_id);
      if (recovered.length === 1) return { saved: await present(recovered[0]), message: "De eerder aangemaakte afspraak is teruggevonden." };
    }
    return { saved: state, message: "De uitkomst is nog onzeker. Controleer in Outlook; opnieuw aanmaken is geblokkeerd om dubbele afspraken te voorkomen." };
  }

  if (input.action === "check") {
    try {
      if (eventId) {
        const event = await get(eventId);
        if (event) return { saved: await present(event), message: "Afspraak daadwerkelijk teruggelezen uit de agenda." };
        return { saved: await save({ status: "missing", event_id: eventId, checked_at: now(), operation: null }), message: "De gekoppelde afspraak is niet gevonden. Er is niets opnieuw aangemaakt." };
      }
      const draft = calendarDraft(row), found = matches(await search(draft), draft).map(e => ({ ...calendarRemote(e), match: infoCalendarMatch(e, draft) }));
      return { saved: await save({ status: found.length ? "candidates" : "missing", checked_at: now(), event_id: "", operation: null }), candidates: found, message: found.length ? "Er zijn mogelijke afspraken gevonden. Kies zelf welke bij dit evenement hoort." : "Geen bijpassende afspraak gevonden rond de evenementdatum." };
    } catch (e) {
      if (e.status === 409) throw e;
      return { saved: await save({ ...state, status: "error", checked_at: now(), operation: null }), error: "De Microsoft-agenda kon niet worden gecontroleerd. Controleer de koppeling of probeer opnieuw." };
    }
  }
  if (input.confirmed !== true) throw failure("Bevestig eerst de actie voor info@leclubbbq.nl.", 400);
  if (input.action === "link") {
    if (eventId) throw failure("Er is al een afspraak gekoppeld. Controleer die eerst.");
    const draft = calendarDraft(row), candidates = matches(await search(draft), draft);
    const found = candidates.find(e => e.id === input.eventId);
    if (!found) throw failure("Deze afspraak staat niet meer tussen de gecontroleerde kandidaten.");
    return { saved: await present(found), message: "Bestaande afspraak gekoppeld. De agenda is niet gewijzigd." };
  }
  const draft = validateCalendarDraft(input.draft);
  let remote;
  if (input.action === "create") {
    if (eventId || !["missing", "candidates"].includes(state?.status)) throw failure("Controleer eerst of dit evenement al in de agenda staat.");
    const candidates = matches(await search(draft), draft);
    if (candidates.length && (!Array.isArray(input.reviewedCandidateIds) || !same([...new Set(input.reviewedCandidateIds)].sort(), [...new Set(candidates.map(e => e.id))].sort()))) throw failure("Er zijn mogelijke afspraken gevonden. Controleer opnieuw en koppel de juiste, of bevestig dat dit andere afspraken zijn.");
  } else if (input.action === "update") {
    if (!eventId) throw failure("Koppel of maak eerst een afspraak aan.");
    remote = await get(eventId);
    if (!remote) throw failure("De afspraak is verwijderd. Er is niets gewijzigd.");
    const normalized = calendarRemote(remote);
    if (!normalized.editable) throw failure("Deze afspraak heeft deelnemers, een herhaling of vergaderinstellingen. Wijzig die rechtstreeks in Outlook zodat uitnodigingen en instellingen behouden blijven.");
    if (!input.etag || normalized.etag !== input.etag) throw failure("De afspraak is ondertussen gewijzigd. Controleer opnieuw voordat je overschrijft.");
  } else throw failure("Onbekende agenda-actie.", 400);

  const operation = { id: randomUUID(), kind: input.action, started_at: now(), transaction_id: randomUUID(), draft };
  await save({ ...state, status: "pending", event_id: eventId, operation }); // Reserve before any external write.
  let wrote = false;
  try {
    const body = { subject: draft.subject, body: { contentType: "text", content: draft.description }, start: { dateTime: draft.start, timeZone: "Europe/Amsterdam" }, end: { dateTime: draft.end, timeZone: "Europe/Amsterdam" }, location: { displayName: draft.location } };
    const response = await graph(`${base}/events${eventId ? "/" + encodeURIComponent(eventId) : ""}`, { method: eventId ? "PATCH" : "POST", headers: eventId ? { "If-Match": remote["@odata.etag"] } : {}, body: JSON.stringify(eventId ? body : { ...body, transactionId: operation.transaction_id, attendees: [], isReminderOn: true, reminderMinutesBeforeStart: 60, showAs: "busy" }) });
    wrote = true;
    eventId = response?.id || eventId;
    if (!eventId) throw failure("Microsoft gaf geen afspraaknummer terug.");
    await save({ ...state, event_id: eventId }); // Keep identity even when read-back fails.
    const event = await get(eventId);
    if (!event) throw failure("Microsoft heeft de afspraak nog niet bevestigd.");
    return { saved: await present(event), message: input.action === "create" ? "In de agenda gezet en teruggelezen." : "De bestaande afspraak is gewijzigd en teruggelezen." };
  } catch (e) {
    if (!wrote && [400, 403, 404, 412, 422].includes(e.status)) {
      return { saved: await save({ ...state, status: "error", operation: null }), error: "Microsoft heeft de wijziging geweigerd. Controleer de afspraak en je agendarechten opnieuw." };
    }
    return { saved: state, error: "Geen volledige bevestiging ontvangen. De afspraak kan al zijn verwerkt. Gebruik ‘Controleren’; maak geen nieuwe afspraak." };
  }
}
