import { NextResponse } from "next/server";
import { createAdminSupabase, createUserSupabase } from "../../../../../lib/server-supabase";
import { decryptMetaToken } from "../../../../../lib/meta-oauth";

const GRAPH_VERSION = "v25.0";
const MAX_MESSAGE_LENGTH = 8000;

export async function POST(request) {
  let body;
  try { body = await request.json(); } catch { return jsonError("Ongeldig verzoek.", 400); }

  const message = String(body.message || "").trim();
  if (!message) return jsonError("Schrijf eerst een reactie.", 400);
  if (message.length > MAX_MESSAGE_LENGTH) return jsonError("De reactie is te lang.", 400);

  const context = await authorizedContext(request, body.workspaceId, body.businessId);
  if (context.error) return context.error;
  const { admin, workspaceId, businessId, userId } = context;

  const { data: item } = await admin.from("social_content_items")
    .select("id,account_id,external_id,content_type,direction,permalink")
    .eq("id", body.itemId).eq("workspace_id", workspaceId).eq("business_id", businessId)
    .eq("content_type", "comment").eq("direction", "inbound").maybeSingle();
  if (!item) return jsonError("Deze gastreactie is niet gevonden.", 404);

  const { data: account } = await admin.from("integration_accounts")
    .select("id,business_id,provider,display_name,granted_scopes")
    .eq("id", item.account_id).eq("workspace_id", workspaceId).eq("business_id", businessId)
    .eq("provider", "facebook").maybeSingle();
  if (!account) return jsonError("De juiste Facebookpagina is niet gekoppeld.", 409);
  if (!account.granted_scopes?.includes("pages_manage_engagement")) {
    return jsonError("Koppel deze Facebookpagina opnieuw om reacties te mogen plaatsen.", 409);
  }

  const { data: credential } = await admin.from("integration_credentials")
    .select("token_ciphertext,token_iv,token_tag").eq("account_id", account.id).maybeSingle();
  if (!credential) return jsonError("De beveiligde Facebook-toegang ontbreekt. Koppel de pagina opnieuw.", 409);

  try {
    const accessToken = decryptMetaToken(credential);
    const graphResponse = await fetch(`https://graph.facebook.com/${GRAPH_VERSION}/${encodeURIComponent(item.external_id)}/comments`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ message, access_token: accessToken }),
      cache: "no-store",
    });
    const graphResult = await graphResponse.json();
    if (!graphResponse.ok || !graphResult.id) {
      throw new Error(graphResult.error?.message || "Facebook heeft de reactie geweigerd.");
    }

    const now = new Date().toISOString();
    const { error: storageError } = await admin.from("social_content_items").insert({
      workspace_id: workspaceId,
      business_id: businessId,
      account_id: account.id,
      external_id: String(graphResult.id),
      content_type: "comment",
      direction: "outbound",
      status: "published",
      body: message,
      created_by: userId,
      approved_by: userId,
      approved_at: now,
      permalink: item.permalink || null,
      media: [{ provider: "facebook", parent_comment_id: String(item.external_id) }],
      published_at: now,
      provider_updated_at: now,
    });
    if (storageError) {
      return NextResponse.json({
        ok: true,
        warning: "De reactie staat op Facebook, maar kon niet direct in Horeca OS worden opgeslagen.",
        externalId: String(graphResult.id),
      });
    }
    return NextResponse.json({ ok: true, message: `Reactie geplaatst via ${account.display_name}.`, externalId: String(graphResult.id) });
  } catch (error) {
    return jsonError(error.message || "De reactie kon niet worden geplaatst.", 502);
  }
}

async function authorizedContext(request, workspaceId, businessId) {
  const token = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  if (!token || !workspaceId || !businessId) return { error: jsonError("Niet ingelogd of geen vestiging gekozen.", 401) };
  const userClient = createUserSupabase(token);
  const { data: authData } = await userClient.auth.getUser(token);
  if (!authData?.user) return { error: jsonError("Sessie is verlopen.", 401) };

  const { data: assignments } = await userClient.from("user_role_assignments")
    .select("business_id,assignment_permissions(permission),role:roles!inner(role_key,role_permissions(permission))")
    .eq("workspace_id", workspaceId).eq("user_id", authData.user.id);
  const allowed = (assignments || []).some((assignment) => {
    if (assignment.business_id && assignment.business_id !== businessId) return false;
    const permissions = assignment.role?.role_key === "custom"
      ? assignment.assignment_permissions?.map((entry) => entry.permission) || []
      : assignment.role?.role_permissions?.map((entry) => entry.permission) || [];
    return assignment.role?.role_key === "owner"
      || permissions.includes("social:manage")
      || permissions.includes("social:publish")
      || permissions.includes("reviews:respond");
  });
  if (!allowed) return { error: jsonError("Je hebt geen toestemming om namens deze vestiging te reageren.", 403) };
  return { admin: createAdminSupabase(), workspaceId, businessId, userId: authData.user.id };
}

function jsonError(error, status) {
  return NextResponse.json({ error }, { status });
}
