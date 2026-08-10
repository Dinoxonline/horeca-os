"use client";

import { useEffect, useMemo, useState } from "react";
import { supabase } from "../lib/supabase";

const channelDefaults = {
  brevo: true, facebook: true, instagram: true, tiktok: false,
  whatsapp: false, google: true, predis: true,
};

const imageSlots = [
  { key: "landscape", label: "Liggend", width: 1200, height: 630, ratio: "1,91:1", channels: "Facebook, Google Bedrijfsprofiel en Brevo" },
  { key: "square", label: "Vierkant", width: 1080, height: 1080, ratio: "1:1", channels: "Instagram, Facebook en Predis" },
  { key: "portrait", label: "Staand bericht", width: 1080, height: 1350, ratio: "4:5", channels: "Instagram-feed" },
  { key: "vertical", label: "Story, Reel en TikTok", width: 1080, height: 1920, ratio: "9:16", channels: "Stories, Reels, TikTok en WhatsApp Status" },
];

const emptyImages = Object.fromEntries(imageSlots.map(({ key }) => [key, null]));

const campaignTypes = [
  ["event", "Evenement", "Met Eventin, datum, tickets en agenda"],
  ["product", "Gerecht of product", "Gerecht, drankje of ander product"],
  ["offer", "Aanbieding", "Actieprijs en geldigheidsperiode"],
  ["package", "Arrangement", "Groepen, feesten, verhuur of menu"],
  ["review", "Review delen", "Maak van een gastbeoordeling content"],
  ["custom", "Eigen campagne", "Vrij nieuwsbericht of merkverhaal"],
];

const emptyForm = {
  campaignType: "event",
  title: "", shortDescription: "", description: "", start: "", end: "",
  location: "Caribbean Corner, Dorpsstraat 114A, Zoetermeer", imageUrl: "", images: emptyImages, videoUrl: "",
  organizer: "Caribbean Corner", contactEmail: "info@caribbeancorner.nl", language: "nl",
  ctaLabel: "Meer informatie", ctaUrl: "", ticketType: "free", ticketPrice: "0", capacity: "",
  status: "draft", calendarMailbox: "info@leclubbbq.nl", addToCalendar: true, preparePromotion: true,
  channels: channelDefaults,
  brevoSubject: "", brevoPreview: "", brevoAudience: "",
  facebookText: "", instagramFormat: "post", instagramCaption: "",
  tiktokCaption: "", tiktokPrivacy: "PUBLIC_TO_EVERYONE", tiktokComments: true,
  whatsappTemplate: "", whatsappMessage: "",
  googleTopic: "EVENT", predisType: "afbeelding", predisTone: "Gastvrij en energiek",
  regularPrice: "", campaignPrice: "", discountCode: "", validFrom: "", validUntil: "",
  groupSize: "", pricePerPerson: "", reviewerName: "", reviewScore: "5", reviewSource: "",
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
  const [uploadingSlot, setUploadingSlot] = useState("");
  const [uploadMessage, setUploadMessage] = useState(null);
  const [eventCampaigns, setEventCampaigns] = useState([]);
  const [editingCampaignId, setEditingCampaignId] = useState(null);
  const [conceptBusyId, setConceptBusyId] = useState(null);
  const selectedBusiness = useMemo(() => businesses.find((item) => item.id === businessId) || businesses[0], [businessId, businesses]);
  const site = siteForBusiness(selectedBusiness);
  const update = (key, value) => { setForm((current) => ({ ...current, [key]: value })); setPreview(false); setResult(null); };
  const selectCampaignType = (campaignType) => {
    setForm((current) => ({ ...current, campaignType, googleTopic: campaignType === "event" ? "EVENT" : campaignType === "offer" ? "OFFER" : "STANDARD" }));
    setEditingCampaignId(null); setPreview(false); setResult(null);
  };
  const toggleChannel = (channel) => update("channels", { ...form.channels, [channel]: !form.channels[channel] });
  const enabledChannels = Object.keys(form.channels).filter((channel) => form.channels[channel]);
  const isEvent = form.campaignType === "event";
  const campaignTypeLabel = campaignTypes.find(([id]) => id === form.campaignType)?.[1] || "Campagne";

  async function uploadImage(slot, file) {
    if (!file) return;
    if (!["image/jpeg", "image/png", "image/webp"].includes(file.type)) return setUploadMessage({ ok: false, message: "Gebruik een JPG-, PNG- of WebP-afbeelding." });
    if (file.size > 10 * 1024 * 1024) return setUploadMessage({ ok: false, message: "De afbeelding mag maximaal 10 MB zijn." });
    setUploadingSlot(slot.key); setUploadMessage(null);
    try {
      const dimensions = await new Promise((resolve, reject) => {
        const url = URL.createObjectURL(file); const image = new Image();
        image.onload = () => { resolve({ width: image.naturalWidth, height: image.naturalHeight }); URL.revokeObjectURL(url); };
        image.onerror = () => { reject(new Error("Afbeelding kon niet worden gelezen.")); URL.revokeObjectURL(url); };
        image.src = url;
      });
      const safeName = file.name.toLowerCase().replace(/[^a-z0-9._-]+/g, "-");
      const path = `${workspaceId}/${selectedBusiness?.id || businessId || "algemeen"}/${slot.key}-${Date.now()}-${safeName}`;
      const { error } = await supabase.storage.from("marketing-assets").upload(path, file, { cacheControl: "31536000", contentType: file.type, upsert: false });
      if (error) throw error;
      const { data } = supabase.storage.from("marketing-assets").getPublicUrl(path);
      const matches = dimensions.width === slot.width && dimensions.height === slot.height;
      setForm((current) => ({ ...current, images: { ...current.images, [slot.key]: { url: data.publicUrl, path, name: file.name, ...dimensions, matches } } }));
      setUploadMessage({ ok: true, message: matches ? `${slot.label} is correct geupload.` : `${slot.label} is geupload (${dimensions.width} Ã— ${dimensions.height} px). Aanbevolen is ${slot.width} Ã— ${slot.height} px.` });
      setPreview(false); setResult(null);
    } catch (error) { setUploadMessage({ ok: false, message: error.message || "Uploaden is niet gelukt." }); }
    finally { setUploadingSlot(""); }
  }

  async function removeImage(slotKey) {
    const image = form.images?.[slotKey];
    if (image?.path) await supabase.storage.from("marketing-assets").remove([image.path]);
    setForm((current) => ({ ...current, images: { ...current.images, [slotKey]: null } }));
    setPreview(false); setResult(null);
  }

  async function loadEventCampaigns() {
    if (!workspaceId) return;
    let query = supabase.from("social_content_items").select("id,body,media,status,workflow_status,scheduled_for,published_at,permalink,created_at").eq("workspace_id", workspaceId).order("created_at", { ascending: false }).limit(30);
    if (selectedBusiness?.id || businessId) query = query.eq("business_id", selectedBusiness?.id || businessId);
    const { data } = await query;
    setEventCampaigns((data || []).filter((item) => (item.media || []).some((entry) => entry?.kind === "campaign_distribution")).slice(0, 10));
  }

  function openCampaignConcept(item) {
    const distribution = (item.media || []).find((entry) => entry?.kind === "campaign_distribution");
    if (!distribution) return;
    const common = distribution.common || {};
    const commercial = common.commercial || {};
    const review = common.review || {};
    const payloads = distribution.channel_payloads || {};
    const targetChannels = distribution.target_channels || [];
    const storedType = common.campaign_type || (distribution.source_type === "website_event" ? "event" : distribution.source_type) || "custom";
    const channels = Object.fromEntries(Object.keys(channelDefaults).map((channel) => [channel, targetChannels.includes(channel)]));
    setForm({
      ...emptyForm,
      campaignType: storedType,
      title: common.title || "", shortDescription: common.short_description || "", description: common.description || item.body || "",
      start: common.start || "", end: common.end || "", location: common.location || emptyForm.location,
      imageUrl: common.image_url || "", images: { ...emptyImages, ...(common.images || {}) }, videoUrl: common.video_url || "",
      organizer: common.organizer || emptyForm.organizer, contactEmail: common.contact_email || emptyForm.contactEmail, language: common.language || "nl",
      ctaLabel: common.cta?.label || emptyForm.ctaLabel, ctaUrl: common.cta?.url || distribution.source_url || "",
      ticketType: common.tickets?.type || "free", ticketPrice: common.tickets?.price || "0", capacity: common.tickets?.capacity || "",
      preparePromotion: targetChannels.length > 0, channels,
      brevoSubject: payloads.brevo?.subject || "", brevoPreview: payloads.brevo?.preview_text || "", brevoAudience: payloads.brevo?.audience || "",
      facebookText: payloads.facebook?.text || "", instagramFormat: payloads.instagram?.format || "post", instagramCaption: payloads.instagram?.caption || "",
      tiktokCaption: payloads.tiktok?.caption || "", tiktokPrivacy: payloads.tiktok?.privacy || emptyForm.tiktokPrivacy, tiktokComments: payloads.tiktok?.comments_enabled ?? true,
      whatsappTemplate: payloads.whatsapp?.template_name || "", whatsappMessage: payloads.whatsapp?.message || "",
      googleTopic: payloads.google?.topic_type || (storedType === "event" ? "EVENT" : storedType === "offer" ? "OFFER" : "STANDARD"),
      predisType: payloads.predis?.content_type || "afbeelding", predisTone: payloads.predis?.tone || emptyForm.predisTone,
      regularPrice: commercial.regular_price || "", campaignPrice: commercial.campaign_price || "", discountCode: commercial.discount_code || "",
      validFrom: commercial.valid_from || "", validUntil: commercial.valid_until || "", groupSize: commercial.group_size || "", pricePerPerson: commercial.price_per_person || "",
      reviewerName: review.reviewer_name || "", reviewScore: review.score || "5", reviewSource: review.source || "",
    });
    setEditingCampaignId(storedType === "event" ? null : item.id);
    setPreview(false);
    setResult({ ok: true, message: storedType === "event" ? "Het evenement is als basis geopend. Opslaan maakt veilig een nieuw Eventin-evenement." : "Het campagneconcept is geopend en kan nu worden bijgewerkt." });
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function duplicateCampaignConcept(item) {
    openCampaignConcept(item);
    setEditingCampaignId(null);
    setResult({ ok: true, message: "Het concept is als kopie geopend. Pas eventueel de naam of inhoud aan en sla het op als nieuw concept." });
  }

  async function deleteCampaignConcept(item) {
    const distribution = (item.media || []).find((entry) => entry?.kind === "campaign_distribution") || {};
    const title = distribution.common?.title || "dit concept";
    if (!window.confirm(`Weet je zeker dat je ${title} wilt verwijderen? Alleen het marketingconcept wordt verwijderd; een bestaand website-evenement blijft staan.`)) return;
    setConceptBusyId(item.id);
    setResult(null);
    try {
      const { error } = await supabase.from("social_content_items").delete().eq("id", item.id).eq("workspace_id", workspaceId);
      if (error) throw error;
      if (editingCampaignId === item.id) setEditingCampaignId(null);
      setResult({ ok: true, message: "Het marketingconcept is verwijderd. Een gekoppeld website-evenement is niet gewijzigd." });
      await loadEventCampaigns();
    } catch (error) {
      setResult({ ok: false, message: error.message || "Het concept kon niet worden verwijderd." });
    } finally {
      setConceptBusyId(null);
    }
  }

  useEffect(() => { loadEventCampaigns(); }, [workspaceId, selectedBusiness?.id, businessId]);

  const validate = () => {
    if (!form.title.trim()) return `Vul een naam in voor ${campaignTypeLabel.toLowerCase()}.`;
    if (isEvent && (!form.start || !form.end)) return "Vul een begin- en eindmoment in.";
    if (isEvent && new Date(form.end) <= new Date(form.start)) return "Het eindmoment moet na het beginmoment liggen.";
    if (isEvent && form.ticketType === "paid" && Number(form.ticketPrice) <= 0) return "Vul een geldige ticketprijs in.";
    if (form.campaignType === "offer" && (!form.campaignPrice || !form.validUntil)) return "Vul de actieprijs en einddatum in.";
    if (form.campaignType === "review" && !form.description.trim()) return "Vul de reviewtekst in.";
    if (form.preparePromotion && form.channels.brevo && !form.brevoSubject.trim()) return "Vul voor Brevo een onderwerpregel in.";
    if (form.preparePromotion && form.channels.brevo && !form.brevoAudience.trim()) return "Kies of noteer voor Brevo minimaal Ã©Ã©n doelgroep.";
    if (form.preparePromotion && form.channels.tiktok && !form.videoUrl.trim()) return "TikTok heeft een videolink nodig.";
    if (form.preparePromotion && form.channels.whatsapp && !form.whatsappTemplate.trim()) return "WhatsApp heeft voor geplande verzending een goedgekeurde templatenaam nodig.";
    if (form.preparePromotion && form.channels.google && (!form.ctaUrl.trim() || !form.shortDescription.trim())) return "Google heeft een korte tekst en knoplink nodig.";
    return "";
  };

  const showPreview = () => { const error = validate(); if (error) return setResult({ ok: false, message: error }); setResult(null); setPreview(true); };

  async function createPromotionDraft(websiteEvent) {
    if (!form.preparePromotion && isEvent) return { ok: true, skipped: true };
    const { data: integration } = await supabase.from("integration_accounts").select("id").eq("workspace_id", workspaceId).eq("provider", "marketing").limit(1).maybeSingle();
    if (!integration?.id) return { warning: "Promotieconcept kon niet worden opgeslagen: marketingkoppeling ontbreekt." };
    const imageFor = (key, fallbackKeys = []) => form.images?.[key]?.url || fallbackKeys.map((item) => form.images?.[item]?.url).find(Boolean) || form.imageUrl.trim();
    const common = {
      campaign_type: form.campaignType,
      title: form.title.trim(), short_description: form.shortDescription.trim(), description: form.description.trim(),
      start: form.start, end: form.end, location: form.location.trim(), image_url: imageFor("landscape", ["square", "portrait", "vertical"]), images: form.images, video_url: form.videoUrl.trim(),
      organizer: form.organizer.trim(), contact_email: form.contactEmail.trim(), language: form.language,
      cta: { label: form.ctaLabel, url: form.ctaUrl.trim() || websiteEvent.url },
      tickets: { type: form.ticketType, price: form.ticketPrice, capacity: form.capacity }, website_url: websiteEvent.url,
      commercial: { regular_price: form.regularPrice, campaign_price: form.campaignPrice, discount_code: form.discountCode, valid_from: form.validFrom, valid_until: form.validUntil, group_size: form.groupSize, price_per_person: form.pricePerPerson },
      review: { reviewer_name: form.reviewerName.trim(), score: form.reviewScore, source: form.reviewSource.trim() },
    };
    const channel_payloads = {
      brevo: { subject: form.brevoSubject.trim(), preview_text: form.brevoPreview.trim(), audience: form.brevoAudience.trim(), image_url: imageFor("landscape", ["square"]) },
      facebook: { text: form.facebookText.trim() || form.shortDescription.trim(), cta: common.cta, image_url: imageFor("landscape", ["square"]) },
      instagram: { format: form.instagramFormat, caption: form.instagramCaption.trim() || form.shortDescription.trim(), image_url: form.instagramFormat === "reel" || form.instagramFormat === "story" ? imageFor("vertical", ["portrait", "square"]) : imageFor("portrait", ["square", "vertical"]) },
      tiktok: { caption: form.tiktokCaption.trim() || form.shortDescription.trim(), privacy: form.tiktokPrivacy, comments_enabled: form.tiktokComments, image_url: imageFor("vertical", ["portrait"]) },
      whatsapp: { template_name: form.whatsappTemplate.trim(), message: form.whatsappMessage.trim() || form.shortDescription.trim(), image_url: imageFor("vertical", ["landscape", "square"]) },
      google: { topic_type: form.googleTopic, summary: form.shortDescription.trim(), event: { title: form.title.trim(), start: form.start, end: form.end }, call_to_action: common.cta, image_url: imageFor("landscape", ["square"]) },
      predis: { content_type: form.predisType, tone: form.predisTone.trim(), prompt: form.description.trim(), images: form.images },
    };
    const channel_status = Object.fromEntries(enabledChannels.map((channel) => {
      const payload = channel_payloads[channel] || {};
      const missing = (channel === "brevo" && (!payload.subject || !payload.audience)) ||
        (channel === "tiktok" && !common.video_url) || (channel === "whatsapp" && !payload.template_name) ||
        (channel === "google" && (!payload.summary || !payload.call_to_action?.url));
      return [channel, missing ? "extra_gegevens_nodig" : "klaar_voor_controle"];
    }));
    const distribution = { kind: "campaign_distribution", source_type: isEvent ? "website_event" : form.campaignType, source_url: websiteEvent.url,
      eventin_event_id: websiteEvent.id, common, target_channels: enabledChannels, channel_payloads, channel_status };
    const record = {
      account_id: integration.id, business_id: selectedBusiness?.id || businessId || null,
      content_type: "post", direction: "outbound", body: form.description.trim() || form.shortDescription.trim(),
      media: [distribution], status: "draft", workflow_status: "new", scheduled_for: null, created_by: session.user.id,
    };
    const { error } = editingCampaignId && !isEvent
      ? await supabase.from("social_content_items").update(record).eq("id", editingCampaignId).eq("workspace_id", workspaceId)
      : await supabase.from("social_content_items").insert({ ...record, workspace_id: workspaceId });
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
      setResult({ ok: true, message: "Het evenement is verwerkt.", steps, url: website.event.url }); setPreview(false); await loadEventCampaigns();
    } catch (requestError) { setResult({ ok: false, message: requestError.message }); } finally { setBusy(false); }
  }

  async function createStandaloneCampaign() {
    const error = validate(); if (error) return setResult({ ok: false, message: error });
    setBusy(true); setResult(null);
    try {
      const promotion = await createPromotionDraft({ id: null, url: form.ctaUrl.trim() });
      if (!promotion.ok) throw new Error(promotion.warning || "Het campagneconcept kon niet worden opgeslagen.");
      setResult({ ok: true, message: `${campaignTypeLabel} is als campagneconcept opgeslagen.` });
      setEditingCampaignId(null); setPreview(false); await loadEventCampaigns();
    } catch (requestError) { setResult({ ok: false, message: requestError.message }); }
    finally { setBusy(false); }
  }

  return <section className="panel" style={{ marginBottom: 24 }}>
    <div className="panelHead"><div><p className="eyebrow">CAMPAGNEBOUWER</p><h2>Wat wil je promoten?</h2><p>Kies eerst het soort campagne. Horeca OS toont daarna alleen de gegevens die daarvoor nodig zijn.</p></div></div>
    {editingCampaignId && <div className="editingNotice"><strong>Concept bewerken</strong><span>Je wijzigingen vervangen dit opgeslagen concept wanneer je opnieuw opslaat.</span></div>}
    <div className="campaignTypeGrid">{campaignTypes.map(([id, label, help]) => <button type="button" key={id} className={form.campaignType === id ? "active" : ""} onClick={() => selectCampaignType(id)}><strong>{label}</strong><span>{help}</span></button>)}</div>
    <div className="eventCreatorGrid">
      <label>Vestiging<select value={selectedBusiness?.id || ""} disabled><option>{selectedBusiness?.name || "Kies eerst een vestiging bovenaan"}</option></select></label>
      <label>{campaignTypeLabel}naam *<input value={form.title} onChange={(e) => update("title", e.target.value)} /></label>
      {isEvent && <><label>Begint *<input type="datetime-local" value={form.start} onChange={(e) => update("start", e.target.value)} /></label><label>Eindigt *<input type="datetime-local" value={form.end} onChange={(e) => update("end", e.target.value)} /></label><label className="wide">Locatie<input value={form.location} onChange={(e) => update("location", e.target.value)} /></label></>}
      {(form.campaignType === "product" || form.campaignType === "offer") && <><label>Normale prijs<input type="number" min="0" step="0.01" value={form.regularPrice} onChange={(e) => update("regularPrice", e.target.value)} /></label><label>{form.campaignType === "offer" ? "Actieprijs *" : "Promotieprijs"}<input type="number" min="0" step="0.01" value={form.campaignPrice} onChange={(e) => update("campaignPrice", e.target.value)} /></label></>}
      {form.campaignType === "offer" && <><label>Actiecode<input value={form.discountCode} onChange={(e) => update("discountCode", e.target.value)} /></label><label>Geldig vanaf<input type="date" value={form.validFrom} onChange={(e) => update("validFrom", e.target.value)} /></label><label>Geldig tot *<input type="date" value={form.validUntil} onChange={(e) => update("validUntil", e.target.value)} /></label></>}
      {form.campaignType === "package" && <><label>Aantal personen<input type="number" min="1" value={form.groupSize} onChange={(e) => update("groupSize", e.target.value)} /></label><label>Prijs per persoon<input type="number" min="0" step="0.01" value={form.pricePerPerson} onChange={(e) => update("pricePerPerson", e.target.value)} /></label><label>Beschikbaar vanaf<input type="date" value={form.validFrom} onChange={(e) => update("validFrom", e.target.value)} /></label><label>Beschikbaar tot<input type="date" value={form.validUntil} onChange={(e) => update("validUntil", e.target.value)} /></label></>}
      {form.campaignType === "review" && <><label>Naam gast<input value={form.reviewerName} onChange={(e) => update("reviewerName", e.target.value)} /></label><label>Beoordeling<select value={form.reviewScore} onChange={(e) => update("reviewScore", e.target.value)}>{[5,4,3,2,1].map((score) => <option key={score} value={score}>{score} sterren</option>)}</select></label><label className="wide">Bron of reviewlink<input type="url" value={form.reviewSource} onChange={(e) => update("reviewSource", e.target.value)} /></label></>}
      <label className="wide">Korte promotietekst<textarea rows={3} value={form.shortDescription} onChange={(e) => update("shortDescription", e.target.value)} placeholder="De kernboodschap voor Google, WhatsApp en sociale media." /></label>
      <label className="wide">{form.campaignType === "review" ? "Reviewtekst *" : "Volledige omschrijving"}<textarea rows={6} value={form.description} onChange={(e) => update("description", e.target.value)} /></label>
      <div className="imageUploads wide">
        <div className="imageUploadHead"><strong>Afbeeldingen per kanaal</strong><p>Upload alleen de formaten die je nodig hebt. Horeca OS kiest automatisch het beste beeld voor ieder kanaal.</p></div>
        <div className="imageSlotGrid">{imageSlots.map((slot) => { const uploaded = form.images?.[slot.key]; return <article className={`imageSlot ${uploaded?.matches ? "exact" : ""}`} key={slot.key}>
          <div><strong>{slot.label}</strong><span>{slot.width} Ã— {slot.height} px Â· {slot.ratio}</span><small>{slot.channels}</small></div>
          {uploaded ? <div className="uploadedImage"><div className="imagePreview" style={{ backgroundImage: `url(${uploaded.url})` }} aria-label={`Voorbeeld ${slot.label}`} /><p>{uploaded.width} Ã— {uploaded.height} px {uploaded.matches ? "Â· Perfect formaat" : "Â· Afwijkend formaat"}</p><button type="button" className="removeImage" onClick={() => removeImage(slot.key)}>Verwijderen</button></div> : <label className="uploadButton">{uploadingSlot === slot.key ? "Bezig met uploadenâ€¦" : "Afbeelding uploaden"}<input type="file" accept="image/jpeg,image/png,image/webp" disabled={Boolean(uploadingSlot)} onChange={(e) => uploadImage(slot, e.target.files?.[0])} /></label>}
        </article>; })}</div>
        <p className="imageHelp">JPG, PNG of WebP Â· maximaal 10 MB per afbeelding.</p>
        {uploadMessage && <p className={`uploadMessage ${uploadMessage.ok ? "success" : "error"}`}>{uploadMessage.message}</p>}
      </div>
      <label>Externe afbeeldingslink (optioneel)<input type="url" value={form.imageUrl} onChange={(e) => update("imageUrl", e.target.value)} placeholder="Alleen als alternatief voor upload" /></label>
      <label>Videolink<input type="url" value={form.videoUrl} onChange={(e) => update("videoUrl", e.target.value)} placeholder="Verplicht wanneer TikTok is gekozen" /></label>
      <label>Organisator<input value={form.organizer} onChange={(e) => update("organizer", e.target.value)} /></label>
      <label>Contact-e-mail<input type="email" value={form.contactEmail} onChange={(e) => update("contactEmail", e.target.value)} /></label>
      <label>Knoptekst<input value={form.ctaLabel} onChange={(e) => update("ctaLabel", e.target.value)} /></label>
      <label>Knoplink<input type="url" value={form.ctaUrl} onChange={(e) => update("ctaUrl", e.target.value)} placeholder="Leeg = de nieuwe evenementpagina" /></label>
      {isEvent && <><label>Tickets<select value={form.ticketType} onChange={(e) => update("ticketType", e.target.value)}><option value="free">Gratis</option><option value="paid">Betaald</option><option value="none">Geen tickets</option></select></label>
      <label>Prijs per ticket<input type="number" min="0" step="0.01" disabled={form.ticketType !== "paid"} value={form.ticketPrice} onChange={(e) => update("ticketPrice", e.target.value)} /></label>
      <label>Capaciteit<input type="number" min="1" value={form.capacity} onChange={(e) => update("capacity", e.target.value)} /></label>
      <label>Website-status<select value={form.status} onChange={(e) => update("status", e.target.value)}><option value="draft">Eerst als concept</option><option value="publish">Direct publiceren</option></select></label></>}
    </div>

    <fieldset className="eventDestinations"><legend>Bestemmingen</legend>
      {isEvent && <><label className="check"><input type="checkbox" checked={form.addToCalendar} onChange={(e) => update("addToCalendar", e.target.checked)} /> Microsoft-agenda</label>
      {form.addToCalendar && <label>Agenda-e-mailadres<input type="email" value={form.calendarMailbox} onChange={(e) => update("calendarMailbox", e.target.value)} /></label>}</>}
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

    {preview && <div className="eventPreview"><strong>Controle vÃ³Ã³r opslaan</strong><p><b>{campaignTypeLabel}: {form.title}</b></p>{isEvent && <><p>{new Date(form.start).toLocaleString("nl-NL")} â€“ {new Date(form.end).toLocaleString("nl-NL")}</p><p>{form.location}</p></>}<ul>{isEvent && <li>Website: {site} ({form.status === "publish" ? "direct openbaar" : "concept"})</li>}{isEvent && form.addToCalendar && <li>Agenda: {form.calendarMailbox}</li>}{form.preparePromotion && <li>Promotie: {enabledChannels.map((key) => channelLabels[key]).join(", ")}</li>}</ul></div>}
    {result && <div className={result.ok ? "eventResult success" : "eventResult error"}><strong>{result.message}</strong>{result.steps?.map((step) => <p key={step.label}>{step.ok ? "âœ“" : "!"} {step.label}{step.detail ? `: ${step.detail}` : ""}</p>)}{result.url && <a href={result.url} target="_blank" rel="noreferrer">Evenement op de website openen</a>}</div>}
    <div className="eventActions"><button type="button" className="secondaryButton" onClick={showPreview} disabled={busy}>Voorbeeld controleren</button>{preview && <button type="button" onClick={isEvent ? createEvent : createStandaloneCampaign} disabled={busy}>{busy ? "Bezig met opslaanâ€¦" : isEvent ? (form.status === "publish" ? "Evenement publiceren" : "Evenement als concept aanmaken") : "Campagneconcept opslaan"}</button>}</div>
    {eventCampaigns.length > 0 && <div className="campaignStatus"><div className="statusHead"><div><p className="eyebrow">OPGESLAGEN CONCEPTEN</p><h3>Campagnes per soort</h3></div><button type="button" className="secondaryButton" onClick={loadEventCampaigns}>Status verversen</button></div>
      {eventCampaigns.map((item) => { const distribution = (item.media || []).find((entry) => entry?.kind === "campaign_distribution") || {}; const storedType = distribution.common?.campaign_type || distribution.source_type; const isStoredEvent = storedType === "event" || storedType === "website_event"; const typeLabel = campaignTypes.find(([id]) => id === storedType)?.[1] || (storedType === "website_event" ? "Evenement" : "Campagne"); const conceptBusy = conceptBusyId === item.id; return <article key={item.id}><div><span className="campaignKind">{typeLabel}</span><strong>{distribution.common?.title || typeLabel}</strong><p>{distribution.source_url ? <a href={distribution.source_url} target="_blank" rel="noreferrer">Bron openen</a> : "Campagneconcept in Horeca OS"}</p><div className="conceptActions"><button type="button" className="conceptOpenButton" disabled={conceptBusy} onClick={() => openCampaignConcept(item)}>{isStoredEvent ? "Als basis gebruiken" : "Concept bewerken"}</button><button type="button" className="conceptDuplicateButton" disabled={conceptBusy} onClick={() => duplicateCampaignConcept(item)}>Dupliceren</button><button type="button" className="conceptDeleteButton" disabled={conceptBusy} onClick={() => deleteCampaignConcept(item)}>{conceptBusy ? "Bezig..." : "Verwijderen"}</button></div></div><div className="statusPills">{(distribution.target_channels || []).length === 0 && <span className="status local">Alleen als concept opgeslagen</span>}{(distribution.target_channels || []).map((channel) => { const stored = distribution.channel_status?.[channel]; const label = item.published_at ? "Geplaatst" : item.scheduled_for ? "Ingepland" : stored === "extra_gegevens_nodig" ? "Extra gegevens nodig" : "Klaar voor controle"; return <span className={`status ${stored || "klaar_voor_controle"}`} key={channel}><b>{channelLabels[channel] || channel}</b> Â· {label}</span>; })}</div></article>; })}
      <p className="statusNote">Een kanaal wordt pas als geplaatst getoond nadat Horeca OS een plaatsingsbevestiging heeft opgeslagen.</p>
    </div>}
    <style jsx>{`
      .campaignTypeGrid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:10px;margin:0 0 20px}.campaignTypeGrid button{display:flex;flex-direction:column;gap:4px;text-align:left;padding:14px;border:1px solid #c6d5df;border-radius:12px;background:#fff;color:#173552;cursor:pointer}.campaignTypeGrid button.active{border-color:#25889b;background:#eef7f9;box-shadow:inset 0 0 0 1px #25889b}.campaignTypeGrid span{font-size:13px;color:#5c7285;font-weight:400}
      .campaignKind{display:block;width:max-content;margin-bottom:5px;padding:4px 8px;border-radius:999px;background:#eef7f9;color:#176d7f;font-size:12px;font-weight:800}.campaignStatus article>div:first-child strong{display:block}.status.local{background:#eef2f5;color:#4c6172}.editingNotice{display:flex;gap:10px;align-items:center;margin:14px 0;padding:12px 14px;border-left:4px solid #25889b;border-radius:8px;background:#eef7f9;color:#173552}.editingNotice span{color:#5c7285}.conceptActions{display:flex;flex-wrap:wrap;gap:7px;margin-top:9px}.conceptActions button{padding:8px 11px;border-radius:8px;background:#fff;font-weight:800;cursor:pointer}.conceptActions button:disabled{opacity:.55;cursor:wait}.conceptOpenButton{border:1px solid #25889b;color:#176d7f}.conceptDuplicateButton{border:1px solid #78909c;color:#405866}.conceptDeleteButton{border:1px solid #c95d5d;color:#a12f2f}
      .eventCreatorGrid,.channelDetails{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:14px}.channelDetails fieldset{margin:0;padding:14px;border:1px solid #c6d5df;border-radius:12px;display:grid;gap:10px}.channelDetails legend,.eventDestinations legend{font-weight:800}.channelDetails p{margin:0;color:#5c7285}.channelChecks{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:9px}.check{flex-direction:row;align-items:center}.wide{grid-column:1/-1}label{display:flex;flex-direction:column;gap:6px;font-weight:700;color:#173552}input,select,textarea{width:100%;box-sizing:border-box;border:1px solid #c6d5df;border-radius:9px;padding:11px 12px;background:#fff;color:#173552;font:inherit}textarea{resize:vertical}.check input,.eventDestinations input[type=checkbox]{width:auto}.imageUploads{padding:16px;border:1px solid #c6d5df;border-radius:12px;background:#f8fbfc}.imageUploadHead p,.imageHelp,.uploadedImage p{margin:4px 0 0;color:#5c7285}.imageSlotGrid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px;margin-top:14px}.imageSlot{display:flex;justify-content:space-between;gap:12px;min-height:125px;padding:13px;border:1px solid #d5e0e7;border-radius:10px;background:#fff}.imageSlot.exact{border-color:#57ad7d}.imageSlot>div:first-child{display:flex;flex-direction:column;gap:4px}.imageSlot span{font-weight:800;color:#176d7f}.imageSlot small{color:#5c7285;max-width:220px}.uploadButton{align-self:flex-end;display:inline-flex;cursor:pointer;background:#25889b;color:#fff;padding:10px 12px;border-radius:8px;text-align:center}.uploadButton input{display:none}.uploadedImage{min-width:145px}.imagePreview{height:74px;border-radius:8px;background-size:cover;background-position:center}.uploadedImage p{font-size:12px}.removeImage{border:0;background:none;color:#a23a3a;text-decoration:underline;cursor:pointer;padding:4px 0}.uploadMessage{padding:9px 11px;border-radius:8px}.uploadMessage.success{background:#e9f6ee;color:#236d46}.uploadMessage.error{background:#fff2d1;color:#815b00}.eventDestinations{margin:18px 0;padding:16px;border:1px solid #c6d5df;border-radius:12px;display:grid;gap:12px}.eventPreview,.eventResult{padding:16px;margin:14px 0;border-radius:12px;background:#eef7f9}.eventResult.success{border-left:5px solid #2ba66d}.eventResult.error{background:#fff2d1;border-left:5px solid #e4a91b}.eventActions{display:flex;gap:12px;justify-content:flex-end;margin-top:18px}.eventActions button{border:0;border-radius:9px;padding:12px 18px;background:#25889b;color:#fff;font-weight:800;cursor:pointer}.eventActions .secondaryButton{background:#fff;color:#176d7f;border:1px solid #25889b}button:disabled{opacity:.55;cursor:not-allowed}.campaignStatus{margin-top:22px;padding-top:20px;border-top:1px solid #d5e0e7}.statusHead,.campaignStatus article{display:flex;justify-content:space-between;gap:16px;align-items:flex-start}.campaignStatus article{padding:14px 0;border-top:1px solid #e1e9ee}.statusHead h3,.campaignStatus p{margin:0}.statusPills{display:flex;flex-wrap:wrap;gap:7px;justify-content:flex-end}.status{padding:7px 9px;border-radius:999px;background:#e9f6ee;color:#236d46;font-size:13px}.status.extra_gegevens_nodig{background:#fff2d1;color:#815b00}.statusNote{color:#5c7285;font-size:13px}@media(max-width:760px){.campaignTypeGrid,.eventCreatorGrid,.channelDetails,.channelChecks,.imageSlotGrid{grid-template-columns:1fr}.wide{grid-column:auto}.imageSlot{display:block}.uploadButton{margin-top:12px}.eventActions{flex-direction:column}.statusHead,.campaignStatus article{display:block}.statusPills{justify-content:flex-start;margin-top:10px}}
    `}</style>
  </section>;
}

