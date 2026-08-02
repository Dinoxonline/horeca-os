import { NextResponse } from "next/server";
import { createAdminSupabase, createUserSupabase } from "../../../../lib/server-supabase";

export async function GET(request) {
  const context = await requireUserManager(request);
  if (context.error) return context.error;

  try {
    const admin = createAdminSupabase();
    const workspaceId = request.nextUrl.searchParams.get("workspaceId");
    if (!workspaceId || workspaceId !== context.workspaceId) {
      return jsonError("Ongeldige werkruimte.", 400);
    }

    const [authResult, membersResult, assignmentsResult, rolesResult, businessesResult, locationsResult] = await Promise.all([
      admin.auth.admin.listUsers({ page: 1, perPage: 1000 }),
      admin.from("workspace_members").select("user_id, role, created_at").eq("workspace_id", workspaceId),
      admin.from("user_role_assignments").select("id, user_id, role_id, business_id, location_id, role:roles!inner(role_key, name)").eq("workspace_id", workspaceId),
      admin.from("roles").select("id, role_key, name, description, is_system").eq("workspace_id", workspaceId).order("name"),
      admin.from("businesses").select("id, name").eq("workspace_id", workspaceId).eq("active", true).order("name"),
      admin.from("business_locations").select("id, business_id, name").eq("workspace_id", workspaceId).eq("active", true).order("name"),
    ]);

    const firstError = authResult.error || membersResult.error || assignmentsResult.error || rolesResult.error || businessesResult.error || locationsResult.error;
    if (firstError) throw firstError;

    const memberMap = new Map((membersResult.data || []).map((item) => [item.user_id, item]));
    const assignmentsByUser = new Map();
    for (const assignment of assignmentsResult.data || []) {
      assignmentsByUser.set(assignment.user_id, [...(assignmentsByUser.get(assignment.user_id) || []), assignment]);
    }

    const users = (authResult.data?.users || [])
      .filter((user) => memberMap.has(user.id))
      .map((user) => ({
        id: user.id,
        email: user.email,
        fullName: user.user_metadata?.full_name || user.user_metadata?.name || "",
        confirmed: Boolean(user.email_confirmed_at),
        invitedAt: user.invited_at,
        lastSignInAt: user.last_sign_in_at,
        membership: memberMap.get(user.id),
        assignments: assignmentsByUser.get(user.id) || [],
      }));

    return NextResponse.json({
      users,
      roles: rolesResult.data || [],
      businesses: businessesResult.data || [],
      locations: locationsResult.data || [],
      currentUserId: context.user.id,
    });
  } catch (error) {
    console.error("User management read failed", { error: error.message });
    return jsonError(adminErrorMessage(error), 500);
  }
}

export async function POST(request) {
  const context = await requireUserManager(request);
  if (context.error) return context.error;

  let body;
  try {
    body = await request.json();
  } catch {
    return jsonError("Ongeldig verzoek.", 400);
  }

  const { action, workspaceId } = body;
  if (!workspaceId || workspaceId !== context.workspaceId) return jsonError("Ongeldige werkruimte.", 400);

  try {
    const admin = createAdminSupabase();
    const scope = await validateRoleAndScope(admin, workspaceId, body.roleId, body.businessId, body.locationId);
    if (scope.error) return scope.error;

    if (action === "invite") {
      const email = String(body.email || "").trim().toLowerCase();
      const fullName = String(body.fullName || "").trim();
      if (!email || !email.includes("@")) return jsonError("Vul een geldig e-mailadres in.", 400);

      const redirectTo = process.env.NEXT_PUBLIC_SITE_URL || new URL("/dashboard", request.url).toString();
      const { data, error } = await admin.auth.admin.inviteUserByEmail(email, {
        data: { full_name: fullName },
        redirectTo,
      });
      if (error) throw error;
      const user = data.user;
      if (!user) throw new Error("Uitgenodigde gebruiker ontbreekt.");

      const membershipRole = legacyMembershipRole(scope.role.role_key);
      const profileResult = await admin.from("profiles").upsert({
        id: user.id,
        email,
        full_name: fullName || null,
      }, { onConflict: "id" });
      if (profileResult.error) throw profileResult.error;

      const memberResult = await admin.from("workspace_members").upsert({
        workspace_id: workspaceId,
        user_id: user.id,
        role: membershipRole,
      }, { onConflict: "workspace_id,user_id" });
      if (memberResult.error) throw memberResult.error;

      const assignmentResult = await admin.from("user_role_assignments").insert({
        workspace_id: workspaceId,
        user_id: user.id,
        role_id: body.roleId,
        business_id: body.businessId || null,
        location_id: body.locationId || null,
        assigned_by: context.user.id,
      });
      if (assignmentResult.error) throw assignmentResult.error;

      return NextResponse.json({ ok: true, message: "Uitnodiging is verstuurd." });
    }

    if (action === "replace-assignment") {
      const userId = String(body.userId || "");
      if (!userId) return jsonError("Gebruiker ontbreekt.", 400);

      const { data: currentAssignments, error: currentError } = await admin
        .from("user_role_assignments")
        .select("role:roles!inner(role_key)")
        .eq("workspace_id", workspaceId)
        .eq("user_id", userId);
      if (currentError) throw currentError;

      const removingOwner = (currentAssignments || []).some((item) => item.role?.role_key === "owner") && scope.role.role_key !== "owner";
      if (removingOwner) {
        const { count, error: countError } = await admin
          .from("user_role_assignments")
          .select("id, roles!inner(role_key)", { count: "exact", head: true })
          .eq("workspace_id", workspaceId)
          .eq("roles.role_key", "owner")
          .neq("user_id", userId);
        if (countError) throw countError;
        if (!count) return jsonError("De laatste eigenaar kan niet worden gewijzigd.", 409);
      }

      const deleteResult = await admin.from("user_role_assignments").delete().eq("workspace_id", workspaceId).eq("user_id", userId);
      if (deleteResult.error) throw deleteResult.error;

      const insertResult = await admin.from("user_role_assignments").insert({
        workspace_id: workspaceId,
        user_id: userId,
        role_id: body.roleId,
        business_id: body.businessId || null,
        location_id: body.locationId || null,
        assigned_by: context.user.id,
      });
      if (insertResult.error) throw insertResult.error;

      const memberResult = await admin.from("workspace_members").update({
        role: legacyMembershipRole(scope.role.role_key),
      }).eq("workspace_id", workspaceId).eq("user_id", userId);
      if (memberResult.error) throw memberResult.error;

      return NextResponse.json({ ok: true, message: "Rol en toegang zijn bijgewerkt." });
    }

    return jsonError("Onbekende beheeractie.", 400);
  } catch (error) {
    console.error("User management write failed", { action, error: error.message });
    return jsonError(adminErrorMessage(error), 500);
  }
}

async function requireUserManager(request) {
  const token = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  if (!token) return { error: jsonError("Niet ingelogd.", 401) };

  const supabase = createUserSupabase(token);
  const { data, error } = await supabase.auth.getUser(token);
  const user = data?.user;
  if (error || !user) return { error: jsonError("Sessie is verlopen.", 401) };

  const workspaceId = request.method === "GET"
    ? request.nextUrl.searchParams.get("workspaceId")
    : await readWorkspaceId(request.clone());
  if (!workspaceId) return { error: jsonError("Werkruimte ontbreekt.", 400) };

  const { data: assignments, error: roleError } = await supabase
    .from("user_role_assignments")
    .select("role:roles!inner(role_key, role_permissions(permission))")
    .eq("workspace_id", workspaceId)
    .eq("user_id", user.id);
  if (roleError) return { error: jsonError("Rechten konden niet worden gecontroleerd.", 403) };

  const allowed = (assignments || []).some((assignment) => {
    const permissions = assignment.role?.role_permissions?.map((item) => item.permission) || [];
    return assignment.role?.role_key === "owner" || permissions.includes("users:manage");
  });
  if (!allowed) return { error: jsonError("Geen toegang tot gebruikersbeheer.", 403) };
  return { user, workspaceId };
}

async function readWorkspaceId(request) {
  try {
    const body = await request.json();
    return body.workspaceId || null;
  } catch {
    return null;
  }
}

async function validateRoleAndScope(admin, workspaceId, roleId, businessId, locationId) {
  if (!roleId) return { error: jsonError("Kies een rol.", 400) };
  if (locationId && !businessId) return { error: jsonError("Een locatie vereist een bedrijf.", 400) };

  const { data: role, error: roleError } = await admin.from("roles").select("id, role_key").eq("id", roleId).eq("workspace_id", workspaceId).maybeSingle();
  if (roleError || !role) return { error: jsonError("Rol hoort niet bij deze werkruimte.", 400) };

  if (businessId) {
    const { data: business } = await admin.from("businesses").select("id").eq("id", businessId).eq("workspace_id", workspaceId).maybeSingle();
    if (!business) return { error: jsonError("Bedrijf hoort niet bij deze werkruimte.", 400) };
  }
  if (locationId) {
    const { data: location } = await admin.from("business_locations").select("id").eq("id", locationId).eq("workspace_id", workspaceId).eq("business_id", businessId).maybeSingle();
    if (!location) return { error: jsonError("Locatie hoort niet bij het gekozen bedrijf.", 400) };
  }
  return { role };
}

function legacyMembershipRole(roleKey) {
  if (roleKey === "owner") return "owner";
  if (roleKey === "manager") return "manager";
  if (roleKey === "viewer") return "viewer";
  return "employee";
}

function adminErrorMessage(error) {
  if (/beheersleutel/i.test(error.message)) return "Gebruikersbeheer is nog niet geconfigureerd op de server.";
  if (/already|registered|exists/i.test(error.message)) return "Dit e-mailadres bestaat al.";
  return "Gebruikersbeheer kon de actie niet uitvoeren.";
}

function jsonError(message, status) {
  return NextResponse.json({ error: message }, { status });
}
