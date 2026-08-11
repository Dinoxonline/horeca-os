import { NextResponse } from "next/server";
import { createAdminSupabase, createUserSupabase } from "../../../../../lib/server-supabase";
import { decryptMetaToken } from "../../../../../lib/meta-oauth";

export async function POST(request) {
  let body;
  try { body = await request.json(); } catch { return jsonError("Ongeldig verzoek.", 400); }

  const token = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  if (!token || !body.workspaceId || !body.businessId) return jsonError("Niet ingelogd of geen vestiging gekozen.", 401);

  const userClient = createUserSupabase(token);
  const { data: authData } = await userClient.auth.getUser(token);
  if (!authData?.user) return jsonError("Sessie is verlopen.", 401);

  const { data: assignments } = await userClient.from("user_role_assignments")
    .select("business_id,assignment_permissions(permission),role:roles!inner(role_key,role_permissions(permission))")
    .eq("workspace_id", body.workspaceId).eq("user_id", authData.user.id);
  const allowed = (assignments || []).some((assignment) => {
    if (assignment.business_id && assignment.business_id !== body.businessId) return false;
    const permissions = assignment.role?.role_key === "custom"
      ? assignment.assignment_permissions?.map((item) => item.permission) || []
      : assignment.role?.role_permissions?.map((item) => item.permission) || [];
    return assignment.role?.role_key === "owner" || permissions.includes("integrations:manage");
  });
  if (!allowed) return jsonError("Je hebt geen toestemming om deze koppeling te testen.", 403);

  const admin = createAdminSupabase();
  const { data: account } = await admin.from("integration_accounts")
    .select("id,external_account_id,display_name")
    .eq("workspace_id", body.workspaceId).eq("business_id", body.businessId).eq("provider", "meta").maybeSingle();
  if (!account) return jsonError("Voor deze vestiging is nog geen Instagram-profiel gekoppeld.", 404);

  const { data: credential } = await admin.from("integration_credentials")
    .select("token_ciphertext,token_iv,token_tag,token_expires_at")
    .eq("account_id", account.id).maybeSingle();
  if (!credential) return jsonError("De beveiligde Instagram-toegang ontbreekt. Koppel het profiel opnieuw.", 409);

  try {
    const accessToken = decryptMetaToken(credential);
    const response = await fetch(`https://graph.instagram.com/me?fields=user_id,username&access_token=${encodeURIComponent(accessToken)}`, { cache: "no-store" });
    const profile = await response.json();
    const externalId = String(profile.user_id || profile.id || "");
    if (!response.ok || !externalId || !profile.username) throw new Error(profile.error?.message || "Instagram heeft het profiel niet bevestigd.");
    if (externalId !== account.external_account_id) throw new Error("Instagram gaf een ander profiel terug dan aan deze vestiging is gekoppeld.");

    const checkedAt = new Date().toISOString();
    await admin.from("integration_accounts").update({
      display_name: profile.username,
      connection_status: "connected",
      last_synced_at: checkedAt,
      last_error_code: null,
      last_error_at: null,
    }).eq("id", account.id);
    return NextResponse.json({ ok: true, checkedAt, username: profile.username, message: `@${profile.username} is bereikbaar en hoort bij de juiste vestiging.` });
  } catch (error) {
    await admin.from("integration_accounts").update({
      connection_status: "degraded",
      last_error_code: "instagram_profile_verification_failed",
      last_error_at: new Date().toISOString(),
    }).eq("id", account.id);
    return jsonError(error.message || "De Instagram-verbinding kon niet worden gecontroleerd.", 502);
  }
}

function jsonError(error, status) { return NextResponse.json({ error }, { status }); }

