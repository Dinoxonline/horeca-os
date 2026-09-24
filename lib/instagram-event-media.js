import { validateInstagramDraft } from "./instagram-publishing";

// Use only this event and the exact linked sources already checked by the agenda.
// No storage listing, extra fetches or cross-event media search is needed.
export function instagramEventMedia(item, linkedSources = []) {
  const result = [];
  const seen = new Set();
  function add(value, type, label) {
    const entry = typeof value === "string" ? { url: value } : value;
    if (!entry?.url) return;
    const mime = String(entry.content_type || entry.mime_type || "");
    const detectedType = entry.type === "video" || entry.kind === "video" || mime.startsWith("video/") || /\.(mp4|mov)(\?|$)/i.test(entry.url) ? "video" : type;
    let asset;
    try { asset = validateInstagramDraft({ format: detectedType === "video" ? "reel" : "feed", assets: [{ type: detectedType, url: entry.url }] }).assets[0]; }
    catch { return; }
    if (seen.has(asset.url)) return;
    seen.add(asset.url);
    const unsupportedImage = detectedType === "image" && ((mime && mime !== "image/jpeg") || /\.(png|webp|gif|svg)(\?|$)/i.test(asset.url));
    result.push({ ...asset, label: entry.label || entry.name || label, issue: unsupportedImage ? "Voor Instagram is een JPG-versie nodig." : "" });
  }
  for (const source of [{ label: "Horeca OS", item }, ...linkedSources.filter(source => source.label !== "Horeca OS" && source.item?.business_id && source.item.business_id === item.business_id)]) {
    const distribution = (source.item?.media || []).find(entry => entry?.kind === "campaign_distribution") || {};
    const common = distribution.common || {};
    const prefix = source.label === "Horeca OS" ? "Evenement" : `Gekoppeld ${source.label}-evenement`;
    add(distribution.channel_payloads?.instagram?.image_url, "image", `${prefix} · Instagram-afbeelding`);
    for (const [profile, label] of Object.entries({ portrait: "Staand", square: "Vierkant", vertical: "Story / Reel", landscape: "Liggend" })) {
      add(common.images?.[profile], "image", `${prefix} · ${label}`);
    }
    add(common.image_url, "image", `${prefix} · Foto`);
    add(common.video_url, "video", `${prefix} · Video`);
    for (const asset of distribution.campaign_assets || []) add(asset, "image", `${prefix} · Campagnamedia`);
    for (const asset of source.item?.media || []) {
      if (asset?.kind !== "campaign_distribution" && (asset?.kind === "image" || asset?.kind === "video" || asset?.type === "image" || asset?.type === "video" || /^(image|video)\//.test(asset?.content_type || ""))) add(asset, "image", `${prefix} · Media`);
    }
    add(distribution.source_preview?.image, "image", `${prefix} · Bronafbeelding`);
  }
  return result;
}
