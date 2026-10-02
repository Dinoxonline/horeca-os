function cardCount(value) { return Math.max(1, Number(value) || 1); }

export function giveawayOverlayLines({ cards }) {
  const count = cardCount(cards);
  return ["WINACTIE", `WIN ${count} ${count === 1 ? "KAART" : "KAARTEN"}`];
}

export function giveawayImageFilename(title) {
  const name = String(title || "evenement").toLocaleLowerCase("nl-NL").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60) || "evenement";
  return `horeca-os-winactie-${name}.jpg`;
}

export async function renderGiveawayImage(url, draft) {
  const response = await fetch(url, { mode: "cors", credentials: "omit" }).catch(() => { throw new Error("De gekozen foto is niet bereikbaar. Kies een andere evenementfoto."); });
  if (!response.ok) throw new Error("De gekozen foto kon niet worden geladen. Kies een andere evenementfoto.");
  const source = await response.blob();
  if (!/^image\/(jpeg|png|webp)$/.test(source.type) || source.size > 10 * 1024 * 1024) throw new Error("Gebruik een JPG-, PNG- of WebP-foto van maximaal 10 MB.");
  const objectUrl = URL.createObjectURL(source);
  const image = new window.Image();
  try {
    await new Promise((resolve, reject) => { image.onload = resolve; image.onerror = () => reject(new Error("De gekozen foto kan niet worden gelezen.")); image.src = objectUrl; });
    const scale = Math.min(1, 1600 / image.naturalWidth, 2400 / image.naturalHeight);
    const width = Math.round(image.naturalWidth * scale), height = Math.round(image.naturalHeight * scale);
    if (!width || !height) throw new Error("De gekozen foto heeft geen bruikbaar formaat.");
    const canvas = document.createElement("canvas"); canvas.width = width; canvas.height = height;
    const context = canvas.getContext("2d"); if (!context) throw new Error("Je browser kan geen winactiebeeld maken.");
    context.drawImage(image, 0, 0, width, height);
    const bandHeight = Math.min(Math.round(height * 0.34), Math.max(180, Math.round(height * 0.24)));
    context.fillStyle = "rgba(4, 23, 38, 0.92)"; context.fillRect(0, height - bandHeight, width, bandHeight);
    const [headline, detail] = giveawayOverlayLines(draft);
    context.textAlign = "center"; context.fillStyle = "#ffffff";
    context.font = `900 ${Math.max(42, Math.round(width * 0.11))}px Arial, sans-serif`;
    context.fillText(headline, width / 2, height - Math.round(bandHeight * 0.57));
    context.fillStyle = "#ffd34e"; context.font = `800 ${Math.max(26, Math.round(width * 0.05))}px Arial, sans-serif`;
    context.fillText(detail, width / 2, height - Math.round(bandHeight * 0.19));
    const result = await new Promise(resolve => canvas.toBlob(resolve, "image/jpeg", 0.92));
    if (!result) throw new Error("Het winactiebeeld kon niet worden gemaakt.");
    return result;
  } finally { image.onload = null; image.onerror = null; URL.revokeObjectURL(objectUrl); }
}
