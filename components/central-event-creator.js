"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "../lib/supabase";

const channelDefaults = {
  brevo: true, facebook: true, instagram: true, tiktok: false,
  whatsapp: false, google: true, predis: false,
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

const campaignTitleLabels = {
  event: "Evenementnaam",
  product: "Productnaam",
  offer: "Naam van aanbieding",
  package: "Arrangementnaam",
  review: "Titel voor reviewbericht",
  custom: "Campagnenaam",
};

const emptyForm = {
  campaignType: "event",
  title: "", shortDescription: "", description: "", start: "", end: "",
  location: "Caribbean Corner, Dorpsstraat 114A, Zoetermeer", imageUrl: "", eventinImage: null, images: emptyImages, videoUrl: "",
  organizer: "Caribbean Corner", contactEmail: "info@caribbeancorner.nl", language: "nl",
  ctaLabel: "Meer informatie", ctaUrl: "", ticketType: "free", ticketPrice: "0", capacity: "",
  status: "draft", calendarMailbox: "info@leclubbbq.nl", addToCalendar: true, preparePromotion: true,
  channels: channelDefaults,
  brevoSubject: "", brevoPreview: "", brevoAudience: "",
  facebookText: "", facebookPlacements: ["feed"], instagramFormat: "post", instagramCaption: "",
  staggerEnabled: true, staggerMinMinutes: "15", staggerMaxMinutes: "45",
  tiktokCaption: "", tiktokPrivacy: "PUBLIC_TO_EVERYONE", tiktokComments: true,
  whatsappTemplate: "", whatsappMessage: "",
  googleTopic: "EVENT", predisType: "afbeelding", predisTone: "Gastvrij en energiek", predisGenerate: false,
  regularPrice: "", campaignPrice: "", discountCode: "", validFrom: "", validUntil: "",
  groupSize: "", pricePerPerson: "", reviewerName: "", reviewScore: "5", reviewSource: "",
};

const channelLabels = {
  brevo: "Nieuwsbrief via Brevo", facebook: "Facebook", instagram: "Instagram",
  tiktok: "TikTok", whatsapp: "WhatsApp Business", google: "Google Bedrijfsprofiel", predis: "Predis",
};

const channelModes = {
  brevo: "Brevo-concept", predis: "Optioneel extern concept",
  facebook: "Intern concept", instagram: "Intern concept", tiktok: "Intern concept",
  whatsapp: "Intern concept", google: "Intern concept",
};

const copyableChannels = new Set(["facebook", "instagram", "tiktok", "whatsapp", "google"]);
const campaignPageSize = 50;

function channelConceptText(distribution, channel, fallbackBody = "") {
  const payload = distribution?.channel_payloads?.[channel] || {};
  const common = distribution?.common || {};
  if (channel === "facebook") return payload.text || common.short_description || fallbackBody;
  if (channel === "instagram") return payload.caption || common.short_description || fallbackBody;
  if (channel === "tiktok") return payload.caption || common.short_description || fallbackBody;
  if (channel === "whatsapp") return payload.message || common.short_description || fallbackBody;
  if (channel === "google") return [
    common.title,
    common.short_description || common.description || fallbackBody,
    common.cta?.url,
  ].filter(Boolean).join("\n\n");
  return "";
}

function siteForBusiness(business) {
  return "caribbeancorner.nl";
}

function defaultsForBusiness(business) {
  const name = String(business?.name || "").trim();
  const isPlein = name.toLowerCase().includes("plein");
  return {
    organizer: name || emptyForm.organizer,
    location: isPlein ? "Grandcafé Het Plein" : "Caribbean Corner",
    contactEmail: isPlein ? "" : emptyForm.contactEmail,
  };
}

function providerDeliveryConfirmed(delivery) {
  const status = String(delivery?.status || "").toLowerCase();
  return ["published", "posted", "delivered"].includes(status)
    && Boolean(delivery?.confirmed_at || delivery?.provider_post_id || delivery?.permalink);
}

function distributionHasProviderConfirmation(distribution) {
  return Object.values(distribution?.provider_delivery || {}).some(providerDeliveryConfirmed);
}

function campaignDeletionBlockReason(item, distribution) {
  if (distributionHasProviderConfirmation(distribution)) return "Deze campagne heeft een bevestigde externe plaatsing en blijft daarom bewaard.";
  if (item?.scheduled_for) return "Trek eerst de interne planning in voordat je dit concept verwijdert.";
  if (item?.workflow_status === "approved") return "Trek eerst de goedkeuring in voordat je dit concept verwijdert.";
  return "";
}

function campaignEditingBlockReason(item, distribution) {
  if (distributionHasProviderConfirmation(distribution)) return "Deze campagne heeft een bevestigde externe plaatsing. Dupliceer haar om veilig een nieuwe versie te maken.";
  if (item?.scheduled_for) return "Trek eerst de interne planning in voordat je dit concept bewerkt.";
  if (item?.workflow_status === "approved") return "Trek eerst de goedkeuring in voordat je dit concept bewerkt.";
  return "";
}

function channelsNeedingDetails(distribution) {
  return (distribution?.target_channels || []).filter((channel) => distribution?.channel_status?.[channel] === "extra_gegevens_nodig");
}

function formatChannelList(channels) {
  return channels.map((channel) => channelLabels[channel] || channel).join(", ");
}

function formatNlDateTime(value) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat("nl-NL", {
    timeZone: "Europe/Amsterdam", day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit",
  }).format(date);
}

function toLocalDateTimeInput(value) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 16);
}

function buildChannelSchedule(channels, baseDate, minMinutes, maxMinutes, enabled) {
  let cursor = baseDate.getTime();
  return Object.fromEntries(channels.map((channel, index) => {
    if (index > 0 && enabled) {
      const delay = Math.floor(Math.random() * (maxMinutes - minMinutes + 1)) + minMinutes;
      cursor += delay * 60_000;
    }
    return [channel, new Date(cursor).toISOString()];
  }));
}

function formHasCampaignContent(form) {
  return [
    form.title, form.shortDescription, form.description, form.start, form.end,
    form.imageUrl, form.eventinImage?.url, form.videoUrl, form.ctaUrl, form.brevoSubject, form.brevoPreview,
    form.facebookText, form.instagramCaption, form.tiktokCaption,
    form.whatsappTemplate, form.whatsappMessage, form.regularPrice, form.campaignPrice,
    form.discountCode, form.validFrom, form.validUntil, form.groupSize, form.pricePerPerson,
    form.reviewerName, form.reviewSource,
    ...Object.values(form.images || {}).map((image) => image?.url || ""),
  ].some((value) => String(value || "").trim());
}

function formDraftStorageKey(workspaceId, businessId) {
  return `horeca-os:marketing-form:${workspaceId}:${businessId}`;
}

export default function CentralEventCreator({ workspaceId, businessId, businesses, session }) {
  const [form, setForm] = useState(emptyForm);
  const [preview, setPreview] = useState(false);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState(null);
  const [uploadingSlot, setUploadingSlot] = useState("");
  const [uploadMessage, setUploadMessage] = useState(null);
  const [draggingSlot, setDraggingSlot] = useState("");
  const [cropFocus, setCropFocus] = useState("center");
  const [eventCampaigns, setEventCampaigns] = useState([]);
  const [campaignListBusy, setCampaignListBusy] = useState(false);
  const [hasMoreCampaigns, setHasMoreCampaigns] = useState(false);
  const [editingCampaignId, setEditingCampaignId] = useState(null);
  const [editingWebsiteEvent, setEditingWebsiteEvent] = useState(null);
  const [conceptBusyId, setConceptBusyId] = useState(null);
  const [conceptTypeFilter, setConceptTypeFilter] = useState("all");
  const [conceptStatusFilter, setConceptStatusFilter] = useState("all");
  const [conceptSearch, setConceptSearch] = useState("");
  const [conceptSort, setConceptSort] = useState("newest");
  const [conceptSchedule, setConceptSchedule] = useState({});
  const [channelScheduleEdits, setChannelScheduleEdits] = useState({});
  const [managedWebsiteEvents, setManagedWebsiteEvents] = useState([]);
  const [managedEventsLoading, setManagedEventsLoading] = useState(false);
  const [importingEventId, setImportingEventId] = useState("");
  const managedEventsRequestRef = useRef(0);
  const [brevoLists, setBrevoLists] = useState([]);
  const [selectedBrevoListIds, setSelectedBrevoListIds] = useState([]);
  const [brevoSenderEmail, setBrevoSenderEmail] = useState("");
  const [brevoLoading, setBrevoLoading] = useState(false);
  const [brevoError, setBrevoError] = useState("");
  const [editingBrevoDraftId, setEditingBrevoDraftId] = useState(null);
  const [predisBrandId, setPredisBrandId] = useState("");
  const [predisConnected, setPredisConnected] = useState(false);
  const [pendingPredisGeneration, setPendingPredisGeneration] = useState(null);
  const [copiedChannelKey, setCopiedChannelKey] = useState("");
  const [restoredDraftKey, setRestoredDraftKey] = useState("");
  const selectedBusiness = useMemo(() => businesses.find((item) => item.id === businessId) || businesses[0], [businessId, businesses]);
  const selectedBrevoLists = useMemo(() => brevoLists.filter((item) => selectedBrevoListIds.includes(String(item.id))), [brevoLists, selectedBrevoListIds]);
  const brevoRecipientCount = selectedBrevoLists.reduce((total, item) => total + Number(item.totalSubscribers || item.uniqueSubscribers || 0), 0);
  const site = siteForBusiness(selectedBusiness);
  const update = (key, value) => {
    setForm((current) => ({ ...current, [key]: value }));
    if (key === "predisGenerate" && !value) setPendingPredisGeneration(null);
    setPreview(false); setResult(null);
  };
  const selectCampaignType = (campaignType) => {
    if (campaignType === form.campaignType) return;
    if (formHasCampaignContent(form) && !window.confirm("Je hebt al campagnegegevens ingevuld. Wil je deze wissen en doorgaan met een ander campagnetype?")) return;
    setForm((current) => ({
      ...emptyForm,
      campaignType,
      googleTopic: campaignType === "event" ? "EVENT" : campaignType === "offer" ? "OFFER" : "STANDARD",
      organizer: current.organizer,
      location: current.location,
      contactEmail: current.contactEmail,
      calendarMailbox: current.calendarMailbox,
      addToCalendar: current.addToCalendar,
      preparePromotion: current.preparePromotion,
      channels: current.channels,
      staggerEnabled: current.staggerEnabled,
      staggerMinMinutes: current.staggerMinMinutes,
      staggerMaxMinutes: current.staggerMaxMinutes,
    }));
    setSelectedBrevoListIds([]);
    setEditingCampaignId(null); setEditingWebsiteEvent(null); setEditingBrevoDraftId(null); setPendingPredisGeneration(null); setPreview(false); setResult(null);
  };
  const toggleChannel = (channel) => update("channels", { ...form.channels, [channel]: !form.channels[channel] });
  const toggleFacebookPlacement = (placement) => {
    const current = form.facebookPlacements || [];
    update("facebookPlacements", current.includes(placement) ? current.filter((item) => item !== placement) : [...current, placement]);
  };
  const enabledChannels = form.preparePromotion ? Object.keys(form.channels).filter((channel) => form.channels[channel]) : [];
  const preferredImageKeys = (channel) => {
    if (channel === "instagram") return form.instagramFormat === "reel" || form.instagramFormat === "story"
      ? ["vertical", "portrait", "square", "landscape"]
      : ["portrait", "square", "vertical", "landscape"];
    if (channel === "tiktok" || channel === "whatsapp") return ["vertical", "portrait", "square", "landscape"];
    if (channel === "predis") return ["square", "portrait", "landscape", "vertical"];
    return ["landscape", "square", "portrait", "vertical"];
  };
  const channelImagePreviews = enabledChannels.map((channel) => {
    const preferredKeys = preferredImageKeys(channel);
    const selectedKey = preferredKeys.find((key) => form.images?.[key]?.url);
    const selectedImage = selectedKey ? form.images[selectedKey] : null;
    const externalUrl = !selectedImage ? form.imageUrl.trim() : "";
    return {
      channel,
      label: channelLabels[channel],
      preferredKey: preferredKeys[0],
      selectedKey,
      image: selectedImage,
      imageUrl: selectedImage?.url || externalUrl,
      isFallback: Boolean(selectedKey && selectedKey !== preferredKeys[0]),
      isExternal: Boolean(externalUrl),
    };
  });
  const channelMediaIssues = form.preparePromotion ? [
    ...(form.channels.facebook && !(form.facebookPlacements || []).length ? ["Facebook: kies Feed, Verhaal of Reel."] : []),
    ...(enabledChannels.length === 0 ? ["Kies minimaal één promotiekanaal."] : []),
    ...channelImagePreviews.flatMap((item) => {
      const videoRequired = item.channel === "tiktok"
        || (item.channel === "instagram" && form.instagramFormat === "reel")
        || (item.channel === "predis" && form.predisType === "video");
      if (videoRequired && !form.videoUrl.trim()) {
        return [`${item.label}: voeg een videolink toe.`];
      }
      if (!videoRequired && !item.imageUrl) {
        return [`${item.label}: upload een afbeelding of voeg een externe afbeeldingslink toe.`];
      }
      return [];
    }),
  ] : [];
  const mediaReady = channelMediaIssues.length === 0;
  const isEvent = form.campaignType === "event";
  const campaignTypeLabel = campaignTypes.find(([id]) => id === form.campaignType)?.[1] || "Campagne";
  const campaignTitleLabel = campaignTitleLabels[form.campaignType] || "Campagnenaam";
  const filteredEventCampaigns = useMemo(() => {
    const searchTerm = conceptSearch.trim().toLocaleLowerCase("nl-NL");
    return eventCampaigns.filter((item) => {
      const distribution = (item.media || []).find((entry) => entry?.kind === "campaign_distribution") || {};
      const storedType = distribution.common?.campaign_type || (distribution.source_type === "website_event" ? "event" : distribution.source_type) || "custom";
      const workStatus = distributionHasProviderConfirmation(distribution) ? "published" : item.scheduled_for ? "scheduled" : item.workflow_status === "approved" ? "approved" : "draft";
      const searchableText = [
        distribution.common?.title,
        distribution.common?.short_description,
        distribution.common?.description,
        item.body,
      ].filter(Boolean).join(" ").toLocaleLowerCase("nl-NL");
      return (conceptTypeFilter === "all" || storedType === conceptTypeFilter)
        && (conceptStatusFilter === "all" || workStatus === conceptStatusFilter)
        && (!searchTerm || searchableText.includes(searchTerm));
    }).sort((left, right) => {
      const leftTime = new Date(left.created_at).getTime();
      const rightTime = new Date(right.created_at).getTime();
      return conceptSort === "oldest" ? leftTime - rightTime : rightTime - leftTime;
    });
  }, [eventCampaigns, conceptTypeFilter, conceptStatusFilter, conceptSearch, conceptSort]);

  function handleImageDrop(slot, event) {
    event.preventDefault();
    event.stopPropagation();
    setDraggingSlot("");
    const files = Array.from(event.dataTransfer?.files || []);
    if (files.length > 1) {
      setUploadMessage({ ok: false, message: "Sleep één afbeelding tegelijk naar een afbeeldingsvak." });
      return;
    }
    if (files[0]) uploadImage(slot, files[0]);
  }

  function handleAllImageDrop(event) {
    event.preventDefault();
    event.stopPropagation();
    setDraggingSlot("");
    const files = Array.from(event.dataTransfer?.files || []);
    if (files.length > 1) {
      setUploadMessage({ ok: false, message: "Sleep één bronafbeelding tegelijk. Horeca OS maakt daar alle mogelijke formaten van." });
      return;
    }
    if (files[0]) uploadImageToAll(files[0]);
  }

  async function prepareImageForSlot(file, slot) {
    const loaded = await new Promise((resolve, reject) => {
      const url = URL.createObjectURL(file);
      const image = new Image();
      image.onload = () => resolve({ image, url, width: image.naturalWidth, height: image.naturalHeight });
      image.onerror = () => { URL.revokeObjectURL(url); reject(new Error("Afbeelding kon niet worden gelezen.")); };
      image.src = url;
    });

    try {
      const sourceRatio = loaded.width / loaded.height;
      const targetRatio = slot.width / slot.height;
      const ratioDifference = Math.abs(sourceRatio - targetRatio) / targetRatio;
      const cropped = ratioDifference > 0.01;
      let sourceX = 0;
      let sourceY = 0;
      let sourceWidth = loaded.width;
      let sourceHeight = loaded.height;

      if (sourceRatio > targetRatio) {
        sourceWidth = loaded.height * targetRatio;
        sourceX = (loaded.width - sourceWidth) / 2;
      } else if (sourceRatio < targetRatio) {
        sourceHeight = loaded.width / targetRatio;
        sourceY = cropFocus === "top" ? 0 : cropFocus === "bottom" ? loaded.height - sourceHeight : (loaded.height - sourceHeight) / 2;
      }

      if (sourceWidth < slot.width || sourceHeight < slot.height) {
        throw new Error(`${slot.label} heeft na het bijsnijden minimaal ${slot.width} × ${slot.height} bruikbare pixels nodig. Deze foto is ${loaded.width} × ${loaded.height} px.`);
      }
      if (!cropped && loaded.width === slot.width && loaded.height === slot.height) {
        return { file, width: loaded.width, height: loaded.height, resized: false, cropped: false, focus: cropFocus, originalWidth: loaded.width, originalHeight: loaded.height };
      }

      const canvas = document.createElement("canvas");
      canvas.width = slot.width;
      canvas.height = slot.height;
      const context = canvas.getContext("2d");
      if (!context) throw new Error("De afbeelding kon niet automatisch worden aangepast.");
      context.imageSmoothingEnabled = true;
      context.imageSmoothingQuality = "high";
      context.drawImage(loaded.image, sourceX, sourceY, sourceWidth, sourceHeight, 0, 0, slot.width, slot.height);
      const blob = await new Promise((resolve) => canvas.toBlob(resolve, file.type, file.type === "image/png" ? undefined : 0.92));
      if (!blob) throw new Error("De afbeelding kon niet automatisch worden aangepast.");
      const extension = file.name.includes(".") ? file.name.slice(file.name.lastIndexOf(".")) : "";
      const baseName = extension ? file.name.slice(0, -extension.length) : file.name;
      const resizedFile = new File([blob], `${baseName}-${slot.width}x${slot.height}${extension}`, { type: file.type, lastModified: Date.now() });
      return { file: resizedFile, width: slot.width, height: slot.height, resized: true, cropped, focus: cropFocus, originalWidth: loaded.width, originalHeight: loaded.height };
    } finally {
      URL.revokeObjectURL(loaded.url);
    }
  }

  async function uploadImage(slot, file) {
    if (!file) return;
    if (!["image/jpeg", "image/png", "image/webp"].includes(file.type)) return setUploadMessage({ ok: false, message: "Gebruik een JPG-, PNG- of WebP-afbeelding." });
    if (file.size > 10 * 1024 * 1024) return setUploadMessage({ ok: false, message: "De afbeelding mag maximaal 10 MB zijn." });
    setUploadingSlot(slot.key); setUploadMessage(null);
    try {
      const prepared = await prepareImageForSlot(file, slot);
      const safeName = prepared.file.name.toLowerCase().replace(/[^a-z0-9._-]+/g, "-");
      const path = `${workspaceId}/${selectedBusiness?.id || businessId || "algemeen"}/${slot.key}-${Date.now()}-${safeName}`;
      const { error } = await supabase.storage.from("marketing-assets").upload(path, prepared.file, { cacheControl: "31536000", contentType: prepared.file.type, upsert: false });
      if (error) throw error;
      const { data } = supabase.storage.from("marketing-assets").getPublicUrl(path);
      setForm((current) => ({ ...current, images: { ...current.images, [slot.key]: {
        url: data.publicUrl, path, name: prepared.file.name, width: prepared.width, height: prepared.height,
        originalWidth: prepared.originalWidth, originalHeight: prepared.originalHeight, matches: true, resized: prepared.resized, cropped: prepared.cropped, focus: prepared.focus,
      } } }));
      setUploadMessage({
        ok: true,
        message: prepared.cropped
          ? `${slot.label} is automatisch bijgesneden met focus op ${cropFocus === "top" ? "boven" : cropFocus === "bottom" ? "onder" : "het midden"} en aangepast van ${prepared.originalWidth} × ${prepared.originalHeight} naar ${slot.width} × ${slot.height} px.`
          : prepared.resized
            ? `${slot.label} is automatisch verkleind van ${prepared.originalWidth} × ${prepared.originalHeight} naar ${slot.width} × ${slot.height} px en geüpload.`
            : `${slot.label} is correct geüpload.`,
      });
      setPreview(false); setResult(null);
    } catch (error) { setUploadMessage({ ok: false, message: error.message || "Uploaden is niet gelukt." }); }
    finally { setUploadingSlot(""); }
  }

  async function uploadImageToAll(file) {
    if (!file) return;
    if (!["image/jpeg", "image/png", "image/webp"].includes(file.type)) return setUploadMessage({ ok: false, message: "Gebruik een JPG-, PNG- of WebP-afbeelding." });
    if (file.size > 10 * 1024 * 1024) return setUploadMessage({ ok: false, message: "De afbeelding mag maximaal 10 MB zijn." });
    setUploadingSlot("all"); setUploadMessage(null);
    const uploadedImages = {};
    const failures = [];

    try {
      const eventinSafeName = file.name.toLowerCase().replace(/[^a-z0-9._-]+/g, "-");
      const eventinPath = `${workspaceId}/${selectedBusiness?.id || businessId || "algemeen"}/eventin-${Date.now()}-${eventinSafeName}`;
      const { error: eventinUploadError } = await supabase.storage.from("marketing-assets").upload(eventinPath, file, { cacheControl: "31536000", contentType: file.type, upsert: false });
      if (eventinUploadError) throw eventinUploadError;
      const { data: eventinPublicData } = supabase.storage.from("marketing-assets").getPublicUrl(eventinPath);

      for (const slot of imageSlots) {
        try {
          const prepared = await prepareImageForSlot(file, slot);
          const safeName = prepared.file.name.toLowerCase().replace(/[^a-z0-9._-]+/g, "-");
          const path = `${workspaceId}/${selectedBusiness?.id || businessId || "algemeen"}/${slot.key}-${Date.now()}-${safeName}`;
          const { error } = await supabase.storage.from("marketing-assets").upload(path, prepared.file, { cacheControl: "31536000", contentType: prepared.file.type, upsert: false });
          if (error) throw error;
          const { data } = supabase.storage.from("marketing-assets").getPublicUrl(path);
          uploadedImages[slot.key] = {
            url: data.publicUrl, path, name: prepared.file.name, width: prepared.width, height: prepared.height,
            originalWidth: prepared.originalWidth, originalHeight: prepared.originalHeight, matches: true,
            resized: prepared.resized, cropped: prepared.cropped, focus: prepared.focus,
          };
        } catch (error) {
          failures.push(`${slot.label}: ${error.message || "niet gelukt"}`);
        }
      }

      const completed = Object.keys(uploadedImages).length;
      setForm((current) => ({
        ...current,
        eventinImage: { url: eventinPublicData.publicUrl, path: eventinPath, name: file.name },
        images: { ...current.images, ...uploadedImages },
      }));
      setPreview(false); setResult(null);
      setUploadMessage({
        ok: true,
        message: failures.length
          ? `De Eventin-afbeelding is opgeslagen. ${completed} van de ${imageSlots.length} socialmediaformaten zijn gemaakt. ${failures.join(" ")}`
          : "De Eventin-afbeelding en alle vier socialmediaformaten zijn geüpload.",
      });
    } finally {
      setUploadingSlot("");
    }
  }

  async function removeImage(slotKey) {
    const image = form.images?.[slotKey];
    if (image?.path) await supabase.storage.from("marketing-assets").remove([image.path]);
    setForm((current) => ({ ...current, images: { ...current.images, [slotKey]: null } }));
    setPreview(false); setResult(null);
  }

  async function loadEventCampaigns({ append = false } = {}) {
    if (!workspaceId || campaignListBusy) return;
    const from = append ? eventCampaigns.length : 0;
    setCampaignListBusy(true);
    let query = supabase.from("social_content_items")
      .select("id,body,media,status,workflow_status,scheduled_for,published_at,permalink,created_at")
      .eq("workspace_id", workspaceId)
      .filter("media", "cs", JSON.stringify([{ kind: "campaign_distribution" }]))
      .order("created_at", { ascending: conceptSort === "oldest" })
      .range(from, from + campaignPageSize - 1);
    if (selectedBusiness?.id || businessId) query = query.eq("business_id", selectedBusiness?.id || businessId);
    const { data, error } = await query;
    if (error) {
      setResult({ ok: false, message: append ? "Meer campagnes konden niet worden geladen." : "Opgeslagen campagnes konden niet worden geladen." });
      setCampaignListBusy(false);
      return;
    }
    const nextCampaigns = data || [];
    setHasMoreCampaigns(nextCampaigns.length === campaignPageSize);
    setEventCampaigns((current) => {
      if (!append) return nextCampaigns;
      const currentIds = new Set(current.map((item) => item.id));
      return [...current, ...nextCampaigns.filter((item) => !currentIds.has(item.id))];
    });
    setCampaignListBusy(false);
  }

  async function loadManagedWebsiteEvents() {
    const selectedBusinessId = selectedBusiness?.id || businessId;
    if (!workspaceId || !selectedBusinessId) return;
    const requestId = managedEventsRequestRef.current + 1;
    managedEventsRequestRef.current = requestId;
    setManagedEventsLoading(true);
    setResult(null);
    try {
      const query = new URLSearchParams({ workspaceId, businessId: selectedBusinessId, site });
      const response = await fetch(`/api/marketing/website-events/create?${query}`, { headers: { Authorization: `Bearer ${session.access_token}` } });
      const payload = await response.json().catch(() => ({}));
      if (requestId !== managedEventsRequestRef.current) return;
      if (!response.ok) throw new Error(payload.error || "De bestaande website-evenementen konden niet worden geladen.");
      setManagedWebsiteEvents((payload.events || []).map((eventItem) => ({ ...eventItem, businessId: selectedBusinessId, site, readOnly: Boolean(payload.readOnly) })));
      setResult({ ok: true, message: `${payload.events?.length || 0} bestaande Eventin-evenementen gevonden. Er is nog niets geïmporteerd of gewijzigd.${payload.warning ? ` ${payload.warning}` : ""}` });
    } catch (error) {
      if (requestId !== managedEventsRequestRef.current) return;
      setManagedWebsiteEvents([]);
      setResult({ ok: false, message: error.message || "De bestaande website-evenementen konden niet worden geladen." });
    } finally {
      if (requestId === managedEventsRequestRef.current) setManagedEventsLoading(false);
    }
  }

  async function campaignAccountForBusiness(selectedBusinessId) {
    if (!selectedBusinessId) return null;
    const { data, error } = await supabase.from("integration_accounts")
      .select("id,provider")
      .eq("workspace_id", workspaceId)
      .eq("business_id", selectedBusinessId);
    if (error) throw error;
    return (data || []).find((account) => account.provider === "marketing")
      || (data || []).find((account) => account.provider === "meta")
      || (data || [])[0]
      || null;
  }

  async function importManagedWebsiteEvent(eventItem) {
    const selectedBusinessId = selectedBusiness?.id || businessId;
    if (!selectedBusinessId || !eventItem?.id) return;
    if (eventItem.businessId !== selectedBusinessId || eventItem.site !== site) {
      return setResult({ ok: false, message: "De vestiging is tijdens het laden gewijzigd. Laad de Eventin-evenementen opnieuw voor de gekozen vestiging." });
    }
    setImportingEventId(eventItem.id);
    setResult(null);
    try {
      const { data: existingRows, error: existingError } = await supabase.from("social_content_items")
        .select("id,media")
        .eq("workspace_id", workspaceId)
        .eq("business_id", selectedBusinessId)
        .filter("media", "cs", JSON.stringify([{ kind: "campaign_distribution", eventin_event_id: String(eventItem.id) }]))
        .limit(1);
      if (existingError) throw existingError;
      if (existingRows?.length) {
        setResult({ ok: true, message: `${eventItem.title} is al aan Horeca OS gekoppeld.` });
        await loadEventCampaigns();
        return;
      }
      const integration = await campaignAccountForBusiness(selectedBusinessId);
      if (!integration?.id) throw new Error("De interne marketingkoppeling ontbreekt.");
      const common = {
        campaign_type: "event",
        title: eventItem.title || "Bestaand evenement",
        short_description: "",
        description: eventItem.description || "",
        start: eventItem.start || "",
        end: eventItem.end || "",
        location: eventItem.location || "",
        image_url: eventItem.imageUrl || "",
        images: emptyImages,
        video_url: "",
        organizer: selectedBusiness?.name || "",
        contact_email: "",
        language: "nl",
        cta: { label: "Meer informatie", url: eventItem.url || "" },
        tickets: { type: "free", price: "0", capacity: "" },
        website_url: eventItem.url || "",
      };
      const distribution = {
        kind: "campaign_distribution",
        source_type: "website_event",
        source_url: eventItem.url || "",
        eventin_event_id: String(eventItem.id),
        website_event_status: eventItem.status || "publish",
        eventin_management_mode: eventItem.readOnly ? "read_only" : "secured",
        imported_from_eventin: true,
        imported_at: new Date().toISOString(),
        common,
        target_channels: [],
        channel_payloads: {},
        channel_status: {},
        channel_schedule: {},
        provider_delivery: {},
        scheduling_status: "draft",
      };
      const { error } = await supabase.from("social_content_items").insert({
        workspace_id: workspaceId,
        business_id: selectedBusinessId,
        account_id: integration.id,
        content_type: "post",
        direction: "outbound",
        body: eventItem.description || eventItem.title || "Bestaand evenement",
        media: [distribution],
        status: "draft",
        workflow_status: "new",
        scheduled_for: null,
        created_by: session.user.id,
      });
      if (error) throw error;
      setResult({ ok: true, message: `${eventItem.title} is aan Horeca OS gekoppeld. Eventin en andere kanalen zijn niet gewijzigd.` });
      await loadEventCampaigns();
    } catch (error) {
      setResult({ ok: false, message: error.message || "Het bestaande evenement kon niet worden gekoppeld." });
    } finally {
      setImportingEventId("");
    }
  }

  function openCampaignConcept(item, asCopy = false) {
    const distribution = (item.media || []).find((entry) => entry?.kind === "campaign_distribution");
    if (!distribution) return;
    const isWebsiteEvent = distribution.source_type === "website_event";
    const editingBlockReason = isWebsiteEvent ? "" : campaignEditingBlockReason(item, distribution);
    if (!asCopy && editingBlockReason) return setResult({ ok: false, message: editingBlockReason });
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
      brevoSubject: payloads.brevo?.subject || "", brevoPreview: payloads.brevo?.preview_text || "", brevoAudience: payloads.brevo?.list_names?.join(", ") || payloads.brevo?.audience || "",
      facebookText: payloads.facebook?.text || "", facebookPlacements: payloads.facebook?.placements || ["feed"], instagramFormat: payloads.instagram?.format || "post", instagramCaption: payloads.instagram?.caption || "",
      tiktokCaption: payloads.tiktok?.caption || "", tiktokPrivacy: payloads.tiktok?.privacy || emptyForm.tiktokPrivacy, tiktokComments: payloads.tiktok?.comments_enabled ?? true,
      whatsappTemplate: payloads.whatsapp?.template_name || "", whatsappMessage: payloads.whatsapp?.message || "",
      googleTopic: payloads.google?.topic_type || (storedType === "event" ? "EVENT" : storedType === "offer" ? "OFFER" : "STANDARD"),
      predisType: payloads.predis?.content_type || "afbeelding", predisTone: payloads.predis?.tone || emptyForm.predisTone, predisGenerate: false,
      staggerEnabled: distribution.schedule_settings?.stagger_enabled ?? true,
      staggerMinMinutes: String(distribution.schedule_settings?.min_minutes ?? 15), staggerMaxMinutes: String(distribution.schedule_settings?.max_minutes ?? 45),
      regularPrice: commercial.regular_price || "", campaignPrice: commercial.campaign_price || "", discountCode: commercial.discount_code || "",
      validFrom: commercial.valid_from || "", validUntil: commercial.valid_until || "", groupSize: commercial.group_size || "", pricePerPerson: commercial.price_per_person || "",
      reviewerName: review.reviewer_name || "", reviewScore: review.score || "5", reviewSource: review.source || "",
    });
    setEditingCampaignId(item.id);
    setEditingWebsiteEvent(isWebsiteEvent ? { eventId: distribution.eventin_event_id, campaignId: item.id, url: distribution.source_url } : null);
    setEditingBrevoDraftId(distribution.provider_delivery?.brevo?.draft_id || null);
    setSelectedBrevoListIds((payloads.brevo?.list_ids || []).map(String));
    setPendingPredisGeneration(null);
    setPreview(false);
    setResult({ ok: true, message: isWebsiteEvent ? "Het website-evenement is geopend voor bewerking. Opslaan werkt hetzelfde Eventin-evenement en het bestaande marketingdossier bij." : "Het campagneconcept is geopend en kan nu op dezelfde plek worden bijgewerkt." });
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function duplicateCampaignConcept(item) {
    openCampaignConcept(item, true);
    setEditingCampaignId(null);
    setEditingWebsiteEvent(null);
    setEditingBrevoDraftId(null);
    setPendingPredisGeneration(null);
    setResult({ ok: true, message: "Het concept is als kopie geopend. Pas eventueel de naam of inhoud aan en sla het op als nieuw concept." });
  }

  async function deleteCampaignConcept(item) {
    const distribution = (item.media || []).find((entry) => entry?.kind === "campaign_distribution") || {};
    const deletionBlockReason = campaignDeletionBlockReason(item, distribution);
    if (deletionBlockReason) return setResult({ ok: false, message: deletionBlockReason });
    const title = distribution.common?.title || "dit concept";
    if (!window.confirm(`Weet je zeker dat je ${title} wilt verwijderen? Alleen het marketingconcept wordt verwijderd; een bestaand website-evenement blijft staan.`)) return;
    setConceptBusyId(item.id);
    setResult(null);
    try {
      const { error } = await supabase.from("social_content_items").delete().eq("id", item.id).eq("workspace_id", workspaceId);
      if (error) throw error;
      if (editingCampaignId === item.id) { setEditingCampaignId(null); setEditingWebsiteEvent(null); }
      setResult({ ok: true, message: "Het marketingconcept is verwijderd. Een gekoppeld website-evenement is niet gewijzigd." });
      await loadEventCampaigns();
    } catch (error) {
      setResult({ ok: false, message: error.message || "Het concept kon niet worden verwijderd." });
    } finally {
      setConceptBusyId(null);
    }
  }

  async function setConceptApproval(item, approved) {
    const distribution = (item.media || []).find((entry) => entry?.kind === "campaign_distribution") || {};
    if (distributionHasProviderConfirmation(distribution)) {
      return setResult({ ok: false, message: "Deze geplaatste campagne is vergrendeld. Dupliceer haar om een nieuwe versie te maken." });
    }
    const incompleteChannels = channelsNeedingDetails(distribution);
    if (approved && incompleteChannels.length > 0) {
      return setResult({ ok: false, message: `Vul eerst de ontbrekende gegevens aan voor: ${formatChannelList(incompleteChannels)}.` });
    }
    const nextChannelStatus = Object.fromEntries((distribution.target_channels || []).map((channel) => {
      const current = distribution.channel_status?.[channel];
      return [channel, current === "extra_gegevens_nodig" ? current : approved ? "goedgekeurd" : "klaar_voor_controle"];
    }));
    const nextDistribution = {
      ...distribution,
      channel_status: nextChannelStatus,
      ...(approved ? {} : { channel_schedule: {}, scheduling_status: "draft" }),
    };
    const nextMedia = (item.media || []).map((entry) => entry?.kind === "campaign_distribution" ? nextDistribution : entry);
    setConceptBusyId(item.id);
    setResult(null);
    try {
      const { error } = await supabase.from("social_content_items").update({ workflow_status: approved ? "approved" : "new", scheduled_for: approved ? item.scheduled_for : null, media: nextMedia }).eq("id", item.id).eq("workspace_id", workspaceId);
      if (error) throw error;
      setResult({ ok: true, message: approved ? "Het campagneconcept is goedgekeurd. Er is nog niets gepubliceerd." : "De goedkeuring is ingetrokken. Het item staat weer als concept klaar." });
      await loadEventCampaigns();
    } catch (error) {
      setResult({ ok: false, message: error.message || "De conceptstatus kon niet worden aangepast." });
    } finally {
      setConceptBusyId(null);
    }
  }

  async function scheduleConcept(item, cancel = false) {
    const distribution = (item.media || []).find((entry) => entry?.kind === "campaign_distribution") || {};
    if (distributionHasProviderConfirmation(distribution)) {
      return setResult({ ok: false, message: "De planning van een bevestigde plaatsing kan niet meer worden gewijzigd. Dupliceer de campagne voor een nieuwe planning." });
    }
    const incompleteChannels = channelsNeedingDetails(distribution);
    if (!cancel && incompleteChannels.length > 0) {
      return setResult({ ok: false, message: `Inplannen kan pas nadat deze kanalen zijn aangevuld: ${formatChannelList(incompleteChannels)}.` });
    }
    const localValue = conceptSchedule[item.id];
    if (!cancel && !localValue) return setResult({ ok: false, message: "Kies eerst een datum en tijd voor deze campagne." });
    const scheduledFor = cancel ? null : new Date(localValue);
    if (!cancel && (Number.isNaN(scheduledFor.getTime()) || scheduledFor <= new Date())) return setResult({ ok: false, message: "Kies een geldig publicatiemoment in de toekomst." });
    const nextChannelStatus = Object.fromEntries((distribution.target_channels || []).map((channel) => {
      const current = distribution.channel_status?.[channel];
      return [channel, current === "extra_gegevens_nodig" ? current : cancel ? "goedgekeurd" : "ingepland"];
    }));
    const scheduledIso = cancel ? null : scheduledFor.toISOString();
    const scheduleSettings = distribution.schedule_settings || {};
    const nextSchedule = cancel ? {} : buildChannelSchedule(
      distribution.target_channels || [],
      scheduledFor,
      Number(scheduleSettings.min_minutes ?? 15),
      Number(scheduleSettings.max_minutes ?? 45),
      scheduleSettings.stagger_enabled ?? true,
    );
    const nextProviderDelivery = Object.fromEntries((distribution.target_channels || []).map((channel) => [
      channel,
      distribution.provider_delivery?.[channel] || { status: "not_submitted" },
    ]));
    const nextDistribution = {
      ...distribution,
      channel_status: nextChannelStatus,
      channel_schedule: nextSchedule,
      provider_delivery: nextProviderDelivery,
      scheduling_status: cancel ? "approved" : "lokaal_ingepland",
    };
    const nextMedia = (item.media || []).map((entry) => entry?.kind === "campaign_distribution" ? nextDistribution : entry);
    setConceptBusyId(item.id);
    setResult(null);
    try {
      const { error } = await supabase.from("social_content_items").update({ workflow_status: "approved", scheduled_for: scheduledIso, media: nextMedia }).eq("id", item.id).eq("workspace_id", workspaceId);
      if (error) throw error;
      setResult({ ok: true, message: cancel ? "De planning is ingetrokken. De campagne blijft goedgekeurd, maar wordt niet gepubliceerd." : "De campagne is intern ingepland. Per kanaal is een apart tijdstip vastgelegd; pas na een bevestiging van het kanaal tonen we Geplaatst." });
      if (cancel) setConceptSchedule((current) => ({ ...current, [item.id]: "" }));
      await loadEventCampaigns();
    } catch (error) {
      setResult({ ok: false, message: error.message || "De planning kon niet worden opgeslagen." });
    } finally {
      setConceptBusyId(null);
    }
  }

  async function updateChannelPlanning(item, channel, cancel = false) {
    const distribution = (item.media || []).find((entry) => entry?.kind === "campaign_distribution") || {};
    const delivery = distribution.provider_delivery?.[channel] || {};
    if (providerDeliveryConfirmed(delivery)) {
      return setResult({ ok: false, message: `${channelLabels[channel] || channel} heeft de plaatsing al bevestigd. Beheer deze publicatie via de plaatsingslink of rechtstreeks bij het kanaal.` });
    }
    const editKey = `${item.id}-${channel}`;
    const localValue = channelScheduleEdits[editKey] ?? toLocalDateTimeInput(distribution.channel_schedule?.[channel] || item.scheduled_for);
    if (!cancel && !localValue) return setResult({ ok: false, message: "Kies eerst een nieuw publicatiemoment voor dit kanaal." });
    const nextDate = cancel ? null : new Date(localValue);
    if (!cancel && (Number.isNaN(nextDate.getTime()) || nextDate <= new Date())) {
      return setResult({ ok: false, message: "Kies een geldig publicatiemoment in de toekomst." });
    }
    if (cancel && !window.confirm(`Planning voor ${channelLabels[channel] || channel} intrekken? Andere kanalen blijven ongewijzigd.`)) return;

    const storedSchedule = distribution.channel_schedule || {};
    const nextSchedule = Object.keys(storedSchedule).length > 0
      ? { ...storedSchedule }
      : Object.fromEntries((distribution.target_channels || [])
        .filter((targetChannel) => !providerDeliveryConfirmed(distribution.provider_delivery?.[targetChannel] || {}))
        .map((targetChannel) => [targetChannel, item.scheduled_for])
        .filter(([, value]) => Boolean(value)));
    if (cancel) delete nextSchedule[channel];
    else nextSchedule[channel] = nextDate.toISOString();
    const remainingDates = Object.values(nextSchedule)
      .map((value) => new Date(value))
      .filter((date) => !Number.isNaN(date.getTime()))
      .sort((left, right) => left - right);
    const nextChannelStatus = {
      ...(distribution.channel_status || {}),
      [channel]: cancel ? "goedgekeurd" : "ingepland",
    };
    const nextDistribution = {
      ...distribution,
      channel_status: nextChannelStatus,
      channel_schedule: nextSchedule,
      scheduling_status: remainingDates.length ? "lokaal_ingepland" : "approved",
    };
    const nextMedia = (item.media || []).map((entry) => entry?.kind === "campaign_distribution" ? nextDistribution : entry);
    setConceptBusyId(item.id);
    setResult(null);
    try {
      const { error } = await supabase.from("social_content_items")
        .update({ workflow_status: "approved", scheduled_for: remainingDates[0]?.toISOString() || null, media: nextMedia })
        .eq("id", item.id)
        .eq("workspace_id", workspaceId);
      if (error) throw error;
      setChannelScheduleEdits((current) => ({ ...current, [editKey]: cancel ? "" : localValue }));
      setResult({
        ok: true,
        message: cancel
          ? `De interne planning voor ${channelLabels[channel] || channel} is ingetrokken. Andere kanalen zijn niet gewijzigd.`
          : `Het publicatiemoment voor ${channelLabels[channel] || channel} is aangepast. Er is nog niets extern gewijzigd of gepubliceerd.`,
      });
      await loadEventCampaigns();
    } catch (error) {
      setResult({ ok: false, message: error.message || "De kanaalplanning kon niet worden aangepast." });
    } finally {
      setConceptBusyId(null);
    }
  }

  function showChannelManagementGuidance(channel, delivery) {
    const label = channelLabels[channel] || channel;
    const hasLink = Boolean(delivery?.permalink || delivery?.result_url);
    setResult({
      ok: true,
      message: hasLink
        ? `Open de bevestigde plaatsing bij ${label} om haar daar te bewerken of te verwijderen. Horeca OS markeert een externe plaatsing niet als geannuleerd zonder bevestiging van het kanaal.`
        : `${label} heeft de plaatsing bevestigd, maar geen beheerlink teruggegeven. Beheer of annuleer haar rechtstreeks in ${label}; Horeca OS bewaart de plaatsingshistorie.`,
    });
  }

  useEffect(() => {
    if (!selectedBusiness?.id) return;
    const defaults = defaultsForBusiness(selectedBusiness);
    const draftKey = workspaceId ? formDraftStorageKey(workspaceId, selectedBusiness.id) : "";
    let savedForm = null;
    if (draftKey) {
      try {
        savedForm = JSON.parse(window.localStorage.getItem(draftKey) || "null")?.form || null;
      } catch {
        window.localStorage.removeItem(draftKey);
      }
    }
    setRestoredDraftKey("");
    setForm(savedForm ? {
      ...emptyForm,
      ...savedForm,
      images: { ...emptyImages, ...(savedForm.images || {}) },
      channels: { ...channelDefaults, ...(savedForm.channels || {}) },
    } : {
      ...emptyForm,
      images: { ...emptyImages },
      channels: { ...channelDefaults },
      organizer: defaults.organizer,
      location: defaults.location,
      contactEmail: defaults.contactEmail,
    });
    setRestoredDraftKey(draftKey);
    setEditingCampaignId(null);
    setEditingWebsiteEvent(null);
    setEditingBrevoDraftId(null);
    setPendingPredisGeneration(null);
    setManagedWebsiteEvents([]);
    setImportingEventId("");
    managedEventsRequestRef.current += 1;
    setManagedEventsLoading(false);
    setPreview(false);
    setResult(null);
  }, [selectedBusiness?.id, workspaceId]);

  useEffect(() => {
    const selectedBusinessId = selectedBusiness?.id || businessId;
    if (!workspaceId || !selectedBusinessId) return;
    const draftKey = formDraftStorageKey(workspaceId, selectedBusinessId);
    if (restoredDraftKey !== draftKey) return;
    const timer = window.setTimeout(() => {
      try {
        if (formHasCampaignContent(form)) {
          window.localStorage.setItem(draftKey, JSON.stringify({ form, savedAt: new Date().toISOString() }));
        } else {
          window.localStorage.removeItem(draftKey);
        }
      } catch {
        // Het formulier blijft bruikbaar als lokale opslag door de browser wordt geweigerd.
      }
    }, 400);
    return () => window.clearTimeout(timer);
  }, [form, workspaceId, selectedBusiness?.id, businessId, restoredDraftKey]);

  useEffect(() => {
    const selectedBusinessId = selectedBusiness?.id || businessId;
    if (!workspaceId || !selectedBusinessId) {
      setPredisBrandId("");
      setPredisConnected(false);
      return;
    }
    let active = true;
    const storageKey = `horeca-os:predis:${workspaceId}:${selectedBusinessId}`;
    setPredisBrandId("");
    setPredisConnected(false);
    setForm((current) => ({ ...current, predisGenerate: false }));
    setPendingPredisGeneration(null);
    const query = new URLSearchParams({ workspaceId, businessId: selectedBusinessId, config: "1" });
    fetch(`/api/integrations/predis?${query}`, { headers: { Authorization: `Bearer ${session.access_token}` } })
      .then(async (response) => ({ response, result: await response.json().catch(() => ({})) }))
      .then(({ response, result }) => {
        if (!active || !response.ok) return;
        const savedBrandId = result.connected ? result.brandId || "" : "";
        setPredisBrandId(savedBrandId);
        setPredisConnected(Boolean(savedBrandId));
        if (savedBrandId) {
          setForm((current) => formHasCampaignContent(current)
            ? current
            : { ...current, channels: { ...current.channels, predis: true } });
        }
        if (savedBrandId) window.localStorage.setItem(storageKey, savedBrandId);
      })
      .catch(() => {});
    return () => { active = false; };
  }, [workspaceId, selectedBusiness?.id, businessId, session.access_token]);

  useEffect(() => {
    const selectedBusinessId = selectedBusiness?.id || businessId;
    if (!workspaceId || !selectedBusinessId || !form.channels.brevo) {
      setBrevoLists([]);
      setSelectedBrevoListIds([]);
      setBrevoSenderEmail("");
      setBrevoError("");
      return;
    }
    let active = true;
    setBrevoLoading(true);
    setBrevoError("");
    const query = `workspaceId=${encodeURIComponent(workspaceId)}&businessId=${encodeURIComponent(selectedBusinessId)}&resource=lists`;
    fetch(`/api/integrations/brevo?${query}`, { headers: { Authorization: `Bearer ${session.access_token}` } })
      .then(async (response) => ({ ok: response.ok, result: await response.json().catch(() => ({})) }))
      .then(({ ok, result }) => {
        if (!active) return;
        if (!ok) {
          setBrevoLists([]);
          setSelectedBrevoListIds([]);
          setBrevoError(result.error || "De Brevo-doelgroepen konden niet worden geladen.");
          return;
        }
        const lists = result.lists || [];
        setBrevoLists(lists);
        setBrevoSenderEmail(result.senderEmail || "");
        setSelectedBrevoListIds((current) => current.filter((id) => lists.some((item) => String(item.id) === id)));
      })
      .catch(() => {
        if (!active) return;
        setBrevoLists([]);
        setSelectedBrevoListIds([]);
        setBrevoError("Brevo kon niet worden bereikt.");
      })
      .finally(() => { if (active) setBrevoLoading(false); });
    return () => { active = false; };
  }, [workspaceId, selectedBusiness?.id, businessId, form.channels.brevo, session.access_token]);

    useEffect(() => { loadEventCampaigns(); }, [workspaceId, selectedBusiness?.id, businessId, conceptSort]);

  const validate = () => {
    if (!form.title.trim()) return `Vul een naam in voor ${campaignTypeLabel.toLowerCase()}.`;
    if (isEvent && (!form.start || !form.end)) return "Vul een begin- en eindmoment in.";
    if (isEvent && !form.location.trim()) return "Vul de locatie van het evenement in.";
    if (isEvent && !form.contactEmail.trim()) return "Vul het contact-e-mailadres van de vestiging in.";
    if (isEvent && new Date(form.end) <= new Date(form.start)) return "Het eindmoment moet na het beginmoment liggen.";
    if (isEvent && form.ticketType === "paid" && Number(form.ticketPrice) <= 0) return "Vul een geldige ticketprijs in.";
    if (form.campaignType === "offer" && (!form.campaignPrice || !form.validUntil)) return "Vul de actieprijs en einddatum in.";
    if (form.campaignType === "review" && !form.description.trim()) return "Vul de reviewtekst in.";
    if (form.preparePromotion && form.channels.brevo && !form.brevoSubject.trim()) return "Vul voor Brevo een onderwerpregel in.";
    if (form.preparePromotion && form.channels.brevo && !form.organizer.trim()) return "Vul voor Brevo een afzendernaam in.";
    if (form.preparePromotion && form.channels.brevo && !(form.description.trim() || form.shortDescription.trim())) return "Vul voor Brevo een promotietekst of volledige omschrijving in.";
    if (form.preparePromotion && form.channels.brevo && brevoLoading) return "Wacht tot de Brevo-doelgroepen zijn geladen.";
    if (form.preparePromotion && form.channels.brevo && brevoError) return brevoError;
    if (form.preparePromotion && form.channels.brevo && selectedBrevoListIds.length === 0) return "Kies voor Brevo minimaal één doelgroep.";
    if (form.preparePromotion && form.channels.facebook && !(form.facebookPlacements || []).length) return "Kies voor Facebook minimaal Feed, Verhaal of Reel.";
    if (form.preparePromotion && form.channels.tiktok && !form.videoUrl.trim()) return "TikTok heeft een videolink nodig.";
    if (form.preparePromotion && form.channels.whatsapp && !form.whatsappTemplate.trim()) return "WhatsApp heeft voor geplande verzending een goedgekeurde templatenaam nodig.";
    if (form.preparePromotion && form.channels.google && (!form.ctaUrl.trim() || !form.shortDescription.trim())) return "Google heeft een korte tekst en knoplink nodig.";
    if (form.preparePromotion && form.channels.predis && form.predisGenerate && (!predisConnected || !predisBrandId)) return "Koppel voor deze vestiging eerst een Predis-merk onder Koppelingen.";
    if (form.preparePromotion && form.channels.predis && form.predisGenerate && (form.description.trim().length < 20 || form.description.trim().split(/\s+/).length < 3)) return "Beschrijf voor Predis de campagne met minimaal 20 tekens en 3 woorden.";
    if (form.preparePromotion && form.staggerEnabled && (Number(form.staggerMinMinutes) < 1 || Number(form.staggerMaxMinutes) < 1)) return "Vul voor de spreiding minimaal 1 minuut in.";
    if (form.preparePromotion && form.staggerEnabled && Number(form.staggerMinMinutes) > Number(form.staggerMaxMinutes)) return "De minimale spreiding kan niet hoger zijn dan de maximale spreiding.";
    if (!mediaReady) return `Vul eerst alle kanaalmedia in: ${channelMediaIssues.join(" ")}`;
    return "";
  };

  const showPreview = () => { const error = validate(); if (error) return setResult({ ok: false, message: error }); setResult(null); setPreview(true); };

  async function saveIncompleteDraft() {
    if (!form.title.trim()) return setResult({ ok: false, message: `Vul minimaal een naam in voor ${campaignTypeLabel.toLowerCase()}.` });
    if (!(form.shortDescription.trim() || form.description.trim())) return setResult({ ok: false, message: "Vul minimaal een korte promotietekst of volledige omschrijving in." });
    setBusy(true);
    setResult(null);
    try {
      const integration = await campaignAccountForBusiness(selectedBusiness?.id || businessId);
      if (!integration?.id) throw new Error("Het interne marketingconcept kan niet worden opgeslagen: marketingkoppeling ontbreekt.");

      const imageFor = (key, fallbackKeys = []) => form.images?.[key]?.url || fallbackKeys.map((item) => form.images?.[item]?.url).find(Boolean) || form.imageUrl.trim();
      const common = {
        campaign_type: form.campaignType,
        title: form.title.trim(), short_description: form.shortDescription.trim(), description: form.description.trim(),
        start: form.start, end: form.end, location: form.location.trim(), image_url: imageFor("landscape", ["square", "portrait", "vertical"]), images: form.images, video_url: form.videoUrl.trim(),
        organizer: form.organizer.trim(), contact_email: form.contactEmail.trim(), language: form.language,
        cta: { label: form.ctaLabel, url: form.ctaUrl.trim() },
        tickets: { type: form.ticketType, price: form.ticketPrice, capacity: form.capacity }, website_url: "",
        commercial: { regular_price: form.regularPrice, campaign_price: form.campaignPrice, discount_code: form.discountCode, valid_from: form.validFrom, valid_until: form.validUntil, group_size: form.groupSize, price_per_person: form.pricePerPerson },
        review: { reviewer_name: form.reviewerName.trim(), score: form.reviewScore, source: form.reviewSource.trim() },
      };
      const channel_payloads = {
        brevo: {
          subject: form.brevoSubject.trim(), preview_text: form.brevoPreview.trim(),
          audience: selectedBrevoLists.map((item) => item.name).join(", "),
          list_ids: selectedBrevoListIds.map(Number), list_names: selectedBrevoLists.map((item) => item.name),
          recipient_count: brevoRecipientCount, sender_email: brevoSenderEmail,
          image_url: imageFor("landscape", ["square"]),
        },
        facebook: { text: form.facebookText.trim() || form.shortDescription.trim() || form.description.trim(), cta: common.cta, image_url: imageFor("landscape", ["square"]), placements: form.facebookPlacements },
        instagram: { format: form.instagramFormat, caption: form.instagramCaption.trim() || form.shortDescription.trim() || form.description.trim(), image_url: form.instagramFormat === "reel" || form.instagramFormat === "story" ? imageFor("vertical", ["portrait", "square"]) : imageFor("portrait", ["square", "vertical"]) },
        tiktok: { caption: form.tiktokCaption.trim() || form.shortDescription.trim() || form.description.trim(), privacy: form.tiktokPrivacy, comments_enabled: form.tiktokComments, image_url: imageFor("vertical", ["portrait"]) },
        whatsapp: { template_name: form.whatsappTemplate.trim(), message: form.whatsappMessage.trim() || form.shortDescription.trim() || form.description.trim(), image_url: imageFor("vertical", ["landscape", "square"]) },
        google: { topic_type: form.googleTopic, summary: form.shortDescription.trim(), event: { title: form.title.trim(), start: form.start, end: form.end }, call_to_action: common.cta, image_url: imageFor("landscape", ["square"]) },
        predis: { content_type: form.predisType, tone: form.predisTone.trim(), prompt: form.description.trim() || form.shortDescription.trim(), images: form.images, generate_requested: false, brand_id: "" },
      };
      const baseDetailsMissing = (isEvent && (!form.start || !form.end || !form.location.trim() || !form.contactEmail.trim()))
        || (form.campaignType === "offer" && (!form.campaignPrice || !form.validUntil))
        || (form.campaignType === "review" && !form.description.trim());
      const channel_status = Object.fromEntries(enabledChannels.map((channel) => {
        const payload = channel_payloads[channel] || {};
        const media = channelImagePreviews.find((item) => item.channel === channel);
        const videoRequired = channel === "tiktok"
          || (channel === "instagram" && form.instagramFormat === "reel")
          || (channel === "predis" && form.predisType === "video");
        const mediaMissing = videoRequired ? !common.video_url : !media?.imageUrl;
        const detailsMissing = (channel === "brevo" && (!payload.subject || !payload.audience || !common.organizer))
          || (channel === "facebook" && !(payload.placements || []).length)
          || (channel === "whatsapp" && !payload.template_name)
          || (channel === "google" && (!payload.summary || !payload.call_to_action?.url));
        return [channel, baseDetailsMissing || mediaMissing || detailsMissing ? "extra_gegevens_nodig" : "klaar_voor_controle"];
      }));
      const provider_delivery = Object.fromEntries(enabledChannels.map((channel) => [channel, { status: "not_submitted" }]));
      const distribution = {
        kind: "campaign_distribution", source_type: form.campaignType, source_url: form.ctaUrl.trim(),
        eventin_event_id: null, common, target_channels: enabledChannels, channel_payloads, channel_status,
        schedule_settings: { stagger_enabled: form.staggerEnabled, min_minutes: Number(form.staggerMinMinutes) || 15, max_minutes: Number(form.staggerMaxMinutes) || 45 },
        channel_schedule: {}, provider_delivery, scheduling_status: "draft",
      };
      const record = {
        account_id: integration.id, business_id: selectedBusiness?.id || businessId || null,
        content_type: "post", direction: "outbound", body: form.description.trim() || form.shortDescription.trim(),
        media: [distribution], status: "draft", workflow_status: "new", scheduled_for: null, created_by: session.user.id,
      };
      const { error } = editingCampaignId
        ? await supabase.from("social_content_items").update(record).eq("id", editingCampaignId).eq("workspace_id", workspaceId)
        : await supabase.from("social_content_items").insert({ ...record, workspace_id: workspaceId });
      if (error) throw error;
      setResult({ ok: true, message: `${campaignTypeLabel} is intern als vroeg concept opgeslagen. Er is niets gepubliceerd, verzonden of ingepland.` });
      setEditingCampaignId(null);
      setEditingWebsiteEvent(null);
      setPreview(false);
      await loadEventCampaigns();
    } catch (error) {
      setResult({ ok: false, message: error.message || "Het vroege concept kon niet worden opgeslagen." });
    } finally {
      setBusy(false);
    }
  }

  async function createPromotionDraft(websiteEvent) {
    const integration = await campaignAccountForBusiness(selectedBusiness?.id || businessId);
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
      brevo: {
        subject: form.brevoSubject.trim(), preview_text: form.brevoPreview.trim(),
        audience: selectedBrevoLists.map((item) => item.name).join(", "),
        list_ids: selectedBrevoListIds.map(Number), list_names: selectedBrevoLists.map((item) => item.name),
        recipient_count: brevoRecipientCount, sender_email: brevoSenderEmail,
        image_url: imageFor("landscape", ["square"]),
      },
      facebook: { text: form.facebookText.trim() || form.shortDescription.trim(), cta: common.cta, image_url: imageFor("landscape", ["square"]), placements: form.facebookPlacements },
      instagram: { format: form.instagramFormat, caption: form.instagramCaption.trim() || form.shortDescription.trim(), image_url: form.instagramFormat === "reel" || form.instagramFormat === "story" ? imageFor("vertical", ["portrait", "square"]) : imageFor("portrait", ["square", "vertical"]) },
      tiktok: { caption: form.tiktokCaption.trim() || form.shortDescription.trim(), privacy: form.tiktokPrivacy, comments_enabled: form.tiktokComments, image_url: imageFor("vertical", ["portrait"]) },
      whatsapp: { template_name: form.whatsappTemplate.trim(), message: form.whatsappMessage.trim() || form.shortDescription.trim(), image_url: imageFor("vertical", ["landscape", "square"]) },
      google: { topic_type: form.googleTopic, summary: form.shortDescription.trim(), event: { title: form.title.trim(), start: form.start, end: form.end }, call_to_action: common.cta, image_url: imageFor("landscape", ["square"]) },
      predis: { content_type: form.predisType, tone: form.predisTone.trim(), prompt: form.description.trim(), images: form.images, generate_requested: form.predisGenerate && predisConnected, brand_id: form.predisGenerate && predisConnected ? predisBrandId : "" },
    };
    const channel_status = Object.fromEntries(enabledChannels.map((channel) => {
      const payload = channel_payloads[channel] || {};
      const missing = (channel === "brevo" && (!payload.subject || !payload.audience)) ||
        (channel === "tiktok" && !common.video_url) || (channel === "whatsapp" && !payload.template_name) ||
        (channel === "google" && (!payload.summary || !payload.call_to_action?.url));
      return [channel, missing ? "extra_gegevens_nodig" : "klaar_voor_controle"];
    }));
    let brevoDraft = null;
    if (form.preparePromotion && form.channels.brevo) {
      const brevoResponse = await fetch("/api/integrations/brevo", {
        method: editingBrevoDraftId ? "PATCH" : "POST",
        headers: { Authorization: `Bearer ${session.access_token}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          id: editingBrevoDraftId || undefined,
          workspaceId,
          businessId: selectedBusiness?.id || businessId,
          listIds: selectedBrevoListIds.map(Number),
          campaignName: form.title.trim(),
          senderName: form.organizer.trim(),
          subject: form.brevoSubject.trim(),
          content: form.description.trim() || form.shortDescription.trim(),
        }),
      }).catch(() => null);
      const brevoResult = brevoResponse ? await brevoResponse.json().catch(() => ({})) : {};
      if (!brevoResponse?.ok) return { warning: brevoResult.error || "Het Brevo-concept kon niet worden opgeslagen." };
      brevoDraft = brevoResult.draft;
      setEditingBrevoDraftId(brevoDraft.id);
    }
    let predisGeneration = form.preparePromotion && form.channels.predis && form.predisGenerate && predisConnected ? pendingPredisGeneration : null;
    if (form.preparePromotion && form.channels.predis && form.predisGenerate && predisConnected && !predisGeneration) {
      const predisResponse = await fetch("/api/integrations/predis", {
        method: "POST",
        headers: { Authorization: `Bearer ${session.access_token}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          workspaceId,
          businessId: selectedBusiness?.id || businessId,
          brandId: predisBrandId,
          prompt: `${form.description.trim()}\n\nToon: ${form.predisTone.trim()}`,
          mediaType: form.predisType === "video" ? "video" : form.predisType === "carousel" ? "carousel" : "single_image",
        }),
      }).catch(() => null);
      const predisResult = predisResponse ? await predisResponse.json().catch(() => ({})) : {};
      if (!predisResponse?.ok) return { warning: predisResult.error || "Het Predis-concept kon niet worden gestart." };
      predisGeneration = { post_ids: (predisResult.postIds || []).map(String), status: predisResult.status || "inProgress" };
      setPendingPredisGeneration(predisGeneration);
    }
    const providerDelivery = Object.fromEntries(enabledChannels.map((channel) => [
      channel,
      channel === "brevo" && brevoDraft
        ? { status: "draft_saved", draft_id: brevoDraft.id, recipient_count: brevoDraft.recipient_count }
        : channel === "predis" && predisGeneration
          ? { status: "generating", post_ids: predisGeneration.post_ids, provider_status: predisGeneration.status }
          : { status: "not_submitted" },
    ]));
    const distribution = { kind: "campaign_distribution", source_type: isEvent ? "website_event" : form.campaignType, source_url: websiteEvent.url,
      eventin_event_id: websiteEvent.id, website_event_status: websiteEvent.status || "draft", common, target_channels: enabledChannels, channel_payloads, channel_status,
      schedule_settings: { stagger_enabled: form.staggerEnabled, min_minutes: Number(form.staggerMinMinutes) || 15, max_minutes: Number(form.staggerMaxMinutes) || 45 },
      channel_schedule: {}, provider_delivery: providerDelivery };
    const record = {
      account_id: integration.id, business_id: selectedBusiness?.id || businessId || null,
      content_type: "post", direction: "outbound", body: form.description.trim() || form.shortDescription.trim(),
      media: [distribution], status: "draft", workflow_status: "new", scheduled_for: null, created_by: session.user.id,
    };
    const { error } = editingCampaignId
      ? await supabase.from("social_content_items").update(record).eq("id", editingCampaignId).eq("workspace_id", workspaceId)
      : await supabase.from("social_content_items").insert({ ...record, workspace_id: workspaceId });
    return error ? { warning: "Het evenement staat op de website, maar het promotieconcept kon niet worden opgeslagen." } : { ok: true };
  }

  async function createEvent() {
    const error = validate(); if (error) return setResult({ ok: false, message: error });
    setBusy(true); setResult(null); const steps = [];
    try {
      const updatingWebsiteEvent = Boolean(editingWebsiteEvent?.eventId);
      const response = await fetch("/api/marketing/website-events/create", { method: updatingWebsiteEvent ? "PATCH" : "POST", headers: { Authorization: `Bearer ${session.access_token}`, "Content-Type": "application/json" }, body: JSON.stringify({ workspaceId, site, ...form, imageUrl: form.eventinImage?.url || form.imageUrl, eventId: editingWebsiteEvent?.eventId, campaignId: editingWebsiteEvent?.campaignId, businessId: selectedBusiness?.id || businessId || null }) });
      const website = await response.json(); if (!response.ok) throw new Error(website.error || (updatingWebsiteEvent ? "Het website-evenement kon niet worden gewijzigd." : "Het website-evenement kon niet worden aangemaakt."));
      steps.push({ label: updatingWebsiteEvent ? "Website en Eventin bijgewerkt" : "Website en Eventin", ok: true, detail: website.event.url });
      if (form.addToCalendar && !updatingWebsiteEvent) {
        const calendarResponse = await fetch("/api/integrations/microsoft/calendar/action", { method: "POST", headers: { Authorization: `Bearer ${session.access_token}`, "Content-Type": "application/json" }, body: JSON.stringify({ workspaceId, mailbox: form.calendarMailbox.trim(), subject: form.title.trim(), description: `${form.description.trim()}\n\nWebsite: ${website.event.url}`, start: form.start, end: form.end, location: form.location.trim(), attendees: [], recurrence: "none", reminderMinutes: 60, showAs: "busy" }) });
        const calendar = await calendarResponse.json(); steps.push(calendarResponse.ok ? { label: `Agenda ${form.calendarMailbox}`, ok: true } : { label: `Agenda ${form.calendarMailbox}`, ok: false, detail: calendar.error || "Niet toegevoegd." });
      } else if (form.addToCalendar && updatingWebsiteEvent) {
        steps.push({ label: `Agenda ${form.calendarMailbox}`, ok: false, detail: "Niet automatisch gewijzigd; controleer de bestaande agenda-afspraak afzonderlijk." });
      }
      const promotion = await createPromotionDraft(website.event);
      steps.push(promotion.ok
        ? { label: form.preparePromotion ? `Horeca OS-beheerdossier en marketingconcept (${enabledChannels.length} kanalen)` : "Horeca OS-beheerdossier", ok: true }
        : { label: "Horeca OS-beheerdossier", ok: false, detail: promotion.warning });
      if (!promotion.ok) {
        setResult({ ok: false, message: `Eventin-concept ${website.event.id} is aangemaakt, maar het beheerdossier kon niet worden opgeslagen. Maak het evenement niet opnieuw aan.`, steps });
        return;
      }
      const selectedBusinessId = selectedBusiness?.id || businessId;
      if (workspaceId && selectedBusinessId) {
        window.localStorage.removeItem(formDraftStorageKey(workspaceId, selectedBusinessId));
      }
      setResult({ ok: true, message: updatingWebsiteEvent ? "Het bestaande evenement is bijgewerkt." : website.event.status === "draft" ? "Het evenement is als Eventin-concept opgeslagen. Publiceer het hieronder wanneer alles klopt." : "Het evenement is verwerkt.", steps, url: website.event.status === "publish" ? website.event.url : "" }); setEditingWebsiteEvent(null); setEditingCampaignId(null); setPreview(false); await loadEventCampaigns();
    } catch (requestError) { setResult({ ok: false, message: requestError.message }); } finally { setBusy(false); }
  }

  async function changeWebsiteEventStatus(item, mode) {
    const distribution = (item.media || []).find((entry) => entry?.kind === "campaign_distribution") || {};
    const id = String(distribution.eventin_event_id || "");
    if (!id) return setResult({ ok: false, message: "Het Eventin-ID ontbreekt. Open het evenement via de bronlink en beheer het daar handmatig." });
    const movingToPublish = mode === "publish";
    const movingToDraft = mode === "draft";
    const confirmed = window.confirm(movingToPublish
      ? "Dit Eventin-concept nu openbaar publiceren op de website? De promotie op andere kanalen verandert niet automatisch."
      : movingToDraft
        ? "Dit evenement van de website halen en als Eventin-concept bewaren? De promotie op andere kanalen verandert niet automatisch."
        : "Dit website-evenement annuleren en naar de Eventin-prullenbak verplaatsen? Dit kan andere geplaatste kanalen niet automatisch terughalen.");
    if (!confirmed) return;
    setConceptBusyId(item.id);
    setResult(null);
    try {
      const response = await fetch("/api/marketing/website-events/create", {
        method: movingToPublish ? "PATCH" : "DELETE",
        headers: { Authorization: `Bearer ${session.access_token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ workspaceId, site, businessId: item.business_id || selectedBusiness?.id || businessId || null, campaignId: item.id, eventId: id, mode, action: movingToPublish ? "publish" : undefined }),
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(result.error || "Eventin heeft de actie niet geaccepteerd.");
      const nextDistribution = { ...distribution, website_event_status: result.event?.status || (movingToPublish ? "publish" : movingToDraft ? "draft" : "trash") };
      const nextMedia = (item.media || []).map((entry) => entry?.kind === "campaign_distribution" ? nextDistribution : entry);
      const { error } = await supabase.from("social_content_items").update({ media: nextMedia }).eq("id", item.id).eq("workspace_id", workspaceId);
      if (error) {
        setResult({ ok: false, message: `Eventin is ${movingToPublish ? "gepubliceerd" : movingToDraft ? "naar concept gezet" : "geannuleerd"}, maar de lokale status kon niet worden bijgewerkt. Ververs de status en controleer het evenement.` });
      } else {
        setResult({ ok: true, message: movingToPublish
          ? "Het Eventin-evenement is gepubliceerd en staat nu openbaar op de website. Andere kanalen zijn niet gewijzigd."
          : movingToDraft
            ? "Het website-evenement staat nu als Eventin-concept. Andere kanalen zijn niet gewijzigd."
            : "Het website-evenement is naar de Eventin-prullenbak verplaatst. De campagnehistorie blijft bewaard." });
      }
      await loadEventCampaigns();
    } catch (error) {
      setResult({ ok: false, message: error.message || "Het website-evenement kon niet worden aangepast." });
    } finally {
      setConceptBusyId(null);
    }
  }

  async function copyChannelConcept(item, distribution, channel) {
    const text = channelConceptText(distribution, channel, item.body);
    if (!text) return setResult({ ok: false, message: `Er is nog geen tekst voor ${channelLabels[channel] || channel}.` });
    try {
      await navigator.clipboard.writeText(text);
      const key = `${item.id}-${channel}`;
      setCopiedChannelKey(key);
      window.setTimeout(() => setCopiedChannelKey((current) => current === key ? "" : current), 2000);
    } catch {
      setResult({ ok: false, message: "Kopiëren is niet gelukt. Open het concept en selecteer de tekst handmatig." });
    }
  }

  async function createStandaloneCampaign() {
    const error = validate(); if (error) return setResult({ ok: false, message: error });
    setBusy(true); setResult(null);
    try {
      const promotion = await createPromotionDraft({ id: null, url: form.ctaUrl.trim() });
      if (!promotion.ok) throw new Error(promotion.warning || "Het campagneconcept kon niet worden opgeslagen.");
      setResult({ ok: true, message: `${campaignTypeLabel} is als campagneconcept opgeslagen.` });
      setEditingCampaignId(null); setEditingWebsiteEvent(null); setPreview(false); await loadEventCampaigns();
    } catch (requestError) { setResult({ ok: false, message: requestError.message }); }
    finally { setBusy(false); }
  }

  return <section className="panel" style={{ marginBottom: 24 }}>
    <div className="panelHead"><div><p className="eyebrow">CAMPAGNEBOUWER</p><h2>Wat wil je promoten?</h2><p>Kies eerst het soort campagne. Horeca OS toont daarna alleen de gegevens die daarvoor nodig zijn.</p></div></div>
    {editingCampaignId && <div className="editingNotice"><strong>{editingWebsiteEvent ? "Website-evenement bewerken" : "Concept bewerken"}</strong><span>{editingWebsiteEvent ? "Je wijzigingen worden na bevestiging in hetzelfde Eventin-evenement en marketingdossier opgeslagen." : "Je wijzigingen vervangen dit opgeslagen concept wanneer je opnieuw opslaat."}</span></div>}
    <div className="campaignTypeGrid">{campaignTypes.map(([id, label, help]) => <button type="button" key={id} className={form.campaignType === id ? "active" : ""} onClick={() => selectCampaignType(id)}><strong>{label}</strong><span>{help}</span></button>)}</div>
    <div className="eventCreatorGrid">
      <label>Vestiging<select value={selectedBusiness?.id || ""} disabled><option>{selectedBusiness?.name || "Kies eerst een vestiging bovenaan"}</option></select></label>
      <label>{campaignTitleLabel} *<input value={form.title} onChange={(e) => update("title", e.target.value)} /></label>
      {isEvent && <><label>Begint *<input type="datetime-local" value={form.start} onChange={(e) => update("start", e.target.value)} /></label><label>Eindigt *<input type="datetime-local" value={form.end} onChange={(e) => update("end", e.target.value)} /></label><label className="wide">Locatie *<input value={form.location} onChange={(e) => update("location", e.target.value)} /></label></>}
      {(form.campaignType === "product" || form.campaignType === "offer") && <><label>Normale prijs<input type="number" min="0" step="0.01" value={form.regularPrice} onChange={(e) => update("regularPrice", e.target.value)} /></label><label>{form.campaignType === "offer" ? "Actieprijs *" : "Promotieprijs"}<input type="number" min="0" step="0.01" value={form.campaignPrice} onChange={(e) => update("campaignPrice", e.target.value)} /></label></>}
      {form.campaignType === "offer" && <><label>Actiecode<input value={form.discountCode} onChange={(e) => update("discountCode", e.target.value)} /></label><label>Geldig vanaf<input type="date" value={form.validFrom} onChange={(e) => update("validFrom", e.target.value)} /></label><label>Geldig tot *<input type="date" value={form.validUntil} onChange={(e) => update("validUntil", e.target.value)} /></label></>}
      {form.campaignType === "package" && <><label>Aantal personen<input type="number" min="1" value={form.groupSize} onChange={(e) => update("groupSize", e.target.value)} /></label><label>Prijs per persoon<input type="number" min="0" step="0.01" value={form.pricePerPerson} onChange={(e) => update("pricePerPerson", e.target.value)} /></label><label>Beschikbaar vanaf<input type="date" value={form.validFrom} onChange={(e) => update("validFrom", e.target.value)} /></label><label>Beschikbaar tot<input type="date" value={form.validUntil} onChange={(e) => update("validUntil", e.target.value)} /></label></>}
      {form.campaignType === "review" && <><label>Naam gast<input value={form.reviewerName} onChange={(e) => update("reviewerName", e.target.value)} /></label><label>Beoordeling<select value={form.reviewScore} onChange={(e) => update("reviewScore", e.target.value)}>{[5,4,3,2,1].map((score) => <option key={score} value={score}>{score} sterren</option>)}</select></label><label className="wide">Bron of reviewlink<input type="url" value={form.reviewSource} onChange={(e) => update("reviewSource", e.target.value)} /></label></>}
      <label className="wide">Korte promotietekst<textarea rows={3} value={form.shortDescription} onChange={(e) => update("shortDescription", e.target.value)} placeholder="De kernboodschap voor Google, WhatsApp en sociale media." /></label>
      <label className="wide">{form.campaignType === "review" ? "Reviewtekst *" : "Volledige omschrijving"}<textarea rows={6} value={form.description} onChange={(e) => update("description", e.target.value)} /></label>
      <div className="imageUploads wide">
        <div className="imageUploadHead"><strong>Afbeeldingen per kanaal</strong><p>Upload één bronafbeelding voor alle formaten, of lever per kanaal een eigen uitsnede aan.</p></div>
        <article className={`eventinImageStatus ${form.eventinImage?.url ? "ready" : "empty"}`}>
          <div>
            <strong>Eventin-afbeelding</strong>
            {form.eventinImage?.url
              ? <><span>✓ Opgeslagen en klaar voor Eventin</span><small>Deze originele foto wordt bij het aanmaken van het evenement naar Eventin gestuurd. De sociale formaten hieronder staan hiervan los.</small></>
              : <><span>Nog geen afbeelding gekozen</span><small>Kies hieronder een bronafbeelding. De originele foto wordt apart voor Eventin bewaard, ook als geen sociaal formaat kan worden gemaakt.</small></>}
          </div>
          {form.eventinImage?.url && <div className="eventinImagePreview">
            <img src={form.eventinImage.url} alt="Geselecteerde Eventin-afbeelding" />
            <small>{form.eventinImage.name || "Bronafbeelding"}</small>
          </div>}
        </article>
        <label className="cropFocus">Focuspunt bij automatisch bijsnijden
          <select value={cropFocus} onChange={(event) => setCropFocus(event.target.value)}>
            <option value="top">Boven — behoud gezichten of tekst bovenin</option>
            <option value="center">Midden — standaard</option>
            <option value="bottom">Onder — behoud tekst of details onderin</option>
          </select>
          <small>Horeca OS houdt dit deel zoveel mogelijk in beeld wanneer een foto niet dezelfde verhouding heeft.</small>
        </label>
        <article
          className={`imageSlot imageSlotAll ${draggingSlot === "all" ? "dragging" : ""}`}
          onDragEnter={(event) => { event.preventDefault(); setDraggingSlot("all"); }}
          onDragOver={(event) => { event.preventDefault(); event.dataTransfer.dropEffect = "copy"; setDraggingSlot("all"); }}
          onDragLeave={(event) => { if (!event.currentTarget.contains(event.relatedTarget)) setDraggingSlot(""); }}
          onDrop={handleAllImageDrop}
        >
          <div><strong>Eén bronafbeelding voor alle formaten</strong><span>Horeca OS maakt automatisch 1,91:1, 1:1, 4:5 en 9:16</span><small>Je kunt een automatisch gemaakte uitsnede hieronder altijd vervangen.</small></div>
          <div className="imageDropZone">
            <strong>{draggingSlot === "all" ? "Laat de bronafbeelding hier los" : "Sleep één afbeelding hierheen"}</strong>
            <small>of</small>
            <label className="uploadButton">{uploadingSlot === "all" ? "Alle formaten maken…" : "Bronafbeelding kiezen"}<input type="file" accept="image/jpeg,image/png,image/webp" disabled={Boolean(uploadingSlot)} onChange={(e) => uploadImageToAll(e.target.files?.[0])} /></label>
          </div>
        </article>
        <div className="imageSlotGrid">{imageSlots.map((slot) => {
          const uploaded = form.images?.[slot.key];
          const isDragging = draggingSlot === slot.key;
          return <article
            className={`imageSlot ${uploaded?.matches ? "exact" : ""} ${isDragging ? "dragging" : ""}`}
            key={slot.key}
            onDragEnter={(event) => { event.preventDefault(); setDraggingSlot(slot.key); }}
            onDragOver={(event) => { event.preventDefault(); event.dataTransfer.dropEffect = "copy"; setDraggingSlot(slot.key); }}
            onDragLeave={(event) => { if (!event.currentTarget.contains(event.relatedTarget)) setDraggingSlot(""); }}
            onDrop={(event) => handleImageDrop(slot, event)}
          >
            <div><strong>{slot.label}</strong><span>{slot.width} × {slot.height} px · {slot.ratio}</span><small>{slot.channels}</small></div>
            {uploaded ? <div className="uploadedImage">
              <div className="imagePreview" style={{ backgroundImage: `url(${uploaded.url})` }} aria-label={`Voorbeeld ${slot.label}`} />
              <p>{uploaded.width} × {uploaded.height} px {uploaded.matches ? "· Perfect formaat" : "· Afwijkend formaat"}</p>
              <small className="replaceHint">Sleep een nieuwe afbeelding hierheen om te vervangen.</small>
              <button type="button" className="removeImage" onClick={() => removeImage(slot.key)}>Verwijderen</button>
            </div> : <div className="imageDropZone">
              <strong>{isDragging ? "Laat de afbeelding hier los" : "Sleep een afbeelding hierheen"}</strong>
              <small>of</small>
              <label className="uploadButton">{uploadingSlot === slot.key ? "Bezig met uploaden…" : "Afbeelding kiezen"}<input type="file" accept="image/jpeg,image/png,image/webp" disabled={Boolean(uploadingSlot)} onChange={(e) => uploadImage(slot, e.target.files?.[0])} /></label>
            </div>}
          </article>;
        })}</div>
        <p className="imageHelp">JPG, PNG of WebP · maximaal 10 MB per afbeelding.</p>
        {uploadMessage && <p className={`uploadMessage ${uploadMessage.ok ? "success" : "error"}`}>{uploadMessage.message}</p>}
      </div>
      <label>Externe afbeeldingslink (optioneel)<input type="url" value={form.imageUrl} onChange={(e) => update("imageUrl", e.target.value)} placeholder="Alleen als alternatief voor upload" /></label>
      <label>Videolink<input type="url" value={form.videoUrl} onChange={(e) => update("videoUrl", e.target.value)} placeholder="Verplicht wanneer TikTok is gekozen" /></label>
      <label>Organisator<input value={form.organizer} onChange={(e) => update("organizer", e.target.value)} /></label>
      <label>Contact-e-mail *<input type="email" value={form.contactEmail} onChange={(e) => update("contactEmail", e.target.value)} /></label>
      <label>Knoptekst<input value={form.ctaLabel} onChange={(e) => update("ctaLabel", e.target.value)} /></label>
      <label>Knoplink<input type="url" value={form.ctaUrl} onChange={(e) => update("ctaUrl", e.target.value)} placeholder="Leeg = de nieuwe evenementpagina" /></label>
      {isEvent && <><label>Tickets<select value={form.ticketType} onChange={(e) => update("ticketType", e.target.value)}><option value="free">Gratis</option><option value="paid">Betaald</option><option value="none">Geen tickets</option></select></label>
      <label>Prijs per ticket<input type="number" min="0" step="0.01" disabled={form.ticketType !== "paid"} value={form.ticketPrice} onChange={(e) => update("ticketPrice", e.target.value)} /></label>
      <label>Capaciteit<input type="number" min="1" value={form.capacity} onChange={(e) => update("capacity", e.target.value)} /></label></>}
    </div>

    <fieldset className="eventDestinations"><legend>Bestemmingen</legend>
      {isEvent && <div className="eventinDestination">
        <label className="check"><input type="checkbox" checked readOnly /> Eventin op caribbeancorner.nl</label>
        <label>Eventin-publicatie<select value={form.status} onChange={(e) => update("status", e.target.value)}><option value="draft">Eerst als concept</option><option value="publish">Direct publiceren</option></select></label>
        <small>De gekozen vestiging wordt als locatie gebruikt. Bij ‘Direct publiceren’ komt het evenement meteen openbaar in Eventin; bij ‘Eerst als concept’ kun je het daar nog controleren.</small>
      </div>}
      {isEvent && <><label className="check"><input type="checkbox" checked={form.addToCalendar} onChange={(e) => update("addToCalendar", e.target.checked)} /> Microsoft-agenda</label>
      {form.addToCalendar && <label>Agenda-e-mailadres<input type="email" value={form.calendarMailbox} onChange={(e) => update("calendarMailbox", e.target.value)} /></label>}</>}
      <label className="check"><input type="checkbox" checked={form.preparePromotion} onChange={(e) => update("preparePromotion", e.target.checked)} /> Promotieconcept voor andere kanalen</label>
      {form.preparePromotion && <>
        <div className="channelChecks">{Object.entries(channelLabels).map(([key, label]) => <label className="channelCheck" key={key}><span className="check"><input type="checkbox" checked={form.channels[key]} onChange={() => toggleChannel(key)} /> {label}</span><small>{key === "predis" && !predisConnected ? "Niet gekoppeld" : channelModes[key]}</small></label>)}</div>
        <p className="channelSafetyNote">Selecteren publiceert niets automatisch. Brevo slaat een concept bij Brevo op; Predis alleen wanneer je de extra keuze aanzet. De overige kanalen blijven interne concepten in Horeca OS.</p>
      </>}
    </fieldset>

    {form.preparePromotion && <div className="channelDetails">
      {form.channels.brevo && <fieldset><legend>Brevo — veilig als concept</legend>
        <label>Onderwerp *<input value={form.brevoSubject} onChange={(e) => update("brevoSubject", e.target.value)} /></label>
        <label>Voorbeeldtekst<input value={form.brevoPreview} onChange={(e) => update("brevoPreview", e.target.value)} /></label>
        <div className="brevoAudiencePicker">
          <strong>Doelgroep(en) *</strong>
          {brevoLoading && <p>Brevo-doelgroepen laden…</p>}
          {!brevoLoading && brevoError && <p className="brevoAudienceError">{brevoError}</p>}
          {!brevoLoading && !brevoError && brevoLists.length === 0 && <p>Geen Brevo-doelgroepen beschikbaar voor deze vestiging.</p>}
          {brevoLists.map((list) => <label className="check" key={list.id}>
            <input type="checkbox" checked={selectedBrevoListIds.includes(String(list.id))} onChange={() => {
              const id = String(list.id);
              setSelectedBrevoListIds((current) => current.includes(id) ? current.filter((item) => item !== id) : [...current, id]);
              setPreview(false); setResult(null);
            }} />
            {list.name} ({Number(list.totalSubscribers || list.uniqueSubscribers || 0).toLocaleString("nl-NL")} ontvangers)
          </label>)}
          {selectedBrevoListIds.length > 0 && <p><b>{brevoRecipientCount.toLocaleString("nl-NL")} ontvangers geselecteerd</b>{brevoSenderEmail ? ` · afzender ${brevoSenderEmail}` : ""}</p>}
          <small>Horeca OS slaat alleen een Brevo-concept op. Vanuit deze stap wordt niets verzonden.</small>
        </div>
      </fieldset>}      {form.channels.facebook && <fieldset><legend>Facebook — intern concept</legend><div className="placementChoices"><span>Plaatsing *</span>{[["feed", "Feed"], ["story", "Verhaal"], ["reel", "Reel"]].map(([value, label]) => <label className="check" key={value}><input type="checkbox" checked={(form.facebookPlacements || []).includes(value)} onChange={() => toggleFacebookPlacement(value)} /> {label}</label>)}</div><label>Berichttekst<textarea rows={3} value={form.facebookText} onChange={(e) => update("facebookText", e.target.value)} placeholder="Leeg = korte promotietekst" /></label></fieldset>}
      {form.channels.instagram && <fieldset><legend>Instagram — intern concept</legend><label>Vorm<select value={form.instagramFormat} onChange={(e) => update("instagramFormat", e.target.value)}><option value="post">Post</option><option value="reel">Reel</option><option value="story">Story</option><option value="carousel">Carrousel</option></select></label><label>Bijschrift<textarea rows={3} value={form.instagramCaption} onChange={(e) => update("instagramCaption", e.target.value)} /></label></fieldset>}
      {form.channels.tiktok && <fieldset><legend>TikTok — intern concept, video verplicht</legend><label>Bijschrift<textarea rows={3} value={form.tiktokCaption} onChange={(e) => update("tiktokCaption", e.target.value)} /></label><label>Zichtbaarheid<select value={form.tiktokPrivacy} onChange={(e) => update("tiktokPrivacy", e.target.value)}><option value="PUBLIC_TO_EVERYONE">Openbaar</option><option value="MUTUAL_FOLLOW_FRIENDS">Vrienden</option><option value="SELF_ONLY">Alleen ik</option></select></label><label className="check"><input type="checkbox" checked={form.tiktokComments} onChange={(e) => update("tiktokComments", e.target.checked)} /> Reacties toestaan</label></fieldset>}
      {form.channels.whatsapp && <fieldset><legend>WhatsApp Business — intern concept</legend><label>Goedgekeurde templatenaam *<input value={form.whatsappTemplate} onChange={(e) => update("whatsappTemplate", e.target.value)} /></label><label>Bericht<textarea rows={3} value={form.whatsappMessage} onChange={(e) => update("whatsappMessage", e.target.value)} /></label></fieldset>}
      {form.channels.google && <fieldset><legend>Google Bedrijfsprofiel — intern concept</legend><label>Soort bericht<select value={form.googleTopic} onChange={(e) => update("googleTopic", e.target.value)}><option value="EVENT">Evenement</option><option value="STANDARD">Update</option><option value="OFFER">Aanbieding</option></select></label><p>Gebruikt titel, datum/tijd, korte tekst, afbeelding en knoplink uit de basis.</p></fieldset>}
      {form.channels.predis && <fieldset><legend>Predis — veilig als concept</legend>
        <label>Soort concept<select value={form.predisType} onChange={(e) => update("predisType", e.target.value)}><option value="afbeelding">Afbeelding</option><option value="video">Video</option><option value="carousel">Carrousel</option></select></label>
        <label>Toon<input value={form.predisTone} onChange={(e) => update("predisTone", e.target.value)} /></label>
        <div className="predisGenerationChoice">
          <strong>{predisConnected ? "Predis-merk gevonden voor deze vestiging" : "Predis is nog niet gekoppeld voor deze vestiging"}</strong>
          <label className="check"><input type="checkbox" checked={Boolean(form.predisGenerate)} disabled={!predisConnected} onChange={(e) => update("predisGenerate", e.target.checked)} /> Predis-concept laten maken bij opslaan</label>
          <small>Standaard uit. Ook wanneer dit aanstaat, wordt het resultaat alleen als concept gemaakt en nooit automatisch gepubliceerd.</small>
        </div>
      </fieldset>}
      <fieldset className="wide"><legend>Spreiding per kanaal</legend><label className="check"><input type="checkbox" checked={Boolean(form.staggerEnabled)} onChange={(event) => update("staggerEnabled", event.target.checked)} /> Willekeurige wachttijd tussen de kanalen</label>{form.staggerEnabled && <div className="staggerFields"><label>Minimaal aantal minuten<input type="number" min="0" max="1440" value={form.staggerMinMinutes} onChange={(event) => update("staggerMinMinutes", event.target.value)} /></label><label>Maximaal aantal minuten<input type="number" min="0" max="1440" value={form.staggerMaxMinutes} onChange={(event) => update("staggerMaxMinutes", event.target.value)} /></label></div>}<p>Horeca OS toont vooraf het interne tijdschema. Een kanaal krijgt pas de status ‘geplaatst’ nadat de aanbieder dit heeft bevestigd.</p></fieldset>
    </div>}

    {preview && <div className="eventPreview">
      <strong>Controle voor opslaan</strong>
      <p><b>{campaignTypeLabel}: {form.title}</b></p>
      {isEvent && <><p>{new Date(form.start).toLocaleString("nl-NL")} - {new Date(form.end).toLocaleString("nl-NL")}</p><p>{form.location}</p></>}
      <ul>{isEvent && <li>Website: {site} ({form.status === "publish" ? "direct openbaar" : "concept"})</li>}{isEvent && form.addToCalendar && <li>Agenda: {form.calendarMailbox}</li>}{form.preparePromotion && <li>Promotie: {enabledChannels.map((key) => channelLabels[key]).join(", ")}</li>}</ul>
      {form.preparePromotion && <div className={mediaReady ? "mediaCheck mediaCheckReady" : "mediaCheck mediaCheckWarning"}>
        <strong>{mediaReady ? "Alle gekozen kanalen zijn gereed." : "Nog niet gereed voor opslaan."}</strong>
        {!mediaReady && <ul>{channelMediaIssues.map((issue) => <li key={issue}>{issue}</li>)}</ul>}
      </div>}
      {form.preparePromotion && <div className="channelImagePreviewGrid">
        {channelImagePreviews.map((item) => {
          const selectedSlot = imageSlots.find((slot) => slot.key === item.selectedKey);
          const preferredSlot = imageSlots.find((slot) => slot.key === item.preferredKey);
          return <article className="channelImagePreview" key={item.channel}>
            <div className="channelImagePreviewHead"><strong>{item.label}</strong><span className={item.imageUrl ? "imageReady" : "imageMissing"}>{item.imageUrl ? "Beeld gereed" : "Geen beeld"}</span></div>
            {item.imageUrl ? <>
              <img src={item.imageUrl} alt={`Voorbeeld voor ${item.label}`} />
              <p><b>{item.isExternal ? "Externe afbeeldingslink" : selectedSlot?.label}</b>{selectedSlot ? ` - ${selectedSlot.width} x ${selectedSlot.height} px` : ""}</p>
              {item.isFallback && <small className="fallbackNotice">Alternatief gebruikt. Ideaal voor dit kanaal: {preferredSlot?.label} ({preferredSlot?.width} x {preferredSlot?.height} px).</small>}
              {item.channel === "predis" && <small>Predis ontvangt alle geüploade formaten; hierboven staat het primaire voorbeeld.</small>}
            </> : <p className="missingImageNotice">Upload bij voorkeur {preferredSlot?.label} ({preferredSlot?.width} x {preferredSlot?.height} px).</p>}
          </article>;
        })}
      </div>}
    </div>}
    {result && <div className={result.ok ? "eventResult success" : "eventResult error"}><strong>{result.message}</strong>{result.steps?.map((step) => <p key={step.label}>{step.ok ? "✓" : "!"} {step.label}{step.detail ? `: ${step.detail}` : ""}</p>)}{result.url && <a href={result.url} target="_blank" rel="noreferrer">Evenement op de website openen</a>}</div>}
    <div className="earlyDraftAction"><div><strong>Nog niet alles compleet?</strong><p>Sla de basis intern op. Ontbrekende kanaalgegevens krijgen de status Extra gegevens nodig. Er wordt niets gepubliceerd, verzonden of ingepland.</p></div><button type="button" className="secondaryButton" onClick={saveIncompleteDraft} disabled={busy}>{busy ? "Bezig met opslaan…" : "Basisconcept opslaan"}</button></div>
    <div className="eventActions"><button type="button" className="secondaryButton" onClick={showPreview} disabled={busy}>Voorbeeld controleren</button>{preview && <button type="button" onClick={isEvent ? createEvent : createStandaloneCampaign} disabled={busy || !mediaReady} title={!mediaReady ? "Vul eerst de ontbrekende media in." : ""}>{busy ? "Bezig met opslaan…" : editingWebsiteEvent ? "Evenement bijwerken" : isEvent ? (form.status === "publish" ? "Evenement publiceren" : "Evenement als concept aanmaken") : "Campagneconcept opslaan"}</button>}</div>
    {isEvent && <div className="existingWebsiteEvents">
      <div className="existingWebsiteEventsHead"><div><p className="eyebrow">BESTAANDE WEBSITE-AGENDA</p><h3>Eventin-evenementen koppelen</h3><p>Laden en koppelen verandert niets op de website. Pas na koppelen verschijnt het evenement als beheerdossier in Horeca OS.</p></div><button type="button" className="secondaryButton" onClick={loadManagedWebsiteEvents} disabled={managedEventsLoading}>{managedEventsLoading ? "Evenementen laden…" : "Bestaande evenementen laden"}</button></div>
      {managedWebsiteEvents.length > 0 && <div className="managedEventGrid">{managedWebsiteEvents.map((eventItem) => {
        const linked = eventCampaigns.some((campaign) => (campaign.media || []).some((entry) => entry?.kind === "campaign_distribution" && String(entry.eventin_event_id || "") === String(eventItem.id)));
        const incomplete = !eventItem.start || !eventItem.end || !eventItem.location;
        return <article key={eventItem.id}>
          <div><strong>{eventItem.title}</strong><span>{eventItem.readOnly ? "Gepubliceerd · alleen-lezen" : eventItem.status === "draft" ? "Eventin-concept" : "Gepubliceerd"}</span></div>
          <p>{eventItem.start ? formatNlDateTime(eventItem.start) : "Datum moet na koppelen worden gecontroleerd"}{eventItem.location ? ` · ${eventItem.location}` : ""}</p>
          {incomplete && <small>Niet alle Eventin-velden zijn beschikbaar. Controleer datum, tijd en locatie vóór je dit evenement bewerkt.</small>}
          <div className="managedEventActions">{eventItem.status !== "draft" && eventItem.url && <a href={eventItem.url} target="_blank" rel="noreferrer">Website openen</a>}{eventItem.status === "draft" && <small>Nog niet openbaar</small>}<button type="button" disabled={linked || importingEventId === eventItem.id} onClick={() => importManagedWebsiteEvent(eventItem)}>{linked ? "Al gekoppeld" : importingEventId === eventItem.id ? "Koppelen…" : "Aan Horeca OS koppelen"}</button></div>
        </article>;
      })}</div>}
    </div>}
    <div className="campaignStatus"><div className="statusHead"><div><p className="eyebrow">OPGESLAGEN CONCEPTEN</p><h3>Campagnes per soort</h3></div><button type="button" className="secondaryButton" onClick={() => loadEventCampaigns()} disabled={campaignListBusy}>{campaignListBusy ? "Campagnes laden…" : "Status verversen"}</button></div>
      {eventCampaigns.length === 0 ? <div className="emptyCampaignState">
        <strong>Nog geen campagneconcepten opgeslagen</strong>
        <p>Maak hierboven je eerste campagne. Na het opslaan verschijnt die hier met controle-, planning- en kopieerknoppen per kanaal.</p>
        <button type="button" onClick={() => window.scrollTo({ top: 0, behavior: "smooth" })}>Nieuwe campagne maken</button>
      </div> : <>
        <div className="conceptFilters"><label className="conceptSearch">Zoek campagne<input type="search" value={conceptSearch} onChange={(event) => setConceptSearch(event.target.value)} placeholder="Zoek op naam of promotietekst" /></label><label>Soort campagne<select value={conceptTypeFilter} onChange={(event) => setConceptTypeFilter(event.target.value)}><option value="all">Alle soorten</option>{campaignTypes.map(([id, label]) => <option key={id} value={id}>{label}</option>)}</select></label><label>Werkstatus<select value={conceptStatusFilter} onChange={(event) => setConceptStatusFilter(event.target.value)}><option value="all">Alle statussen</option><option value="draft">Concept</option><option value="approved">Goedgekeurd</option><option value="scheduled">Ingepland</option><option value="published">Geplaatst</option></select></label><label>Volgorde<select value={conceptSort} onChange={(event) => setConceptSort(event.target.value)}><option value="newest">Nieuwste eerst</option><option value="oldest">Oudste eerst</option></select></label></div>
        <div className="conceptFilterSummary">
          <span>{filteredEventCampaigns.length} van {eventCampaigns.length} geladen {eventCampaigns.length === 1 ? "campagne" : "campagnes"} zichtbaar</span>
          {(conceptSearch.trim() || conceptTypeFilter !== "all" || conceptStatusFilter !== "all") && <button type="button" onClick={() => { setConceptSearch(""); setConceptTypeFilter("all"); setConceptStatusFilter("all"); }}>Zoeken en filters wissen</button>}
        </div>
        {filteredEventCampaigns.length === 0 && <p className="emptyConcepts">Geen opgeslagen campagnes gevonden met deze zoekopdracht en filters.</p>}
        {filteredEventCampaigns.map((item) => {
        const distribution = (item.media || []).find((entry) => entry?.kind === "campaign_distribution") || {};
        const storedType = distribution.common?.campaign_type || distribution.source_type;
        const isWebsiteEvent = distribution.source_type === "website_event";
        const websiteEventStatus = distribution.website_event_status || "publish";
        const websiteEventCancelled = websiteEventStatus === "trash";
        const websiteEventReadOnly = distribution.eventin_management_mode === "read_only";
        const typeLabel = campaignTypes.find(([id]) => id === storedType)?.[1] || (storedType === "website_event" ? "Evenement" : "Campagne");
        const conceptBusy = conceptBusyId === item.id;
        const approved = item.workflow_status === "approved";
        const providerConfirmed = distributionHasProviderConfirmation(distribution);
        const incompleteChannels = channelsNeedingDetails(distribution);
        const hasIncompleteChannels = incompleteChannels.length > 0;
        const deletionBlockReason = campaignDeletionBlockReason(item, distribution);
        const editingBlockReason = isWebsiteEvent ? "" : campaignEditingBlockReason(item, distribution);

        return <article key={item.id}>
          <div>
            <div className="conceptHeading">
              <span className="campaignKind">{typeLabel}</span>
              <span className={`approvalState ${approved ? "approved" : "draft"}`}>
                {providerConfirmed ? "Geplaatst bevestigd" : item.scheduled_for ? "Intern ingepland" : approved ? "Goedgekeurd" : "Concept"}
              </span>
            </div>
            <strong>{distribution.common?.title || typeLabel}</strong>
            <p className="conceptSavedAt">Opgeslagen: {formatNlDateTime(item.created_at)}</p>
            <p>{distribution.source_url && (!isWebsiteEvent || websiteEventStatus === "publish") ? <a href={distribution.source_url} target="_blank" rel="noreferrer">Bron openen</a> : isWebsiteEvent && websiteEventStatus === "draft" ? "Nog niet openbaar op de website" : "Campagneconcept in Horeca OS"}</p>
            {isWebsiteEvent && <p className={`websiteEventState ${websiteEventCancelled ? "cancelled" : ""}`}><b>Website-evenement:</b> {websiteEventCancelled ? "Geannuleerd" : websiteEventStatus === "draft" ? "Eventin-concept" : "Gepubliceerd"}</p>}
            {websiteEventReadOnly && <p className="protectedCampaignNotice"><b>Alleen-lezen:</b> stel later de beveiligde Eventin-koppeling in om dit evenement vanuit Horeca OS te bewerken of annuleren.</p>}
            {hasIncompleteChannels && <p className="missingChannelNotice"><b>Nog aanvullen:</b> {formatChannelList(incompleteChannels)}. Goedkeuren en inplannen blijven geblokkeerd.</p>}
            {deletionBlockReason && <p className="protectedCampaignNotice"><b>Verwijderen geblokkeerd:</b> {deletionBlockReason}</p>}
            {editingBlockReason && <p className="protectedCampaignNotice"><b>Bewerken geblokkeerd:</b> {editingBlockReason}</p>}
            {providerConfirmed && <p className="placedCampaignLock"><b>Geplaatste campagne vergrendeld.</b> Goedkeuring en planning blijven ongewijzigd. Gebruik Dupliceren voor een nieuwe versie.</p>}
            <div className="conceptActions">
              <button type="button" className="conceptOpenButton" disabled={conceptBusy || websiteEventCancelled || websiteEventReadOnly || Boolean(editingBlockReason)} title={websiteEventReadOnly ? "Beveiligde Eventin-koppeling vereist" : websiteEventCancelled ? "Een geannuleerd website-evenement kan niet meer worden bijgewerkt; dupliceer het voor een nieuwe versie." : editingBlockReason} onClick={() => openCampaignConcept(item)}>{isWebsiteEvent ? websiteEventCancelled || websiteEventReadOnly ? "Bewerken geblokkeerd" : "Evenement bewerken" : editingBlockReason ? "Bewerken geblokkeerd" : "Concept bewerken"}</button>
              {isWebsiteEvent && !websiteEventCancelled && websiteEventStatus === "draft" && <button type="button" className="conceptPublishEventButton" disabled={conceptBusy || websiteEventReadOnly} onClick={() => changeWebsiteEventStatus(item, "publish")}>{conceptBusy ? "Publiceren…" : websiteEventReadOnly ? "Koppeling nodig" : "Publiceren"}</button>}
              {isWebsiteEvent && !websiteEventCancelled && <button type="button" className="conceptWebsiteDraftButton" disabled={conceptBusy || websiteEventReadOnly || websiteEventStatus === "draft"} onClick={() => changeWebsiteEventStatus(item, "draft")}>{websiteEventReadOnly ? "Koppeling nodig" : websiteEventStatus === "draft" ? "Staat als concept" : "Naar concept"}</button>}
              {isWebsiteEvent && !websiteEventCancelled && <button type="button" className="conceptCancelEventButton" disabled={conceptBusy || websiteEventReadOnly} onClick={() => changeWebsiteEventStatus(item, "trash")}>Evenement annuleren</button>}
              <button type="button" className="conceptApproveButton" disabled={conceptBusy || providerConfirmed || (!approved && hasIncompleteChannels)} title={providerConfirmed ? "Geplaatste campagne vergrendeld" : !approved && hasIncompleteChannels ? `Vul eerst aan: ${formatChannelList(incompleteChannels)}` : ""} onClick={() => setConceptApproval(item, !approved)}>{providerConfirmed ? "Status vergrendeld" : approved ? "Terug naar concept" : "Goedkeuren"}</button>
              <button type="button" className="conceptDuplicateButton" disabled={conceptBusy} onClick={() => duplicateCampaignConcept(item)}>Dupliceren</button>
              <button type="button" className="conceptDeleteButton" disabled={conceptBusy || Boolean(deletionBlockReason)} title={deletionBlockReason} onClick={() => deleteCampaignConcept(item)}>{conceptBusy ? "Bezig..." : deletionBlockReason ? "Verwijderen geblokkeerd" : "Verwijderen"}</button>
            </div>
            {approved && !providerConfirmed && <div className="conceptSchedule">
              <label>Basis publicatiemoment<input type="datetime-local" disabled={hasIncompleteChannels} value={conceptSchedule[item.id] || ""} onChange={(event) => setConceptSchedule((current) => ({ ...current, [item.id]: event.target.value }))} /></label>
              {item.scheduled_for ? <>
                <span>Intern basisplan: {formatNlDateTime(item.scheduled_for)}</span>
                <button type="button" disabled={conceptBusy} onClick={() => scheduleConcept(item, true)}>Planning intrekken</button>
              </> : <button type="button" disabled={conceptBusy || hasIncompleteChannels} title={hasIncompleteChannels ? `Vul eerst aan: ${formatChannelList(incompleteChannels)}` : ""} onClick={() => scheduleConcept(item)}>Intern inplannen</button>}
            </div>}
          </div>
          <div className="statusPills">
            {(distribution.target_channels || []).length === 0 && <span className="status local">Alleen als concept opgeslagen</span>}
            {(distribution.target_channels || []).map((channel) => {
              const stored = distribution.channel_status?.[channel];
              const delivery = distribution.provider_delivery?.[channel] || {};
              const confirmed = providerDeliveryConfirmed(delivery);
              const channelSchedule = distribution.channel_schedule || {};
              const plannedAt = channelSchedule[channel] || (Object.keys(channelSchedule).length === 0 ? item.scheduled_for : null);
              const label = confirmed
                ? "Geplaatst (bevestigd)"
                : delivery.status === "draft_saved"
                  ? "Concept bij Brevo opgeslagen"
                  : delivery.status === "generating"
                    ? "Predis maakt een concept"
                    : delivery.status === "draft_ready"
                      ? "Predis-concept gereed"
                      : delivery.status === "generation_failed"
                        ? "Predis-generatie mislukt"
                        : plannedAt
                          ? `Intern concept gepland: ${formatNlDateTime(plannedAt)}`
                          : stored === "extra_gegevens_nodig"
                            ? "Extra gegevens nodig"
                            : approved ? "Intern concept goedgekeurd" : "Intern concept klaar voor controle";

              const copyKey = `${item.id}-${channel}`;
              const scheduleEditKey = `${item.id}-${channel}`;
              const conceptText = channelConceptText(distribution, channel, item.body);
              return <div className={`status ${stored || "klaar_voor_controle"}`} key={channel}>
                <span><b>{channelLabels[channel] || channel}</b> · {label}
                  {confirmed && delivery.permalink && <> · <a href={delivery.permalink} target="_blank" rel="noreferrer">Openen</a></>}
                  {channel === "predis" && delivery.status === "draft_ready" && delivery.result_url && <> · <a href={delivery.result_url} target="_blank" rel="noreferrer">Resultaat openen</a></>}
                </span>
                <div className="channelActions">
                  {plannedAt && !confirmed && <div className="channelPlanningActions">
                    <input type="datetime-local" aria-label={`Publicatiemoment voor ${channelLabels[channel] || channel}`} value={channelScheduleEdits[scheduleEditKey] ?? toLocalDateTimeInput(plannedAt)} onChange={(event) => setChannelScheduleEdits((current) => ({ ...current, [scheduleEditKey]: event.target.value }))} />
                    <button type="button" disabled={conceptBusy} onClick={() => updateChannelPlanning(item, channel)}>Tijd opslaan</button>
                    <button type="button" className="cancelChannelButton" disabled={conceptBusy} onClick={() => updateChannelPlanning(item, channel, true)}>Planning intrekken</button>
                  </div>}
                  {confirmed && <>
                    {(delivery.permalink || delivery.result_url) && <a className="channelManageLink" href={delivery.permalink || delivery.result_url} target="_blank" rel="noreferrer">Plaatsing beheren</a>}
                    <button type="button" onClick={() => showChannelManagementGuidance(channel, delivery)}>Bewerken of annuleren</button>
                  </>}
                  {copyableChannels.has(channel) && <button type="button" disabled={!conceptText} onClick={() => copyChannelConcept(item, distribution, channel)}>
                    {copiedChannelKey === copyKey ? "Gekopieerd ✓" : "Tekst kopiëren"}
                  </button>}
                </div>
              </div>;
            })}
          </div>
        </article>;
      })}
        {hasMoreCampaigns && <button type="button" className="loadMoreCampaigns" onClick={() => loadEventCampaigns({ append: true })} disabled={campaignListBusy}>{campaignListBusy ? "Campagnes laden…" : "Meer campagnes laden"}</button>}
      </>}
      <p className="statusNote">Een kanaal wordt pas als geplaatst getoond nadat Horeca OS een plaatsingsbevestiging heeft opgeslagen.</p>
    </div>
    <style jsx>{`
      .existingWebsiteEvents{margin-top:22px;padding:18px;border:1px solid #c6d5df;border-radius:12px;background:#f8fbfc}.existingWebsiteEventsHead{display:flex;align-items:flex-start;justify-content:space-between;gap:16px}.existingWebsiteEventsHead h3,.existingWebsiteEventsHead p{margin:0}.existingWebsiteEventsHead>button{flex:0 0 auto}.managedEventGrid{display:grid;gap:10px;margin-top:14px}.managedEventGrid article{display:grid;gap:7px;padding:12px;border:1px solid #d5e0e7;border-radius:10px;background:#fff}.managedEventGrid article>div:first-child{display:flex;justify-content:space-between;gap:10px}.managedEventGrid article span{padding:4px 8px;border-radius:999px;background:#eef7f9;color:#176d7f;font-size:12px;font-weight:800}.managedEventGrid p{margin:0;color:#405866}.managedEventGrid small{color:#815b00}.managedEventActions{display:flex;flex-wrap:wrap;gap:8px;align-items:center}.managedEventActions a,.managedEventActions button{border:1px solid #25889b;border-radius:8px;padding:7px 10px;background:#fff;color:#176d7f;font-weight:800;text-decoration:none;cursor:pointer}.managedEventActions button:disabled{opacity:.55;cursor:not-allowed}
      .websiteEventState{margin:8px 0 0!important;padding:8px 10px;border-radius:8px;background:#eef7f9;color:#176d7f}.websiteEventState.cancelled{background:#f8eaea;color:#a12f2f}.conceptPublishEventButton{border:1px solid #23804f;color:#17613d;background:#eefaf3}.conceptWebsiteDraftButton{border:1px solid #c88a18;color:#815b00}.conceptCancelEventButton{border:1px solid #c95d5d;color:#a12f2f}
      .channelActions,.channelPlanningActions{display:flex;flex-wrap:wrap;align-items:center;gap:6px}.channelPlanningActions input{width:190px;padding:6px 8px;font-size:11px}.channelManageLink{display:inline-flex;align-items:center;border:1px solid currentColor;border-radius:7px;padding:5px 7px;background:#fff;text-decoration:none}.cancelChannelButton{color:#a12f2f!important}
      .campaignTypeGrid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:10px;margin:0 0 20px}.campaignTypeGrid button{display:flex;flex-direction:column;gap:4px;text-align:left;padding:14px;border:1px solid #c6d5df;border-radius:12px;background:#fff;color:#173552;cursor:pointer}.campaignTypeGrid button.active{border-color:#25889b;background:#eef7f9;box-shadow:inset 0 0 0 1px #25889b}.campaignTypeGrid span{font-size:13px;color:#5c7285;font-weight:400}
      .missingChannelNotice{margin:8px 0 0!important;padding:9px 11px;border-left:4px solid #e4a91b;border-radius:8px;background:#fff2d1;color:#815b00}.protectedCampaignNotice{margin:8px 0 0!important;padding:9px 11px;border-left:4px solid #78909c;border-radius:8px;background:#eef2f5;color:#405866}.placedCampaignLock{margin:8px 0 0!important;padding:9px 11px;border-left:4px solid #3a9455;border-radius:8px;background:#e9f6ee;color:#236d46}.conceptHeading{display:flex;flex-wrap:wrap;gap:7px;align-items:center;margin-bottom:5px}.campaignKind{display:block;width:max-content;padding:4px 8px;border-radius:999px;background:#eef7f9;color:#176d7f;font-size:12px;font-weight:800}.conceptSavedAt{margin:4px 0!important;color:#5c7285;font-size:12px}.approvalState{padding:4px 8px;border-radius:999px;font-size:12px;font-weight:800}.approvalState.draft{background:#eef2f5;color:#4c6172}.approvalState.approved{background:#e5f6ea;color:#24723b}.campaignStatus article>div:first-child strong{display:block}.status.local{background:#eef2f5;color:#4c6172}.editingNotice{display:flex;gap:10px;align-items:center;margin:14px 0;padding:12px 14px;border-left:4px solid #25889b;border-radius:8px;background:#eef7f9;color:#173552}.editingNotice span{color:#5c7285}.conceptFilters{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:12px;margin:16px 0 10px}.conceptSearch{grid-column:1/-1}.conceptFilterSummary{display:flex;align-items:center;justify-content:space-between;gap:12px;margin-bottom:16px;color:#5c7285;font-size:13px}.conceptFilterSummary button{border:0;background:none;color:#176d7f;font:inherit;font-weight:800;text-decoration:underline;cursor:pointer}.emptyConcepts{padding:16px;border-radius:10px;background:#f5f8fa;color:#5c7285}.emptyCampaignState{display:grid;justify-items:start;gap:8px;margin-top:16px;padding:18px;border:1px dashed #9cbac3;border-radius:12px;background:#f8fbfc}.emptyCampaignState p{margin:0;color:#5c7285}.emptyCampaignState button{border:0;border-radius:9px;padding:10px 14px;background:#25889b;color:#fff;font-weight:800;cursor:pointer}.conceptActions{display:flex;flex-wrap:wrap;gap:7px;margin-top:9px}.conceptActions button,.conceptSchedule button{padding:8px 11px;border-radius:8px;background:#fff;font-weight:800;cursor:pointer}.conceptActions button:disabled,.conceptSchedule button:disabled{opacity:.55;cursor:wait}.conceptOpenButton{border:1px solid #25889b;color:#176d7f}.conceptApproveButton{border:1px solid #3a9455;color:#24723b}.conceptDuplicateButton{border:1px solid #78909c;color:#405866}.conceptDeleteButton{border:1px solid #c95d5d;color:#a12f2f}.conceptSchedule{display:flex;flex-wrap:wrap;gap:8px;align-items:flex-end;margin-top:10px;padding:10px;border-radius:9px;background:#f5f8fa}.conceptSchedule label{min-width:220px}.conceptSchedule button{border:1px solid #25889b;color:#176d7f}.conceptSchedule span{align-self:center;color:#405866;font-size:13px;font-weight:700}
      .placementChoices{display:grid;gap:8px}.placementChoices>span{font-weight:800}.placementChoices label{font-weight:700}.brevoAudiencePicker{display:grid;gap:8px;padding:10px;border-radius:9px;background:#f5f8fa}.brevoAudiencePicker p{margin:0}.brevoAudiencePicker small{color:#5c7285}.brevoAudienceError{color:#a12f2f}.predisGenerationChoice{display:grid;gap:8px;padding:10px;border-radius:9px;background:#f5f8fa}.predisGenerationChoice small{color:#5c7285}.staggerFields{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px}.eventinDestination{display:grid;grid-template-columns:minmax(240px,1fr) minmax(240px,1fr);align-items:end;gap:10px;padding:13px;border:1px solid #57ad7d;border-radius:10px;background:#e9f6ee}.eventinDestination>.check{align-self:center;color:#236d46}.eventinDestination>small{grid-column:1/-1;color:#405866}
      .eventCreatorGrid,.channelDetails{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:14px}.channelDetails fieldset{margin:0;padding:14px;border:1px solid #c6d5df;border-radius:12px;display:grid;gap:10px}.channelDetails legend,.eventDestinations legend{font-weight:800}.channelDetails p{margin:0;color:#5c7285}.channelChecks{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:9px}.channelCheck{display:flex;flex-direction:row;align-items:center;justify-content:space-between;gap:8px;padding:9px 10px;border:1px solid #d5e0e7;border-radius:9px;background:#fff}.channelCheck .check{margin:0}.channelCheck small{padding:4px 7px;border-radius:999px;background:#eef7f9;color:#176d7f;font-size:11px;white-space:nowrap}.channelSafetyNote{margin:0;padding:10px 12px;border-left:4px solid #25889b;border-radius:8px;background:#eef7f9;color:#405866}.check{flex-direction:row;align-items:center}.wide{grid-column:1/-1}label{display:flex;flex-direction:column;gap:6px;font-weight:700;color:#173552}input,select,textarea{width:100%;box-sizing:border-box;border:1px solid #c6d5df;border-radius:9px;padding:11px 12px;background:#fff;color:#173552;font:inherit}textarea{resize:vertical}.check input,.eventDestinations input[type=checkbox]{width:auto}.imageUploads{padding:16px;border:1px solid #c6d5df;border-radius:12px;background:#f8fbfc}.imageUploadHead p,.imageHelp,.uploadedImage p{margin:4px 0 0;color:#5c7285}.eventinImageStatus{display:flex;align-items:center;justify-content:space-between;gap:16px;margin-top:14px;padding:13px;border-radius:10px;border:1px solid #d5e0e7}.eventinImageStatus>div:first-child{display:flex;flex-direction:column;gap:4px}.eventinImageStatus span{font-weight:800}.eventinImageStatus small{color:#5c7285}.eventinImageStatus.ready{border-color:#57ad7d;background:#e9f6ee}.eventinImageStatus.ready span{color:#236d46}.eventinImageStatus.empty{background:#fff}.eventinImagePreview{display:grid;grid-template-columns:72px minmax(80px,160px);align-items:center;gap:9px}.eventinImagePreview img{display:block;width:72px;height:72px;border-radius:8px;object-fit:cover}.eventinImagePreview small{overflow-wrap:anywhere}.cropFocus{margin-top:14px;padding:12px;border-radius:10px;background:#eef7f9}.cropFocus select{margin-top:2px}.cropFocus small{color:#5c7285;font-weight:500}.imageSlotGrid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px;margin-top:14px}.imageSlot{display:flex;justify-content:space-between;gap:12px;min-height:125px;padding:13px;border:1px solid #d5e0e7;border-radius:10px;background:#fff;transition:border-color .15s ease,background .15s ease,transform .15s ease}.imageSlot.imageSlotAll{margin-top:14px;border:2px dashed #25889b;background:#eef9fa}.imageSlot.exact{border-color:#57ad7d}.imageSlot.dragging{border:2px dashed #25889b;background:#e7f6f8;transform:translateY(-2px)}.imageSlot>div:first-child{display:flex;flex-direction:column;gap:4px}.imageSlot span{font-weight:800;color:#176d7f}.imageSlot small{color:#5c7285;max-width:220px}.imageDropZone{min-width:180px;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:7px;padding:12px;border:2px dashed #9cbac3;border-radius:10px;background:#f7fbfc;text-align:center}.imageDropZone>strong{color:#176d7f;font-size:13px}.imageDropZone>small,.replaceHint{color:#5c7285;font-weight:600}.uploadButton{align-self:center;display:inline-flex;cursor:pointer;background:#25889b;color:#fff;padding:10px 12px;border-radius:8px;text-align:center}.uploadButton input{display:none}.uploadedImage{min-width:145px}.imagePreview{height:74px;border-radius:8px;background-size:cover;background-position:center}.uploadedImage p{font-size:12px}.removeImage{border:0;background:none;color:#a23a3a;text-decoration:underline;cursor:pointer;padding:4px 0}.uploadMessage{padding:9px 11px;border-radius:8px}.uploadMessage.success{background:#e9f6ee;color:#236d46}.uploadMessage.error{background:#fff2d1;color:#815b00}.eventDestinations{margin:18px 0;padding:16px;border:1px solid #c6d5df;border-radius:12px;display:grid;gap:12px}.eventPreview,.eventResult{padding:16px;margin:14px 0;border-radius:12px;background:#eef7f9}.mediaCheck{margin-top:14px;padding:12px 14px;border-radius:9px}.mediaCheck ul{margin:8px 0 0;padding-left:20px}.mediaCheckReady{background:#e9f6ee;color:#236d46}.mediaCheckWarning{background:#fff2d1;color:#815b00}.channelImagePreviewGrid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px;margin-top:16px}.channelImagePreview{background:#fff;border:1px solid #c6d5df;border-radius:10px;padding:12px}.channelImagePreviewHead{display:flex;align-items:center;justify-content:space-between;gap:10px;margin-bottom:10px}.channelImagePreviewHead span{font-size:12px;padding:5px 8px;border-radius:999px}.imageReady{background:#e9f6ee;color:#236d46}.imageMissing{background:#fff2d1;color:#815b00}.channelImagePreview img{display:block;width:100%;height:180px;object-fit:contain;background:#f4f7f9;border-radius:8px}.channelImagePreview p{margin:9px 0 3px}.channelImagePreview small{display:block;color:#5c7285;line-height:1.4}.channelImagePreview .fallbackNotice{color:#815b00}.missingImageNotice{padding:16px;background:#fff8e6;border-radius:8px;color:#815b00}.eventResult.success{border-left:5px solid #2ba66d}.eventResult.error{background:#fff2d1;border-left:5px solid #e4a91b}.earlyDraftAction{display:flex;align-items:center;justify-content:space-between;gap:16px;margin-top:18px;padding:14px;border:1px dashed #9cbac3;border-radius:10px;background:#f8fbfc}.earlyDraftAction p{margin:4px 0 0;color:#5c7285}.earlyDraftAction button{flex:0 0 auto;border:1px solid #25889b;border-radius:9px;padding:11px 15px;background:#fff;color:#176d7f;font-weight:800;cursor:pointer}.eventActions{display:flex;gap:12px;justify-content:flex-end;margin-top:18px}.eventActions button{border:0;border-radius:9px;padding:12px 18px;background:#25889b;color:#fff;font-weight:800;cursor:pointer}.eventActions .secondaryButton{background:#fff;color:#176d7f;border:1px solid #25889b}button:disabled{opacity:.55;cursor:not-allowed}.campaignStatus{margin-top:22px;padding-top:20px;border-top:1px solid #d5e0e7}.statusHead,.campaignStatus article{display:flex;justify-content:space-between;gap:16px;align-items:flex-start}.campaignStatus article{padding:14px 0;border-top:1px solid #e1e9ee}.statusHead h3,.campaignStatus p{margin:0}.statusPills{display:flex;flex-wrap:wrap;gap:7px;justify-content:flex-end}.status{display:flex;align-items:center;gap:8px;padding:7px 9px;border-radius:12px;background:#e9f6ee;color:#236d46;font-size:13px}.status button{border:1px solid currentColor;border-radius:7px;padding:5px 7px;background:#fff;color:inherit;font:inherit;font-weight:800;cursor:pointer}.status button:disabled{opacity:.5;cursor:not-allowed}.status.extra_gegevens_nodig{background:#fff2d1;color:#815b00}.loadMoreCampaigns{display:block;margin:14px auto 4px;border:1px solid #25889b;border-radius:9px;padding:10px 16px;background:#fff;color:#176d7f;font-weight:800;cursor:pointer}.loadMoreCampaigns:disabled{opacity:.55;cursor:wait}.statusNote{color:#5c7285;font-size:13px}@media(max-width:760px){.earlyDraftAction{display:block}.earlyDraftAction button{width:100%;margin-top:10px}.campaignTypeGrid,.eventCreatorGrid,.channelDetails,.channelChecks,.imageSlotGrid,.conceptFilters,.channelImagePreviewGrid,.staggerFields{grid-template-columns:1fr}.wide{grid-column:auto}.imageSlot,.eventinImageStatus{display:block}.eventinImagePreview{margin-top:12px}.uploadButton{margin-top:12px}.eventActions{flex-direction:column}.statusHead,.campaignStatus article{display:block}.statusPills{justify-content:flex-start;margin-top:10px}}
    `}</style>
  </section>;
}

