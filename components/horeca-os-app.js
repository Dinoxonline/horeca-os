"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { supabase } from "../lib/supabase";

const priorityRank = { critical: 0, high: 1, medium: 2, low: 3 };
const priorityLabel = { critical: "Kritiek", high: "Hoog", medium: "Midden", low: "Laag" };
const statusLabel = { not_started: "Niet gestart", in_progress: "Bezig", blocked: "Geblokkeerd", done: "Gereed" };

const emptyData = {
  tasks: [], businesses: [], decisions: [], events: [], sales: [], products: [], security: [], integrations: [],
  suppliers: [], foodProducts: [], ingredients: [], recipes: [], recipeItems: [], menuItems: [], aiConversations: [],
};

const routeViews = {
  "/dashboard": "dashboard",
  "/foodcost": "foodcost",
  "/producten": "products",
  "/recepten": "recipes",
  "/leveranciers": "suppliers",
  "/reviews": "reviews",
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
  const [memberships, setMemberships] = useState([]);
  const [roleAssignments, setRoleAssignments] = useState([]);
  const [rolesLoading, setRolesLoading] = useState(true);
  const [mfaState, setMfaState] = useState({ loading: true, currentLevel: null, nextLevel: null, factors: [] });
  const [workspaceId, setWorkspaceId] = useState("");
  const [businessId, setBusinessId] = useState("all");
  const [data, setData] = useState(emptyData);
  const activeView = routeViews[pathname] || "dashboard";

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
      if (event === "SIGNED_OUT") {
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
    supabase
      .from("workspace_members")
      .select("workspace_id, role, workspace:workspaces!workspace_members_workspace_id_fkey(id, name)")
      .eq("user_id", session.user.id)
      .then(({ data: rows, error }) => {
        if (!active) return;
        if (error) {
          setMessage(`Werkruimtes konden niet worden geladen: ${error.message}`);
          return;
        }
        const available = rows || [];
        setMemberships(available);
        setWorkspaceId((current) => current || available[0]?.workspace_id || "");
      });
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
    marketing: canUseFeature("marketing:read") || canUseFeature("marketing:manage") || canUseFeature("social:read"),
    security: true,
  }), [canUseFeature]);
  const canViewRevenue = isOwner || canUseFeature("revenue:read") || canUseFeature("finance:read");
  const canViewDirectie = canViewRevenue;
  const dashboardLabel = isOwner ? "CEO Home" : canViewDirectie ? "Management Home" : "Mijn werk";
  const viewAllowed = featureVisibility[activeView] !== false;
  const mfaRequired = isOwner || canUseFeature("users:manage") || canUseFeature("integrations:manage");
  const verifiedMfaFactor = mfaState.factors.find((factor) => factor.status === "verified");
  const openTasks = data.tasks.filter((task) => task.status !== "done");
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

  if (loading) return <main className="center">Horeca OS ladenâ€¦</main>;
  if (recoveryPage && !passwordRecovery) return <LoginScreen signIn={signIn} requestPasswordReset={requestPasswordReset} message={message} initialResetMode lockResetMode />;
  if (!session) return <LoginScreen signIn={signIn} requestPasswordReset={requestPasswordReset} message={message} initialResetMode={passwordRecovery} />;
  if (passwordRecovery) return <PasswordRecoveryScreen onSave={saveRecoveredPassword} message={message} email={session?.user?.email} />;
  if (!mfaState.loading && mfaState.nextLevel === "aal2" && mfaState.currentLevel !== "aal2") {
    return <MfaChallenge factor={verifiedMfaFactor} onComplete={refreshMfa} />;
  }
  if (!workspaceId && memberships.length === 0) return <main className="center">Geen toegankelijke werkruimte gevonden.</main>;
  if (rolesLoading || mfaState.loading) return <main className="center">Beveiliging controleren…</main>;
  if (mfaRequired && !verifiedMfaFactor) {
    return <MfaEnrollment required onComplete={refreshMfa} />;
  }

  return (
    <div className="shell">
      <aside className="sidebar">
        <div className="brand">Horeca OS</div>
        <nav>
          {featureVisibility.dashboard && <NavLink href="/dashboard" active={activeView === "dashboard"}>{dashboardLabel}</NavLink>}
          {featureVisibility.foodcost && <NavLink href="/foodcost" active={activeView === "foodcost"}>Foodcost</NavLink>}
          {featureVisibility.products && <NavLink href="/producten" active={activeView === "products"}>Producten</NavLink>}
          {featureVisibility.recipes && <NavLink href="/recepten" active={activeView === "recipes"}>Recepturen</NavLink>}
          {featureVisibility.suppliers && <NavLink href="/leveranciers" active={activeView === "suppliers"}>Leveranciers</NavLink>}
          {featureVisibility.reviews && <NavLink href="/reviews" active={activeView === "reviews"}>Reviews</NavLink>}
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
            <button className="refresh" onClick={loadData} disabled={refreshing}>{refreshing ? "Verversenâ€¦" : "Data verversen"}</button>
          </div>
        </header>

        {message && <div className="notice">{message}</div>}

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
          <Card label="Gemiddelde bon deze maand" value={money(analytics.month.averageTicket)} sub={`${analytics.month.orders} orders`} />
          <Card label="Open taken" value={openTasks.length} sub={`${criticalTasks.length} kritiek`} tone={criticalTasks.length ? "danger" : "normal"} />
          <Card label="Security" value={securityWarnings ? `${securityWarnings} aandacht` : "Op orde"} sub={`${securityOk}/${data.security.length || 0} controles akkoord`} tone={securityWarnings ? "warning" : "success"} />
          <Card label="Integraties" value={`${connectedIntegrations}/${data.integrations.length || 0}`} sub="Verbonden databronnen" />
        </section>

        <section className="dashboardGrid">
          <Panel title="Topprioriteiten" subtitle="Wat vandaag bestuurlijke aandacht vraagt">{priorities.length === 0 && <Empty text="Geen openstaande prioriteiten." />}{priorities.map((task) => <div className={`task ${task.priority || "medium"}`} key={task.id}><div><b>{task.title}</b><span>{priorityLabel[task.priority] || task.priority} Â· {statusLabel[task.status] || task.status}</span></div><span className="pill">{task.assignee?.full_name || "Nog niet toegewezen"}</span></div>)}</Panel>
          <Panel title="Komende agenda" subtitle="Eerstvolgende afspraken en evenementen">{data.events.length === 0 && <Empty text="Geen komende afspraken gevonden." />}{data.events.map((event) => <div className="event" key={event.id}><div className="dateBadge"><strong>{new Date(event.starts_at).getDate()}</strong><span>{new Intl.DateTimeFormat("nl-NL", { month: "short" }).format(new Date(event.starts_at))}</span></div><div><b>{event.title}</b><span>{formatDate(event.starts_at)}</span></div></div>)}</Panel>
          <Panel title="Topverkopers" subtitle="Hoogste aantallen in de huidige maand">{analytics.topProducts.length === 0 && <Empty text="Nog geen productverkoop voor deze maand." />}{analytics.topProducts.map((product, index) => <div className="rankRow" key={product.name}><span className="rank">{index + 1}</span><b>{product.name}</b><strong>{product.quantity}</strong></div>)}</Panel>
          <Panel title="Systemen" subtitle="Status van de belangrijkste koppelingen">{data.integrations.length === 0 && <Empty text="Geen integraties gevonden." />}{data.integrations.map((integration) => <div className="systemRow" key={integration.id}><div><b>{integration.provider}</b><span>{integration.last_synced_at ? `Laatste sync ${formatDate(integration.last_synced_at)}` : "Nog niet gesynchroniseerd"}</span></div><span className={`status ${String(integration.status).toLowerCase()}`}>{integration.status}</span></div>)}</Panel>
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

        {activeView === "foodcost" && featureVisibility.foodcost && <FoodcostDashboard analytics={foodcost} />}
        {activeView === "products" && featureVisibility.products && <ProductOverview products={data.foodProducts} suppliers={data.suppliers} />}
        {activeView === "recipes" && featureVisibility.recipes && <RecipeOverview analytics={foodcost} />}
        {activeView === "suppliers" && featureVisibility.suppliers && <SupplierOverview suppliers={data.suppliers} products={data.foodProducts} />}
        {activeView === "reviews" && featureVisibility.reviews && <EmptyModule eyebrow="Social intelligence" title="Reviews" description="Review-inzichten worden hier samengebracht zodra de eerste reviewbron is gekoppeld." />}
        {activeView === "marketing" && featureVisibility.marketing && <EmptyModule eyebrow="CommerciÃ«le groei" title="Marketing" description="Campagnes en kanaalprestaties worden hier beschikbaar zodra de marketingkoppelingen actief zijn." />}
        {activeView === "assistant" && featureVisibility.assistant && <Assistant workspaceId={workspaceId} businessId={businessId} session={session} conversations={data.aiConversations} onRefresh={loadData} />}
        {activeView === "users" && featureVisibility.users && <UsersAdmin workspaceId={workspaceId} session={session} />}
        {activeView === "hours" && featureVisibility.hours && <HoursOverview workspaceId={workspaceId} businessId={businessId} businesses={visibleBusinesses} />}
        {activeView === "schedule" && featureVisibility.schedule && <ScheduleOverview workspaceId={workspaceId} businessId={businessId} businesses={visibleBusinesses} userId={session.user.id} canManage={isOwner || canUseFeature("schedule:manage")} />}
        {activeView === "integrations" && featureVisibility.integrations && <RobuustIntegrationSettings workspaceId={workspaceId} session={session} businesses={data.businesses} />}
        {activeView === "security" && <SecuritySettings required={mfaRequired} mfaState={mfaState} onRefresh={refreshMfa} />}
      </main>
    </div>
  );
}

function NavLink({ active, children, href }) { return <Link className={`nav ${active ? "active" : ""}`} href={href}>{children}</Link>; }

function EmptyModule({ eyebrow, title, description }) {
  return <><section className="pageIntro"><p className="eyebrow">{eyebrow}</p><h2>{title}</h2><p>{description}</p></section><section className="panel emptyModule"><strong>Klaar voor de eerste databron</strong><p>Dit onderdeel is onderdeel van de nieuwe applicatiestructuur. Er wordt geen voorbeelddata getoond.</p></section></>;
}

function AccessDenied() {
  return <section className="panel emptyModule"><strong>Geen toegang tot dit onderdeel</strong><p>Jouw rol bevat niet de benodigde rechten. Kies een beschikbaar onderdeel in het menu.</p><Link className="secondaryButton" href="/dashboard">Naar mijn werk</Link></section>;
}

function StaffDashboard({ priorities, events }) {
  return <>
    <section className="pageIntro"><p className="eyebrow">Mijn werk</p><h2>Werkzaamheden en planning</h2><p>Alleen informatie binnen jouw toegewezen vestiging en rol wordt getoond.</p></section>
    <section className="dashboardGrid">
      <Panel title="Mijn prioriteiten" subtitle="Openstaande operationele werkzaamheden">{priorities.length === 0 && <Empty text="Geen openstaande werkzaamheden." />}{priorities.map((task) => <div className={`task ${task.priority || "medium"}`} key={task.id}><div><b>{task.title}</b><span>{priorityLabel[task.priority] || task.priority} · {statusLabel[task.status] || task.status}</span></div></div>)}</Panel>
      <Panel title="Mijn planning" subtitle="Eerstvolgende afspraken binnen jouw vestiging">{events.length === 0 && <Empty text="Geen komende afspraken gevonden." />}{events.map((event) => <div className="event" key={event.id}><div className="dateBadge"><strong>{new Date(event.starts_at).getDate()}</strong><span>{new Intl.DateTimeFormat("nl-NL", { month: "short" }).format(new Date(event.starts_at))}</span></div><div><b>{event.title}</b><span>{formatDate(event.starts_at)}</span></div></div>)}</Panel>
    </section>
  </>;
}

function TimeClock({ workspaceId, businessId, businesses, userId }) {
  const [selectedBusinessId, setSelectedBusinessId] = useState(businessId === "all" ? (businesses[0]?.id || "") : businessId);
  const [entries, setEntries] = useState([]);
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState("");

  const loadEntries = useCallback(async () => {
    if (!workspaceId || !userId) return;
    const { data: rows, error } = await supabase.from("time_entries")
      .select("id, business_id, clocked_in_at, clocked_out_at")
      .eq("workspace_id", workspaceId).eq("user_id", userId)
      .order("clocked_in_at", { ascending: false }).limit(7);
    if (error) setFeedback(`Uren konden niet worden geladen: ${error.message}`);
    else setEntries(rows || []);
  }, [userId, workspaceId]);

  useEffect(() => { loadEntries(); }, [loadEntries]);
  useEffect(() => {
    setSelectedBusinessId(businessId === "all" ? (businesses[0]?.id || "") : businessId);
  }, [businessId, businesses]);

  const openEntry = entries.find((entry) => !entry.clocked_out_at);
  async function toggleClock() {
    setBusy(true);
    setFeedback("");
    const result = openEntry
      ? await supabase.from("time_entries").update({ clocked_out_at: new Date().toISOString() }).eq("id", openEntry.id).is("clocked_out_at", null)
      : await supabase.from("time_entries").insert({ workspace_id: workspaceId, business_id: selectedBusinessId, user_id: userId });
    if (result.error) setFeedback(`Registratie niet gelukt: ${result.error.message}`);
    else {
      setFeedback(openEntry ? "Je bent uitgeklokt." : "Je bent ingeklokt.");
      await loadEntries();
    }
    setBusy(false);
  }

  return <section className="panel timeClock">
    <div><p className="eyebrow">Urenregistratie</p><h2>{openEntry ? "Je bent ingeklokt" : "Klaar om te starten"}</h2><p>{openEntry ? `Sinds ${formatTime(openEntry.clocked_in_at)}` : "Kies je vestiging en klok in bij aanvang van je dienst."}</p></div>
    <div className="clockActions">
      {!openEntry && <label>Vestiging<select value={selectedBusinessId} onChange={(event) => setSelectedBusinessId(event.target.value)}>{businesses.map((business) => <option key={business.id} value={business.id}>{business.name}</option>)}</select></label>}
      <button className={openEntry ? "secondaryButton" : "primary"} onClick={toggleClock} disabled={busy || (!openEntry && !selectedBusinessId)}>{busy ? "Bezig…" : openEntry ? "Uitklokken" : "Inklokken"}</button>
    </div>
    {feedback && <p className="clockFeedback">{feedback}</p>}
    {entries.length > 0 && <div className="clockHistory"><strong>Recente diensten</strong>{entries.slice(0, 4).map((entry) => <span key={entry.id}>{formatDate(entry.clocked_in_at)} · {formatTime(entry.clocked_in_at)} – {entry.clocked_out_at ? formatTime(entry.clocked_out_at) : "actief"}</span>)}</div>}
  </section>;
}

function HoursOverview({ workspaceId, businessId, businesses }) {
  const [days, setDays] = useState(30);
  const [entries, setEntries] = useState([]);
  const [loadingHours, setLoadingHours] = useState(true);
  const [hoursError, setHoursError] = useState("");
  const [hoursFeedback, setHoursFeedback] = useState("");

  const loadHours = useCallback(async () => {
    setLoadingHours(true);
    setHoursError("");
    const from = new Date();
    from.setHours(0, 0, 0, 0);
    from.setDate(from.getDate() - (days - 1));
    let query = supabase.from("time_entries")
      .select("id, user_id, business_id, clocked_in_at, clocked_out_at, break_minutes, corrected_at, correction_reason, business:businesses!time_entries_business_id_workspace_id_fkey(name), member:workspace_members!time_entries_workspace_id_user_id_fkey(profile:profiles!workspace_members_user_id_fkey(full_name))")
      .eq("workspace_id", workspaceId)
      .gte("clocked_in_at", from.toISOString())
      .order("clocked_in_at", { ascending: false });
    if (businessId !== "all") query = query.eq("business_id", businessId);
    const { data: rows, error } = await query;
    if (error) setHoursError(`Urenoverzicht kon niet worden geladen: ${error.message}`);
    else setEntries(rows || []);
    setLoadingHours(false);
  }, [businessId, days, workspaceId]);

  useEffect(() => { loadHours(); }, [loadHours]);

  const now = Date.now();
  const minutesFor = (entry) => Math.max(0, Math.round(((entry.clocked_out_at ? new Date(entry.clocked_out_at).getTime() : now) - new Date(entry.clocked_in_at).getTime()) / 60000) - number(entry.break_minutes));
  const totalMinutes = entries.reduce((total, entry) => total + minutesFor(entry), 0);
  const openEntries = entries.filter((entry) => !entry.clocked_out_at);
  const people = [...entries.reduce((map, entry) => {
    const current = map.get(entry.user_id) || { id: entry.user_id, name: timeEntryEmployeeName(entry), minutes: 0, shifts: 0, open: false };
    current.minutes += minutesFor(entry);
    current.shifts += 1;
    current.open ||= !entry.clocked_out_at;
    map.set(entry.user_id, current);
    return map;
  }, new Map()).values()].sort((a, b) => b.minutes - a.minutes);

  async function correctEntry(event, entryId) {
    event.preventDefault(); setHoursFeedback(""); const form = new FormData(event.currentTarget);
    const payload = { clocked_in_at: localInputToIso(form.get("clockedIn")), clocked_out_at: localInputToIso(form.get("clockedOut")), break_minutes: Math.max(0, Number(form.get("breakMinutes") || 0)), correction_reason: String(form.get("reason") || "").trim() };
    const { error } = await supabase.from("time_entries").update(payload).eq("id", entryId);
    setHoursFeedback(error ? `Correctie niet opgeslagen: ${error.message}` : "Correctie opgeslagen en gemarkeerd als hersteld.");
    if (!error) loadHours();
  }

  return <>
    <section className="pageIntro hoursIntro"><div><p className="eyebrow">Personeelsplanning</p><h2>Urenoverzicht</h2><p>Gewerkte uren per medewerker binnen de gekozen vestiging.</p></div><label>Periode<select value={days} onChange={(event) => setDays(Number(event.target.value))}><option value="7">Laatste 7 dagen</option><option value="30">Laatste 30 dagen</option><option value="90">Laatste 90 dagen</option></select></label></section>
    {hoursError && <div className="notice">{hoursError}</div>}{hoursFeedback && <div className="notice">{hoursFeedback}</div>}
    <section className="kpis secondary">
      <Card label="Totaal geregistreerd" value={formatDuration(totalMinutes)} sub={`${entries.length} diensten`} />
      <Card label="Nu ingeklokt" value={openEntries.length} sub="Openstaande diensten" tone={openEntries.length ? "success" : "normal"} />
      <Card label="Medewerkers" value={people.length} sub={`Met uren in de laatste ${days} dagen`} />
      <Card label="Gemiddeld per dienst" value={formatDuration(entries.length ? Math.round(totalMinutes / entries.length) : 0)} sub="Inclusief actieve diensten" />
    </section>
    <section className="dashboardGrid hoursGrid">
      <Panel title="Per medewerker" subtitle="Totaal binnen de gekozen periode">{loadingHours && <Empty text="Uren laden…" />}{!loadingHours && people.length === 0 && <Empty text="Nog geen uren geregistreerd." />}{people.map((person) => <div className="hoursPerson" key={person.id}><div><b>{person.name}</b><span>{person.shifts} dienst{person.shifts === 1 ? "" : "en"}{person.open ? " · nu ingeklokt" : ""}</span></div><strong>{formatDuration(person.minutes)}</strong></div>)}</Panel>
      <Panel title="Recente registraties" subtitle="Laatste in- en uitklokmomenten">{loadingHours && <Empty text="Registraties laden…" />}{!loadingHours && entries.length === 0 && <Empty text="Nog geen registraties gevonden." />}{entries.slice(0, 15).map((entry) => <TimeEntryEditor entry={entry} businesses={businesses} minutes={minutesFor(entry)} onCorrect={correctEntry} key={entry.id} />)}</Panel>
    </section>
  </>;
}

function ScheduleOverview({ workspaceId, businessId, businesses, userId, canManage }) {
  const [weekOffset, setWeekOffset] = useState(0);
  const [shifts, setShifts] = useState([]);
  const [availability, setAvailability] = useState([]);
  const [employees, setEmployees] = useState([]);
  const [scheduleMessage, setScheduleMessage] = useState("");
  const weekStart = useMemo(() => { const date = startOfDay(new Date()); const day = (date.getDay() + 6) % 7; date.setDate(date.getDate() - day + weekOffset * 7); return date; }, [weekOffset]);
  const weekDays = useMemo(() => Array.from({ length: 7 }, (_, index) => addDays(weekStart, index)), [weekStart]);

  const loadSchedule = useCallback(async () => {
    const until = addDays(weekStart, 7);
    let shiftsQuery = supabase.from("schedule_shifts").select("id,user_id,business_id,starts_at,ends_at,role_label,note,status,member:workspace_members!schedule_shifts_workspace_id_user_id_fkey(profile:profiles!workspace_members_user_id_fkey(full_name)),business:businesses!schedule_shifts_business_id_workspace_id_fkey(name)").eq("workspace_id", workspaceId).gte("starts_at", weekStart.toISOString()).lt("starts_at", until.toISOString()).order("starts_at");
    if (businessId !== "all") shiftsQuery = shiftsQuery.eq("business_id", businessId);
    const [shiftResult, availabilityResult, memberResult] = await Promise.all([
      shiftsQuery,
      supabase.from("employee_availability").select("id,user_id,available_date,available_from,available_until,status,note").eq("workspace_id", workspaceId).gte("available_date", isoDate(weekStart)).lt("available_date", isoDate(until)),
      supabase.from("workspace_members").select("user_id,profile:profiles!workspace_members_user_id_fkey(full_name)").eq("workspace_id", workspaceId),
    ]);
    if (shiftResult.error || availabilityResult.error) setScheduleMessage(`Rooster kon niet volledig worden geladen: ${shiftResult.error?.message || availabilityResult.error?.message}`);
    else { setShifts(shiftResult.data || []); setAvailability(availabilityResult.data || []); }
    if (!memberResult.error) setEmployees((memberResult.data || []).map((member) => ({ id: member.user_id, name: memberProfileName(member) })));
  }, [businessId, weekStart, workspaceId]);

  useEffect(() => { loadSchedule(); }, [loadSchedule]);

  async function addShift(event) {
    event.preventDefault(); const form = new FormData(event.currentTarget); setScheduleMessage("");
    const date = String(form.get("date"));
    const { error } = await supabase.from("schedule_shifts").insert({ workspace_id: workspaceId, business_id: String(form.get("businessId")), user_id: String(form.get("userId")), starts_at: new Date(`${date}T${form.get("start")}`).toISOString(), ends_at: new Date(`${date}T${form.get("end")}`).toISOString(), role_label: String(form.get("roleLabel") || "").trim() || null, note: String(form.get("note") || "").trim() || null, created_by: userId });
    setScheduleMessage(error ? `Dienst niet opgeslagen: ${error.message}` : "Dienst is aan het rooster toegevoegd."); if (!error) { event.currentTarget.reset(); loadSchedule(); }
  }

  async function saveAvailability(event) {
    event.preventDefault(); const form = new FormData(event.currentTarget); setScheduleMessage("");
    const { error } = await supabase.from("employee_availability").upsert({ workspace_id: workspaceId, user_id: userId, available_date: String(form.get("date")), available_from: form.get("from") || null, available_until: form.get("until") || null, status: String(form.get("status")), note: String(form.get("note") || "").trim() || null }, { onConflict: "workspace_id,user_id,available_date" });
    setScheduleMessage(error ? `Beschikbaarheid niet opgeslagen: ${error.message}` : "Je beschikbaarheid is opgeslagen."); if (!error) loadSchedule();
  }

  return <>
    <section className="pageIntro scheduleIntro"><div><p className="eyebrow">Personeelsplanning</p><h2>Rooster & beschikbaarheid</h2><p>Diensten plannen per vestiging en beschikbaarheid vooraf verzamelen.</p></div><div className="weekControls"><button className="secondaryButton" onClick={() => setWeekOffset((value) => value - 1)}>Vorige</button><b>{formatShortDate(weekStart)} – {formatShortDate(addDays(weekStart, 6))}</b><button className="secondaryButton" onClick={() => setWeekOffset((value) => value + 1)}>Volgende</button></div></section>
    {scheduleMessage && <div className="notice">{scheduleMessage}</div>}
    <section className="scheduleWeek">{weekDays.map((day) => { const dayShifts = shifts.filter((shift) => isoDate(new Date(shift.starts_at)) === isoDate(day)); const dayAvailability = availability.filter((item) => item.available_date === isoDate(day)); return <article className="scheduleDay" key={isoDate(day)}><header><b>{new Intl.DateTimeFormat("nl-NL", { weekday: "short" }).format(day)}</b><span>{day.getDate()}</span></header>{dayShifts.map((shift) => <div className="shiftCard" key={shift.id}><strong>{formatTime(shift.starts_at)}–{formatTime(shift.ends_at)}</strong><b>{timeEntryEmployeeName(shift)}</b><small>{shift.role_label || shift.business?.name || "Dienst"}</small></div>)}{dayShifts.length === 0 && <small className="noShift">Geen diensten</small>}<footer>{dayAvailability.filter((item) => item.status !== "unavailable").length} beschikbaar</footer></article>; })}</section>
    <section className="dashboardGrid scheduleForms">
      {canManage && <Panel title="Dienst inplannen" subtitle="Voeg een medewerker toe aan het weekrooster"><form className="scheduleForm" onSubmit={addShift}><label>Medewerker<select name="userId" required defaultValue=""><option value="" disabled>Kies medewerker</option>{employees.map((employee) => <option value={employee.id} key={employee.id}>{employee.name}</option>)}</select></label><label>Vestiging<select name="businessId" required defaultValue={businessId === "all" ? businesses[0]?.id : businessId}>{businesses.map((business) => <option value={business.id} key={business.id}>{business.name}</option>)}</select></label><label>Datum<input type="date" name="date" required defaultValue={isoDate(weekStart)} /></label><label>Start<input type="time" name="start" required /></label><label>Einde<input type="time" name="end" required /></label><label>Functie<input name="roleLabel" placeholder="Bijv. bediening" /></label><label className="full">Notitie<input name="note" /></label><button className="primary">Dienst toevoegen</button></form></Panel>}
      <Panel title="Mijn beschikbaarheid" subtitle="Geef aan wanneer je kunt werken"><form className="scheduleForm" onSubmit={saveAvailability}><label>Datum<input type="date" name="date" required defaultValue={isoDate(weekStart)} /></label><label>Status<select name="status" defaultValue="available"><option value="available">Beschikbaar</option><option value="preferred">Voorkeur</option><option value="unavailable">Niet beschikbaar</option></select></label><label>Vanaf<input type="time" name="from" /></label><label>Tot<input type="time" name="until" /></label><label className="full">Toelichting<input name="note" placeholder="Optioneel" /></label><button className="primary">Beschikbaarheid opslaan</button></form></Panel>
    </section>
  </>;
}

function FoodcostDashboard({ analytics }) {
  return <>
    <section className="pageIntro"><p className="eyebrow">Foodcost dashboard</p><h2>Marge en prijsbewaking</h2><p>Actuele berekening uit inkoopprijzen, recepturen en verkoopprijzen.</p></section>
    <section className="kpis">
      <Card label="Gemiddelde foodcost" value={analytics.average == null ? "â€”" : `${analytics.average.toFixed(1)}%`} sub={`${analytics.items.length} verkoopbare gerechten`} />
      <Card label="Beste marge" value={analytics.best?.name || "â€”"} sub={analytics.best ? `${analytics.best.foodcost.toFixed(1)}% foodcost` : "Nog geen complete kostprijs"} tone="success" />
      <Card label="Hoogste foodcost" value={analytics.worst?.name || "â€”"} sub={analytics.worst ? `${analytics.worst.foodcost.toFixed(1)}% foodcost` : "Nog geen complete kostprijs"} tone={analytics.worst?.foodcost > 40 ? "danger" : "normal"} />
      <Card label="Prijswaarschuwingen" value={analytics.warnings.length} sub="Gerechten boven doel of 40%" tone={analytics.warnings.length ? "warning" : "success"} />
    </section>
    <section className="panel"><div className="panelHead"><h2>Gerechten</h2><p>Foodcost is exclusief btw-effecten en volgt de actuele productprijs.</p></div>
      <div className="tableWrap"><table><thead><tr><th>Gerecht</th><th>Kostprijs</th><th>Verkoopprijs</th><th>Foodcost</th><th>Doel</th><th>Status</th></tr></thead><tbody>
        {analytics.items.map((item) => <tr key={item.id}><td><b>{item.name}</b></td><td>{money(item.cost)}</td><td>{money(item.sellingPrice)}</td><td>{item.foodcost.toFixed(1)}%</td><td>{item.target ? `${item.target}%` : "â€”"}</td><td><span className={`status ${item.warning ? "pending" : "connected"}`}>{item.warning ? "Controleren" : "Op koers"}</span></td></tr>)}
      </tbody></table></div>{!analytics.items.length && <Empty text="Voeg producten, ingrediÃ«nten, receptregels en menu-items toe om foodcost te berekenen." />}
    </section>
  </>;
}

function ProductOverview({ products, suppliers }) {
  const supplierMap = new Map(suppliers.map((item) => [item.id, item.name]));
  return <DataPage title="Producten" subtitle="Inkoopprijzen en verpakkingsinhoud per gekozen scope"><div className="cardGrid">{products.map((product) => <article className="entityCard" key={product.id}><span>{product.category || "Ongecategoriseerd"}</span><h3>{product.name}</h3><strong>{money(product.purchase_price)}</strong><small>{product.content_quantity || "â€”"} {product.content_unit || ""} Â· {supplierMap.get(product.supplier_id) || "Geen leverancier"}</small></article>)}</div>{!products.length && <Empty text="Geen foodcostproducten gevonden." />}</DataPage>;
}

function RecipeOverview({ analytics }) {
  return <DataPage title="Recepturen" subtitle="Kostprijsopbouw gekoppeld aan actieve menu-items"><div className="cardGrid">{analytics.items.map((recipe) => <article className="entityCard" key={recipe.id}><span>{recipe.category || "Menu"}</span><h3>{recipe.name}</h3><strong>{money(recipe.cost)}</strong><small>{recipe.lines} receptregel(s) Â· {recipe.foodcost.toFixed(1)}% foodcost</small></article>)}</div>{!analytics.items.length && <Empty text="Nog geen complete recepturen gevonden." />}</DataPage>;
}

function SupplierOverview({ suppliers, products }) {
  return <DataPage title="Leveranciers" subtitle="Leveranciers en gekoppelde inkoopproducten"><div className="cardGrid">{suppliers.map((supplier) => <article className="entityCard" key={supplier.id}><span>{supplier.active ? "Actief" : "Inactief"}</span><h3>{supplier.name}</h3><strong>{products.filter((product) => product.supplier_id === supplier.id).length}</strong><small>gekoppelde producten</small></article>)}</div>{!suppliers.length && <Empty text="Geen leveranciers gevonden." />}</DataPage>;
}

function DataPage({ title, subtitle, children }) { return <><section className="pageIntro"><p className="eyebrow">Foodcost beheer</p><h2>{title}</h2><p>{subtitle}</p></section><section className="panel">{children}</section></>; }

function Assistant({ workspaceId, businessId, session, conversations, onRefresh }) {
  const [useCase, setUseCase] = useState("ceo");
  const [conversationId, setConversationId] = useState("");
  const [chat, setChat] = useState([]);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");

  async function openConversation(id) {
    setConversationId(id); setError("");
    const { data: rows, error: loadError } = await supabase.from("ai_messages").select("id, role, content, created_at").eq("conversation_id", id).order("created_at");
    if (loadError) setError(loadError.message); else setChat(rows || []);
  }

  async function sendMessage(formData) {
    const text = String(formData.get("message") || "").trim();
    if (!text || sending) return;
    setSending(true); setError("");
    setChat((current) => [...current, { id: `local-${Date.now()}`, role: "user", content: text }]);
    const response = await fetch("/api/ai/chat", { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${session.access_token}` }, body: JSON.stringify({ workspaceId, businessId: businessId === "all" ? null : businessId, conversationId: conversationId || null, useCase, message: text }) });
    const result = await response.json();
    if (!response.ok) setError(result.error || "AI-assistent is niet beschikbaar.");
    else { setConversationId(result.conversationId); setChat((current) => [...current, { id: `answer-${Date.now()}`, role: "assistant", content: result.answer }]); await onRefresh(); }
    setSending(false);
  }

  return <><section className="pageIntro"><p className="eyebrow">Horeca OS AI</p><h2>Veilige AI-assistent</h2><p>Vragen over directie, foodcost, reviews, marketing en operatie binnen de gekozen scope.</p></section>
    <section className="assistantLayout"><aside className="panel chatHistory"><button className="primary" onClick={() => { setConversationId(""); setChat([]); }}>Nieuw gesprek</button><h3>Geschiedenis</h3>{conversations.map((item) => <button className={conversationId === item.id ? "history active" : "history"} key={item.id} onClick={() => openConversation(item.id)}><b>{item.title}</b><small>{item.use_case}</small></button>)}</aside>
      <article className="panel chatPanel"><div className="useCases">{[["ceo","CEO"],["foodcost","Foodcost"],["reviews","Reviews"],["marketing","Marketing"],["operations","Operatie"]].map(([key,label]) => <button key={key} className={useCase === key ? "chip active" : "chip"} onClick={() => setUseCase(key)} disabled={Boolean(conversationId)}>{label}</button>)}</div>
        <div className="messages">{!chat.length && <Empty text="Stel een vraag. De assistent gebruikt alleen gegevens die jij binnen deze werkruimte mag zien." />}{chat.map((item) => <div className={`messageBubble ${item.role}`} key={item.id}>{item.content}</div>)}</div>
        {error && <div className="notice">{error}</div>}<form action={sendMessage} className="chatComposer"><textarea name="message" maxLength="4000" required placeholder="Bijvoorbeeld: welke gerechten vragen vandaag marge-aandacht?" /><button className="primary" disabled={sending}>{sending ? "Analyserenâ€¦" : "Versturen"}</button></form>
      </article></section></>;
}

function MfaChallenge({ factor, onComplete }) {
  const [code, setCode] = useState("");
  const [error, setError] = useState("");
  const [verifying, setVerifying] = useState(false);

  async function verifyMfa(event) {
    event.preventDefault();
    if (!factor) { setError("Geen geverifieerde authenticator gevonden."); return; }
    setVerifying(true); setError("");
    const { error: verifyError } = await supabase.auth.mfa.challengeAndVerify({ factorId: factor.id, code: code.trim() });
    if (verifyError) { setError("De code is ongeldig of verlopen."); setVerifying(false); return; }
    await onComplete();
    setVerifying(false);
  }

  return <main className="authPage"><section className="authCard mfaCard">
    <div className="brand dark">Horeca OS</div>
    <p className="eyebrow">Tweestapsverificatie</p><h1>Voer je beveiligingscode in</h1>
    <p>Open je authenticator-app en vul de actuele zescijferige code in.</p>
    {error && <div className="notice">{error}</div>}
    <form onSubmit={verifyMfa} className="stack">
      <label>Beveiligingscode<input value={code} onChange={(event) => setCode(event.target.value.replace(/\D/g, "").slice(0, 6))} inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6}" minLength="6" maxLength="6" required /></label>
      <button className="primary" disabled={verifying}>{verifying ? "Controleren…" : "Veilig inloggen"}</button>
    </form>
    <button className="textButton" onClick={() => supabase.auth.signOut()}>Terug naar inloggen</button>
  </section></main>;
}

function MfaEnrollment({ required = false, onComplete, onCancel }) {
  const [enrollment, setEnrollment] = useState(null);
  const [code, setCode] = useState("");
  const [error, setError] = useState("");
  const [verifying, setVerifying] = useState(false);

  useEffect(() => {
    let active = true;
    supabase.auth.mfa.enroll({ factorType: "totp", friendlyName: "Horeca OS authenticator" }).then(({ data, error: enrollError }) => {
      if (!active) return;
      if (enrollError) setError(enrollError.message);
      else setEnrollment({ id: data.id, qr: data.totp.qr_code, secret: data.totp.secret });
    });
    return () => { active = false; };
  }, []);

  async function confirmEnrollment(event) {
    event.preventDefault();
    if (!enrollment) return;
    setVerifying(true); setError("");
    const { error: verifyError } = await supabase.auth.mfa.challengeAndVerify({ factorId: enrollment.id, code: code.trim() });
    if (verifyError) { setError("De code is ongeldig. Controleer de authenticator-app en probeer opnieuw."); setVerifying(false); return; }
    await onComplete();
    setVerifying(false);
  }

  async function cancelEnrollment() {
    if (enrollment?.id) await supabase.auth.mfa.unenroll({ factorId: enrollment.id });
    onCancel?.();
  }

  return <main className={required ? "authPage" : ""}><section className={required ? "authCard mfaCard" : "panel mfaSetupPanel"}>
    <p className="eyebrow">Accountbeveiliging</p><h1>{required ? "Stel tweestapsverificatie in" : "Authenticator koppelen"}</h1>
    <p>{required ? "Voor Eigenaren en Managers is een tweede beveiligingsstap verplicht." : "Scan de QR-code met Google Authenticator, Microsoft Authenticator of 1Password."}</p>
    {error && <div className="notice">{error}</div>}
    {!enrollment && !error && <p>Beveiligde QR-code voorbereiden…</p>}
    {enrollment && <form onSubmit={confirmEnrollment} className="stack">
      <div className="mfaQr"><img src={enrollment.qr} alt="QR-code voor de authenticator-app" /></div>
      <details><summary>QR-code werkt niet?</summary><p>Voer deze sleutel handmatig in:</p><code className="mfaSecret">{enrollment.secret}</code></details>
      <label>Code uit authenticator<input value={code} onChange={(event) => setCode(event.target.value.replace(/\D/g, "").slice(0, 6))} inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6}" minLength="6" maxLength="6" required /></label>
      <button className="primary" disabled={verifying}>{verifying ? "Activeren…" : "2FA activeren"}</button>
    </form>}
    {!required && <button className="textButton" onClick={cancelEnrollment}>Annuleren</button>}
    {required && <button className="textButton" onClick={() => supabase.auth.signOut()}>Uitloggen</button>}
  </section></main>;
}

function SecuritySettings({ required, mfaState, onRefresh }) {
  const [settingUp, setSettingUp] = useState(false);
  const [message, setMessage] = useState("");
  const verified = mfaState.factors.filter((factor) => factor.status === "verified");

  async function removeFactor(factorId) {
    setMessage("");
    const { error } = await supabase.auth.mfa.unenroll({ factorId });
    if (error) { setMessage("De authenticator kon niet worden verwijderd."); return; }
    await supabase.auth.refreshSession();
    await onRefresh();
    setMessage("Tweestapsverificatie is uitgeschakeld.");
  }

  if (settingUp) return <MfaEnrollment onComplete={async () => { await onRefresh(); setSettingUp(false); setMessage("Tweestapsverificatie is actief."); }} onCancel={() => setSettingUp(false)} />;

  return <>
    <section className="pageIntro"><p className="eyebrow">Accountbeveiliging</p><h2>Tweestapsverificatie</h2><p>Bescherm je account met een code uit een authenticator-app.</p></section>
    {message && <div className="notice successNotice">{message}</div>}
    <section className="panel securityPanel">
      <div className="securityStatus"><div><strong>{verified.length ? "2FA is actief" : "2FA is niet ingesteld"}</strong><p>{required ? "Verplicht voor jouw rol." : "Optioneel voor jouw rol, maar sterk aanbevolen."}</p></div><span className={verified.length ? "status connected" : "status pending"}>{verified.length ? "Beveiligd" : "Niet actief"}</span></div>
      {!verified.length && <button className="primary" onClick={() => setSettingUp(true)}>Authenticator koppelen</button>}
      {verified.map((factor) => <div className="factorRow" key={factor.id}><div><strong>{factor.friendly_name || "Authenticator-app"}</strong><small>Geverifieerde TOTP-factor</small></div>{!required && <button className="secondaryButton" onClick={() => removeFactor(factor.id)}>Verwijderen</button>}</div>)}
      {required && verified.length > 0 && <p className="securityHint">Omdat jouw rol verhoogde rechten heeft, kan 2FA niet vanuit de app worden uitgeschakeld.</p>}
    </section>
  </>;
}

function RobuustIntegrationSettings({ workspaceId, session, businesses }) {
  const [accounts, setAccounts] = useState([]);
  const [integrationMessage, setIntegrationMessage] = useState("");
  const [integrationError, setIntegrationError] = useState("");
  const [connecting, setConnecting] = useState(false);

  const loadAccounts = useCallback(async () => {
    const response = await fetch(`/api/integrations/robuust?workspaceId=${encodeURIComponent(workspaceId)}`, { headers: { Authorization: `Bearer ${session.access_token}` } });
    const result = await response.json();
    if (response.ok) setAccounts(result.accounts || []);
    else setIntegrationError(result.error || "Koppelingen konden niet worden geladen.");
  }, [session.access_token, workspaceId]);

  useEffect(() => { loadAccounts(); }, [loadAccounts]);

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

  const statusLabel = { connected: "Verbonden", pending: "Controleren", degraded: "Aandacht nodig", not_configured: "Niet ingesteld", revoked: "Ingetrokken" };
  return <>
    <section className="pageIntro"><p className="eyebrow">Databronnen</p><h2>Koppelingen</h2><p>Verbind externe systemen via gecontroleerde, traceerbare gegevensstromen.</p></section>
    {integrationMessage && <div className="notice successNotice">{integrationMessage}</div>}
    {integrationError && <div className="notice">{integrationError}</div>}
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
  const fixedPermissions = new Set(role?.role_permissions?.map((item) => item.permission) || []);
  const customOptions = PERMISSION_OPTIONS.filter(([, , customAllowed = true]) => customAllowed);
  return <>
    <label>Horeca OS-rol *<select name="roleId" required value={roleId} onChange={(event) => setRoleId(event.target.value)}><option value="" disabled>Kies een rol</option>{roles.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
    <label>{compact ? "Toegang" : "Vestigingstoegang"}<select name="businessId" defaultValue={initialBusinessId || ""}><option value="">Alle vestigingen</option>{businesses.map((business) => <option key={business.id} value={business.id}>{business.name}</option>)}</select></label>
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
function ChannelCard({ label, revenue, orders, share: channelShare }) { return <article className="channelCard"><div><span>{label}</span><strong>{money(revenue)}</strong></div><div className="channelMeta"><small>{number(orders)} orders</small><small>{channelShare.toFixed(1)}% van omzet</small></div></article>; }
function Panel({ title, subtitle, children }) { return <article className="panel"><div className="panelHead"><div><h2>{title}</h2><p>{subtitle}</p></div></div>{children}</article>; }
function Empty({ text }) { return <p className="empty">{text}</p>; }
function buildAdvice({ criticalTasks, sales, events, securityWarnings }) { if (criticalTasks.length) return `Pak eerst ${criticalTasks.length} kritieke taak${criticalTasks.length === 1 ? "" : "en"} op.`; if (securityWarnings) return `${securityWarnings} beveiligingscontrole${securityWarnings === 1 ? " vraagt" : "s vragen"} aandacht.`; if (!sales.revenue) return "Er is vandaag nog geen omzet geregistreerd."; if (!events.length) return "De komende agenda is leeg; controleer evenementen en commerciÃ«le planning."; return "De basis is stabiel. Volg omzet en operationele prioriteiten per vestiging."; }
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


