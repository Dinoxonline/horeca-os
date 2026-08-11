import { NextResponse } from "next/server";
import { createAdminSupabase, createUserSupabase } from "../../../../../lib/server-supabase";
import { encryptMetaToken } from "../../../../../lib/meta-oauth";

const GRAPH_VERSION = "v25.0";
const REQUIRED_PERMISSIONS = ["whatsapp_business_management", "whatsapp_business_messaging"];

export async function POST(request) {
  let body;
  try { body = await request.json(); } catch { return jsonError("Ongeldig verzoek.", 400); }

  const token = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  const workspaceId = String(body.workspaceId || "");
  const businessId = String(body.businessId || "");
  const code = String(body.code || "");
  const wabaId = String(body.wabaId || body.waba_id || "");
  const requestedPhoneId = String(body.phoneNumberId || body.phone_number_id || "");

  if (!token || !workspaceId || !businessId) return jsonError("Niet ingelogd of geen vestiging gekozen.", 401);
  if (!code || !wabaId) return jsonError("WhatsApp heeft geen volledige koppelgegevens teruggestuurd.", 400);

  const configuration = getConfiguration();
  if (!configuration.ready) return jsonError(`De WhatsApp-koppeling mist serverinstellingen: ${configuration.missing.join(", ")}.`, 503);

  const client = createUserSupabase(token);
  const { data: authData } = await client.auth.getUser(token);
  if (!authData?.user) return jsonError("Sessie is verlopen.", 401);

  const { data: assignments } = await client.from("user_role_assignments")
    .select("business_id,assignment_permissions(permission),role:roles!inner(role_key,role_permissions(permission))")
    .eq("workspace_id", workspaceId).eq("user_id", authData.user.id);
  const allowed = (assignments || []).some((assignment) => {
    if (assignment.business_id && assignment.business_id !== businessId) return false;
    const permissions = assignment.role?.role_key === "custom"
      ? assignment.assignment_permissions?.map((entry) => entry.permission) || []
      : assignment.role?.role_permissions?.map((entry) => entry.permission) || [];
    return assignment.role?.role_key === "owner" || permissions.includes("social:manage");
  });
  if (!allowed) return jsonError("Je hebt geen toestemming om WhatsApp voor deze vestiging te koppelen.", 403);

  try {
    const redirectUri = process.env.WHATSAPP_REDIRECT_URI || `${new URL(request.url).origin}/koppelingen`;
    const tokenUrl = new URL(`https://graph.facebook.com/${GRAPH_VERSION}/oauth/access_token`);
    tokenUrl.search = new URLSearchParams({
      client_id: process.env.META_APP_ID,
      client_secret: process.env.META_APP_SECRET,
      redirect_uri: redirectUri,
      code,
    }).toString();
    const tokenResponse = await fetch(tokenUrl, { cache: "no-store" });
    const tokenResult = await tokenResponse.json();
    if (!tokenResponse.ok || !tokenResult.access_token) {
      throw new Error(tokenResult.error?.message || "Het WhatsApp-toegangstoken kon niet worden opgehaald.");
    }

    const accessToken = tokenResult.access_token;
    const permissionsResponse = await fetch(
      `https://graph.facebook.com/${GRAPH_VERSION}/me/permissions?access_token=${encodeURIComponent(accessToken)}`,
      { cache: "no-store" },
    );
    const permissionsResult = await permissionsResponse.json();
    if (!permissionsResponse.ok) throw new Error(permissionsResult.error?.message || "De WhatsApp-rechten konden niet worden gecontroleerd.");
    const grantedScopes = (permissionsResult.data || [])
      .filter((item) => item.status === "granted")
      .map((item) => item.permission);
    const missingPermissions = REQUIRED_PERMISSIONS.filter((permission) => !grantedScopes.includes(permission));
    if (missingPermissions.length) throw new Error(`Meta heeft deze WhatsApp-rechten nog niet toegekend: ${missingPermissions.join(", ")}.`);

    const wabaUrl = new URL(`https://graph.facebook.com/${GRAPH_VERSION}/${encodeURIComponent(wabaId)}`);
    wabaUrl.searchParams.set("fields", "id,name,phone_numbers{id,display_phone_number,verified_name,is_on_biz_app,code_verification_status,status}");
    wabaUrl.searchParams.set("access_token", accessToken);
    const wabaResponse = await fetch(wabaUrl, { cache: "no-store" });
    const waba = await wabaResponse.json();
    if (!wabaResponse.ok) throw new Error(waba.error?.message || "Het WhatsApp Business-account kon niet worden gelezen.");

    const phones = waba.phone_numbers?.data || [];
    const phone = requestedPhoneId
      ? phones.find((entry) => String(entry.id) === requestedPhoneId)
      : phones.length === 1 ? phones[0] : phones.find((entry) => entry.is_on_biz_app);
    if (!phone?.id) throw new Error("Meta heeft geen uniek WhatsApp-telefoonnummer teruggestuurd.");
    if (phone.is_on_biz_app !== true) {
      throw new Error("Deze route accepteert uitsluitend WhatsApp Business App-coexistence. Het mobiele nummer is niet gewijzigd.");
    }

    const subscribeResponse = await fetch(
      `https://graph.facebook.com/${GRAPH_VERSION}/${encodeURIComponent(wabaId)}/subscribed_apps`,
      { method: "POST", headers: { authorization: `Bearer ${accessToken}` }, cache: "no-store" },
    );
    const subscribeResult = await subscribeResponse.json();
    if (!subscribeResponse.ok || subscribeResult.success !== true) {
      throw new Error(subscribeResult.error?.message || "Horeca OS kon niet op WhatsApp-berichten worden geabonneerd.");
    }

    const admin = createAdminSupabase();
    const tokenExpiresAt = tokenResult.expires_in
      ? new Date(Date.now() + Number(tokenResult.expires_in) * 1000).toISOString()
      : null;
    const accountPayload = {
      workspace_id: workspaceId,
      business_id: businessId,
      provider: "whatsapp",
      external_account_id: String(phone.id),
      display_name: phone.display_phone_number || phone.verified_name || waba.name || "WhatsApp Business",
      account_type: "whatsapp_business_app_coexistence",
      connection_status: "connected",
      granted_scopes: REQUIRED_PERMISSIONS,
      credential_secret_name: `whatsapp/${workspaceId}/${businessId}`,
      token_expires_at: tokenExpiresAt,
      last_error_code: null,
      last_error_at: null,
    };

    const { data: existing, error: lookupError } = await admin.from("integration_accounts")
      .select("id").eq("workspace_id", workspaceId).eq("business_id", businessId)
      .eq("provider", "whatsapp").maybeSingle();
    if (lookupError) throw new Error("De bestaande WhatsApp-koppeling kon niet worden gecontroleerd.");

    const accountQuery = existing
      ? admin.from("integration_accounts").update(accountPayload).eq("id", existing.id)
      : admin.from("integration_accounts").insert(accountPayload);
    const { data: account, error: accountError } = await accountQuery.select("id").single();
    if (accountError) throw new Error("Het WhatsAppnummer kon niet aan de vestiging worden gekoppeld.");

    const encrypted = encryptMetaToken(accessToken);
    const { error: credentialError } = await admin.from("integration_credentials").upsert({
      account_id: account.id,
      workspace_id: workspaceId,
      business_id: businessId,
      token_ciphertext: encrypted.ciphertext,
      token_iv: encrypted.iv,
      token_tag: encrypted.tag,
      token_expires_at: tokenExpiresAt,
    }, { onConflict: "account_id" });
    if (credentialError) throw new Error("Het WhatsApp-token kon niet veilig worden opgeslagen.");

    return NextResponse.json({
      ok: true,
      account: {
        id: account.id,
        displayName: accountPayload.display_name,
        phoneNumberId: String(phone.id),
        wabaId: String(wabaId),
        coexistence: true,
      },
    });
  } catch (error) {
    return jsonError(error.message || "WhatsApp kon niet veilig worden gekoppeld.", 502);
  }
}

function getConfiguration() {
  const required = ["META_APP_ID", "META_APP_SECRET", "META_TOKEN_ENCRYPTION_KEY"];
  const missing = required.filter((name) => !process.env[name]);
  return { ready: missing.length === 0, missing };
}

function jsonError(error, status) {
  return NextResponse.json({ error }, { status });
}
