import { campaignImages, publicWebUrl } from "./meta-campaign-settings";

export function sharePlainText(value) {
  return String(value || "").replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1>/gi, "")
    .replace(/<br\s*\/?\s*>|<\/p>|<\/div>/gi, "\n").replace(/<[^>]*>/g, "")
    .replace(/&(?:amp|lt|gt|quot|apos|nbsp);/g, entity => ({ "&amp;": "&", "&lt;": "<", "&gt;": ">", "&quot;": '"', "&apos;": "'", "&nbsp;": " " })[entity])
    .replace(/\n{3,}/g, "\n\n").trim();
}

export function whatsappDraft(item = {}, distribution = {}) {
  const common = distribution.common || {};
  const title = sharePlainText(common.title || distribution.source_preview?.title || "").slice(0, 200);
  const description = sharePlainText(common.short_description || common.description || distribution.source_preview?.description || item.body);
  // Only explicit event dates, never an internal publication/scheduling timestamp.
  const start = common.start || distribution.source_preview?.startDate;
  const date = start && Number.isFinite(Date.parse(start)) ? new Date(start).toLocaleString("nl-NL", { dateStyle: "full", timeStyle: "short", timeZone: "Europe/Amsterdam" }) : "";
  const location = typeof common.location === "string" ? sharePlainText(common.location).slice(0, 300) : "";
  const url = [common.cta?.url, common.website_url, distribution.source_url, distribution.source_preview?.sourceUrl].map(publicWebUrl).find(Boolean) || "";
  const remaining = Math.max(0, 4000 - [title, date, location, url].join("\n\n").length - 2);
  const parts = [title, date, location, description !== title ? description.slice(0, remaining) : "", url].filter(Boolean);
  return { text: parts.join("\n\n").slice(0, 4000), images: campaignImages(distribution), title: title || "Horeca OS" };
}

export function whatsappShareUrl(text) {
  return text.trim() ? `https://wa.me/?text=${encodeURIComponent(text.trim())}` : "";
}

const formats = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp" };
export const MAX_SHARE_IMAGE_BYTES = 10 * 1024 * 1024;
export async function prepareWhatsappImage(url, signal) {
  if (!publicWebUrl(url)) throw new Error("Kies een geldige afbeelding.");
  const response = await fetch(url, { mode: "cors", credentials: "omit", referrerPolicy: "no-referrer", signal });
  if (!response.ok) throw new Error("De foto kon niet worden opgehaald.");
  const type = (response.headers.get("content-type") || "").split(";")[0].toLowerCase();
  if (!formats[type]) throw new Error("Gebruik een JPG-, PNG- of WebP-afbeelding.");
  if (Number(response.headers.get("content-length")) > MAX_SHARE_IMAGE_BYTES) throw new Error("De foto is groter dan 10 MB. Kies een kleinere foto.");
  const blob = await response.blob();
  if (!blob.size || blob.size > MAX_SHARE_IMAGE_BYTES) throw new Error("De foto is leeg of groter dan 10 MB.");
  return new File([blob], `horeca-bericht.${formats[type]}`, { type });
}
