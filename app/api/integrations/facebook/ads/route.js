import { NextResponse } from "next/server";
import { createAdminSupabase, createUserSupabase } from "../../../../../lib/server-supabase";
import { decryptMetaToken } from "../../../../../lib/meta-oauth";
import { defaultMetaCampaign, validateMetaCampaign, metaTargeting, metaStorySpec, META_OBJECTIVES } from "../../../../../lib/meta-campaign-settings";
import { normalizeMetaAccountBudget } from "../../../../../lib/meta-account-budget";

const GRAPH_VERSION = "v25.0";

async function graphRead(path, token, values = {}) {
  const url = new URL(`https://graph.facebook.com/${GRAPH_VERSION}/${path}`);
  url.search = new URLSearchParams(values).toString();
  const response = await fetch(url, { headers: { Authorization: `Bearer ${token}` }, cache: "no-store", signal: AbortSignal.timeout(20000) });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error?.error_user_msg || result.error?.message || "Meta kon de gegevens niet controleren.");
  return result;
}

async function accountCredential(admin, workspaceId, businessId, id) {
  const { data, error } = await admin.from("integration_credentials").select("token_ciphertext,token_iv,token_tag")
    .eq("account_id", id).eq("workspace_id", workspaceId).eq("business_id", businessId).maybeSingle();
  if (error || !data) throw new Error("De beveiligde advertentietoegang ontbreekt. Koppel Meta opnieuw.");
  return decryptMetaToken(data);
}

async function searchOptions(resource, q, country, token) {
  const values = resource === "locations"
    ? { type: "adgeolocation", location_types: JSON.stringify(["city"]), q, country_code: country, limit: "25" }
    : { type: "adinterest", q, limit: "25" };
  const result = await graphRead("search", token, values);
  return (result.data || []).map(item => resource === "locations"
    ? { key: String(item.key || ""), name: item.name, region: item.region || "", country: item.country_code || item.country || country }
    : { id: String(item.id || ""), name: item.name })
    .filter(item => item.name && (resource === "locations" ? item.key : /^\d+$/.test(item.id)));
}

export async function GET(request) {
  const params = new URL(request.url).searchParams;
  const workspaceId = params.get("workspaceId"), businessId = params.get("businessId");
  const context = await authorizedContext(request, workspaceId, businessId);
  if (context.error) return context.error;
  const resource = params.get("resource"), q = String(params.get("q") || "").trim(), country = params.get("country") || "NL";
  if (resource !== "budget" && (!["locations", "interests"].includes(resource) || q.length < 2 || q.length > 100 || !/^[A-Z]{2}$/.test(country))) return jsonError("Vul minimaal twee letters in om te zoeken.", 400);
  const { data: account } = await context.admin.from("integration_accounts").select("id,external_account_id,granted_scopes,connection_status")
    .eq("workspace_id", workspaceId).eq("business_id", businessId).eq("provider", "facebook_ads").maybeSingle();
  if (account?.connection_status !== "connected" || !account.granted_scopes?.includes("ads_management")) return jsonError("Koppel eerst het advertentieaccount van deze vestiging.", 409);
  try {
    const token = await accountCredential(context.admin, workspaceId, businessId, account.id);
    if (resource === "budget") {
      const id = String(account.external_account_id || "").replace(/^act_/, "");
      if (!/^\d+$/.test(id)) return jsonError("Het gekoppelde advertentieaccount heeft geen geldig nummer.", 409);
      const [accountResult, paymentResult] = await Promise.allSettled([
        graphRead("act_" + id, token, { fields: "name,currency,account_status,spend_cap,amount_spent,balance,timezone_name,is_prepay_account" }),
        graphRead("act_" + id, token, { fields: "funding_source_details,business_name" }),
      ]);
      if (accountResult.status !== "fulfilled") throw accountResult.reason;
      return NextResponse.json({
        budget: normalizeMetaAccountBudget(accountResult.value, paymentResult.status === "fulfilled" ? paymentResult.value : {}, id),
        paymentWarning: paymentResult.status === "rejected" ? "Meta geeft de betaalmethode en bedrijfsnaam niet vrij via deze koppeling. Bekijk deze in Meta." : null,
      }, { headers: { "Cache-Control": "private, no-store" } });
    }
    return NextResponse.json({ options: await searchOptions(resource, q, country, token) });
  } catch (error) { return jsonError(error.message, 502); }
}

export async function POST(request) {
  let body;
  try { body = await request.json(); } catch { return jsonError("Ongeldig verzoek.", 400); }
  const { workspaceId, businessId, campaignId } = body || {};
  const context = await authorizedContext(request, workspaceId, businessId);
  if (context.error) return context.error;
  const { admin } = context;
  if (!campaignId) return jsonError("Het Horeca OS-campagnedossier ontbreekt.", 400);
  const [{ data: adAccount }, { data: pageAccount }, { data: campaign }] = await Promise.all([
    admin.from("integration_accounts").select("id,external_account_id,display_name,granted_scopes,connection_status")
      .eq("workspace_id", workspaceId).eq("business_id", businessId).eq("provider", "facebook_ads").maybeSingle(),
    admin.from("integration_accounts").select("external_account_id,display_name")
      .eq("workspace_id", workspaceId).eq("business_id", businessId).eq("provider", "facebook").maybeSingle(),
    admin.from("social_content_items").select("id,body,media").eq("id", campaignId)
      .eq("workspace_id", workspaceId).eq("business_id", businessId).maybeSingle(),
  ]);
  if (!adAccount) return jsonError("Koppel eerst het Meta-advertentieaccount van deze vestiging.", 409);
  if (adAccount.connection_status !== "connected") return jsonError("Kies en bevestig eerst het advertentieaccount bij Koppelingen.", 409);
  if (!adAccount.granted_scopes?.includes("ads_management")) return jsonError("Koppel Meta opnieuw met toestemming voor betaalde campagnes.", 409);
  if (!pageAccount) return jsonError("De Facebookpagina van deze vestiging is niet gekoppeld.", 409);
  if (!campaign) return jsonError("Het campagneconcept is niet gevonden.", 404);
  const distribution = (campaign.media || []).find(entry => entry?.kind === "campaign_distribution");
  if (!distribution) return jsonError("De campagnegegevens ontbreken.", 409);
  if (["active", "paused"].includes(distribution.facebook_paid_campaign?.status)) return NextResponse.json({ ok: true, alreadyActive: true, paidCampaign: distribution.facebook_paid_campaign });
  // Defaults keep older campaign forms compatible. v2 sends all editable fields.
  const incoming = body.settings || {};
  const settings = { ...defaultMetaCampaign(campaign, distribution), ...incoming };
  if (incoming.editorVersion !== 2) {
    settings.objective = incoming.objective === "engagement" ? "engagement" : "traffic";
    settings.callToAction = incoming.callToAction === "tickets" ? "tickets" : "learn_more";
    settings.placements = incoming.placements || "automatic";
    settings.placementFormat = "automatic";
  }
  const validation = validateMetaCampaign(settings);
  if (validation) return jsonError(validation, 400);

  let createdCampaignId = null;
  try {
    const token = await accountCredential(admin, workspaceId, businessId, adAccount.id);
    const adAccountId = String(adAccount.external_account_id).startsWith("act_") ? String(adAccount.external_account_id) : `act_${adAccount.external_account_id}`;
    // Resolve currency, location and Instagram identity BEFORE creating anything.
    const [accountInfo, pageInfo, locations] = await Promise.all([
      graphRead(adAccountId, token, { fields: "currency" }),
      settings.placements !== "facebook" ? graphRead(pageAccount.external_account_id, token, { fields: "instagram_business_account{id,username}" }) : Promise.resolve({}),
      settings.locationQuery?.trim() ? searchOptions("locations", settings.locationQuery.trim(), settings.countries[0], token) : Promise.resolve([]),
    ]);
    if (accountInfo.currency !== "EUR") throw new Error("Deze editor gebruikt euro's. Gebruik Meta Ads Manager voor een advertentieaccount met een andere valuta.");
    const instagram = pageInfo.instagram_business_account;
    if (["both", "instagram"].includes(settings.placements) && !instagram?.id) throw new Error("Meta geeft geen gekoppeld Instagram-profiel voor deze Facebookpagina terug. Kies alleen Facebook of controleer de paginakoppeling in Meta.");
    let city;
    if (settings.locationQuery?.trim()) {
      const matches = settings.locationKey ? locations.filter(item => item.key === String(settings.locationKey))
        : locations.filter(item => item.name.toLocaleLowerCase() === settings.locationQuery.trim().toLocaleLowerCase());
      if (matches.length !== 1) throw new Error("Zoek de plaats opnieuw en kies de juiste stad uit de Meta-resultaten.");
      city = matches[0];
    }
    const objective = META_OBJECTIVES[settings.objective];
    // Horeca OS only prepares paused campaigns, regardless of a supplied status.
    const status = "PAUSED";
    const targeting = metaTargeting(settings, city);
    const campaignResult = await graphPost(`${adAccountId}/campaigns`, token, {
      name: settings.campaignName.trim(), objective: objective.api, status, special_ad_categories: JSON.stringify([]),
    });
    createdCampaignId = String(campaignResult.id);
    const budget = { [settings.budgetType === "lifetime" ? "lifetime_budget" : "daily_budget"]: String(Math.round(Number(settings.dailyBudget) * 100)) };
    const adSetResult = await graphPost(`${adAccountId}/adsets`, token, {
      name: `${settings.campaignName} · doelgroep`, campaign_id: campaignResult.id, ...budget,
      billing_event: "IMPRESSIONS", optimization_goal: objective.optimization, bid_strategy: "LOWEST_COST_WITHOUT_CAP",
      start_time: new Date(settings.startAt).toISOString(), end_time: new Date(settings.endAt).toISOString(),
      targeting: JSON.stringify(targeting), status,
    });
    const creativeResult = await graphPost(`${adAccountId}/adcreatives`, token, {
      name: `${settings.campaignName} · advertentie`,
      object_story_spec: JSON.stringify(metaStorySpec(settings, pageAccount.external_account_id, instagram?.id)),
    });
    const adResult = await graphPost(`${adAccountId}/ads`, token, {
      name: `${settings.campaignName} · advertentie`, adset_id: adSetResult.id, creative: JSON.stringify({ creative_id: creativeResult.id }), status,
    });
    const paidCampaign = {
      status: "paused", campaign_id: createdCampaignId, adset_id: String(adSetResult.id), ad_id: String(adResult.id),
      ad_account_id: adAccountId, ad_account_name: adAccount.display_name, name: settings.campaignName, objective: settings.objective,
      budget_type: settings.budgetType, budget: Number(settings.dailyBudget), daily_budget: settings.budgetType === "daily" ? Number(settings.dailyBudget) : null,
      start_at: new Date(settings.startAt).toISOString(), end_at: new Date(settings.endAt).toISOString(),
      age_min: Number(settings.ageMin), age_max: Number(settings.ageMax), countries: settings.countries,
      location_query: city?.name || "", location_key: city?.key || "", radius_km: Number(settings.radiusKm), gender: settings.gender,
      placements: settings.placements, placement_format: settings.placementFormat, interests: settings.interests,
      call_to_action: settings.callToAction, launch_status: "paused", primary_text: settings.primaryText,
      headline: settings.headline, description: settings.description, image_url: settings.imageUrl, destination_url: settings.destinationUrl,
      page_id: pageAccount.external_account_id, instagram_user_id: instagram?.id || null, started_at: new Date().toISOString(),
      manage_url: `https://www.facebook.com/adsmanager/manage/campaigns?act=${adAccountId.replace(/^act_/, "")}&selected_campaign_ids=${campaignResult.id}`,
    };
    const nextMedia = (campaign.media || []).map(entry => entry?.kind === "campaign_distribution" ? { ...entry, facebook_paid_campaign: paidCampaign } : entry);
    const { error: updateError } = await admin.from("social_content_items").update({ media: nextMedia })
      .eq("id", campaign.id).eq("workspace_id", workspaceId).eq("business_id", businessId);
    if (updateError) throw new Error("Het gepauzeerde concept is gemaakt, maar kon niet in Horeca OS worden bevestigd.");
    return NextResponse.json({ ok: true, paidCampaign });
  } catch (error) {
    const suffix = createdCampaignId ? ` Er staat mogelijk een gedeeltelijk, gepauzeerd concept in Meta (campagne ${createdCampaignId}). Controleer dit vóór opnieuw proberen.` : "";
    return jsonError((error.message || "Meta heeft het concept geweigerd.") + suffix, 502);
  }
}

async function graphPost(path, accessToken, values) {
  const response = await fetch(`https://graph.facebook.com/${GRAPH_VERSION}/${path}`, {
    method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded", Authorization: `Bearer ${accessToken}` },
    body: new URLSearchParams(values), cache: "no-store", signal: AbortSignal.timeout(30000),
  });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error?.error_user_msg || result.error?.message || "Meta heeft de advertentie geweigerd.");
  return result;
}

async function authorizedContext(request, workspaceId, businessId) {
  const token = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  if (!token || !workspaceId || !businessId) return { error: jsonError("Niet ingelogd of geen vestiging gekozen.", 401) };
  const userClient = createUserSupabase(token);
  const { data: authData } = await userClient.auth.getUser(token);
  if (!authData?.user) return { error: jsonError("Sessie is verlopen.", 401) };
  const { data: assignments } = await userClient.from("user_role_assignments")
    .select("business_id,assignment_permissions(permission),role:roles!inner(role_key,role_permissions(permission))")
    .eq("workspace_id", workspaceId).eq("user_id", authData.user.id);
  const allowed = (assignments || []).some((assignment) => {
    if (assignment.business_id && assignment.business_id !== businessId) return false;
    const permissions = assignment.role?.role_key === "custom" ? assignment.assignment_permissions?.map((item) => item.permission) || [] : assignment.role?.role_permissions?.map((item) => item.permission) || [];
    return assignment.role?.role_key === "owner" || permissions.includes("marketing:manage") || permissions.includes("social:manage");
  });
  return allowed ? { admin: createAdminSupabase() } : { error: jsonError("Je hebt geen toestemming om advertentiebudget uit te geven.", 403) };
}

function jsonError(error, status) { return NextResponse.json({ error }, { status }); }
