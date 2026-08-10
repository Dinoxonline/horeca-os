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

  const { data: business } = await context.admin.from("businesses")
    .select("id,name").eq("workspace_id", workspaceId).eq("id", businessId).maybeSingle();
  if (!business) return jsonError("Vestiging hoort niet bij deze werkruimte.", 400);

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
      const result = await brevo("/contacts/lists?limit=50&offset=0&sort=desc", apiKey);
      const lists = (result.lists || []).filter((item) => listIds.includes(Number(item.id)));
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
