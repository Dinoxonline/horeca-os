import { NextResponse } from "next/server";
import { createAdminSupabase, createUserSupabase } from "../../../../../../lib/server-supabase";
import { decryptMetaToken } from "../../../../../../lib/meta-oauth";

async function context(request, workspaceId, mailbox) {
  const token = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  if (!token || !workspaceId || !mailbox) return null;
  const client = createUserSupabase(token);
  const { data } = await client.auth.getUser(token);
  if (!data?.user) return null;
  const { data: member } = await client.from("workspace_members").select("role").eq("workspace_id", workspaceId).eq("user_id", data.user.id).maybeSingle();
  if (member?.role !== "owner") return null;
  const admin = createAdminSupabase();
  const { data: connection } = await admin.from("calendar_connections").select("*").eq("workspace_id", workspaceId).eq("user_id", data.user.id).eq("provider", "microsoft").eq("email", mailbox).maybeSingle();
  return connection ? { connection } : null;
}
function token(row) {
  return decryptMetaToken({ token_ciphertext: row.access_token_ciphertext, token_iv: row.access_token_iv, token_tag: row.access_token_tag });
}
async function graph(connection, path, options = {}) {
  const response = await fetch(`https://graph.microsoft.com/v1.0/me/${path}`, {
    ...options, cache: "no-store",
    headers: { Authorization: `Bearer ${token(connection)}`, "Content-Type": "application/json", ...(options.headers || {}) },
  });
  const result = response.status === 204 ? null : await response.json().catch(() => null);
  if (!response.ok) throw new Error(result?.error?.message || "Microsoft kon deze actie niet uitvoeren. Koppel de mailbox opnieuw voor de nieuwste rechten.");
  return result;
}
export async function POST(request) {
  const body = await request.json().catch(() => ({}));
  const auth = await context(request, body.workspaceId, String(body.mailbox || "").toLowerCase());
  if (!auth) return NextResponse.json({ error: "Geen toegang tot deze mailbox." }, { status: 403 });
  try {
    if (body.action === "reply") {
      if (!body.messageId || !String(body.comment || "").trim()) throw new Error("Schrijf eerst een reactie.");
      await graph(auth.connection, `messages/${encodeURIComponent(body.messageId)}/reply`, { method: "POST", body: JSON.stringify({ comment: String(body.comment).trim() }) });
      return NextResponse.json({ message: "Reactie verzonden." });
    }
    if (body.action === "send") {
      if (!String(body.to || "").trim() || !String(body.subject || "").trim()) throw new Error("Vul ontvanger en onderwerp in.");
      await graph(auth.connection, "sendMail", { method: "POST", body: JSON.stringify({ message: { subject: String(body.subject), body: { contentType: "Text", content: String(body.content || "") }, toRecipients: String(body.to).split(",").map((address) => ({ emailAddress: { address: address.trim() } })).filter((item) => item.emailAddress.address) }, saveToSentItems: true }) });
      return NextResponse.json({ message: "E-mail verzonden." });
    }
    if (body.action === "delete") {
      await graph(auth.connection, `messages/${encodeURIComponent(body.messageId)}`, { method: "DELETE" });
      return NextResponse.json({ message: "E-mail verwijderd." });
    }
    if (body.action === "read") {
      await graph(auth.connection, `messages/${encodeURIComponent(body.messageId)}`, { method: "PATCH", body: JSON.stringify({ isRead: Boolean(body.isRead) }) });
      return NextResponse.json({ message: body.isRead ? "Gemarkeerd als gelezen." : "Gemarkeerd als ongelezen." });
    }
    if (body.action === "move") {
      await graph(auth.connection, `messages/${encodeURIComponent(body.messageId)}/move`, { method: "POST", body: JSON.stringify({ destinationId: body.folderId }) });
      return NextResponse.json({ message: "E-mail verplaatst." });
    }
    return NextResponse.json({ error: "Onbekende mailboxactie." }, { status: 400 });
  } catch (error) {
    return NextResponse.json({ error: error.message }, { status: 502 });
  }
}
