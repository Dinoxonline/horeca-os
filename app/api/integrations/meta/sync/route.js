import { NextResponse } from "next/server";
import { createAdminSupabase, createUserSupabase } from "../../../../../lib/server-supabase";
import { decryptMetaToken } from "../../../../../lib/meta-oauth";

const MEDIA_PAGE_SIZE = 25;
const MAX_MEDIA_ITEMS = 100;
const COMMENT_PAGE_SIZE = 100;
const MAX_COMMENTS_PER_MEDIA = 500;

export async function POST(request) {
  let body;
  try { body = await request.json(); } catch { return jsonError("Ongeldig verzoek.", 400); }

  const context = await authorizedContext(request, body.workspaceId, body.businessId);
  if (context.error) return context.error;
  const { admin, workspaceId, businessId } = context;

  const { data: account } = await admin.from("integration_accounts")
    .select("id,external_account_id,display_name")
    .eq("workspace_id", workspaceId).eq("business_id", businessId).eq("provider", "meta").maybeSingle();
  if (!account) return jsonError("Voor deze vestiging is nog geen Instagram-profiel gekoppeld.", 404);

  const { data: credential } = await admin.from("integration_credentials")
    .select("token_ciphertext,token_iv,token_tag")
    .eq("account_id", account.id).maybeSingle();
  if (!credential) return jsonError("De beveiligde Instagram-toegang ontbreekt. Koppel het profiel opnieuw.", 409);

  const jobKey = `instagram-comments:${new Date().toISOString().slice(0, 13)}`;
  const { data: job } = await admin.from("integration_sync_jobs").upsert({
    workspace_id: workspaceId, business_id: businessId, account_id: account.id,
    job_type: "instagram_comments", status: "running", idempotency_key: jobKey,
    started_at: new Date().toISOString(), attempt_count: 1, records_processed: 0,
    error_code: null, error_message: null,
  }, { onConflict: "workspace_id,account_id,idempotency_key" }).select("id").single();

  try {
    const accessToken = decryptMetaToken(credential);
    const media = await instagramGetAll("me/media", accessToken, {
      fields: "id,caption,media_type,permalink,timestamp",
      limit: String(MEDIA_PAGE_SIZE),
    }, MAX_MEDIA_ITEMS);

    const contentRows = [];
    let commentCount = 0;
    for (const item of media) {
      contentRows.push({
        workspace_id: workspaceId, business_id: businessId, account_id: account.id,
        external_id: String(item.id), content_type: mediaType(item.media_type), direction: "outbound",
        status: "imported", body: item.caption || null, permalink: item.permalink || null,
        media: [{ provider: "instagram", media_type: item.media_type || null }],
        published_at: item.timestamp || null, provider_updated_at: item.timestamp || null,
      });

      const comments = await instagramGetAll(`${encodeURIComponent(item.id)}/comments`, accessToken, {
        fields: "id,text,timestamp,from,username",
        limit: String(COMMENT_PAGE_SIZE),
      }, MAX_COMMENTS_PER_MEDIA);
      for (const comment of comments) {
        commentCount += 1;
        contentRows.push({
          workspace_id: workspaceId, business_id: businessId, account_id: account.id,
          external_id: String(comment.id), content_type: "comment", direction: "inbound",
          status: "imported", body: comment.text || null, permalink: item.permalink || null,
          media: [{
            provider: "instagram", parent_media_id: String(item.id),
            sender_id: comment.from?.id || null,
            sender_username: comment.from?.username || comment.username || null,
          }],
          published_at: comment.timestamp || null, provider_updated_at: comment.timestamp || null,
        });
      }
    }

    if (contentRows.length) await storeContentRows(admin, workspaceId, account.id, contentRows);

    const finishedAt = new Date().toISOString();
    await admin.from("integration_accounts").update({
      connection_status: "connected", last_synced_at: finishedAt,
      last_error_code: null, last_error_at: null,
    }).eq("id", account.id);
    if (job?.id) await admin.from("integration_sync_jobs").update({
      status: "succeeded", finished_at: finishedAt, records_processed: contentRows.length,
    }).eq("id", job.id);

    return NextResponse.json({
      ok: true,
      message: `${media.length} Instagram-posts en ${commentCount} reacties opgehaald voor @${account.display_name}.`,
      posts: media.length,
      comments: commentCount,
    });
  } catch (error) {
    const failedAt = new Date().toISOString();
    await admin.from("integration_accounts").update({
      connection_status: "degraded", last_error_code: "instagram_comment_sync_failed", last_error_at: failedAt,
    }).eq("id", account.id);
    if (job?.id) await admin.from("integration_sync_jobs").update({
      status: "failed", finished_at: failedAt, error_code: "instagram_comment_sync_failed",
      error_message: String(error.message || "Instagram-synchronisatie mislukt.").slice(0, 500),
    }).eq("id", job.id);
    return jsonError(error.message || "Instagram-reacties konden niet worden opgehaald.", 502);
  }
}

async function instagramGet(path, accessToken, parameters) {
  const url = new URL(`https://graph.instagram.com/${path}`);
  url.search = new URLSearchParams({ ...parameters, access_token: accessToken }).toString();
  const response = await fetch(url, { cache: "no-store" });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error?.message || "Instagram heeft het verzoek geweigerd.");
  return result;
}

async function instagramGetAll(path, accessToken, parameters, maximum) {
  const items = [];
  let page = await instagramGet(path, accessToken, parameters);

  while (page) {
    items.push(...(page.data || []).slice(0, maximum - items.length));
    if (items.length >= maximum || !page.paging?.next) break;

    const response = await fetch(page.paging.next, { cache: "no-store" });
    page = await response.json();
    if (!response.ok) throw new Error(page.error?.message || "Instagram heeft een vervolgpagina geweigerd.");
  }

  return items;
}

async function storeContentRows(admin, workspaceId, accountId, rows) {
  const externalIds = rows.map((row) => row.external_id);
  const { data: existing, error: lookupError } = await admin.from("social_content_items")
    .select("id,external_id").eq("workspace_id", workspaceId).eq("account_id", accountId).in("external_id", externalIds);
  if (lookupError) throw new Error("Bestaande Instagram-gegevens konden niet worden gecontroleerd.");
  const existingIds = new Map((existing || []).map((row) => [String(row.external_id), row.id]));
  const updates = rows.filter((row) => existingIds.has(row.external_id)).map((row) => ({ ...row, id: existingIds.get(row.external_id) }));
  const inserts = rows.filter((row) => !existingIds.has(row.external_id));
  if (updates.length) {
    const { error } = await admin.from("social_content_items").upsert(updates, { onConflict: "id" });
    if (error) throw new Error("Bestaande Instagram-reacties konden niet worden bijgewerkt.");
  }
  if (inserts.length) {
    const { error } = await admin.from("social_content_items").insert(inserts);
    if (error) throw new Error("Nieuwe Instagram-reacties konden niet veilig worden opgeslagen.");
  }
}

function mediaType(type) {
  if (type === "VIDEO") return "video";
  if (type === "REELS") return "reel";
  return "post";
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

