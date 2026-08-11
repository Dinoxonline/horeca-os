import { NextResponse } from "next/server";
import { createAdminSupabase, createUserSupabase } from "../../../../../lib/server-supabase";
import { decryptMetaToken } from "../../../../../lib/meta-oauth";

const GRAPH_VERSION = "v25.0";
const MAX_POSTS = 100;
const MAX_COMMENTS_PER_POST = 500;

export async function POST(request) {
  let body;
  try { body = await request.json(); } catch { return jsonError("Ongeldig verzoek.", 400); }

  const context = await authorizedContext(request, body.workspaceId, body.businessId);
  if (context.error) return context.error;
  const { admin, workspaceId, businessId } = context;

  const { data: account } = await admin.from("integration_accounts")
    .select("id,external_account_id,display_name,granted_scopes")
    .eq("workspace_id", workspaceId).eq("business_id", businessId)
    .eq("provider", "facebook").maybeSingle();
  if (!account) return jsonError("Voor deze vestiging is nog geen Facebookpagina gekoppeld.", 404);
  if (!account.granted_scopes?.includes("pages_read_engagement")) {
    return jsonError("Koppel deze Facebookpagina opnieuw om berichten en reacties te mogen ophalen.", 409);
  }

  const { data: credential } = await admin.from("integration_credentials")
    .select("token_ciphertext,token_iv,token_tag")
    .eq("account_id", account.id).maybeSingle();
  if (!credential) return jsonError("De beveiligde Facebook-toegang ontbreekt. Koppel de pagina opnieuw.", 409);

  const jobKey = `facebook-content:${new Date().toISOString().slice(0, 13)}`;
  const { data: job } = await admin.from("integration_sync_jobs").upsert({
    workspace_id: workspaceId, business_id: businessId, account_id: account.id,
    job_type: "facebook_content", status: "running", idempotency_key: jobKey,
    started_at: new Date().toISOString(), attempt_count: 1, records_processed: 0,
    error_code: null, error_message: null,
  }, { onConflict: "workspace_id,account_id,idempotency_key" }).select("id").single();

  try {
    const accessToken = decryptMetaToken(credential);
    const posts = await graphGetAll(`${account.external_account_id}/posts`, accessToken, {
      fields: "id,message,created_time,updated_time,permalink_url",
      limit: "25",
    }, MAX_POSTS);

    const rows = [];
    let commentCount = 0;
    let skippedCommentThreads = 0;
    for (const post of posts) {
      rows.push({
        workspace_id: workspaceId, business_id: businessId, account_id: account.id,
        external_id: String(post.id), content_type: "post", direction: "outbound",
        status: "imported", body: post.message || null, permalink: post.permalink_url || null,
        media: [{ provider: "facebook" }], published_at: post.created_time || null,
        provider_updated_at: post.updated_time || post.created_time || null,
      });

      let comments = [];
      try {
        comments = await graphGetAll(`${encodeURIComponent(post.id)}/comments`, accessToken, {
          fields: "id,message,created_time,from{id,name},permalink_url",
          filter: "stream", limit: "100",
        }, MAX_COMMENTS_PER_POST);
      } catch {
        skippedCommentThreads += 1;
      }
      for (const comment of comments) {
        commentCount += 1;
        rows.push({
          workspace_id: workspaceId, business_id: businessId, account_id: account.id,
          external_id: String(comment.id), content_type: "comment", direction: "inbound",
          status: "imported", body: comment.message || null,
          permalink: comment.permalink_url || post.permalink_url || null,
          media: [{ provider: "facebook", parent_post_id: String(post.id), sender_id: comment.from?.id || null, sender_name: comment.from?.name || null }],
          published_at: comment.created_time || null, provider_updated_at: comment.created_time || null,
        });
      }
    }

    if (rows.length) await storeContentRows(admin, workspaceId, account.id, rows);
    const finishedAt = new Date().toISOString();
    await admin.from("integration_accounts").update({
      connection_status: "connected", last_synced_at: finishedAt,
      last_error_code: null, last_error_at: null,
    }).eq("id", account.id);
    if (job?.id) await admin.from("integration_sync_jobs").update({
      status: "succeeded", finished_at: finishedAt, records_processed: rows.length,
    }).eq("id", job.id);

    return NextResponse.json({
      ok: true,
      message: `${posts.length} Facebook-berichten en ${commentCount} reacties opgehaald voor ${account.display_name}.${skippedCommentThreads ? ` Reacties bij ${skippedCommentThreads} bericht(en) waren niet toegankelijk via Meta.` : ""}`,
      posts: posts.length, comments: commentCount, skippedCommentThreads,
    });
  } catch (error) {
    const failedAt = new Date().toISOString();
    await admin.from("integration_accounts").update({
      connection_status: "degraded", last_error_code: "facebook_content_sync_failed", last_error_at: failedAt,
    }).eq("id", account.id);
    if (job?.id) await admin.from("integration_sync_jobs").update({
      status: "failed", finished_at: failedAt, error_code: "facebook_content_sync_failed",
      error_message: String(error.message || "Facebook-synchronisatie mislukt.").slice(0, 500),
    }).eq("id", job.id);
    return jsonError(error.message || "Facebook-berichten konden niet worden opgehaald.", 502);
  }
}

async function graphGet(path, accessToken, parameters) {
  const url = new URL(`https://graph.facebook.com/${GRAPH_VERSION}/${path}`);
  url.search = new URLSearchParams({ ...parameters, access_token: accessToken }).toString();
  const response = await fetch(url, { cache: "no-store" });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error?.message || "Facebook heeft het verzoek geweigerd.");
  return result;
}

async function graphGetAll(path, accessToken, parameters, maximum) {
  const items = [];
  let page = await graphGet(path, accessToken, parameters);
  while (page) {
    items.push(...(page.data || []).slice(0, maximum - items.length));
    if (items.length >= maximum || !page.paging?.next) break;
    const response = await fetch(page.paging.next, { cache: "no-store" });
    page = await response.json();
    if (!response.ok) throw new Error(page.error?.message || "Facebook heeft een vervolgpagina geweigerd.");
  }
  return items;
}

async function storeContentRows(admin, workspaceId, accountId, rows) {
  const externalIds = rows.map((row) => row.external_id);
  const { data: existing, error: lookupError } = await admin.from("social_content_items")
    .select("id,external_id").eq("workspace_id", workspaceId).eq("account_id", accountId).in("external_id", externalIds);
  if (lookupError) throw new Error("Bestaande Facebook-gegevens konden niet worden gecontroleerd.");
  const existingIds = new Map((existing || []).map((row) => [String(row.external_id), row.id]));
  const updates = rows.filter((row) => existingIds.has(row.external_id)).map((row) => ({ ...row, id: existingIds.get(row.external_id) }));
  const inserts = rows.filter((row) => !existingIds.has(row.external_id));
  if (updates.length) {
    const { error } = await admin.from("social_content_items").upsert(updates, { onConflict: "id" });
    if (error) throw new Error("Bestaande Facebook-reacties konden niet worden bijgewerkt.");
  }
  if (inserts.length) {
    const { error } = await admin.from("social_content_items").insert(inserts);
    if (error) throw new Error("Nieuwe Facebook-reacties konden niet veilig worden opgeslagen.");
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
      ? assignment.assignment_permissions?.map((item) => item.permission) || []
      : assignment.role?.role_permissions?.map((item) => item.permission) || [];
    return assignment.role?.role_key === "owner" || permissions.includes("integrations:manage");
  });
  if (!allowed) return { error: jsonError("Je hebt geen toestemming om deze vestiging te synchroniseren.", 403) };
  return { admin: createAdminSupabase(), workspaceId, businessId };
}

function jsonError(error, status) { return NextResponse.json({ error }, { status }); }

