import { NextResponse } from "next/server";
import { createAdminSupabase, createUserSupabase } from "../../../../lib/server-supabase";

const PREDIS_BASE_URL = "https://brain.predis.ai/predis_api/v1";

export async function GET(request) {
  const context = await requireIntegrationManager(request);
  if (context.error) return context.error;
  const workspaceId = request.nextUrl.searchParams.get("workspaceId");
  const businessId = request.nextUrl.searchParams.get("businessId");
  const brandId = request.nextUrl.searchParams.get("brandId");
  if (workspaceId !== context.workspaceId || !businessId || !brandId) return jsonError("Werkruimte, vestiging en Predis-merk ontbreken.", 400);
  const business = await requireBusiness(workspaceId, businessId);
  if (!business) return jsonError("Vestiging hoort niet bij deze werkruimte.", 400);
  const apiKey = process.env.PREDIS_API_KEY?.trim();
  if (!apiKey) return jsonError("Predis is nog niet geconfigureerd op de server.", 503);
  const url = new URL(`${PREDIS_BASE_URL}/get_posts/`);
  url.searchParams.set("brand_id", brandId);
  url.searchParams.set("page_n", request.nextUrl.searchParams.get("page") || "1");
  url.searchParams.set("items_n", "20");
  const response = await fetch(url, { headers: { Authorization: apiKey, Accept: "application/json" }, cache: "no-store" });
  const result = await response.json().catch(() => ({}));
  if (!response.ok || result.errors?.length) return jsonError("Predis kon dit merk niet bevestigen.", response.status === 401 ? 401 : 502);
  return NextResponse.json({ ok: true, business: { id: business.id, name: business.name }, brandId, posts: result.posts || [], totalPages: result.total_pages || 1 });
}

export async function POST(request) {
  const context = await requireIntegrationManager(request);
  if (context.error) return context.error;
  let body;
  try { body = await request.json(); } catch { return jsonError("Ongeldig verzoek.", 400); }
  const workspaceId = String(body.workspaceId || "");
  const businessId = String(body.businessId || "");
  const brandId = String(body.brandId || "").trim();
  const prompt = String(body.prompt || "").trim();
  const mediaType = ["single_image", "carousel", "video"].includes(body.mediaType) ? body.mediaType : "single_image";
  if (workspaceId !== context.workspaceId || !businessId || !brandId) return jsonError("Werkruimte, vestiging en Predis-merk ontbreken.", 400);
  if (prompt.length < 20 || prompt.split(/\s+/).length < 3) return jsonError("Beschrijf het bericht met minimaal 20 tekens en 3 woorden.", 400);
  const business = await requireBusiness(workspaceId, businessId);
  if (!business) return jsonError("Vestiging hoort niet bij deze werkruimte.", 400);
  const apiKey = process.env.PREDIS_API_KEY?.trim();
  if (!apiKey) return jsonError("Predis is nog niet geconfigureerd op de server.", 503);
  const form = new FormData();
  form.set("brand_id", brandId);
  form.set("text", prompt);
  form.set("media_type", mediaType);
  form.set("model_version", mediaType === "video" ? "2" : "4");
  form.set("input_language", "dutch");
  form.set("output_language", "dutch");
  const response = await fetch(`${PREDIS_BASE_URL}/create_content/`, { method: "POST", headers: { Authorization: apiKey }, body: form, cache: "no-store" });
  const result = await response.json().catch(() => ({}));
  if (!response.ok || result.errors?.length) return jsonError(result.errors?.[0]?.detail || "Predis kon de inhoud niet genereren.", response.status || 502);
  return NextResponse.json({ ok: true, business: { id: business.id, name: business.name }, brandId, postIds: result.post_ids || [], status: result.post_status || "inProgress" });
}

async function requireBusiness(workspaceId, businessId) {
  const admin = createAdminSupabase();
  const { data } = await admin.from("businesses").select("id,name").eq("workspace_id", workspaceId).eq("id", businessId).maybeSingle();
  return data || null;
}

async function requireIntegrationManager(request) {
  const token = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  if (!token) return { error: jsonError("Niet ingelogd.", 401) };
  const supabase = createUserSupabase(token);
  const { data, error } = await supabase.auth.getUser(token);
  const user = data?.user;
  if (error || !user) return { error: jsonError("Sessie is verlopen.", 401) };
  if (verifiedTokenAal(token) !== "aal2") return { error: jsonError("Bevestig eerst je tweestapsverificatie.", 403) };
  const workspaceId = request.method === "GET" ? request.nextUrl.searchParams.get("workspaceId") : await readWorkspaceId(request.clone());
  if (!workspaceId) return { error: jsonError("Werkruimte ontbreekt.", 400) };
  const { data: assignments } = await supabase.from("user_role_assignments").select("role:roles!inner(role_key,role_permissions(permission))").eq("workspace_id", workspaceId).eq("user_id", user.id);
  const allowed = (assignments || []).some((assignment) => assignment.role?.role_key === "owner" || (assignment.role?.role_permissions || []).some((item) => item.permission === "integrations:manage"));
  return allowed ? { user, workspaceId } : { error: jsonError("Geen toegang tot koppelingenbeheer.", 403) };
}
function verifiedTokenAal(token) { try { const payload = token.split(".")[1]; return payload ? JSON.parse(Buffer.from(payload, "base64url").toString("utf8")).aal || null : null; } catch { return null; } }
async function readWorkspaceId(request) { try { return (await request.json()).workspaceId || null; } catch { return null; } }
function jsonError(message, status) { return NextResponse.json({ error: message }, { status }); }
