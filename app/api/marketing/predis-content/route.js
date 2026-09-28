import { NextResponse } from "next/server";
import { createAdminSupabase, createUserSupabase } from "../../../../lib/server-supabase";
import { manualDistribution } from "../../../../lib/manual-predis";
import { instagramEventMedia } from "../../../../lib/instagram-event-media";
import { predisForm, validatePredisInput, normalizePredisPost } from "../../../../lib/predis-content";

export const runtime = "nodejs";
export const maxDuration = 60;
const BASE = "https://brain.predis.ai/predis_api/v1";
const reply = (data, status = 200) => NextResponse.json(data, { status, headers: { "Cache-Control": "no-store" } });
const fail = (message, status = 400) => Object.assign(new Error(message), { status });
async function contextFor(request, input) {
  const { workspaceId, businessId, itemId } = input || {};
  if (![workspaceId, businessId, itemId].every(v => typeof v === "string" && /^[\w-]{1,100}$/.test(v))) throw fail("Evenement of vestiging ontbreekt.");
  const token = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  if (!token) throw fail("Log opnieuw in.", 401);
  const userClient = createUserSupabase(token);
  const { data, error } = await userClient.auth.getUser(token);
  if (error || !data?.user) throw fail("Je sessie is verlopen.", 401);
  let aal; try { aal = JSON.parse(Buffer.from(token.split(".")[1], "base64url").toString()).aal; } catch { /* fail closed */ }
  if (aal !== "aal2") throw fail("Bevestig eerst je tweestapsverificatie.", 403);
  const roles = await userClient.from("user_role_assignments").select("business_id,location_id,assignment_permissions(permission),role:roles!inner(role_key,role_permissions(permission))").eq("workspace_id", workspaceId).eq("user_id", data.user.id);
  if (roles.error || !(roles.data || []).some(a => !a.location_id && (!a.business_id || a.business_id === businessId) && (a.role?.role_key === "owner" || (a.role?.role_key === "custom" ? a.assignment_permissions : a.role?.role_permissions)?.some(p => ["marketing:manage", "social:manage"].includes(p.permission))))) throw fail("Geen marketingrechten voor deze vestiging.", 403);
  const admin = createAdminSupabase();
  const scope = q => q.eq("workspace_id", workspaceId).eq("business_id", businessId).eq("id", itemId);
  const read = async () => {
    const r = await scope(admin.from("social_content_items").select("id,business_id,body,media,updated_at")).maybeSingle();
    if (r.error || !r.data || r.data.media?.filter(m => m?.kind === "campaign_distribution").length !== 1) throw fail("Evenement niet toegankelijk.", 404);
    return r.data;
  };
  await read();
  // Compare-and-swap only this event's generation history; preserve other channels.
  const change = async fn => {
    for (let attempt = 0; attempt < 3; attempt++) {
      const row = await read(), d = manualDistribution(row);
      if (!row.updated_at) throw fail("Evenementversie ontbreekt.", 409);
      const jobs = fn(d.predis_content?.jobs || [], row);
      const media = row.media.map(m => m === d ? { ...d, predis_content: { jobs } } : m);
      const r = await scope(admin.from("social_content_items").update({ media })).eq("updated_at", row.updated_at).select("id").maybeSingle();
      if (r.error) throw fail("Opslaan mislukt. Controleer de bewaarde aanvragen voor je opnieuw genereert.", 500);
      if (r.data) return jobs;
    }
    throw fail("Dit evenement is elders gewijzigd. Laad de aanvragen opnieuw.", 409);
  };
  const connection = async () => {
    const r = await admin.from("integration_accounts").select("external_account_id,connection_status").eq("workspace_id", workspaceId).eq("business_id", businessId).eq("provider", "predis").maybeSingle();
    if (r.error) throw fail("Predis-koppeling kon niet worden gecontroleerd.", 503);
    return r.data?.connection_status === "connected" ? r.data.external_account_id : null;
  };
  return { read, change, connection, userId: data.user.id };
}
function displayJobs(jobs) { return jobs.map(({ brandId, ...job }) => job); }
export async function GET(request) {
  try {
    const ctx = await contextFor(request, Object.fromEntries(new URL(request.url).searchParams));
    const row = await ctx.read(), brand = await ctx.connection();
    return reply({ jobs: displayJobs(manualDistribution(row).predis_content?.jobs || []), configured: Boolean(process.env.PREDIS_API_KEY?.trim() && brand), hasBrand: Boolean(brand), photos: instagramEventMedia(row).filter(a => a.type === "image" && !a.issue) });
  } catch (e) { return reply({ error: e.status ? e.message : "Laden van Predis is mislukt." }, e.status || 500); }
}
export async function POST(request) {
  let ctx, reservedId;
  try {
    let input; try { input = await request.json(); } catch { throw fail("Ongeldig verzoek."); }
    if (!["generate", "refresh"].includes(input?.action)) throw fail("Onbekende actie.");
    ctx = await contextFor(request, input);
    const key = process.env.PREDIS_API_KEY?.trim();
    if (!key) throw fail("De Predis API-sleutel is nog niet op de server ingesteld.", 503);
    if (input.action === "generate") {
      if (input.confirmed !== true) throw fail("Bevestig het gebruik van Predis-tegoed.");
      if (typeof input.requestId !== "string" || !/^[a-f0-9-]{36}$/i.test(input.requestId)) throw fail("Aanvraagnummer ontbreekt.");
      const brandId = await ctx.connection();
      if (!brandId) throw fail("Koppel eerst het Predis-merk van deze vestiging onder Koppelingen.", 409);
      const prior = manualDistribution(await ctx.read()).predis_content?.jobs || [];
      if (prior.some(j => j.id === input.requestId)) return reply({ jobs: displayJobs(prior) });
      let draft;
      const jobs = await ctx.change((current, row) => {
        if (current.some(j => j.id === input.requestId)) throw fail("Deze aanvraag is al bewaard. Laad het resultaat opnieuw.", 409);
        if (current.some(j => ["submitting", "generating", "unknown"].includes(j.status)) && input.acknowledgePending !== true) throw fail("Er loopt nog een aanvraag of de uitkomst is onzeker. Controleer die eerst.", 409);
        if (current.length >= 50) throw fail("Dit evenement heeft al 50 aanvragen. Er wordt niets verwijderd of opnieuw verstuurd.", 409);
        if (current.some(j => Date.now() - Date.parse(j.createdAt) < 60000)) throw fail("Wacht minimaal één minuut voordat je een nieuwe aanvraag start.", 429);
        try { draft = validatePredisInput(input, row); } catch (e) { throw fail(e.message); }
        return [...current, { id: input.requestId, status: "submitting", createdAt: new Date().toISOString(), by: ctx.userId, brandId, ...draft, postIds: [], results: [] }];
      });
      reservedId = input.requestId;
      let response, result;
      try {
        response = await fetch(`${BASE}/create_content/`, { method: "POST", headers: { Authorization: key }, body: predisForm(draft, brandId), cache: "no-store", redirect: "error", signal: AbortSignal.timeout(25000) });
        result = await response.json();
      } catch { throw fail("Geen volledige bevestiging van Predis. De aanvraag is bewaard; niet automatisch opnieuw verstuurd.", 502); }
      const ids = Array.isArray(result.post_ids) ? result.post_ids.filter(id => typeof id === "string" && id.length > 0 && id.length <= 200) : [];
      const accepted = response.ok && !result.errors?.length && ids.length === 1;
      const definiteRejection = !ids.length && response.status >= 400 && response.status < 500;
      const status = accepted ? "generating" : definiteRejection ? "failed" : "unknown";
      const saved = await ctx.change(current => current.map(j => j.id === reservedId ? { ...j, status, postIds: ids.slice(0, 1), errorCode: accepted ? null : `PREDIS_${response.status}` } : j));
      reservedId = null;
      return reply({ jobs: displayJobs(saved), ...(accepted ? {} : { warning: definiteRejection ? "Predis heeft de aanvraag geweigerd. Controleer je API-toegang en tegoed onder Koppelingen." : "Predis heeft de aanvraag niet volledig bevestigd. Controleer eerst; start niet zomaar opnieuw." }) });
    }
    const row = await ctx.read(), jobs = manualDistribution(row).predis_content?.jobs || [];
    const job = jobs.find(j => j.id === input.jobId);
    if (!job) throw fail("Aanvraag niet gevonden.", 404);
    if (job.status === "ready" || !job.postIds?.length) return reply({ jobs: displayJobs(jobs), warning: job.status === "ready" ? undefined : "Predis heeft geen resultaatnummer bevestigd. Controleer deze aanvraag in Predis voordat je een nieuwe start." });
    if (job.checkedAt && Date.now() - Date.parse(job.checkedAt) < 10000) return reply({ jobs: displayJobs(jobs) });
    const found = new Map((job.results || []).map(r => [r.id, r]));
    let page = job.nextPage || 1, scanned = 0, matching = 0, invalid = 0;
    for (let n = 0; n < 3; n++) {
      const url = new URL(`${BASE}/get_posts/`);
      Object.entries({ brand_id: job.brandId, page_n: String(page), items_n: "20", media_type: job.mediaType }).forEach(([k, v]) => url.searchParams.set(k, v));
      const response = await fetch(url, { headers: { Authorization: key, Accept: "application/json" }, cache: "no-store", redirect: "error", signal: AbortSignal.timeout(12000) });
      const result = await response.json();
      if (!response.ok || result.errors?.length || !Array.isArray(result.posts)) throw fail("Resultaten ophalen bij Predis is mislukt. De aanvraag blijft bewaard; er is niets opnieuw aangemaakt.", 502);
      for (const post of result.posts) {
        scanned++;
        if (job.postIds.includes(String(post?.post_id))) matching++;
        const normalized = normalizePredisPost(post, job.postIds);
        if (normalized) found.set(normalized.id, normalized);
        else if (job.postIds.includes(String(post?.post_id))) {
          invalid++;
          console.warn(JSON.stringify({ event: "predis_result_shape", fields: Object.keys(post).filter(k => /^[a-z_]{1,40}$/i.test(k)).slice(0, 30).map(k => ({ name: k, type: Array.isArray(post[k]) ? "array" : typeof post[k], count: Array.isArray(post[k]) ? post[k].length : undefined, entryKeys: Array.isArray(post[k]) && post[k][0] && typeof post[k][0] === "object" ? Object.keys(post[k][0]).filter(n => /^[a-z_]{1,40}$/i.test(n)).slice(0, 20) : undefined })), mediaType: ["single_image", "carousel", "video", "image"].includes(post.media_type) ? post.media_type : "other", urlsArray: Array.isArray(post.urls), urlCount: Array.isArray(post.urls) ? post.urls.length : null, urlsType: typeof post.urls,
            entries: Array.isArray(post.urls) ? post.urls.slice(0, 10).map(u => ({ type: typeof u, keys: u && typeof u === "object" ? Object.keys(u).filter(k => ["url", "type", "src", "image_url", "video_url"].includes(k)) : [], scheme: typeof u === "string" ? (/^(https?):/.exec(u)?.[1] || "other") : null })) : [] }));
        }
      }
      const pages = Math.min(10000, Math.max(1, Number(result.total_pages) || 1));
      page = page >= pages ? 1 : page + 1;
      if (job.postIds.every(id => found.has(id)) || page === 1) break;
    }
    const complete = job.postIds.every(id => found.has(id));
    const overdue = Date.now() - Date.parse(job.createdAt) > 15 * 60000;
    console.info(JSON.stringify({ event: "predis_result_check", scanned, matching, invalid, complete, overdue }));
    const saved = await ctx.change(current => current.map(j => j.id === job.id && j.status !== "ready" ? { ...j, status: complete ? "ready" : j.status === "generating" && (overdue || invalid) ? "unknown" : j.status, results: [...found.values()], checkedAt: new Date().toISOString(), nextPage: page } : j));
    const savedStatus = saved.find(j => j.id === job.id)?.status;
    return reply({ jobs: displayJobs(saved), ...(savedStatus !== "ready" ? { warning: savedStatus === "generation_failed" ? "Predis meldt dat het maken is mislukt. Er is niets opnieuw aangevraagd." : invalid ? "Predis gaf een resultaat terug dat niet veilig kon worden ingelezen. Er is niets opnieuw aangevraagd." : overdue ? "De aanvraag is geaccepteerd, maar na meer dan 15 minuten is nog geen bruikbaar resultaat ontvangen. Dit bevestigt niet dat Predis nog bezig is. Controle nodig; genereer niet opnieuw." : "Nog geen volledig resultaat gevonden. Controleer later opnieuw; er wordt niets opnieuw gegenereerd." } : {}) });
  } catch (e) {
    if (reservedId && ctx) await ctx.change(jobs => jobs.map(j => j.id === reservedId && j.status === "submitting" ? { ...j, status: "unknown" } : j)).catch(() => {});
    return reply({ error: e.status ? e.message : "Geen volledige bevestiging ontvangen. Laad de aanvragen opnieuw voordat je verdergaat." }, e.status || 500);
  }
}
