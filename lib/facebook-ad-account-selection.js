import { decryptMetaToken } from "./meta-oauth";

// Called only after the route has verified integration-management access for
// this workspace and business. Credentials never leave the server.
export async function selectFacebookAdAccount(admin, body) {
  const { workspaceId, businessId, action, adAccountId } = body;
  const { data: account, error } = await admin.from("integration_accounts")
    .select("id,granted_scopes,token_expires_at").eq("workspace_id", workspaceId)
    .eq("business_id", businessId).eq("provider", "facebook_ads").maybeSingle();
  if (error) throw new Error("De advertentiekoppeling kon niet worden gelezen.");
  if (!account?.granted_scopes?.includes("ads_management")) throw new Error("Koppel eerst Meta met advertentietoestemming.");
  if (account.token_expires_at && new Date(account.token_expires_at) <= new Date()) throw new Error("De Meta-toestemming is verlopen. Koppel het advertentieaccount opnieuw.");
  const { data: credential, error: credentialError } = await admin.from("integration_credentials")
    .select("token_ciphertext,token_iv,token_tag").eq("account_id", account.id)
    .eq("workspace_id", workspaceId).eq("business_id", businessId).maybeSingle();
  if (credentialError || !credential) throw new Error("De beveiligde Meta-toegang ontbreekt. Koppel opnieuw.");
  const token = decryptMetaToken(credential);
  const candidates = [];
  let after;
  const seen = new Set();
  for (let page = 0; page < 20; page++) {
    const url = new URL("https://graph.facebook.com/v25.0/me/adaccounts");
    url.search = new URLSearchParams({ fields: "id,name,account_status,currency,business{name}", limit: "100", ...(after ? { after } : {}) }).toString();
    const response = await fetch(url, { headers: { Authorization: `Bearer ${token}` }, cache: "no-store", signal: AbortSignal.timeout(20000) });
    const result = await response.json();
    if (!response.ok) throw new Error("Meta kon de advertentieaccounts niet ophalen. Controleer je advertentietoegang in Meta Business en probeer opnieuw.");
    for (const item of result.data || []) {
      if (!/^act_\d+$/.test(String(item.id)) || seen.has(item.id)) continue;
      seen.add(item.id);
      candidates.push({ id: item.id, name: item.name || item.id, active: Number(item.account_status) === 1, currency: item.currency || "", businessName: item.business?.name || "" });
    }
    if (!result.paging?.next) break;
    const cursor = result.paging?.cursors?.after;
    if (!cursor || cursor === after || page === 19) throw new Error("Meta geeft te veel accounts terug. Neem contact op met de beheerder om de accountselectie af te ronden.");
    after = cursor;
  }
  if (action === "list_ad_accounts") return { candidates };
  const selected = candidates.find(item => item.id === adAccountId && item.active);
  if (!selected) throw new Error("Kies een actief advertentieaccount uit de opgehaalde lijst.");
  const { error: saveError } = await admin.from("integration_accounts").update({
    external_account_id: selected.id, display_name: selected.name,
    connection_status: "connected", last_error_code: null, last_error_at: null,
  }).eq("id", account.id).eq("workspace_id", workspaceId).eq("business_id", businessId);
  if (saveError) throw new Error(saveError.code === "23505"
    ? "Dit advertentieaccount is al aan een andere vestiging gekoppeld. Kies het account van deze vestiging."
    : "Het gekozen advertentieaccount kon niet worden opgeslagen.");
  return { ok: true, accountName: selected.name };
}
