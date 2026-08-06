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

    const [authResult, membersResult, assignmentsResult, rolesResult, businessesResult, locationsResult, employeesResult] = await Promise.all([
      admin.auth.admin.listUsers({ page: 1, perPage: 1000 }),
      admin.from("workspace_members").select("user_id, role, created_at").eq("workspace_id", workspaceId),
      admin.from("user_role_assignments").select("id, user_id, role_id, business_id, location_id, role:roles!inner(role_key, name)").eq("workspace_id", workspaceId),
      admin.from("roles").select("id, role_key, name, description, is_system").eq("workspace_id", workspaceId).order("name"),
      admin.from("businesses").select("id, name").eq("workspace_id", workspaceId).eq("active", true).order("name"),
      admin.from("business_locations").select("id, business_id, name").eq("workspace_id", workspaceId).eq("active", true).order("name"),
      admin.from("employee_profiles").select("*").eq("workspace_id", workspaceId).order("ranking").order("last_name"),
    ]);

    const firstError = authResult.error || membersResult.error || assignmentsResult.error || rolesResult.error || businessesResult.error || locationsResult.error || employeesResult.error;
    if (firstError) throw firstError;

    const memberMap = new Map((membersResult.data || []).map((item) => [item.user_id, item]));
    const assignmentsByUser = new Map();
    for (const assignment of assignmentsResult.data || []) {
      assignmentsByUser.set(assignment.user_id, [...(assignmentsByUser.get(assignment.user_id) || []), assignment]);
    }

    const employees = await Promise.all((employeesResult.data || []).map(async (employee) => {
      const { data: sensitiveRows, error: sensitiveError } = await admin.rpc("get_employee_sensitive", { p_employee_id: employee.id });
      if (sensitiveError) throw sensitiveError;
      const sensitive = sensitiveRows?.[0] || {};
      return {
        ...employee,
        birth_date: sensitive.birth_date || null,
        wage_amount: sensitive.wage_amount ?? null,
        has_bsn: Boolean(sensitive.bsn),
        bsn_last_four: sensitive.bsn ? String(sensitive.bsn).replace(/\D/g, "").slice(-4) : "",
        has_iban: Boolean(sensitive.iban),
        iban_masked: maskIban(sensitive.iban),
        has_pin: Boolean(sensitive.pin_code),
      };
    }));
    const employeeByUser = new Map(employees.filter((item) => item.user_id).map((item) => [item.user_id, item]));

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
        employee: employeeByUser.get(user.id) || null,
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

    if (action === "invite") {
      const scope = await validateRoleAndScope(admin, workspaceId, body.roleId, body.businessId, body.locationId);
      if (scope.error) return scope.error;
      const email = String(body.email || "").trim().toLowerCase();
      const firstName = cleanText(body.firstName, 100);
      const lastName = cleanText(body.lastName, 100);
      const fullName = `${firstName} ${lastName}`.trim();
      if (!firstName || !lastName) return jsonError("Voornaam en achternaam zijn verplicht.", 400);
      if (!email || !email.includes("@")) return jsonError("Vul een geldig e-mailadres in.", 400);
      const robuustRoles = cleanChoiceList(body.robuustRoles, ROBUUST_ROLES);
      const functions = cleanChoiceList(body.functions, EMPLOYEE_FUNCTIONS);
      const competencies = cleanText(body.competencies, 1000).split(",").map((item) => item.trim()).filter(Boolean).slice(0, 30);
      const wageType = ["hourly", "monthly"].includes(body.wageType) ? body.wageType : null;
      const ranking = Number.isInteger(Number(body.ranking)) ? Math.max(-1, Number(body.ranking)) : 10;
      const wageAmount = body.wageAmount === "" || body.wageAmount == null ? null : Number(body.wageAmount);
      if (wageAmount != null && (!Number.isFinite(wageAmount) || wageAmount < 0)) return jsonError("Vul een geldig loonbedrag in.", 400);

      const redirectTo = new URL("/account-activeren", request.url).toString();
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

      const { data: employee, error: employeeError } = await admin.from("employee_profiles").insert({
        workspace_id: workspaceId,
        user_id: user.id,
        first_name: firstName,
        last_name: lastName,
        email,
        employee_number: cleanNullable(body.employeeNumber, 80),
        phone: cleanNullable(body.phone, 40),
        employment_start: cleanDate(body.employmentStart),
        employment_end: cleanDate(body.employmentEnd),
        address: cleanNullable(body.address, 200),
        postal_code: cleanNullable(body.postalCode, 20),
        city: cleanNullable(body.city, 100),
        birthplace: cleanNullable(body.birthplace, 100),
        competencies,
        robuust_roles: robuustRoles,
        functions,
        wage_type: wageType,
        ranking,
        active: ranking !== -1,
        external_provider: "robuust",
        external_employee_id: cleanNullable(body.externalEmployeeId, 120),
        sync_status: body.externalEmployeeId ? "pending" : "not_linked",
        created_by: context.user.id,
        updated_by: context.user.id,
      }).select("id").single();
      if (employeeError) throw employeeError;

      const { error: sensitiveError } = await admin.rpc("upsert_employee_sensitive", {
        p_employee_id: employee.id,
        p_birth_date: cleanDate(body.birthDate),
        p_bsn: cleanNullable(body.bsn, 20),
        p_iban: cleanNullable(body.iban, 40),
        p_pin_code: cleanNullable(body.pinCode, 40),
        p_wage_amount: wageAmount,
      });
      if (sensitiveError) throw sensitiveError;

      const { error: employeeAuditError } = await admin.from("employee_profile_audit").insert({
        workspace_id: workspaceId,
        employee_id: employee.id,
        actor_id: context.user.id,
        action: "created",
        changed_fields: [
          "first_name", "last_name", "email", "employee_number", "phone", "employment_start", "employment_end",
          "address", "postal_code", "city", "birthplace", "birth_date", "competencies", "robuust_roles",
          "functions", "wage_type", "wage_amount", "bsn", "iban", "pin_code", "ranking", "external_employee_id",
        ],
      });
      if (employeeAuditError) throw employeeAuditError;

      const assignmentResult = await admin.from("user_role_assignments").insert({
        workspace_id: workspaceId,
        user_id: user.id,
        role_id: body.roleId,
        business_id: body.businessId || null,
        location_id: body.locationId || null,
        assigned_by: context.user.id,
      });
      if (assignmentResult.error) throw assignmentResult.error;

      return NextResponse.json({ ok: true, message: "Medewerker, account en volledig personeelsdossier zijn aangemaakt. De activatielink is verstuurd." });
    }

    if (action === "replace-assignment") {
      const scope = await validateRoleAndScope(admin, workspaceId, body.roleId, body.businessId, body.locationId);
      if (scope.error) return scope.error;
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

    if (action === "save-employee") {
      const userId = String(body.userId || "");
      if (!userId) return jsonError("Gebruiker ontbreekt.", 400);
      const { data: member } = await admin.from("workspace_members").select("user_id").eq("workspace_id", workspaceId).eq("user_id", userId).maybeSingle();
      if (!member) return jsonError("Gebruiker hoort niet bij deze werkruimte.", 400);

      const firstName = cleanText(body.firstName, 100);
      const lastName = cleanText(body.lastName, 100);
      const email = cleanText(body.email, 254).toLowerCase();
      if (!firstName || !lastName || !email || !email.includes("@")) return jsonError("Voornaam, achternaam en een geldig e-mailadres zijn verplicht.", 400);

      const robuustRoles = cleanChoiceList(body.robuustRoles, ROBUUST_ROLES);
      const functions = cleanChoiceList(body.functions, EMPLOYEE_FUNCTIONS);
      const competencies = Array.isArray(body.competencies)
        ? body.competencies.map((item) => cleanText(item, 80)).filter(Boolean).slice(0, 30)
        : cleanText(body.competencies, 1000).split(",").map((item) => item.trim()).filter(Boolean).slice(0, 30);
      const wageType = ["hourly", "monthly"].includes(body.wageType) ? body.wageType : null;
      const ranking = Number.isInteger(Number(body.ranking)) ? Math.max(-1, Number(body.ranking)) : 10;

      const profilePayload = {
        workspace_id: workspaceId,
        user_id: userId,
        first_name: firstName,
        last_name: lastName,
        email,
        employee_number: cleanNullable(body.employeeNumber, 80),
        phone: cleanNullable(body.phone, 40),
        employment_start: cleanDate(body.employmentStart),
        employment_end: cleanDate(body.employmentEnd),
        address: cleanNullable(body.address, 200),
        postal_code: cleanNullable(body.postalCode, 20),
        city: cleanNullable(body.city, 100),
        birthplace: cleanNullable(body.birthplace, 100),
        competencies,
        robuust_roles: robuustRoles,
        functions,
        wage_type: wageType,
        ranking,
        active: ranking !== -1,
        external_provider: "robuust",
        external_employee_id: cleanNullable(body.externalEmployeeId, 120),
        sync_status: body.externalEmployeeId ? "pending" : "not_linked",
        updated_by: context.user.id,
      };

      const { data: existing, error: existingError } = await admin.from("employee_profiles").select("id").eq("workspace_id", workspaceId).eq("user_id", userId).maybeSingle();
      if (existingError) throw existingError;
      if (!existing) profilePayload.created_by = context.user.id;

      const profileQuery = existing
        ? admin.from("employee_profiles").update(profilePayload).eq("id", existing.id).select("id").single()
        : admin.from("employee_profiles").insert(profilePayload).select("id").single();
      const { data: employee, error: profileError } = await profileQuery;
      if (profileError) throw profileError;

      const { data: currentRows, error: currentError } = await admin.rpc("get_employee_sensitive", { p_employee_id: employee.id });
      if (currentError) throw currentError;
      const current = currentRows?.[0] || {};
      const bsn = cleanNullable(body.bsn, 20) || current.bsn || null;
      const iban = cleanNullable(body.iban, 40) || current.iban || null;
      const pinCode = cleanNullable(body.pinCode, 40) || current.pin_code || null;
      const birthDate = cleanDate(body.birthDate) || current.birth_date || null;
      const wageAmount = body.wageAmount === "" || body.wageAmount == null ? current.wage_amount ?? null : Number(body.wageAmount);
      if (wageAmount != null && (!Number.isFinite(wageAmount) || wageAmount < 0)) return jsonError("Vul een geldig loonbedrag in.", 400);

      const { error: sensitiveError } = await admin.rpc("upsert_employee_sensitive", {
        p_employee_id: employee.id,
        p_birth_date: birthDate,
        p_bsn: bsn,
        p_iban: iban,
        p_pin_code: pinCode,
        p_wage_amount: wageAmount,
      });
      if (sensitiveError) throw sensitiveError;

      const changedFields = Object.keys(body).filter((key) => !["action", "workspaceId", "bsn", "iban", "pinCode"].includes(key));
      if (body.bsn) changedFields.push("bsn");
      if (body.iban) changedFields.push("iban");
      if (body.pinCode) changedFields.push("pin_code");
      const { error: auditError } = await admin.from("employee_profile_audit").insert({
        workspace_id: workspaceId,
        employee_id: employee.id,
        actor_id: context.user.id,
        action: existing ? "updated" : "created",
        changed_fields: changedFields,
      });
      if (auditError) throw auditError;

      return NextResponse.json({ ok: true, message: "Personeelsgegevens zijn veilig opgeslagen." });
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
  if (verifiedTokenAal(token) !== "aal2") {
    return { error: jsonError("Bevestig eerst je tweestapsverificatie.", 403) };
  }

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

function verifiedTokenAal(token) {
  try {
    const payload = token.split(".")[1];
    if (!payload) return null;
    return JSON.parse(Buffer.from(payload, "base64url").toString("utf8")).aal || null;
  } catch {
    return null;
  }
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

const ROBUUST_ROLES = ["admin", "coworker", "manager hr", "manager operations", "manager kitchen", "manager customers", "manager finance", "deliverer"];
const EMPLOYEE_FUNCTIONS = ["admin", "bediening", "chefkok", "kok", "keukenhulp", "floormanager", "bezorgers", "mt"];

function cleanText(value, maxLength) { return String(value || "").trim().slice(0, maxLength); }
function cleanNullable(value, maxLength) { return cleanText(value, maxLength) || null; }
function cleanDate(value) { return /^\d{4}-\d{2}-\d{2}$/.test(String(value || "")) ? String(value) : null; }
function cleanChoiceList(value, allowed) {
  const input = Array.isArray(value) ? value : [];
  return [...new Set(input.map((item) => String(item).toLowerCase()).filter((item) => allowed.includes(item)))];
}
function maskIban(value) {
  const normalized = String(value || "").replace(/\s/g, "");
  if (!normalized) return "";
  return normalized.length <= 8 ? "â€¢â€¢â€¢â€¢" : `${normalized.slice(0, 4)} â€¢â€¢â€¢â€¢ â€¢â€¢â€¢â€¢ ${normalized.slice(-4)}`;
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

