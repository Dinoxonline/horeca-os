import { NextResponse } from "next/server";
import { createUserSupabase } from "../../../../lib/server-supabase";
import { canManageWhatsapp, whatsappConfiguration } from "../../../../lib/whatsapp-business";

export async function GET(request) {
  const url = new URL(request.url);
  const workspaceId = url.searchParams.get("workspaceId");
  const token = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  if (!token || !workspaceId) return jsonError("Niet ingelogd of geen werkruimte gekozen.", 401);

  const client = createUserSupabase(token);
  const { data: authData } = await client.auth.getUser(token);
  if (!authData?.user) return jsonError("Sessie is verlopen.", 401);

  const { data: accounts, error } = await client.from("integration_accounts")
    .select("id,business_id,external_account_id,display_name,account_type,connection_status,granted_scopes,last_synced_at,last_error_code,last_error_at")
    .eq("workspace_id", workspaceId)
    .eq("provider", "whatsapp")
    .order("display_name");

  if (error) return jsonError("WhatsApp-koppelingen konden niet worden geladen.", 500);
  const { data: assignments } = await client.from("user_role_assignments")
    .select("business_id,location_id,assignment_permissions(permission),role:roles!inner(role_key,role_permissions(permission))")
    .eq("workspace_id", workspaceId).eq("user_id", authData.user.id);
  const manageableBusinessIds = [...new Set((assignments || []).map(a => a.business_id).filter(Boolean))]
    .filter(id => canManageWhatsapp(assignments, id));
  return NextResponse.json({
    accounts: accounts || [],
    configuration: { ...whatsappConfiguration(process.env, url.origin), canManageShared: canManageWhatsapp(assignments), manageableBusinessIds },
  }, { headers: { "Cache-Control": "no-store" } });
}

function jsonError(error, status) {
  return NextResponse.json({ error }, { status });
}
