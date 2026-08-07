import { NextResponse } from "next/server";
import { createAdminSupabase } from "../../../../../lib/server-supabase";
import { encryptMetaToken, readMetaState } from "../../../../../lib/meta-oauth";

export async function GET(request) {
  const url = new URL(request.url);
  const destination = new URL("/koppelingen", url.origin);
  try {
    if (url.searchParams.get("error")) throw new Error(url.searchParams.get("error_description") || "Instagram heeft de koppeling geweigerd.");
    const code = url.searchParams.get("code");
    const state = readMetaState(url.searchParams.get("state"));
    if (!code) throw new Error("Instagram heeft geen autorisatiecode teruggestuurd.");
    const redirectUri = process.env.META_REDIRECT_URI || `${url.origin}/api/integrations/meta/callback`;
    const shortTokenResponse = await fetch("https://api.instagram.com/oauth/access_token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ client_id: process.env.INSTAGRAM_APP_ID || process.env.META_APP_ID || "", client_secret: process.env.INSTAGRAM_APP_SECRET || process.env.META_APP_SECRET || "", grant_type: "authorization_code", redirect_uri: redirectUri, code }),
      cache: "no-store",
    });
    const shortToken = await shortTokenResponse.json();
    if (!shortTokenResponse.ok || !shortToken.access_token) throw new Error(shortToken.error_message || "Instagram-token kon niet worden opgehaald.");
    const longUrl = new URL("https://graph.instagram.com/access_token");
    longUrl.search = new URLSearchParams({ grant_type: "ig_exchange_token", client_secret: process.env.INSTAGRAM_APP_SECRET || process.env.META_APP_SECRET || "", access_token: shortToken.access_token }).toString();
    const longResponse = await fetch(longUrl, { cache: "no-store" });
    const longToken = await longResponse.json();
    const accessToken = longResponse.ok && longToken.access_token ? longToken.access_token : shortToken.access_token;
    const expiresIn = Number(longToken.expires_in || 3600);
    const profileResponse = await fetch(`https://graph.instagram.com/me?fields=user_id,username&access_token=${encodeURIComponent(accessToken)}`, { cache: "no-store" });
    const profile = await profileResponse.json();
    if (!profileResponse.ok || !(profile.user_id || profile.id) || !profile.username) throw new Error(profile.error?.message || "Instagram-profiel kon niet worden gelezen.");

    const admin = createAdminSupabase();
    const externalId = String(profile.user_id || profile.id);
    const tokenExpiresAt = new Date(Date.now() + expiresIn * 1000).toISOString();
    const accountPayload = {
      workspace_id: state.workspaceId, business_id: state.businessId, provider: "meta", external_account_id: externalId,
      display_name: profile.username, account_type: "instagram_business", connection_status: "connected",
      granted_scopes: ["instagram_business_basic", "instagram_business_manage_comments", "instagram_business_manage_messages", "instagram_business_content_publish"],
      credential_secret_name: `meta/${state.workspaceId}/${state.businessId}`, token_expires_at: tokenExpiresAt, last_error_code: null, last_error_at: null,
    };
    const { data: existingAccount } = await admin.from("integration_accounts").select("id")
      .eq("workspace_id", state.workspaceId).eq("business_id", state.businessId).eq("provider", "meta").maybeSingle();
    const accountQuery = existingAccount
      ? admin.from("integration_accounts").update(accountPayload).eq("id", existingAccount.id)
      : admin.from("integration_accounts").insert(accountPayload);
    const { data: account, error: accountError } = await accountQuery.select("id").single();
    if (accountError) throw new Error("Het Instagram-profiel kon niet aan de vestiging worden gekoppeld.");
    const encrypted = encryptMetaToken(accessToken);
    const { error: credentialError } = await admin.from("integration_credentials").upsert({
      account_id: account.id, workspace_id: state.workspaceId, business_id: state.businessId,
      token_ciphertext: encrypted.ciphertext, token_iv: encrypted.iv, token_tag: encrypted.tag, token_expires_at: tokenExpiresAt,
    }, { onConflict: "account_id" });
    if (credentialError) throw new Error("Het Instagram-token kon niet veilig worden opgeslagen.");
    destination.searchParams.set("meta", "connected");
    destination.searchParams.set("account", profile.username);
  } catch (error) {
    destination.searchParams.set("meta", "error");
    destination.searchParams.set("message", error.message || "Instagram kon niet worden gekoppeld.");
  }
  return NextResponse.redirect(destination);
}

