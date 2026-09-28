import { manualDistribution, PREDIS_CHANNELS, validateManualDraft } from "./manual-predis";

// Calendar-only records. Never persist these as campaigns or send them to a provider.
export function publicationCalendarItems(items, businessById) {
  const result = [], seen = new Set(), entryIds = new Set();
  for (const parent of items || []) {
    if (!parent?.id || seen.has(String(parent.id)) || !businessById.has(String(parent.business_id))) continue;
    seen.add(String(parent.id));
    const distribution = manualDistribution(parent), saved = distribution?.manual_predis;
    for (const entry of Array.isArray(saved?.draft?.entries) ? saved.draft.entries : []) {
      let normalized;
      try { normalized = validateManualDraft({ caption: "", assets: [], entries: [entry] }).entries[0]; }
      catch { continue; }
      const { at, channel, key } = normalized;
      const id = `predis-publication:${parent.id}:${key}`;
      if (entryIds.has(id)) continue;
      entryIds.add(id);
      const confirmation = saved.confirmations?.[key];
      const state = ["scheduled", "published"].includes(confirmation?.state) ? confirmation.state : "pending";
      const label = state === "scheduled" ? "Ingepland · handmatig bevestigd"
        : state === "published" ? "Geplaatst · handmatig bevestigd" : "Voorbereid · nog niet verstuurd";
      const title = distribution.common?.title || "Zonder titel";
      result.push({
        id, business_id: parent.business_id,
        publication: { parent, at, channel, key, state, label, title, channelLabel: PREDIS_CHANNELS[channel] },
        // Keep the stored Dutch wall-clock day; do not parse it as UTC.
        media: [{ kind: "campaign_distribution", common: { start: at, title: `${at.slice(11)} · ${PREDIS_CHANNELS[channel]} · ${title}` } }],
      });
    }
  }
  return result.sort((a, b) => a.publication.at.localeCompare(b.publication.at) || a.id.localeCompare(b.id));
}

export function publicationCalendarSelection(item) {
  return item.publication ? { ...item.publication.parent, requestedChannel: "predis" } : item;
}
