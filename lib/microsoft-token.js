import { decryptMetaToken, encryptMetaToken } from "./meta-oauth";
import { MICROSOFT_SCOPES } from "./microsoft-oauth";

function decryptToken(connection, prefix) {
  return decryptMetaToken({
    token_ciphertext: connection[`${prefix}_token_ciphertext`],
    token_iv: connection[`${prefix}_token_iv`],
    token_tag: connection[`${prefix}_token_tag`],
  });
}

export async function microsoftAccessToken(connection, admin, { forceRefresh = false } = {}) {
  const expiresAt = connection.token_expires_at ? new Date(connection.token_expires_at).getTime() : 0;
  if (!forceRefresh && expiresAt > Date.now() + 60_000) return decryptToken(connection, "access");
  if (!connection.refresh_token_ciphertext) {
    throw new Error("De Microsoft-koppeling mist een vernieuwingstoken. Koppel deze mailbox één keer opnieuw.");
  }

  const refreshToken = decryptToken(connection, "refresh");
  const response = await fetch(`https://login.microsoftonline.com/${process.env.MICROSOFT_TENANT_ID}/oauth2/v2.0/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    cache: "no-store",
    body: new URLSearchParams({
      client_id: process.env.MICROSOFT_CLIENT_ID || "",
      client_secret: process.env.MICROSOFT_CLIENT_SECRET || "",
      grant_type: "refresh_token",
      refresh_token: refreshToken,
      scope: MICROSOFT_SCOPES.join(" "),
    }),
  });
  const tokens = await response.json().catch(() => ({}));
  if (!response.ok || !tokens.access_token) {
    throw new Error("Microsoft heeft de koppeling ingetrokken. Koppel deze mailbox één keer opnieuw.");
  }

  const encryptedAccess = encryptMetaToken(tokens.access_token);
  const encryptedRefresh = encryptMetaToken(tokens.refresh_token || refreshToken);
  const update = {
    access_token_ciphertext: encryptedAccess.ciphertext,
    access_token_iv: encryptedAccess.iv,
    access_token_tag: encryptedAccess.tag,
    refresh_token_ciphertext: encryptedRefresh.ciphertext,
    refresh_token_iv: encryptedRefresh.iv,
    refresh_token_tag: encryptedRefresh.tag,
    token_expires_at: new Date(Date.now() + Number(tokens.expires_in || 3600) * 1000).toISOString(),
    updated_at: new Date().toISOString(),
  };
  const { error } = await admin.from("calendar_connections").update(update).eq("id", connection.id);
  if (error) throw new Error("Het vernieuwde Microsoft-token kon niet veilig worden opgeslagen.");
  Object.assign(connection, update);
  return tokens.access_token;
}
