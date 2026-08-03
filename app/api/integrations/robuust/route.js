import { NextResponse } from "next/server";
import { createAdminSupabase, createUserSupabase } from "../../../../lib/server-supabase";

const ROBUUST_BASE_URL = "https://us-central1-robuust-prd2.cloudfunctions.net/reservations";

export async function GET(request) {
  const context = await requireIntegrationManager(request);
  if (context.error) return context.error;
  const workspaceId = request.nextUrl.searchParams.get("workspaceId");
  if (!workspaceId || workspaceId !== context.workspaceId) return jsonError("Ongeldige werkruimte.", 400);

  const admin = createAdminSupabase();
  const { data, error } = await admin.from("integration_accounts")
    .select("id,business_id,external_account_id,display_name,connection_status,granted_scopes,last_synced_at,last_error_code,last_error_at")
    .eq("workspace_id", workspaceId).eq("provider", "robuust").order("created_at");
  if (error) return jsonError("Robuust-koppelingen konden niet worden geladen.", 500);
  return NextResponse.json({ accounts: data || [] });
}

export async function POST(request) {
  const context = await requireIntegrationManager(request);
  if (context.error) return context.error;

  let body;
  try { body = await request.json(); } catch { return jsonError("Ongeldig verzoek.", 400); }
  const workspaceId = String(body.workspaceId || "");
  const businessId = String(body.businessId || "");
  const pid = String(body.pid || "").trim();
  const apiKey = String(body.apiKey || "").trim();
  if (workspaceId !== context.workspaceId) return jsonError("Ongeldige werkruimte.", 400);
  if (!businessId || !pid || !apiKey) return jsonError("Vestiging, Robuust PID en API-sleutel zijn verplicht.", 400);

  const admin = createAdminSupabase();
  const { data: business } = await admin.from("businesses").select("id,name").eq("id", businessId).eq("workspace_id", workspaceId).maybeSingle();
  if (!business) return jsonError("Vestiging hoort niet bij deze werkruimte.", 400);

  const { data: accountId, error: configureError } = await admin.rpc("configure_robuust_account", {
    p_workspace_id: workspaceId, p_business_id: businessId, p_pid: pid, p_api_key: apiKey,
  });
  if (configureError || !accountId) return jsonError("Robuust-inloggegevens konden niet veilig worden opgeslagen.", 500);

  const { data: secretRows, error: secretError } = await admin.rpc("get_robuust_account_secret", { p_account_id: accountId });
  const secret = secretRows?.[0];
  if (secretError || !secret?.api_key) return jsonError("De versleutelde Robuust-sleutel kon niet worden gebruikt.", 500);

  const jobKey = `robuust_connection_${accountId}_${Date.now()}`;
  const { data: job } = await admin.from("integration_sync_jobs").insert({
    workspace_id: workspaceId, business_id: businessId, account_id: accountId,
    job_type: "partner_company_discovery", status: "running", idempotency_key: jobKey,
    attempt_count: 1, started_at: new Date().toISOString(),
  }).select("id").single();

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 12000);
    const response = await fetch(
      `${ROBUUST_BASE_URL}/v1/customer/${encodeURIComponent(secret.pid)}/${encodeURIComponent(secret.api_key)}`,
      { method: "GET", headers: { Accept: "application/json" }, signal: controller.signal, cache: "no-store" }
    );
    clearTimeout(timeout);
    const result = await response.json().catch(() => null);
    const partner = Array.isArray(result?.data) ? result.data[0] : null;
    if (!response.ok || result?.success !== true || !partner) throw new Error("connection_rejected");

    await admin.from("integration_accounts").update({
      display_name: String(partner.name || business.name).slice(0, 160),
      external_account_id: String(partner.pid || pid),
      connection_status: "connected",
      last_synced_at: new Date().toISOString(),
      last_error_code: null,
      last_error_at: null,
      updated_at: new Date().toISOString(),
    }).eq("id", accountId);
    if (job?.id) await admin.from("integration_sync_jobs").update({
      status: "succeeded", records_processed: 1, finished_at: new Date().toISOString(),
    }).eq("id", job.id);

    return NextResponse.json({
      ok: true,
      message: `Robuust is gekoppeld met ${partner.name || business.name}.`,
      account: { id: accountId, pid: partner.pid || pid, name: partner.name || business.name, status: "connected" },
    });
  } catch {
    await admin.from("integration_accounts").update({
      connection_status: "degraded", last_error_code: "connection_failed",
      last_error_at: new Date().toISOString(), updated_at: new Date().toISOString(),
    }).eq("id", accountId);
    if (job?.id) await admin.from("integration_sync_jobs").update({
      status: "failed", error_code: "connection_failed",
      error_message: "Robuust rejected or did not answer the connection test.",
      finished_at: new Date().toISOString(),
    }).eq("id", job.id);
    return jsonError("Robuust kon de PID en API-sleutel niet bevestigen. Controleer de gegevens of vraag Robuust support om API-toegang.", 502);
  }
}

async function requireIntegrationManager(request) {
  const token = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  if (!token) return { error: jsonError("Niet ingelogd.", 401) };
  const supabase = createUserSupabase(token);
  const { data, error } = await supabase.auth.getUser(token);
  const user = data?.user;
  if (error || !user) return { error: jsonError("Sessie is verlopen.", 401) };
  if (verifiedTokenAal(token) !== "aal2") return { error: jsonError("Bevestig eerst je tweestapsverificatie.", 403) };

  const workspaceId = request.method === "GET"
    ? request.nextUrl.searchParams.get("workspaceId")
    : await readWorkspaceId(request.clone());
  if (!workspaceId) return { error: jsonError("Werkruimte ontbreekt.", 400) };

  const { data: assignments, error: roleError } = await supabase.from("user_role_assignments")
    .select("role:roles!inner(role_key,role_permissions(permission))")
    .eq("workspace_id", workspaceId).eq("user_id", user.id);
  if (roleError) return { error: jsonError("Rechten konden niet worden gecontroleerd.", 403) };
  const allowed = (assignments || []).some((assignment) => {
    const permissions = assignment.role?.role_permissions?.map((item) => item.permission) || [];
    return assignment.role?.role_key === "owner" || permissions.includes("integrations:manage");
  });
  return allowed ? { user, workspaceId } : { error: jsonError("Geen toegang tot koppelingenbeheer.", 403) };
}

function verifiedTokenAal(token) {
  try {
    const payload = token.split(".")[1];
    return payload ? JSON.parse(Buffer.from(payload, "base64url").toString("utf8")).aal || null : null;
  } catch { return null; }
}
async function readWorkspaceId(request) {
  try { return (await request.json()).workspaceId || null; } catch { return null; }
}
function jsonError(message, status) { return NextResponse.json({ error: message }, { status }); }
