import { NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { createAdminSupabase, createUserSupabase } from "../../../../../lib/server-supabase";
import { decryptMetaToken } from "../../../../../lib/meta-oauth";
import { INSTAGRAM_FORMATS, validateInstagramDraft, instagramContainerValues } from "../../../../../lib/instagram-publishing";

export const maxDuration = 60;
const graphRoot = "https://graph.instagram.com/v25.0";
const distributionOf = row => (row?.media || []).find(entry => entry?.kind === "campaign_distribution");
const jsonError = (error, status = 400) => NextResponse.json({ error }, { status });

async function contextFor(request, input) {
  const token = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  const { workspaceId, businessId, campaignId } = input || {};
  if (!token || !workspaceId || !businessId || !campaignId) throw new Error("Sessie, vestiging of evenement ontbreekt.");
  const client = createUserSupabase(token);
  const { data: auth, error: authError } = await client.auth.getUser(token);
  if (authError || !auth?.user) throw new Error("Je sessie is verlopen.");
  const { data: assignments, error } = await client.from("user_role_assignments")
    .select("business_id,assignment_permissions(permission),role:roles!inner(role_key,role_permissions(permission))")
    .eq("workspace_id", workspaceId).eq("user_id", auth.user.id);
  const allowed = !error && (assignments || []).some(assignment => {
    if (assignment.business_id && assignment.business_id !== businessId) return false;
    const permissions = assignment.role?.role_key === "custom" ? assignment.assignment_permissions : assignment.role?.role_permissions;
    return assignment.role?.role_key === "owner" || (permissions || []).some(p => ["marketing:manage", "social:manage"].includes(p.permission));
  });
  if (!allowed) throw new Error("Je hebt geen publicatierechten voor deze vestiging.");
  const admin = createAdminSupabase();
  const ctx = { admin, workspaceId, businessId, campaignId };
  ctx.campaign = await readCampaign(ctx);
  const { data: account, error: accountError } = await admin.from("integration_accounts")
    .select("id,external_account_id,display_name,connection_status,granted_scopes,token_expires_at")
    .eq("workspace_id", workspaceId).eq("business_id", businessId).eq("provider", "meta").maybeSingle();
  if (accountError) throw new Error("De Instagram-koppeling kon niet worden gelezen.");
  ctx.account = account;
  return ctx;
}

async function readCampaign(ctx) {
  const { data, error } = await ctx.admin.from("social_content_items").select("id,business_id,media,updated_at")
    .eq("workspace_id", ctx.workspaceId).eq("business_id", ctx.businessId).eq("id", ctx.campaignId).maybeSingle();
  if (error || !data || !distributionOf(data)) throw new Error("Dit evenement is niet toegankelijk.");
  return data;
}

// CAS before every external write, and merge later changes instead of overwriting
// background checks, other channels, or edits made in another browser tab.
async function updateJob(ctx, format, expectedId, next) {
  for (let attempt = 0; attempt < 3; attempt++) {
    const row = await readCampaign(ctx);
    const distribution = distributionOf(row);
    const old = distribution.instagram_publications?.[format];
    if ((old?.operation_id || null) !== expectedId) throw new Error("Deze Instagram-publicatie is intussen gewijzigd. Herlaad de status.");
    const job = typeof next === "function" ? next(old) : next;
    const updated = { ...distribution, instagram_publications: { ...distribution.instagram_publications, [format]: job } };
    const media = row.media.map(entry => entry?.kind === "campaign_distribution" ? updated : entry);
    // The database trigger advances updated_at on every write. Preserve its exact
    // microsecond value: serializing all media into a REST filter can exceed URL
    // limits as soon as the draft/caption is added. Never drop the CAS guard.
    if (!row.updated_at || typeof row.updated_at !== "string") throw new Error("De evenementversie ontbreekt. De publicatiestatus is niet gewijzigd; ververs de agenda.");
    const { data, error, status } = await ctx.admin.from("social_content_items").update({ media })
      .eq("workspace_id", ctx.workspaceId).eq("business_id", ctx.businessId).eq("id", ctx.campaignId)
      .eq("updated_at", row.updated_at).select("id").maybeSingle();
    if (error) {
      // Do not log event text, URLs, database error details or credentials.
      const code = /^[A-Z0-9_]{1,20}$/.test(error.code || "") ? error.code : "unknown";
      console.error("[instagram-publication] status_save_failed", { format, code, httpStatus: status || null, attempt: attempt + 1 });
      throw new Error("De publicatiestatus kon niet veilig worden opgeslagen. Ververs eerst de accountstatus; start geen nieuwe publicatie.");
    }
    if (data?.id) return job;
  }
  throw new Error("Het evenement wordt elders bijgewerkt. Probeer de status later opnieuw.");
}

async function graph(path, token, values, deadline = Date.now() + 12000) {
  const response = await fetch(`${graphRoot}/${path}`, {
    method: values ? "POST" : "GET", cache: "no-store", signal: AbortSignal.timeout(Math.max(1, Math.min(12000, deadline - Date.now()))),
    headers: { Authorization: `Bearer ${token}`, ...(values ? { "Content-Type": "application/x-www-form-urlencoded" } : {}) },
    ...(values ? { body: new URLSearchParams(values) } : {}),
  });
  const result = await response.json();
  if (!response.ok || result.error) throw new Error(result.error?.message || "Instagram kon de aanvraag niet verwerken.");
  return result;
}

function accountProblem(account) {
  if (!account || account.connection_status !== "connected") return "Koppel eerst het Instagram-account van deze vestiging via Koppelingen.";
  if (!account.granted_scopes?.includes("instagram_business_content_publish")) return "Koppel Instagram opnieuw met toestemming om te publiceren.";
  if (account.token_expires_at && new Date(account.token_expires_at) <= new Date()) return "De Instagram-toegang is verlopen. Koppel het account opnieuw.";
  return "";
}

export async function GET(request) {
  try {
    const ctx = await contextFor(request, Object.fromEntries(new URL(request.url).searchParams));
    return NextResponse.json({ account: ctx.account ? { id: ctx.account.id, name: ctx.account.display_name } : null,
      warning: accountProblem(ctx.account), publications: distributionOf(ctx.campaign).instagram_publications || {} });
  } catch (error) { return jsonError(error.message, 403); }
}

export async function POST(request) {
  let body, ctx;
  try { body = await request.json(); } catch { return jsonError("Ongeldig verzoek."); }
  if (!["prepare", "status", "publish", "discard"].includes(body?.action) || !Object.hasOwn(INSTAGRAM_FORMATS, body?.format)) return jsonError("Ongeldige Instagram-actie.");
  try { ctx = await contextFor(request, body); } catch (error) { return jsonError(error.message, 403); }
  const problem = accountProblem(ctx.account);
  if (problem) return jsonError(problem, 409);
  const { data: credential, error: credentialError } = await ctx.admin.from("integration_credentials")
    .select("token_ciphertext,token_iv,token_tag").eq("account_id", ctx.account.id)
    .eq("workspace_id", ctx.workspaceId).eq("business_id", ctx.businessId).maybeSingle();
  if (credentialError || !credential) return jsonError("De beveiligde Instagram-toegang ontbreekt.", 409);
  let job = distributionOf(ctx.campaign).instagram_publications?.[body.format];
  let acquired = false;
  const deadline = Date.now() + 45000;
  try {
    const token = decryptMetaToken(credential);
    if (body.action === "prepare") {
      if (job && !["failed", "draft"].includes(job.status)) return jsonError("Er staat al een voorbereiding of publicatie voor dit formaat. Controleer eerst de status.", 409);
      const draft = validateInstagramDraft({ ...body.draft, format: body.format });
      if (body.accountId !== ctx.account.id) return jsonError("Het gekozen Instagram-account is gewijzigd. Controleer de bestemming.", 409);
      if (draft.format === "story") {
        const profile = await graph(`${ctx.account.external_account_id}?fields=account_type`, token);
        if (profile.account_type !== "BUSINESS") return jsonError("Stories plaatsen via de koppeling vereist een zakelijk Instagram-account. Gebruik voor dit account de Instagram-app.", 409);
      }
      job = await updateJob(ctx, body.format, job?.operation_id || null, {
        operation_id: randomUUID(), account_id: ctx.account.id, account_name: ctx.account.display_name,
        status: "preparing", draft, created_at: new Date().toISOString(),
      });
      acquired = true;
      const children = [];
      for (const asset of draft.assets) {
        const result = await graph(`${ctx.account.external_account_id}/media`, token, instagramContainerValues(draft, asset, draft.format === "carousel"), deadline);
        if (!result.id) throw new Error("Instagram heeft geen mediacontainer teruggegeven.");
        children.push(String(result.id));
        if (draft.format === "carousel" && asset.type === "video") {
          let state;
          do {
            state = await graph(`${result.id}?fields=status_code`, token, undefined, deadline);
            if (["ERROR", "EXPIRED"].includes(state.status_code)) throw new Error("Instagram kon een carrouselvideo niet verwerken.");
            if (state.status_code !== "FINISHED") {
              if (Date.now() > deadline - 1500) throw new Error("De carrouselvideo heeft meer verwerkingstijd nodig. Probeer een kleiner bestand.");
              await new Promise(resolve => setTimeout(resolve, 1000));
            }
          } while (state.status_code !== "FINISHED");
        }
      }
      const parent = draft.format === "carousel"
        ? await graph(`${ctx.account.external_account_id}/media`, token, { media_type: "CAROUSEL", children: children.join(","), caption: draft.caption }, deadline)
        : { id: children[0] };
      if (!parent.id) throw new Error("Instagram heeft geen publicatiecontainer teruggegeven.");
      job = await updateJob(ctx, body.format, job.operation_id, { ...job, status: "processing", container_id: String(parent.id) });
    } else if (body.action === "discard") {
      if (!job || body.operationId !== job.operation_id) return jsonError("De voorbereiding is gewijzigd. Herlaad de status.", 409);
      job = await updateJob(ctx, body.format, job.operation_id, current => {
        if (!["preparing", "processing", "ready", "failed", "draft"].includes(current.status)) throw new Error("Een gestarte publicatie kan niet opnieuw worden voorbereid. Controleer eerst Instagram.");
        return { ...current, operation_id: randomUUID(), status: "draft", container_id: null, error: null };
      });
    } else {
      if (!job || job.account_id !== ctx.account.id || !job.container_id) return jsonError("Er staat nog geen verwerkbare voorbereiding voor dit account.", 409);
      if (body.operationId !== job.operation_id) return jsonError("De voorbereiding is gewijzigd. Controleer de status opnieuw.", 409);
      if (job.status === "published") return NextResponse.json({ job });
      const container = await graph(`${job.container_id}?fields=status_code,status`, token);
      if (body.action === "status") {
        job = await updateJob(ctx, body.format, job.operation_id, current => {
          if (current.status === "published") return current;
          if (container.status_code === "PUBLISHED") return { ...current, status: "published", published_at: current.published_at || new Date().toISOString() };
          // An uncertain publish must never become ready for another publish.
          if (["publishing", "unknown"].includes(current.status)) return current;
          if (["ERROR", "EXPIRED"].includes(container.status_code)) return { ...current, status: "failed", error: "Instagram kon deze media niet verwerken. Controleer formaat en bestand." };
          return { ...current, status: container.status_code === "FINISHED" ? "ready" : "processing" };
        });
      } else {
        if (body.confirm !== true || container.status_code !== "FINISHED") return jsonError("Bevestig de publicatie nadat Instagram de media heeft verwerkt.", 409);
        job = await updateJob(ctx, body.format, job.operation_id, current => {
          if (current.status !== "ready") throw new Error("Deze publicatie is al gestart of nog niet gereed. Controleer de status.");
          return { ...current, status: "publishing" };
        });
        acquired = true;
        const result = await graph(`${ctx.account.external_account_id}/media_publish`, token, { creation_id: job.container_id });
        if (!result.id) throw new Error("Instagram gaf geen publicatienummer terug. Controleer eerst Instagram.");
        const externalId = String(result.id);
        let permalink = "";
        try { permalink = (await graph(`${externalId}?fields=permalink`, token)).permalink || ""; } catch {}
        job = await updateJob(ctx, body.format, job.operation_id, { ...job, status: "published", external_id: externalId, permalink, published_at: new Date().toISOString() });
      }
    }
    return NextResponse.json({ job });
  } catch (error) {
    if (acquired && job) {
      const status = body.action === "publish" ? "unknown" : "failed";
      try { job = await updateJob(ctx, body.format, job.operation_id, current => {
        if (current.status === "published") return current;
        // A simultaneous status check may have advanced this same operation.
        if (body.action === "prepare" && current.status !== "preparing") return current;
        return { ...current, status, error: status === "unknown" ? "Controleer Instagram en de status. Niet opnieuw publiceren: het bericht kan al geplaatst zijn." : "Voorbereiden mislukt. Controleer je media en probeer opnieuw." };
      }); } catch {}
    }
    return NextResponse.json({ error: acquired && body.action === "publish" ? "De publicatie-uitkomst is onzeker. Controleer Instagram; plaats niet opnieuw." : error.message, ...(acquired ? { job } : {}) }, { status: 502 });
  }
}
