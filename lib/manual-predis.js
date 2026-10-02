export const PREDIS_CHANNELS = { facebook: "Facebook", instagram: "Instagram", google: "Google Business Profile", tiktok: "TikTok" };
export const PREDIS_STATES = { pending: "Concept — nog niet overgezet", scheduled: "Ingepland · handmatig bevestigd", published: "Geplaatst · handmatig bevestigd" };
export const PREDIS_DAYS = [[1, "Ma"], [2, "Di"], [3, "Wo"], [4, "Do"], [5, "Vr"], [6, "Za"], [0, "Zo"]];
export const PREDIS_CAPTION_LIMIT = 1000;
export const PREDIS_PARAGRAPH_BLANK = "\u2800";
export const PREDIS_PARAGRAPH_SEPARATOR = `\n${PREDIS_PARAGRAPH_BLANK}\n`;
export const manualDistribution = item => (item?.media || []).find(entry => entry?.kind === "campaign_distribution");
function cleanCaption(value) { return String(value || "").replace(/\r/g, "").replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim(); }
function predisPlainText(value) { return cleanCaption(value).replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, "$1: $2").replace(/[*`]/g, ""); }
function publicCaptionUrl(value) {
  try { const url = new URL(String(value || "")); return ["https:", "http:"].includes(url.protocol) && !url.username && !url.password ? url.href : ""; }
  catch { return ""; }
}
function shortenCaption(value, limit) {
  const text = cleanCaption(value);
  if (limit <= 0) return "";
  if (text.length <= limit) return text;
  const cut = text.slice(0, Math.max(0, limit - 1));
  return `${cut.slice(0, cut.lastIndexOf(" ") > limit * 0.6 ? cut.lastIndexOf(" ") : cut.length).trim()}…`;
}
function eventCaptionDate(value) {
  if (!value || !Number.isFinite(Date.parse(value))) return "";
  return new Intl.DateTimeFormat("nl-NL", { weekday: "long", day: "numeric", month: "long", hour: "2-digit", minute: "2-digit", hourCycle: "h23", timeZone: "Europe/Amsterdam" }).format(new Date(value));
}
export function predisCaption(item, sourceText, limit = PREDIS_CAPTION_LIMIT) {
  const distribution = manualDistribution(item) || {}, common = distribution.common || {};
  const title = predisPlainText(common.title || distribution.source_preview?.title).slice(0, 240);
  const date = eventCaptionDate(common.start || distribution.source_preview?.startDate);
  const location = predisPlainText(common.location).slice(0, 240);
  const ticketUrl = [common.ticket_url, common.cta?.url, common.website_url, distribution.source_url, distribution.source_preview?.sourceUrl].map(publicCaptionUrl).find(Boolean) || "";
  const facts = [date && `📅 ${date}`, location && `📍 ${location}`].filter(Boolean);
  const practical = facts.join("\n");
  const ticket = ticketUrl ? `🎟️ Tickets: ${ticketUrl}` : "";
  const source = predisPlainText(sourceText || common.short_description || common.description || item?.body);
  const paragraphs = source.split(/\n\s*\n/).flatMap(paragraph => paragraph.split(/\n(?=#)/)).map(paragraph => paragraph.trim()).filter(Boolean);
  const prefix = [title, practical].filter(Boolean);
  const suffix = ticket ? [ticket] : [];
  const body = [];
  for (const paragraph of paragraphs) {
    const withoutParagraph = [...prefix, ...body, ...suffix].join(PREDIS_PARAGRAPH_SEPARATOR);
    const withParagraph = [...prefix, ...body, paragraph, ...suffix].join(PREDIS_PARAGRAPH_SEPARATOR);
    if (withParagraph.length <= limit) { body.push(paragraph); continue; }
    const layoutLength = withParagraph.length - withoutParagraph.length - paragraph.length;
    const shortened = shortenCaption(paragraph, limit - withoutParagraph.length - layoutLength);
    if (shortened) body.push(shortened);
    break;
  }
  return [...prefix, ...body, ...suffix].join(PREDIS_PARAGRAPH_SEPARATOR).slice(0, limit).trim();
}
export function localToday() { const p = Object.fromEntries(new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/Amsterdam", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date()).map(p => [p.type, p.value])); return `${p.year}-${p.month}-${p.day}`; }
export function planningLocalTime(now = Date.now()) {
  const p = Object.fromEntries(new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/Amsterdam", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(new Date(now)).map(p => [p.type, p.value]));
  return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}`;
}
function planningInstants(at) {
  const wall = Date.parse(at + ":00Z");
  if (!Number.isFinite(wall)) return [];
  return [1, 2].map(offset => wall - offset * 3600000).filter(instant => planningLocalTime(instant) === at);
}
export function nextPlanningMoment(now = Date.now()) {
  // Allow at least fifteen minutes to prepare; never suggest an ambiguous DST hour.
  let instant = Math.ceil((Number(now) + 15 * 60000) / (15 * 60000)) * 15 * 60000;
  while (planningInstants(planningLocalTime(instant)).length !== 1) instant += 15 * 60000;
  return planningLocalTime(instant);
}
export function validateNewMoments(entries, now = Date.now(), recorded = false) {
  for (const entry of entries) {
    const instants = planningInstants(entry.at);
    if (instants.length !== 1) throw new Error("Dit tijdstip bestaat niet of komt dubbel voor door zomer-/wintertijd. Kies een ander tijdstip.");
    if (!recorded && instants[0] <= Number(now)) throw new Error("Kies een tijdstip in de toekomst. Het gekozen moment is al verstreken.");
    if (recorded && instants[0] > Number(now)) throw new Error("Een al geplaatste post kan geen toekomstige publicatietijd hebben.");
  }
  return entries;
}
export function groupManualMoments(entries, now = Date.now()) {
  const groups = new Map();
  for (const entry of entries) {
    if (!groups.has(entry.at)) {
      const instants = planningInstants(entry.at);
      groups.set(entry.at, { at: entry.at, entries: [], elapsed: instants.length > 0 && Math.max(...instants) <= Number(now) });
    }
    groups.get(entry.at).entries.push(entry);
  }
  return [...groups.values()].sort((a, b) => a.at.localeCompare(b.at));
}
export function validDay(value) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(value + "T12:00:00Z");
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}
export function safeMediaUrl(value) {
  try { const u = new URL(value); return u.protocol === "https:" && !u.username && !u.password && !u.port ? u.href : ""; } catch { return ""; }
}
export function validateManualDraft(input) {
  if (!input || typeof input.caption !== "string" || input.caption.length > 10000) throw new Error("Gebruik maximaal 10.000 tekens voor de tekst.");
  if (!Array.isArray(input.assets) || input.assets.length > 10) throw new Error("Kies maximaal tien bestanden.");
  const assets = input.assets.map(a => {
    if (!a || !["image", "video"].includes(a.type) || typeof a.url !== "string" || a.url.length > 4000 || !safeMediaUrl(a.url)) throw new Error("Ongeldig mediabestand.");
    return { type: a.type, url: safeMediaUrl(a.url), label: String(a.label || "Mediabestand").slice(0, 200) };
  });
  if (!Array.isArray(input.entries) || input.entries.length > 160) throw new Error("Gebruik maximaal 160 kanaalacties per evenement.");
  const entries = input.entries.map(entry => {
    if (!entry || typeof entry.at !== "string" || !/^\d{4}-\d{2}-\d{2}T([01]\d|2[0-3]):[0-5]\d$/.test(entry.at) || !validDay(entry.at.slice(0, 10)) || !Object.hasOwn(PREDIS_CHANNELS, entry.channel)) throw new Error("Kies een geldige datum, tijd en kanaal.");
    return { at: entry.at, channel: entry.channel, key: `${entry.at}|${entry.channel}` };
  }).sort((a, b) => a.key.localeCompare(b.key));
  if (new Set(entries.map(e => e.key)).size !== entries.length) throw new Error("Een kanaal staat dubbel op hetzelfde tijdstip.");
  return { caption: input.caption, assets, entries, timezone: "Europe/Amsterdam" };
}
export function validateManualHandoff(draft) {
  const normalized = validateManualDraft(draft);
  if (!normalized.caption.trim()) throw new Error("Vul eerst je berichttekst in.");
  if (!normalized.assets.length) throw new Error("Kies eerst je originele afbeelding(en) of video.");
  if (new Set(normalized.assets.map(a => a.type)).size > 1) throw new Error("Kies afbeeldingen of video's voor één upload, niet beide tegelijk.");
  return normalized;
}
export function makeManualEntries({ start, end = start, time, weekdays, channels }) {
  if (!validDay(start) || !validDay(end) || end < start || !/^([01]\d|2[0-3]):[0-5]\d$/.test(time)) throw new Error("Controleer de datums en het tijdstip.");
  if (!channels?.length || channels.some(c => !Object.hasOwn(PREDIS_CHANNELS, c))) throw new Error("Kies minimaal één kanaal.");
  if (weekdays && (!weekdays.length || weekdays.some(d => !Number.isInteger(d) || d < 0 || d > 6))) throw new Error("Kies minimaal één weekdag.");
  const first = new Date(start + "T12:00:00Z"), last = new Date(end + "T12:00:00Z");
  if ((last - first) / 86400000 > 366) throw new Error("Kies een periode van maximaal een jaar.");
  const entries = [];
  for (const cursor = first; cursor <= last; cursor.setUTCDate(cursor.getUTCDate() + 1)) {
    if (!weekdays || weekdays.includes(cursor.getUTCDay())) for (const channel of channels) entries.push({ at: cursor.toISOString().slice(0, 10) + "T" + time, channel });
  }
  return validateManualDraft({ caption: "", assets: [], entries }).entries;
}
export function manualSummary(saved) {
  if (saved?.predis_schedule?.state === "scheduled") return "Ingepland in Predis";
  const entries = saved?.draft?.entries || [];
  if (!entries.length) return saved ? "Voorbereiding bewaard" : "Handmatig voorbereiden";
  const confirmed = entries.filter(e => ["scheduled", "published"].includes(saved.confirmations?.[e.key]?.state)).length;
  return `${confirmed}/${entries.length} handmatig bevestigd`;
}
export function transferText(title, draft) {
  return `${title}\n\n${draft.caption}\n\nGewenste planning (Europe/Amsterdam; NIET automatisch ingepland)\n${draft.entries.map(e => `${e.at.replace("T", " ")} — ${PREDIS_CHANNELS[e.channel]}`).join("\n")}\n\nMediabestanden\n${draft.assets.map(a => `${a.label}: ${a.url}`).join("\n")}`;
}
// Only preserve confirmations when the exact content AND target moment remain unchanged.
export function retainedConfirmations(previous, draft) {
  if (!previous || previous.draft.caption !== draft.caption || JSON.stringify(previous.draft.assets) !== JSON.stringify(draft.assets)) return {};
  return Object.fromEntries(draft.entries.filter(e => previous.confirmations?.[e.key]).map(e => [e.key, previous.confirmations[e.key]]));
}
