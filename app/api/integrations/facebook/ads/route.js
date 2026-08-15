import { NextResponse } from "next/server";
import { createAdminSupabase, createUserSupabase } from "../../../../../lib/server-supabase";
import { decryptMetaToken } from "../../../../../lib/meta-oauth";

const GRAPH_VERSION = "v25.0";

export async function POST(request) {
  let body;
  try { body = await request.json(); } catch { return jsonError("Ongeldig verzoek.", 400); }
  const { workspaceId, businessId, campaignId, settings } = body || {};
  const context = await authorizedContext(request, workspaceId, businessId);
  if (context.error) return context.error;
  const { admin } = context;
  if (!campaignId) return jsonError("Het Horeca OS-campagnedossier ontbreekt.", 400);

  const [{ data: adAccount }, { data: pageAccount }, { data: campaign }] = await Promise.all([
    admin.from("integration_accounts").select("id,external_account_id,display_name,granted_scopes")
      .eq("workspace_id", workspaceId).eq("business_id", businessId).eq("provider", "facebook_ads").maybeSingle(),
    admin.from("integration_accounts").select("external_account_id,display_name")
      .eq("workspace_id", workspaceId).eq("business_id", businessId).eq("provider", "facebook").maybeSingle(),
    admin.from("social_content_items").select("id,media").eq("id", campaignId)
      .eq("workspace_id", workspaceId).eq("business_id", businessId).maybeSingle(),
  ]);
  if (!adAccount) return jsonError("Koppel eerst het Meta-advertentieaccount van deze vestiging.", 409);
  if (!adAccount.granted_scopes?.includes("ads_management")) return jsonError("Koppel Meta opnieuw met toestemming voor betaalde campagnes.", 409);
  if (!pageAccount) return jsonError("De Facebookpagina van deze vestiging is niet gekoppeld.", 409);
  if (!campaign) return jsonError("Het campagneconcept is niet gevonden.", 404);
  const distribution = (campaign.media || []).find((entry) => entry?.kind === "campaign_distribution");
  if (!distribution) return jsonError("De campagnegegevens ontbreken.", 409);
  if (["active", "paused"].includes(distribution.facebook_paid_campaign?.status)) {
    return NextResponse.json({ ok: true, alreadyActive: true, paidCampaign: distribution.facebook_paid_campaign });
  }
  if (distribution.facebook_event_delivery?.status !== "confirmed") return jsonError("Plaats en koppel eerst het Facebook-evenement.", 409);
  const link = distribution.source_url || distribution.common?.website_url;
  if (!link) return jsonError("De Eventin-ticketlink ontbreekt.", 409);

  const budgetEuros = Number(settings?.dailyBudget || 0);
  const budgetType = settings?.budgetType === "lifetime" ? "lifetime" : "daily";
  const startTime = new Date(settings?.startAt || "");
  const endTime = new Date(settings?.endAt || "");
  const ageMin = Math.max(18, Number(settings?.ageMin || 18));
  const ageMax = Math.min(65, Number(settings?.ageMax || 65));
  const countries = Array.isArray(settings?.countries) && settings.countries.length ? settings.countries : ["NL"];
  const gender = settings?.gender === "men" ? [1] : settings?.gender === "women" ? [2] : [];
  const status = settings?.launchStatus === "active" ? "ACTIVE" : "PAUSED";
  const placements = settings?.placements === "facebook" ? ["facebook"] : [];
  if (!Number.isFinite(budgetEuros) || budgetEuros < 2) return jsonError("Kies een budget van minimaal € 2,00.", 400);
  if (Number.isNaN(startTime.getTime()) || startTime < new Date(Date.now() - 60000)) return jsonError("Kies een geldige startdatum.", 400);
  if (Number.isNaN(endTime.getTime()) || endTime <= startTime) return jsonError("De einddatum moet na de startdatum liggen.", 400);
  if (ageMax < ageMin) return jsonError("De maximumleeftijd moet gelijk aan of hoger dan de minimumleeftijd zijn.", 400);

  const { data: credential } = await admin.from("integration_credentials")
    .select("token_ciphertext,token_iv,token_tag").eq("account_id", adAccount.id).maybeSingle();
  if (!credential) return jsonError("De beveiligde toegang tot het advertentieaccount ontbreekt. Koppel Meta opnieuw.", 409);

  try {
    const token = decryptMetaToken(credential);
    const adAccountId = String(adAccount.external_account_id).startsWith("act_")
      ? String(adAccount.external_account_id) : `act_${adAccount.external_account_id}`;
    const title = distribution.common?.title || "Evenement";
    const campaignName = String(settings?.campaignName || `${title} · ${adAccount.display_name}`).trim();
    const message = distribution.channel_payloads?.facebook?.text || distribution.common?.short_description || distribution.common?.description || title;
    const picture = distribution.common?.images?.landscape?.url || distribution.channel_payloads?.facebook?.image_url || distribution.common?.image_url || "";
    const objective = settings?.objective === "engagement" ? "OUTCOME_ENGAGEMENT" : "OUTCOME_TRAFFIC";
    const campaignResult = await graphPost(`${adAccountId}/campaigns`, token, {
      name: campaignName,
      objective,
      status,
      special_ad_categories: JSON.stringify([]),
    });
    let geoLocations = { countries };
    const locationQuery = String(settings?.locationQuery || "").trim();
    if (locationQuery) {
      const location = await graphSearchLocation(locationQuery, countries[0], token);
      if (!location) throw new Error(`Meta kon de doelgroepplaats “${locationQuery}” niet vinden.`);
      geoLocations = { custom_locations: [{ key: location.key, radius: Math.max(1, Math.min(80, Number(settings?.radiusKm || 25))), distance_unit: "kilometer" }] };
    }
    const targeting = { age_min: ageMin, age_max: ageMax, geo_locations: geoLocations };
    if (gender.length) targeting.genders = gender;
    if (placements.length) targeting.publisher_platforms = placements;
    const adSetBudget = budgetType === "lifetime"
      ? { lifetime_budget: String(Math.round(budgetEuros * 100)) }
      : { daily_budget: String(Math.round(budgetEuros * 100)) };
    const adSetResult = await graphPost(`${adAccountId}/adsets`, token, {
      name: `${title} · doelgroep`, campaign_id: campaignResult.id,
      ...adSetBudget, billing_event: "IMPRESSIONS",
      optimization_goal: objective === "OUTCOME_ENGAGEMENT" ? "POST_ENGAGEMENT" : "LINK_CLICKS",
      bid_strategy: "LOWEST_COST_WITHOUT_CAP", start_time: startTime.toISOString(), end_time: endTime.toISOString(),
      targeting: JSON.stringify(targeting),
      status,
    });
    const creativeResult = await graphPost(`${adAccountId}/adcreatives`, token, {
      name: `${title} · advertentie`,
      object_story_spec: JSON.stringify({ page_id: pageAccount.external_account_id, link_data: {
        link, message, name: title, ...(picture ? { picture } : {}),
        call_to_action: { type: settings?.callToAction === "tickets" ? "GET_TICKETS" : "LEARN_MORE", value: { link } },
      } }),
    });
    const adResult = await graphPost(`${adAccountId}/ads`, token, {
      name: `${title} · advertentie`, adset_id: adSetResult.id,
      creative: JSON.stringify({ creative_id: creativeResult.id }), status,
    });
    const paidCampaign = {
      status: status === "ACTIVE" ? "active" : "paused", campaign_id: String(campaignResult.id), adset_id: String(adSetResult.id), ad_id: String(adResult.id),
      ad_account_id: adAccountId, ad_account_name: adAccount.display_name, name: campaignName, objective: settings?.objective || "tickets",
      budget_type: budgetType, budget: budgetEuros, daily_budget: budgetType === "daily" ? budgetEuros : null,
      start_at: startTime.toISOString(), end_at: endTime.toISOString(), age_min: ageMin, age_max: ageMax,
      countries, location_query: locationQuery, radius_km: Number(settings?.radiusKm || 25), gender: settings?.gender || "all", placements: settings?.placements || "automatic",
      call_to_action: settings?.callToAction || "tickets", launch_status: status.toLowerCase(),
      started_at: new Date().toISOString(),
      manage_url: `https://www.facebook.com/adsmanager/manage/campaigns?act=${adAccountId.replace(/^act_/, "")}&selected_campaign_ids=${campaignResult.id}`,
    };
    const nextDistribution = { ...distribution, facebook_paid_campaign: paidCampaign };
    const nextMedia = (campaign.media || []).map((entry) => entry?.kind === "campaign_distribution" ? nextDistribution : entry);
    const { error: updateError } = await admin.from("social_content_items").update({ media: nextMedia })
      .eq("id", campaign.id).eq("workspace_id", workspaceId).eq("business_id", businessId);
    if (updateError) throw new Error("De campagne is gestart, maar de bevestiging kon niet in Horeca OS worden opgeslagen.");
    return NextResponse.json({ ok: true, paidCampaign });
  } catch (error) {
    return jsonError(error.message || "Meta heeft de betaalde campagne geweigerd.", 502);
  }
}

async function graphPost(path, accessToken, values) {
  const response = await fetch(`https://graph.facebook.com/${GRAPH_VERSION}/${path}`, {
    method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ ...values, access_token: accessToken }), cache: "no-store",
  });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error?.error_user_msg || result.error?.message || "Meta heeft de advertentie geweigerd.");
  return result;
}

async function graphSearchLocation(query, countryCode, accessToken) {
  const url = new URL(`https://graph.facebook.com/${GRAPH_VERSION}/search`);
  url.search = new URLSearchParams({ type: "adgeolocation", location_types: JSON.stringify(["city"]), q: query, country_code: countryCode, access_token: accessToken }).toString();
  const response = await fetch(url, { cache: "no-store" });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error?.message || "Meta kon de doelgroepplaats niet controleren.");
  return result.data?.[0] || null;
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
