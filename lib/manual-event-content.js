// Content delivery is separate from publication/reachability: a live link does
// not prove that the latest title and description have been applied.
export function eventContent(distribution) {
  return { title: String(distribution.common?.title || ""), description: String(distribution.common?.description ?? distribution.common?.short_description ?? "") };
}

export function facebookEventId(distribution) {
  const explicit = distribution.facebook_event_delivery?.external_id || distribution.external_ids?.facebook;
  if (/^\d+$/.test(String(explicit || ""))) return String(explicit);
  const urls = [distribution.facebook_event_delivery?.permalink, distribution.provider_delivery?.facebook?.permalink, distribution.verification?.links?.facebook, distribution.source_url];
  for (const value of urls) {
    try {
      const url = new URL(value);
      if (url.protocol !== "https:" || !/^(www\.|m\.)?facebook\.com$/.test(url.hostname)) continue;
      const match = url.pathname.match(/^\/events\/(\d+)(?:\/|$)/);
      if (match) return match[1];
    } catch { /* Missing or non-event URLs cannot identify a native event. */ }
  }
  // A Page post's delivery ID is NOT a native Facebook event ID.
  if (["facebook_event", "external_event"].includes(distribution.source_type) && distribution.external_source === "facebook") {
    const id = distribution.external_id || distribution.provider_delivery?.facebook?.external_id;
    if (/^\d+$/.test(String(id || ""))) return String(id);
  }
  return "";
}

export function contentSnapshot(distribution, channel) {
  return { ...eventContent(distribution), event_id: channel === "facebook" ? facebookEventId(distribution) : String(distribution.eventin_event_id || distribution.external_ids?.eventin || "") };
}

export function withVerifiedFacebookEvent(distribution, sources = []) {
  if (facebookEventId(distribution)) return distribution;
  const legacyId = String(distribution.provider_delivery?.facebook?.external_id || "");
  // Older records used the same delivery field for Page posts and native
  // events. Only promote that ID after the event-list API actually found it.
  const matched = sources.some(source => source.label === "Facebook" && source.item?.id === `compare:facebook:${legacyId}`);
  if (!/^\d+$/.test(legacyId) || !matched) return distribution;
  return { ...distribution, facebook_event_delivery: { ...distribution.facebook_event_delivery, external_id: legacyId, permalink: `https://www.facebook.com/events/${legacyId}/` } };
}

export function sameSnapshot(left, right) {
  return Boolean(left && right && left.title === right.title && left.description === right.description && left.event_id === right.event_id);
}

export function contentDeliveryStatus(distribution, channel) {
  const snapshot = contentSnapshot(distribution, channel);
  const delivery = distribution.event_content_delivery?.[channel];
  if (!snapshot.event_id) return { key: "not_linked", label: "Geen evenement gekoppeld" };
  if (!sameSnapshot(delivery?.snapshot, snapshot)) return { key: "needs_update", label: "Bijwerken nodig" };
  if (channel === "facebook" && delivery.status === "manual_confirmed" && delivery.confirmed_at) return { key: "manual_confirmed", label: "Handmatig bijgewerkt", at: delivery.confirmed_at };
  if (channel === "website" && delivery.status === "updated") return { key: "updated", label: "Website bijgewerkt", at: delivery.updated_at };
  if (channel === "website" && delivery.status === "failed") return { key: "failed", label: "Website bijwerken mislukt" };
  if (channel === "website" && delivery.status === "updating") return { key: "updating", label: "Website-update gestart; resultaat nog niet bevestigd" };
  return { key: "ready", label: channel === "facebook" ? "Gereed voor handmatige verwerking" : "Website bijwerken nodig" };
}

export function prepareContent(distribution, content, at) {
  const next = { ...distribution, common: { ...distribution.common, ...content } };
  const previous = distribution.event_content_delivery || {};
  const facebook = sameSnapshot(previous.facebook?.snapshot, contentSnapshot(next, "facebook"))
    ? previous.facebook
    : { mode: "manual", status: "ready", snapshot: contentSnapshot(next, "facebook"), prepared_at: at };
  return { ...next, event_content_delivery: { ...previous, facebook } };
}

export function confirmFacebookContent(distribution, expectedSnapshot, userId, at) {
  const state = contentDeliveryStatus(distribution, "facebook");
  if (!userId || !["ready", "manual_confirmed"].includes(state.key) || !sameSnapshot(expectedSnapshot, contentSnapshot(distribution, "facebook"))) {
    throw new Error("De tekst of Facebook-koppeling is gewijzigd. Sla de tekst opnieuw op en controleer Facebook vóór je bevestigt.");
  }
  return { ...distribution, event_content_delivery: { ...distribution.event_content_delivery, facebook: { ...distribution.event_content_delivery.facebook, mode: "manual", status: "manual_confirmed", confirmed_at: at, confirmed_by: userId } } };
}

function equalValue(a, b) {
  if (a === b) return true;
  if (!a || !b || typeof a !== "object" || typeof b !== "object" || Array.isArray(a) !== Array.isArray(b)) return false;
  const keys = Object.keys(a);
  return keys.length === Object.keys(b).length && keys.every(key => Object.hasOwn(b, key) && equalValue(a[key], b[key]));
}

const contentConflict = () => new Error("Dit evenement is intussen gewijzigd. Je gekozen tekst is niet opgeslagen. Sluit de details, ververs de agenda en vergelijk opnieuw.");

// Apply only this action's changes to the latest distribution. Unrelated
// verification, media and Instagram changes must survive a concurrent save.
function mergeChanges(before, desired, latest) {
  if (equalValue(before, desired)) return latest;
  if (equalValue(latest, before) || equalValue(latest, desired)) return desired;
  const object = value => value && typeof value === "object" && !Array.isArray(value);
  if (!object(desired) || (before !== undefined && !object(before)) || !object(latest)) throw contentConflict();
  const result = { ...latest };
  for (const key of new Set([...Object.keys(before || {}), ...Object.keys(desired)])) {
    if (["__proto__", "constructor", "prototype"].includes(key)) throw contentConflict();
    const value = mergeChanges(before?.[key], desired[key], latest[key]);
    if (value === undefined) delete result[key];
    else result[key] = value;
  }
  return result;
}

export async function saveEventContent(client, workspaceId, item, distribution, body) {
  const previous = (item.media || []).filter(entry => entry?.kind === "campaign_distribution");
  if (!workspaceId || !item.id || !item.business_id || previous.length !== 1) throw new Error("De evenementgegevens ontbreken.");
  const before = previous[0];
  for (let attempt = 0; attempt < 3; attempt++) {
    const scoped = () => client.from("social_content_items");
    const { data: latest, error: readError } = await scoped().select("id,business_id,body,media,updated_at")
      .eq("workspace_id", workspaceId).eq("business_id", item.business_id).eq("id", item.id).maybeSingle();
    if (readError) throw new Error("De huidige tekst kon niet worden gecontroleerd. Er is niets opgeslagen. Probeer opnieuw.");
    if (!latest?.updated_at || latest.id !== item.id || latest.business_id !== item.business_id) throw contentConflict();
    const distributions = (latest.media || []).filter(entry => entry?.kind === "campaign_distribution");
    const current = distributions[0];
    if (distributions.length !== 1 || !equalValue(eventContent(current), eventContent(before))
      || contentSnapshot(current, "website").event_id !== contentSnapshot(before, "website").event_id
      || facebookEventId(current) !== facebookEventId(before) || current.duplicate_of !== before.duplicate_of
      || (body !== undefined && Object.hasOwn(item, "body") && latest.body !== item.body)) throw contentConflict();
    const merged = mergeChanges(before, distribution, current);
    const patch = { media: latest.media.map(entry => entry?.kind === "campaign_distribution" ? merged : entry), ...(body !== undefined ? { body } : {}) };
    // Keep the precise database timestamp; serializing media in the URL can
    // exceed the gateway's request limit. RLS and all ownership filters remain.
    const { data, error } = await scoped().update(patch)
      .eq("workspace_id", workspaceId).eq("business_id", item.business_id).eq("id", item.id)
      .eq("updated_at", latest.updated_at).select("id,updated_at").maybeSingle();
    if (error) throw new Error("Bewaren in Horeca OS is mislukt. Je keuze blijft staan; probeer opnieuw.");
    if (data?.id === item.id) return { ...item, ...latest, ...patch, updated_at: data.updated_at };
  }
  throw contentConflict();
}
