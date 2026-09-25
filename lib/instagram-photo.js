import { withRequestTimeout } from "./request-timeout";

// Browser-only conversion. No proxy, credentials, upload or publication on selection.
export async function prepareInstagramPhoto(asset) {
  const controller = new AbortController();
  const blob = await withRequestTimeout((async () => {
    const response = await fetch(asset.url, { mode: "cors", credentials: "omit", signal: controller.signal }).catch(() => {
      throw new Error("De bronfoto is niet bereikbaar of staat omzetten niet toe. Kies een andere foto uit Horeca OS.");
    });
    if (!response.ok) throw new Error("De foto kon niet worden geladen. Kies een andere foto uit Horeca OS.");
    if (Number(response.headers.get("content-length")) > 10 * 1024 * 1024) throw new Error("De bronfoto mag maximaal 10 MB zijn.");
    const source = await response.blob();
    if (source.size > 10 * 1024 * 1024) throw new Error("De bronfoto mag maximaal 10 MB zijn.");
    if (!["image/png", "image/webp", "image/jpeg"].includes(source.type)) throw new Error("De bron is geen ondersteunde foto (JPG, PNG of WebP).");
    return source;
  })(), "Het laden van de foto duurt te lang. Probeer opnieuw.", () => controller.abort(), 20000);
  const imageUrl = URL.createObjectURL(blob);
  const image = new window.Image();
  try {
    await withRequestTimeout(new Promise((resolve, reject) => {
      image.onload = resolve;
      image.onerror = () => reject(new Error("De foto kan niet worden gelezen. Kies een andere foto."));
      image.src = imageUrl;
    }), "De foto kon niet op tijd worden gelezen.", () => { image.src = ""; }, 15000);
    const width = image.naturalWidth, height = image.naturalHeight;
    if (!width || !height || width * height > 40000000) throw new Error("Deze foto is te groot of heeft ongeldige afmetingen.");
    // Keep the whole flyer: no crop, no enlargement. White replaces transparency.
    const scale = Math.min(1, 1440 / width, 2560 / height);
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(width * scale); canvas.height = Math.round(height * scale);
    const context = canvas.getContext("2d");
    if (!context) throw new Error("Deze browser kan geen JPG-kopie maken.");
    context.fillStyle = "#ffffff";
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    const jpeg = await withRequestTimeout(new Promise(resolve => canvas.toBlob(resolve, "image/jpeg", 0.92)), "De JPG-kopie kon niet op tijd worden gemaakt.", undefined, 15000);
    if (!jpeg || jpeg.type !== "image/jpeg" || jpeg.size > 8 * 1024 * 1024) throw new Error("Er kon geen JPG-kopie kleiner dan 8 MB worden gemaakt.");
    return { blob: jpeg, width: canvas.width, height: canvas.height };
  } finally { image.onload = null; image.onerror = null; URL.revokeObjectURL(imageUrl); }
}

// Uses the existing authenticated storage client and policies, never a service key.
export async function uploadInstagramPhoto(blob, { workspaceId, businessId, campaignId }) {
  if (![workspaceId, businessId, campaignId].every(value => typeof value === "string" && /^[a-zA-Z0-9-]+$/.test(value))) throw new Error("Het evenement of de vestiging ontbreekt. Open het evenement opnieuw.");
  if (blob.type !== "image/jpeg" || blob.size > 8 * 1024 * 1024) throw new Error("De JPG-kopie is niet geschikt voor Instagram.");
  const { supabase } = await import("./supabase");
  const bucket = supabase.storage.from("marketing-assets");
  const path = `${workspaceId}/${businessId}/instagram-${campaignId}-${crypto.randomUUID()}.jpg`;
  const { error } = await withRequestTimeout(bucket.upload(path, blob, { contentType: "image/jpeg", cacheControl: "31536000", upsert: false }), "Opslaan van de JPG-kopie duurt te lang. Er is nog niets naar Instagram verstuurd.", undefined, 30000);
  if (error) throw new Error(`De JPG-kopie kon niet worden opgeslagen: ${error.message}`);
  return bucket.getPublicUrl(path).data.publicUrl;
}
