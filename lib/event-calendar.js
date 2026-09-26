export const EVENT_MAILBOX = "info@leclubbbq.nl";
// Only used by the info mailbox search, never by social-channel comparisons.
export const INFO_CALENDAR_MATCH_THRESHOLD = 0.10;
export function infoCalendarMatch(event, draft) {
  const normalize = value => String(value || "").normalize("NFKD").replace(/\p{M}/gu, "").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
  const title = normalize(event.subject), wanted = normalize(draft.subject);
  const grams = text => new Set(Array.from({ length: Math.max(0, text.length - 1) }, (_, i) => text.slice(i, i + 2)));
  const a = grams(title), b = grams(wanted);
  const overlap = [...a].filter(g => b.has(g)).length;
  const titleScore = title && wanted && title === wanted ? 1 : a.size + b.size ? 2 * overlap / (a.size + b.size) : 0;
  const sameDay = Boolean(draft.start) && calendarLocalTime(event.start?.dateTime).slice(0, 10) === draft.start.slice(0, 10);
  // A hastily entered appointment with a completely different title must still
  // be inspectable on the event day. This score is relevance, not certainty.
  const score = Math.max(titleScore, sameDay ? INFO_CALENDAR_MATCH_THRESHOLD : 0);
  return { score, reason: titleScore >= INFO_CALENDAR_MATCH_THRESHOLD ? "Titel vertoont overeenkomst" : sameDay ? "Alleen dezelfde datum — titel wijkt af" : "Geen overeenkomst" };
}
export const calendarDistribution = item => (item?.media || []).find(p => p?.kind === "campaign_distribution") || {};
export function calendarLocalTime(value) {
  const text = String(value || "");
  if (!text) return "";
  if (!/(Z|[+-]\d\d:\d\d)$/i.test(text)) return text.slice(0, 16);
  const date = new Date(text);
  if (Number.isNaN(date.getTime())) return "";
  const p = Object.fromEntries(new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/Amsterdam", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(date).map(p => [p.type, p.value]));
  return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}`;
}
export function calendarDraft(item) {
  const d = calendarDistribution(item), c = d.common || {};
  return { subject: c.title || "", description: c.description || item?.body || "", start: calendarLocalTime(c.start), end: calendarLocalTime(c.end), location: c.location || "" };
}
export function validateCalendarDraft(draft) {
  const d = {};
  for (const [key, max] of Object.entries({ subject: 250, description: 20000, location: 500, start: 16, end: 16 })) {
    if (typeof draft?.[key] !== "string" || draft[key].length > max) throw new Error("Controleer de afspraakgegevens en de lengte van de tekst.");
    d[key] = draft[key].trim();
  }
  if (!d.subject) throw new Error("Vul een titel in.");
  for (const value of [d.start, d.end]) {
    if (!/^\d{4}-\d{2}-\d{2}T([01]\d|2[0-3]):[0-5]\d$/.test(value) || !Number.isFinite(Date.parse(value + ":00Z")) || new Date(value + ":00Z").toISOString().slice(0,16) !== value) throw new Error("Vul een geldige begin- en eindtijd in.");
  }
  if (d.end <= d.start) throw new Error("De eindtijd moet na de begintijd liggen.");
  if (Date.parse(d.end + "Z") - Date.parse(d.start + "Z") > 31 * 86400000) throw new Error("Een afspraak mag hier maximaal 31 dagen duren.");
  return d;
}
export function calendarStatus(item) {
  const d = calendarDistribution(item), s = d.calendar_channel;
  if (s?.operation) return { key: "warning", label: "Uitkomst controleren" };
  if (s?.status === "present") return { key: "placed", label: "Aanwezig · gecontroleerd" };
  if (s?.status === "missing") return { key: "warning", label: "Niet gevonden in agenda" };
  if (s?.status === "cancelled") return { key: "warning", label: "Afspraak geannuleerd" };
  if (s?.status === "candidates") return { key: "warning", label: "Bestaande afspraak kiezen" };
  if (s?.status === "error") return { key: "warning", label: "Controle niet gelukt" };
  return { key: "concept", label: d.calendar_delivery?.mailbox === EVENT_MAILBOX && d.calendar_delivery?.event_id ? "Gekoppeld · nog controleren" : "Nog controleren / inplannen" };
}
export function calendarWebLink(value) {
  try { const u = new URL(value); return u.protocol === "https:" && ["outlook.office.com", "outlook.office365.com", "outlook.live.com"].includes(u.hostname) ? u.href : ""; } catch { return ""; }
}
export function calendarRemote(event) {
  if (!event?.id) throw new Error("Microsoft gaf geen herkenbare afspraak terug.");
  return { id: event.id, subject: event.subject || "", description: event.body?.content || event.bodyPreview || "", start: calendarLocalTime(event.start?.dateTime), end: calendarLocalTime(event.end?.dateTime), location: event.location?.displayName || "", web_link: calendarWebLink(event.webLink), etag: event["@odata.etag"] || "", cancelled: Boolean(event.isCancelled), editable: !event.isCancelled && !event.isAllDay && !event.isOnlineMeeting && !event.recurrence && (!event.type || event.type === "singleInstance") && !event.attendees?.length && event.isOrganizer !== false };
}
