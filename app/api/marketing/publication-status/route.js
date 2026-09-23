import { NextResponse } from "next/server";
import { createUserSupabase } from "../../../../lib/server-supabase";

function result(status, label, detail = "") { return { status, label, detail }; }

async function probe(url) {
  if (!url || !/^https:\/\//i.test(url)) return result("missing", "Geen link", "Er is geen openbare publicatielink opgeslagen.");
  try {
    const controller = new AbortController(); const timeout = setTimeout(() => controller.abort(), 10000);
    let response = await fetch(url, { method: "GET", redirect: "follow", signal: controller.signal, cache: "no-store", headers: { Accept: "text/html,application/xhtml+xml", "User-Agent": "HorecaOS-publication-check/1.0" } });
    clearTimeout(timeout);
    return response.ok ? result("reachable", "Link bereikbaar", `${response.status} ${response.statusText}`) : result("unreachable", "Link niet bereikbaar", `${response.status} ${response.statusText}`);
  } catch (error) { return result("unreachable", "Controle mislukt", error.name === "AbortError" ? "De controle duurde te lang." : "De link kon niet worden geopend."); }
}

async function verifyEventin(request, token, workspaceId, businessId, distribution, fallbackUrl) {
  const eventId = String(distribution.eventin_event_id || distribution.external_ids?.eventin || "").trim();
  if (!/^\d+$/.test(eventId)) return probe(fallbackUrl);
  const fallbackCheck = async (detail) => {
    const checked = await probe(fallbackUrl);
    return checked.status === "reachable" ? { ...checked, label: "Website gecontroleerd", detail: `${detail} De openbare evenementpagina is bereikbaar.` } : checked;
  };
  let site = "";
  try { site = new URL(fallbackUrl).hostname.replace(/^www\./i, ""); } catch { site = "caribbeancorner.nl"; }
  const url = new URL("/api/marketing/website-events/create", request.url);
  url.searchParams.set("workspaceId", workspaceId); url.searchParams.set("businessId", businessId || ""); url.searchParams.set("site", site); url.searchParams.set("eventId", eventId); url.searchParams.set("campaignId", "");
  try {
    const response = await fetch(url, { headers: { Authorization: `Bearer ${token}` }, cache: "no-store" });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) return fallbackCheck(`Eventin-ID ${eventId} kon niet worden opgehaald.`);
    const eventTitle = String(payload.event?.title || "").trim(); const dossierTitle = String(distribution.common?.title || "").trim();
    if (eventTitle && dossierTitle && eventTitle !== dossierTitle) return fallbackCheck(`Eventin toont een afwijkende titel (“${eventTitle}”).`);
    if (payload.event?.status === "draft") return result("reachable", "Eventin-concept", "Het evenement staat nog als concept in Eventin.");
    return result("reachable", "Eventin gecontroleerd", "Titel en Eventin-status zijn opnieuw opgehaald.");
  } catch (error) { return fallbackCheck("Eventin kon niet rechtstreeks worden gecontroleerd."); }
}

async function verifyFacebook(request, token, workspaceId, businessId, distribution, fallbackUrl) {
  const delivery = distribution.facebook_event_delivery || distribution.provider_delivery?.facebook || {};
  const externalId = String(delivery.external_id || delivery.event_id || distribution.external_ids?.facebook || "").trim();
  if (externalId) {
    const url = new URL("/api/integrations/facebook/events", request.url);
    url.searchParams.set("workspaceId", workspaceId);
    url.searchParams.set("businessId", businessId || "");
    url.searchParams.set("includePast", "true");
    try {
      const response = await fetch(url, { headers: { Authorization: `Bearer ${token}` }, cache: "no-store" });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) return result("unreachable", "Facebook controle mislukt", payload.error || `Facebook gaf status ${response.status}.`);
      const found = (payload.events || []).some((event) => String(event.id || "") === externalId);
      return found
        ? result("reachable", "Facebook gecontroleerd", "Het gekoppelde Facebook-evenement is gevonden.")
        : result("unreachable", "Facebook-evenement niet gevonden", "Het opgeslagen Facebook-event bestaat niet in de actuele evenementlijst.");
    } catch (error) {
      return result("unreachable", "Facebook controle mislukt", error.message || "Facebook kon niet worden gecontroleerd.");
    }
  }
  const checked = await probe(fallbackUrl);
  return checked.status === "reachable" ? { ...checked, label: "Facebook gecontroleerd", detail: "De opgeslagen publicatielink op Facebook is bereikbaar." } : checked;
}

function linksFromText(value) {
  return String(value || "").match(/https?:\/\/[^\s)]+/gi)?.map((url) => url.replace(/[.,!?]+$/, "")) || [];
}

export async function POST(request) {
  let body;
  try { body = await request.json(); } catch { return NextResponse.json({ error: "Ongeldig verzoek." }, { status: 400 }); }
  const token = request.headers.get("authorization")?.replace(/^Bearer\s+/i, ""); const { workspaceId, campaignId } = body || {};
  if (!token || !workspaceId || !campaignId) return NextResponse.json({ error: "Aanmelding, werkruimte en evenement zijn verplicht." }, { status: 400 });
  const client = createUserSupabase(token); const { data: userData } = await client.auth.getUser(token);
  if (!userData?.user) return NextResponse.json({ error: "Aanmelding verlopen." }, { status: 401 });
  const { data: campaign, error: campaignError } = await client.from("social_content_items").select("id,business_id,media,body").eq("id", campaignId).eq("workspace_id", workspaceId).maybeSingle();
  if (campaignError || !campaign) return NextResponse.json({ error: "Evenement niet gevonden of geen toegang." }, { status: 404 });
  const distributionIndex = (campaign.media || []).findIndex((entry) => entry?.kind === "campaign_distribution"); let distribution = distributionIndex >= 0 ? campaign.media[distributionIndex] : null;
  if (!distribution) return NextResponse.json({ error: "Geen publicatiegegevens gevonden." }, { status: 400 });
  const { data: relatedCampaigns } = await client.from("social_content_items").select("id,media,body").eq("workspace_id", workspaceId).eq("business_id", campaign.business_id).limit(500);
  const linkedSource = (relatedCampaigns || []).map((entry) => (entry.media || []).find((media) => media?.kind === "campaign_distribution" && media.duplicate_of === campaign.id)).find(Boolean);
  if (linkedSource) distribution = { ...linkedSource, ...distribution, source_url: distribution.source_url || linkedSource.source_url, eventin_event_id: distribution.eventin_event_id || linkedSource.eventin_event_id, external_ids: { ...(linkedSource.external_ids || {}), ...(distribution.external_ids || {}) }, provider_delivery: { ...(linkedSource.provider_delivery || {}), ...(distribution.provider_delivery || {}) }, common: { ...(linkedSource.common || {}), ...(distribution.common || {}) } };
  const textLinks = linksFromText(distribution.common?.description || campaign.body);
  const facebookTextLink = textLinks.find((url) => /facebook\.com|fb\.me/i.test(url)) || "";
  const websiteTextLink = textLinks.find((url) => !/facebook\.com|fb\.me|instagram\.com|google\./i.test(url)) || "";
  const links = {
    website: distribution.source_url || distribution.common?.website_url || distribution.common?.cta?.url || websiteTextLink,
    facebook: distribution.facebook_event_delivery?.permalink || distribution.provider_delivery?.facebook?.permalink || distribution.provider_delivery?.facebook?.result_url || facebookTextLink,
    instagram: distribution.provider_delivery?.instagram?.permalink || distribution.provider_delivery?.instagram?.result_url || textLinks.find((url) => /instagram\.com/i.test(url)) || "",
    google: distribution.provider_delivery?.google?.permalink || distribution.provider_delivery?.google?.result_url || textLinks.find((url) => /google\./i.test(url)) || "",
  };
  const channels = {};
  channels.website = await verifyEventin(request, token, workspaceId, campaign.business_id, distribution, links.website);
  channels.facebook = await verifyFacebook(request, token, workspaceId, campaign.business_id, distribution, links.facebook);
  for (const channel of ["instagram", "google"]) channels[channel] = await probe(links[channel]);
  const otherLinks = Object.entries(distribution.provider_delivery || {}).filter(([channel]) => !["facebook", "instagram", "google"].includes(channel)).map(([, delivery]) => delivery?.permalink || delivery?.result_url).filter(Boolean);
  channels.other = otherLinks.length ? (await Promise.all(otherLinks.map(probe))).reduce((current, entry) => entry.status === "reachable" ? entry : current, result("unreachable", "Niet alle links bereikbaar")) : result("missing", "Geen links");
  const verification = { checked_at: new Date().toISOString(), checked_by: userData.user.id, channels, links };
  const nextDistribution = { ...distribution, verification };
  const nextMedia = (campaign.media || []).map((entry, index) => index === distributionIndex ? nextDistribution : entry);
  const { error: updateError } = await client.from("social_content_items").update({ media: nextMedia }).eq("id", campaign.id).eq("workspace_id", workspaceId);
  if (updateError) return NextResponse.json({ error: "De controle lukte, maar de uitslag kon niet worden opgeslagen.", channels, checkedAt: verification.checked_at }, { status: 500 });
  return NextResponse.json({ ok: true, channels, checkedAt: verification.checked_at, media: nextMedia });
}
