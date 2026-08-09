import { NextResponse } from "next/server";
import { createAdminSupabase, createUserSupabase } from "../../../../../lib/server-supabase";
import { decryptMetaToken, encryptMetaToken } from "../../../../../lib/meta-oauth";
import { MICROSOFT_SCOPES } from "../../../../../lib/microsoft-oauth";

const MAILBOXES = ["dino@leclubbbq.nl","admin@leclubbbq.nl","info@leclubbbq.nl","verhuur@leclubbbq.nl"];

function decrypt(prefix, row) {
  return decryptMetaToken({ token_ciphertext: row[`${prefix}_token_ciphertext`], token_iv: row[`${prefix}_token_iv`], token_tag: row[`${prefix}_token_tag`] });
}

async function ownerContext(request, workspaceId) {
  const token = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  if (!token || !workspaceId) return null;
  const client = createUserSupabase(token);
  const { data } = await client.auth.getUser(token);
  if (!data?.user) return null;
  const { data: member } = await client.from("workspace_members").select("role").eq("workspace_id", workspaceId).eq("user_id", data.user.id).maybeSingle();
  if (member?.role !== "owner") return null;
  return { user: data.user, admin: createAdminSupabase() };
}

async function accessToken(connection, admin) {
  if (new Date(connection.token_expires_at || 0).getTime() > Date.now() + 60000) return decrypt("access", connection);
  if (!connection.refresh_token_ciphertext) throw new Error("Log opnieuw in om deze mailbox te vernieuwen.");
  const response = await fetch(`https://login.microsoftonline.com/${process.env.MICROSOFT_TENANT_ID}/oauth2/v2.0/token`, {
    method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, cache: "no-store",
    body: new URLSearchParams({ client_id: process.env.MICROSOFT_CLIENT_ID, client_secret: process.env.MICROSOFT_CLIENT_SECRET, grant_type: "refresh_token", refresh_token: decrypt("refresh", connection), scope: MICROSOFT_SCOPES.join(" ") }),
  });
  const tokens = await response.json();
  if (!response.ok || !tokens.access_token) throw new Error("De Microsoft-sessie kon niet worden vernieuwd.");
  const access = encryptMetaToken(tokens.access_token);
  const refresh = tokens.refresh_token ? encryptMetaToken(tokens.refresh_token) : null;
  const update = { access_token_ciphertext: access.ciphertext, access_token_iv: access.iv, access_token_tag: access.tag, token_expires_at: new Date(Date.now() + Number(tokens.expires_in || 3600) * 1000).toISOString() };
  if (refresh) Object.assign(update, { refresh_token_ciphertext: refresh.ciphertext, refresh_token_iv: refresh.iv, refresh_token_tag: refresh.tag });
  await admin.from("calendar_connections").update(update).eq("id", connection.id);
  return tokens.access_token;
}

async function foldersFor(token) {
  const url = new URL("https://graph.microsoft.com/v1.0/me/mailFolders");
  url.search = new URLSearchParams({ "$select": "id,displayName,totalItemCount,unreadItemCount", "$top": "100", includeHiddenFolders: "true" }).toString();
  const response = await fetch(url, { headers: { Authorization: `Bearer ${token}` }, cache: "no-store" });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error?.message || "De mappen konden niet worden geladen.");
  return result.value || [];
}

async function ownMessages(token, folderId = "inbox") {
  const path = folderId === "all" ? "messages" : `mailFolders/${encodeURIComponent(folderId)}/messages`;
  const url = new URL(`https://graph.microsoft.com/v1.0/me/${path}`);
  url.search = new URLSearchParams({ "$select": "id,subject,from,receivedDateTime,isRead,bodyPreview,webLink", "$orderby": "receivedDateTime desc", "$top": "20" }).toString();
  const response = await fetch(url, { headers: { Authorization: `Bearer ${token}` }, cache: "no-store" });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error?.message || "Deze mailbox kon niet worden gelezen.");
  return result.value || [];
}

export async function GET(request) {
  const requestUrl = new URL(request.url);
  const workspaceId = requestUrl.searchParams.get("workspaceId");
  const requestedMailbox = String(requestUrl.searchParams.get("mailbox") || "").toLowerCase();
  const folderId = requestUrl.searchParams.get("folderId") || "inbox";
  const context = await ownerContext(request, workspaceId);
  if (!context) return NextResponse.json({ error: "Alleen de eigenaar heeft toegang tot het centrale mailoverzicht." }, { status: 403 });
  const { data: connections } = await context.admin.from("calendar_connections").select("*").eq("workspace_id", workspaceId).eq("user_id", context.user.id).eq("provider", "microsoft");
  const byEmail = new Map((connections || []).map((row) => [row.email, row]));
  const targets = requestedMailbox && MAILBOXES.includes(requestedMailbox) ? [requestedMailbox] : MAILBOXES;
  const results = await Promise.all(targets.map(async (mailbox) => {
    const connection = byEmail.get(mailbox);
    if (!connection) return { mailbox, connected: false, folders: [], messages: [], error: null };
    try {
      const token = await accessToken(connection, context.admin);
      const [folders, messages] = await Promise.all([foldersFor(token), ownMessages(token, folderId)]);
      return { mailbox, connected: true, folders, messages, error: null };
    } catch (error) {
      return { mailbox, connected: true, folders: [], messages: [], error: error.message };
    }
  }));
  return NextResponse.json({ mailboxes: results });
}
