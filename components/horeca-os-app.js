Warning: truncated output (original token count: 78413)
Total output lines: 4438

"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { supabase } from "../lib/supabase";
import CentralEventCreator from "./central-event-creator";
import Workboard from "./workboard";
import ProcessTrash from "./process-trash";
import ProcessAudit from "./process-audit";
import ManagerLogbook from "./manager-logbook";
import Documents from "./documents";
import StaffTicketForm from "./staff-ticket-form";
import StaffTickets from "./staff-tickets";

const priorityRank = { critical: 0, high: 1, medium: 2, low: 3 };
const priorityLabel = { critical: "Kritiek", high: "Hoog", medium: "Midden", low: "Laag" };
const statusLabel = { not_started: "Niet gestart", in_progress: "Bezig", blocked: "Geblokkeerd", done: "Gereed" };
const integrationStatusLabel = { not_started: "Niet gestart", in_progress: "Bezig", blocked: "Geblokkeerd", connected: "Verbonden", error: "Fout" };

const emptyData = {
  tasks: [], processTasks: [], businesses: [], decisions: [], events: [], sales: [], products: [], security: [], integrations: [],
  suppliers: [], foodProducts: [], ingredients: [], recipes: [], recipeItems: [], menuItems: [], aiConversations: [],
};

const routeViews = {
  "/dashboard": "dashboard",
  "/werkbord": "workboard",
  "/werkbord/prullenbak": "processTrash",
  "/werkbord/logboek": "processAudit",
  "/werkbord/manager-logboek": "managerLogbook",
  "/werkbord/tickets": "staffTickets",
  "/documenten": "documents",
  "/foodcost": "foodcost",
  "/producten": "products",
  "/recepten": "recipes",
  "/leveranciers": "suppliers",
  "/reviews": "reviews",
  "/social-inbox": "social",
  "/mail-agenda": "mail",
  "/mail": "mail",
  "/agenda": "calendar",
  "/marketing": "marketing",
  "/ai": "assistant",
  "/gebruikers": "users",
  "/uren": "hours",
  "/rooster": "schedule",
  "/koppelingen": "integrations",
  "/beveiliging": "security",
};

export default function HorecaOsApp() {
  const pathname = usePathname();
  if (pathname.startsWith("/medewerkers/")) return <StaffTicketForm token={decodeURIComponent(pathname.split("/")[2] || "")} />;
  const recoveryPage = pathname === "/wachtwoord-herstellen";
  const [session, setSession] = useState(null);
  const [passwordRecovery, setPasswordRecovery] = useState(() => typeof window !== "undefined" && (
    window.location.hash.includes("type=recovery")
    || window.location.search.includes("type=recovery")
    || window.sessionStorage.getItem("horeca-os-password-recovery-verified") === "pending"
  ));
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [message, setMessage] = useState("");
  const workspaceSessionRefreshAttempted = useRef("");
  const [memberships, setMemberships] = useState([]);
  const [membershipsLoading, setMembershipsLoading] = useState(true);
  const [roleAssignments, setRoleAssignments] = useState([]);
  const [rolesLoading, setRolesLoading] = useState(true);
  const [mfaState, setMfaState] = useState({ loading: true, currentLevel: null, nextLevel: null, factors: [] });
  const [workspaceId, setWorkspaceId] = useState("");
  const [businessId, setBusinessId] = useState("all");
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [workboardOpen, setWorkboardOpen] = useState(pathname.startsWith("/werkbord/"));
  const [data, setData] = useState(emptyData);
  const activeView = routeViews[pathname] || "dashboard";

  useEffect(() => { setMobileMenuOpen(false); setWorkboardOpen(pathname.startsWith("/werkbord/")); }, [pathname]);

  useEffect(() => {
    const recoveryFromUrl = window.location.hash.includes("type=recovery")
      || window.location.search.includes("type=recovery");
    const recoveryPending = recoveryFromUrl || window.sessionStorage.getItem("horeca-os-password-recovery-verified") === "pending";
    if (recoveryPending) {
      window.sessionStorage.setItem("horeca-os-password-recovery-verified", "pending");
      setPasswordRecovery(true);
    }
    supabase.auth.getSession().then(({ data: authData }) => {
      setSession(authData.session);
      if (recoveryPending && !authData.session) {
        setMessage("Deze herstellink is verlopen of al gebruikt. Vraag hieronder een nieuwe herstelmail aan.");
      }
      setLoading(false);
    });
    const { data: listener } = supabase.auth.onAuthStateChange((event, nextSession) => {
      if (event === "PASSWORD_RECOVERY") {
        window.sessionStorage.setItem("horeca-os-password-recovery-verified", "pending");
        setPasswordRecovery(true);
      }
      if (event === "SIGNED_IN") {
        workspaceSessionRefreshAttempted.current = "";
      }
      if (event === "SIGNED_OUT") {
        workspaceSessionRefreshAttempted.current = "";
        window.sessionStorage.removeItem("horeca-os-password-recovery");
        window.sessionStorage.removeItem("horeca-os-password-recovery-verified");
        setPasswordRecovery(false);
      }
      setSession(nextSession);
    });
    return () => listener.subscription.unsubscribe();
  }, []);

  useEffect(() => {
    if (!session || passwordRecovery) return;
    let active = true;

    const loadMemberships = async () => {
      setMembershipsLoading(true);
      const queryMemberships = () => supabase
        .from("workspace_members")
        .select("workspace_id, role, workspace:workspaces!workspace_members_workspace_id_fkey(id, name)")
        .eq("user_id", session.user.id);

      let { data: rows, error } = await queryMemberships();
      if (!active) return;

      const issuedInFuture = error?.message?.toLowerCase().includes("jwt issued at future");
      if (issuedInFuture && workspaceSessionRefreshAttempted.current !== session.user.id) {
        workspaceSessionRefreshAttempted.current = session.user.id;
        const { data: refreshed, error: refreshError } = await supabase.auth.refreshSession();
        if (!active) return;
        if (refreshError || !refreshed.session) {
          setMessage("Je beveiligde sessie kon niet worden vernieuwd. Log uit en opnieuw in.");
          setMembershipsLoading(false);
          return;
        }
        setMessage("Je beveiligde sessie is vernieuwd. De werkruimtes worden opnieuw geladen.");
        setSession(refreshed.session);
        return;
      }

      if (error) {
        setMessage(`Werkruimtes konden niet worden geladen: ${error.message}`);
        setMembershipsLoading(false);
        return;
      }

      const available = rows || [];
      setMemberships(available);
      setWorkspaceId((current) => current || available[0]?.workspace_id || "");
      setMembershipsLoading(false);
      setMessage((current) => current.includes("JWT issued at future") || current.includes("beveiligde sessie") ? "" : current);
    };

    loadMemberships();
    return () => { active = false; };
  }, [session, mfaState.currentLevel, passwordRecovery]);

  useEffect(() => {
    if (!session || passwordRecovery || !workspaceId) {
      setRoleAssignments([]);
      setRolesLoading(false);
      return;
    }
    let active = true;
    setRolesLoading(true);
    supabase
      .from("user_role_assignments")
      .select("business_id, location_id, assignment_permissions(permission), role:roles!inner(role_key, role_permissions(permission))")
      .eq("user_id", session.user.id)
      .eq("workspace_id", workspaceId)
      .then(({ data: rows, error }) => {
        if (!active) return;
        if (error) {
          setRoleAssignments([]);
          setRolesLoading(false);
          return;
        }
        setRoleAssignments(rows || []);
        setRolesLoading(false);
      });
    return () => { active = false; };
  }, [passwordRecovery, session, workspaceId]);

  const refreshMfa = useCallback(async () => {
    if (!session || passwordRecovery) {
      setMfaState({ loading: false, currentLevel: null, nextLevel: null, factors: [] });
      return;
    }
    const [aalResult, factorResult] = await Promise.all([
      supabase.auth.mfa.getAuthenticatorAssuranceLevel(),
      supabase.auth.mfa.listFactors(),
    ]);
    if (aalResult.error || factorResult.error) {
      setMfaState({ loading: false, currentLevel: null, nextLevel: null, factors: [], error: aalResult.error?.message || factorResult.error?.message });
      return;
    }
    setMfaState({
      loading: false,
      currentLevel: aalResult.data.currentLevel,
      nextLevel: aalResult.data.nextLevel,
      factors: factorResult.data.totp || [],
      error: "",
    });
  }, [passwordRecovery, session]);

  useEffect(() => { refreshMfa(); }, [refreshMfa]);

  const loadData = useCallback(async () => {
    if (passwordRecovery || !workspaceId) return;
    setRefreshing(true);
    setMessage("");

    const ranges = getDateRanges(new Date());
    const scope = (query, supportsBusiness = true) => {
      let scoped = query.eq("workspace_id", workspaceId);
      if (supportsBusiness && businessId !== "all") scoped = scoped.eq("business_id", businessId);
      return scoped;
    };

    const results = await Promise.all([
      scope(supabase.from("tasks").select("*, assignee:profiles!tasks_assigned_to_fkey(full_name)")).order("created_at", { ascending: true }),
      scope(supabase.from("process_run_tasks").select("*, assignee:profiles!process_run_tasks_assigned_to_fkey(full_name), process_runs(name)")).order("due_date", { ascending: true }).limit(200),
      supabase.from("businesses").select("id, workspace_id, name, active").eq("workspace_id", workspaceId).eq("active", true).order("name"),
      scope(supabase.from("decisions").select("*")).order("decided_on", { ascending: false }).limit(50),
      scope(supabase.from("events").select("*")).gte("starts_at", new Date().toISOString()).order("starts_at").limit(8),
      scope(supabase.from("sales_daily").select("id, workspace_id, business_id, sales_date, revenue_inc_vat, order_count, takeaway_order_count, takeaway_revenue, own_channel_order_count, own_channel_revenue, delivery_order_count, pickup_order_count, avg_order_value"))
        .gte("sales_date", ranges.queryStart).lte("sales_date", ranges.today).order("sales_date", { ascending: false }),
      scope(supabase.from("product_sales").select("id, workspace_id, business_id, period_start, period_end, product_name, quantity"))
        .gte("period_end", ranges.monthStart).lte("period_start", ranges.today),
      scope(supabase.from("security_checks").select("*"), false).order("label"),
      scope(supabase.from("integrations").select("*"), false).order("provider"),
      scope(supabase.from("suppliers").select("id, workspace_id, business_id, location_id, name, active")).order("name"),
      scope(supabase.from("products").select("id, workspace_id, business_id, location_id, supplier_id, name, category, purchase_price, content_quantity, content_unit, currency_code, active")).order("name"),
      scope(supabase.from("ingredients").select("id, workspace_id, business_id, location_id, product_id, name, base_unit, units_per_product, yield_percentage, active")).order("name"),
      scope(supabase.from("recipes").select("id, workspace_id, business_id, location_id, name, target_foodcost_percentage, active")).order("name"),
      scope(supabase.from("recipe_items").select("id, workspace_id, business_id, location_id, recipe_id, product_id, ingredient_id, quantity, waste_percentage, line_order")).order("line_order"),
      scope(supabase.from("menu_items").select("id, workspace_id, business_id, location_id, recipe_id, name, category, selling_price, vat_rate, active")).order("name"),
      scope(supabase.from("ai_conversations").select("id, workspace_id, business_id, location_id, use_case, title, model, updated_at")).order("updated_at", { ascending: false }).limit(30),
    ]);

    const names = Object.keys(emptyData);
    const next = {};
    let firstError = null;
    results.forEach((result, index) => {
      next[names[index]] = result.data || [];
      if (!firstError && result.error) firstError = result.error;
    });
    setData(next);
    if (firstError) setMessage(`Niet alle onderdelen konden worden geladen: ${firstError.message}`);
    setRefreshing(false);
  }, [passwordRecovery, workspaceId, businessId]);

  useEffect(() => { loadData(); }, [loadData]);

  const analytics = useMemo(() => buildSalesAnalytics(data.sales, data.products, new Date()), [data.sales, data.products]);
  const activeWorkspace = memberships.find((membership) => membership.workspace_id === workspaceId);
  const activeBusiness = data.businesses.find((business) => business.id === businessId);
  const isOwner = activeWorkspace?.role === "owner" || roleAssignments.some((assignment) => assignment.role?.role_key === "owner");
  const hasWorkspaceWideRole = isOwner || roleAssignments.some((assignment) => !assignment.business_id);
  const assignedBusinessIds = useMemo(
    () => [...new Set(roleAssignments.map((assignment) => assignment.business_id).filter(Boolean))],
    [roleAssignments],
  );
  const visibleBusinesses = useMemo(
    () => hasWorkspaceWideRole ? data.businesses : data.businesses.filter((business) => assignedBusinessIds.includes(business.id)),
    [assignedBusinessIds, data.businesses, hasWorkspaceWideRole],
  );
  const canUseFeature = useCallback((permission) => {
    if (activeWorkspace?.role === "owner") return true;
    return roleAssignments.some((assignment) => {
      const businessMatches = !assignment.business_id || businessId === "all" || assignment.business_id === businessId;
      const permissions = assignment.role?.role_key === "custom"
        ? assignment.assignment_permissions?.map((item) => item.permission) || []
        : assignment.role?.role_permissions?.map((item) => item.permission) || [];
      return businessMatches && (assignment.role?.role_key === "owner" || permissions.includes(permission));
    });
  }, [activeWorkspace?.role, businessId, roleAssignments]);
  const featureVisibility = useMemo(() => ({
    dashboard: canUseFeature("operations:read") || canUseFeature("operations:manage") || canUseFeature("revenue:read") || canUseFeature("finance:read"),
    workboard: canUseFeature("processes:read") || canUseFeature("processes:manage"),
    documents: canUseFeature("documents:read") || canUseFeature("documents:manage"),
    foodcost: canUseFeature("foodcost:read"),
    products: canUseFeature("foodcost:read"),
    recipes: canUseFeature("foodcost:read"),
    suppliers: canUseFeature("foodcost:read"),
    assistant: canUseFeature("ai:use"),
    users: canUseFeature("users:read") || canUseFeature("users:manage"),
    hours: canUseFeature("time:read"),
    schedule: canUseFeature("schedule:read") || canUseFeature("schedule:manage"),
    integrations: canUseFeature("integrations:manage"),
    reviews: canUseFeature("reviews:read") || canUseFeature("reviews:manage") || canUseFeature("reviews:respond"),
    social: canUseFeature("social:read"),
    mail: isOwner,
    calendar: isOwner,
    marketing: canUseFeature("marketing:read") || canUseFeature("marketing:manage") || canUseFeature("social:read"),
    security: true,
  }), [canUseFeature]);
  const canViewRevenue = isOwner || canUseFeature("revenue:read") || canUseFeature("finance:read");
  const canViewDirectie = canViewRevenue;
  const dashboardLabel = isOwner ? "CEO Home" : canViewDirectie ? "Management Home" : "Mijn werk";
  const viewAllowed = featureVisibility[activeView] !== false;
  const mfaRequired = isOwner || canUseFeature("users:manage") || canUseFeature("integrations:manage");
  const verifiedMfaFactor = mfaState.factors.find((factor) => factor.status === "verified");
  const openTasks = [...data.tasks, ...data.processTasks].filter((task) => task.status !== "done");
  const criticalTasks = openTasks.filter((task) => task.priority === "critical");
  const priorities = [...openTasks].sort((a, b) => (priorityRank[a.priority] ?? 9) - (priorityRank[b.priority] ?? 9)).slice(0, 6);
  const securityOk = data.security.filter((item) => ["ok", "pass", "passed", "connected"].includes(String(item.status).toLowerCase())).length;
  const securityWarnings = Math.max(data.security.length - securityOk, 0);
  const connectedIntegrations = data.integrations.filter((item) => String(item.status).toLowerCase() === "connected").length;
  const foodcost = useMemo(() => buildFoodcostAnalytics(data), [data]);

  useEffect(() => {
    if (rolesLoading || hasWorkspaceWideRole || !assignedBusinessIds.length) return;
    if (businessId === "all" || !assignedBusinessIds.includes(businessId)) setBusinessId(assignedBusinessIds[0]);
  }, [assignedBusinessIds, businessId, hasWorkspaceWideRole, rolesLoading]);

  async function signIn(formData) {
    setMessage("");
    const { error } = await supabase.auth.signInWithPassword({ email: formData.get("email"), password: formData.get("password") });
    if (error) setMessage(error.message);
  }

  async function requestPasswordReset(formData) {
    const email = String(formData.get("email") || "").trim();
    setMessage("");
    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: `${window.location.origin}/wachtwoord-herstellen`,
    });
    if (error) {
      setMessage(error.message);
      return;
    }
    setMessage("Als dit e-mailadres bekend is, is er een herstelmail verzonden. Controleer ook Ongewenste e-mail.");
  }

  async function saveRecoveredPassword(formData) {
    const password = String(formData.get("password") || "");
    const confirmation = String(formData.get("confirmation") || "");
    setMessage("");
    if (password.length < 6) {
      setMessage("Gebruik een wachtwoord van minimaal 6 tekens.");
      return;
    }
    if (password !== confirmation) {
      setMessage("De wachtwoorden zijn niet gelijk.");
      return;
    }
    const { error } = await supabase.auth.updateUser({ password });
    if (error) {
      setMessage(error.message);
      return;
    }
    window.sessionStorage.removeItem("horeca-os-password-recovery");
    window.sessionStorage.removeItem("horeca-os-password-recovery-verified");
    setPasswordRecovery(false);
    window.location.assign("/dashboard");
  }

  if (loading) return <main className="center">Horeca OS laden…</main>;
  if (recoveryPage && !passwordRecovery) return <LoginScreen signIn={signIn} requestPasswordReset={requestPasswordReset} message={message} initialResetMode lockResetMode />;
  if (!session) return <LoginScreen signIn={signIn} requestPasswordReset={requestPasswordReset} message={message} initialResetMode={passwordRecovery} />;
  if (passwordRecovery) return <PasswordRecoveryScreen onSave={saveRecoveredPassword} message={message} email={session?.user?.email} />;
  if (!mfaState.loading && mfaState.nextLevel === "aal2" && mfaState.currentLevel !== "aal2") {
    return <MfaChallenge factor={verifiedMfaFactor} onComplete={refreshMfa} />;
  }
  if (membershipsLoading) return <main className="center">Werkruimtes laden…</main>;
  if (!workspaceId && memberships.length === 0) return <main className="center">Geen toegankelijke werkruimte gevonden.</main>;
  if (rolesLoading || mfaState.loading) return <main className="center">Beveiliging controleren…</main>;
  if (mfaRequired && !verifiedMfaFactor) {
    return <MfaEnrollment required onComplete={refreshMfa} />;
  }

  return (
    <div className="shell">
      <aside className="sidebar">
        <div className="sidebarHeader">
          <div className="brand">Horeca OS</div>
          <button type="button" className="mobileMenuToggle" aria-expanded={mobileMenuOpen} aria-controls="main-navigation" onClick={() => setMobileMenuOpen((open) => !open)}>{mobileMenuOpen ? "Sluiten" : "Menu"}</button>
        </div>
        <nav id="main-navigation" className={mobileMenuOpen ? "open" : ""}>
          {featureVisibility.dashboard && <NavLink href="/dashboard" active={activeView === "dashboard"}>{dashboardLabel}</NavLink>}
          {featureVisibility.workboard && <NavLink href="/werkbord/tickets" active={activeView === "staffTickets"}>Medewerkerstickets</NavLink>}
          {featureVisibility.workboard && <div className="navGroup"><div style={{ display: "flex", alignItems: "center", gap: 8 }}><NavLink href="/werkbord" active={activeView === "workboard"}>Werkbord</NavLink><button type="button" className="secondary" style={{ padding: "2px 8px", marginLeft: "auto" }} aria-label={workboardOpen ? "Werkbord-submenu inklappen" : "Werkbord-submenu openen"} onClick={() => setWorkboardOpen((value) => !value)}>{workboardOpen ? "−" : "+"}</button></div>{workboardOpen && <div className="navChildren" style={{ margin: "4px 0 12px 14px", paddingLeft: 12, borderLeft: "2px solid rgba(255,255,255,.35)", display: "grid", gap: 4 }}><NavLink href="/werkbord/prullenbak" active={activeView === "processTrash"}>Prullenbak</NavLink><NavLink href="/werkbord/logboek" active={activeView === "processAudit"}>Wijzigingslogboek</NavLink><NavLink href="/werkbord/manager-logboek" active={activeView === "managerLogbook"}>Manager-logboek</NavLink></div>}</div>}
          {featureVisibility.documents && <NavLink href="/documenten" active={activeView === "documents"}>Documenten</NavLink>}
          {featureVisibility.foodcost && <NavLink href="/foodcost" active={activeView === "foodcost"}>Foodcost</NavLink>}
          {featureVisibility.products && <NavLink href="/producten" active={activeView === "products"}>Producten</NavLink>}
          {featureVisibility.recipes && <NavLink href="/recepten" active={activeView === "recipes"}>Recepturen</NavLink>}
          {featureVisibility.suppliers && <NavLink href="/leveranciers" active={activeView === "suppliers"}>Leveranciers</NavLink>}
          {featureVisibility.reviews && <NavLink href="/reviews" active={activeView === "reviews"}>Reviews</NavLink>}
          {featureVisibility.social && <NavLink href="/social-inbox" active={activeView === "social"}>Social inbox</NavLink>}
          {featureVisibility.mail && <NavLink href="/mail" active={activeView === "mail"}>Mail</NavLink>}
          {featureVisibility.calendar && <NavLink href="/agenda" active={activeView === "calendar"}>Agenda</NavLink>}
          {featureVisibility.marketing && <NavLink href="/marketing" active={activeView === "marketing"}>Marketing</NavLink>}
          {featureVisibility.assistant && <NavLink href="/ai" active={activeView === "assistant"}>AI-assistent</NavLink>}
          {featureVisibility.users && <NavLink href="/gebruikers" active={activeView === "users"}>Gebruikers & rollen</NavLink>}
          {featureVisibility.hours && <NavLink href="/uren" active={activeView === "hours"}>Uren</NavLink>}
          {featureVisibility.schedule && <NavLink href="/rooster" active={activeView === "schedule"}>Rooster</NavLink>}
          {featureVisibility.integrations && <NavLink href="/koppelingen" active={activeView === "integrations"}>Koppelingen</NavLink>}
          <NavLink href="/beveiliging" active={activeView === "security"}>Beveiliging</NavLink>
        </nav>
        <button className="nav logout" onClick={() => supabase.auth.signOut()}>Uitloggen</button>
      </aside>

      <main className="content">
        <header className="topbar">
          <div><p className="eyebrow">{canViewDirectie ? "Directieoverzicht" : "Persoonlijke werkomgeving"}</p><h1>{activeBusiness?.name || activeWorkspace?.workspace?.name || "Horeca OS"}</h1><p>{session.user.email}</p></div>
          <div className="toolbar">
            {memberships.length > 1 && <label>Werkruimte<select value={workspaceId} onChange={(event) => { setWorkspaceId(event.target.value); setBusinessId("all"); }}>{memberships.map((item) => <option key={item.workspace_id} value={item.workspace_id}>{item.workspace?.name || item.workspace_id}</option>)}</select></label>}
            <label>Vestiging<select value={businessId} onChange={(event) => setBusinessId(event.target.value)}>{hasWorkspaceWideRole && <option value="all">Alle vestigingen</option>}{visibleBusinesses.map((business) => <option key={business.id} value={business.id}>{business.name}</option>)}</select></label>
            <button className="refresh" onClick={loadData} disabled={refreshing}>{refreshing ? "Verversen…" : "Data verversen"}</button>
          </div>
        </header>

        {message && <div className="notice">{message}</div>}
        {activeView === "staffTickets" && featureVisibility.workboard && <StaffTickets workspaceId={workspaceId} canManage={isOwner || canUseFeature("processes:manage")} />}

        {!viewAllowed && <AccessDenied />}

        {activeView === "dashboard" && featureVisibility.dashboard && <>
        {(canUseFeature("operations:read") || canUseFeature("operations:manage")) && <TimeClock workspaceId={workspaceId} businessId={businessId} businesses={visibleBusinesses} userId={session.user.id} />}
        {canViewDirectie ? <>
        <section className="kpis salesKpis">
          <SalesCard label="Omzet vandaag" period={analytics.today} />
          <SalesCard label="Omzet gisteren" period={analytics.yesterday} />
          <SalesCard label="Omzet deze week" period={analytics.week} />
          <SalesCard label="Omzet deze maand" period={analytics.month} />
        </section>

        <section className="kpis secondary">
          <Card label="Gemiddelde bon deze maand" value={money(analytics.month.averageTicket)} sub={`${analytics.month.orders} ${analytics.month.orders === 1 ? "bestelling" : "bestellingen"}`} />
          <Card label="Open taken" value={openTasks.length} sub={`${criticalTasks.length} kritieke ${criticalTasks.length === 1 ? "taak" : "taken"}`} tone={criticalTasks.length ? "danger" : "normal"} />
          <Card label="Security" value={securityWarnings ? `${securityWarnings} ${securityWarnings === 1 ? "aandachtspunt" : "aandachtspunten"}` : "Op orde"} sub={`${securityOk}/${data.security.length || 0} controles akkoord`} tone={securityWarnings ? "warning" : "success"} />
          <Card label="Integraties" value={`${connectedIntegrations}/${data.integrations.length || 0}`} sub="Verbonden databronnen" />
        </section>

        <section className="dashboardGrid">
          <Panel title="Topprioriteiten" subtitle="Wat vandaag bestuurlijke aandacht vraagt">{priorities.length === 0 && <Empty text="Geen openstaande prioriteiten." />}{priorities.map((task) => <div className={`task ${task.priority || "medium"}`} key={task.id}><div><b>{task.title}</b><span>{priorityLabel[task.priority] || task.priority} · {statusLabel[task.status] || task.status}</span></div><span className="pill">{task.assignee?.full_name || "Nog niet toegewezen"}</span></div>)}</Panel>
          <Panel title="Komende agenda" subtitle="Eerstvolgende afspraken en evenementen">{data.events.length === 0 && <Empty text="Geen komende afspraken gevonden." />}{data.events.map((event) => <div className="event" key={event.id}><div className="dateBadge"><strong>{new Date(event.starts_at).getDate()}</strong><span>{new Intl.DateTimeFormat("nl-NL", { month: "short" }).format(new Date(event.starts_at))}</span></div><div><b>{event.title}</b><span>{formatDate(event.starts_at)}</span></div></div>)}</Panel>
          <Panel title="Topverkopers" subtitle="Hoogste aantallen in de huidige maand">{analytics.topProducts.length === 0 && <Empty text="Nog geen productverkoop voor deze maand." />}{analytics.topProducts.map((product, index) => <div className="rankRow" key={product.name}><span className="rank">{index + 1}</span><b>{product.name}</b><strong>{product.quantity}</strong></div>)}</Panel>
          <Panel title="Systemen" subtitle="Status van de belangrijkste koppelingen">{data.integrations.length === 0 && <Empty text="Geen integraties gevonden." />}{data.integrations.map((integration) => <div className="systemRow" key={integration.id}><div><b>{integration.provider}</b><span>{integration.last_synced_at ? `Laatste sync ${formatDate(integration.last_synced_at)}` : "Nog niet gesynchroniseerd"}</span></div><span className={`status ${String(integration.status).toLowerCase()}`}>{integrationStatusLabel[String(integration.status).toLowerCase()] || integration.status}</span></div>)}</Panel>
        </section>

        <section className="panel channelPanel">
          <div className="panelHead"><div><h2>Omzet per kanaal</h2><p>Verdeling van deze maand binnen de gekozen vestiging</p></div></div>
          <div className="channelGrid">
            {analytics.channels.map((channel) => <ChannelCard key={channel.label} {...channel} />)}
          </div>
        </section>

        <section className="panel ai"><div><p className="eyebrow light">AI-directieadvies</p><h2>{buildAdvice({ criticalTasks, sales: analytics.today, events: data.events, securityWarnings })}</h2></div><div className="aiMeta"><span>Live database</span><span>Tenantfilter actief</span><span>Dagelijkse back-up</span></div></section>
        </> : <StaffDashboard priorities={priorities} events={data.events} />}
        </>}

        {activeView === "workboard" && featureVisibility.workboard && <Workboard workspaceId={workspaceId} businessId={businessId} businesses={visibleBusinesses} userId={session.user.id} tasks={data.tasks} canManage={isOwner || canUseFeature("processes:manage")} canMonitor={isOwner || canUseFeature("processes:manage") || canUseFeature("processes:monitor")} onRefresh={loadData} />}\n        {activeView === "processTrash" && featureVisibility.workboard && <ProcessTrash workspaceId={workspaceId} canManage={isOwner || canUseFeature("processes:manage")} onRefresh={loadData} />}\n        {activeView === "processAudit" && featureVisibility.workboard && <ProcessAudit workspaceId={workspaceId} canManage={isOwner || canUseFeature("processes:manage")} />}\n        {activeView === "managerLogbook" && featureVisibility.workboard && <ManagerLogbook workspaceId={workspaceId} businessId={businessId} businesses={visibleBusinesses} userId={session.user.id} canManage={isOwner || canUseFeature("processes:manage")} />}\n        {activeView === "documents" && featureVisibility.documents && <Documents workspaceId={workspaceId} businessId={businessId} userId={session.user.id} canManage={isOwner || canUseFeature("documents:manage")} />}\n        {activeView === "foodcost" && featureVisibility.foodcost && <FoodcostDashboard analytics={foodcost} />}
        {activeView === "products" && featureVisibility.products && <ProductOverview products={data.foodProducts} suppliers={data.suppliers} ingredients={data.ingredients} canManage={isOwner || canUseFeature("foodcost:manage")} onRefresh={loadData} />}
        {activeView === "recipes" && featureVisibility.recipes && <RecipeOverview recipes={data.recipes} recipeItems={data.recipeItems} ingredients={data.ingredients} products={data.foodProducts} canManage={isOwner || canUseFeature("foodcost:manage")} onRefresh={loadData} />}
        {activeView === "suppliers" && featureVisibility.suppliers && <SupplierOverview suppliers={data.suppliers} products={data.foodProducts} />}
        {activeView === "reviews" && featureVisibility.reviews && <ReviewsInbox workspaceId={workspaceId} businessId={businessId} businesses={visibleBusinesses} session={session} canManage={isOwner || canUseFeature("reviews:manage") || canUseFeature("reviews:respond")} canAdd={isOwner || canUseFeature("reviews:manage")} />}
        {activeView === "social" && featureVisibility.social && <SocialInbox workspaceId={workspaceId} businessId={businessId} businesses={visibleBusinesses} session={session} canManage={isOwner || canUseFeature("social:manage")} />}
        {activeView === "mail" && featureVisibility.mail && <MailAgenda workspaceId={workspaceId} businessId={businessId} session={session} />}
        {activeView === "calendar" && featureVisibility.calendar && <CalendarOverview workspaceId={workspaceId} session={session} />}
        {activeView === "marketing" && featureVisibility.marketing && (businessId === "all"
          ? <section className="panel" style={{ marginBottom: 24 }}>
              <div className="panelHead"><div><p className="eyebrow">MARKETING</p><h2>Kies eerst een vestiging</h2><p>Een campagne hoort altijd bij één zaak. Kies hieronder de juiste vestiging om verkeerde locaties, doelgroepen of afzenders te voorkomen.</p></div></div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 10 }}>
                {visibleBusinesses.map((business) => <button type="button" className="primary" key={business.id} onClick={() => setBusinessId(business.id)}>{business.name}</button>)}
              </div>
            </section>
          : <CentralEventCreator workspaceId={workspaceId} businessId={businessId} businesses={visibleBusinesses} session={session} />)}
        {activeView === "assistant" && featureVisibility.assistant && <Assistant workspaceId={workspaceId} businessId={businessId} session={session} conversations={data.aiConversations} onRefresh={loadData} />}
        {activeView === "users" && featureVisibility.users && <UsersAdmin workspaceId={workspaceId} session={session} />}
        {activeView === "hours" && featureVisibility.hours && <HoursOverview workspaceId={workspaceId} businessId={businessId} businesses={visibleBusinesses} />}
        {activeView === "schedule" && featureVisibility.schedule && <ScheduleOverview workspaceId={workspaceId} businessId={businessId} businesses={visibleBusinesses} userId={session.user.id} canManage={isOwner || canUseFeature("schedule:manage")} />}
        {activeView === "integrations" && featureVisibility.integrations && <><PredisContentGenerator mode="connect" workspaceId={workspaceId} businessId={businessId} businesses={visibleBusinesses} session={session} /><RobuustIntegrationSettings workspaceId={workspaceId} session={session} businesses={data.businesses} /></>}
        {activeView === "security" && <SecuritySettings required={mfaRequired} mfaState={mfaState} onRefresh={refreshMfa} />}
      </main>
    </div>
  );
}

function NavLink({ active, children, href }) { return <Link className={`nav ${active ? "active" : ""}`} href={href}>{children}</Link>; }

function EmptyModule({ eyebrow, title, description }) {
  return <><section className="pageIntro"><p className="eyebrow">{eyebrow}</p><h2>{title}</h2><p>{description}</p></section><section className="panel emptyModule"><strong>Klaar voor de eerste databron</strong><p>Dit onderdeel is onderdeel van de nieuwe applicatiestructuur. Er wordt geen voorbeelddata getoond.</p></section></>;
}

function normalizeCampaignSource(value) {
  const raw = String(value || "").trim();
  if (!raw) return "";
  try {
    const url = new URL(raw);
    url.hash = "";
    const pathname = url.pathname.replace(/\/+$/, "") || "/";
    return `${url.hostname.toLowerCase()}${pathname}${url.search}`;
  } catch {
    return raw.toLowerCase().replace(/#.*$/, "").replace(/\/+$/, "");
  }
}

function campaignEventKey({ sourceUrl, title, startDate }) {
  const normalizedUrl = normalizeCampaignSource(sourceUrl);
  if (normalizedUrl) return `url:${normalizedUrl}`;
  const normalizedTitle = String(title || "").trim().toLowerCase().replace(/\s+/g, " ");
  const parsedDate = startDate ? new Date(startDate) : null;
  const date = parsedDate && !Number.isNaN(parsedDate.getTime()) ? parsedDate.toISOString().slice(0, 10) : "";
  return normalizedTitle ? `title:${normalizedTitle}|date:${date}` : "";
}

function findExistingCampaignChannels(rows, sourceUrl, sourcePreview, campaignTitle) {
  const wantedKey = campaignEventKey({
    sourceUrl,
    title: sourcePreview?.title || campaignTitle,
    startDate: sourcePreview?.startDate,
  });
  if (!wantedKey) return new Set();

  const existing = new Set();
  (rows || []).forEach((campaign) => {
    if (["cancelled", "canceled", "failed", "deleted"].includes(String(campaign.status || "").toLowerCase())) return;
    const distribution = Array.isArray(campaign.media)
      ? campaign.media.find((item) => item?.kind === "campaign_distribution")
      : null;
    if (!distribution) return;
    const storedKey = distribution.event_key || campaignEventKey({
      sourceUrl: distribution.source_url,
      title: distribution.source_preview?.title || campaign.body,
      startDate: distribution.source_preview?.startDate || campaign.scheduled_for,
    });
    if (storedKey !== wantedKey) return;
    (distribution.target_channels || []).forEach((channel) => existing.add(channel));
  });
  return existing;
}

function CampaignDistributor({ workspaceId, businessId, businesses, session }) {
  const initialBusinessId = businessId !== "all" ? businessId : businesses[0]?.id || "";
  const [selectedBusinessId, setSelectedBusinessId] = useState(initialBusinessId);
  const [sourceType, setSourceType] = useState("facebook_event");
  const [sourceUrl, setSourceUrl] = useState("");
  const [campaignTitle, setCampaignTitle] = useState("");
  const [campaignText, setCampaignText] = useState("");
  const [channels, setChannels] = useState(["brevo", "facebook", "instagram", "predis"]);
  const [scheduledFor, setScheduledFor] = useState("");
  const [metaAds, setMetaAds] = useState(false);
  const [dailyBudget, setDailyBudget] = useState("");
  const [campaignEnd, setCampaignEnd] = useState("");
  const [audience, setAudience] = useState("");
  const [spendConfirmed, setSpendConfirmed] = useState(false);
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState("");
  const [channelResult, setChannelResult] = useState([]);
  const [campaigns, setCampaigns] = useState([]);
  const [loadingCampaigns, setLoadingCampaigns] = useState(false);
  const [sourcePreview, setSourcePreview] = useState(null);
  const [websiteEvents, setWebsiteEvents] = useState([]);
  const [selectedWebsiteEventId, setSelectedWebsiteEventId] = useState("");
  const [loadingWebsiteEvents, setLoadingWebsiteEvents] = useState(false);
  const [facebookEvents, setFacebookEvents] = useState([]);
  const [selectedFacebookEventId, setSelectedFacebookEventId] = useState("");
  const [loadingFacebookEvents, setLoadingFacebookEvents] = useState(false);
  const [showPastFacebookEvents, setShowPastFacebookEvents] = useState(false);
  const [checkingPlacements, setCheckingPlacements] = useState(false);
  const [placementCheckedAt, setPlacementCheckedAt] = useState("");
  const [campaignImages, setCampaignImages] = useState({});
  const [uploadingImage, setUploadingImage] = useState("");
  const [draggingImageProfile, setDraggingImageProfile] = useState("");

  const campaignImageProfiles = [
    { key: "square", label: "Vierkant", channels: "Facebook, Instagram-feed en Google", width: 1080, height: 1080, ratio: "1:1" },
    { key: "landscape", label: "Liggend", channels: "Facebook-link, nieuwsbrief en Google", width: 1200, height: 630, ratio: "1.91:1" },
    { key: "portrait", label: "Staand", channels: "Instagram-feed", width: 1080, height: 1350, ratio: "4:5" },
    { key: "story", label: "Story / Reel", channels: "Instagram, Facebook en TikTok", width: 1080, height: 1920, ratio: "9:16" },
  ];

  const existingCampaignChannels = useMemo(
    () => findExistingCampaignChannels(campaigns, sourceUrl, sourcePreview, campaignTitle),
    [campaignTitle, campaigns, sourcePreview, sourceUrl],
  );

  const loadCampaigns = useCallback(async () => {
    if (!workspaceId || !selectedBusinessId) {
      setCampaigns([]);
      return;
    }
    setLoadingCampaigns(true);
    const { data, error } = await supabase.from("social_content_items")
      .select("id, body, media, status, workflow_status, scheduled_for, created_at")
      .eq("workspace_id", workspaceId)
      .eq("business_id", selectedBusinessId)
      .eq("direction", "outbound")
      .order("created_at", { ascending: false })
      .limit(100);
    if (error) {
      setStatus("Campagneoverzicht kon niet worden geladen: " + error.message);
      setCampaigns([]);
    } else {
      setCampaigns((data || []).filter((item) => Array.isArray(item.media)
        && item.media.some((mediaItem) => mediaItem?.kind === "campaign_distribution")));
    }
    setLoadingCampaigns(false);
  }, [selectedBusinessId, workspaceId]);

  useEffect(() => {
    loadCampaigns();
  }, [loadCampaigns]);

  useEffect(() => {
    setSelectedBusinessId(businessId !== "all" ? businessId : businesses[0]?.id || "");
  }, [businessId, businesses]);

  const directChannelOptions = [
    ["brevo", "Nieuwsbrief via Brevo"],
    ["facebook", "Facebookpagina"],
    ["instagram", "Instagram"],
    ["predis", "Predis"],
    ["tiktok", "TikTok"],
    ["whatsapp", "WhatsApp Business"],
    ["facebook_groups", "Facebook-groepen"],
    ["google_business_profile", "Google Bedrijfsprofiel (organisch)"],
    ["google_ads", "Google Ads (betaald)"],
  ];
  const manualPromotionSender = "info@leclubbbq.nl";
  const manualEmailOptions = [
    ["email_salsa", "Salsa.nl", "redactie@salsa.nl"],
    ["email_zoetermeer_nieuws", "Zoetermeer.Nieuws.nl", "zoetermeer@nieuws.nl"],
    ["email_zoetermeers_dagblad", "Zoetermeers Dagblad", "redactie@zoetermeersdagblad.nl"],
    ["email_streekblad", "Streekblad Zoetermeer", "redactiestreekblad@telstarmediacentrum.nl"],
    ["email_zfm", "ZFM Zoetermeer", "algemeen@zfmzoetermeer.nl"],
    ["email_zoetermeer_actief", "Zoetermeer Actief", "info@zoetermeeractief.nl"],
    ["email_vrijetijdkrant", "Vrijetijdkrant", "info@vrijetijdkrant.nl"],
    ["email_eventtip", "Eventtip / Culturele Uitagenda", "info@eventconnectors.nl"],
    ["email_wat_te_doen", "Wat te doen Vandaag", "info@wattedoenvandaag.nl"],
    ["email_evenementen", "Evenementen.nl", "info@evenementen.nl"],
  ];
  const channelOptions = [
    ...directChannelOptions,
    ...manualEmailOptions.map(([value, label]) => [value, `${label} (per e-mail)`]),
  ];
  const manualEmailByChannel = Object.fromEntries(
    manualEmailOptions.map(([value, label, email]) => [value, { label, email }]),
  );

  function emailHandoffUrl(channel) {
    const target = manualEmailByChannel[channel];
    if (!target) return "";
    const businessName = businesses.find((item) => item.id === selectedBusinessId)?.name || "Horeca OS";
    const title = sourcePreview?.title || campaignTitle;
    const details = [
      `Beste redactie van ${target.label},`,
      "",
      `Graag melden wij het volgende evenement van ${businessName} aan:`,
      "",
      `Titel: ${title}`,
      sourcePreview?.startDate ? `Datum en tijd: ${formatDate(sourcePreview.startDate)}` : "",
      sourcePreview?.location ? `Locatie: ${sourcePreview.location}` : "",
      campaignText.trim() ? `Omschrijving: ${campaignText.trim()}` : "",
      sourceUrl.trim() ? `Evenementpagina: ${sourceUrl.trim()}` : "",
      sourcePreview?.image ? `Openbare beeldlink: ${sourcePreview.image}` : "",
      "",
      "Met vriendelijke groet,",
      businessName,
      manualPromotionSender,
    ].filter(Boolean).join("\n");
    return `mailto:${target.email}?subject=${encodeURIComponent(`Evenement aanmelden: ${title}`)}&body=${encodeURIComponent(details)}`;
  }


  function emailHandoffUrlForCampaign(channel, campaign, distribution) {
    const target = manualEmailByChannel[channel];
    if (!target) return "";
    const preview = distribution?.source_preview || {};
    const businessName = businesses.find((item) => item.id === selectedBusinessId)?.name || "Horeca OS";
    const title = preview.title || campaign.body || "Evenement";
    const details = [
      `Beste redactie van ${target.label},`,
      "",
      `Graag melden wij het volgende evenement van ${businessName} aan:`,
      "",
      `Titel: ${title}`,
      preview.startDate ? `Datum en tijd: ${formatDate(preview.startDate)}` : "",
      preview.location ? `Locatie: ${preview.location}` : "",
      campaign.body ? `Omschrijving: ${campaign.body}` : "",
      distribution?.source_url ? `Evenementpagina: ${distribution.source_url}` : "",
      preview.image ? `Openbare beeldlink: ${preview.image}` : "",
      "",
      "Met vriendelijke groet,",
      businessName,
      manualPromotionSender,
    ].filter(Boolean).join("\n");
    return `mailto:${target.email}?subject=${encodeURIComponent(`Evenement aanmelden: ${title}`)}&body=${encodeURIComponent(details)}`;
  }

  async function sendManualPromotionEmail(channel, campaign, distribution) {
    const target = manualEmailByChannel[channel];
    if (!target) return;
    const preview = distribution?.source_preview || {};
    const businessName = businesses.find((item) => item.id === selectedBusinessId)?.name || "Horeca OS";
    const title = preview.title || campaign.body || "Evenement";
    const content = [
      `Beste redactie van ${target.label},`,
      "",
      `Graag melden wij het volgende evenement van ${businessName} aan:`,
      "",
      `Titel: ${title}`,
      preview.startDate ? `Datum en tijd: ${formatDate(preview.startDate)}` : "",
      preview.location ? `Locatie: ${preview.location}` : "",
      campaign.body ? `Omschrijving: ${campaign.body}` : "",
      distribution?.source_url ? `Evenementpagina: ${distribution.source_url}` : "",
      preview.image ? `Openbare beeldlink: ${preview.image}` : "",
      "",
      "Met vriendelijke groet,",
      businessName,
      manualPromotionSender,
    ].filter(Boolean).join("\n");
    if (!window.confirm(`E-mail nu vanuit ${manualPromotionSender} versturen naar ${target.email}?`)) return;
    setStatus(`E-mail naar ${target.label} wordt verstuurd...`);
    try {
      const response = await fetch("/api/integrations/microsoft/messages/action", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${session.access_token}` },
        body: JSON.stringify({
          workspaceId,
          mailbox: manualPromotionSender,
          action: "send",
          to: target.email,
          subject: `Evenement aanmelden: ${title}`,
          content,
        }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "De e-mail kon niet worden verstuurd.");
      await updateManualChannelState(campaign, channel, "email_sent");
      setStatus(`Verzonden vanuit ${manualPromotionSender} naar ${target.email}.`);
    } catch (error) {
      setStatus(error.message);
    }
  }

  function manualChannelStatusLabel(state) {
    if (state === "published") return "Geplaatst";
    if (state === "not_published") return "Niet geplaatst";
    if (state === "email_sent") return "Verzonden";
    if (state === "email_skipped") return "Overgeslagen";
    return "Klaargezet";
  }

  async function confirmManualPublication(campaign, channel, distribution) {
    const currentHandoff = (distribution.email_handoffs || []).find((item) => item.channel === channel) || {};
    const publicationUrl = window.prompt(
      "Plak de openbare link van de plaatsing. Laat dit leeg als er geen link beschikbaar is.",
      currentHandoff.publication_url || "",
    );
    if (publicationUrl === null) return;
    await updateManualChannelState(campaign, channel, "published", publicationUrl.trim());
  }

  async function updateManualChannelState(campaign, channel, nextState, publicationUrl = "") {
    const distributionIndex = (campaign.media || []).findIndex((item) => item?.kind === "campaign_distribution");
    if (distributionIndex < 0 || !manualEmailByChannel[channel]) return;
    const now = new Date().toISOString();
    const currentDistribution = campaign.media[distributionIndex] || {};
    const handoffs = Array.isArray(currentDistribution.email_handoffs)
      ? currentDistribution.email_handoffs
      : [];
    const existingHandoff = handoffs.find((item) => item.channel === channel) || {};
    const updatedHandoff = {
      channel,
      ...manualEmailByChannel[channel],
      ...existingHandoff,
      state: nextState,
      publication_url: nextState === "published" ? publicationUrl : existingHandoff.publication_url || "",
      updated_at: now,
      updated_by: session.user.email,
    };
    const nextDistribution = {
      ...currentDistribution,
      channel_states: {
        ...(currentDistribution.channel_states || {}),
        [channel]: nextState,
      },
      email_handoffs: [
        ...handoffs.filter((item) => item.channel !== channel),
        updatedHandoff,
      ],
    };
    const nextMedia = [...campaign.media];
    nextMedia[distributionIndex] = nextDistribution;
    setStatus(`${manualEmailByChannel[channel].label}: status opslaan...`);
    const { error } = await supabase.from("social_content_items")
      .update({ media: nextMedia, updated_at: now })
      .eq("id", campaign.id)
      .eq("workspace_id", workspaceId)
      .eq("business_id", selectedBusinessId);
    if (error) {
      setStatus(`Status kon niet worden opgeslagen: ${error.message}`);
      return;
    }
    setStatus(`${manualEmailByChannel[channel].label}: ${manualChannelStatusLabel(nextState).toLowerCase()}.`);
    await loadCampaigns();
  }

  function toggleChannel(channel) {
    setChannels((current) => current.includes(channel)
      ? current.filter((item) => item !== channel)
      : [...current, channel]);
    setStatus("");
  }

  function websiteHostname() {
    const businessName = businesses.find((item) => item.id === selectedBusinessId)?.name?.toLowerCase() || "";
    if (businessName.includes("caribbean")) return "caribbeancorner.nl";
    if (businessName.includes("plein")) return "grandcafehetplein.com";
    return "";
  }

  async function loadWebsiteEvents() {
    const site = websiteHostname();
    if (!site) {
      setStatus("Voor deze vestiging is nog geen Eventin-website ingesteld.");
      return;
    }
    setLoadingWebsiteEvents(true);
    setStatus("");
    try {
      const response = await fetch(`/api/marketing/website-events?site=${encodeURIComponent(site)}`, {
        headers: { Authorization: `Bearer ${session.access_token}` },
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "De websiteagenda kon niet worden geladen.");
      setWebsiteEvents(result.events || []);
      setStatus(result.events?.length
        ? `${result.events.length} actuele evenementen uit de websiteagenda geladen.`
        : "Er staan geen toekomstige evenementen in de websiteagenda.");
    } catch (error) {
      setWebsiteEvents([]);
      setStatus(error.message || "De websiteagenda kon niet worden geladen.");
    } finally {
      setLoadingWebsiteEvents(false);
    }
  }

  function clearWebsiteEventSelection() {
    setSelectedWebsiteEventId("");
    setSourceUrl("");
    setSourcePreview(null);
    setCampaignTitle("");
    setCampaignText("");
    setScheduledFor("");
    setStatus("Evenementselectie verwijderd. Kies een ander evenement uit de agenda.");
  }

  function selectWebsiteEvent(eventItem) {
    if (selectedWebsiteEventId === eventItem.id) {
      clearWebsiteEventSelection();
      return;
    }
    setSelectedWebsiteEventId(eventItem.id);
    setSourceUrl(eventItem.sourceUrl || "");
    setSourcePreview(eventItem);
    setCampaignTitle(eventItem.title || "");
    setCampaignText(eventItem.description || "");
    if (eventItem.startDate) {
      const date = new Date(eventItem.startDate);
      if (!Number.isNaN(date.getTime())) {
        const local = new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
        setScheduledFor(local);
      }
    }
    setStatus(`${eventItem.title} geselecteerd. Controleer nu de tekst, kanalen en publicatiedatum.`);
  }

  async function loadFacebookEvents(includePast = showPastFacebookEvents) {
    if (!selectedBusinessId) {
      setStatus("Kies eerst een vestiging.");
      return;
    }
    setLoadingFacebookEvents(true);
    setStatus("");
    try {
      const query = new URLSearchParams({
        workspaceId,
        businessId: selectedBusinessId,
        includePast: String(includePast),
      });
      const response = await fetch(`/api/integrations/facebook/events?${query}`, {
        headers: { Authorization: `Bearer ${session.access_token}` },
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "De Facebook-evenementen konden niet worden geladen.");
      setFacebookEvents(result.events || []);
      setStatus(result.events?.length
        ? `${result.events.length} Facebook-evenementen van ${result.pageName || "de gekozen pagina"} geladen.`
        : "Er zijn geen passende Facebook-evenementen gevonden.");
    } catch (error) {
      setFacebookEvents([]);
      setStatus(error.message || "De Facebook-evenementen konden niet worden geladen.");
    } finally {
      setLoadingFacebookEvents(false);
    }
  }

  function clearFacebookEventSelection() {
    setSelectedFacebookEventId("");
    setSourceUrl("");
    setSourcePreview(null);
    setCampaignTitle("");
    setCampaignText("");
    setScheduledFor("");
    setStatus("Facebook-evenement gedeselecteerd. Kies een ander evenement.");
  }

  function selectFacebookEvent(eventItem) {
    if (selectedFacebookEventId === eventItem.id) {
      clearFacebookEventSelection();
      return;
    }
    setSelectedFacebookEventId(eventItem.id);
    setSelectedWebsiteEventId("");
    setSourceUrl(eventItem.sourceUrl || "");
    setSourcePreview(eventItem);
    setCampaignTitle(eventItem.title || "");
    setCampaignText(eventItem.description || "");
    if (eventItem.startDate) {
      const date = new Date(eventItem.startDate);
      if (!Number.isNaN(date.getTime())) {
        const local = new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
        setScheduledFor(local);
      }
    }
    setStatus(`${eventItem.title} geselecteerd. De gegevens en afbeelding zijn overgenomen; controleer nu de kanalen en publicatiedatum.`);
  }

  function changeSourceType(nextSourceType) {
    setSourceType(nextSourceType);
    setSelectedFacebookEventId("");
    setSelectedWebsiteEventId("");
    setSourceUrl("");
    setSourcePreview(null);
    setCampaignTitle("");
    setCampaignText("");
    setScheduledFor("");
    setStatus("");
  }

  function getImageDimensions(file) {
    return new Promise((resolve, reject) => {
      const image = new Image();
      const objectUrl = URL.createObjectURL(file);
      image.onload = () => {
        resolve({ width: image.naturalWidth, height: image.naturalHeight });
        URL.revokeObjectURL(objectUrl);
      };
      image.onerror = () => {
        URL.revokeObjectURL(objectUrl);
        reject(new Error("De afmetingen van deze afbeelding konden niet worden gelezen."));
      };
      image.src = objectUrl;
    });
  }

  function handleCampaignImageDrop(profile, event) {
    event.preventDefault();
    event.stopPropagation();
    setDraggingImageProfile("");
    const files = Array.from(event.dataTransfer?.files || []);
    if (files.length > 1) {
      setStatus("Sleep één afbeelding tegelijk naar een afbeeldingsvak.");
      return;
    }
    if (files[0]) uploadCampaignImage(profile, files[0]);
  }

  async function uploadCampaignImage(profile, file) {
    if (!file || !workspaceId || !selectedBusinessId) return;
    if (!["image/jpeg", "image/png", "image/webp"].includes(file.type)) {
      setStatus("Gebruik een JPG-, PNG- of WebP-afbeelding.");
      return;
    }
    if (file.size > 10 * 1024 * 1024) {
      setStatus("De afbeelding is groter dan 10 MB. Kies een kleiner bestand.");
      return;
    }

    setUploadingImage(profile.key);
    setStatus("");
    try {
      const dimensions = await getImageDimensions(file);
      const safeName = file.name
        .toLowerCase()
        .replace(/[^a-z0-9._-]+/g, "-")
        .replace(/^-+|-+$/g, "") || "campagnebeeld";
      const uniqueId = typeof crypto !== "undefined" && crypto.randomUUID
        ? crypto.randomUUID()
        : Math.random().toString(36).slice(2);
      const storagePath = `${workspaceId}/${selectedBusinessId}/${Date.now()}-${uniqueId}-${safeName}`;
      const { error: uploadError } = await supabase.storage
        .from("marketing-assets")
        .upload(storagePath, file, {
          cacheControl: "3600",
          contentType: file.type,
          upsert: false,
        });
      if (uploadError) throw uploadError;

      const { data: publicData } = supabase.storage.from("marketing-assets").getPublicUrl(storagePath);
      const asset = {
        profile: profile.key,
        label: profile.label,
        path: storagePath,
        url: publicData.publicUrl,
        name: file.name,
        content_type: file.type,
        size: file.size,
        width: dimensions.width,
        height: dimensions.height,
        recommended_width: profile.width,
        recommended_height: profile.height,
      };
      setCampaignImages((current) => ({ ...current, [profile.key]: asset }));
      setStatus(`${profile.label} campagnebeeld is veilig geüpload (${dimensions.width} × ${dimensions.height} px).`);
    } catch (error) {
      setStatus("Uploaden is niet gelukt: " + error.message);
    } finally {
      setUploadingImage("");
    }
  }

  async function removeCampaignImage(profileKey) {
    const asset = campaignImages[profileKey];
    if (!asset) return;
    setUploadingImage(profileKey);
    setStatus("");
    const { error } = await supabase.storage.from("marketing-assets").remove([asset.path]);
    if (error) {
      setStatus("Verwijderen is niet gelukt: " + error.message);
    } else {
      setCampaignImages((current) => {
        const next = { ...current };
        delete next[profileKey];
        return next;
      });
      setStatus("Campagnebeeld verwijderd.");
    }
    setUploadingImage("");
  }

  async function checkPlacements() {
    if (!sourceUrl.trim() && !campaignTitle.trim()) {
      setStatus("Kies eerst een evenement of vul een bronlink in.");
      return;
    }
    setCheckingPlacements(true);
    await loadCampaigns();
    setPlacementCheckedAt(new Date().toISOString());
    setCheckingPlacements(false);
  }

  async function planCampaign(event) {
    event.preventDefault();
    if (!selectedBusinessId || !sourceUrl.trim() || !campaignTitle.trim() || !channels.length || !scheduledFor) {
      setStatus("Vul de bron, campagnenaam, planning en minimaal één doelkanaal in.");
      return;
    }
    if (metaAds && (!dailyBudget || !campaignEnd || !audience.trim() || !spendConfirmed)) {
      setStatus("Bevestig voor Meta Ads eerst budget, einddatum en doelgroep.");
      return;
    }
    setSaving(true);
    setStatus("");

    const { data: recentItems, error: duplicateCheckError } = await supabase.from("social_content_items")
      .select("id, body, media, status, workflow_status, scheduled_for, created_at")
      .eq("workspace_id", workspaceId)
      .eq("business_id", selectedBusinessId)
      .eq("direction", "outbound")
      .order("created_at", { ascending: false })
      .limit(250);
    if (duplicateCheckError) {
      setStatus("De plaatsingscontrole kon niet worden uitgevoerd: " + duplicateCheckError.message);
      setSaving(false);
      return;
    }
    const recentCampaigns = (recentItems || []).filter((item) => Array.isArray(item.media)
      && item.media.some((mediaItem) => mediaItem?.kind === "campaign_distribution"));
    const alreadyPlaced = findExistingCampaignChannels(recentCampaigns, sourceUrl, sourcePreview, campaignTitle);
    const duplicateChannels = channels.filter((channel) => alreadyPlaced.has(channel));
    const freshChannels = channels.filter((channel) => !alreadyPlaced.has(channel));
    setCampaigns(recentCampaigns);
    setPlacementCheckedAt(new Date().toISOString());
    if (!freshChannels.length) {
      setChannelResult(duplicateChannels.map((channel) => ({ channel, state: "Al geplaatst/gepland" })));
      setStatus("Dit evenement is op alle gekozen kanalen al geplaatst of ingepland. Er is niets dubbel opgeslagen.");
      setSaving(false);
      return;
    }

    const { data: accounts, error: accountEr…48413 tokens truncated…onMessage, setIntegrationMessage] = useState("");
  const [integrationError, setIntegrationError] = useState("");
  const [connecting, setConnecting] = useState(false);
  const [testingMetaBusinessId, setTestingMetaBusinessId] = useState("");
  const [syncingMetaBusinessId, setSyncingMetaBusinessId] = useState("");
  const [syncingFacebookBusinessId, setSyncingFacebookBusinessId] = useState("");

  const loadAccounts = useCallback(async () => {
    const headers = { Authorization: `Bearer ${session.access_token}` };
    const [robuustResponse, metaResponse, facebookResponse, microsoftResponse, whatsappResponse] = await Promise.all([
      fetch(`/api/integrations/robuust?workspaceId=${encodeURIComponent(workspaceId)}`, { headers }),
      fetch(`/api/integrations/meta?workspaceId=${encodeURIComponent(workspaceId)}`, { headers }),
      fetch(`/api/integrations/facebook?workspaceId=${encodeURIComponent(workspaceId)}`, { headers }),
      fetch(`/api/integrations/microsoft?workspaceId=${encodeURIComponent(workspaceId)}`, { headers }),
      fetch(`/api/integrations/whatsapp?workspaceId=${encodeURIComponent(workspaceId)}`, { headers }),
    ]);
    const [robuustResult, metaResult, facebookResult, microsoftResult, whatsappResult] = await Promise.all([robuustResponse.json(), metaResponse.json(), facebookResponse.json(), microsoftResponse.json(), whatsappResponse.json()]);
    if (robuustResponse.ok) setAccounts(robuustResult.accounts || []);
    if (metaResponse.ok) {
      setMetaAccounts(metaResult.accounts || []);
      setMetaConfiguration(metaResult.configuration || { ready: false, missing: [] });
    }
    if (facebookResponse.ok) {
      setFacebookAccounts(facebookResult.accounts || []);
      setFacebookConfiguration(facebookResult.configuration || { ready: false, missing: [] });
    }
    if (microsoftResponse.ok) { setMicrosoftConnection((microsoftResult.connections || [])[0] || null); setMicrosoftConfiguration(microsoftResult.configuration || { ready: false, missing: [] }); }
    if (whatsappResponse.ok) { setWhatsappAccounts(whatsappResult.accounts || []); setWhatsappConfiguration(whatsappResult.configuration || { ready: false, missing: [], webhookUrl: "" }); }
    if (!robuustResponse.ok || !metaResponse.ok || !facebookResponse.ok || !microsoftResponse.ok || !whatsappResponse.ok) setIntegrationError(robuustResult.error || metaResult.error || facebookResult.error || microsoftResult.error || whatsappResult.error || "Koppelingen konden niet worden geladen.");
  }, [session.access_token, workspaceId]);

  useEffect(() => { loadAccounts(); }, [loadAccounts]);

  const loadBrevoForBusiness = useCallback(async (businessId, showProgress = false) => {
    if (!businessId) return;
    if (showProgress) setSyncingBrevoBusinessId(businessId);
    const headers = { Authorization: `Bearer ${session.access_token}` };
    const query = `workspaceId=${encodeURIComponent(workspaceId)}&businessId=${encodeURIComponent(businessId)}`;
    try {
      const [statusResponse, listsResponse, campaignsResponse] = await Promise.all([
        fetch(`/api/integrations/brevo?${query}&resource=status`, { headers }),
        fetch(`/api/integrations/brevo?${query}&resource=lists`, { headers }),
        fetch(`/api/integrations/brevo?${query}&resource=campaigns`, { headers }),
      ]);
      const [statusResult, listsResult, campaignsResult] = await Promise.all([
        statusResponse.json(), listsResponse.json(), campaignsResponse.json(),
      ]);
      const error = statusResult.error || listsResult.error || campaignsResult.error || "";
      setBrevoByBusiness((current) => ({
        ...current,
        [businessId]: {
          ok: statusResponse.ok && listsResponse.ok && campaignsResponse.ok,
          error,
          account: statusResult.account || null,
          configured: Boolean(statusResult.configured),
          listIds: statusResult.listIds || [],
          lists: listsResult.lists || [],
          campaigns: campaignsResult.campaigns || [],
        },
      }));
      if (showProgress) {
        if (statusResponse.ok && listsResponse.ok && campaignsResponse.ok) setIntegrationMessage("Brevo is gecontroleerd en de gegevens zijn bijgewerkt.");
        else setIntegrationError(error || "Brevo kon niet volledig worden geladen.");
      }
    } catch {
      setBrevoByBusiness((current) => ({ ...current, [businessId]: { ok: false, error: "Brevo kon niet worden bereikt.", lists: [], campaigns: [] } }));
      if (showProgress) setIntegrationError("Brevo kon niet worden bereikt.");
    } finally {
      if (showProgress) setSyncingBrevoBusinessId("");
    }
  }, [session.access_token, workspaceId]);

  useEffect(() => {
    businesses.forEach((business) => loadBrevoForBusiness(business.id));
  }, [businesses, loadBrevoForBusiness]);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const status = params.get("microsoft");
    const account = params.get("account");
    const message = params.get("message");
    if (status === "connected") setIntegrationMessage(`Microsoft-agenda van ${account || "jouw account"} is succesvol gekoppeld.`);
    if (status === "error") setIntegrationError(message || "De Microsoft-agenda kon niet worden gekoppeld.");
    if (status) {
      params.delete("microsoft"); params.delete("account"); params.delete("message");
      const query = params.toString();
      window.history.replaceState({}, "", `${window.location.pathname}${query ? `?${query}` : ""}`);
    }
  }, []);

  async function connectRobuust(formData) {
    setConnecting(true); setIntegrationMessage(""); setIntegrationError("");
    const form = Object.fromEntries(formData);
    const response = await fetch("/api/integrations/robuust", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${session.access_token}` },
      body: JSON.stringify({ workspaceId, businessId: form.businessId, pid: form.pid, apiKey: form.apiKey }),
    });
    const result = await response.json();
    if (response.ok) { setIntegrationMessage(result.message); await loadAccounts(); }
    else setIntegrationError(result.error || "Robuust kon niet worden gekoppeld.");
    setConnecting(false);
  }

  async function connectMeta(formData) {
    setConnecting(true); setIntegrationMessage(""); setIntegrationError("");
    const businessId = String(formData.get("businessId") || "");
    const response = await fetch("/api/integrations/meta", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${session.access_token}` },
      body: JSON.stringify({ workspaceId, businessId }),
    });
    const result = await response.json();
    if (response.ok && result.authorizationUrl) window.location.assign(result.authorizationUrl);
    else { setIntegrationError(result.error || "Instagram kon niet worden gestart."); setConnecting(false); }
  }

  async function connectFacebook(formData) {
    setConnecting(true); setIntegrationMessage(""); setIntegrationError("");
    const businessId = String(formData.get("businessId") || "");
    const response = await fetch("/api/integrations/facebook", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${session.access_token}` },
      body: JSON.stringify({ workspaceId, businessId }),
    });
    const result = await response.json();
    if (response.ok && result.authorizationUrl) window.location.assign(result.authorizationUrl);
    else { setIntegrationError(result.error || "Facebook kon niet worden gestart."); setConnecting(false); }
  }

  async function connectMicrosoft(mailbox) {
    setConnecting(true); setIntegrationMessage(""); setIntegrationError("");
    const response = await fetch("/api/integrations/microsoft", { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${session.access_token}` }, body: JSON.stringify({ workspaceId, mailbox }) });
    const result = await response.json();
    if (response.ok && result.authorizationUrl) window.location.assign(result.authorizationUrl);
    else { setIntegrationError(result.error || "Microsoft 365 kon niet worden gestart."); setConnecting(false); }
  }

  async function verifyMeta(businessId) {
    setTestingMetaBusinessId(businessId); setIntegrationMessage(""); setIntegrationError("");
    const response = await fetch("/api/integrations/meta/verify", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${session.access_token}` },
      body: JSON.stringify({ workspaceId, businessId }),
    });
    const result = await response.json();
    if (response.ok) { setIntegrationMessage(result.message); await loadAccounts(); }
    else setIntegrationError(result.error || "De Instagram-verbinding kon niet worden getest.");
    setTestingMetaBusinessId("");
  }

  async function syncMeta(businessId) {
    setSyncingMetaBusinessId(businessId); setIntegrationMessage(""); setIntegrationError("");
    const response = await fetch("/api/integrations/meta/sync", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${session.access_token}` },
      body: JSON.stringify({ workspaceId, businessId }),
    });
    const result = await response.json();
    if (response.ok) { setIntegrationMessage(result.message); await loadAccounts(); }
    else setIntegrationError(result.error || "Instagram-reacties konden niet worden opgehaald.");
    setSyncingMetaBusinessId("");
  }

  async function syncFacebook(businessId) {
    setSyncingFacebookBusinessId(businessId); setIntegrationMessage(""); setIntegrationError("");
    const response = await fetch("/api/integrations/facebook/sync", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${session.access_token}` },
      body: JSON.stringify({ workspaceId, businessId }),
    });
    const result = await response.json();
    if (response.ok) { setIntegrationMessage(result.message); await loadAccounts(); }
    else setIntegrationError(result.error || "Facebook-berichten konden niet worden opgehaald.");
    setSyncingFacebookBusinessId("");
  }

  const statusLabel = { connected: "Verbonden", pending: "Controleren", degraded: "Aandacht nodig", not_configured: "Niet ingesteld", revoked: "Ingetrokken" };
  return <>
    <section className="pageIntro"><p className="eyebrow">Databronnen</p><h2>Koppelingen</h2><p>Verbind externe systemen via gecontroleerde, traceerbare gegevensstromen.</p></section>
    {integrationMessage && <div className="notice successNotice">{integrationMessage}</div>}
    {integrationError && <div className="notice">{integrationError}</div>}
    <section className="integrationGrid">
      <article className="panel integrationSetup">
        <div className="integrationBrand"><div className="integrationLogo">M365</div><div><h2>Persoonlijke Microsoft-agenda</h2><p>Eigen Outlook-agenda en gedelegeerde agenda&apos;s</p></div></div>
        <div className="scopeBanner"><strong>Alleen lezen</strong><span>Iedere medewerker koppelt het eigen @leclubbbq.nl-account. Gedeelde agenda&apos;s zijn alleen zichtbaar wanneer Microsoft daar al toegang voor heeft verleend.</span></div>
        {!microsoftConfiguration.ready && <div className="notice">Microsoft 365 is nog niet gereed. Ontbrekend: {microsoftConfiguration.missing.join(", ") || "configuratie controleren"}.</div>}
        <button className="primary" type="button" onClick={() => connectMicrosoft(microsoftConnection?.email || session.user.email)} disabled={connecting || !microsoftConfiguration.ready}>{connecting ? "Microsoft openen…" : microsoftConnection ? "Microsoft-agenda opnieuw koppelen" : "Microsoft-agenda koppelen"}</button>
      </article>
      <article className="panel">
        <div className="panelHead"><div><h2>Jouw agendakoppeling</h2><p>Persoonlijk per medewerker, nooit gedeeld met andere gebruikers.</p></div></div>
        {!microsoftConnection ? <Empty text="Nog geen persoonlijke Microsoft-agenda gekoppeld." /> : <div className="connectionRow"><div><strong>{microsoftConnection.display_name || microsoftConnection.email}</strong><span>{microsoftConnection.email}</span><small>Eigen agenda en toegestane gedeelde agenda&apos;s · alleen lezen</small></div><span className="status connected">Verbonden</span></div>}
        <div className="apiScopeList"><h3>Gedeelde agenda&apos;s</h3><span>admin@leclubbbq.nl</span><span>info@leclubbbq.nl</span><span>verhuur@leclubbbq.nl</span><small>Zichtbaar zodra deze agenda&apos;s in Microsoft met jou zijn gedeeld.</small></div>
      </article>
    </section>
    <section className="integrationGrid">
      <article className="panel integrationSetup">
        <div className="integrationBrand"><div className="integrationLogo">R</div><div><h2>Robuust</h2><p>Kassa, reserveringen en operationele data</p></div></div>
        <div className="scopeBanner"><strong>Eerste fase: alleen lezen</strong><span>Horeca OS valideert nu het partnerbedrijf. We schrijven nog niets terug naar Robuust.</span></div>
        <form action={connectRobuust} className="stack">
          <label>Horeca OS-vestiging<select name="businessId" required defaultValue=""><option value="" disabled>Kies een vestiging</option>{businesses.map((business) => <option value={business.id} key={business.id}>{business.name}</option>)}</select></label>
          <label>Robuust PID<input name="pid" required placeholder="Jouw Robuust bedrijfs-ID" autoComplete="off" /></label>
          <label>Robuust API-sleutel<input name="apiKey" type="password" required autoComplete="new-password" placeholder="Eenmalig invoeren" /></label>
          <div className="sensitiveNote"><strong>Versleuteld</strong><span>De API-sleutel wordt opgeslagen in Supabase Vault en verschijnt daarna niet meer op het scherm.</span></div>
          <button className="primary" disabled={connecting}>{connecting ? "Verbinding controleren…" : "Robuust verbinden"}</button>
        </form>
      </article>
      <article className="panel">
        <div className="panelHead"><div><h2>Verbindingsstatus</h2><p>Officiële Robuust Reserveringen-API.</p></div></div>
        {!accounts.length && <Empty text="Nog geen Robuust-koppeling ingesteld." />}
        {accounts.map((account) => <div className="connectionRow" key={account.id}><div><strong>{account.display_name || "Robuust"}</strong><span>PID: {account.external_account_id}</span><small>{account.last_synced_at ? `Gecontroleerd op ${formatDate(account.last_synced_at)}` : "Nog niet gecontroleerd"}</small></div><span className={`status ${account.connection_status}`}>{statusLabel[account.connection_status] || account.connection_status}</span></div>)}
        <div className="apiScopeList"><h3>Beschikbaar via de publieke API</h3><span>✓ Partnerbedrijf herkennen</span><span>✓ Beschikbaarheid van reserveringen controleren</span><span>– Omzet, producten en medewerkers: aanvullende toegang van Robuust nodig</span></div>
      </article>
    </section>
    <section className="integrationGrid">
      <article className="panel integrationSetup">
        <div className="integrationBrand"><div className="integrationLogo">IG</div><div><h2>Instagram</h2><p>Publicaties, reacties en berichten per vestiging</p></div></div>
        <div className="scopeBanner"><strong>Strikt per bedrijf gescheiden</strong><span>Kies eerst de Horeca OS-vestiging en log daarna uitsluitend in op het bijbehorende Instagram-profiel.</span></div>
        {!metaConfiguration.ready && <div className="notice">Instagram is nog niet gereed op de server. Ontbrekend: {metaConfiguration.missing.join(", ") || "configuratie controleren"}.</div>}
        <form action={connectMeta} className="stack">
          <label>Horeca OS-vestiging<select name="businessId" required defaultValue=""><option value="" disabled>Kies een vestiging</option>{businesses.map((business) => <option value={business.id} key={business.id}>{business.name}</option>)}</select></label>
          <div className="sensitiveNote"><strong>Veilig opgeslagen</strong><span>Het toegangstoken wordt versleuteld en is alleen server-side beschikbaar voor deze vestiging.</span></div>
          <button className="primary" disabled={connecting || !metaConfiguration.ready}>{connecting ? "Instagram openen…" : "Instagram-profiel koppelen"}</button>
        </form>
      </article>
      <article className="panel">
        <div className="panelHead"><div><h2>Instagram per vestiging</h2><p>Elk profiel hoort bij precies één Horeca OS-bedrijf.</p></div></div>
        {!metaAccounts.length && <Empty text="Nog geen Instagram-profiel technisch gekoppeld." />}
        {businesses.map((business) => { const account = metaAccounts.find((item) => item.business_id === business.id); return <div className="connectionRow" key={business.id}><div><strong>{business.name}</strong><span>{account ? `@${account.display_name}` : "Geen profiel gekoppeld"}</span><small>{account?.last_synced_at ? `Laatst gecontroleerd ${formatDate(account.last_synced_at)}` : account?.token_expires_at ? `Token geldig tot ${formatDate(account.token_expires_at)}` : "Koppel het juiste Instagram-profiel"}</small></div>{account && <div><button className="secondaryButton" type="button" disabled={testingMetaBusinessId === business.id || syncingMetaBusinessId === business.id} onClick={() => verifyMeta(business.id)}>{testingMetaBusinessId === business.id ? "Testen…" : "Verbinding testen"}</button><button className="secondaryButton" type="button" disabled={syncingMetaBusinessId === business.id || testingMetaBusinessId === business.id} onClick={() => syncMeta(business.id)}>{syncingMetaBusinessId === business.id ? "Ophalen…" : "Reacties ophalen"}</button></div>}<span className={`status ${account?.connection_status || "not_configured"}`}>{account ? statusLabel[account.connection_status] || account.connection_status : "Niet ingesteld"}</span></div>; })}
      </article>
    </section>
    <section className="integrationGrid">
      <article className="panel integrationSetup">
        <div className="integrationBrand"><div className="integrationLogo">FB</div><div><h2>Facebook & campagnes</h2><p>Pagina's, reacties en advertentieprestaties per vestiging</p></div></div>
        <div className="scopeBanner"><strong>Eerste fase: alleen lezen</strong><span>De juiste Facebookpagina wordt automatisch herkend via het gekoppelde Instagram-profiel. Horeca OS plaatst of wijzigt nog niets.</span></div>
        {!facebookConfiguration.ready && <div className="notice">Facebook is nog niet gereed op de server. Ontbrekend: {facebookConfiguration.missing.join(", ") || "configuratie controleren"}.</div>}
        <form action={connectFacebook} className="stack">
          <label>Horeca OS-vestiging<select name="businessId" required defaultValue=""><option value="" disabled>Kies een vestiging</option>{businesses.map((business) => <option value={business.id} key={business.id}>{business.name}</option>)}</select></label>
          <div className="sensitiveNote"><strong>Automatisch gekoppeld</strong><span>De Facebookpagina moet bij het Instagram-profiel van dezelfde vestiging horen. Toegangssleutels blijven versleuteld op de server.</span></div>
          <button className="primary" disabled={connecting || !facebookConfiguration.ready}>{connecting ? "Facebook openen…" : "Facebookpagina koppelen"}</button>
        </form>
      </article>
      <article className="panel">
        <div className="panelHead"><div><h2>Facebook per vestiging</h2><p>Voor reacties, paginaberichten en later campagne-KPI's.</p></div></div>
        {!facebookAccounts.length && <Empty text="Nog geen Facebookpagina technisch gekoppeld." />}
        {businesses.map((business) => { const account = facebookAccounts.find((item) => item.business_id === business.id); const canSync = account?.granted_scopes?.includes("pages_read_engagement"); return <div className="connectionRow" key={business.id}><div><strong>{business.name}</strong><span>{account?.display_name || "Geen Facebookpagina gekoppeld"}</span><small>{account?.last_synced_at ? `Laatst gecontroleerd ${formatDate(account.last_synced_at)}` : account?.token_expires_at ? `Token geldig tot ${formatDate(account.token_expires_at)}` : "Koppel eerst Instagram en daarna Facebook"}</small></div>{account && <button className="secondaryButton" type="button" disabled={!canSync || syncingFacebookBusinessId === business.id} onClick={() => syncFacebook(business.id)}>{canSync ? (syncingFacebookBusinessId === business.id ? "Ophalen…" : "Berichten & reacties ophalen") : "Meta-leesrecht vereist"}</button>}<span className={`status ${account?.connection_status || "not_configured"}`}>{account ? statusLabel[account.connection_status] || account.connection_status : "Niet ingesteld"}</span></div>; })}
      </article>
    </section>
    <section className="integrationGrid">
      <article className="panel integrationSetup">
        <div className="integrationBrand"><div className="integrationLogo">WA</div><div><h2>WhatsApp Business</h2><p>Privéberichten realtime in de Social inbox</p></div></div>
        <div className="scopeBanner"><strong>Per vestiging en telefoonnummer</strong><span>Elk WhatsApp Business-nummer wordt aan precies één Horeca OS-vestiging gekoppeld.</span></div>
        {!whatsappConfiguration.ready && <div className="notice">De veilige ontvangst staat klaar. Nog nodig in Meta: {whatsappConfiguration.missing.join(", ") || "WhatsApp-configuratie"}.</div>}
        {whatsappConfiguration.ready && !whatsappAccounts.length && <div className="notice successNotice">De server is gereed. De volgende stap is het juiste WhatsApp Business-nummer per vestiging autoriseren.</div>}
        <div className="sensitiveNote"><strong>Realtime</strong><span>Nieuwe berichten komen via een gecontroleerde Meta-webhook binnen. Antwoorden worden altijd vanuit het nummer van dezelfde vestiging verzonden.</span></div>
        <small>Webhook: {whatsappConfiguration.webhookUrl || "wordt na configuratie getoond"}</small>
      </article>
      <article className="panel">
        <div className="panelHead"><div><h2>WhatsApp per vestiging</h2><p>Caribbean Corner en Grandcafé Het Plein blijven volledig gescheiden.</p></div></div>
        {businesses.map((business) => { const account = whatsappAccounts.find((item) => item.business_id === business.id); return <div className="connectionRow" key={business.id}><div><strong>{business.name}</strong><span>{account?.display_name || "Geen WhatsApp-nummer gekoppeld"}</span><small>{account?.last_synced_at ? `Laatst bericht ${formatDate(account.last_synced_at)}` : "Koppel straks het eigen WhatsApp Business-nummer"}</small></div><span className={`status ${account?.connection_status || "not_configured"}`}>{account ? statusLabel[account.connection_status] || account.connection_status : "Niet ingesteld"}</span></div>; })}
      </article>
    <section className="integrationGrid">
      <article className="panel integrationSetup">
        <div className="integrationBrand"><div className="integrationLogo">BR</div><div><h2>Brevo</h2><p>Contactlijsten, nieuwsbrieven en campagneprestaties</p></div></div>
        <div className="scopeBanner"><strong>Alleen lezen</strong><span>Horeca OS haalt gegevens op uit Brevo, maar verstuurt of wijzigt nog niets.</span></div>
        <div className="sensitiveNote"><strong>Per vestiging gescheiden</strong><span>Caribbean Corner en Grandcafé Het Plein zien uitsluitend hun toegewezen Brevo-lijsten en campagnes.</span></div>
        <small>De API-sleutel blijft uitsluitend versleuteld op de server beschikbaar.</small>
      </article>
      <article className="panel">
        <div className="panelHead"><div><h2>Brevo per vestiging</h2><p>Live controle van de toegewezen lijsten en verzonden campagnes.</p></div></div>
        {businesses.map((business) => {
          const brevo = brevoByBusiness[business.id];
          const campaigns = brevo?.campaigns || [];
          const totals = campaigns.reduce((summary, campaign) => {
            const stats = campaign.statistics || {};
            summary.delivered += Number(stats.delivered || stats.requested || 0);
            summary.opens += Number(stats.uniqueOpens || stats.viewed || 0);
            summary.clicks += Number(stats.uniqueClicks || stats.clicks || 0);
            summary.unsubscribed += Number(stats.unsubscriptions || 0);
            return summary;
          }, { delivered: 0, opens: 0, clicks: 0, unsubscribed: 0 });
          const openRate = totals.delivered ? Math.round((totals.opens / totals.delivered) * 1000) / 10 : 0;
          const clickRate = totals.delivered ? Math.round((totals.clicks / totals.delivered) * 1000) / 10 : 0;
          return <div className="connectionRow brevoBusiness" key={business.id}>
            <div className="brevoBusinessContent">
              <strong>{business.name}</strong>
              <span>{brevo?.ok ? `${brevo.lists.length} lijst(en) · ${campaigns.length} verzonden campagne(s)` : brevo?.error || "Controleren..."}</span>
              <small>{brevo?.account?.companyName || brevo?.account?.email || (brevo?.configured ? "Brevo-lijsten toegewezen" : "Nog niet ingesteld")}</small>
              {brevo?.ok && <>
                <div className="scopeBanner">
                  <strong>Contactlijsten</strong>
                  <span>{brevo.lists.length ? brevo.lists.map((list) => `${list.name} (${Number(list.totalSubscribers || list.uniqueSubscribers || 0)} contacten)`).join(" · ") : "Geen toegewezen lijsten gevonden."}</span>
                </div>
                <div className="scopeBanner">
                  <strong>Campagneprestaties</strong>
                  <span>{campaigns.length ? `${totals.delivered} bezorgd · ${openRate}% geopend · ${clickRate}% geklikt · ${totals.unsubscribed} afmeldingen` : "Er zijn nog geen verzonden campagnes voor deze vestiging gevonden."}</span>
                </div>
                {campaigns.slice(0, 5).map((campaign) => {
                  const stats = campaign.statistics || {};
                  const delivered = Number(stats.delivered || stats.requested || 0);
                  const opens = Number(stats.uniqueOpens || stats.viewed || 0);
                  const clicks = Number(stats.uniqueClicks || stats.clicks || 0);
                  return <div className="factorRow" key={campaign.id}>
                    <div>
                      <strong>{campaign.subject || campaign.name || "Campagne zonder onderwerp"}</strong>
                      <small>{campaign.sentDate ? new Date(campaign.sentDate).toLocaleDateString("nl-NL") : "Verzenddatum onbekend"} · {delivered} bezorgd · {opens} opens · {clicks} clicks</small>
                    </div>
                  </div>;
                })}
              </>}
            </div>
            <div className="connectionActions">
              <button type="button" className="secondary" disabled={syncingBrevoBusinessId === business.id} onClick={() => loadBrevoForBusiness(business.id, true)}>
                {syncingBrevoBusinessId === business.id ? "Controleren..." : "Brevo verversen"}
              </button>
              <span className={`status ${brevo?.ok ? "connected" : brevo ? "degraded" : "pending"}`}>{brevo?.ok ? "Verbonden" : brevo ? "Aandacht nodig" : "Controleren"}</span>
            </div>
          </div>;
        })}
      </article>
    </section>
    </section>
  </>;
}

function UsersAdmin({ workspaceId, session }) {
  const [adminData, setAdminData] = useState({ users: [], roles: [], businesses: [], locations: [] });
  const [loadingUsers, setLoadingUsers] = useState(true);
  const [adminMessage, setAdminMessage] = useState("");
  const [adminError, setAdminError] = useState("");

  const loadUsers = useCallback(async () => {
    setLoadingUsers(true); setAdminError("");
    const response = await fetch(`/api/admin/users?workspaceId=${encodeURIComponent(workspaceId)}`, {
      headers: { Authorization: `Bearer ${session.access_token}` },
    });
    const result = await response.json();
    if (!response.ok) setAdminError(result.error || "Gebruikers konden niet worden geladen.");
    else setAdminData(result);
    setLoadingUsers(false);
  }, [session.access_token, workspaceId]);

  useEffect(() => { loadUsers(); }, [loadUsers]);

  async function submitAdminAction(payload) {
    setAdminMessage(""); setAdminError("");
    const response = await fetch("/api/admin/users", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${session.access_token}` },
      body: JSON.stringify({ ...payload, workspaceId }),
    });
    const result = await response.json();
    if (!response.ok) { setAdminError(result.error || "De actie kon niet worden uitgevoerd."); return false; }
    setAdminMessage(result.message || "Opgeslagen.");
    await loadUsers();
    return true;
  }

  async function inviteUser(formData) {
    const form = Object.fromEntries(formData);
    await submitAdminAction({
      ...form,
      action: "invite",
      fullName: `${form.firstName || ""} ${form.lastName || ""}`.trim(),
      businessId: form.businessId || null,
      locationId: null,
      robuustRoles: formData.getAll("robuustRoles"),
      functions: formData.getAll("functions"),
      permissions: formData.getAll("permissions"),
    });
  }

  async function updateUser(formData) {
    const form = Object.fromEntries(formData);
    await submitAdminAction({
      action: "replace-assignment", userId: form.userId, roleId: form.roleId,
      businessId: form.businessId || null, locationId: null,
      permissions: formData.getAll("permissions"),
    });
  }

  async function saveEmployee(formData) {
    const form = Object.fromEntries(formData);
    return submitAdminAction({
      ...form,
      action: "save-employee",
      robuustRoles: formData.getAll("robuustRoles"),
      functions: formData.getAll("functions"),
    });
  }

  const roleName = (assignment) => assignment?.role?.name || "Geen rol";
  const businessName = (id) => adminData.businesses.find((item) => item.id === id)?.name || "Alle vestigingen";

  return <>
    <section className="pageIntro"><p className="eyebrow">Toegangs- en personeelsbeheer</p><h2>Gebruikers & rollen</h2><p>Beheer Horeca OS-toegang en het Robuust-personeelsdossier afzonderlijk en veilig.</p></section>
    {adminMessage && <div className="notice successNotice">{adminMessage}</div>}
    {adminError && <div className="notice">{adminError}</div>}
    <section className="userAdminGrid">
      <article className="panel invitePanel creationPanel">
        <div className="panelHead"><div><h2>Nieuwe medewerker</h2><p>Volledig personeelsformulier, voorbereid op de toekomstige Robuust-koppeling.</p></div></div>
        <div className="recordTabs"><span className="active">Gegevens</span><span>Beoordelingen</span><span>Ziekte & verlof</span><span>Bonussen</span><span>Dossier</span><span>Documenten</span></div>
        <form action={inviteUser} className="employeeForm creationForm">
          <div className="formSection full"><h3>Account en toegang</h3><p>De medewerker ontvangt na het opslaan een persoonlijke activatielink per e-mail.</p></div>
          <label>Voornaam *<input name="firstName" required autoComplete="given-name" /></label>
          <label>Achternaam *<input name="lastName" required autoComplete="family-name" /></label>
          <label>E-mail *<input name="email" type="email" required autoComplete="email" /></label>
          <label>Personeelsnummer<input name="employeeNumber" /></label>
          <AccessFields roles={adminData.roles} businesses={adminData.businesses} />
          <fieldset className="full"><legend>Robuust-rollen *</legend><div className="checkGrid">{ROBUUST_ROLE_OPTIONS.map(([value, label]) => <label className="checkOption" key={value}><input type="checkbox" name="robuustRoles" value={value} />{label}</label>)}</div></fieldset>
          <label>Pincode<input name="pinCode" type="password" inputMode="numeric" autoComplete="new-password" placeholder="Wordt versleuteld opgeslagen" /></label>
          <label>Telefoonnummer<input name="phone" type="tel" /></label>
          <label>Eerste dag loonverband<input name="employmentStart" type="date" /></label>
          <label>Laatste dag loonverband<input name="employmentEnd" type="date" /></label>
          <label className="full">Competenties<input name="competencies" placeholder="Bijvoorbeeld BHV, sociale hygiëne, wijnkennis" /></label>
          <label>Adres<input name="address" autoComplete="street-address" /></label>
          <div className="splitFields"><label>Postcode<input name="postalCode" autoComplete="postal-code" /></label><label>Woonplaats<input name="city" autoComplete="address-level2" /></label></div>
          <label>Geboorteplaats<input name="birthplace" /></label>
          <label>Geboortedatum<input name="birthDate" type="date" /></label>
          <fieldset className="full"><legend>Functie(s)</legend><div className="checkGrid">{EMPLOYEE_FUNCTION_OPTIONS.map(([value, label]) => <label className="checkOption" key={value}><input type="checkbox" name="functions" value={value} />{label}</label>)}</div></fieldset>
          <fieldset><legend>Loonkosten type</legend><label className="radioOption"><input type="radio" name="wageType" value="hourly" />Uurloon (oproepkracht)</label><label className="radioOption"><input type="radio" name="wageType" value="monthly" />Maandloon (vaste dienst)</label></fieldset>
          <label>Loon (€)<input name="wageAmount" type="number" min="0" step="0.01" /></label>
          <label>BSN-nummer<input name="bsn" inputMode="numeric" autoComplete="off" placeholder="Wordt versleuteld opgeslagen" /></label>
          <label>Bankrekening<input name="iban" autoComplete="off" placeholder="Wordt versleuteld opgeslagen" /></label>
          <label>Ranking<input name="ranking" type="number" min="-1" defaultValue="10" /><small>-1 verbergt de medewerker in Robuust-lijsten.</small></label>
          <label>Robuust medewerker-ID<input name="externalEmployeeId" placeholder="Later automatisch gevuld door koppeling" /></label>
          <div className="sensitiveNote full"><strong>Extra beveiligd</strong><span>BSN, bankrekening, pincode, geboortedatum en loon worden versleuteld opgeslagen. Horeca OS-rollen blijven gescheiden van Robuust-functies.</span></div>
          <div className="formActions full"><button type="reset" className="secondaryButton">Leegmaken</button><button className="primary" disabled={loadingUsers}>{loadingUsers ? "Even geduld…" : "Medewerker aanmaken"}</button></div>
        </form>
      </article>
      <article className="panel usersPanel">
        <div className="panelHead"><div><h2>Actieve en uitgenodigde gebruikers</h2><p>{adminData.users.length} gebruiker(s) binnen deze werkruimte.</p></div></div>
        {loadingUsers && <Empty text="Gebruikers laden…" />}
        {!loadingUsers && !adminData.users.length && <Empty text="Nog geen gebruikers gevonden." />}
        <div className="userList">{adminData.users.map((user) => {
          const assignment = user.assignments[0];
          return <div className="userBlock" key={user.id}>
            <form action={updateUser} className="userRow accessEditor">
              <input type="hidden" name="userId" value={user.id} />
              <div className="userIdentity"><strong>{user.fullName || user.email}</strong><span>{user.email}</span><small>{user.confirmed ? "Actief" : "Uitnodiging verstuurd"}</small></div>
              <AccessFields roles={adminData.roles} businesses={adminData.businesses} initialRoleId={assignment?.role_id} initialBusinessId={assignment?.business_id} initialPermissions={assignment?.assignment_permissions?.map((item) => item.permission)} compact />
              <div className="userScope"><span>{roleName(assignment)}</span><small>{businessName(assignment?.business_id)}</small></div>
              <button className="secondaryButton">Toegang opslaan</button>
            </form>
            <EmployeeEditor key={user.employee?.updated_at || "new"} user={user} onSave={saveEmployee} />
          </div>;
        })}</div>
      </article>
    </section>
  </>;
}

const PERMISSION_OPTIONS = [
  ["workspace:manage", "Volledige werkruimte beheren", false],
  ["operations:read", "Eigen werk, planning en inklokken"], ["operations:manage", "Operationele gegevens beheren"],
  ["processes:read", "Procestaken bekijken"],
  ["processes:monitor", "Procesvoortgang van anderen volgen"],
  ["processes:manage", "Processen starten, toewijzen en beheren"],
  ["revenue:read", "Omzet en verkoopcijfers bekijken"],
  ["time:read", "Uren van medewerkers bekijken"],
  ["time:manage", "Uren van medewerkers corrigeren"],
  ["schedule:read", "Eigen rooster en beschikbaarheid bekijken"],
  ["schedule:manage", "Roosters en diensten beheren"],
  ["finance:read", "Financiën bekijken"], ["foodcost:read", "Foodcost, producten en recepten bekijken"],
  ["foodcost:manage", "Foodcost, producten en recepten beheren"], ["kitchen:manage", "Keuken beheren"],
  ["reviews:read", "Reviews bekijken"], ["reviews:respond", "Op reviews reageren"],
  ["reviews:manage", "Reviews beheren"], ["marketing:read", "Marketing bekijken"],
  ["marketing:manage", "Marketing beheren"], ["social:read", "Social media bekijken"],
  ["social:manage", "Social media beheren"], ["social:publish", "Social media publiceren"],
  ["ai:read", "AI-gesprekken bekijken"], ["ai:use", "AI-assistent gebruiken"],
  ["integrations:read", "Koppelingen bekijken"], ["integrations:manage", "Koppelingen beheren"],
  ["users:read", "Gebruikers bekijken"], ["users:manage", "Gebruikers en rechten beheren"],
  ["audit:read", "Controlelogboek bekijken"], ["ai:audit", "AI-gebruik controleren"],
];

function AccessFields({ roles, businesses, initialRoleId = "", initialBusinessId = "", initialPermissions = [], compact = false }) {
  const [roleId, setRoleId] = useState(initialRoleId || "");
  const role = roles.find((item) => item.id === roleId);
  const custom = role?.role_key === "custom";
  const roleHelp = {
    owner: "Volledige toegang tot de werkruimte, gebruikers en alle instellingen.",
    manager: "Mag processen starten, taken toewijzen, voortgang beheren en alle relevante onderdelen bekijken.",
    shift_lead: "Kan de voortgang van processen volgen, maar hoeft geen taken toe te wijzen of processen te beheren.",
    viewer: "Kan toegankelijke informatie bekijken zonder wijzigingen te maken.",
    employee: "Werkt met eigen toegewezen taken en kan de voortgang daarvan vooruitzetten.",
    staff: "Werkt met eigen toegewezen taken en kan de voortgang daarvan vooruitzetten.",
    kitchen_manager: "Kan keuken- en procesinformatie beheren binnen de toegewezen vestiging.",
  }[role?.role_key] || "";
  const fixedPermissions = new Set(role?.role_permissions?.map((item) => item.permission) || []);
  const customOptions = PERMISSION_OPTIONS.filter(([, , customAllowed = true]) => customAllowed);
  return <>
    <label>Horeca OS-rol *<select name="roleId" required value={roleId} onChange={(event) => setRoleId(event.target.value)}><option value="" disabled>Kies een rol</option>{roles.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
    <label>{compact ? "Toegang" : "Vestigingstoegang"}<select name="businessId" defaultValue={initialBusinessId || ""}><option value="">Alle vestigingen</option>{businesses.map((business) => <option key={business.id} value={business.id}>{business.name}</option>)}</select></label>
    {roleHelp && <p className="muted full">{roleHelp}</p>}
    {role && <fieldset className={`permissionPicker full ${custom ? "editable" : "readOnly"}`}><legend>{custom ? "Machtigingen voor deze gebruiker *" : `Toegang met de rol ${role.name}`}</legend><p>{custom ? "Vink alleen aan wat deze gebruiker binnen de gekozen vestiging mag doen." : "Dit is het vaste rechtenpakket van deze rol. Kies Aangepast wanneer je losse rechten wilt aanvinken."}</p>{custom
      ? <div className="permissionGrid">{customOptions.map(([value, label]) => <label className="checkOption" key={value}><input type="checkbox" name="permissions" value={value} defaultChecked={initialPermissions.includes(value)} />{label}</label>)}</div>
      : <div className="permissionGrid permissionSummary">{PERMISSION_OPTIONS.map(([value, label]) => <span className={fixedPermissions.has(value) || role.role_key === "owner" ? "granted" : "denied"} key={value}><b>{fixedPermissions.has(value) || role.role_key === "owner" ? "✓" : "–"}</b>{label}</span>)}</div>}</fieldset>}
  </>;
}

const ROBUUST_ROLE_OPTIONS = [
  ["admin", "admin"], ["coworker", "coworker"], ["manager hr", "manager hr"],
  ["manager operations", "manager operations"], ["manager kitchen", "manager kitchen"],
  ["manager customers", "manager customers"], ["manager finance", "manager finance"], ["deliverer", "deliverer"],
];
const EMPLOYEE_FUNCTION_OPTIONS = [
  ["admin", "Admin"], ["bediening", "Bediening"], ["chefkok", "Chefkok"], ["kok", "Kok"],
  ["keukenhulp", "Keukenhulp"], ["floormanager", "Floormanager"], ["bezorgers", "Bezorgers"], ["mt", "MT"],
];

function EmployeeEditor({ user, onSave }) {
  const employee = user.employee || {};
  const nameParts = String(user.fullName || "").trim().split(/\s+/);
  const firstName = employee.first_name || nameParts[0] || "";
  const lastName = employee.last_name || nameParts.slice(1).join(" ") || "";
  const selectedRoles = employee.robuust_roles || [];
  const selectedFunctions = employee.functions || [];

  return <details className="employeeDetails">
    <summary><span>Robuust-personeelsdossier</span><small>{employee.id ? (employee.sync_status === "synced" ? "Gekoppeld" : "Dossier aanwezig") : "Nog aanvullen"}</small></summary>
    <form action={onSave} className="employeeForm">
      <input type="hidden" name="userId" value={user.id} />
      <div className="formSection full"><h3>Gegevens</h3><p>De functies hieronder zijn Robuust-kassagegevens en geven geen Horeca OS-beheerrechten.</p></div>
      <label>Voornaam *<input name="firstName" required defaultValue={firstName} /></label>
      <label>Achternaam *<input name="lastName" required defaultValue={lastName} /></label>
      <fieldset className="full"><legend>Robuust-rollen *</legend><div className="checkGrid">{ROBUUST_ROLE_OPTIONS.map(([value, label]) => <label className="checkOption" key={value}><input type="checkbox" name="robuustRoles" value={value} defaultChecked={selectedRoles.includes(value)} />{label}</label>)}</div></fieldset>
      <label>E-mail *<input name="email" type="email" required defaultValue={employee.email || user.email} /></label>
      <label>Personeelsnummer<input name="employeeNumber" defaultValue={employee.employee_number || ""} /></label>
      <label>Pincode<input name="pinCode" type="password" inputMode="numeric" autoComplete="new-password" placeholder={employee.has_pin ? "Ingesteld — leeg laten om te behouden" : "Nieuwe pincode"} /></label>
      <label>Telefoonnummer<input name="phone" type="tel" defaultValue={employee.phone || ""} /></label>
      <label>Eerste dag loonverband<input name="employmentStart" type="date" defaultValue={employee.employment_start || ""} /></label>
      <label>Laatste dag loonverband<input name="employmentEnd" type="date" defaultValue={employee.employment_end || ""} /></label>
      <label className="full">Competenties<input name="competencies" defaultValue={(employee.competencies || []).join(", ")} placeholder="Bijvoorbeeld BHV, sociale hygiëne, wijnkennis" /></label>
      <label>Adres<input name="address" autoComplete="street-address" defaultValue={employee.address || ""} /></label>
      <div className="splitFields"><label>Postcode<input name="postalCode" autoComplete="postal-code" defaultValue={employee.postal_code || ""} /></label><label>Woonplaats<input name="city" autoComplete="address-level2" defaultValue={employee.city || ""} /></label></div>
      <label>Geboorteplaats<input name="birthplace" defaultValue={employee.birthplace || ""} /></label>
      <label>Geboortedatum<input name="birthDate" type="date" defaultValue={employee.birth_date || ""} /></label>
      <fieldset className="full"><legend>Functie(s)</legend><div className="checkGrid">{EMPLOYEE_FUNCTION_OPTIONS.map(([value, label]) => <label className="checkOption" key={value}><input type="checkbox" name="functions" value={value} defaultChecked={selectedFunctions.includes(value)} />{label}</label>)}</div></fieldset>
      <fieldset><legend>Loonkosten type</legend><label className="radioOption"><input type="radio" name="wageType" value="hourly" defaultChecked={employee.wage_type === "hourly"} />Uurloon</label><label className="radioOption"><input type="radio" name="wageType" value="monthly" defaultChecked={employee.wage_type === "monthly"} />Maandloon</label></fieldset>
      <label>Loon (€)<input name="wageAmount" type="number" min="0" step="0.01" defaultValue={employee.wage_amount ?? ""} /></label>
      <label>BSN-nummer<input name="bsn" inputMode="numeric" autoComplete="off" placeholder={employee.has_bsn ? `Ingesteld •••• ${employee.bsn_last_four}` : "Wordt versleuteld opgeslagen"} /></label>
      <label>Bankrekening<input name="iban" autoComplete="off" placeholder={employee.has_iban ? employee.iban_masked : "Wordt versleuteld opgeslagen"} /></label>
      <label>Ranking<input name="ranking" type="number" min="-1" defaultValue={employee.ranking ?? 10} /><small>-1 verbergt de medewerker in Robuust-lijsten.</small></label>
      <label>Robuust medewerker-ID<input name="externalEmployeeId" defaultValue={employee.external_employee_id || ""} placeholder="Later automatisch gevuld door koppeling" /></label>
      <div className="sensitiveNote full"><strong>Extra beveiligd</strong><span>BSN, bankrekening, pincode, geboortedatum en loon worden versleuteld opgeslagen. Geheime waarden verschijnen niet in het gebruikersoverzicht.</span></div>
      <div className="formActions full"><button className="primary">Personeelsdossier opslaan</button></div>
    </form>
  </details>;
}

function getDateRanges(now) {
  const todayDate = startOfDay(now);
  const yesterdayDate = addDays(todayDate, -1);
  const weekStartDate = addDays(todayDate, -((todayDate.getDay() + 6) % 7));
  const monthStartDate = new Date(todayDate.getFullYear(), todayDate.getMonth(), 1);
  const previousMonthStart = new Date(todayDate.getFullYear(), todayDate.getMonth() - 1, 1);
  return { today: isoDate(todayDate), yesterday: isoDate(yesterdayDate), weekStart: isoDate(weekStartDate), monthStart: isoDate(monthStartDate), queryStart: isoDate(previousMonthStart) };
}

function buildFoodcostAnalytics(data) {
  const products = new Map(data.foodProducts.map((item) => [item.id, item]));
  const ingredients = new Map(data.ingredients.map((item) => [item.id, item]));
  const recipes = new Map(data.recipes.map((item) => [item.id, item]));
  const itemsByRecipe = new Map();
  data.recipeItems.forEach((item) => itemsByRecipe.set(item.recipe_id, [...(itemsByRecipe.get(item.recipe_id) || []), item]));
  const items = data.menuItems.map((menuItem) => {
    const recipe = recipes.get(menuItem.recipe_id);
    const lines = itemsByRecipe.get(menuItem.recipe_id) || [];
    const cost = lines.reduce((total, line) => {
      const ingredient = ingredients.get(line.ingredient_id);
      const product = products.get(ingredient?.product_id || line.product_id);
      if (!product) return total;
      const usableUnits = ingredient ? number(ingredient.units_per_product) * (number(ingredient.yield_percentage || 100) / 100) : number(product.content_quantity || 1);
      const unitCost = usableUnits ? number(product.purchase_price) / usableUnits : 0;
      const wasteFactor = 1 - number(line.waste_percentage || 0) / 100;
      return total + (wasteFactor > 0 ? number(line.quantity) * unitCost / wasteFactor : 0);
    }, 0);
    const sellingPrice = number(menuItem.selling_price);
    const foodcost = sellingPrice ? cost / sellingPrice * 100 : 0;
    const target = number(recipe?.target_foodcost_percentage);
    return { id: menuItem.id, name: menuItem.name, category: menuItem.category, cost, sellingPrice, foodcost, target, lines: lines.length, warning: foodcost > 40 || (target > 0 && foodcost > target) };
  }).filter((item) => item.lines > 0 && item.sellingPrice > 0);
  const ranked = [...items].sort((a, b) => a.foodcost - b.foodcost);
  return { items, average: items.length ? items.reduce((sumValue, item) => sumValue + item.foodcost, 0) / items.length : null, best: ranked[0] || null, worst: ranked.at(-1) || null, warnings: items.filter((item) => item.warning) };
}

function buildSalesAnalytics(sales, products, now) {
  const ranges = getDateRanges(now);
  const todayDate = startOfDay(now);
  const yesterdayDate = addDays(todayDate, -1);
  const weekStart = parseDate(ranges.weekStart);
  const monthStart = parseDate(ranges.monthStart);
  const previousWeekEnd = addDays(weekStart, -1);
  const previousWeekStart = addDays(previousWeekEnd, -(daysBetween(weekStart, todayDate)));
  const previousMonthEnd = addDays(monthStart, -1);
  const previousMonthStart = new Date(previousMonthEnd.getFullYear(), previousMonthEnd.getMonth(), 1);
  const comparablePreviousMonthEnd = new Date(previousMonthEnd.getFullYear(), previousMonthEnd.getMonth(), Math.min(todayDate.getDate(), previousMonthEnd.getDate()));

  const period = (start, end, previousStart, previousEnd) => {
    const currentRows = rowsBetween(sales, start, end);
    const previousRows = rowsBetween(sales, previousStart, previousEnd);
    const revenue = sum(currentRows, "revenue_inc_vat");
    const previousRevenue = sum(previousRows, "revenue_inc_vat");
    const orders = sum(currentRows, "order_count");
    return { revenue, previousRevenue, orders, averageTicket: orders ? revenue / orders : 0, change: percentageChange(revenue, previousRevenue) };
  };

  const monthRows = rowsBetween(sales, monthStart, todayDate);
  const takeawayRevenue = sum(monthRows, "takeaway_revenue");
  const ownRevenue = sum(monthRows, "own_channel_revenue");
  const totalRevenue = sum(monthRows, "revenue_inc_vat");
  const otherRevenue = Math.max(totalRevenue - takeawayRevenue - ownRevenue, 0);
  const productTotals = new Map();
  products.forEach((row) => {
    const name = String(row.product_name || "Onbekend product").trim();
    productTotals.set(name, (productTotals.get(name) || 0) + number(row.quantity));
  });

  return {
    today: period(todayDate, todayDate, yesterdayDate, yesterdayDate),
    yesterday: period(yesterdayDate, yesterdayDate, addDays(yesterdayDate, -1), addDays(yesterdayDate, -1)),
    week: period(weekStart, todayDate, previousWeekStart, previousWeekEnd),
    month: period(monthStart, todayDate, previousMonthStart, comparablePreviousMonthEnd),
    channels: [
      { label: "Takeaway", revenue: takeawayRevenue, orders: sum(monthRows, "takeaway_order_count"), share: share(takeawayRevenue, totalRevenue) },
      { label: "Eigen website en app", revenue: ownRevenue, orders: sum(monthRows, "own_channel_order_count"), share: share(ownRevenue, totalRevenue) },
      { label: "Overige omzet", revenue: otherRevenue, orders: Math.max(sum(monthRows, "order_count") - sum(monthRows, "takeaway_order_count") - sum(monthRows, "own_channel_order_count"), 0), share: share(otherRevenue, totalRevenue) },
    ],
    topProducts: [...productTotals.entries()].map(([name, quantity]) => ({ name, quantity })).sort((a, b) => b.quantity - a.quantity).slice(0, 8),
  };
}

function SalesCard({ label, period }) {
  const hasComparison = period.previousRevenue !== 0;
  const tone = hasComparison ? (period.change >= 0 ? "success" : "danger") : "normal";
  return <Card label={label} value={money(period.revenue)} sub={hasComparison ? `${signedPercent(period.change)} t.o.v. vorige periode` : "Geen vergelijkingsdata"} tone={tone} />;
}

function LoginScreen({ signIn, requestPasswordReset, message, initialResetMode = false, lockResetMode = false }) {
  const [resetMode, setResetMode] = useState(initialResetMode);
  return <main className="authPage"><section className="authCard"><div className="brand dark">Horeca OS</div><h1>{resetMode ? "Wachtwoord herstellen" : "Veilig inloggen"}</h1><p>{resetMode ? "Vul je e-mailadres in. Je ontvangt een link om een nieuw wachtwoord te kiezen." : "Managementplatform voor jouw horecabedrijven"}</p>{message && <div className="notice">{message}</div>}{resetMode ? <form action={requestPasswordReset} className="stack"><label>E-mailadres<input name="email" type="email" required autoComplete="email" /></label><button className="primary">Herstelmail versturen</button></form> : <form action={signIn} className="stack"><label>E-mailadres<input name="email" type="email" required autoComplete="email" /></label><label>Wachtwoord<input name="password" type="password" required autoComplete="current-password" /></label><button className="primary">Inloggen</button></form>}{!lockResetMode && <button type="button" className="textButton" onClick={() => setResetMode((current) => !current)}>{resetMode ? "Terug naar inloggen" : "Wachtwoord vergeten?"}</button>}<small>Nieuwe accounts worden uitsluitend door een beheerder toegevoegd.</small></section></main>;
}

function PasswordRecoveryScreen({ onSave, message, email }) {
  return <main className="authPage"><section className="authCard"><div className="brand dark">Horeca OS</div><h1>Nieuw wachtwoord instellen</h1><p>Kies een nieuw wachtwoord voor:</p>{email && <p><strong>{email}</strong></p>}<p>Daarna krijg je toegang tot Horeca OS.</p>{message && <div className="notice">{message}</div>}<form action={onSave} className="stack"><label>Nieuw wachtwoord<input name="password" type="password" minLength="6" required autoComplete="new-password" /></label><label>Herhaal wachtwoord<input name="confirmation" type="password" minLength="6" required autoComplete="new-password" /></label><button className="primary">Wachtwoord opslaan</button></form><small>Gebruik minimaal 6 tekens.</small></section></main>;
}

function Card({ label, value, sub, tone = "normal" }) { return <article className={`card ${tone}`}><span>{label}</span><strong>{value ?? 0}</strong><small>{sub}</small></article>; }
function ChannelCard({ label, revenue, orders, share: channelShare }) { const orderCount = number(orders); return <article className="channelCard"><div><span>{label}</span><strong>{money(revenue)}</strong></div><div className="channelMeta"><small>{new Intl.NumberFormat("nl-NL").format(orderCount)} {orderCount === 1 ? "bestelling" : "bestellingen"}</small><small>{new Intl.NumberFormat("nl-NL", { minimumFractionDigits: 1, maximumFractionDigits: 1 }).format(channelShare)}% van omzet</small></div></article>; }
function Panel({ title, subtitle, children }) { return <article className="panel"><div className="panelHead"><div><h2>{title}</h2><p>{subtitle}</p></div></div>{children}</article>; }
function Empty({ text }) { return <p className="empty">{text}</p>; }
function buildAdvice({ criticalTasks, sales, events, securityWarnings }) { if (criticalTasks.length) return `Pak eerst ${criticalTasks.length} kritieke ${criticalTasks.length === 1 ? "taak" : "taken"} op.`; if (securityWarnings) return `${securityWarnings} beveiligingscontrole${securityWarnings === 1 ? " vraagt" : "s vragen"} aandacht.`; if (!sales.revenue) return "Er is vandaag nog geen omzet geregistreerd."; if (!events.length) return "De komende agenda is leeg; controleer evenementen en commerciële planning."; return "De basis is stabiel. Volg omzet en operationele prioriteiten per vestiging."; }
function rowsBetween(rows, start, end) { const from = isoDate(start); const through = isoDate(end); return rows.filter((row) => row.sales_date >= from && row.sales_date <= through); }
function sum(rows, key) { return rows.reduce((total, row) => total + number(row[key]), 0); }
function share(value, total) { return total ? (value / total) * 100 : 0; }
function percentageChange(current, previous) { return previous ? ((current - previous) / previous) * 100 : 0; }
function signedPercent(value) { return `${value >= 0 ? "+" : ""}${value.toFixed(1)}%`; }
function number(value) { const parsed = Number(value); return Number.isFinite(parsed) ? parsed : 0; }
function money(value) { return new Intl.NumberFormat("nl-NL", { style: "currency", currency: "EUR" }).format(number(value)); }
function startOfDay(date) { return new Date(date.getFullYear(), date.getMonth(), date.getDate()); }
function addDays(date, amount) { const result = new Date(date); result.setDate(result.getDate() + amount); return result; }
function daysBetween(start, end) { return Math.round((startOfDay(end) - startOfDay(start)) / 86400000); }
function isoDate(date) { const local = startOfDay(date); return `${local.getFullYear()}-${String(local.getMonth() + 1).padStart(2, "0")}-${String(local.getDate()).padStart(2, "0")}`; }
function parseDate(value) { const [year, month, day] = value.split("-").map(Number); return new Date(year, month - 1, day); }
function formatDate(value) { if (!value) return ""; return new Intl.DateTimeFormat("nl-NL", { dateStyle: "medium", timeStyle: "short" }).format(new Date(value)); }
function formatTime(value) { if (!value) return ""; return new Intl.DateTimeFormat("nl-NL", { hour: "2-digit", minute: "2-digit" }).format(new Date(value)); }
function formatDuration(minutes) { const safeMinutes = Math.max(0, Math.round(number(minutes))); const hours = Math.floor(safeMinutes / 60); const rest = safeMinutes % 60; return `${hours}u ${String(rest).padStart(2, "0")}m`; }
function timeEntryEmployeeName(entry) { const profile = Array.isArray(entry.member?.profile) ? entry.member.profile[0] : entry.member?.profile; return profile?.full_name || `Medewerker ${entry.user_id.slice(0, 6)}`; }
function memberProfileName(member) { const profile = Array.isArray(member.profile) ? member.profile[0] : member.profile; return profile?.full_name || `Medewerker ${member.user_id.slice(0, 6)}`; }
function formatShortDate(value) { return new Intl.DateTimeFormat("nl-NL", { day: "numeric", month: "short" }).format(value); }
function toLocalDateTimeInput(value) { if (!value) return ""; const date = new Date(value); const offset = date.getTimezoneOffset() * 60000; return new Date(date.getTime() - offset).toISOString().slice(0, 16); }
function localInputToIso(value) { return value ? new Date(String(value)).toISOString() : null; }

function TimeEntryEditor({ entry, businesses, minutes, onCorrect }) {
  return <div className="hoursRecord"><div className="hoursEntry"><div><b>{timeEntryEmployeeName(entry)} {entry.corrected_at && <em className="restoredBadge">Hersteld</em>}</b><span>{entry.business?.name || businesses.find((item) => item.id === entry.business_id)?.name || "Vestiging"} · {formatDate(entry.clocked_in_at)}{entry.break_minutes ? ` · ${entry.break_minutes} min pauze` : ""}</span></div><strong>{entry.clocked_out_at ? formatDuration(minutes) : "Actief"}</strong></div>{entry.correction_reason && <small className="correctionReason">Reden: {entry.correction_reason}</small>}<details className="correctionEditor"><summary>Tijd corrigeren</summary><form onSubmit={(event) => onCorrect(event, entry.id)}><label>Ingeklokt<input name="clockedIn" type="datetime-local" defaultValue={toLocalDateTimeInput(entry.clocked_in_at)} required /></label><label>Uitgeklokt<input name="clockedOut" type="datetime-local" defaultValue={toLocalDateTimeInput(entry.clocked_out_at)} required /></label><label>Pauze (min)<input name="breakMinutes" type="number" min="0" defaultValue={entry.break_minutes || 0} /></label><label>Reden correctie<input name="reason" required maxLength="500" placeholder="Bijv. vergeten uit te klokken" /></label><button className="secondaryButton">Correctie opslaan</button></form></details></div>;
}


