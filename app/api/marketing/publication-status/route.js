import { NextResponse } from "next/server";
import { createUserSupabase } from "../../../../lib/server-supabase";

function result(status, label, detail = "") { return { status, label, detail }; }

async function probe(url) {
  if (!url || !/^https:\/\//i.test(url)) return result("missing", "Geen link", "Er is geen openbare publicatielink opgeslagen.");
  try {
    const controller = new AbortController(); const timeout = setTimeout(() => controller.abort(), 10000);
    let response = await fetch(url, { method: "HEAD", redirect: "follow", signal: controller.signal, cache: "no-store" });
    if (response.status === 405 || response.status === 403) response = await fetch(url, { method: "GET", redirect: "follow", signal: controller.signal, cache: "no-store" });
    clearTimeout(timeout);
    return response.ok ? result("reachable", "Link bereikbaar", `${response.status} ${response.statusText}`) : result("unreachable", "Link niet bereikbaar", `${response.status} ${response.statusText}`);
  } catch (error) { return result("unreachable", "Controle mislukt", error.name === "AbortError" ? "De controle duurde te lang." : "De link kon niet worden geopend."); }
}

export async function POST(request) {
  let body;
  try { body = await request.json(); } catch { return NextResponse.json({ error: "Ongeldig verzoek." }, { status: 400 }); }
  const token = request.headers.get("authorization")?.replace(/^Bearer\s+/i, ""); const { workspaceId, campaignId } = body || {};
  if (!token || !workspaceId || !campaignId) return NextResponse.json({ error: "Aanmelding, werkruimte en evenement zijn verplicht." }, { status: 400 });
  const client = createUserSupabase(token); const { data: userData } = await client.auth.getUser(token);
  if (!userData?.user) return NextResponse.json({ error: "Aanmelding verlopen." }, { status: 401 });
  const { data: campaign, error: campaignError } = await client.from("social_content_items").select("id,business_id,media").eq("id", campaignId).eq("workspace_id", workspaceId).maybeSingle();
  if (campaignError || !campaign) return NextResponse.json({ error: "Evenement niet gevonden of geen toegang." }, { status: 404 });
  const distributionIndex = (campaign.media || []).findIndex((entry) => entry?.kind === "campaign_distribution"); const distribution = distributionIndex >= 0 ? campaign.media[distributionIndex] : null;
  if (!distribution) return NextResponse.json({ error: "Geen publicatiegegevens gevonden." }, { status: 400 });
  const links = {
    website: distribution.source_url || distribution.common?.cta?.url || "",
    facebook: distribution.facebook_event_delivery?.permalink || distribution.provider_delivery?.facebook?.permalink || distribution.provider_delivery?.facebook?.result_url || "",
    instagram: distribution.provider_delivery?.instagram?.permalink || distribution.provider_delivery?.instagram?.result_url || "",
    google: distribution.provider_delivery?.google?.permalink || distribution.provider_delivery?.google?.result_url || "",
  };
  const channels = {};
  for (const channel of ["website", "facebook", "instagram", "google"]) channels[channel] = await probe(links[channel]);
  const otherLinks = Object.entries(distribution.provider_delivery || {}).filter(([channel]) => !["facebook", "instagram", "google"].includes(channel)).map(([, delivery]) => delivery?.permalink || delivery?.result_url).filter(Boolean);
  channels.other = otherLinks.length ? (await Promise.all(otherLinks.map(probe))).reduce((current, entry) => entry.status === "reachable" ? entry : current, result("unreachable", "Niet alle links bereikbaar")) : result("missing", "Geen links");
  const verification = { checked_at: new Date().toISOString(), checked_by: userData.user.id, channels, links };
  const nextDistribution = { ...distribution, verification };
  const nextMedia = (campaign.media || []).map((entry, index) => index === distributionIndex ? nextDistribution : entry);
  const { error: updateError } = await client.from("social_content_items").update({ media: nextMedia }).eq("id", campaign.id).eq("workspace_id", workspaceId);
  if (updateError) return NextResponse.json({ error: "De controle lukte, maar de uitslag kon niet worden opgeslagen.", channels, checkedAt: verification.checked_at }, { status: 500 });
  return NextResponse.json({ ok: true, channels, checkedAt: verification.checked_at, media: nextMedia });
}
