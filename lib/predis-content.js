import { manualDistribution } from "./manual-predis";
import { instagramEventMedia } from "./instagram-event-media";

// Predis retired model version 2 on 2 October 2026. Version 4 supports these
// two generated formats; existing historical video results remain readable.
export const PREDIS_FORMATS = { single_image: "Afbeelding", carousel: "Carrousel" };
export const PREDIS_JOB_LABELS = { submitting: "Aanvraag verstuurd — controle nodig", generating: "Aanvraag geaccepteerd — resultaat nog niet ontvangen", ready: "Content klaar — niet gepubliceerd", failed: "Aanvraag geweigerd", generation_failed: "Predis meldt: content maken mislukt", unknown: "Uitkomst onzeker — niet opnieuw versturen" };
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
  if (!Object.hasOwn(PREDIS_FORMATS, input.mediaType)) throw new Error("Kies afbeelding of carrousel.");
  if (!Array.isArray(input.mediaUrls)) throw new Error("Ongeldige bronbestanden.");
  if (input.mediaUrls.length > 10) throw new Error("Kies maximaal tien bronbestanden.");
  const available = predisSourceMedia(item), mediaUrls = input.mediaUrls.map(publicPredisUrl);
  if (mediaUrls.some(url => !url) || new Set(mediaUrls).size !== mediaUrls.length) throw new Error("Een gekozen bronbestand is ongeldig.");
  const sourceAssets = mediaUrls.map(url => available.find(asset => asset.url === url)).filter(Boolean);
  if (sourceAssets.length !== mediaUrls.length) throw new Error("Kies alleen een afbeelding die bij dit evenement is opgeslagen.");
  if (input.mediaType === "single_image" && mediaUrls.length > 1) throw new Error("Kies voor een enkele afbeelding precies één bronbestand.");
  const sourceMode = mediaUrls.length ? "own" : "ai";
  if (input.sourceMode !== undefined && input.sourceMode !== sourceMode) throw new Error("De gekozen bron past niet bij deze Predis-aanvraag.");
  return { prompt, mediaType: input.mediaType, mediaUrls, sourceMode, sourceAssets };
}
export function predisForm(input, brandId) {
  const form = new FormData();
  Object.entries({ brand_id: brandId, text: input.prompt, media_type: input.mediaType, n_posts: "1", model_version: "4", input_language: "dutch", output_language: "dutch" }).forEach(([key, value]) => form.set(key, value));
  if (input.mediaUrls.length) form.set("media_urls", JSON.stringify(input.mediaUrls));
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
