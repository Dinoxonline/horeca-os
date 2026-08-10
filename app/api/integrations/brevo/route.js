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
      .select("id,business_id,list_id,list_name,list_ids,list_names,recipient_count,internal_name,sender_name,subject,body,status,approval_requested_at,approval_requested_by,brevo_campaign_id,sent_at,sent_by,created_at,updated_at")
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
  if (body.action === "send_campaign") return sendCampaign(request, body);
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

  const requestedListIds = [...new Set((Array.isArray(body?.listIds) ? body.listIds : [body?.listId])
    .map(Number).filter(Number.isInteger))];
  if (!requestedListIds.length || requestedListIds.some((id) => !listIds.includes(id))) {
    return jsonError("Een of meer gekozen Brevo-doelgroepen horen niet bij deze vestiging.", 400);
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
    const selectedLists = lists.filter((item) => requestedListIds.includes(Number(item.id)));
    if (selectedLists.length !== requestedListIds.length) return jsonError("Een of meer gekozen Brevo-doelgroepen bestaan niet meer.", 409);
    const record = {
      workspace_id: workspaceId,
      business_id: businessId,
      list_id: requestedListIds[0],
      list_name: selectedLists.map((item) => item.name).join(", "),
      list_ids: requestedListIds,
      list_names: selectedLists.map((item) => item.name),
      recipient_count: selectedLists.reduce((total, item) => total + Number(item.totalSubscribers || item.uniqueSubscribers || 0), 0),
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
        .select("id,business_id,list_id,list_name,list_ids,list_names,recipient_count,internal_name,sender_name,subject,body,status,approval_requested_at,approval_requested_by,brevo_campaign_id,sent_at,sent_by,created_at,updated_at")
        .maybeSingle();
    } else {
      query = context.admin.from("brevo_campaign_drafts").insert({
        ...record,
        created_by: context.user.id,
      }).select("id,business_id,list_id,list_name,list_ids,list_names,recipient_count,internal_name,sender_name,subject,body,status,approval_requested_at,approval_requested_by,brevo_campaign_id,sent_at,sent_by,created_at,updated_at").single();
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
    .select("id,list_id,list_ids,internal_name,status,sender_name,subject,body")
    .eq("id", draftId).eq("workspace_id", workspaceId).eq("business_id", businessId).maybeSingle();
  if (!draft) return jsonError("Het campagneconcept bestaat niet meer.", 404);
  if (confirmationName !== draft.internal_name) {
    return jsonError("De ingevoerde campagnenaam komt niet exact overeen.", 400);
  }

  const apiKey = process.env.BREVO_API_KEY?.trim();
  if (!apiKey) return jsonError("Brevo is nog niet geconfigureerd op de server.", 503);
  const listIds = configuredListIds(business.name);
  const draftListIds = (draft.list_ids?.length ? draft.list_ids : [draft.list_id]).map(Number);
  if (!draftListIds.length || draftListIds.some((id) => !listIds.includes(id))) {
    return jsonError("Een of meer doelgroepen horen niet meer bij deze vestiging.", 409);
  }

  try {
    const lists = await getConfiguredLists(apiKey, listIds);
    const selectedLists = lists.filter((item) => draftListIds.includes(Number(item.id)));
    if (selectedLists.length !== draftListIds.length) return jsonError("Een of meer gekozen Brevo-doelgroepen bestaan niet meer.", 409);
    const now = new Date().toISOString();
    const { data, error } = await context.admin.from("brevo_campaign_drafts").update({
      list_name: selectedLists.map((item) => item.name).join(", "),
      list_ids: draftListIds,
      list_names: selectedLists.map((item) => item.name),
      recipient_count: selectedLists.reduce((total, item) => total + Number(item.totalSubscribers || item.uniqueSubscribers || 0), 0),
      status: "ready_for_approval",
      approval_requested_at: now,
      approval_requested_by: context.user.id,
      updated_by: context.user.id,
      updated_at: now,
    }).eq("id", draftId).eq("workspace_id", workspaceId).eq("business_id", businessId)
      .select("id,business_id,list_id,list_name,list_ids,list_names,recipient_count,internal_name,sender_name,subject,body,status,approval_requested_at,approval_requested_by,brevo_campaign_id,sent_at,sent_by,created_at,updated_at")
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


async function sendCampaign(request, body) {
  const workspaceId = clean(body?.workspaceId, 100);
  const businessId = clean(body?.businessId, 100);
  const draftId = clean(body?.id, 100);
  const confirmationText = clean(body?.confirmationText, 300);
  const context = await requireIntegrationManager(request, workspaceId, businessId);
  if (context.error) return context.error;
  if (!businessId || !draftId) return jsonError("Kies eerst een geldige goedgekeurde campagne.", 400);
  if (body?.confirmed !== true) return jsonError("Bevestig eerst dat je de campagne nu wilt verzenden.", 400);

  const business = await getBusiness(context.admin, workspaceId, businessId);
  if (!business) return jsonError("Vestiging hoort niet bij deze werkruimte.", 400);
  const { data: draft } = await context.admin.from("brevo_campaign_drafts")
    .select("id,business_id,list_id,list_name,list_ids,list_names,recipient_count,internal_name,sender_name,subject,body,status,approval_requested_at,approval_requested_by,brevo_campaign_id,sent_at,sent_by,created_at,updated_at")
    .eq("id", draftId).eq("workspace_id", workspaceId).eq("business_id", businessId).maybeSingle();
  if (!draft) return jsonError("Het campagneconcept bestaat niet meer.", 404);
  if (draft.status !== "ready_for_approval") return jsonError("Deze campagne is niet klaar voor definitieve verzending.", 409);
  if (confirmationText !== `VERZEND ${draft.internal_name}`) {
    return jsonError("De verzendbevestiging komt niet exact overeen.", 400);
  }

  const apiKey = process.env.BREVO_API_KEY?.trim();
  if (!apiKey) return jsonError("Brevo is nog niet geconfigureerd op de server.", 503);
  const senderEmail = configuredSenderEmail(business.name);
  if (!senderEmail) return jsonError("Stel eerst het goedgekeurde Brevo-afzenderadres voor deze vestiging in.", 503);
  const allowedListIds = configuredListIds(business.name);
  const draftListIds = (draft.list_ids?.length ? draft.list_ids : [draft.list_id]).map(Number);
  if (!draftListIds.length || draftListIds.some((id) => !allowedListIds.includes(id))) {
    return jsonError("Een of meer doelgroepen horen niet meer bij deze vestiging.", 409);
  }

  try {
    const lists = await getConfiguredLists(apiKey, allowedListIds);
    const selectedLists = lists.filter((item) => draftListIds.includes(Number(item.id)));
    if (selectedLists.length !== draftListIds.length) return jsonError("Een of meer gekozen Brevo-doelgroepen bestaan niet meer.", 409);
    const recipientCount = selectedLists.reduce((total, item) => total + Number(item.totalSubscribers || item.uniqueSubscribers || 0), 0);
    const now = new Date().toISOString();
    const { data: locked } = await context.admin.from("brevo_campaign_drafts").update({
      status: "sending",
      list_name: selectedLists.map((item) => item.name).join(", "),
      list_ids: draftListIds,
      list_names: selectedLists.map((item) => item.name),
      recipient_count: recipientCount,
      updated_by: context.user.id,
      updated_at: now,
    }).eq("id", draftId).eq("workspace_id", workspaceId).eq("business_id", businessId)
      .eq("status", "ready_for_approval").select("id").maybeSingle();
    if (!locked) return jsonError("De campagne wordt al verzonden of is inmiddels gewijzigd.", 409);

    let campaign;
    try {
      campaign = await brevo("/emailCampaigns", apiKey, {
        method: "POST",
        body: {
          name: draft.internal_name,
          subject: draft.subject,
          sender: { name: draft.sender_name, email: senderEmail },
          recipients: { listIds: draftListIds },
          htmlContent: textToSafeHtml(draft.body),
        },
      });
      await brevo(`/emailCampaigns/${campaign.id}/sendNow`, apiKey, { method: "POST" });
    } catch (error) {
      await context.admin.from("brevo_campaign_drafts").update({
        status: "send_failed",
        brevo_campaign_id: campaign?.id || null,
        updated_by: context.user.id,
        updated_at: new Date().toISOString(),
      }).eq("id", draftId).eq("workspace_id", workspaceId).eq("business_id", businessId);
      throw error;
    }

    const sentAt = new Date().toISOString();
    const { data: sent, error } = await context.admin.from("brevo_campaign_drafts").update({
      status: "sent",
      brevo_campaign_id: campaign.id,
      sent_at: sentAt,
      sent_by: context.user.id,
      updated_by: context.user.id,
      updated_at: sentAt,
    }).eq("id", draftId).eq("workspace_id", workspaceId).eq("business_id", businessId)
      .select("id,business_id,list_id,list_name,list_ids,list_names,recipient_count,internal_name,sender_name,subject,body,status,approval_requested_at,approval_requested_by,brevo_campaign_id,sent_at,sent_by,created_at,updated_at").maybeSingle();
    if (error || !sent) return jsonError("De campagne is verzonden, maar de bevestiging kon niet worden opgeslagen.", 500);
    return NextResponse.json({ ok: true, business, draft: sent, message: `Campagne verzonden naar maximaal ${recipientCount} contacten. Brevo verwijdert dubbele adressen.` });
  } catch (error) {
    const status = error.status === 401 || error.status === 403 ? error.status : 502;
    return jsonError(error.message || "Brevo kon de campagne niet verzenden.", status);
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

function configuredSenderEmail(businessName) {
  const normalized = String(businessName || "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  if (normalized.includes("caribbean corner")) return process.env.BREVO_CARIBBEAN_CORNER_SENDER_EMAIL?.trim() || process.env.BREVO_SENDER_EMAIL?.trim() || "";
  if (normalized.includes("grandcafe het plein")) return process.env.BREVO_GRANDCAFE_HET_PLEIN_SENDER_EMAIL?.trim() || process.env.BREVO_SENDER_EMAIL?.trim() || "";
  return process.env.BREVO_SENDER_EMAIL?.trim() || "";
}

function textToSafeHtml(value) {
  const escaped = String(value || "").replace(/[&<>"']/g, (character) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;",
  }[character]));
  return `<div style="font-family:Arial,sans-serif;white-space:pre-wrap">${escaped}</div>`;
}

function configuredListIds(businessName) {
  const normalized = String(businessName || "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  const key = Object.keys(LOCATION_LIST_ENV).find((name) => normalized.includes(name));
  if (!key) return [];
  return String(process.env[LOCATION_LIST_ENV[key]] || "")
    .split(",").map((value) => Number(value.trim())).filter(Number.isInteger);
}

async function brevo(path, apiKey, options = {}) {
  const response = await fetch(`${BREVO_BASE_URL}${path}`, {
    method: options.method || "GET",
    headers: { Accept: "application/json", "Content-Type": "application/json", "api-key": apiKey },
    body: options.body ? JSON.stringify(options.body) : undefined,
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
