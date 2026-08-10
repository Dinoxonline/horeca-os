import { NextResponse } from "next/server";
import { createUserSupabase } from "../../../../lib/server-supabase";

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
  const missing = [];
  if (!process.env.WHATSAPP_VERIFY_TOKEN) missing.push("WHATSAPP_VERIFY_TOKEN");
  if (!(process.env.WHATSAPP_APP_SECRET || process.env.META_APP_SECRET)) missing.push("WHATSAPP_APP_SECRET");
  const embeddedSignupMissing = [];
  if (!process.env.META_APP_ID) embeddedSignupMissing.push("META_APP_ID");
  if (!process.env.META_APP_SECRET) embeddedSignupMissing.push("META_APP_SECRET");
  if (!process.env.WHATSAPP_CONFIG_ID) embeddedSignupMissing.push("WHATSAPP_CONFIG_ID");
  if (!process.env.META_TOKEN_ENCRYPTION_KEY) embeddedSignupMissing.push("META_TOKEN_ENCRYPTION_KEY");

  return NextResponse.json({
    accounts: accounts || [],
    configuration: {
      ready: missing.length === 0,
      missing,
      webhookUrl: `${url.origin}/api/integrations/whatsapp/webhook`,
      embeddedSignup: {
        ready: embeddedSignupMissing.length === 0,
        missing: embeddedSignupMissing,
        appId: process.env.META_APP_ID || null,
        configId: process.env.WHATSAPP_CONFIG_ID || null,
        redirectUri: process.env.WHATSAPP_REDIRECT_URI || `${url.origin}/koppelingen`,
        connectEndpoint: "/api/integrations/whatsapp/connect",
        featureType: "whatsapp_business_app_onboarding",
        sessionInfoVersion: "3",
      },
    },
  });
}

function jsonError(error, status) {
  return NextResponse.json({ error }, { status });
}
