import { NextResponse } from "next/server";
import { createAdminSupabase, createUserSupabase } from "../../../../lib/server-supabase";

const PREDIS_BASE_URL = "https://brain.predis.ai/predis_api/v1";

export async function GET(request) {
  const context = await requireIntegrationManager(request);
  if (context.error) return context.error;
  const workspaceId = request.nextUrl.searchParams.get("workspaceId");
  const businessId = request.nextUrl.searchParams.get("businessId");
  const brandId = request.nextUrl.searchParams.get("brandId")?.trim() || "";
  const configOnly = request.nextUrl.searchParams.get("config") === "1";
  if (workspaceId !== context.workspaceId || !businessId) return jsonError("Werkruimte of vestiging ontbreekt.", 400);
  const business = await requireBusiness(workspaceId, businessId);
  if (!business) return jsonError("Vestiging hoort niet bij deze werkruimte.", 400);
  if (configOnly) {
    const admin = createAdminSupabase();
    const { data, error } = await admin.from("integration_accounts")
      .select("external_account_id,display_name,connection_status,last_synced_at")
      .eq("workspace_id", workspaceId).eq("business_id", businessId).eq("provider", "predis")
      .maybeSingle();
    if (error) return jsonError("De opgeslagen Predis-koppeling kon niet worden geladen.", 500);
    return NextResponse.json({
      ok: true,
      business: { id: business.id, name: business.name },
      connected: data?.connection_status === "connected",
      brandId: data?.external_account_id || "",
      lastCheckedAt: data?.last_synced_at || null,
    });
  }
  if (!brandId) return jsonError("Predis-merk ontbreekt.", 400);
  const apiKey = process.env.PREDIS_API_KEY?.trim();
  if (!apiKey) return jsonError("Predis is nog niet geconfigureerd op de server.", 503);
  const url = new URL(`${PREDIS_BASE_URL}/get_posts/`);
  url.searchParams.set("brand_id", brandId);
  url.searchParams.set("page_n", request.nextUrl.searchParams.get("page") || "1");
  url.searchParams.set("items_n", "20");
  const response = await fetch(url, { headers: { Authorization: apiKey, Accept: "application/json" }, cache: "no-store" });
  const result = await response.json().catch(() => ({}));
  if (!response.ok || result.errors?.length) return jsonError("Predis kon dit merk niet bevestigen.", response.status === 401 ? 401 : 502);
  const saved = await savePredisConnection({ workspaceId, business, brandId });
  if (saved.error) return saved.error;
  return NextResponse.json({ ok: true, business: { id: business.id, name: business.name }, brandId, posts: result.posts || [], totalPages: result.total_pages || 1 });
}

export async function POST(request) {
  const context = await requireIntegrationManager(request);
  if (context.error) return context.error;
  let body;
  try { body = await request.json(); } catch { return jsonError("Ongeldig verzoek.", 400); }
  const workspaceId = String(body.workspaceId || "");
  const businessId = String(body.businessId || "");
  const requestedBrandId = String(body.brandId || "").trim();
  const prompt = String(body.prompt || "").trim();
  const mediaType = ["single_image", "carousel", "video"].includes(body.mediaType) ? body.mediaType : "single_image";
  if (workspaceId !== context.workspaceId || !businessId || !requestedBrandId) return jsonError("Werkruimte, vestiging en Predis-merk ontbreken.", 400);
  if (prompt.length < 20 || prompt.split(/\s+/).length < 3) return jsonError("Beschrijf het bericht met minimaal 20 tekens en 3 woorden.", 400);
  const business = await requireBusiness(workspaceId, businessId);
  if (!business) return jsonError("Vestiging hoort niet bij deze werkruimte.", 400);
  const admin = createAdminSupabase();
  const { data: savedConnection, error: connectionError } = await admin.from("integration_accounts")
    .select("external_account_id,connection_status")
    .eq("workspace_id", workspaceId).eq("business_id", businessId).eq("provider", "predis")
    .maybeSingle();
  if (connectionError) return jsonError("De opgeslagen Predis-koppeling kon niet worden gecontroleerd.", 500);
  const brandId = savedConnection?.connection_status === "connected" ? String(savedConnection.external_account_id || "").trim() : "";
  if (!brandId) return jsonError("Koppel voor deze vestiging eerst een Predis-merk onder Koppelingen.", 409);
  if (requestedBrandId !== brandId) return jsonError("Het Predis-merk komt niet overeen met de opgeslagen koppeling voor deze vestiging.", 409);
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

async function savePredisConnection({ workspaceId, business, brandId }) {
  const admin = createAdminSupabase();
  const { data: existing, error: readError } = await admin.from("integration_accounts")
    .select("id")
    .eq("workspace_id", workspaceId).eq("business_id", business.id).eq("provider", "predis")
    .maybeSingle();
  if (readError) return { error: jsonError("De Predis-koppeling kon niet worden opgeslagen.", 500) };
  const record = {
    workspace_id: workspaceId,
    business_id: business.id,
    provider: "predis",
    external_account_id: brandId,
    display_name: `${business.name} — Predis`,
    account_type: "predis_brand",
    connection_status: "connected",
    granted_scopes: ["content:read", "content:create"],
    last_synced_at: new Date().toISOString(),
    last_error_code: null,
    last_error_at: null,
  };
  const { error } = existing?.id
    ? await admin.from("integration_accounts").update(record).eq("id", existing.id).eq("workspace_id", workspaceId)
    : await admin.from("integration_accounts").insert(record);
  if (error?.code === "23505") return { error: jsonError("Dit Predis-merk is al aan een andere koppeling toegewezen.", 409) };
  return error ? { error: jsonError("De Predis-koppeling kon niet worden opgeslagen.", 500) } : { ok: true };
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
