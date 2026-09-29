import { createHash } from "node:crypto";
import { NextResponse } from "next/server";
import { createAdminSupabase, createUserSupabase } from "../../../../lib/server-supabase";
import { manualDistribution } from "../../../../lib/manual-predis";
import { normalizePredisPost, PREDIS_FORMATS } from "../../../../lib/predis-content";

export const runtime = "nodejs";
export const maxDuration = 30;
const reply = (data, status = 200) => NextResponse.json(data, { status, headers: { "Cache-Control": "no-store" } });
const fail = (message, status = 400) => Object.assign(new Error(message), { status });
const hash = value => createHash("sha256").update(JSON.stringify(value)).digest("hex");
const publicLinks = links => links.map(({ brandId, ...link }) => link);

async function contextFor(request, input) {
  const { workspaceId, businessId, itemId } = input || {};
  if (![workspaceId, businessId, itemId].every(v => typeof v === "string" && /^[\w-]{1,100}$/.test(v))) throw fail("Evenement of vestiging ontbreekt.");
  const token = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  if (!token) throw fail("Log opnieuw in.", 401);
  const user = createUserSupabase(token);
  const { data, error } = await user.auth.getUser(token);
  if (error || !data?.user) throw fail("Je sessie is verlopen.", 401);
  let aal; try { aal = JSON.parse(Buffer.from(token.split(".")[1], "base64url").toString()).aal; } catch { /* fail closed */ }
  if (aal !== "aal2") throw fail("Bevestig eerst je tweestapsverificatie.", 403);
  const roles = await user.from("user_role_assignments").select("business_id,location_id,assignment_permissions(permission),role:roles!inner(role_key,role_permissions(permission))").eq("workspace_id", workspaceId).eq("user_id", data.user.id);
  if (roles.error || !(roles.data || []).some(a => !a.location_id && (!a.business_id || a.business_id === businessId) && (a.role?.role_key === "owner" || (a.role?.role_key === "custom" ? a.assignment_permissions : a.role?.role_permissions)?.some(p => ["marketing:manage", "social:manage"].includes(p.permission))))) throw fail("Geen marketingrechten voor deze vestiging.", 403);
  const admin = createAdminSupabase();
  const scope = query => query.eq("workspace_id", workspaceId).eq("business_id", businessId).eq("id", itemId);
  const read = async () => {
    const r = await scope(admin.from("social_content_items").select("id,media,updated_at")).maybeSingle();
    if (r.error || !r.data || r.data.media?.filter(m => m?.kind === "campaign_distribution").length !== 1) throw fail("Evenement niet toegankelijk.", 404);
    return r.data;
  };
  await read();
  const connection = await admin.from("integration_accounts").select("external_account_id,connection_status").eq("workspace_id", workspaceId).eq("business_id", businessId).eq("provider", "predis").maybeSingle();
  if (connection.error) throw fail("Predis-koppeling kon niet worden gecontroleerd.", 503);
  const brandId = connection.data?.connection_status === "connected" ? connection.data.external_account_id : null;
  return { admin, scope, read, brandId, userId: data.user.id };
}

async function listPosts(brandId, input) {
  const key = process.env.PREDIS_API_KEY?.trim();
  if (!brandId || !key) throw fail("Koppel eerst het Predis-merk van deze vestiging en stel de API-sleutel in onder Koppelingen.", 409);
  const page = Number(input.page || 1), mediaType = input.mediaType || "single_image";
  if (!Number.isSafeInteger(page) || page < 1 || page > 10000 || !Object.hasOwn(PREDIS_FORMATS, mediaType)) throw fail("Ongeldige pagina of inhoudstype.");
  const url = new URL("https://brain.predis.ai/predis_api/v1/get_posts/");
  url.search = new URLSearchParams({ brand_id: brandId, page_n: String(page), items_n: "20", media_type: mediaType }).toString();
  let response, result;
  try {
    response = await fetch(url, { method: "GET", headers: { Authorization: key, Accept: "application/json" }, cache: "no-store", redirect: "error", signal: AbortSignal.timeout(12000) });
    result = await response.json();
  } catch { throw fail("Predis reageert niet. Probeer later opnieuw; er is geen content aangemaakt.", 502); }
  if (response.status === 429) throw fail("Predis vraagt om even te wachten. Probeer later opnieuw.", 429);
  if (!response.ok || result?.errors?.length || !Array.isArray(result?.posts)) throw fail("Predis kon de posts niet teruggeven. Controleer de API-toegang en het gekoppelde merk.", 502);
  const posts = [], seen = new Set();
  let skipped = 0;
  for (const raw of result.posts.slice(0, 20)) {
    const id = typeof raw?.post_id === "string" && raw.post_id.length <= 200 ? raw.post_id : "";
    const post = id && raw.media_type === mediaType && normalizePredisPost(raw, [id]);
    if (!post || typeof raw.caption !== "string" || raw.caption.length > 10000) { skipped++; continue; }
    if (seen.has(id)) continue;
    seen.add(id);
    posts.push({ ...post, key: hash([brandId, id]), fingerprint: hash([brandId, post]) });
  }
  return { posts, skipped, page, mediaType, totalPages: Math.min(10000, Math.max(1, Number.isSafeInteger(result.total_pages) ? result.total_pages : 1)) };
}

export async function GET(request) {
  try {
    const input = Object.fromEntries(new URL(request.url).searchParams), ctx = await contextFor(request, input);
    const linked = publicLinks(manualDistribution(await ctx.read()).predis_library?.posts || []);
    return reply({ linked, configured: Boolean(ctx.brandId && process.env.PREDIS_API_KEY?.trim()), ...(input.list === "1" ? await listPosts(ctx.brandId, input) : {}) });
  } catch (e) { return reply({ error: e.status ? e.message : "Ophalen van Predis-posts is mislukt." }, e.status || 500); }
}

export async function POST(request) {
  try {
    let input; try { input = await request.json(); } catch { throw fail("Ongeldig verzoek."); }
    if (input?.action !== "link" || input.confirmed !== true || typeof input.postId !== "string" || !input.postId || input.postId.length > 200 || !/^[a-f0-9]{64}$/.test(input.fingerprint || "")) throw fail("Kies en bevestig eerst een bestaande post.");
    const ctx = await contextFor(request, input);
    // Re-fetch from the server-selected brand: never trust client caption, media or brand.
    const result = await listPosts(ctx.brandId, input), post = result.posts.find(p => p.id === input.postId);
    if (!post || post.fingerprint !== input.fingerprint) throw fail("De post of het gekoppelde merk is gewijzigd, of de post staat op een andere pagina. Haal de lijst opnieuw op en controleer je keuze.", 409);
    for (let attempt = 0; attempt < 3; attempt++) {
      const row = await ctx.read(), distribution = manualDistribution(row);
      const current = distribution.predis_library?.posts || [];
      // Repeated clicks/retries do not duplicate or replace an earlier snapshot.
      if (current.some(p => p.key === post.key)) return reply({ linked: publicLinks(current), alreadyLinked: true });
      if (current.length >= 50) throw fail("Dit evenement heeft al 50 gekoppelde posts.", 409);
      if (!row.updated_at) throw fail("Evenementversie ontbreekt. Laad opnieuw.", 409);
      const linked = [...current, { ...post, brandId: ctx.brandId, linkedAt: new Date().toISOString(), linkedBy: ctx.userId }];
      const media = row.media.map(m => m === distribution ? { ...distribution, predis_library: { posts: linked } } : m);
      const saved = await ctx.scope(ctx.admin.from("social_content_items").update({ media })).eq("updated_at", row.updated_at).select("id").maybeSingle();
      if (saved.error) throw fail("Koppelen is niet bevestigd. Laad de bewaarde koppelingen opnieuw.", 500);
      if (saved.data) return reply({ linked: publicLinks(linked) });
    }
    throw fail("Dit evenement is ondertussen gewijzigd. Laad opnieuw.", 409);
  } catch (e) { return reply({ error: e.status ? e.message : "Koppelen is niet bevestigd. Controleer de bewaarde koppelingen." }, e.status || 500); }
}
