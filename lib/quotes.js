// Quote inputs are deliberately plain text. No external publication or mail is part of a draft.
export class QuoteError extends Error {
  constructor(message, status = 400) { super(message); this.status = status; }
}
export function uuid(value) {
  if (typeof value !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)) throw new QuoteError("Ongeldige verwijzing.");
  return value;
}
const text = (value, max, required = false) => {
  if (typeof value !== "string" || value.length > max || (required && !value.trim())) throw new QuoteError("Vul de verplichte velden in en controleer de tekstlengte.");
  return value.trim();
};
const integer = (value, min, max, label) => {
  const result = Number(value);
  if (value === "" || value === null || typeof value === "boolean" || !Number.isSafeInteger(result) || result < min || result > max) throw new QuoteError(`Controleer ${label}.`);
  return result;
};
function date(value, label, optional = false) {
  if (!value && optional) return "";
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value) || !Number.isFinite(Date.parse(value)) || new Date(value).toISOString().slice(0, 10) !== value) throw new QuoteError(`Controleer ${label}.`);
  return value;
}
export function moneyCents(value) {
  const normalized = String(value).trim().replace(",", ".");
  if (!/^\d{1,7}(\.\d{1,2})?$/.test(normalized)) throw new QuoteError("Vul prijzen in als bijvoorbeeld 48,50, zonder duizendtallen.");
  const [whole, fraction = ""] = normalized.split(".");
  return Number(whole) * 100 + Number(fraction.padEnd(2, "0"));
}
const euro = new Intl.NumberFormat("nl-NL", { style: "currency", currency: "EUR" });
export const formatMoney = cents => euro.format(cents / 100);
export function validateGuest(input = {}) {
  const result = Object.fromEntries([["name", 160], ["company", 160], ["email", 254], ["phone", 60], ["address", 300], ["notes", 2000]].map(([key, max]) => [key, text(input[key] ?? "", max, key === "name")]));
  if (result.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(result.email)) throw new QuoteError("Controleer het e-mailadres van de gast.");
  return result;
}
export function guestSnapshot(guest) {
  // Internal notes are never included in a guest-facing quote.
  const { notes, ...snapshot } = validateGuest(guest);
  return snapshot;
}
export function validateQuote(input = {}) {
  const title = text(input.title, 200, true);
  const eventDate = date(input.eventDate, "de evenementdatum");
  const validUntil = date(input.validUntil, "de geldigheidsdatum", true);
  const guestCount = integer(input.guestCount, 1, 100000, "het aantal gasten");
  if (!Array.isArray(input.lines) || !input.lines.length || input.lines.length > 80) throw new QuoteError("Voeg 1 tot 80 begrotingsregels toe.");
  let knownTotalCents = 0, pendingCount = 0;
  const lines = input.lines.map(line => {
    const label = text(line.label, 200, true);
    if (!["fixed", "person", "hour"].includes(line.unit)) throw new QuoteError("Kies een geldige eenheid.");
    const quantity = integer(line.quantity, 1, 100000, "het aantal per begrotingsregel");
    const hoursText = String(line.hours ?? "1").replace(",", ".");
    if (line.unit === "hour" && !/^\d{1,3}(\.\d{1,2})?$/.test(hoursText)) throw new QuoteError("Controleer het aantal uren.");
    const hours = line.unit === "hour" ? Number(hoursText) : 1;
    if (hours <= 0 || hours > 999) throw new QuoteError("Controleer het aantal uren.");
    const pending = line.pending === true;
    const priceCents = pending ? null : moneyCents(line.price);
    const totalCents = pending ? null : Math.round(priceCents * quantity * Math.round(hours * 100) / 100);
    if (pending) pendingCount++;
    else knownTotalCents += totalCents;
    return { label, unit: line.unit, quantity, hours: String(hours), price: priceCents === null ? "" : (priceCents / 100).toFixed(2), pending, totalCents };
  });
  if (!Number.isSafeInteger(knownTotalCents) || knownTotalCents > 1000000000) throw new QuoteError("Het offertebedrag is te groot. Controleer aantallen en prijzen.");
  if (!Array.isArray(input.program) || input.program.length > 40) throw new QuoteError("Gebruik maximaal 40 programmaonderdelen.");
  const program = input.program.map(row => {
    if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(row.time)) throw new QuoteError("Vul bij elk programmaonderdeel een tijd in.");
    return { time: row.time, nextDay: row.nextDay === true, description: text(row.description, 300, true) };
  });
  return { title, eventDate, validUntil, guestCount, location: text(input.location ?? "", 300), introduction: text(input.introduction ?? "", 10000), terms: text(input.terms ?? "", 12000), program, lines, knownTotalCents, pendingCount, priceBasis: "incl_vat", currency: "EUR" };
}
export function blankQuote() {
  return { title: "", eventDate: "", validUntil: "", guestCount: "1", location: "", introduction: "", terms: "", program: [], lines: [{ label: "", unit: "fixed", quantity: "1", hours: "1", price: "", pending: false }] };
}
