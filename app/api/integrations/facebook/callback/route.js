import { NextResponse } from "next/server";
import { createAdminSupabase } from "../../../../../lib/server-supabase";
import { encryptMetaToken, getFacebookConfiguration, readMetaState } from "../../../../../lib/meta-oauth";

const GRAPH_VERSION = "v25.0";
const SUPPORTED_SCOPES = [
  "pages_show_list",
  "pages_read_engagement",
  "pages_read_user_content",
  "pages_manage_engagement",
  "pages_manage_posts",
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

    const permissionsUrl = new URL(`https://graph.facebook.com/${GRAPH_VERSION}/me/permissions`);
    permissionsUrl.searchParams.set("access_token", userToken);
    const permissionsResponse = await fetch(permissionsUrl, { cache: "no-store" });
    const permissionsResult = await permissionsResponse.json();
    if (!permissionsResponse.ok) throw new Error(permissionsResult.error?.message || "De toegekende Facebook-rechten konden niet worden gecontroleerd.");
    const grantedScopes = (permissionsResult.data || [])
      .filter((item) => item.status === "granted" && SUPPORTED_SCOPES.includes(item.permission))
      .map((item) => item.permission);
    if (!grantedScopes.includes("pages_manage_engagement")) {
      throw new Error("Facebook heeft het recht om op reacties te antwoorden nog niet toegekend.");
    }
    if (!grantedScopes.includes("pages_manage_posts")) {
      throw new Error("Facebook heeft het recht om berichten te publiceren nog niet toegekend.");
    }

    const admin = createAdminSupabase();
    const [
      { data: instagramAccount, error: instagramLookupError },
      { data: existingAccount, error: facebookLookupError },
    ] = await Promise.all([
      admin.from("integration_accounts")
        .select("external_account_id").eq("workspace_id", state.workspaceId).eq("business_id", state.businessId)
        .eq("provider", "meta").maybeSingle(),
      admin.from("integration_accounts")
        .select("id,external_account_id,display_name").eq("workspace_id", state.workspaceId).eq("business_id", state.businessId)
        .eq("provider", "facebook").maybeSingle(),
    ]);
    if (instagramLookupError) throw new Error("Het gekoppelde Instagram-profiel kon niet worden gecontroleerd.");
    if (facebookLookupError) {
      console.error("Facebook account lookup failed", {
        code: facebookLookupError.code,
        message: facebookLookupError.message,
        details: facebookLookupError.details,
        hint: facebookLookupError.hint,
      });
      throw new Error("De bestaande Facebook-koppeling kon niet worden gecontroleerd.");
    }
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
    const page = availablePages.find((item) =>
      String(item.instagram_business_account?.id || "") === String(instagramAccount.external_account_id)
      || (existingAccount?.external_account_id && String(item.id) === String(existingAccount.external_account_id))
    );
    if (!page?.id || !page?.access_token) {
      const availableNames = availablePages.map((item) => item.name).filter(Boolean).join(", ");
      const expectedName = existingAccount?.display_name || "de Facebookpagina van deze vestiging";
      throw new Error(availableNames
        ? `Meta geeft alleen toegang tot: ${availableNames}. Geef Horeca OS ook toegang tot ${expectedName} en probeer opnieuw.`
        : `Meta geeft geen toegang tot ${expectedName}. Controleer de paginatoegang in Meta Business en probeer opnieuw.`);
    }

    const tokenExpiresAt = new Date(Date.now() + expiresIn * 1000).toISOString();
    const accountPayload = {
      workspace_id: state.workspaceId,
      business_id: state.businessId,
      provider: "facebook",
      external_account_id: String(page.id),
      display_name: page.name || "Facebookpagina",
      account_type: "facebook_page",
      connection_status: "connected",
      granted_scopes: grantedScopes,
      credential_secret_name: `facebook/${state.workspaceId}/${state.businessId}`,
      token_expires_at: tokenExpiresAt,
      last_error_code: null,
      last_error_at: null,
    };

    let account;
    if (existingAccount) {
      const { error: updateError } = await admin.from("integration_accounts")
        .update(accountPayload)
        .eq("id", existingAccount.id);
      if (updateError) {
        console.error("Facebook account update failed", {
          code: updateError.code,
          message: updateError.message,
          details: updateError.details,
          hint: updateError.hint,
        });
        throw new Error("De Facebookpagina kon niet aan de vestiging worden gekoppeld.");
      }
      account = existingAccount;
    } else {
      const { data: insertedAccount, error: insertError } = await admin.from("integration_accounts")
        .insert(accountPayload)
        .select("id")
        .single();
      if (insertError) {
        console.error("Facebook account insert failed", {
          code: insertError.code,
          message: insertError.message,
          details: insertError.details,
          hint: insertError.hint,
        });
        throw new Error("De Facebookpagina kon niet aan de vestiging worden gekoppeld.");
      }
      account = insertedAccount;
    }

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
