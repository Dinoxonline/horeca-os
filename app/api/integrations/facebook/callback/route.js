import { NextResponse } from "next/server";
import { createAdminSupabase } from "../../../../../lib/server-supabase";
import { encryptMetaToken, getFacebookConfiguration, readMetaState } from "../../../../../lib/meta-oauth";

const GRAPH_VERSION = "v25.0";
const GRANTED_SCOPES = [
  "pages_show_list",
  "pages_read_engagement",
  "pages_read_user_content",
  "business_management",
];

export async function GET(request) {
  const url = new URL(request.url);
  const destination = new URL("/koppelingen", url.origin);
  try {
    if (url.searchParams.get("error")) throw new Error(url.searchParams.get("error_description") || "Facebook heeft de koppeling geweigerd.");
    const configuration = getFacebookConfiguration();
    if (!configuration.ready) throw new Error(`De Facebook-koppeling mist serverinstellingen: ${configuration.missing.join(", ")}.`);
    const code = url.searchParams.get("code");
    const state = readMetaState(url.searchParams.get("state"));
    if (!code || state.connection !== "facebook") throw new Error("Facebook heeft geen geldige autorisatiecode teruggestuurd.");

    const redirectUri = `${url.origin}/api/integrations/facebook/callback`;
    const tokenUrl = new URL(`https://graph.facebook.com/${GRAPH_VERSION}/oauth/access_token`);
    tokenUrl.search = new URLSearchParams({
      client_id: process.env.META_APP_ID,
      client_secret: process.env.META_APP_SECRET,
      redirect_uri: redirectUri,
      code,
    }).toString();
    const tokenResponse = await fetch(tokenUrl, { cache: "no-store" });
    const tokenResult = await tokenResponse.json();
    if (!tokenResponse.ok || !tokenResult.access_token) throw new Error(tokenResult.error?.message || "Facebook-token kon niet worden opgehaald.");

    const longTokenUrl = new URL(`https://graph.facebook.com/${GRAPH_VERSION}/oauth/access_token`);
    longTokenUrl.search = new URLSearchParams({
      grant_type: "fb_exchange_token",
      client_id: process.env.META_APP_ID,
      client_secret: process.env.META_APP_SECRET,
      fb_exchange_token: tokenResult.access_token,
    }).toString();
    const longResponse = await fetch(longTokenUrl, { cache: "no-store" });
    const longResult = await longResponse.json();
    const userToken = longResponse.ok && longResult.access_token ? longResult.access_token : tokenResult.access_token;
    const expiresIn = Number(longResult.expires_in || tokenResult.expires_in || 3600);

    const admin = createAdminSupabase();
    const { data: instagramAccount } = await admin.from("integration_accounts")
      .select("external_account_id").eq("workspace_id", state.workspaceId).eq("business_id", state.businessId)
      .eq("provider", "meta").maybeSingle();
    if (!instagramAccount) throw new Error("Koppel voor deze vestiging eerst het juiste Instagram-profiel.");

    const pagesUrl = new URL(`https://graph.facebook.com/${GRAPH_VERSION}/me/accounts`);
    pagesUrl.search = new URLSearchParams({
      fields: "id,name,access_token,tasks,instagram_business_account{id}",
      limit: "100",
      access_token: userToken,
    }).toString();
    const pagesResponse = await fetch(pagesUrl, { cache: "no-store" });
    const pagesResult = await pagesResponse.json();
    if (!pagesResponse.ok) throw new Error(pagesResult.error?.message || "Facebookpagina's konden niet worden gelezen.");
    const availablePages = pagesResult.data || [];
    const page = availablePages.find((item) => String(item.instagram_business_account?.id || "") === String(instagramAccount.external_account_id))
      || (availablePages.length === 1 ? availablePages[0] : null);
    if (!page?.id || !page?.access_token) throw new Error("Geen Facebookpagina gevonden die bij het gekoppelde Instagram-profiel hoort.");

    const tokenExpiresAt = new Date(Date.now() + expiresIn * 1000).toISOString();
    const accountPayload = {
      workspace_id: state.workspaceId,
      business_id: state.businessId,
      provider: "facebook",
      external_account_id: String(page.id),
      display_name: page.name || "Facebookpagina",
      account_type: "facebook_page",
      connection_status: "connected",
      granted_scopes: GRANTED_SCOPES,
      credential_secret_name: `facebook/${state.workspaceId}/${state.businessId}`,
      token_expires_at: tokenExpiresAt,
      last_error_code: null,
      last_error_at: null,
    };
    const { data: existingAccount } = await admin.from("integration_accounts").select("id")
      .eq("workspace_id", state.workspaceId).eq("business_id", state.businessId).eq("provider", "facebook").maybeSingle();
    const accountQuery = existingAccount
      ? admin.from("integration_accounts").update(accountPayload).eq("id", existingAccount.id)
      : admin.from("integration_accounts").insert(accountPayload);
    const { data: account, error: accountError } = await accountQuery.select("id").single();
    if (accountError) throw new Error("De Facebookpagina kon niet aan de vestiging worden gekoppeld.");

    const encrypted = encryptMetaToken(page.access_token);
    const { error: credentialError } = await admin.from("integration_credentials").upsert({
      account_id: account.id,
      workspace_id: state.workspaceId,
      business_id: state.businessId,
      token_ciphertext: encrypted.ciphertext,
      token_iv: encrypted.iv,
      token_tag: encrypted.tag,
      token_expires_at: tokenExpiresAt,
    }, { onConflict: "account_id" });
    if (credentialError) throw new Error("Het Facebook-token kon niet veilig worden opgeslagen.");

    destination.searchParams.set("facebook", "connected");
    destination.searchParams.set("account", page.name || "Facebookpagina");
  } catch (error) {
    destination.searchParams.set("facebook", "error");
    destination.searchParams.set("message", error.message || "Facebook kon niet worden gekoppeld.");
  }
  return NextResponse.redirect(destination);
}

