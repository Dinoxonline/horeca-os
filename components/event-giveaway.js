"use client";

import { useEffect, useMemo, useState } from "react";

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
  const draft = {
    title: common.title || item?.body || "",
    start,
    location: common.location || businessName || "",
    ticketUrl: common.website_url || common.ticket_url || "",
    businessName: businessName || "",
    cards: 2,
    deadline: addDays(start, -6),
    announcement: addDays(start, -3),
    responseHours: 12,
  };
  return { ...draft, text: buildGiveawayText(draft) };
}

export default function EventGiveaway({ item, distribution, businessName }) {
  const storageKey = giveawayDraftStorageKey(item?.id);
  const defaults = useMemo(() => defaultGiveawayDraft({ item, distribution, businessName }), [item, distribution, businessName]);
  const [draft, setDraft] = useState(defaults);
  const [ready, setReady] = useState(false);
  const [message, setMessage] = useState("");

  useEffect(() => {
    try {
      const stored = window.localStorage.getItem(storageKey);
      setDraft(stored ? { ...defaults, ...JSON.parse(stored) } : defaults);
    } catch { setDraft(defaults); }
    setReady(true);
  }, [storageKey, defaults]);

  useEffect(() => {
    if (!ready) return;
    try { window.localStorage.setItem(storageKey, JSON.stringify(draft)); } catch { /* The concept remains usable when browser storage is unavailable. */ }
  }, [draft, ready, storageKey]);

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

  return <section className="marketingGiveaway" aria-label="Winactie voorbereiden" style={{ display: "grid", gap: 14, padding: "14px 0" }}>
    <div><h4>Winactie voorbereiden</h4><p>Horeca OS heeft de evenementgegevens ingevuld. Kies hieronder je variabelen; er wordt niets automatisch geplaatst.</p></div>
    <div className="marketingGiveawayFields" style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 12 }}>
      <label style={{ display: "grid", gap: 5 }}>Aantal kaarten<input type="number" min="1" max="50" value={draft.cards} onChange={(event) => update("cards", event.target.value)} /></label>
      <label style={{ display: "grid", gap: 5 }}>Meedoen t/m<input type="date" value={dateInput(draft.deadline)} onChange={(event) => update("deadline", event.target.value)} /></label>
      <label style={{ display: "grid", gap: 5 }}>Winnaar bekendmaken<input type="date" value={dateInput(draft.announcement)} onChange={(event) => update("announcement", event.target.value)} /></label>
      <label style={{ display: "grid", gap: 5 }}>Reactietijd winnaar (uur)<input type="number" min="1" max="168" value={draft.responseHours} onChange={(event) => update("responseHours", event.target.value)} /></label>
    </div>
    <label className="marketingGiveawayText" style={{ display: "grid", gap: 5 }}>Klaarstaande winactietekst<textarea rows={16} value={draft.text} onChange={(event) => { setDraft((current) => ({ ...current, text: event.target.value })); setMessage(""); }} /></label>
    <div className="marketingGiveawayActions" style={{ display: "flex", gap: 8, flexWrap: "wrap" }}><button type="button" className="primaryButton" onClick={copy}>Tekst kopiëren</button><button type="button" className="secondaryButton" onClick={reset}>Opnieuw invullen vanuit evenement</button></div>
    <small>De standaardtekst vraagt om volgen, liken en reageren. Controleer vóór plaatsen altijd je eigen spelregels en voorwaarden.</small>
    {message && <p role="status">{message}</p>}
  </section>;
}
