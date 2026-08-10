import { NextResponse } from "next/server";
import { createAdminSupabase, createUserSupabase } from "../../../../lib/server-supabase";

const BREVO_BASE_URL = "https://api.brevo.com/v3";
const LOCATION_LIST_ENV = {
  "caribbean corner": "BREVO_CARIBBEAN_CORNER_LIST_IDS",
  "grandcafe het plein": "BREVO_GRANDCAFE_HET_PLEIN_LIST_IDS",
};

export async function GET(request) {
  const workspaceId = request.nextUrl.searchParams.get("workspaceId");
  const businessId = request.nextUrl.searchParams.get("businessId");
  const resource = request.nextUrl.searchParams.get("resource") || "status";
  const context = await requireIntegrationManager(request, workspaceId, businessId);
  if (context.error) return context.error;
  if (!businessId) return jsonError("Kies eerst een vestiging.", 400);

  const business = await getBusiness(context.admin, workspaceId, businessId);
  if (!business) return jsonError("Vestiging hoort niet bij deze werkruimte.", 400);

  if (resource === "drafts") {
    const { data, error } = await context.admin.from("brevo_campaign_drafts")
      .select("id,business_id,list_id,list_name,recipient_count,internal_name,sender_name,subject,body,status,approval_requested_at,approval_requested_by,created_at,updated_at")
      .eq("workspace_id", workspaceId).eq("business_id", businessId)
      .order("updated_at", { ascending: false }).limit(100);
    if (error) return jsonError("De campagneconcepten konden niet worden geladen.", 500);
    return NextResponse.json({ ok: true, business, drafts: data || [] });
  }

  const apiKey = process.env.BREVO_API_KEY?.trim();
  if (!apiKey) return jsonError("Brevo is nog niet geconfigureerd op de server.", 503);

  const listIds = configuredListIds(business.name);
  if (resource !== "status" && listIds.length === 0) {
    return jsonError(`Brevo-lijsten voor ${business.name} zijn nog niet toegewezen.`, 409);
  }

  try {
    if (resource === "status") {
      const account = await brevo("/account", apiKey);
      return NextResponse.json({
        ok: true,
        business: { id: business.id, name: business.name },
        configured: listIds.length > 0,
        listIds,
        account: { email: account.email || null, companyName: account.companyName || null },
      });
    }

    if (resource === "lists") {
      const lists = await getConfiguredLists(apiKey, listIds);
      return NextResponse.json({ ok: true, business, lists });
    }

    if (resource === "campaigns") {
      const result = await brevo("/emailCampaigns?status=sent&limit=50&offset=0&sort=desc", apiKey);
      const campaigns = (result.campaigns || []).filter((campaign) => {
        const recipients = campaign.recipients || {};
        const campaignListIds = [...(recipients.listIds || []), ...(recipients.exclusionListIds || [])].map(Number);
        return campaignListIds.some((id) => listIds.includes(id));
      }).map((campaign) => ({
        id: campaign.id,
        name: campaign.name,
        subject: campaign.subject,
        sentDate: campaign.sentDate || null,
        scheduledAt: campaign.scheduledAt || null,
        status: campaign.status,
        statistics: campaign.statistics?.globalStats || null,
      }));
      return NextResponse.json({ ok: true, business, campaigns });
    }

    return jsonError("Onbekende Brevo-opvraag.", 400);
  } catch (error) {
    const status = error.status === 401 || error.status === 403 ? error.status : 502;
    return jsonError(error.message || "Brevo kon niet worden bereikt.", status);
  }
}

export async function POST(request) {
  return saveDraft(request, null);
}

export async function PATCH(request) {
  const body = await request.json().catch(() => null);
  if (!body?.id) return jsonError("Kies eerst een concept om bij te werken.", 400);
  if (body.action === "request_approval") return requestApproval(request, body);
  return saveDraft(request, body.id, body);
}

async function saveDraft(request, draftId, suppliedBody = null) {
  const body = suppliedBody || await request.json().catch(() => null);
  const workspaceId = clean(body?.workspaceId, 100);
  const businessId = clean(body?.businessId, 100);
  const context = await requireIntegrationManager(request, workspaceId, businessId);
  if (context.error) return context.error;
  if (!businessId) return jsonError("Kies eerst een vestiging.", 400);

  const business = await getBusiness(context.admin, workspaceId, businessId);
  if (!business) return jsonError("Vestiging hoort niet bij deze werkruimte.", 400);

  const apiKey = process.env.BREVO_API_KEY?.trim();
  if (!apiKey) return jsonError("Brevo is nog niet geconfigureerd op de server.", 503);
  const listIds = configuredListIds(business.name);
  if (!listIds.length) return jsonError(`Brevo-lijsten voor ${business.name} zijn nog niet toegewezen.`, 409);

  const listId = Number(body?.listId);
  if (!Number.isInteger(listId) || !listIds.includes(listId)) {
    return jsonError("De gekozen Brevo-doelgroep hoort niet bij deze vestiging.", 400);
  }

  const internalName = clean(body?.campaignName, 200);
  const senderName = clean(body?.senderName, 200);
  const subject = clean(body?.subject, 300);
  const content = clean(body?.content, 50000);
  if (!internalName || !senderName || !subject || !content) {
    return jsonError("Vul campagnenaam, afzender, onderwerp en bericht volledig in.", 400);
  }

  try {
    const lists = await getConfiguredLists(apiKey, listIds);
    const list = lists.find((item) => Number(item.id) === listId);
    if (!list) return jsonError("De gekozen Brevo-doelgroep bestaat niet meer.", 409);
    const record = {
      workspace_id: workspaceId,
      business_id: businessId,
      list_id: listId,
      list_name: list.name,
      recipient_count: Number(list.totalSubscribers || list.uniqueSubscribers || 0),
      internal_name: internalName,
      sender_name: senderName,
      subject,
      body: content,
      status: "draft",
      approval_requested_at: null,
      approval_requested_by: null,
      updated_by: context.user.id,
      updated_at: new Date().toISOString(),
    };

    let query;
    if (draftId) {
      query = context.admin.from("brevo_campaign_drafts").update(record)
        .eq("id", draftId).eq("workspace_id", workspaceId).eq("business_id", businessId)
        .select("id,business_id,list_id,list_name,recipient_count,internal_name,sender_name,subject,body,status,approval_requested_at,approval_requested_by,created_at,updated_at")
        .maybeSingle();
    } else {
      query = context.admin.from("brevo_campaign_drafts").insert({
        ...record,
        created_by: context.user.id,
      }).select("id,business_id,list_id,list_name,recipient_count,internal_name,sender_name,subject,body,status,approval_requested_at,approval_requested_by,created_at,updated_at").single();
    }
    const { data, error } = await query;
    if (error || !data) return jsonError(draftId ? "Het concept kon niet worden bijgewerkt." : "Het concept kon niet worden opgeslagen.", 500);
    return NextResponse.json({ ok: true, business, draft: data });
  } catch (error) {
    const status = error.status === 401 || error.status === 403 ? error.status : 502;
    return jsonError(error.message || "Brevo kon de doelgroep niet controleren.", status);
  }
}

async function requestApproval(request, body) {
  const workspaceId = clean(body?.workspaceId, 100);
  const businessId = clean(body?.businessId, 100);
  const draftId = clean(body?.id, 100);
  const confirmationName = clean(body?.confirmationName, 200);
  const context = await requireIntegrationManager(request, workspaceId, businessId);
  if (context.error) return context.error;
  if (!businessId || !draftId) return jsonError("Kies eerst een geldig campagneconcept.", 400);
  if (body?.confirmed !== true) return jsonError("Bevestig eerst de doelgroep en het aantal ontvangers.", 400);

  const business = await getBusiness(context.admin, workspaceId, businessId);
  if (!business) return jsonError("Vestiging hoort niet bij deze werkruimte.", 400);

  const { data: draft } = await context.admin.from("brevo_campaign_drafts")
    .select("id,list_id,internal_name,status")
    .eq("id", draftId).eq("workspace_id", workspaceId).eq("business_id", businessId).maybeSingle();
  if (!draft) return jsonError("Het campagneconcept bestaat niet meer.", 404);
  if (confirmationName !== draft.internal_name) {
    return jsonError("De ingevoerde campagnenaam komt niet exact overeen.", 400);
  }

  const apiKey = process.env.BREVO_API_KEY?.trim();
  if (!apiKey) return jsonError("Brevo is nog niet geconfigureerd op de server.", 503);
  const listIds = configuredListIds(business.name);
  if (!listIds.includes(Number(draft.list_id))) {
    return jsonError("De doelgroep hoort niet meer bij deze vestiging.", 409);
  }

  try {
    const lists = await getConfiguredLists(apiKey, listIds);
    const list = lists.find((item) => Number(item.id) === Number(draft.list_id));
    if (!list) return jsonError("De gekozen Brevo-doelgroep bestaat niet meer.", 409);
    const now = new Date().toISOString();
    const { data, error } = await context.admin.from("brevo_campaign_drafts").update({
      list_name: list.name,
      recipient_count: Number(list.totalSubscribers || list.uniqueSubscribers || 0),
      status: "ready_for_approval",
      approval_requested_at: now,
      approval_requested_by: context.user.id,
      updated_by: context.user.id,
      updated_at: now,
    }).eq("id", draftId).eq("workspace_id", workspaceId).eq("business_id", businessId)
      .select("id,business_id,list_id,list_name,recipient_count,internal_name,sender_name,subject,body,status,approval_requested_at,approval_requested_by,created_at,updated_at")
      .maybeSingle();
    if (error || !data) return jsonError("Het concept kon niet worden klaargezet voor goedkeuring.", 500);
    return NextResponse.json({
      ok: true,
      business,
      draft: data,
      message: "Klaargezet voor definitieve goedkeuring. Er is niets verzonden.",
    });
  } catch (error) {
    const status = error.status === 401 || error.status === 403 ? error.status : 502;
    return jsonError(error.message || "Brevo kon de doelgroep niet opnieuw controleren.", status);
  }
}

async function getBusiness(admin, workspaceId, businessId) {
  const { data } = await admin.from("businesses")
    .select("id,name").eq("workspace_id", workspaceId).eq("id", businessId).maybeSingle();
  return data || null;
}

async function getConfiguredLists(apiKey, listIds) {
  const result = await brevo("/contacts/lists?limit=50&offset=0&sort=desc", apiKey);
  return (result.lists || []).filter((item) => listIds.includes(Number(item.id)));
}

function clean(value, maxLength) {
  return String(value || "").trim().slice(0, maxLength);
}

function configuredListIds(businessName) {
  const normalized = String(businessName || "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  const key = Object.keys(LOCATION_LIST_ENV).find((name) => normalized.includes(name));
  if (!key) return [];
  return String(process.env[LOCATION_LIST_ENV[key]] || "")
    .split(",").map((value) => Number(value.trim())).filter(Number.isInteger);
}

async function brevo(path, apiKey) {
  const response = await fetch(`${BREVO_BASE_URL}${path}`, {
    headers: { Accept: "application/json", "api-key": apiKey },
    cache: "no-store",
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(response.status === 401
      ? "De Brevo-sleutel is ongeldig of verlopen."
      : response.status === 403
        ? "Brevo blokkeert deze server. Controleer de toegestane IP-adressen."
        : "Brevo kon de gegevens niet leveren.");
    error.status = response.status;
    throw error;
  }
  return result;
}

async function requireIntegrationManager(request, workspaceId, businessId) {
  const token = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  if (!token || !workspaceId) return { error: jsonError("Niet ingelogd.", 401) };
  const userClient = createUserSupabase(token);
  const { data: authData } = await userClient.auth.getUser(token);
  if (!authData?.user) return { error: jsonError("Sessie is verlopen.", 401) };
  if (verifiedTokenAal(token) !== "aal2") return { error: jsonError("Bevestig eerst je tweestapsverificatie.", 403) };

  const { data: assignments } = await userClient.from("user_role_assignments")
    .select("business_id,assignment_permissions(permission),role:roles!inner(role_key,role_permissions(permission))")
    .eq("workspace_id", workspaceId).eq("user_id", authData.user.id);
  const allowed = (assignments || []).some((assignment) => {
    if (businessId && assignment.business_id && assignment.business_id !== businessId) return false;
    const permissions = assignment.role?.role_key === "custom"
      ? assignment.assignment_permissions?.map((item) => item.permission) || []
      : assignment.role?.role_permissions?.map((item) => item.permission) || [];
    return assignment.role?.role_key === "owner" || permissions.includes("integrations:manage");
  });
  return allowed
    ? { admin: createAdminSupabase(), user: authData.user, workspaceId }
    : { error: jsonError("Geen toegang tot Brevo-beheer voor deze vestiging.", 403) };
}

function verifiedTokenAal(token) {
  try {
    const payload = token.split(".")[1];
    return payload ? JSON.parse(Buffer.from(payload, "base64url").toString("utf8")).aal || null : null;
  } catch { return null; }
}
function jsonError(error, status) { return NextResponse.json({ error }, { status }); }
