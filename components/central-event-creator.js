"use client";

import { useMemo, useState } from "react";
import { supabase } from "../lib/supabase";

const channelDefaults = {
  brevo: true, facebook: true, instagram: true, tiktok: false,
  whatsapp: false, google: true, predis: true,
};

const emptyForm = {
  title: "", shortDescription: "", description: "", start: "", end: "",
  location: "Caribbean Corner, Dorpsstraat 114A, Zoetermeer", imageUrl: "", videoUrl: "",
  organizer: "Caribbean Corner", contactEmail: "info@caribbeancorner.nl", language: "nl",
  ctaLabel: "Meer informatie", ctaUrl: "", ticketType: "free", ticketPrice: "0", capacity: "",
  status: "draft", calendarMailbox: "info@leclubbbq.nl", addToCalendar: true, preparePromotion: true,
  channels: channelDefaults,
  brevoSubject: "", brevoPreview: "", brevoAudience: "",
  facebookText: "", instagramFormat: "post", instagramCaption: "",
  tiktokCaption: "", tiktokPrivacy: "PUBLIC_TO_EVERYONE", tiktokComments: true,
  whatsappTemplate: "", whatsappMessage: "",
  googleTopic: "EVENT", predisType: "afbeelding", predisTone: "Gastvrij en energiek",
};

const channelLabels = {
  brevo: "Nieuwsbrief via Brevo", facebook: "Facebook", instagram: "Instagram",
  tiktok: "TikTok", whatsapp: "WhatsApp Business", google: "Google Bedrijfsprofiel", predis: "Predis",
};

function siteForBusiness(business) {
  return String(business?.name || "").toLowerCase().includes("plein") ? "grandcafehetplein.com" : "caribbeancorner.nl";
}

export default function CentralEventCreator({ workspaceId, businessId, businesses, session }) {
  const [form, setForm] = useState(emptyForm);
  const [preview, setPreview] = useState(false);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState(null);
  const selectedBusiness = useMemo(() => businesses.find((item) => item.id === businessId) || businesses[0], [businessId, businesses]);
  const site = siteForBusiness(selectedBusiness);
  const update = (key, value) => { setForm((current) => ({ ...current, [key]: value })); setPreview(false); setResult(null); };
  const toggleChannel = (channel) => update("channels", { ...form.channels, [channel]: !form.channels[channel] });
  const enabledChannels = Object.keys(form.channels).filter((channel) => form.channels[channel]);

  const validate = () => {
    if (!form.title.trim()) return "Vul een evenementnaam in.";
    if (!form.start || !form.end) return "Vul een begin- en eindmoment in.";
    if (new Date(form.end) <= new Date(form.start)) return "Het eindmoment moet na het beginmoment liggen.";
    if (form.ticketType === "paid" && Number(form.ticketPrice) <= 0) return "Vul een geldige ticketprijs in.";
    if (form.preparePromotion && form.channels.brevo && !form.brevoSubject.trim()) return "Vul voor Brevo een onderwerpregel in.";
    if (form.preparePromotion && form.channels.brevo && !form.brevoAudience.trim()) return "Kies of noteer voor Brevo minimaal Ã©Ã©n doelgroep.";
    if (form.preparePromotion && form.channels.tiktok && !form.videoUrl.trim()) return "TikTok heeft een videolink nodig.";
    if (form.preparePromotion && form.channels.whatsapp && !form.whatsappTemplate.trim()) return "WhatsApp heeft voor geplande verzending een goedgekeurde templatenaam nodig.";
    if (form.preparePromotion && form.channels.google && (!form.ctaUrl.trim() || !form.shortDescription.trim())) return "Google heeft een korte tekst en knoplink nodig.";
    return "";
  };

  const showPreview = () => { const error = validate(); if (error) return setResult({ ok: false, message: error }); setResult(null); setPreview(true); };

  async function createPromotionDraft(websiteEvent) {
    if (!form.preparePromotion) return { skipped: true };
    const { data: integration } = await supabase.from("integration_accounts").select("id").eq("workspace_id", workspaceId).eq("provider", "marketing").limit(1).maybeSingle();
    if (!integration?.id) return { warning: "Promotieconcept kon niet worden opgeslagen: marketingkoppeling ontbreekt." };
    const common = {
      title: form.title.trim(), short_description: form.shortDescription.trim(), description: form.description.trim(),
      start: form.start, end: form.end, location: form.location.trim(), image_url: form.imageUrl.trim(), video_url: form.videoUrl.trim(),
      organizer: form.organizer.trim(), contact_email: form.contactEmail.trim(), language: form.language,
      cta: { label: form.ctaLabel, url: form.ctaUrl.trim() || websiteEvent.url },
      tickets: { type: form.ticketType, price: form.ticketPrice, capacity: form.capacity }, website_url: websiteEvent.url,
    };
    const channel_payloads = {
      brevo: { subject: form.brevoSubject.trim(), preview_text: form.brevoPreview.trim(), audience: form.brevoAudience.trim() },
      facebook: { text: form.facebookText.trim() || form.shortDescription.trim(), cta: common.cta },
      instagram: { format: form.instagramFormat, caption: form.instagramCaption.trim() || form.shortDescription.trim() },
      tiktok: { caption: form.tiktokCaption.trim() || form.shortDescription.trim(), privacy: form.tiktokPrivacy, comments_enabled: form.tiktokComments },
      whatsapp: { template_name: form.whatsappTemplate.trim(), message: form.whatsappMessage.trim() || form.shortDescription.trim() },
      google: { topic_type: form.googleTopic, summary: form.shortDescription.trim(), event: { title: form.title.trim(), start: form.start, end: form.end }, call_to_action: common.cta },
      predis: { content_type: form.predisType, tone: form.predisTone.trim(), prompt: form.description.trim() },
    };
    const { error } = await supabase.from("social_content_items").insert({
      workspace_id: workspaceId, account_id: integration.id, business_id: selectedBusiness?.id || businessId || null,
      provider: "horeca_os", external_id: `eventin-${websiteEvent.id}`, item_type: "campaign", title: form.title.trim(),
      body: form.description.trim(), source_url: websiteEvent.url, status: "draft", published_at: null,
      raw_payload: { source_type: "website_event", eventin_event_id: websiteEvent.id, common, channels: enabledChannels, channel_payloads },
    });
    return error ? { warning: "Het evenement staat op de website, maar het promotieconcept kon niet worden opgeslagen." } : { ok: true };
  }

  async function createEvent() {
    const error = validate(); if (error) return setResult({ ok: false, message: error });
    setBusy(true); setResult(null); const steps = [];
    try {
      const response = await fetch("/api/marketing/website-events/create", { method: "POST", headers: { Authorization: `Bearer ${session.access_token}`, "Content-Type": "application/json" }, body: JSON.stringify({ workspaceId, site, ...form, businessId: selectedBusiness?.id || businessId || null }) });
      const website = await response.json(); if (!response.ok) throw new Error(website.error || "Het website-evenement kon niet worden aangemaakt.");
      steps.push({ label: "Website en Eventin", ok: true, detail: website.event.url });
      if (form.addToCalendar) {
        const calendarResponse = await fetch("/api/integrations/microsoft/calendar/action", { method: "POST", headers: { Authorization: `Bearer ${session.access_token}`, "Content-Type": "application/json" }, body: JSON.stringify({ workspaceId, mailbox: form.calendarMailbox.trim(), subject: form.title.trim(), description: `${form.description.trim()}\n\nWebsite: ${website.event.url}`, start: form.start, end: form.end, location: form.location.trim(), attendees: [], recurrence: "none", reminderMinutes: 60, showAs: "busy" }) });
        const calendar = await calendarResponse.json(); steps.push(calendarResponse.ok ? { label: `Agenda ${form.calendarMailbox}`, ok: true } : { label: `Agenda ${form.calendarMailbox}`, ok: false, detail: calendar.error || "Niet toegevoegd." });
      }
      const promotion = await createPromotionDraft(website.event);
      if (form.preparePromotion) steps.push(promotion.ok ? { label: `Marketingconcept (${enabledChannels.length} kanalen)`, ok: true } : { label: "Marketingconcept", ok: false, detail: promotion.warning });
      setResult({ ok: true, message: "Het evenement is verwerkt.", steps, url: website.event.url }); setPreview(false);
    } catch (requestError) { setResult({ ok: false, message: requestError.message }); } finally { setBusy(false); }
  }

  return <section className="panel" style={{ marginBottom: 24 }}>
    <div className="panelHead"><div><p className="eyebrow">EVENEMENTENBEHEER</p><h2>Nieuw evenement aanmaken</h2><p>Vul de basis Ã©Ã©n keer in. Horeca OS vraagt daarna alleen wat een gekozen kanaal extra nodig heeft.</p></div></div>
    <div className="eventCreatorGrid">
      <label>Vestiging<select value={selectedBusiness?.id || ""} disabled><option>{selectedBusiness?.name || "Kies eerst een vestiging bovenaan"}</option></select></label>
      <label>Evenementnaam *<input value={form.title} onChange={(e) => update("title", e.target.value)} /></label>
      <label>Begint *<input type="datetime-local" value={form.start} onChange={(e) => update("start", e.target.value)} /></label>
      <label>Eindigt *<input type="datetime-local" value={form.end} onChange={(e) => update("end", e.target.value)} /></label>
      <label className="wide">Locatie<input value={form.location} onChange={(e) => update("location", e.target.value)} /></label>
      <label className="wide">Korte promotietekst<textarea rows={3} value={form.shortDescription} onChange={(e) => update("shortDescription", e.target.value)} placeholder="De kernboodschap voor Google, WhatsApp en sociale media." /></label>
      <label className="wide">Volledige omschrijving<textarea rows={6} value={form.description} onChange={(e) => update("description", e.target.value)} /></label>
      <label>Afbeeldingslink<input type="url" value={form.imageUrl} onChange={(e) => update("imageUrl", e.target.value)} placeholder="https://...jpg" /></label>
      <label>Videolink<input type="url" value={form.videoUrl} onChange={(e) => update("videoUrl", e.target.value)} placeholder="Verplicht wanneer TikTok is gekozen" /></label>
      <label>Organisator<input value={form.organizer} onChange={(e) => update("organizer", e.target.value)} /></label>
      <label>Contact-e-mail<input type="email" value={form.contactEmail} onChange={(e) => update("contactEmail", e.target.value)} /></label>
      <label>Knoptekst<input value={form.ctaLabel} onChange={(e) => update("ctaLabel", e.target.value)} /></label>
      <label>Knoplink<input type="url" value={form.ctaUrl} onChange={(e) => update("ctaUrl", e.target.value)} placeholder="Leeg = de nieuwe evenementpagina" /></label>
      <label>Tickets<select value={form.ticketType} onChange={(e) => update("ticketType", e.target.value)}><option value="free">Gratis</option><option value="paid">Betaald</option><option value="none">Geen tickets</option></select></label>
      <label>Prijs per ticket<input type="number" min="0" step="0.01" disabled={form.ticketType !== "paid"} value={form.ticketPrice} onChange={(e) => update("ticketPrice", e.target.value)} /></label>
      <label>Capaciteit<input type="number" min="1" value={form.capacity} onChange={(e) => update("capacity", e.target.value)} /></label>
      <label>Website-status<select value={form.status} onChange={(e) => update("status", e.target.value)}><option value="draft">Eerst als concept</option><option value="publish">Direct publiceren</option></select></label>
    </div>

    <fieldset className="eventDestinations"><legend>Bestemmingen</legend>
      <label className="check"><input type="checkbox" checked={form.addToCalendar} onChange={(e) => update("addToCalendar", e.target.checked)} /> Microsoft-agenda</label>
      {form.addToCalendar && <label>Agenda-e-mailadres<input type="email" value={form.calendarMailbox} onChange={(e) => update("calendarMailbox", e.target.value)} /></label>}
      <label className="check"><input type="checkbox" checked={form.preparePromotion} onChange={(e) => update("preparePromotion", e.target.checked)} /> Promotieconcept voor andere kanalen</label>
      {form.preparePromotion && <div className="channelChecks">{Object.entries(channelLabels).map(([key, label]) => <label className="check" key={key}><input type="checkbox" checked={form.channels[key]} onChange={() => toggleChannel(key)} /> {label}</label>)}</div>}
    </fieldset>

    {form.preparePromotion && <div className="channelDetails">
      {form.channels.brevo && <fieldset><legend>Brevo â€” verplicht voor nieuwsbrief</legend><label>Onderwerp *<input value={form.brevoSubject} onChange={(e) => update("brevoSubject", e.target.value)} /></label><label>Voorbeeldtekst<input value={form.brevoPreview} onChange={(e) => update("brevoPreview", e.target.value)} /></label><label>Doelgroep(en) *<input value={form.brevoAudience} onChange={(e) => update("brevoAudience", e.target.value)} placeholder="Selecteer later Brevo-lijsten of segmenten" /></label></fieldset>}
      {form.channels.facebook && <fieldset><legend>Facebook</legend><label>Berichttekst<textarea rows={3} value={form.facebookText} onChange={(e) => update("facebookText", e.target.value)} placeholder="Leeg = korte promotietekst" /></label></fieldset>}
      {form.channels.instagram && <fieldset><legend>Instagram</legend><label>Vorm<select value={form.instagramFormat} onChange={(e) => update("instagramFormat", e.target.value)}><option value="post">Post</option><option value="reel">Reel</option><option value="story">Story</option><option value="carousel">Carrousel</option></select></label><label>Bijschrift<textarea rows={3} value={form.instagramCaption} onChange={(e) => update("instagramCaption", e.target.value)} /></label></fieldset>}
      {form.channels.tiktok && <fieldset><legend>TikTok â€” video verplicht</legend><label>Bijschrift<textarea rows={3} value={form.tiktokCaption} onChange={(e) => update("tiktokCaption", e.target.value)} /></label><label>Zichtbaarheid<select value={form.tiktokPrivacy} onChange={(e) => update("tiktokPrivacy", e.target.value)}><option value="PUBLIC_TO_EVERYONE">Openbaar</option><option value="MUTUAL_FOLLOW_FRIENDS">Vrienden</option><option value="SELF_ONLY">Alleen ik</option></select></label><label className="check"><input type="checkbox" checked={form.tiktokComments} onChange={(e) => update("tiktokComments", e.target.checked)} /> Reacties toestaan</label></fieldset>}
      {form.channels.whatsapp && <fieldset><legend>WhatsApp Business â€” template verplicht bij geplande campagne</legend><label>Goedgekeurde templatenaam *<input value={form.whatsappTemplate} onChange={(e) => update("whatsappTemplate", e.target.value)} /></label><label>Bericht<textarea rows={3} value={form.whatsappMessage} onChange={(e) => update("whatsappMessage", e.target.value)} /></label></fieldset>}
      {form.channels.google && <fieldset><legend>Google Bedrijfsprofiel</legend><label>Soort bericht<select value={form.googleTopic} onChange={(e) => update("googleTopic", e.target.value)}><option value="EVENT">Evenement</option><option value="STANDARD">Update</option><option value="OFFER">Aanbieding</option></select></label><p>Gebruikt titel, datum/tijd, korte tekst, afbeelding en knoplink uit de basis.</p></fieldset>}
      {form.channels.predis && <fieldset><legend>Predis</legend><label>Soort concept<select value={form.predisType} onChange={(e) => update("predisType", e.target.value)}><option value="afbeelding">Afbeelding</option><option value="video">Video</option><option value="carousel">Carrousel</option></select></label><label>Toon<input value={form.predisTone} onChange={(e) => update("predisTone", e.target.value)} /></label></fieldset>}
    </div>}

    {preview && <div className="eventPreview"><strong>Controle vÃ³Ã³r aanmaken</strong><p><b>{form.title}</b></p><p>{new Date(form.start).toLocaleString("nl-NL")} â€“ {new Date(form.end).toLocaleString("nl-NL")}</p><p>{form.location}</p><ul><li>Website: {site} ({form.status === "publish" ? "direct openbaar" : "concept"})</li>{form.addToCalendar && <li>Agenda: {form.calendarMailbox}</li>}{form.preparePromotion && <li>Promotie: {enabledChannels.map((key) => channelLabels[key]).join(", ")}</li>}</ul></div>}
    {result && <div className={result.ok ? "eventResult success" : "eventResult error"}><strong>{result.message}</strong>{result.steps?.map((step) => <p key={step.label}>{step.ok ? "âœ“" : "!"} {step.label}{step.detail ? `: ${step.detail}` : ""}</p>)}{result.url && <a href={result.url} target="_blank" rel="noreferrer">Evenement op de website openen</a>}</div>}
    <div className="eventActions"><button type="button" className="secondaryButton" onClick={showPreview} disabled={busy}>Voorbeeld controleren</button>{preview && <button type="button" onClick={createEvent} disabled={busy}>{busy ? "Bezig met aanmakenâ€¦" : form.status === "publish" ? "Evenement publiceren" : "Evenement als concept aanmaken"}</button>}</div>
    <style jsx>{`
      .eventCreatorGrid,.channelDetails{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:14px}.channelDetails fieldset{margin:0;padding:14px;border:1px solid #c6d5df;border-radius:12px;display:grid;gap:10px}.channelDetails legend,.eventDestinations legend{font-weight:800}.channelDetails p{margin:0;color:#5c7285}.channelChecks{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:9px}.check{flex-direction:row;align-items:center}.wide{grid-column:1/-1}label{display:flex;flex-direction:column;gap:6px;font-weight:700;color:#173552}input,select,textarea{width:100%;box-sizing:border-box;border:1px solid #c6d5df;border-radius:9px;padding:11px 12px;background:#fff;color:#173552;font:inherit}textarea{resize:vertical}.check input,.eventDestinations input[type=checkbox]{width:auto}.eventDestinations{margin:18px 0;padding:16px;border:1px solid #c6d5df;border-radius:12px;display:grid;gap:12px}.eventPreview,.eventResult{padding:16px;margin:14px 0;border-radius:12px;background:#eef7f9}.eventResult.success{border-left:5px solid #2ba66d}.eventResult.error{background:#fff2d1;border-left:5px solid #e4a91b}.eventActions{display:flex;gap:12px;justify-content:flex-end;margin-top:18px}.eventActions button{border:0;border-radius:9px;padding:12px 18px;background:#25889b;color:#fff;font-weight:800;cursor:pointer}.eventActions .secondaryButton{background:#fff;color:#176d7f;border:1px solid #25889b}button:disabled{opacity:.55;cursor:not-allowed}@media(max-width:760px){.eventCreatorGrid,.channelDetails,.channelChecks{grid-template-columns:1fr}.wide{grid-column:auto}.eventActions{flex-direction:column}}
    `}</style>
  </section>;
}

