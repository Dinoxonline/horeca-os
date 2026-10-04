import { manualDistribution } from "./manual-predis";
import { instagramEventMedia } from "./instagram-event-media";

export const PREDIS_FORMATS = { single_image: "Afbeelding", carousel: "Carrousel", video: "Video" };
export const PREDIS_JOB_LABELS = { submitting: "Aanvraag verstuurd — controle nodig", generating: "Aanvraag geaccepteerd — resultaat nog niet ontvangen", ready: "Content klaar — niet gepubliceerd", failed: "Aanvraag geweigerd", generation_failed: "Predis meldt: content maken mislukt", unknown: "Uitkomst onzeker — niet opnieuw versturen" };
export function predisOwnMediaPrompt(item) {
  const d = manualDistribution(item) || {};
  return ["Gebruik uitsluitend de meegestuurde eigen afbeeldingen of video's. Behoud het volledige originele ontwerp, de tekst in het beeld, kleuren en verhoudingen. Niet bijsnijden, vervangen of opnieuw ontwerpen. Zet geen extra tekst, logo, sticker of andere elementen over het beeld. Neem het onderstaande bijschrift letterlijk over; herschrijf het niet en voeg geen hashtags toe.",
    "Bijschrift:", d.common?.description || item?.body || d.common?.title || ""].join("\n\n").slice(0, 10000);
}
export function predisSourceMedia(item) {
  return instagramEventMedia(item).filter(a => !a.issue);
}
export function predisPrompt(item) {
  const d = manualDistribution(item) || {}, c = d.common || {};
  return ["Maak een gastvrij Nederlands promotiebericht voor dit evenement of deze campagne. Verzin geen prijzen, tijden of programmaonderdelen.", c.title, c.description || item?.body,
    d.channel_payloads?.predis?.tone ? `Toon: ${d.channel_payloads.predis.tone}` : "",
    c.start ? `Begint: ${c.start}` : "", c.end ? `Eindigt: ${c.end}` : "", c.location ? `Locatie: ${typeof c.location === "string" ? c.location : ""}` : ""].filter(Boolean).join("\n\n").slice(0, 10000);
}
export function validatePredisInput(input, item) {
  const prompt = typeof input.prompt === "string" ? input.prompt.trim() : "";
  if (prompt.length < 20 || prompt.length > 10000 || prompt.split(/\s+/).length < 3) throw new Error("Gebruik 20 tot 10.000 tekens en minimaal drie woorden voor je opdracht.");
  if (!Object.hasOwn(PREDIS_FORMATS, input.mediaType)) throw new Error("Kies afbeelding, carrousel of video.");
  if (!Array.isArray(input.mediaUrls) || input.mediaUrls.length > 10 || new Set(input.mediaUrls).size !== input.mediaUrls.length) throw new Error("Kies maximaal tien verschillende evenementfoto’s.");
  if (input.sourceMode !== undefined && !["own", "ai"].includes(input.sourceMode)) throw new Error("Onbekende werkwijze.");
  if (input.sourceMode === "own" && !input.mediaUrls.length) throw new Error("Kies minimaal één eigen bestand. Zonder eigen bestand wordt deze proef niet verstuurd.");
  const assets = predisSourceMedia(item).filter(a => input.mediaType === "video" || a.type === "image");
  if (input.mediaUrls.some(url => !assets.some(a => a.url === url))) throw new Error("Een gekozen bestand hoort niet meer bij dit evenement of past niet bij dit inhoudstype. Laad opnieuw. Video's kunnen alleen voor video worden meegestuurd.");
  return { prompt, mediaType: input.mediaType, mediaUrls: input.mediaUrls, sourceMode: input.sourceMode || "ai",
    sourceAssets: input.mediaUrls.map(url => { const asset = assets.find(a => a.url === url); return { url, type: asset.type, label: asset.label }; }) };
}
export function predisForm(input, brandId) {
  const form = new FormData();
  Object.entries({ brand_id: brandId, text: input.prompt, media_type: input.mediaType, n_posts: "1", model_version: input.mediaUrls.length || input.mediaType === "video" ? "2" : "4", input_language: "dutch", output_language: "dutch" }).forEach(([key, value]) => form.set(key, value));
  if (input.mediaUrls.length) form.set("media_urls", JSON.stringify(input.mediaUrls));
  if (input.mediaType === "video") form.set("video_duration", "short");
  return form;
}
export function publicPredisUrl(value) {
  if (typeof value !== "string" || value.length > 4000) return "";
  try {
    const u = new URL(value), h = u.hostname;
    if (u.protocol !== "https:" || u.username || u.password || u.port || !h.includes(".") || h.includes(":") || h.endsWith(".local") || /^(localhost|127\.|0\.|10\.|192\.168\.|169\.254\.|172\.(1[6-9]|2\d|3[01])\.)/.test(h)) return "";
    return u.href;
  } catch { return ""; }
}
export function normalizePredisPost(post, ids) {
  if (!post || !ids.includes(String(post.post_id)) || !Object.hasOwn(PREDIS_FORMATS, post.media_type) || !Array.isArray(post.urls) || !post.urls.length || post.urls.length > 10) return null;
  const urls = post.urls.map(publicPredisUrl);
  if (urls.some(u => !u)) return null;
  return { id: String(post.post_id), caption: String(post.caption || "").slice(0, 10000), assets: urls.map((url, i) => ({ url, type: post.media_type === "video" || /\.(mp4|mov)(\?|$)/i.test(url) ? "video" : "image", label: `Predis · ${i + 1}` })), mediaType: post.media_type };
}
