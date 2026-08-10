"use client";

import { useMemo, useState } from "react";
import { supabase } from "../lib/supabase";

const emptyForm = {
  title: "",
  description: "",
  start: "",
  end: "",
  location: "Caribbean Corner, Dorpsstraat 114A, Zoetermeer",
  imageUrl: "",
  ticketType: "free",
  ticketPrice: "0",
  capacity: "",
  status: "draft",
  calendarMailbox: "info@leclubbbq.nl",
  addToCalendar: true,
  preparePromotion: true,
};

function siteForBusiness(business) {
  const value = String(business?.name || "").toLowerCase();
  return value.includes("plein") ? "grandcafehetplein.com" : "caribbeancorner.nl";
}

export default function CentralEventCreator({ workspaceId, businessId, businesses, session }) {
  const [form, setForm] = useState(emptyForm);
  const [preview, setPreview] = useState(false);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState(null);
  const selectedBusiness = useMemo(
    () => businesses.find((item) => item.id === businessId) || businesses[0],
    [businessId, businesses],
  );
  const site = siteForBusiness(selectedBusiness);
  const update = (key, value) => {
    setForm((current) => ({ ...current, [key]: value }));
    setPreview(false);
    setResult(null);
  };

  const validate = () => {
    if (!form.title.trim()) return "Vul een evenementnaam in.";
    if (!form.start || !form.end) return "Vul een begin- en eindmoment in.";
    if (new Date(form.end) <= new Date(form.start)) return "Het eindmoment moet na het beginmoment liggen.";
    if (form.ticketType === "paid" && Number(form.ticketPrice) <= 0) return "Vul een geldige ticketprijs in.";
    return "";
  };

  const showPreview = () => {
    const error = validate();
    if (error) return setResult({ ok: false, message: error });
    setResult(null);
    setPreview(true);
  };

  async function createPromotionDraft(websiteEvent) {
    if (!form.preparePromotion) return { skipped: true };
    const { data: integration } = await supabase
      .from("integration_accounts")
      .select("id")
      .eq("workspace_id", workspaceId)
      .eq("provider", "marketing")
      .limit(1)
      .maybeSingle();
    if (!integration?.id) return { warning: "Promotieconcept kon niet worden opgeslagen: marketingkoppeling ontbreekt." };
    const { error } = await supabase.from("social_content_items").insert({
      workspace_id: workspaceId,
      account_id: integration.id,
      business_id: selectedBusiness?.id || businessId || null,
      provider: "horeca_os",
      external_id: `eventin-${websiteEvent.id}`,
      item_type: "campaign",
      title: form.title.trim(),
      body: form.description.trim(),
      source_url: websiteEvent.url,
      status: "draft",
      published_at: null,
      raw_payload: {
        source_type: "website_event",
        eventin_event_id: websiteEvent.id,
        start: form.start,
        end: form.end,
        image_url: form.imageUrl.trim(),
      },
    });
    return error ? { warning: "Het evenement staat op de website, maar het promotieconcept kon niet worden opgeslagen." } : { ok: true };
  }

  async function createEvent() {
    const error = validate();
    if (error) return setResult({ ok: false, message: error });
    setBusy(true);
    setResult(null);
    const steps = [];
    try {
      const response = await fetch("/api/marketing/website-events/create", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${session.access_token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          workspaceId,
          site,
          ...form,
          businessId: selectedBusiness?.id || businessId || null,
        }),
      });
      const website = await response.json();
      if (!response.ok) throw new Error(website.error || "Het website-evenement kon niet worden aangemaakt.");
      steps.push({ label: "Website en Eventin", ok: true, detail: website.event.url });

      if (form.addToCalendar) {
        const calendarResponse = await fetch("/api/integrations/microsoft/calendar/action", {
          method: "POST",
          headers: {
            Authorization: `Bearer ${session.access_token}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            workspaceId,
            mailbox: form.calendarMailbox.trim(),
            subject: form.title.trim(),
            description: `${form.description.trim()}\n\nWebsite: ${website.event.url}`,
            start: form.start,
            end: form.end,
            location: form.location.trim(),
            attendees: [],
            recurrence: "none",
            reminderMinutes: 60,
            showAs: "busy",
          }),
        });
        const calendar = await calendarResponse.json();
        steps.push(calendarResponse.ok
          ? { label: `Agenda ${form.calendarMailbox}`, ok: true }
          : { label: `Agenda ${form.calendarMailbox}`, ok: false, detail: calendar.error || "Niet toegevoegd." });
      }

      const promotion = await createPromotionDraft(website.event);
      if (form.preparePromotion) steps.push(promotion.ok
        ? { label: "Marketingconcept", ok: true }
        : { label: "Marketingconcept", ok: false, detail: promotion.warning });
      setResult({ ok: true, message: "Het evenement is verwerkt.", steps, url: website.event.url });
      setPreview(false);
    } catch (requestError) {
      setResult({ ok: false, message: requestError.message });
    } finally {
      setBusy(false);
    }
  }

  return <section className="panel" style={{ marginBottom: 24 }}>
    <div className="panelHead">
      <div>
        <p className="eyebrow">EVENEMENTENBEHEER</p>
        <h2>Nieuw evenement aanmaken</h2>
        <p>Maak het evenement één keer aan en zet het daarna door naar Eventin, de website, de agenda en Marketing.</p>
      </div>
    </div>

    <div className="eventCreatorGrid">
      <label>Vestiging
        <select value={selectedBusiness?.id || ""} disabled>
          <option>{selectedBusiness?.name || "Kies eerst een vestiging bovenaan"}</option>
        </select>
      </label>
      <label>Evenementnaam *
        <input value={form.title} onChange={(event) => update("title", event.target.value)} placeholder="Bijvoorbeeld Caribbean Social Club" />
      </label>
      <label>Begint *
        <input type="datetime-local" value={form.start} onChange={(event) => update("start", event.target.value)} />
      </label>
      <label>Eindigt *
        <input type="datetime-local" value={form.end} onChange={(event) => update("end", event.target.value)} />
      </label>
      <label className="wide">Locatie
        <input value={form.location} onChange={(event) => update("location", event.target.value)} />
      </label>
      <label className="wide">Omschrijving
        <textarea rows={6} value={form.description} onChange={(event) => update("description", event.target.value)} placeholder="Programma, artiesten, praktische informatie en sfeeromschrijving." />
      </label>
      <label className="wide">Afbeeldingslink
        <input type="url" value={form.imageUrl} onChange={(event) => update("imageUrl", event.target.value)} placeholder="https://.../evenement-afbeelding.jpg" />
      </label>
      <label>Tickets
        <select value={form.ticketType} onChange={(event) => update("ticketType", event.target.value)}>
          <option value="free">Gratis</option><option value="paid">Betaald</option><option value="none">Geen tickets</option>
        </select>
      </label>
      <label>Prijs per ticket
        <input type="number" min="0" step="0.01" disabled={form.ticketType !== "paid"} value={form.ticketPrice} onChange={(event) => update("ticketPrice", event.target.value)} />
      </label>
      <label>Capaciteit
        <input type="number" min="1" value={form.capacity} onChange={(event) => update("capacity", event.target.value)} placeholder="Optioneel" />
      </label>
      <label>Website-status
        <select value={form.status} onChange={(event) => update("status", event.target.value)}>
          <option value="draft">Eerst als concept</option><option value="publish">Direct publiceren</option>
        </select>
      </label>
    </div>

    <fieldset className="eventDestinations">
      <legend>Ook uitvoeren</legend>
      <label><input type="checkbox" checked={form.addToCalendar} onChange={(event) => update("addToCalendar", event.target.checked)} /> Toevoegen aan Microsoft-agenda</label>
      {form.addToCalendar && <label>Agenda-e-mailadres <input type="email" value={form.calendarMailbox} onChange={(event) => update("calendarMailbox", event.target.value)} /></label>}
      <label><input type="checkbox" checked={form.preparePromotion} onChange={(event) => update("preparePromotion", event.target.checked)} /> Marketingconcept klaarzetten voor Brevo en sociale kanalen</label>
    </fieldset>

    {preview && <div className="eventPreview">
      <strong>Controle vóór aanmaken</strong>
      <p><b>{form.title}</b></p>
      <p>{new Date(form.start).toLocaleString("nl-NL")} – {new Date(form.end).toLocaleString("nl-NL")}</p>
      <p>{form.location}</p>
      <ul>
        <li>Website: {site} ({form.status === "publish" ? "direct openbaar" : "concept"})</li>
        {form.addToCalendar && <li>Agenda: {form.calendarMailbox}</li>}
        {form.preparePromotion && <li>Marketing: promotieconcept klaarzetten</li>}
      </ul>
    </div>}

    {result && <div className={result.ok ? "eventResult success" : "eventResult error"}>
      <strong>{result.message}</strong>
      {result.steps?.map((step) => <p key={step.label}>{step.ok ? "✓" : "!"} {step.label}{step.detail ? `: ${step.detail}` : ""}</p>)}
      {result.url && <a href={result.url} target="_blank" rel="noreferrer">Evenement op de website openen</a>}
    </div>}

    <div className="eventActions">
      <button type="button" className="secondaryButton" onClick={showPreview} disabled={busy}>Voorbeeld controleren</button>
      {preview && <button type="button" onClick={createEvent} disabled={busy}>{busy ? "Bezig met aanmaken…" : form.status === "publish" ? "Evenement publiceren" : "Evenement als concept aanmaken"}</button>}
    </div>

    <style jsx>{`
      .eventCreatorGrid { display:grid; grid-template-columns:repeat(2,minmax(0,1fr)); gap:14px; }
      label { display:flex; flex-direction:column; gap:6px; font-weight:700; color:#173552; }
      .wide { grid-column:1/-1; }
      input, select, textarea { width:100%; box-sizing:border-box; border:1px solid #c6d5df; border-radius:9px; padding:11px 12px; background:#fff; color:#173552; font:inherit; }
      textarea { resize:vertical; }
      .eventDestinations { margin:18px 0; padding:16px; border:1px solid #c6d5df; border-radius:12px; display:grid; gap:12px; }
      .eventDestinations label:first-of-type, .eventDestinations label:last-of-type { flex-direction:row; align-items:center; }
      .eventDestinations input[type=checkbox] { width:auto; }
      .eventPreview, .eventResult { padding:16px; margin:14px 0; border-radius:12px; background:#eef7f9; }
      .eventResult.success { border-left:5px solid #2ba66d; }
      .eventResult.error { background:#fff2d1; border-left:5px solid #e4a91b; }
      .eventActions { display:flex; gap:12px; justify-content:flex-end; }
      .eventActions button { border:0; border-radius:9px; padding:12px 18px; background:#25889b; color:#fff; font-weight:800; cursor:pointer; }
      .eventActions .secondaryButton { background:#fff; color:#176d7f; border:1px solid #25889b; }
      button:disabled { opacity:.55; cursor:not-allowed; }
      @media (max-width:760px) { .eventCreatorGrid { grid-template-columns:1fr; } .wide { grid-column:auto; } .eventActions { flex-direction:column; } }
    `}</style>
  </section>;
}
