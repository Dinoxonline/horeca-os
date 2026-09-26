export const PREDIS_CHANNELS = { facebook: "Facebook", instagram: "Instagram", google: "Google Business Profile", tiktok: "TikTok" };
export const PREDIS_STATES = { pending: "Nog overzetten", scheduled: "Ingepland · handmatig bevestigd", published: "Geplaatst · handmatig bevestigd" };
export const PREDIS_DAYS = [[1, "Ma"], [2, "Di"], [3, "Wo"], [4, "Do"], [5, "Vr"], [6, "Za"], [0, "Zo"]];
export const manualDistribution = item => (item?.media || []).find(entry => entry?.kind === "campaign_distribution");
export function localToday() { const p = Object.fromEntries(new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/Amsterdam", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date()).map(p => [p.type, p.value])); return `${p.year}-${p.month}-${p.day}`; }
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
  return { caption: input.caption.trim(), assets, entries, timezone: "Europe/Amsterdam" };
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
