import { NextResponse } from "next/server";
import { createAdminSupabase, createUserSupabase } from "../../../../lib/server-supabase";
import { createMetaState } from "../../../../lib/meta-oauth";

const SCOPES = ["instagram_business_basic", "instagram_business_manage_comments", "instagram_business_manage_messages", "instagram_business_content_publish"];

export async function GET(request) {
  const context = await authorizedContext(request, new URL(request.url).searchParams.get("workspaceId"));
  if (context.error) return context.error;
  const { data, error } = await context.admin.from("integration_accounts")
    .select("id,business_id,external_account_id,display_name,connection_status,granted_scopes,token_expires_at,last_synced_at,last_error_code")
    .eq("workspace_id", context.workspaceId).eq("provider", "meta").order("display_name");
  return error ? jsonError("Instagram-koppelingen konden niet worden geladen.", 500) : NextResponse.json({ accounts: data || [] });
}

export async function POST(request) {
  let body;
  try { body = await request.json(); } catch { return jsonError("Ongeldig verzoek.", 400); }
  const context = await authorizedContext(request, body.workspaceId, body.businessId);
  if (context.error) return context.error;
  if (!body.businessId) return jsonError("Kies eerst een vestiging.", 400);
  const appId = process.env.META_APP_ID;
  if (!appId) return jsonError("De Meta App ID ontbreekt in de serverconfiguratie.", 409);
  const redirectUri = process.env.META_REDIRECT_URI || `${new URL(request.url).origin}/api/integrations/meta/callback`;
  let state;
  try { state = createMetaState({ workspaceId: context.workspaceId, businessId: body.businessId, userId: context.user.id }); }
  catch (error) { return jsonError(error.message, 409); }
  const authorization = new URL("https://www.instagram.com/oauth/authorize");
  authorization.search = new URLSearchParams({ client_id: appId, redirect_uri: redirectUri, response_type: "code", scope: SCOPES.join(","), state }).toString();
  return NextResponse.json({ authorizationUrl: authorization.toString() });
}

async function authorizedContext(request, workspaceId, businessId = null) {
  const token = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  if (!token || !workspaceId) return { error: jsonError("Niet ingelogd.", 401) };
  const userClient = createUserSupabase(token);
  const { data: authData } = await userClient.auth.getUser(token);
  if (!authData?.user) return { error: jsonError("Sessie is verlopen.", 401) };
  const { data: assignments } = await userClient.from("user_role_assignments")
    .select("business_id,assignment_permissions(permission),role:roles!inner(role_key,role_permissions(permission))")
    .eq("workspace_id", workspaceId).eq("user_id", authData.user.id);
  const allowed = (assignments || []).some((assignment) => {
    if (businessId && assignment.business_id && assignment.business_id !== businessId) return false;
    const permissions = assignment.role?.role_key === "custom" ? assignment.assignment_permissions?.map((item) => item.permission) || [] : assignment.role?.role_permissions?.map((item) => item.permission) || [];
    return assignment.role?.role_key === "owner" || permissions.includes("integrations:manage");
  });
  if (!allowed) return { error: jsonError("Je hebt geen toestemming om deze vestiging te koppelen.", 403) };
  return { admin: createAdminSupabase(), user: authData.user, workspaceId };
}

function jsonError(error, status) { return NextResponse.json({ error }, { status }); }

