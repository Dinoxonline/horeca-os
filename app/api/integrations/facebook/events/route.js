import { NextResponse } from "next/server";
import { createAdminSupabase, createUserSupabase } from "../../../../../lib/server-supabase";
import { decryptMetaToken } from "../../../../../lib/meta-oauth";

const GRAPH_VERSION = "v25.0";
const MAX_EVENTS = 200;

export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const workspaceId = searchParams.get("workspaceId");
  const businessId = searchParams.get("businessId");
  const includePast = searchParams.get("includePast") === "true";

  const context = await authorizedContext(request, workspaceId, businessId);
  if (context.error) return context.error;
  const { admin } = context;

  const { data: account } = await admin.from("integration_accounts")
    .select("id,external_account_id,display_name,granted_scopes")
    .eq("workspace_id", workspaceId)
    .eq("business_id", businessId)
    .eq("provider", "facebook")
    .maybeSingle();
  if (!account) return jsonError("Voor deze vestiging is nog geen Facebookpagina gekoppeld.", 404);
  if (!account.granted_scopes?.includes("pages_read_engagement")) {
    return jsonError("Koppel deze Facebookpagina opnieuw met toestemming om evenementen te lezen.", 409);
  }

  const { data: credential } = await admin.from("integration_credentials")
    .select("token_ciphertext,token_iv,token_tag")
    .eq("account_id", account.id)
    .maybeSingle();
  if (!credential) return jsonError("De beveiligde Facebook-toegang ontbreekt. Koppel de pagina opnieuw.", 409);

  try {
    const accessToken = decryptMetaToken(credential);
    const parameters = {
      fields: "id,name,description,start_time,end_time,place,cover,event_times,ticket_uri",
      limit: "100",
    };
    if (!includePast) parameters.since = String(Math.floor(Date.now() / 1000));
    const rawEvents = await graphGetAll(`${account.external_account_id}/events`, accessToken, parameters, MAX_EVENTS);
    const now = Date.now();
    const events = rawEvents
      .map(normalizeEvent)
      .filter((event) => includePast || !event.endDate || new Date(event.endDate).getTime() >= now)
      .sort((left, right) => new Date(left.startDate || 0) - new Date(right.startDate || 0));

    return NextResponse.json({ ok: true, pageName: account.display_name, events });
  } catch (error) {
    return jsonError(
      `${error.message || "Facebook-evenementen konden niet worden opgehaald."} Controleer in Meta of Horeca OS toegang heeft tot de evenementen van deze pagina.`,
      502,
    );
  }
}

function normalizeEvent(event) {
  const placeParts = [
    event.place?.name,
    event.place?.location?.street,
    event.place?.location?.city,
  ].filter(Boolean);
  return {
    id: String(event.id),
    title: event.name || "Facebook-evenement",
    description: event.description || "",
    startDate: event.start_time || event.event_times?.[0]?.start_time || null,
    endDate: event.end_time || event.event_times?.[0]?.end_time || null,
    location: [...new Set(placeParts)].join(", "),
    image: event.cover?.source || "",
    sourceUrl: `https://www.facebook.com/events/${event.id}/`,
    ticketUrl: event.ticket_uri || "",
    provider: "facebook",
  };
}

async function graphGet(path, accessToken, parameters) {
  const url = new URL(`https://graph.facebook.com/${GRAPH_VERSION}/${path}`);
  url.search = new URLSearchParams({ ...parameters, access_token: accessToken }).toString();
  const response = await fetch(url, { cache: "no-store" });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error?.message || "Facebook heeft het verzoek geweigerd.");
  return result;
}

async function graphGetAll(path, accessToken, parameters, maximum) {
  const items = [];
  let page = await graphGet(path, accessToken, parameters);
  while (page) {
    items.push(...(page.data || []).slice(0, maximum - items.length));
    if (items.length >= maximum || !page.paging?.next) break;
    const response = await fetch(page.paging.next, { cache: "no-store" });
    page = await response.json();
    if (!response.ok) throw new Error(page.error?.message || "Facebook heeft een vervolgpagina geweigerd.");
  }
  return items;
}

async function authorizedContext(request, workspaceId, businessId) {
  const token = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  if (!token || !workspaceId || !businessId) return { error: jsonError("Niet ingelogd of geen vestiging gekozen.", 401) };
  const userClient = createUserSupabase(token);
  const { data: authData } = await userClient.auth.getUser(token);
  if (!authData?.user) return { error: jsonError("Sessie is verlopen.", 401) };
  const { data: assignments } = await userClient.from("user_role_assignments")
    .select("business_id,assignment_permissions(permission),role:roles!inner(role_key,role_permissions(permission))")
    .eq("workspace_id", workspaceId)
    .eq("user_id", authData.user.id);
  const allowed = (assignments || []).some((assignment) => {
    if (assignment.business_id && assignment.business_id !== businessId) return false;
    const permissions = assignment.role?.role_key === "custom"
      ? assignment.assignment_permissions?.map((item) => item.permission) || []
      : assignment.role?.role_permissions?.map((item) => item.permission) || [];
    return assignment.role?.role_key === "owner"
      || permissions.some((permission) => ["marketing:read", "marketing:manage", "social:read", "social:manage", "integrations:read", "integrations:manage"].includes(permission));
  });
  if (!allowed) return { error: jsonError("Je hebt geen toestemming om Facebook-evenementen van deze vestiging te bekijken.", 403) };
  return { admin: createAdminSupabase() };
}

function jsonError(error, status) {
  return NextResponse.json({ error }, { status });
}
