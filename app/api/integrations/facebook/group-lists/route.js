import { NextResponse } from "next/server";
import { createAdminSupabase, createUserSupabase } from "../../../../../lib/server-supabase";

const selectFields = "id,name,group_ids,created_at,updated_at";

export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const context = await authorizedContext(request, searchParams.get("workspaceId"), searchParams.get("businessId"), false);
  if (context.error) return context.error;
  const { data, error } = await context.admin.from("facebook_group_lists").select(selectFields)
    .eq("workspace_id", context.workspaceId).eq("business_id", context.businessId).order("name");
  if (error) return jsonError("De opgeslagen groepenlijsten konden niet worden geladen.", 500);
  return NextResponse.json({ lists: data || [] });
}

export async function POST(request) {
  const body = await readBody(request);
  if (body.error) return body.error;
  const context = await authorizedContext(request, body.workspaceId, body.businessId, true);
  if (context.error) return context.error;
  const name = String(body.name || "").trim();
  const groupIds = normalizeGroupIds(body.groupIds);
  if (!name) return jsonError("Vul een naam in, bijvoorbeeld Karaoke of Wedding.", 400);
  if (!groupIds.length) return jsonError("Vink eerst minimaal één Facebookgroep aan.", 400);
  const validGroupIds = await validIds(context, groupIds);
  if (!validGroupIds.length) return jsonError("De gekozen Facebookgroepen zijn niet meer beschikbaar.", 400);
  const { data, error } = await context.admin.from("facebook_group_lists").insert({
    workspace_id: context.workspaceId, business_id: context.businessId, name, group_ids: validGroupIds, created_by: context.userId,
  }).select(selectFields).single();
  if (error?.code === "23505") return jsonError("Er bestaat al een groepenlijst met deze naam.", 409);
  if (error) return jsonError("De groepenlijst kon niet worden opgeslagen.", 500);
  return NextResponse.json({ list: data }, { status: 201 });
}

export async function PATCH(request) {
  const body = await readBody(request);
  if (body.error) return body.error;
  const context = await authorizedContext(request, body.workspaceId, body.businessId, true);
  if (context.error) return context.error;
  const groupIds = normalizeGroupIds(body.groupIds);
  if (!groupIds.length) return jsonError("Vink eerst minimaal één Facebookgroep aan.", 400);
  const validGroupIds = await validIds(context, groupIds);
  const { data, error } = await context.admin.from("facebook_group_lists").update({ group_ids: validGroupIds })
    .eq("id", body.listId).eq("workspace_id", context.workspaceId).eq("business_id", context.businessId)
    .select(selectFields).single();
  if (error) return jsonError("De groepenlijst kon niet worden bijgewerkt.", 500);
  return NextResponse.json({ list: data });
}

export async function DELETE(request) {
  const body = await readBody(request);
  if (body.error) return body.error;
  const context = await authorizedContext(request, body.workspaceId, body.businessId, true);
  if (context.error) return context.error;
  const { error } = await context.admin.from("facebook_group_lists").delete()
    .eq("id", body.listId).eq("workspace_id", context.workspaceId).eq("business_id", context.businessId);
  if (error) return jsonError("De groepenlijst kon niet worden verwijderd.", 500);
  return NextResponse.json({ ok: true });
}

async function validIds(context, ids) {
  const { data } = await context.admin.from("facebook_group_targets").select("id")
    .eq("workspace_id", context.workspaceId).eq("business_id", context.businessId).eq("is_active", true).in("id", ids);
  return (data || []).map((item) => item.id);
}

function normalizeGroupIds(value) {
  return [...new Set((Array.isArray(value) ? value : []).map((id) => String(id)).filter((id) => /^[0-9a-f-]{36}$/i.test(id)))];
}

async function readBody(request) {
  try { return await request.json(); } catch { return { error: jsonError("Ongeldig verzoek.", 400) }; }
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
  return allowed ? { admin: createAdminSupabase(), workspaceId, businessId, userId: authData.user.id } : { error: jsonError("Je hebt geen toegang tot de groepenlijsten van deze vestiging.", 403) };
}

function jsonError(error, status) { return NextResponse.json({ error }, { status }); }
