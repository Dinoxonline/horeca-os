"use client";

import { useEffect, useMemo, useState } from "react";
import Image from "next/image";
import useEventPreparation from "./use-event-preparation";
import { instagramEventMedia } from "../lib/instagram-event-media";
import { giveawayImageFilename, giveawayOverlayLines, renderGiveawayImage, uploadGiveawayImage } from "../lib/giveaway-image";

function dateInput(value) {
  const match = String(value || "").match(/^\d{4}-\d{2}-\d{2}/);
  return match ? match[0] : "";
}

function addDays(value, days) {
  const base = dateInput(value);
  if (!base) return "";
  const date = new Date(`${base}T12:00:00`);
  date.setDate(date.getDate() + days);
  return date.toISOString().slice(0, 10);
}

function readableDate(value) {
  const date = new Date(`${dateInput(value)}T12:00:00`);
  return Number.isNaN(date.getTime()) ? "de aangegeven datum" : new Intl.DateTimeFormat("nl-NL", { weekday: "long", day: "numeric", month: "long" }).format(date);
}

function readableTime(value) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "tijd volgt" : new Intl.DateTimeFormat("nl-NL", { hour: "2-digit", minute: "2-digit" }).format(date);
}

export function giveawayDraftStorageKey(itemId) {
  return `horeca-os-event-giveaway:${String(itemId || "new")}`;
}

export function buildGiveawayText(draft) {
  const cards = Math.max(1, Number(draft.cards) || 1);
  const cardLabel = cards === 1 ? "kaart" : "kaarten";
  const eventDate = draft.start ? `${readableDate(draft.start)}${draft.start.includes("T") ? ` · ${readableTime(draft.start)}` : ""}` : "Datum volgt";
  const ticketLine = draft.ticketUrl ? `\nMeer informatie en tickets: ${draft.ticketUrl}\n` : "";
  return `🎉 WINACTIE — WIN ${cards} ${cardLabel.toUpperCase()}!\n\nWil jij naar ${draft.title || "dit evenement"}?\n\n📅 ${eventDate}\n📍 ${draft.location || "Locatie volgt"}\n\nWe geven ${cards} ${cardLabel} weg voor ${draft.title || "dit evenement"}.\n\nZo doe je mee:\n1. Volg ${draft.businessName || "onze pagina"}\n2. Like dit bericht\n3. Laat in de reacties weten met wie je wilt komen\n\nMeedoen kan t/m ${readableDate(draft.deadline)}. De winnaar maken we uiterlijk ${readableDate(draft.announcement)} bekend via onze pagina. Reageert de winnaar niet binnen ${Math.max(1, Number(draft.responseHours) || 12)} uur, dan kiezen we een nieuwe winnaar.${ticketLine}\nDeze winactie wordt niet gesponsord, ondersteund, beheerd door of verbonden aan Facebook of Instagram.`;
}

export function defaultGiveawayDraft({ item, distribution, businessName }) {
  const common = distribution?.common || {};
  const start = String(common.start || item?.scheduled_for || "");
  const facebook = distribution?.facebook_event_delivery || distribution?.provider_delivery?.facebook || {};
  const pageId = String(facebook.page_id || facebook.pageId || "").trim();
  const draft = {
    title: common.title || item?.body || "",
    start,
    location: common.location || businessName || "",
    ticketUrl: common.website_url || common.ticket_url || "",
    imageUrl: common.image_url || common.images?.portrait?.url || common.images?.square?.url || common.images?.landscape?.url || "",
    facebookPageUrl: common.facebook_page_url || facebook.page_url || facebook.page_permalink || (/^\d+$/.test(pageId) ? `https://www.facebook.com/${pageId}` : "https://www.facebook.com/"),
    businessName: businessName || "",
    cards: common.giveaway?.cards || 2,
    deadline: common.giveaway?.deadline || addDays(start, -6),
    announcement: common.giveaway?.announcement || addDays(start, -3),
    responseHours: common.giveaway?.responseHours || 12,
  };
  return { ...draft, text: buildGiveawayText(draft) };
}

export default function EventGiveaway({ client, item, distribution, businessName, workspaceId, session, onPublished, registerSave, enabled = true }) {
  const storageKey = giveawayDraftStorageKey(item?.id);
  const defaults = useMemo(() => defaultGiveawayDraft({ item, distribution, businessName }), [item, distribution, businessName]);
  const [draft, setDraft] = useState(() => ({ ...defaults, ...distribution?.channel_drafts?.facebook_giveaway }));
  const [ready, setReady] = useState(false);
  const [message, setMessage] = useState("");
  const [imageBusy, setImageBusy] = useState(false);
  const [previewAspectRatio, setPreviewAspectRatio] = useState("4 / 5");
  const [publishedPost, setPublishedPost] = useState(() => distribution?.provider_delivery?.facebook_giveaway || null);
  const imageOptions = useMemo(() => instagramEventMedia(item).filter((asset) => asset.type === "image" && !asset.issue), [item]);
  const selectedImage = imageOptions.find((asset) => asset.url === draft.imageUrl) || imageOptions[0] || null;
  const overlayLines = giveawayOverlayLines(draft);
  const savedGiveaway = distribution?.provider_delivery?.facebook_giveaway;
  const giveawayPublication = publishedPost || savedGiveaway;
  const giveawayPublished = ["confirmed", "published"].includes(giveawayPublication?.status);

  useEffect(() => {
    try {
      const stored = window.localStorage.getItem(storageKey);
      setDraft(distribution?.channel_drafts?.facebook_giveaway ? { ...defaults, ...distribution.channel_drafts.facebook_giveaway } : stored ? { ...defaults, ...JSON.parse(stored) } : defaults);
    } catch { setDraft(defaults); }
    setReady(true);
  }, [storageKey]);

  useEffect(() => {
    if (!ready) return;
    try { window.localStorage.setItem(storageKey, JSON.stringify(draft)); } catch { /* The concept remains usable when browser storage is unavailable. */ }
  }, [draft, ready, storageKey]);

  useEffect(() => {
    if (savedGiveaway?.external_id) setPublishedPost(savedGiveaway);
  }, [savedGiveaway?.external_id, savedGiveaway?.permalink, savedGiveaway?.published_at]);

  const preparation = useEventPreparation({ client, item, workspaceId, channel: 'facebook_giveaway', value: draft, enabled: ready && enabled, onSaved: onPublished, registerSave });
  function update(name, value) {
    setDraft((current) => {
      const next = { ...current, [name]: value };
      return { ...next, text: buildGiveawayText(next) };
    });
    setMessage("");
  }

  function reset() {
    setDraft(defaults);
    setMessage("De evenementgegevens zijn opnieuw ingevuld. Je concept is nog nergens geplaatst.");
  }

  async function copy() {
    try {
      await navigator.clipboard.writeText(draft.text);
      setMessage("Winactietekst gekopieerd. Plak hem zelf in je Facebook- of Instagrambericht.");
    } catch { setMessage("Kopiëren is geblokkeerd. Selecteer de tekst en gebruik Ctrl+C."); }
  }

  async function downloadImageFile() {
    const blob = await renderGiveawayImage(selectedImage.url, draft);
    const objectUrl = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = objectUrl; link.download = giveawayImageFilename(draft.title); link.style.display = "none";
    document.body.appendChild(link); link.click(); link.remove(); URL.revokeObjectURL(objectUrl);
  }

  async function downloadImage() {
    if (!selectedImage || imageBusy) return;
    setImageBusy(true); setMessage("");
    try { await downloadImageFile(); setMessage("Het winactiebeeld is gedownload. Voeg het zelf toe aan je Facebookbericht."); }
    catch (error) { setMessage(error.message || "Het winactiebeeld kon niet worden gemaakt."); }
    finally { setImageBusy(false); }
  }

  async function openFacebookToPublish() {
    if (!selectedImage || imageBusy) return;
    const popup = window.open("about:blank", "_blank");
    if (popup) popup.opener = null;
    setImageBusy(true); setMessage("");
    try {
      const copied = await navigator.clipboard.writeText(draft.text).then(() => true, () => false);
      await downloadImageFile();
      if (popup && !popup.closed) popup.location.replace(draft.facebookPageUrl || "https://www.facebook.com/");
      setMessage(`${copied ? "Tekst is gekopieerd" : "Kopiëren is geblokkeerd; gebruik Ctrl+C in het tekstvak"} en het winactiebeeld is gedownload. Facebook is geopend: voeg het beeld toe, plak de tekst en klik daar zelf op Plaatsen.`);
    } catch (error) { popup?.close(); setMessage(error.message || "Facebook kon niet worden voorbereid."); }
    finally { setImageBusy(false); }
  }

  async function publishDirectly() {
    if (!selectedImage || imageBusy) return;
    if (!window.confirm(`Plaats deze winactie nu echt op ${draft.businessName || "de gekoppelde Facebookpagina"}?`)) return;
    setImageBusy(true); setMessage("");
    try {
      const blob = await renderGiveawayImage(selectedImage.url, draft);
      const imageUrl = await uploadGiveawayImage(blob, { workspaceId, businessId: item.business_id, campaignId: item.id });
      const response = await fetch("/api/integrations/facebook/publish", {
        method: "POST", headers: { Authorization: `Bearer ${session?.access_token || ""}`, "Content-Type": "application/json" },
        body: JSON.stringify({ workspaceId, businessId: item.business_id, campaignId: item.id, action: "publish_giveaway", giveaway: { text: draft.text, image_url: imageUrl } }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "De winactie kon niet op Facebook worden geplaatst.");
      setPublishedPost({ status: "confirmed", external_id: result.post?.id, permalink: result.post?.permalink, published_at: new Date().toISOString() });
      if (result.campaign) onPublished?.(result.campaign);
      setMessage(result.alreadyPublished ? "Deze winactie stond al op Facebook. De bestaande publicatie is gekoppeld." : `De winactie is op ${result.post?.pageName || "Facebook"} geplaatst.`);
    } catch (error) { setMessage(error.message || "De winactie kon niet op Facebook worden geplaatst."); }
    finally { setImageBusy(false); }
  }

  return <section className="marketingGiveaway" aria-label="Winactie voorbereiden" style={{ display: "grid", gap: 14, padding: "14px 0" }}>
    {preparation.notice && <p role="status">{preparation.notice}</p>}
    <div><h4>Winactie voorbereiden</h4><p>Horeca OS heeft de evenementgegevens ingevuld. Kies hieronder je variabelen; er wordt niets automatisch geplaatst.</p></div>
    <div className="marketingGiveawayFields" style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 12 }}>
      <label style={{ display: "grid", gap: 5 }}>Aantal kaarten<input type="number" min="1" max="50" value={draft.cards} onChange={(event) => update("cards", event.target.value)} /></label>
      <label style={{ display: "grid", gap: 5 }}>Meedoen t/m<input type="date" value={dateInput(draft.deadline)} onChange={(event) => update("deadline", event.target.value)} /></label>
      <label style={{ display: "grid", gap: 5 }}>Winnaar bekendmaken<input type="date" value={dateInput(draft.announcement)} onChange={(event) => update("announcement", event.target.value)} /></label>
      <label style={{ display: "grid", gap: 5 }}>Reactietijd winnaar (uur)<input type="number" min="1" max="168" value={draft.responseHours} onChange={(event) => update("responseHours", event.target.value)} /></label>
    </div>
    <section style={{ display: "grid", gap: 10 }} aria-label="Afbeelding voor de winactie">
      <div><strong>Afbeelding voor de winactie</strong><p style={{ margin: "4px 0 0" }}>Kies een evenementfoto. De flyer blijft ongesneden en maximaal 1080 pixels breed, zonder ruimte naast de flyer. Daaronder komt een aparte winactiebalk van dezelfde breedte.</p></div>
      {giveawayPublished && <div role="status" style={{ display: "grid", gap: 8, padding: 14, border: "1px solid #22864d", borderRadius: 8, background: "#edf9f0", color: "#145c31" }}><strong>✓ Winactie geplaatst op Facebook</strong><span>Deze winactie is al gepubliceerd. Je hoeft niets meer te doen.</span>{giveawayPublication?.permalink && <a style={{ width: "fit-content", padding: "10px 14px", borderRadius: 7, background: "#176d7f", color: "#fff", fontWeight: 700, textDecoration: "none" }} href={giveawayPublication.permalink} target="_blank" rel="noreferrer">Bekijk bericht op Facebook ↗</a>}</div>}
      {imageOptions.length ? <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>{imageOptions.map((asset) => <button type="button" key={asset.url} onClick={() => update("imageUrl", asset.url)} aria-pressed={selectedImage?.url === asset.url} title={asset.label} style={{ display: "grid", gap: 5, width: 126, padding: 5, border: selectedImage?.url === asset.url ? "2px solid #1677ff" : "1px solid #cbdde5", borderRadius: 7, background: "#fff", color: "#173552", cursor: "pointer", textAlign: "left" }}><Image unoptimized src={asset.url} alt={asset.label} width={116} height={82} style={{ width: "100%", height: 82, objectFit: "cover", borderRadius: 4 }} /><small>{asset.label}</small></button>)}</div> : <p>Er is nog geen bruikbare evenementfoto. Kies eerst een hoofdfoto bij het evenement.</p>}
      {selectedImage && <div style={{ width: "min(100%, 420px)", overflow: "hidden", borderRadius: 9, background: "#071c2d" }}><div style={{ position: "relative", aspectRatio: previewAspectRatio }}><Image unoptimized src={selectedImage.url} alt="Voorbeeld van het winactiebeeld" fill sizes="420px" onLoad={(event) => { const { naturalWidth, naturalHeight } = event.currentTarget; if (naturalWidth && naturalHeight) setPreviewAspectRatio(`${naturalWidth} / ${naturalHeight}`); }} style={{ objectFit: "contain" }} /></div><div style={{ display: "grid", gap: 2, padding: "18px 12px", background: "rgba(4, 23, 38, .92)", color: "#fff", textAlign: "center", pointerEvents: "none" }}><strong style={{ fontSize: 34, lineHeight: 1 }}>{overlayLines[0]}</strong><span style={{ color: "#ffd34e", fontWeight: 800, fontSize: 18 }}>{overlayLines[1]}</span></div></div>}
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}><button type="button" className="secondaryButton" disabled={!selectedImage || imageBusy} onClick={downloadImage}>{imageBusy ? "Winactiebeeld maken…" : "Winactiebeeld downloaden"}</button><button type="button" className="secondaryButton" disabled={!selectedImage || imageBusy} onClick={openFacebookToPublish}>{imageBusy ? "Facebook voorbereiden…" : "Facebook openen om te plaatsen ↗"}</button>{giveawayPublished ? <span aria-label="Winactie is geplaatst" style={{ display: "inline-flex", alignItems: "center", padding: "10px 14px", borderRadius: 7, background: "#22864d", color: "#fff", fontWeight: 700 }}>✓ Geplaatst op Facebook</span> : <button type="button" className="primaryButton" disabled={!selectedImage || imageBusy || !workspaceId || !session?.access_token} onClick={publishDirectly}>{imageBusy ? "Op Facebook plaatsen…" : "Direct op Facebook plaatsen"}</button>}</div>
    </section>
    <label className="marketingGiveawayText" style={{ display: "grid", gap: 5 }}>Klaarstaande winactietekst<textarea rows={16} value={draft.text} onChange={(event) => { setDraft((current) => ({ ...current, text: event.target.value })); setMessage(""); }} /></label>
    <div className="marketingGiveawayActions" style={{ display: "flex", gap: 8, flexWrap: "wrap" }}><button type="button" className="primaryButton" onClick={copy}>Tekst kopiëren</button><button type="button" className="secondaryButton" onClick={reset}>Opnieuw invullen vanuit evenement</button></div>
    <small>De standaardtekst vraagt om volgen, liken en reageren. Controleer vóór plaatsen altijd je eigen spelregels en voorwaarden.</small>
    {message && <p role="status">{message}</p>}
  </section>;
}
