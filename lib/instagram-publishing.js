export const INSTAGRAM_FORMATS = {
  feed: { label: "Feedbericht (foto)", hint: "Eén foto met bijschrift in je feed.", recommended: "1080 × 1350 px (4:5, staand) of 1080 × 1080 px (1:1, vierkant).", min: 1, max: 1 },
  carousel: { label: "Carrousel", hint: "2–10 foto's of video's in één feedbericht, in de gekozen volgorde.", recommended: "1080 × 1350 px (4:5) of 1080 × 1080 px (1:1). Gebruik dezelfde verhouding voor alle beelden; Instagram kan anders bijsnijden.", min: 2, max: 10 },
  story: { label: "Story (verhaal)", hint: "Eén foto of video. Tekst moet al in het beeld staan; geen los bijschrift.", recommended: "1080 × 1920 px (9:16, schermvullend staand). Foto of video.", min: 1, max: 1 },
  reel: { label: "Reel (video)", hint: "Eén video met bijschrift. Een losse foto is geen Reel.", recommended: "1080 × 1920 px (9:16, staand). Video in MP4 of MOV; geen losse foto.", min: 1, max: 1 },
};

export function validateInstagramDraft(input) {
  const format = Object.hasOwn(INSTAGRAM_FORMATS, input?.format) && INSTAGRAM_FORMATS[input.format];
  if (!format) throw new Error("Kies een geldig Instagram-formaat.");
  const caption = String(input.caption || "").trim();
  if ([...caption].length > 2200) throw new Error("Het bijschrift mag maximaal 2.200 tekens bevatten.");
  const assets = input.assets;
  if (!Array.isArray(assets) || assets.length < format.min || assets.length > format.max) throw new Error(`Kies ${format.min === format.max ? format.min : "2–10"} mediabestand(en) voor dit formaat.`);
  const normalized = assets.map(asset => {
    if (!["image", "video"].includes(asset?.type)) throw new Error("Kies foto of video.");
    let url;
    try { url = new URL(asset.url); } catch { throw new Error("Gebruik een openbare HTTPS-link naar het mediabestand."); }
    if (url.protocol !== "https:" || url.username || url.password || url.port || !url.hostname.includes(".") || /^(localhost|127\.|10\.|192\.168\.|169\.254\.|172\.(1[6-9]|2\d|3[01])\.)/.test(url.hostname) || url.hostname.includes(":")) throw new Error("Gebruik een openbare HTTPS-link zonder inloggegevens.");
    if (input.format === "feed" && asset.type !== "image") throw new Error("Gebruik voor een losse video het formaat Reel.");
    if (input.format === "reel" && asset.type !== "video") throw new Error("Voor een Reel is een video nodig.");
    return { type: asset.type, url: url.href };
  });
  return { format: input.format, caption: input.format === "story" ? "" : caption, assets: normalized, shareToFeed: input.format === "reel" && input.shareToFeed === true };
}

export function instagramContainerValues(draft, asset, child = false) {
  const values = asset.type === "video" ? { video_url: asset.url, media_type: child ? "VIDEO" : draft.format === "story" ? "STORIES" : "REELS" } : { image_url: asset.url };
  if (child) values.is_carousel_item = "true";
  else if (draft.format === "story") values.media_type = "STORIES";
  else {
    values.caption = draft.caption;
    if (draft.format === "reel") values.share_to_feed = String(draft.shareToFeed);
  }
  return values;
}

export function instagramJobLabel(job) {
  return ({
    preparing: "Media wordt klaargezet", processing: "Instagram verwerkt de media",
    ready: "Gereed om te publiceren", publishing: "Publicatie gestart — controleer de status",
    unknown: "Publicatie-uitkomst onzeker — niet opnieuw plaatsen",
    published: "Geplaatst op Instagram", failed: "Voorbereiden mislukt",
  })[job?.status] || "Nog niet geplaatst";
}
