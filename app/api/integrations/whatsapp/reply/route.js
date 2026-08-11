import { NextResponse } from "next/server";
import { createAdminSupabase, createUserSupabase } from "../../../../../lib/server-supabase";
import { decryptMetaToken } from "../../../../../lib/meta-oauth";

const GRAPH_VERSION = "v25.0";

export async function POST(request) {
  let body;
  try { body = await request.json(); } catch { return jsonError("Ongeldig verzoek.", 400); }
  const message = String(body.message || "").trim();
  if (!message) return jsonError("Schrijf eerst een antwoord.", 400);
  if (message.length > 4096) return jsonError("Het WhatsApp-bericht is te lang.", 400);

  const context = await authorizedContext(request, body.workspaceId, body.businessId);
  if (context.error) return context.error;
  const { admin, workspaceId, businessId, userId } = context;

  const { data: item } = await admin.from("social_content_items")
    .select("id,account_id,external_id,media")
    .eq("id", body.itemId).eq("workspace_id", workspaceId).eq("business_id", businessId)
    .eq("content_type", "message").eq("direction", "inbound").maybeSingle();
  if (!item) return jsonError("Dit WhatsApp-bericht is niet gevonden.", 404);

  const { data: account } = await admin.from("integration_accounts")
    .select("id,external_account_id,display_name")
    .eq("id", item.account_id).eq("provider", "whatsapp").eq("connection_status", "connected").maybeSingle();
  if (!account) return jsonError("Het WhatsApp-nummer van deze vestiging is niet gekoppeld.", 409);

  const { data: credential } = await admin.from("integration_credentials")
    .select("token_ciphertext,token_iv,token_tag").eq("account_id", account.id).maybeSingle();
  if (!credential) return jsonError("De beveiligde WhatsApp-toegang ontbreekt.", 409);

  const media = Array.isArray(item.media) ? item.media[0] || {} : {};
  const recipient = String(media.sender_id || "");
  if (!recipient) return jsonError("Het telefoonnummer van de afzender ontbreekt.", 409);

  try {
    const accessToken = decryptMetaToken(credential);
    const response = await fetch(`https://graph.facebook.com/${GRAPH_VERSION}/${encodeURIComponent(account.external_account_id)}/messages`, {
      method: "POST",
      headers: { authorization: `Bearer ${accessToken}`, "content-type": "application/json" },
      body: JSON.stringify({ messaging_product: "whatsapp", recipient_type: "individual", to: recipient, type: "text", text: { preview_url: false, body: message } }),
      cache: "no-store",
    });
    const result = await response.json();
    const externalId = String(result.messages?.[0]?.id || "");
    if (!response.ok || !externalId) throw new Error(result.error?.message || "WhatsApp heeft het bericht geweigerd.");

    const now = new Date().toISOString();
    await admin.from("social_content_items").insert({
      workspace_id: workspaceId, business_id: businessId, account_id: account.id,
      external_id: externalId, content_type: "message", direction: "outbound", status: "published",
      workflow_status: "handled", body: message, created_by: userId, approved_by: userId, approved_at: now,
      media: [{ provider: "whatsapp", recipient_id: recipient, parent_message_id: item.external_id }],
      published_at: now, provider_updated_at: now,
    });
    await admin.from("social_content_items").update({ workflow_status: "handled", handled_at: now, handled_by: userId })
      .eq("id", item.id).eq("workspace_id", workspaceId);
    return NextResponse.json({ ok: true, message: `WhatsApp-antwoord verzonden via ${account.display_name}.` });
  } catch (error) {
    return jsonError(error.message || "Het WhatsApp-antwoord kon niet worden verzonden.", 502);
  }
}

async function authorizedContext(request, workspaceId, businessId) {
  const token = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  if (!token || !workspaceId || !businessId) return { error: jsonError("Niet ingelogd of geen vestiging gekozen.", 401) };
  const client = createUserSupabase(token);
  const { data: authData } = await client.auth.getUser(token);
  if (!authData?.user) return { error: jsonError("Sessie is verlopen.", 401) };
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
  if (!allowed) return { error: jsonError("Je hebt geen toestemming om namens deze vestiging te antwoorden.", 403) };
  return { admin: createAdminSupabase(), workspaceId, businessId, userId: authData.user.id };
}

function jsonError(error, status) {
  return NextResponse.json({ error }, { status });
}
