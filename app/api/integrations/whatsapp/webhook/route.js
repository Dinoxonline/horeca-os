import crypto from "node:crypto";
import { NextResponse } from "next/server";
import { createAdminSupabase } from "../../../../../lib/server-supabase";

export async function GET(request) {
  const url = new URL(request.url);
  const mode = url.searchParams.get("hub.mode");
  const verifyToken = url.searchParams.get("hub.verify_token");
  const challenge = url.searchParams.get("hub.challenge");
  if (mode === "subscribe" && challenge && safeEqual(verifyToken, process.env.WHATSAPP_VERIFY_TOKEN)) {
    return new NextResponse(challenge, { status: 200, headers: { "content-type": "text/plain" } });
  }
  return new NextResponse("Webhookcontrole mislukt.", { status: 403 });
}

export async function POST(request) {
  const rawBody = await request.text();
  const appSecret = process.env.WHATSAPP_APP_SECRET || process.env.META_APP_SECRET;
  if (!verifySignature(rawBody, request.headers.get("x-hub-signature-256"), appSecret)) {
    return NextResponse.json({ error: "Ongeldige webhookhandtekening." }, { status: 401 });
  }

  let payload;
  try { payload = JSON.parse(rawBody); } catch {
    return NextResponse.json({ error: "Ongeldige webhookinhoud." }, { status: 400 });
  }

  const admin = createAdminSupabase();
  for (const entry of payload.entry || []) {
    for (const change of entry.changes || []) {
      const value = change.value || {};
      const phoneNumberId = String(value.metadata?.phone_number_id || "");
      if (!phoneNumberId) continue;
      const { data: account } = await admin.from("integration_accounts")
        .select("id,workspace_id,business_id")
        .eq("provider", "whatsapp")
        .eq("external_account_id", phoneNumberId)
        .eq("connection_status", "connected")
        .maybeSingle();
      if (!account) continue;

      const contacts = Object.fromEntries((value.contacts || []).map((contact) => [String(contact.wa_id), contact.profile?.name || contact.wa_id]));
      for (const message of value.messages || []) {
        const externalId = String(message.id || "");
        if (!externalId) continue;
        const { data: existing } = await admin.from("social_content_items")
          .select("id").eq("account_id", account.id).eq("external_id", externalId).maybeSingle();
        if (existing) continue;
        const sender = String(message.from || "");
        const body = message.text?.body
          || message.button?.text
          || message.interactive?.button_reply?.title
          || message.interactive?.list_reply?.title
          || `[${message.type || "bericht"}]`;
        await admin.from("social_content_items").insert({
          workspace_id: account.workspace_id,
          business_id: account.business_id,
          account_id: account.id,
          external_id: externalId,
          content_type: "message",
          direction: "inbound",
          status: "imported",
          workflow_status: "new",
          body,
          media: [{
            provider: "whatsapp",
            sender_id: sender,
            sender_name: contacts[sender] || sender || "WhatsApp-gast",
            message_type: message.type || "unknown",
          }],
          published_at: message.timestamp ? new Date(Number(message.timestamp) * 1000).toISOString() : new Date().toISOString(),
          provider_updated_at: new Date().toISOString(),
        });
      }

      for (const status of value.statuses || []) {
        const externalId = String(status.id || "");
        if (!externalId) continue;
        await admin.from("social_content_items").update({
          provider_updated_at: new Date().toISOString(),
          media: [{ provider: "whatsapp", delivery_status: status.status || "unknown", recipient_id: status.recipient_id || null }],
        }).eq("account_id", account.id).eq("external_id", externalId);
      }

      await admin.from("integration_accounts").update({
        last_synced_at: new Date().toISOString(),
        last_error_code: null,
        last_error_at: null,
      }).eq("id", account.id);
    }
  }
  return NextResponse.json({ received: true });
}

function verifySignature(body, signature, secret) {
  if (!body || !signature || !secret || !signature.startsWith("sha256=")) return false;
  const expected = `sha256=${crypto.createHmac("sha256", secret).update(body).digest("hex")}`;
  return safeEqual(signature, expected);
}

function safeEqual(left, right) {
  if (!left || !right) return false;
  const a = Buffer.from(String(left));
  const b = Buffer.from(String(right));
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}
