import { NextResponse } from "next/server";
import { createAdminSupabase, createUserSupabase } from "../../../../../lib/server-supabase";

export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const context = await authorizedContext(request, searchParams.get("workspaceId"), searchParams.get("businessId"), false);
  if (context.error) return context.error;
  const { data, error } = await context.admin.from("facebook_group_targets")
    .select("id,name,group_url,is_active,created_at")
    .eq("workspace_id", context.workspaceId).eq("business_id", context.businessId).eq("is_active", true)
    .order("name");
  if (error) return jsonError("De Facebookgroepen konden niet worden geladen.", 500);
  return NextResponse.json({ groups: data || [] });
}

export async function POST(request) {
  let body;
  try { body = await request.json(); } catch { return jsonError("Ongeldig verzoek.", 400); }
  const context = await authorizedContext(request, body.workspaceId, body.businessId, true);
  if (context.error) return context.error;
  const name = String(body.name || "").trim();
  const groupUrl = normalizeGroupUrl(body.groupUrl);
  if (!name) return jsonError("Vul een herkenbare groepsnaam in.", 400);
  if (!groupUrl) return jsonError("Gebruik een geldige Facebook-groepslink.", 400);
  const { data, error } = await context.admin.from("facebook_group_targets").insert({
    workspace_id: context.workspaceId, business_id: context.businessId, name, group_url: groupUrl, created_by: context.userId,
  }).select("id,name,group_url,is_active,created_at").single();
  if (error?.code === "23505") return jsonError("Deze Facebookgroep staat al in de lijst.", 409);
  if (error) return jsonError("De Facebookgroep kon niet worden opgeslagen.", 500);
  return NextResponse.json({ group: data }, { status: 201 });
}

export async function DELETE(request) {
  let body;
  try { body = await request.json(); } catch { return jsonError("Ongeldig verzoek.", 400); }
  const context = await authorizedContext(request, body.workspaceId, body.businessId, true);
  if (context.error) return context.error;
  const { error } = await context.admin.from("facebook_group_targets").delete()
    .eq("id", body.groupId).eq("workspace_id", context.workspaceId).eq("business_id", context.businessId);
  if (error) return jsonError("De Facebookgroep kon niet worden verwijderd.", 500);
  return NextResponse.json({ ok: true });
}

function normalizeGroupUrl(value) {
  try {
    const url = new URL(String(value || "").trim());
    if (!["facebook.com", "www.facebook.com"].includes(url.hostname.toLowerCase()) || !url.pathname.startsWith("/groups/")) return "";
    const slug = url.pathname.split("/").filter(Boolean)[1];
    return slug ? `https://www.facebook.com/groups/${slug}` : "";
  } catch { return ""; }
}

async function authorizedContext(request, workspaceId, businessId, manage) {
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
    const permissions = assignment.role?.role_key === "custom" ? assignment.assignment_permissions?.map((item) => item.permission) || [] : assignment.role?.role_permissions?.map((item) => item.permission) || [];
    return assignment.role?.role_key === "owner" || permissions.includes(manage ? "social:manage" : "social:read") || permissions.includes("marketing:manage");
  });
  return allowed ? { admin: createAdminSupabase(), workspaceId, businessId, userId: authData.user.id } : { error: jsonError("Je hebt geen toegang tot de Facebookgroepen van deze vestiging.", 403) };
}

function jsonError(error, status) { return NextResponse.json({ error }, { status }); }
