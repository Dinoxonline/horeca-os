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

  if (loading) return <main className="center">Horeca OS ladenÃƒÂ¢Ã¢â€šÂ¬Ã‚Â¦</main>;
  if (recoveryPage && !passwordRecovery) return <LoginScreen signIn={signIn} requestPasswordReset={requestPasswordReset} message={message} initialResetMode lockResetMode />;
  if (!session) return <LoginScreen signIn={signIn} requestPasswordReset={requestPasswordReset} message={message} initialResetMode={passwordRecovery} />;
  if (passwordRecovery) return <PasswordRecoveryScreen onSave={saveRecoveredPassword} message={message} email={session?.user?.email} />;
  if (!mfaState.loading && mfaState.nextLevel === "aal2" && mfaState.currentLevel !== "aal2") {
    return <MfaChallenge factor={verifiedMfaFactor} onComplete={refreshMfa} />;
  }
  if (!workspaceId && memberships.length === 0) return <main className="center">Geen toegankelijke werkruimte gevonden.</main>;
  if (rolesLoading || mfaState.loading) return <main className="center">Beveiliging controlerenÃ¢â‚¬Â¦</main>;
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
            <button className="refresh" onClick={loadData} disabled={refreshing}>{refreshing ? "VerversenÃƒÂ¢Ã¢â€šÂ¬Ã‚Â¦" : "Data verversen"}</button>
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
          <Panel title="Topprioriteiten" subtitle="Wat vandaag bestuurlijke aandacht vraagt">{priorities.length === 0 && <Empty text="Geen openstaande prioriteiten." />}{priorities.map((task) => <div className={`task ${task.priority || "medium"}`} key={task.id}><div><b>{task.title}</b><span>{priorityLabel[task.priority] || task.priority} Ãƒâ€šÃ‚Â· {statusLabel[task.status] || task.status}</span></div><span className="pill">{task.assignee?.full_name || "Nog niet toegewezen"}</span></div>)}</Panel>
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
        {activeView === "reviews" && featureVisibility.reviews && <ReviewsInbox workspaceId={workspaceId} businessId={businessId} businesses={visibleBusinesses} session={session} canManage={isOwner || canUseFeature("reviews:manage") || canUseFeature("reviews:respond")} canAdd={isOwner || canUseFeature("reviews:manage")} />}
        {activeView === "social" && featureVisibility.social && <SocialInbox workspaceId={workspaceId} businessId={businessId} businesses={visibleBusinesses} session={session} canManage={isOwner || canUseFeature("social:manage")} />}
        {activeView === "mail" && featureVisibility.mail && <MailAgenda workspaceId={workspaceId} session={session} />}
        {activeView === "calendar" && featureVisibility.calendar && <CalendarOverview workspaceId={workspaceId} session={session} />}
        {activeView === "marketing" && featureVisibility.marketing && <><MarketingCampaignBuilder workspaceId={workspaceId} businessId={businessId} businesses={visibleBusinesses} session={session} /><PredisContentGenerator mode="generate" workspaceId={workspaceId} businessId={businessId} businesses={visibleBusinesses} session={session} /></>}
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

function MarketingCampaignBuilder({ workspaceId, businessId, businesses, session }) {
  const initialBusinessId = businessId !== "all" ? businessId : businesses[0]?.id || "";
  const [selectedBusinessId, setSelectedBusinessId] = useState(initialBusinessId);
  const [brevoLists, setBrevoLists] = useState([]);
  const [brevoSenderEmail, setBrevoSenderEmail] = useState("");
  const [selectedListIds, setSelectedListIds] = useState([]);
  const [drafts, setDrafts] = useState([]);
  const [selectedDraftId, setSelectedDraftId] = useState("");
  const [campaignForm, setCampaignForm] = useState({ campaignName: "", senderName: "", subject: "", content: "" });
  const [loadingBrevo, setLoadingBrevo] = useState(false);
  const [savingDraft, setSavingDraft] = useState(false);
  const [requestingApproval, setRequestingApproval] = useState(false);
  const [sendingCampaign, setSendingCampaign] = useState(false);
  const [sendConfirmation, setSendConfirmation] = useState({ text: "", confirmed: false });
  const [approvalConfirmation, setApprovalConfirmation] = useState({ name: "", confirmed: false });
  const [brevoError, setBrevoError] = useState("");
  const [saveMessage, setSaveMessage] = useState("");
  const [preview, setPreview] = useState(null);

  useEffect(() => {
    const nextBusinessId = businessId !== "all" ? businessId : businesses[0]?.id || "";
    setSelectedBusinessId(nextBusinessId);
  }, [businessId, businesses]);

  useEffect(() => {
    if (!selectedBusinessId) return;
    let active = true;
    setLoadingBrevo(true);
    setBrevoError("");
    setSaveMessage("");
    setBrevoLists([]);
    setBrevoSenderEmail("");
    setDrafts([]);
    setSelectedListIds([]);
    const headers = { Authorization: `Bearer ${session.access_token}` };
    const baseQuery = `workspaceId=${encodeURIComponent(workspaceId)}&businessId=${encodeURIComponent(selectedBusinessId)}`;
    Promise.all([
      fetch(`/api/integrations/brevo?${baseQuery}&resource=lists`, { headers }).then(async (response) => ({ ok: response.ok, result: await response.json() })),
      fetch(`/api/integrations/brevo?${baseQuery}&resource=drafts`, { headers }).then(async (response) => ({ ok: response.ok, result: await response.json() })),
    ])
      .then(([listsResponse, draftsResponse]) => {
        if (!active) return;
        if (!listsResponse.ok) {
          setBrevoError(listsResponse.result.error || "De Brevo-lijsten konden niet worden geladen.");
        } else {
          const lists = listsResponse.result.lists || [];
          setBrevoLists(lists);
          setBrevoSenderEmail(listsResponse.result.senderEmail || "");
          setSelectedListIds([]);
        }
        if (!draftsResponse.ok) {
          setBrevoError((current) => current || draftsResponse.result.error || "De campagneconcepten konden niet worden geladen.");
        } else {
          setDrafts(draftsResponse.result.drafts || []);
        }
      })
      .catch(() => { if (active) setBrevoError("Brevo kon niet worden bereikt."); })
      .finally(() => { if (active) setLoadingBrevo(false); });
    return () => { active = false; };
  }, [selectedBusinessId, session.access_token, workspaceId]);

  function updateField(field, value) {
    setCampaignForm((current) => ({ ...current, [field]: value }));
    setSaveMessage("");
    setPreview(null);
  }

  function toggleList(listId) {
    const value = String(listId);
    setSelectedListIds((current) => current.includes(value) ? current.filter((id) => id !== value) : [...current, value]);
    setPreview(null);
    setSaveMessage("");
  }

  function buildPreview(event) {
    event?.preventDefault();
    const selectedLists = brevoLists.filter((item) => selectedListIds.includes(String(item.id)));
    if (!selectedLists.length) { setBrevoError("Vink minimaal één geldige Brevo-doelgroep aan."); return; }
    setBrevoError("");
    setPreview({
      business: businesses.find((item) => item.id === selectedBusinessId)?.name || "Vestiging",
      listName: selectedLists.map((item) => item.name).join(", "),
      listNames: selectedLists.map((item) => item.name),
      recipients: selectedLists.reduce((total, item) => total + Number(item.totalSubscribers || item.uniqueSubscribers || 0), 0),
      campaignName: campaignForm.campaignName,
      subject: campaignForm.subject,
      senderName: campaignForm.senderName,
      senderEmail: brevoSenderEmail,
      content: campaignForm.content,
    });
  }

  async function saveConcept() {
    if (!preview || !selectedListIds.length) return;
    setSavingDraft(true);
    setBrevoError("");
    setSaveMessage("");
    const response = await fetch("/api/integrations/brevo", {
      method: selectedDraftId ? "PATCH" : "POST",
      headers: { Authorization: `Bearer ${session.access_token}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        id: selectedDraftId || undefined,
        workspaceId,
        businessId: selectedBusinessId,
        listIds: selectedListIds.map(Number),
        ...campaignForm,
      }),
    }).catch(() => null);
    const result = response ? await response.json().catch(() => ({})) : {};
    if (!response?.ok) {
      setBrevoError(result.error || "Het concept kon niet worden opgeslagen.");
      setSavingDraft(false);
      return;
    }
    const saved = result.draft;
    setSelectedDraftId(saved.id);
    setDrafts((current) => [saved, ...current.filter((item) => item.id !== saved.id)]);
    setSaveMessage(selectedDraftId ? "Concept bijgewerkt." : "Concept veilig opgeslagen.");
    setSavingDraft(false);
  }

  async function requestFinalApproval() {
    if (!selectedDraftId || !preview) return;
    setRequestingApproval(true);
    setBrevoError("");
    setSaveMessage("");
    const response = await fetch("/api/integrations/brevo", {
      method: "PATCH",
      headers: { Authorization: `Bearer ${session.access_token}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "request_approval",
        id: selectedDraftId,
        workspaceId,
        businessId: selectedBusinessId,
        confirmationName: approvalConfirmation.name,
        confirmed: approvalConfirmation.confirmed,
      }),
    }).catch(() => null);
    const result = response ? await response.json().catch(() => ({})) : {};
    if (!response?.ok) {
      setBrevoError(result.error || "Het concept kon niet worden klaargezet voor goedkeuring.");
      setRequestingApproval(false);
      return;
    }
    const updated = result.draft;
    setDrafts((current) => [updated, ...current.filter((item) => item.id !== updated.id)]);
    setPreview((current) => current ? { ...current, recipients: Number(updated.recipient_count || 0), listName: updated.list_name } : current);
    setSaveMessage(result.message || "Klaargezet voor definitieve goedkeuring. Er is niets verzonden.");
    setApprovalConfirmation({ name: "", confirmed: false });
    setSendConfirmation({ text: "", confirmed: false });
    setRequestingApproval(false);
  }

  async function sendApprovedCampaign() {
    if (!selectedDraftId || !preview) return;
    setSendingCampaign(true);
    setBrevoError("");
    setSaveMessage("");
    const response = await fetch("/api/integrations/brevo", {
      method: "PATCH",
      headers: { Authorization: `Bearer ${session.access_token}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "send_campaign", id: selectedDraftId, workspaceId,
        businessId: selectedBusinessId,
        confirmationText: sendConfirmation.text,
        confirmed: sendConfirmation.confirmed,
      }),
    }).catch(() => null);
    const result = response ? await response.json().catch(() => ({})) : {};
    if (!response?.ok) {
      setBrevoError(result.error || "De campagne kon niet worden verzonden.");
      setSendingCampaign(false);
      return;
    }
    const updated = result.draft;
    setDrafts((current) => [updated, ...current.filter((item) => item.id !== updated.id)]);
    setSaveMessage(result.message || "Campagne verzonden.");
    setSendConfirmation({ text: "", confirmed: false });
    setSendingCampaign(false);
  }

  function openDraft(draft) {
    setSelectedDraftId(draft.id);
    setApprovalConfirmation({ name: "", confirmed: false });
    setSelectedListIds((draft.list_ids?.length ? draft.list_ids : [draft.list_id]).map(String));
    setCampaignForm({
      campaignName: draft.internal_name,
      senderName: draft.sender_name,
      subject: draft.subject,
      content: draft.body,
    });
    setPreview({
      business: businesses.find((item) => item.id === selectedBusinessId)?.name || "Vestiging",
      listName: draft.list_name,
      listNames: draft.list_names?.length ? draft.list_names : [draft.list_name],
      recipients: Number(draft.recipient_count || 0),
      campaignName: draft.internal_name,
      subject: draft.subject,
      senderName: draft.sender_name,
      senderEmail: brevoSenderEmail,
      content: draft.body,
    });
    setSaveMessage("Bestaand concept geopend. Wijzig het en sla opnieuw op.");
    setBrevoError("");
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function startNewDraft() {
    setSelectedDraftId("");
    setApprovalConfirmation({ name: "", confirmed: false });
    setSendConfirmation({ text: "", confirmed: false });
    setCampaignForm({ campaignName: "", senderName: "", subject: "", content: "" });
    setSelectedListIds([]);
    setPreview(null);
    setSaveMessage("");
    setBrevoError("");
  }

  return <>
    <section className="pageIntro"><p className="eyebrow">Commerciële groei</p><h2>Marketing</h2><p>Bereid Brevo-campagnes veilig per vestiging voor en controleer de doelgroep vóór verzending.</p></section>
    <section className="userAdminGrid">
      <article className="panel creationPanel">
        <div className="panelHead"><div><h2>{selectedDraftId ? "Campagneconcept bewerken" : "Nieuwe Brevo-campagne"}</h2><p>Concepten worden in Horeca OS opgeslagen. Er wordt niets verzonden of in Brevo gewijzigd.</p></div>{selectedDraftId && <button type="button" onClick={startNewDraft}>Nieuw concept</button>}</div>
        <form onSubmit={buildPreview} className="employeeForm creationForm">
          <label>Vestiging
            <select value={selectedBusinessId} onChange={(event) => {
              setSelectedBusinessId(event.target.value);
              setSelectedDraftId("");
              setCampaignForm({ campaignName: "", senderName: "", subject: "", content: "" });
              setPreview(null);
              setSaveMessage("");
              setBrevoError("");
            }}>
              {businesses.map((business) => <option key={business.id} value={business.id}>{business.name}</option>)}
            </select>
          </label>
          <fieldset className="full"><legend>Doelgroepen</legend>
            {loadingBrevo && <small>Lijsten laden...</small>}
            {!loadingBrevo && !brevoLists.length && <small>Geen lijst beschikbaar</small>}
            <div className="checkGrid" style={{ display: "grid", gridTemplateColumns: "1fr", gap: "10px" }}>{brevoLists.map((list) => <label className="checkOption" key={list.id}><input type="checkbox" checked={selectedListIds.includes(String(list.id))} onChange={() => toggleList(list.id)} />{list.name} · {Number(list.totalSubscribers || list.uniqueSubscribers || 0)} contacten</label>)}</div>
            {!!selectedListIds.length && <small>{selectedListIds.length} doelgroep(en) geselecteerd. Brevo verwijdert dubbele e-mailadressen bij verzending.</small>}
          </fieldset>
          <label>Interne campagnenaam<input value={campaignForm.campaignName} onChange={(event) => updateField("campaignName", event.target.value)} placeholder="Bijvoorbeeld: Caribbean Friday augustus" required /></label>
          <label>Naam afzender<input value={campaignForm.senderName} onChange={(event) => updateField("senderName", event.target.value)} placeholder="Caribbean Corner" required /><small>Brevo-adres: {brevoSenderEmail || "nog niet ingesteld"}</small></label>
          <label className="full">Onderwerp<input value={campaignForm.subject} onChange={(event) => updateField("subject", event.target.value)} placeholder="Dit ziet de gast in de inbox" required /></label>
          <label className="full">Bericht<textarea value={campaignForm.content} onChange={(event) => updateField("content", event.target.value)} rows="9" placeholder="Schrijf hier de inhoud van de nieuwsbrief." required /></label>
          {brevoError && <div className="notice full">{brevoError}</div>}
          {saveMessage && <div className="notice successNotice full">{saveMessage}</div>}
          <div className="scopeBanner full"><strong>Veilige controle</strong><span>Opslaan maakt alleen een concept. Verzenden blijft uitgeschakeld en krijgt later een aparte bevestiging en bevoegdheidscontrole.</span></div>
          <button type="submit" className="primary full" disabled={!selectedListIds.length || loadingBrevo}>Voorbeeld maken</button>
        </form>
      </article>
      <article className="panel">
        <div className="panelHead"><div><h2>Campagnevoorbeeld</h2><p>Controleer vestiging, doelgroep en inhoud vóór je het concept opslaat.</p></div></div>
        {!preview && <Empty text="Vul links de campagne in en maak een voorbeeld." />}
        {preview && <>
          <div className="scopeBanner"><strong>{preview.business}</strong><span>{preview.listNames?.join(" · ") || preview.listName} · maximaal {preview.recipients} contacten; Brevo verwijdert dubbele adressen</span></div>
          <div className="factorRow"><div><strong>{preview.subject}</strong><small>Van: {preview.senderName} &lt;{preview.senderEmail || "afzender niet ingesteld"}&gt; · Intern: {preview.campaignName}</small></div></div>
          <div className="sensitiveNote"><strong>Inhoud</strong><span style={{ whiteSpace: "pre-wrap" }}>{preview.content}</span></div>
          <div className="notice successNotice">Voorbeeld gereed. Er is niets naar Brevo of gasten verstuurd.</div>
          <button type="button" className="primary" onClick={saveConcept} disabled={savingDraft}>{savingDraft ? "Concept opslaan..." : selectedDraftId ? "Wijzigingen opslaan" : "Concept opslaan"}</button>
          {selectedDraftId && <div className="sensitiveNote">
            <strong>Definitieve goedkeuring voorbereiden</strong>
            <span>Controleer nogmaals de vestiging, afzender {preview.senderEmail || "niet ingesteld"}, doelgroep en {preview.recipients} ontvangers. Typ daarna exact de interne campagnenaam. Ook hierna wordt nog niets verzonden.</span>
            <label>Campagnenaam ter controle<input value={approvalConfirmation.name} onChange={(event) => setApprovalConfirmation((current) => ({ ...current, name: event.target.value }))} placeholder={preview.campaignName} /></label>
            <label className="checkOption"><input type="checkbox" checked={approvalConfirmation.confirmed} onChange={(event) => setApprovalConfirmation((current) => ({ ...current, confirmed: event.target.checked }))} />Ik heb vestiging, doelgroep en aantal ontvangers gecontroleerd.</label>
            <button type="button" className="secondaryButton" onClick={requestFinalApproval} disabled={requestingApproval || approvalConfirmation.name !== preview.campaignName || !approvalConfirmation.confirmed}>{requestingApproval ? "Controle uitvoeren..." : "Klaarzetten voor definitieve goedkeuring"}</button>
          </div>}
          {selectedDraftId && drafts.find((item) => item.id === selectedDraftId)?.status === "ready_for_approval" && <div className="notice dangerNotice">
            <strong>Definitief verzenden</strong>
            <p>Dit verstuurt de campagne direct via Brevo vanaf {preview.senderEmail || "een niet-ingestelde afzender"}. Controleer onderwerp, inhoud, vestiging en alle aangevinkte doelgroepen nog één keer.</p>
            <label>Typ exact: VERZEND {preview.campaignName}<input value={sendConfirmation.text} onChange={(event) => setSendConfirmation((current) => ({ ...current, text: event.target.value }))} /></label>
            <label className="checkOption"><input type="checkbox" checked={sendConfirmation.confirmed} onChange={(event) => setSendConfirmation((current) => ({ ...current, confirmed: event.target.checked }))} />Ik begrijp dat deze campagne nu echt naar de geselecteerde gasten wordt verzonden.</label>
            <button type="button" className="primary" onClick={sendApprovedCampaign} disabled={sendingCampaign || sendConfirmation.text !== `VERZEND ${preview.campaignName}` || !sendConfirmation.confirmed}>{sendingCampaign ? "Campagne verzenden..." : "Nu definitief verzenden"}</button>
          </div>}
        </>}
      </article>
      <article className="panel" style={{ gridColumn: "1 / -1" }}>
        <div className="panelHead"><div><h2>Opgeslagen concepten</h2><p>Alleen concepten van de gekozen vestiging zijn hier zichtbaar.</p></div><span>{drafts.length} concept(en)</span></div>
        {loadingBrevo && <Empty text="Concepten laden..." />}
        {!loadingBrevo && !drafts.length && <Empty text="Nog geen campagneconcepten voor deze vestiging." />}
        <div className="stackList">
          {drafts.map((draft) => <div className="factorRow" key={draft.id}>
            <div><strong>{draft.internal_name}</strong><small>{draft.subject} · {draft.list_name} · {draft.recipient_count} ontvangers</small><small>Status: {draft.status === "ready_for_approval" ? "Klaar voor definitieve goedkeuring" : draft.status === "sent" ? "Verzonden" : draft.status === "send_failed" ? "Verzending mislukt" : draft.status === "sending" ? "Wordt verzonden" : "Concept"} · Laatst bijgewerkt: {new Date(draft.updated_at).toLocaleString("nl-NL")}</small></div>
            <button type="button" onClick={() => openDraft(draft)}>Openen</button>
          </div>)}
        </div>
      </article>
    </section>
  </>;
}


function PredisBusinessConnectionCard({ workspaceId, business, session }) {
  const storageKey = `horeca-os:predis:${workspaceId}:${business.id}`;
  const [brandId, setBrandId] = useState("");
  const [connected, setConnected] = useState(false);
  const [status, setStatus] = useState("");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const savedBrandId = window.localStorage.getItem(storageKey) || "";
    setBrandId(savedBrandId);
    setConnected(Boolean(savedBrandId));
    setStatus("");
  }, [storageKey]);

  async function checkConnection() {
    if (!brandId.trim()) {
      setStatus("Vul het Predis-merk-ID voor deze vestiging in.");
      return;
    }
    setLoading(true);
    setStatus("");
    const query = new URLSearchParams({ workspaceId, businessId: business.id, brandId: brandId.trim() });
    const response = await fetch(`/api/integrations/predis?${query}`, {
      headers: { Authorization: `Bearer ${session.access_token}` },
    }).catch(() => null);
    const result = response ? await response.json().catch(() => ({})) : {};
    if (!response?.ok) {
      setConnected(false);
      setStatus(result.error || "Predis kon niet worden gecontroleerd.");
    } else {
      window.localStorage.setItem(storageKey, brandId.trim());
      setConnected(true);
      setStatus(`Koppeling geslaagd. ${result.posts?.length || 0} recente concepten gevonden.`);
    }
    setLoading(false);
  }

  return <article style={{ border: "1px solid #d9e2ec", borderRadius: "14px", padding: "18px", background: "#fff" }}>
    <div style={{ display: "flex", justifyContent: "space-between", gap: "16px", alignItems: "flex-start", marginBottom: "14px" }}>
      <div><h3 style={{ margin: 0 }}>{business.name}</h3><p style={{ margin: "4px 0 0" }}>Eigen Predis-merk voor deze vestiging</p></div>
      <strong style={{ color: connected ? "#15803d" : "#b45309", whiteSpace: "nowrap" }}>{connected ? "Verbonden" : "Niet gekoppeld"}</strong>
    </div>
    <label>Predis-merk-ID
      <input value={brandId} onChange={(event) => { setBrandId(event.target.value); setConnected(false); setStatus(""); }} placeholder="Merk-ID uit Predis" autoComplete="off" disabled={connected} />
    </label>
    <div className="formActions">
      <button type="button" className={connected ? "primaryButton" : "secondaryButton"} onClick={checkConnection} disabled={loading || connected}>
        {loading ? "Controleren..." : connected ? "Koppeling geslaagd" : "Koppeling controleren"}
      </button>
      {connected && <Link href="/marketing" className="primaryButton" onClick={() => window.sessionStorage.setItem("horeca-os:predis-generator-business", business.id)}>Concept maken</Link>}
      {connected && <button type="button" className="secondaryButton" onClick={() => { setConnected(false); setStatus(""); }}>Koppeling wijzigen</button>}
    </div>
    {status && <div className="statusBanner">{status}</div>}
  </article>;
}

function PredisContentGenerator({ mode = "generate", workspaceId, businessId, businesses, session }) {
  const initialBusinessId = businessId !== "all" ? businessId : businesses[0]?.id || "";
  const [selectedBusinessId, setSelectedBusinessId] = useState(initialBusinessId);
  const [brandId, setBrandId] = useState("");
  const [connectedBusinessName, setConnectedBusinessName] = useState("");
  const [prompt, setPrompt] = useState("");
  const [mediaType, setMediaType] = useState("single_image");
  const [status, setStatus] = useState("");
  const [posts, setPosts] = useState([]);
  const [loading, setLoading] = useState(false);
  const [polling, setPolling] = useState(false);
  const [generatedPostIds, setGeneratedPostIds] = useState([]);
  const [draftCaptions, setDraftCaptions] = useState({});
  const [savingPostId, setSavingPostId] = useState("");
  const [savedPostIds, setSavedPostIds] = useState([]);
  const [socialAccountId, setSocialAccountId] = useState("");
  const [approvedConcepts, setApprovedConcepts] = useState([]);
  const [planningValues, setPlanningValues] = useState({});
  const [planningPostId, setPlanningPostId] = useState("");
  const selectedBusiness = businesses.find((item) => item.id === selectedBusinessId);

  useEffect(() => {
    if (businessId !== "all") {
      setSelectedBusinessId(businessId);
      return;
    }
    const requestedBusinessId = window.sessionStorage.getItem("horeca-os:predis-generator-business");
    if (requestedBusinessId && businesses.some((item) => item.id === requestedBusinessId)) {
      setSelectedBusinessId(requestedBusinessId);
      window.sessionStorage.removeItem("horeca-os:predis-generator-business");
      return;
    }
    if (!selectedBusinessId && businesses[0]?.id) {
      setSelectedBusinessId(businesses[0].id);
    }
  }, [businessId, businesses, selectedBusinessId]);

  useEffect(() => {
    if (!selectedBusinessId) return;
    const savedBrandId = window.localStorage.getItem(`horeca-os:predis:${workspaceId}:${selectedBusinessId}`) || "";
    setBrandId(savedBrandId);
    setConnectedBusinessName(savedBrandId ? businesses.find((item) => item.id === selectedBusinessId)?.name || "" : "");
    setStatus("");
    setPosts([]);
    setGeneratedPostIds([]);
    setDraftCaptions({});
    setSavedPostIds([]);
    setPolling(false);
  }, [selectedBusinessId, workspaceId, businesses]);

  const loadApprovedConcepts = useCallback(async () => {
    if (!workspaceId || !selectedBusinessId) {
      setApprovedConcepts([]);
      return;
    }
    const [{ data: accounts }, { data: concepts, error }] = await Promise.all([
      supabase.from("integration_accounts")
        .select("id, provider, display_name, connection_status")
        .eq("workspace_id", workspaceId)
        .eq("business_id", selectedBusinessId)
        .eq("connection_status", "connected"),
      supabase.from("social_content_items")
        .select("id, account_id, body, media, status, scheduled_for, approved_at, created_at")
        .eq("workspace_id", workspaceId)
        .eq("business_id", selectedBusinessId)
        .eq("content_type", "post")
        .eq("direction", "outbound")
        .in("status", ["draft", "scheduled"])
        .order("created_at", { ascending: false })
        .limit(50),
    ]);
    const preferredAccount = (accounts || []).find((item) => item.provider === "facebook") || (accounts || [])[0];
    setSocialAccountId(preferredAccount?.id || "");
    if (error) {
      setStatus(`De publicatieplanning kon niet worden geladen: ${error.message}`);
      setApprovedConcepts([]);
      return;
    }
    setApprovedConcepts(concepts || []);
  }, [selectedBusinessId, workspaceId]);

  useEffect(() => {
    loadApprovedConcepts();
  }, [loadApprovedConcepts]);

  async function checkConnection() {
    if (!selectedBusinessId || !brandId.trim()) {
      setStatus("Kies een vestiging en vul het bijbehorende Predis-merk-ID in.");
      return;
    }
    setLoading(true);
    setStatus("");
    const query = new URLSearchParams({ workspaceId, businessId: selectedBusinessId, brandId: brandId.trim() });
    const response = await fetch(`/api/integrations/predis?${query}`, {
      headers: { Authorization: `Bearer ${session.access_token}` },
    }).catch(() => null);
    const result = response ? await response.json().catch(() => ({})) : {};
    if (!response?.ok) {
      setPosts([]);
      setConnectedBusinessName("");
      setStatus(result.error || "Predis kon niet worden gecontroleerd.");
    } else {
      const businessName = result.business?.name || selectedBusiness?.name || "deze vestiging";
      window.localStorage.setItem(`horeca-os:predis:${workspaceId}:${selectedBusinessId}`, brandId.trim());
      setConnectedBusinessName(businessName);
      setPosts(result.posts || []);
      setStatus(`Koppeling geslaagd. ${result.posts?.length || 0} recente concepten gevonden.`);
    }
    setLoading(false);
  }

  async function loadGeneratedConcepts(targetIds = generatedPostIds, quiet = false) {
    if (!selectedBusinessId || !brandId.trim()) return [];
    if (!quiet) setLoading(true);
    const query = new URLSearchParams({ workspaceId, businessId: selectedBusinessId, brandId: brandId.trim() });
    const response = await fetch(`/api/integrations/predis?${query}`, {
      headers: { Authorization: `Bearer ${session.access_token}` },
    }).catch(() => null);
    const result = response ? await response.json().catch(() => ({})) : {};
    if (!response?.ok) {
      if (!quiet) setStatus(result.error || "De Predis-concepten konden niet worden opgehaald.");
      if (!quiet) setLoading(false);
      return [];
    }
    const recentPosts = result.posts || [];
    const matchingPosts = targetIds.length
      ? recentPosts.filter((post) => targetIds.includes(String(post.post_id || post.id || "")))
      : recentPosts;
    setPosts(matchingPosts.length ? matchingPosts : recentPosts);
    if (!quiet) {
      setStatus(matchingPosts.length || !targetIds.length
        ? `${matchingPosts.length || recentPosts.length} concept(en) opgehaald. Er is niets gepubliceerd.`
        : "Predis is nog bezig met het concept.");
      setLoading(false);
    }
    return matchingPosts;
  }

  async function followGeneration(postIds) {
    setPolling(true);
    for (let attempt = 0; attempt < 8; attempt += 1) {
      if (attempt > 0) await new Promise((resolve) => window.setTimeout(resolve, 5000));
      const completed = await loadGeneratedConcepts(postIds, true);
      if (completed.length > 0) {
        setStatus("Het Predis-concept is klaar en staat hieronder. Er is niets gepubliceerd.");
        setPolling(false);
        return;
      }
    }
    setStatus("Predis werkt nog aan het concept. Gebruik 'Concepten vernieuwen' om het resultaat op te halen.");
    setPolling(false);
  }

  async function generateConcept() {
    if (!selectedBusinessId || !brandId.trim()) {
      setStatus("Koppel deze vestiging eerst onder Koppelingen → Predis.");
      return;
    }
    if (prompt.trim().length < 20) {
      setStatus("Beschrijf het bericht met minimaal 20 tekens.");
      return;
    }
    setLoading(true);
    setPosts([]);
    setGeneratedPostIds([]);
    setStatus("");
    const response = await fetch("/api/integrations/predis", {
      method: "POST",
      headers: { Authorization: `Bearer ${session.access_token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ workspaceId, businessId: selectedBusinessId, brandId: brandId.trim(), prompt: prompt.trim(), mediaType }),
    }).catch(() => null);
    const result = response ? await response.json().catch(() => ({})) : {};
    if (!response?.ok) {
      setStatus(result.error || "Predis kon het concept niet starten.");
      setLoading(false);
      return;
    }
    const postIds = (result.postIds || []).map(String);
    setGeneratedPostIds(postIds);
    setStatus(`Predis maakt het concept. Status: ${result.status || "in behandeling"}. Horeca OS controleert automatisch wanneer het klaar is.`);
    setLoading(false);
    followGeneration(postIds);
  }

  async function saveConceptForPlanning(post, index) {
    const postId = String(post.post_id || post.id || index);
    const urls = Array.isArray(post.urls) ? post.urls : [];
    const caption = (draftCaptions[postId] ?? post.caption ?? post.text ?? "").trim();
    if (!caption) {
      setStatus("Vul eerst een tekst in voordat je het concept goedkeurt.");
      return;
    }
    if (!socialAccountId) {
      setStatus("Koppel voor deze vestiging eerst een Facebook- of Instagram-account.");
      return;
    }
    setSavingPostId(postId);
    const media = urls.map((url) => ({ url, media_type: post.media_type || mediaType, source: "predis", predis_post_id: postId }));
    const now = new Date().toISOString();
    const { error } = await supabase.from("social_content_items").insert({
      workspace_id: workspaceId,
      business_id: selectedBusinessId,
      account_id: socialAccountId,
      content_type: "post",
      direction: "outbound",
      status: "draft",
      workflow_status: "new",
      body: caption,
      media,
      created_by: session.user.id,
      approved_by: session.user.id,
      approved_at: now,
      created_at: now,
    });
    if (error) {
      setStatus(`Concept kon niet worden opgeslagen: ${error.message}`);
    } else {
      setSavedPostIds((current) => current.includes(postId) ? current : [...current, postId]);
      setStatus("Concept is goedgekeurd en als concept klaargezet voor de publicatieplanning.");
      await loadApprovedConcepts();
    }
    setSavingPostId("");
  }

  function updatePlanningValue(conceptId, key, value) {
    setPlanningValues((current) => ({
      ...current,
      [conceptId]: { ...(current[conceptId] || {}), [key]: value },
    }));
  }

  function togglePlanningChannel(conceptId, channel) {
    const currentChannels = planningValues[conceptId]?.channels || [];
    updatePlanningValue(
      conceptId,
      "channels",
      currentChannels.includes(channel)
        ? currentChannels.filter((item) => item !== channel)
        : [...currentChannels, channel],
    );
  }

  async function scheduleConcept(concept) {
    const values = planningValues[concept.id] || {};
    if (!values.date || !values.time) {
      setStatus("Kies eerst een publicatiedatum en tijd.");
      return;
    }
    if (!values.channels?.length) {
      setStatus("Kies minimaal één kanaal: Facebook of Instagram.");
      return;
    }
    const scheduledFor = new Date(`${values.date}T${values.time}`);
    if (Number.isNaN(scheduledFor.getTime()) || scheduledFor <= new Date()) {
      setStatus("Kies een datum en tijd in de toekomst.");
      return;
    }
    const currentMedia = Array.isArray(concept.media)
      ? concept.media.filter((item) => item?.kind !== "publication_schedule")
      : [];
    const scheduleMetadata = {
      kind: "publication_schedule",
      target_channels: values.channels,
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || "Europe/Amsterdam",
    };
    setPlanningPostId(concept.id);
    const { error } = await supabase.from("social_content_items")
      .update({
        status: "scheduled",
        workflow_status: "in_progress",
        scheduled_for: scheduledFor.toISOString(),
        approved_by: session.user.id,
        approved_at: concept.approved_at || new Date().toISOString(),
        media: [...currentMedia, scheduleMetadata],
        updated_at: new Date().toISOString(),
      })
      .eq("id", concept.id)
      .eq("workspace_id", workspaceId)
      .eq("business_id", selectedBusinessId);
    if (error) {
      setStatus(`Concept kon niet worden ingepland: ${error.message}`);
    } else {
      setStatus(`Concept ingepland voor ${formatDate(scheduledFor)}. Er is nog niets gepubliceerd.`);
      await loadApprovedConcepts();
    }
    setPlanningPostId("");
  }

    if (mode === "connect") return <section className="panel formPanel">
    <div className="sectionHeading"><div><p className="eyebrow">Contentkoppelingen</p><h3>Predis</h3><p>Elke vestiging heeft een eigen koppeling. De status is direct zichtbaar.</p></div></div>
    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))", gap: "16px" }}>
      {businesses.map((business) => <PredisBusinessConnectionCard key={business.id} workspaceId={workspaceId} business={business} session={session} />)}
    </div>
  </section>;

  return <section className="panel formPanel">
    <div className="sectionHeading">
      <div><p className="eyebrow">Sociale content</p><h3>Predis conceptgenerator</h3><p>Maak beeld- en tekstconcepten per vestiging. Beheer de koppeling onder Koppelingen.</p></div>
    </div>
    <div className="formGrid">
      <label>Vestiging
        <select value={selectedBusinessId} onChange={(event) => setSelectedBusinessId(event.target.value)}>
          <option value="">Kies een vestiging</option>
          {businesses.map((business) => <option key={business.id} value={business.id}>{business.name}</option>)}
        </select>
      </label>
      <label>Soort concept
        <select value={mediaType} onChange={(event) => setMediaType(event.target.value)}>
          <option value="single_image">Afbeelding</option>
          <option value="carousel">Carrousel</option>
          <option value="video">Video</option>
        </select>
      </label>
    </div>
    {brandId ? <div className="statusBanner">Predis is gekoppeld aan {selectedBusiness?.name || "deze vestiging"}.</div> : <div className="warningBanner">Nog niet gekoppeld. Ga naar Koppelingen → Predis.</div>}
    <label>Opdracht voor Predis
      <textarea rows="5" value={prompt} onChange={(event) => setPrompt(event.target.value)} placeholder="Beschrijf doelgroep, aanbieding, toon en gewenste actie." />
    </label>
    <div className="formActions">
      <button type="button" className="primaryButton" onClick={generateConcept} disabled={loading || polling || !brandId}>{loading ? "Starten..." : polling ? "Concept wordt gemaakt..." : "Concept laten maken"}</button>
      <button type="button" className="secondaryButton" onClick={() => loadGeneratedConcepts()} disabled={loading || polling || !brandId}>Concepten vernieuwen</button>
    </div>
    <p className="securityHint">Predis kan hiervoor credits gebruiken. Horeca OS publiceert dit concept niet automatisch.</p>
    {status && <div className="statusBanner">{status}</div>}
    {posts.length > 0 && <div style={{ display: "grid", gap: "16px", marginTop: "16px" }}>
      {posts.slice(0, 3).map((post, index) => {
        const urls = Array.isArray(post.urls) ? post.urls : [];
        const mediaUrl = urls[0] || post.media_url || post.image_url || "";
        const caption = post.caption || post.text || `Predis-concept ${index + 1}`;
        return <article className="panel" key={post.post_id || post.id || index} style={{ padding: "16px" }}>
          <div style={{ display: "grid", gridTemplateColumns: mediaUrl ? "minmax(180px, 320px) 1fr" : "1fr", gap: "18px", alignItems: "start" }}>
            {mediaUrl && (post.media_type === "video" || /\\.(mp4|mov|webm)(\\?|$)/i.test(mediaUrl)
              ? <video src={mediaUrl} controls playsInline style={{ width: "100%", borderRadius: "12px" }} />
              : <img src={mediaUrl} alt="Predis-concept" style={{ width: "100%", borderRadius: "12px" }} />)}
            <div>
              <p className="eyebrow">{selectedBusiness?.name || "Vestiging"} · {post.media_type || mediaType}</p>
              <label>Tekst voor publicatie
                <textarea
                  rows="7"
                  value={draftCaptions[String(post.post_id || post.id || index)] ?? caption}
                  onChange={(event) => setDraftCaptions((current) => ({ ...current, [String(post.post_id || post.id || index)]: event.target.value }))}
                  disabled={savedPostIds.includes(String(post.post_id || post.id || index))}
                />
              </label>
              <p><strong>Predis-status:</strong> {post.status || post.post_status || "Klaar"}</p>
              <div className="formActions">
                <button
                  type="button"
                  className="primaryButton"
                  onClick={() => saveConceptForPlanning(post, index)}
                  disabled={savingPostId === String(post.post_id || post.id || index) || savedPostIds.includes(String(post.post_id || post.id || index))}
                >
                  {savedPostIds.includes(String(post.post_id || post.id || index))
                    ? "Goedgekeurd en klaargezet"
                    : savingPostId === String(post.post_id || post.id || index)
                      ? "Opslaan..."
                      : "Goedkeuren voor planning"}
                </button>
              </div>
              <p className="securityHint">Goedkeuren slaat het concept op, maar publiceert nog niets.</p>
            </div>
          </div>
        </article>;
      })}
    </div>}

    <div className="sectionHeading" style={{ marginTop: "28px" }}>
      <div>
        <p className="eyebrow">Publicatieplanning</p>
        <h3>Goedgekeurde concepten</h3>
        <p>Kies datum, tijd en kanaal per vestiging. Inplannen publiceert nog niets.</p>
      </div>
      <button type="button" className="secondaryButton" onClick={loadApprovedConcepts}>Planning vernieuwen</button>
    </div>
    {!socialAccountId && <div className="warningBanner">Voor deze vestiging is nog geen actief sociaal account gevonden.</div>}
    {approvedConcepts.length === 0
      ? <p className="empty">Nog geen goedgekeurde concepten voor {selectedBusiness?.name || "deze vestiging"}.</p>
      : <div style={{ display: "grid", gap: "16px" }}>
        {approvedConcepts.map((concept) => {
          const scheduleMeta = (Array.isArray(concept.media) ? concept.media : []).find((item) => item?.kind === "publication_schedule");
          const mediaItem = (Array.isArray(concept.media) ? concept.media : []).find((item) => item?.url);
          const selectedChannels = planningValues[concept.id]?.channels || scheduleMeta?.target_channels || [];
          return <article className="panel" key={concept.id} style={{ padding: "16px" }}>
            <div style={{ display: "grid", gridTemplateColumns: mediaItem?.url ? "minmax(140px, 220px) 1fr" : "1fr", gap: "18px", alignItems: "start" }}>
              {mediaItem?.url && (mediaItem.media_type === "video" || /\.(mp4|mov|webm)(\?|$)/i.test(mediaItem.url)
                ? <video src={mediaItem.url} controls playsInline style={{ width: "100%", borderRadius: "12px" }} />
                : <img src={mediaItem.url} alt="Goedgekeurd concept" style={{ width: "100%", borderRadius: "12px" }} />)}
              <div>
                <p>{concept.body}</p>
                {concept.status === "scheduled" && concept.scheduled_for && <div className="statusBanner">Ingepland voor {formatDate(concept.scheduled_for)} · {selectedChannels.map((channel) => channel === "facebook" ? "Facebook" : "Instagram").join(" + ")}</div>}
                <div className="formGrid">
                  <label>Datum
                    <input type="date" min={isoDate(new Date())} value={planningValues[concept.id]?.date || (concept.scheduled_for ? toLocalDateTimeInput(concept.scheduled_for).slice(0, 10) : "")} onChange={(event) => updatePlanningValue(concept.id, "date", event.target.value)} />
                  </label>
                  <label>Tijd
                    <input type="time" value={planningValues[concept.id]?.time || (concept.scheduled_for ? toLocalDateTimeInput(concept.scheduled_for).slice(11, 16) : "")} onChange={(event) => updatePlanningValue(concept.id, "time", event.target.value)} />
                  </label>
                </div>
                <fieldset style={{ marginTop: "12px" }}>
                  <legend>Kanalen</legend>
                  <div className="checkGrid">
                    <label className="checkOption"><input type="checkbox" checked={selectedChannels.includes("facebook")} onChange={() => togglePlanningChannel(concept.id, "facebook")} />Facebook</label>
                    <label className="checkOption"><input type="checkbox" checked={selectedChannels.includes("instagram")} onChange={() => togglePlanningChannel(concept.id, "instagram")} />Instagram</label>
                  </div>
                </fieldset>
                <div className="formActions">
                  <button type="button" className="primaryButton" onClick={() => scheduleConcept(concept)} disabled={planningPostId === concept.id || !socialAccountId}>
                    {planningPostId === concept.id ? "Inplannen..." : concept.status === "scheduled" ? "Planning wijzigen" : "Inplannen"}
                  </button>
                </div>
                <p className="securityHint">De definitieve publicatie krijgt later nog een aparte bevestiging.</p>
              </div>
            </div>
          </article>;
        })}
      </div>}
  </section>;
}

function AccessDenied() {
  return <section className="panel emptyModule"><strong>Geen toegang tot dit onderdeel</strong><p>Jouw rol bevat niet de benodigde rechten. Kies een beschikbaar onderdeel in het menu.</p><Link className="secondaryButton" href="/dashboard">Naar mijn werk</Link></section>;
}

function StaffDashboard({ priorities, events }) {
  return <>
    <section className="pageIntro"><p className="eyebrow">Mijn werk</p><h2>Werkzaamheden en planning</h2><p>Alleen informatie binnen jouw toegewezen vestiging en rol wordt getoond.</p></section>
    <section className="dashboardGrid">
      <Panel title="Mijn prioriteiten" subtitle="Openstaande operationele werkzaamheden">{priorities.length === 0 && <Empty text="Geen openstaande werkzaamheden." />}{priorities.map((task) => <div className={`task ${task.priority || "medium"}`} key={task.id}><div><b>{task.title}</b><span>{priorityLabel[task.priority] || task.priority} Ã‚Â· {statusLabel[task.status] || task.status}</span></div></div>)}</Panel>
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
      <button className={openEntry ? "secondaryButton" : "primary"} onClick={toggleClock} disabled={busy || (!openEntry && !selectedBusinessId)}>{busy ? "BezigÃ¢â‚¬Â¦" : openEntry ? "Uitklokken" : "Inklokken"}</button>
    </div>
    {feedback && <p className="clockFeedback">{feedback}</p>}
    {entries.length > 0 && <div className="clockHistory"><strong>Recente diensten</strong>{entries.slice(0, 4).map((entry) => <span key={entry.id}>{formatDate(entry.clocked_in_at)} Ã‚Â· {formatTime(entry.clocked_in_at)} Ã¢â‚¬â€œ {entry.clocked_out_at ? formatTime(entry.clocked_out_at) : "actief"}</span>)}</div>}
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
      <Panel title="Per medewerker" subtitle="Totaal binnen de gekozen periode">{loadingHours && <Empty text="Uren ladenÃ¢â‚¬Â¦" />}{!loadingHours && people.length === 0 && <Empty text="Nog geen uren geregistreerd." />}{people.map((person) => <div className="hoursPerson" key={person.id}><div><b>{person.name}</b><span>{person.shifts} dienst{person.shifts === 1 ? "" : "en"}{person.open ? " Ã‚Â· nu ingeklokt" : ""}</span></div><strong>{formatDuration(person.minutes)}</strong></div>)}</Panel>
      <Panel title="Recente registraties" subtitle="Laatste in- en uitklokmomenten">{loadingHours && <Empty text="Registraties ladenÃ¢â‚¬Â¦" />}{!loadingHours && entries.length === 0 && <Empty text="Nog geen registraties gevonden." />}{entries.slice(0, 15).map((entry) => <TimeEntryEditor entry={entry} businesses={businesses} minutes={minutesFor(entry)} onCorrect={correctEntry} key={entry.id} />)}</Panel>
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
    <section className="pageIntro scheduleIntro"><div><p className="eyebrow">Personeelsplanning</p><h2>Rooster & beschikbaarheid</h2><p>Diensten plannen per vestiging en beschikbaarheid vooraf verzamelen.</p></div><div className="weekControls"><button className="secondaryButton" onClick={() => setWeekOffset((value) => value - 1)}>Vorige</button><b>{formatShortDate(weekStart)} Ã¢â‚¬â€œ {formatShortDate(addDays(weekStart, 6))}</b><button className="secondaryButton" onClick={() => setWeekOffset((value) => value + 1)}>Volgende</button></div></section>
    {scheduleMessage && <div className="notice">{scheduleMessage}</div>}
    <section className="scheduleWeek">{weekDays.map((day) => { const dayShifts = shifts.filter((shift) => isoDate(new Date(shift.starts_at)) === isoDate(day)); const dayAvailability = availability.filter((item) => item.available_date === isoDate(day)); return <article className="scheduleDay" key={isoDate(day)}><header><b>{new Intl.DateTimeFormat("nl-NL", { weekday: "short" }).format(day)}</b><span>{day.getDate()}</span></header>{dayShifts.map((shift) => <div className="shiftCard" key={shift.id}><strong>{formatTime(shift.starts_at)}Ã¢â‚¬â€œ{formatTime(shift.ends_at)}</strong><b>{timeEntryEmployeeName(shift)}</b><small>{shift.role_label || shift.business?.name || "Dienst"}</small></div>)}{dayShifts.length === 0 && <small className="noShift">Geen diensten</small>}<footer>{dayAvailability.filter((item) => item.status !== "unavailable").length} beschikbaar</footer></article>; })}</section>
    <section className="dashboardGrid scheduleForms">
      {canManage && <Panel title="Dienst inplannen" subtitle="Voeg een medewerker toe aan het weekrooster"><form className="scheduleForm" onSubmit={addShift}><label>Medewerker<select name="userId" required defaultValue=""><option value="" disabled>Kies medewerker</option>{employees.map((employee) => <option value={employee.id} key={employee.id}>{employee.name}</option>)}</select></label><label>Vestiging<select name="businessId" required defaultValue={businessId === "all" ? businesses[0]?.id : businessId}>{businesses.map((business) => <option value={business.id} key={business.id}>{business.name}</option>)}</select></label><label>Datum<input type="date" name="date" required defaultValue={isoDate(weekStart)} /></label><label>Start<input type="time" name="start" required /></label><label>Einde<input type="time" name="end" required /></label><label>Functie<input name="roleLabel" placeholder="Bijv. bediening" /></label><label className="full">Notitie<input name="note" /></label><button className="primary">Dienst toevoegen</button></form></Panel>}
      <Panel title="Mijn beschikbaarheid" subtitle="Geef aan wanneer je kunt werken"><form className="scheduleForm" onSubmit={saveAvailability}><label>Datum<input type="date" name="date" required defaultValue={isoDate(weekStart)} /></label><label>Status<select name="status" defaultValue="available"><option value="available">Beschikbaar</option><option value="preferred">Voorkeur</option><option value="unavailable">Niet beschikbaar</option></select></label><label>Vanaf<input type="time" name="from" /></label><label>Tot<input type="time" name="until" /></label><label className="full">Toelichting<input name="note" placeholder="Optioneel" /></label><button className="primary">Beschikbaarheid opslaan</button></form></Panel>
    </section>
  </>;
}

function SocialReply({ item, channel, workspaceId, session, onPublished }) {
  const [reply, setReply] = useState("");
  const [status, setStatus] = useState("");
  const [publishing, setPublishing] = useState(false);
  const provider = channel === "Facebook" ? "facebook" : channel === "Instagram" ? "meta" : channel === "WhatsApp" ? "whatsapp" : "";
  const supported = Boolean(provider);
  const platformName = channel === "Instagram" ? "Instagram" : channel === "WhatsApp" ? "WhatsApp" : "Facebook";
  const maxLength = channel === "Instagram" ? 2200 : channel === "WhatsApp" ? 4096 : 8000;

  async function publishReply() {
    const message = reply.trim();
    if (!message) { setStatus("Schrijf eerst een reactie."); return; }
    if (!window.confirm(`Deze reactie wordt openbaar geplaatst op ${platformName} namens de gekoppelde vestiging:\n\n${message}\n\nDefinitief plaatsen?`)) return;
    setPublishing(true); setStatus("");
    try {
      const response = await fetch(`/api/integrations/${provider}/reply`, {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${session?.access_token || ""}` },
        body: JSON.stringify({ workspaceId, businessId: item.business_id, itemId: item.id, message }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "De reactie kon niet worden geplaatst.");
      setReply(""); setStatus(result.warning || result.message || "Reactie geplaatst.");
      await onPublished();
    } catch (error) {
      setStatus(error.message || "De reactie kon niet worden geplaatst.");
    } finally {
      setPublishing(false);
    }
  }

  return <details className="socialReply">
    <summary>Reageren</summary>
    <textarea value={reply} onChange={(event) => setReply(event.target.value)} placeholder="Schrijf je reactie aan de gast" maxLength={maxLength} disabled={!supported || publishing} />
    <button type="button" className="primary" onClick={publishReply} disabled={!supported || publishing || !reply.trim()}>{publishing ? "Plaatsen…" : supported ? `Reactie plaatsen op ${platformName}` : "Kanaal niet beschikbaar"}</button>
    <small>{supported ? `Voor plaatsing op ${platformName} volgt altijd nog een definitieve bevestiging.` : "Reageren is voor dit kanaal nog niet beschikbaar."}</small>
    {status && <small className="notice">{status}</small>}
  </details>;
}

function CalendarOverview({ workspaceId, session }) {
  const [accounts, setAccounts] = useState([]);
  const [mailbox, setMailbox] = useState("all");
  const [view, setView] = useState("month");
  const [anchor, setAnchor] = useState(() => new Date());
  const [loading, setLoading] = useState(true);
  const [working, setWorking] = useState(false);
  const [message, setMessage] = useState("");
  const [notice, setNotice] = useState("");
  const [selectedEvent, setSelectedEvent] = useState(null);
  const [editor, setEditor] = useState(null);
  const [calendarSearch, setCalendarSearch] = useState("");
  const [calendarClock, setCalendarClock] = useState(() => new Date());
  const searchActive = Boolean(calendarSearch.trim());
  const mailboxPalette = ["#20869b", "#6d5bd0", "#d97706", "#2f855a", "#c2415d", "#2563a8"];
  const mailboxColor = (address) => mailboxPalette[Math.max(0, accounts.findIndex((account) => account.mailbox === address)) % mailboxPalette.length];

  const range = useMemo(() => {
    const date = new Date(anchor);
    let start; let end;
    if (searchActive) {
      start = new Date(date.getFullYear() - 1, 0, 1);
      end = new Date(date.getFullYear() + 2, 0, 1);
    } else if (view === "day") {
      start = new Date(date.getFullYear(), date.getMonth(), date.getDate());
      end = new Date(start); end.setDate(end.getDate() + 1);
    } else if (view === "week") {
      start = new Date(date.getFullYear(), date.getMonth(), date.getDate());
      const day = (start.getDay() + 6) % 7; start.setDate(start.getDate() - day);
      end = new Date(start); end.setDate(end.getDate() + 7);
    } else if (view === "year") {
      start = new Date(date.getFullYear(), 0, 1);
      end = new Date(date.getFullYear() + 1, 0, 1);
    } else {
      start = new Date(date.getFullYear(), date.getMonth(), 1);
      end = new Date(date.getFullYear(), date.getMonth() + 1, 1);
    }
    return { start, end };
  }, [anchor, searchActive, view]);

  const loadCalendar = useCallback(async () => {
    if (!workspaceId || !session?.access_token) return;
    setLoading(true); setMessage("");
    try {
      const params = new URLSearchParams({ workspaceId, start: range.start.toISOString(), end: range.end.toISOString() });
      const response = await fetch(`/api/integrations/microsoft/calendar?${params}`, { headers: { Authorization: `Bearer ${session.access_token}` }, cache: "no-store" });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "De agenda kon niet worden geladen.");
      setAccounts(result.accounts || []);
    } catch (error) { setMessage(error.message); }
    finally { setLoading(false); }
  }, [range.end, range.start, session?.access_token, workspaceId]);

  useEffect(() => { loadCalendar(); }, [loadCalendar]);
  useEffect(() => { const timer = window.setInterval(() => setCalendarClock(new Date()), 60000); return () => window.clearInterval(timer); }, []);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get("microsoft") === "connected") setNotice(`${params.get("account") || "De agenda"} heeft beheerrechten en is gekoppeld.`);
    if (params.get("microsoft") === "error") setMessage(params.get("message") || "De agendarechten konden niet worden vernieuwd.");
    if (params.has("microsoft")) window.history.replaceState({}, "", window.location.pathname);
  }, []);

  async function renewCalendarAccess() {
    const targetMailbox = mailbox === "all" ? accounts[0]?.mailbox : mailbox;
    if (!targetMailbox) return;
    setWorking(true); setMessage("");
    try {
      const response = await fetch("/api/integrations/microsoft", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${session.access_token}` },
        body: JSON.stringify({ workspaceId, mailbox: targetMailbox, returnTo: "/agenda" }),
      });
      const result = await response.json();
      if (!response.ok || !result.authorizationUrl) throw new Error(result.error || "Microsoft kon niet worden geopend.");
      window.location.assign(result.authorizationUrl);
    } catch (error) {
      setMessage(error.message);
      setWorking(false);
    }
  }

  const events = accounts.filter((account) => mailbox === "all" || account.mailbox === mailbox)
    .flatMap((account) => account.events.map((event) => ({ ...event, mailbox: account.mailbox })))
    .filter((event) => !calendarSearch.trim() || [event.subject, event.location?.displayName, event.organizer?.emailAddress?.name, event.organizer?.emailAddress?.address, event.bodyPreview].filter(Boolean).join(" ").toLowerCase().includes(calendarSearch.trim().toLowerCase()))
    .sort((a, b) => new Date(a.start?.dateTime) - new Date(b.start?.dateTime));

  function move(direction) {
    const next = new Date(anchor);
    if (view === "day") next.setDate(next.getDate() + direction);
    else if (view === "week") next.setDate(next.getDate() + direction * 7);
    else if (view === "month") next.setMonth(next.getMonth() + direction);
    else next.setFullYear(next.getFullYear() + direction);
    setAnchor(next);
  }

  function newAppointment(day = anchor) {
    const start = new Date(day);
    start.setHours(12, 0, 0, 0);
    const end = new Date(start); end.setHours(13, 0, 0, 0);
    setSelectedEvent(null);
    setEditor({
      mode: "create",
      mailbox: mailbox === "all" ? accounts[0]?.mailbox || "" : mailbox,
      subject: "",
      start: toLocalDateTimeInput(start),
      end: toLocalDateTimeInput(end),
      location: "",
      description: "",
      attendees: "",
      isAllDay: false,
      recurrence: "none",
      reminderMinutes: "15",
      showAs: "busy",
      isPrivate: false,
      isOnlineMeeting: false,
    });
  }

  function editAppointment(event) {
    setEditor({
      mode: "edit",
      eventId: event.id,
      mailbox: event.mailbox,
      subject: event.subject || "",
      start: toLocalDateTimeInput(event.start?.dateTime),
      end: toLocalDateTimeInput(event.end?.dateTime),
      location: event.location?.displayName || "",
      description: event.bodyPreview || "",
      attendees: (event.attendees || []).map((item) => item.emailAddress?.address).filter(Boolean).join(", "),
      isAllDay: Boolean(event.isAllDay),
      recurrence: event.recurrence?.pattern?.type === "daily" ? "daily" : event.recurrence?.pattern?.type === "weekly" ? "weekly" : event.recurrence?.pattern?.type === "absoluteMonthly" ? "monthly" : event.recurrence?.pattern?.type === "absoluteYearly" ? "yearly" : "none",
      reminderMinutes: event.isReminderOn ? String(event.reminderMinutesBeforeStart ?? 15) : "-1",
      showAs: event.showAs || "busy",
      isPrivate: event.sensitivity === "private",
      isOnlineMeeting: Boolean(event.isOnlineMeeting),
    });
  }

  async function saveAppointment(submitEvent) {
    submitEvent.preventDefault();
    const form = new FormData(submitEvent.currentTarget);
    const payload = {
      workspaceId,
      mailbox: String(form.get("mailbox") || ""),
      eventId: editor?.eventId,
      subject: String(form.get("subject") || ""),
      start: localInputToIso(form.get("start")),
      end: localInputToIso(form.get("end")),
      location: String(form.get("location") || ""),
      description: String(form.get("description") || ""),
      attendees: String(form.get("attendees") || "").split(/[;,]/).map((item) => item.trim()).filter(Boolean),
      isAllDay: form.get("isAllDay") === "on",
      recurrence: String(form.get("recurrence") || "none"),
      reminderMinutes: Number(form.get("reminderMinutes")),
      showAs: String(form.get("showAs") || "busy"),
      isPrivate: form.get("isPrivate") === "on",
      isOnlineMeeting: form.get("isOnlineMeeting") === "on",
    };
    if (new Date(payload.end) <= new Date(payload.start)) { setMessage("De eindtijd moet na de begintijd liggen."); return; }
    setWorking(true); setMessage(""); setNotice("");
    try {
      const response = await fetch("/api/integrations/microsoft/calendar/action", {
        method: editor?.mode === "edit" ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${session.access_token}` },
        body: JSON.stringify(payload),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "De afspraak kon niet worden opgeslagen.");
      setNotice(result.message || "De afspraak is opgeslagen.");
      setEditor(null); setSelectedEvent(null);
      await loadCalendar();
    } catch (error) { setMessage(error.message); }
    finally { setWorking(false); }
  }

  function duplicateAppointment(event) {
    const start = new Date(event.start?.dateTime);
    const end = new Date(event.end?.dateTime);
    start.setDate(start.getDate() + 7);
    end.setDate(end.getDate() + 7);
    setSelectedEvent(null);
    setEditor({
      mode: "create",
      mailbox: event.mailbox,
      subject: event.subject || "",
      start: toLocalDateTimeInput(start),
      end: toLocalDateTimeInput(end),
      location: event.location?.displayName || "",
      description: event.bodyPreview || "",
      attendees: (event.attendees || []).map((item) => item.emailAddress?.address).filter(Boolean).join(", "),
      isAllDay: Boolean(event.isAllDay),
      recurrence: "none",
      reminderMinutes: event.isReminderOn ? String(event.reminderMinutesBeforeStart ?? 15) : "-1",
      showAs: event.showAs || "busy",
      isPrivate: event.sensitivity === "private",
      isOnlineMeeting: false,
    });
  }

  async function respondToInvitation(event, responseType) {
    const responseLabel = responseType === "accept" ? "accepteren" : responseType === "tentativelyAccept" ? "voorlopig accepteren" : "weigeren";
    if (!window.confirm(`Wil je deze uitnodiging ${responseLabel}?`)) return;
    setWorking(true); setMessage(""); setNotice("");
    try {
      const response = await fetch("/api/integrations/microsoft/calendar/action", {
        method: "PUT",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${session.access_token}` },
        body: JSON.stringify({ workspaceId, mailbox: event.mailbox, eventId: event.id, response: responseType }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "De reactie kon niet worden verzonden.");
      setNotice(result.message);
      setSelectedEvent(null);
      await loadCalendar();
    } catch (error) { setMessage(error.message); }
    finally { setWorking(false); }
  }

  async function moveAppointment(event, targetDay, useTargetTime = false) {
    if (event.type === "occurrence" || event.type === "exception") {
      setMessage("Open deze terugkerende afspraak en wijzig de gewenste datum handmatig.");
      return;
    }
    const currentStart = new Date(event.start?.dateTime);
    const currentEnd = new Date(event.end?.dateTime);
    const duration = currentEnd.getTime() - currentStart.getTime();
    const newStart = new Date(targetDay);
    if (!useTargetTime) newStart.setHours(currentStart.getHours(), currentStart.getMinutes(), currentStart.getSeconds(), 0);
    const newEnd = new Date(newStart.getTime() + duration);
    setWorking(true); setMessage(""); setNotice("");
    try {
      const response = await fetch("/api/integrations/microsoft/calendar/action", {
        method: "PATCH",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${session.access_token}` },
        body: JSON.stringify({
          workspaceId,
          mailbox: event.mailbox,
          eventId: event.id,
          subject: event.subject || "",
          start: newStart.toISOString(),
          end: newEnd.toISOString(),
          location: event.location?.displayName || "",
          description: event.bodyPreview || "",
          attendees: (event.attendees || []).map((item) => item.emailAddress?.address).filter(Boolean),
          isAllDay: Boolean(event.isAllDay),
          recurrence: "none",
          reminderMinutes: event.isReminderOn ? event.reminderMinutesBeforeStart : -1,
          showAs: event.showAs || "busy",
          isPrivate: event.sensitivity === "private",
          isOnlineMeeting: Boolean(event.isOnlineMeeting),
        }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "De afspraak kon niet worden verplaatst.");
      setNotice("De afspraak is verplaatst.");
      setSelectedEvent(null);
      await loadCalendar();
    } catch (error) { setMessage(error.message); }
    finally { setWorking(false); }
  }

  function moveByDays(event, days) {
    const target = new Date(event.start?.dateTime);
    target.setDate(target.getDate() + days);
    moveAppointment(event, target);
  }

  async function deleteAppointment(event) {
    if (!window.confirm(`Afspraak “${event.subject || "(Geen onderwerp)"}” definitief verwijderen?`)) return;
    setWorking(true); setMessage(""); setNotice("");
    try {
      const response = await fetch("/api/integrations/microsoft/calendar/action", {
        method: "DELETE",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${session.access_token}` },
        body: JSON.stringify({ workspaceId, mailbox: event.mailbox, eventId: event.id }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "De afspraak kon niet worden verwijderd.");
      setNotice(result.message || "De afspraak is verwijderd.");
      setSelectedEvent(null); setEditor(null);
      await loadCalendar();
    } catch (error) { setMessage(error.message); }
    finally { setWorking(false); }
  }

  const periodLabel = view === "day" ? anchor.toLocaleDateString("nl-NL", { weekday: "long", day: "numeric", month: "long", year: "numeric" })
    : view === "week" ? `${range.start.toLocaleDateString("nl-NL")} – ${new Date(range.end.getTime() - 86400000).toLocaleDateString("nl-NL")}`
    : view === "year" ? String(anchor.getFullYear())
    : anchor.toLocaleDateString("nl-NL", { month: "long", year: "numeric" });

  const eventCard = (event) => {
    const start = new Date(event.start?.dateTime); const end = new Date(event.end?.dateTime);
    return <article className="connectionRow" key={`${event.mailbox}-${event.id}`} style={{ borderLeft: `6px solid ${mailboxColor(event.mailbox)}`, paddingLeft: "12px" }}><div><p className="eyebrow">{event.mailbox}</p><h3>{event.subject || "(Geen onderwerp)"}</h3><p>{event.isAllDay ? "Hele dag" : `${start.toLocaleTimeString("nl-NL", { hour: "2-digit", minute: "2-digit" })} – ${end.toLocaleTimeString("nl-NL", { hour: "2-digit", minute: "2-digit" })}`}</p>{event.location?.displayName && <small>{event.location.displayName}</small>}</div><button type="button" className="secondary" onClick={() => { setSelectedEvent(event); setEditor(null); }}>Bekijken</button></article>;
  };

  const days = [];
  if (view === "week" || view === "month") {
    const gridStart = new Date(range.start);
    if (view === "month") gridStart.setDate(gridStart.getDate() - ((gridStart.getDay() + 6) % 7));
    const count = view === "week" ? 7 : 42;
    for (let index = 0; index < count; index += 1) { const day = new Date(gridStart); day.setDate(day.getDate() + index); days.push(day); }
  }

  const calendarHourHeight = 56;
  const calendarHours = Array.from({ length: 24 }, (_, hour) => hour);
  const timelineDays = view === "day" ? [new Date(anchor.getFullYear(), anchor.getMonth(), anchor.getDate())] : view === "week" ? days : [];

  return <section className="stack">
    <div className="section-heading"><div><p className="eyebrow">Planning</p><h2>Agenda</h2><p>Microsoft-agenda’s beheren per dag, week, maand of jaar.</p></div><div className="toolbar"><button type="button" className="primary" onClick={() => newAppointment()} disabled={!accounts.length}>Nieuwe afspraak</button><button type="button" className="secondary" onClick={loadCalendar} disabled={loading}>{loading ? "Laden…" : "Agenda verversen"}</button></div></div>
    {notice && <div className="notice successNotice">{notice}</div>}
    {message && <div className="notice warning">{message}<p>Geeft Microsoft aan dat je onvoldoende rechten hebt? Vernieuw dan eenmalig de agendarechten via Mail.</p></div>}
    <div className="panel stack">
      <div className="toolbar">
        <button type="button" className="secondary" onClick={() => move(-1)}>Vorige</button><button type="button" className="secondary" onClick={() => setAnchor(new Date())}>Vandaag</button><button type="button" className="secondary" onClick={() => move(1)}>Volgende</button>
        <strong>{periodLabel}</strong>
      </div>
      <div className="toolbar">
        <label>Weergave<select value={view} onChange={(event) => setView(event.target.value)}><option value="day">Dag</option><option value="week">Week</option><option value="month">Maand</option><option value="year">Jaar</option></select></label>
        <label>Agenda<select value={mailbox} onChange={(event) => setMailbox(event.target.value)}><option value="all">Alle agenda’s</option>{accounts.map((account) => <option key={account.mailbox} value={account.mailbox}>{account.mailbox}</option>)}</select></label><label>Zoeken<input value={calendarSearch} onChange={(event) => setCalendarSearch(event.target.value)} placeholder="Onderwerp, locatie of organisator" /></label><button type="button" className="secondary" onClick={renewCalendarAccess} disabled={working || !accounts.length}>{working ? "Microsoft openen…" : "Agendarechten vernieuwen"}</button>
      </div>
    </div>
    {editor && <form className="panel stack" onSubmit={saveAppointment}>
      <div className="connectionRow"><h3>{editor.mode === "edit" ? "Afspraak wijzigen" : "Nieuwe afspraak"}</h3><button type="button" className="secondary" onClick={() => setEditor(null)}>Annuleren</button></div>
      <label>Agenda<select name="mailbox" defaultValue={editor.mailbox} required disabled={editor.mode === "edit"}>{accounts.map((account) => <option key={account.mailbox} value={account.mailbox}>{account.mailbox}</option>)}</select>{editor.mode === "edit" && <input type="hidden" name="mailbox" value={editor.mailbox} />}</label>
      <label>Onderwerp<input name="subject" defaultValue={editor.subject} required /></label>
      <div className="toolbar"><label>Begintijd<input name="start" type="datetime-local" defaultValue={editor.start} required /></label><label>Eindtijd<input name="end" type="datetime-local" defaultValue={editor.end} required /></label><label><input name="isAllDay" type="checkbox" defaultChecked={editor.isAllDay} /> Hele dag</label></div>
      <div className="toolbar"><label>Herhalen<select name="recurrence" defaultValue={editor.recurrence}><option value="none">Niet herhalen</option><option value="daily">Dagelijks</option><option value="weekly">Wekelijks</option><option value="monthly">Maandelijks</option><option value="yearly">Jaarlijks</option></select></label><label>Herinnering<select name="reminderMinutes" defaultValue={editor.reminderMinutes}><option value="-1">Geen herinnering</option><option value="0">Op begintijd</option><option value="5">5 minuten vooraf</option><option value="15">15 minuten vooraf</option><option value="30">30 minuten vooraf</option><option value="60">1 uur vooraf</option><option value="1440">1 dag vooraf</option></select></label></div>
      <div className="toolbar"><label>Beschikbaarheid<select name="showAs" defaultValue={editor.showAs}><option value="free">Vrij</option><option value="tentative">Voorlopig</option><option value="busy">Bezet</option><option value="oof">Afwezig</option><option value="workingElsewhere">Elders werkzaam</option></select></label><label><input name="isPrivate" type="checkbox" defaultChecked={editor.isPrivate} /> Privéafspraak</label><label><input name="isOnlineMeeting" type="checkbox" defaultChecked={editor.isOnlineMeeting} /> Teams-vergadering</label></div>
      <label>Locatie<input name="location" defaultValue={editor.location} /></label>
      <label>Deelnemers<input name="attendees" type="text" defaultValue={editor.attendees} placeholder="naam@bedrijf.nl, tweede@bedrijf.nl" /><small>Scheid meerdere e-mailadressen met een komma.</small></label>
      <label>Omschrijving<textarea name="description" defaultValue={editor.description} rows="5" /></label>
      <button type="submit" className="primary" disabled={working}>{working ? "Opslaan…" : "Afspraak opslaan"}</button>
    </form>}
    {selectedEvent && !editor && <div className="panel stack">
      <div className="connectionRow"><div><p className="eyebrow">{selectedEvent.mailbox}</p><h3>{selectedEvent.subject || "(Geen onderwerp)"}</h3></div><button type="button" className="secondary" onClick={() => setSelectedEvent(null)}>Sluiten</button></div>
      <p><strong>Wanneer:</strong> {selectedEvent.isAllDay ? "Hele dag" : `${new Date(selectedEvent.start?.dateTime).toLocaleString("nl-NL")} – ${new Date(selectedEvent.end?.dateTime).toLocaleString("nl-NL")}`}</p>
      {selectedEvent.location?.displayName && <p><strong>Locatie:</strong> {selectedEvent.location.displayName}</p>}
      {selectedEvent.organizer?.emailAddress && <p><strong>Organisator:</strong> {selectedEvent.organizer.emailAddress.name || selectedEvent.organizer.emailAddress.address}{selectedEvent.organizer.emailAddress.address && ` · ${selectedEvent.organizer.emailAddress.address}`}</p>}
      {selectedEvent.attendees?.length > 0 && <div><strong>Deelnemers:</strong><ul>{selectedEvent.attendees.map((attendee, index) => <li key={`${attendee.emailAddress?.address}-${index}`}>{attendee.emailAddress?.name || attendee.emailAddress?.address || "Onbekend"}{attendee.status?.response && ` · ${attendee.status.response}`}</li>)}</ul></div>}
      {selectedEvent.recurrence && <p><strong>Herhaling:</strong> {selectedEvent.recurrence.pattern?.type === "daily" ? "Dagelijks" : selectedEvent.recurrence.pattern?.type === "weekly" ? "Wekelijks" : selectedEvent.recurrence.pattern?.type === "absoluteMonthly" ? "Maandelijks" : "Jaarlijks"}</p>}
      <p><strong>Herinnering:</strong> {selectedEvent.isReminderOn ? `${selectedEvent.reminderMinutesBeforeStart} minuten vooraf` : "Geen"}</p>
      <p><strong>Status:</strong> {selectedEvent.showAs === "free" ? "Vrij" : selectedEvent.showAs === "tentative" ? "Voorlopig" : selectedEvent.showAs === "oof" ? "Afwezig" : selectedEvent.showAs === "workingElsewhere" ? "Elders werkzaam" : "Bezet"}{selectedEvent.sensitivity === "private" ? " · Privé" : ""}</p>
      {!selectedEvent.isOrganizer && <p><strong>Jouw reactie:</strong> {selectedEvent.responseStatus?.response === "accepted" ? "Geaccepteerd" : selectedEvent.responseStatus?.response === "tentativelyAccepted" ? "Voorlopig geaccepteerd" : selectedEvent.responseStatus?.response === "declined" ? "Geweigerd" : "Nog niet gereageerd"}</p>}
      {selectedEvent.bodyPreview && <div><strong>Beschrijving:</strong><p>{selectedEvent.bodyPreview}</p></div>}
      {!selectedEvent.isOrganizer && <div className="toolbar"><button type="button" className="primary" onClick={() => respondToInvitation(selectedEvent, "accept")} disabled={working}>Accepteren</button><button type="button" className="secondary" onClick={() => respondToInvitation(selectedEvent, "tentativelyAccept")} disabled={working}>Voorlopig</button><button type="button" className="secondary" onClick={() => respondToInvitation(selectedEvent, "decline")} disabled={working}>Weigeren</button></div>}
      <div className="toolbar"><button type="button" className="primary" onClick={() => editAppointment(selectedEvent)}>Wijzigen</button><button type="button" className="secondary" onClick={() => moveByDays(selectedEvent, 1)} disabled={working}>+ 1 dag</button><button type="button" className="secondary" onClick={() => moveByDays(selectedEvent, 7)} disabled={working}>+ 1 week</button><button type="button" className="secondary" onClick={() => duplicateAppointment(selectedEvent)}>Dupliceren</button><button type="button" className="secondary" onClick={() => deleteAppointment(selectedEvent)} disabled={working}>Verwijderen</button>{(selectedEvent.onlineMeeting?.joinUrl || selectedEvent.onlineMeetingUrl) && <a className="secondary" href={selectedEvent.onlineMeeting?.joinUrl || selectedEvent.onlineMeetingUrl} target="_blank" rel="noreferrer">Deelnemen aan Teams-vergadering</a>}{selectedEvent.webLink && <a className="secondary" href={selectedEvent.webLink} target="_blank" rel="noreferrer">Openen in Outlook</a>}</div>
    </div>}
    {searchActive && <div className="panel stack">
      <div className="connectionRow"><div><p className="eyebrow">Zoekresultaten</p><h3>{events.length} afspraak{events.length === 1 ? "" : "afspraken"} gevonden voor “{calendarSearch.trim()}”</h3></div><button type="button" className="secondary" onClick={() => setCalendarSearch("")}>Zoeken sluiten</button></div>
      {!loading && events.length === 0 && <p>Geen afspraken gevonden. Probeer een andere naam, locatie of zoekterm.</p>}
      {events.map((event) => <article className="connectionRow" key={`search-${event.mailbox}-${event.id}`} style={{ borderLeft: `6px solid ${mailboxColor(event.mailbox)}`, paddingLeft: "12px" }}><div><p className="eyebrow">{event.mailbox}</p><h3>{event.subject || "(Geen onderwerp)"}</h3><p>{new Date(event.start?.dateTime).toLocaleDateString("nl-NL", { weekday: "long", day: "numeric", month: "long", year: "numeric" })} · {event.isAllDay ? "Hele dag" : `${new Date(event.start?.dateTime).toLocaleTimeString("nl-NL", { hour: "2-digit", minute: "2-digit" })} – ${new Date(event.end?.dateTime).toLocaleTimeString("nl-NL", { hour: "2-digit", minute: "2-digit" })}`}</p>{event.location?.displayName && <small>{event.location.displayName}</small>}</div><button type="button" className="primary" onClick={() => { setSelectedEvent(event); setEditor(null); }}>Openen</button></article>)}
    </div>}
    {!searchActive && (view === "day" || view === "week") && <div className="panel" style={{ overflow: "auto", padding: 0 }}>
      <div style={{ minWidth: view === "week" ? "980px" : "560px" }}>
        <div style={{ display: "grid", gridTemplateColumns: `72px repeat(${timelineDays.length}, minmax(0, 1fr))`, position: "sticky", top: 0, zIndex: 5, background: "#fff", borderBottom: "1px solid #d8e3ea" }}>
          <div style={{ padding: "12px 8px", color: "#6b7e8d", fontSize: "12px" }}>Tijd</div>
          {timelineDays.map((day) => {
            const allDayEvents = events.filter((event) => event.isAllDay && new Date(event.start?.dateTime).toDateString() === day.toDateString());
            return <div key={`header-${day.toISOString()}`} style={{ padding: "10px 8px", borderLeft: "1px solid #e4ebf0", minHeight: "66px" }}><strong>{day.toLocaleDateString("nl-NL", { weekday: "short", day: "numeric", month: "short" })}</strong>{allDayEvents.map((event) => <button type="button" key={`all-day-${event.mailbox}-${event.id}`} onClick={() => { setSelectedEvent(event); setEditor(null); }} style={{ display: "block", width: "100%", marginTop: "5px", padding: "4px 6px", border: 0, borderRadius: "5px", background: mailboxColor(event.mailbox), color: "#fff", textAlign: "left", fontSize: "11px" }}><strong>Hele dag</strong> {event.subject || "(Geen onderwerp)"}</button>)}</div>;
          })}
        </div>
        <div style={{ display: "grid", gridTemplateColumns: `72px repeat(${timelineDays.length}, minmax(0, 1fr))` }}>
          <div style={{ position: "relative", height: `${24 * calendarHourHeight}px`, background: "#f8fafb" }}>
            {calendarHours.map((hour) => <span key={hour} style={{ position: "absolute", top: `${hour * calendarHourHeight - 8}px`, right: "10px", color: "#607788", fontSize: "12px", fontWeight: 700 }}>{String(hour).padStart(2, "0")}:00</span>)}
          </div>
          {timelineDays.map((day) => {
            const timedEvents = events.filter((event) => !event.isAllDay && new Date(event.start?.dateTime).toDateString() === day.toDateString());
            return <div key={`timeline-${day.toISOString()}`} onDoubleClick={(mouseEvent) => { const bounds = mouseEvent.currentTarget.getBoundingClientRect(); const minutes = Math.max(0, Math.min(1439, Math.round(((mouseEvent.clientY - bounds.top) / calendarHourHeight) * 60 / 15) * 15)); const start = new Date(day); start.setHours(Math.floor(minutes / 60), minutes % 60, 0, 0); newAppointment(start); }} onDragOver={(dragEvent) => dragEvent.preventDefault()} onDrop={(dropEvent) => { dropEvent.preventDefault(); const eventId = dropEvent.dataTransfer.getData("text/calendar-event"); const dragged = events.find((item) => item.id === eventId); if (dragged) { const bounds = dropEvent.currentTarget.getBoundingClientRect(); const minutes = Math.max(0, Math.min(1439, Math.round(((dropEvent.clientY - bounds.top) / calendarHourHeight) * 60 / 15) * 15)); const target = new Date(day); target.setHours(Math.floor(minutes / 60), minutes % 60, 0, 0); moveAppointment(dragged, target, true); } }} style={{ position: "relative", height: `${24 * calendarHourHeight}px`, borderLeft: "1px solid #d8e3ea", backgroundImage: `repeating-linear-gradient(to bottom, transparent 0, transparent ${calendarHourHeight - 1}px, #dfe7ec ${calendarHourHeight - 1}px, #dfe7ec ${calendarHourHeight}px)` }}>
              {day.toDateString() === calendarClock.toDateString() && <div aria-label="Huidige tijd" style={{ position: "absolute", top: `${(calendarClock.getHours() + calendarClock.getMinutes() / 60) * calendarHourHeight}px`, left: 0, right: 0, height: "2px", background: "#e63946", zIndex: 4, pointerEvents: "none" }}><span style={{ position: "absolute", left: "-5px", top: "-4px", width: "9px", height: "9px", borderRadius: "50%", background: "#e63946" }} /></div>}
              {timedEvents.map((event) => {
                const startTime = new Date(event.start?.dateTime); const endTime = new Date(event.end?.dateTime);
                const top = (startTime.getHours() + startTime.getMinutes() / 60) * calendarHourHeight;
                const height = Math.max(28, ((endTime.getTime() - startTime.getTime()) / 3600000) * calendarHourHeight);
                return <button type="button" draggable={event.type !== "occurrence" && event.type !== "exception"} onDragStart={(dragEvent) => dragEvent.dataTransfer.setData("text/calendar-event", event.id)} onClick={() => { setSelectedEvent(event); setEditor(null); }} key={`timeline-event-${event.mailbox}-${event.id}`} title={`${event.subject || "(Geen onderwerp)"} · ${startTime.toLocaleTimeString("nl-NL", { hour: "2-digit", minute: "2-digit" })}–${endTime.toLocaleTimeString("nl-NL", { hour: "2-digit", minute: "2-digit" })}`} style={{ position: "absolute", top: `${top}px`, left: "4px", right: "4px", height: `${height}px`, minHeight: "28px", overflow: "hidden", padding: "4px 6px", border: "1px solid rgba(255,255,255,.75)", borderRadius: "6px", background: mailboxColor(event.mailbox), color: "#fff", textAlign: "left", fontSize: "11px", zIndex: 2, cursor: "pointer" }}><strong>{startTime.toLocaleTimeString("nl-NL", { hour: "2-digit", minute: "2-digit" })}–{endTime.toLocaleTimeString("nl-NL", { hour: "2-digit", minute: "2-digit" })}</strong><span style={{ display: "block" }}>{event.subject || "(Geen onderwerp)"}</span></button>;
              })}
            </div>;
          })}
        </div>
      </div>
    </div>}
    {!searchActive && view === "month" && <div style={{ display: "grid", gridTemplateColumns: "repeat(7, minmax(0, 1fr))", gap: "8px" }}>
      {days.map((day) => {
        const dayEvents = events.filter((event) => new Date(event.start?.dateTime).toDateString() === day.toDateString());
        return <div className="panel" key={day.toISOString()} onDoubleClick={() => newAppointment(day)} onDragOver={(dragEvent) => dragEvent.preventDefault()} onDrop={(dropEvent) => { dropEvent.preventDefault(); const eventId = dropEvent.dataTransfer.getData("text/calendar-event"); const dragged = events.find((item) => item.id === eventId); if (dragged) moveAppointment(dragged, day); }} style={{ minHeight: "150px", padding: "10px", opacity: day.getMonth() !== anchor.getMonth() ? 0.55 : 1 }}><strong>{day.toLocaleDateString("nl-NL", { weekday: "short", day: "numeric" })}</strong><div className="stack">{dayEvents.map((event) => <button type="button" draggable={event.type !== "occurrence" && event.type !== "exception"} onDragStart={(dragEvent) => dragEvent.dataTransfer.setData("text/calendar-event", event.id)} title="Sleep naar een andere dag om te verplaatsen" onClick={() => { setSelectedEvent(event); setEditor(null); }} key={`${event.mailbox}-${event.id}`} style={{ display: "block", width: "100%", padding: "6px", background: mailboxColor(event.mailbox), border: 0, borderRadius: "6px", fontSize: "12px", textAlign: "left", cursor: "pointer", color: "#fff" }}><strong>{event.isAllDay ? "Hele dag" : `${new Date(event.start?.dateTime).toLocaleTimeString("nl-NL", { hour: "2-digit", minute: "2-digit" })}–${new Date(event.end?.dateTime).toLocaleTimeString("nl-NL", { hour: "2-digit", minute: "2-digit" })}`}</strong><span style={{ display: "block", marginTop: "2px" }}>{event.subject || "(Geen onderwerp)"}</span></button>)}</div></div>;
      })}
    </div>}
    {!searchActive && view === "year" && <div style={{ display: "grid", gridTemplateColumns: "repeat(3, minmax(0, 1fr))", gap: "16px" }}>
      {Array.from({ length: 12 }, (_, month) => {
        const monthEvents = events.filter((event) => new Date(event.start?.dateTime).getMonth() === month);
        return <div className="panel" key={month}><h3>{new Date(anchor.getFullYear(), month, 1).toLocaleDateString("nl-NL", { month: "long" })}</h3><p>{monthEvents.length} afspraak/afspraken</p>{monthEvents.slice(0, 4).map((event) => <button type="button" className="textButton" style={{ borderLeft: `5px solid ${mailboxColor(event.mailbox)}`, paddingLeft: "8px" }} onClick={() => { setSelectedEvent(event); setEditor(null); }} key={`${event.mailbox}-${event.id}`}><strong>{new Date(event.start?.dateTime).getDate()} · {event.isAllDay ? "Hele dag" : new Date(event.start?.dateTime).toLocaleTimeString("nl-NL", { hour: "2-digit", minute: "2-digit" })}</strong> {event.subject || "(Geen onderwerp)"}</button>)}</div>;
      })}
    </div>}
  </section>;
}

function MailAgenda({ workspaceId, session }) {
  const [mailboxes, setMailboxes] = useState([]);
  const [selectedMailbox, setSelectedMailbox] = useState("all");
  const [selectedFolder, setSelectedFolder] = useState("inbox");
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState("");
  const [connectionNotice, setConnectionNotice] = useState("");
  const [connecting, setConnecting] = useState("");
  const [replying, setReplying] = useState({});
  const [compose, setCompose] = useState({ open: false, mailbox: "", to: "", subject: "", content: "" });
  const [working, setWorking] = useState("");

  async function connectMicrosoft(mailbox) {
    setConnecting(mailbox); setMessage("");
    try {
      const response = await fetch("/api/integrations/microsoft", { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${session.access_token}` }, body: JSON.stringify({ workspaceId, mailbox }) });
      const result = await response.json();
      if (!response.ok || !result.authorizationUrl) throw new Error(result.error || "Microsoft 365 kon niet worden gestart.");
      window.location.assign(result.authorizationUrl);
    } catch (error) { setMessage(error.message); setConnecting(""); }
  }

  const loadMail = useCallback(async (mailbox = selectedMailbox, folderId = selectedFolder) => {
    if (!workspaceId || !session?.access_token) return;
    setLoading(true); setMessage("");
    try {
      const params = new URLSearchParams({ workspaceId });
      if (mailbox !== "all") { params.set("mailbox", mailbox); params.set("folderId", folderId); }
      const response = await fetch(`/api/integrations/microsoft/messages?${params}`, { headers: { Authorization: `Bearer ${session.access_token}` }, cache: "no-store" });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "De mailboxen konden niet worden geladen.");
      if (mailbox === "all") setMailboxes(result.mailboxes || []);
      else setMailboxes((current) => current.map((item) => item.mailbox === mailbox ? result.mailboxes?.[0] || item : item));
    } catch (error) { setMessage(error.message); }
    finally { setLoading(false); }
  }, [selectedFolder, selectedMailbox, session?.access_token, workspaceId]);

  async function mailAction(mailbox, payload, confirmation) {
    if (confirmation && !window.confirm(confirmation)) return;
    setWorking(payload.messageId || payload.action); setMessage("");
    try {
      const response = await fetch("/api/integrations/microsoft/messages/action", { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${session.access_token}` }, body: JSON.stringify({ workspaceId, mailbox, ...payload }) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "De actie kon niet worden uitgevoerd.");
      setConnectionNotice(result.message || "Actie uitgevoerd.");
      setReplying((current) => ({ ...current, [payload.messageId]: "" }));
      if (payload.action === "send") setCompose({ open: false, mailbox: "", to: "", subject: "", content: "" });
      await loadMail();
    } catch (error) { setMessage(error.message); }
    finally { setWorking(""); }
  }

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get("microsoft") === "connected") setConnectionNotice(`${params.get("account") || "De mailbox"} is succesvol gekoppeld.`);
    if (params.get("microsoft") === "error") setMessage(params.get("message") || "De mailbox kon niet worden gekoppeld.");
    if (params.has("microsoft")) window.history.replaceState({}, "", window.location.pathname);
  }, []);
  useEffect(() => { loadMail("all", "inbox"); }, [workspaceId, session?.access_token]);

  const connected = mailboxes.filter((item) => item.connected);
  const activeBox = mailboxes.find((item) => item.mailbox === selectedMailbox);
  const visible = selectedMailbox === "all"
    ? mailboxes.flatMap((item) => item.messages.map((mail) => ({ ...mail, mailbox: item.mailbox }))).sort((a, b) => new Date(b.receivedDateTime) - new Date(a.receivedDateTime))
    : (activeBox?.messages || []).map((mail) => ({ ...mail, mailbox: selectedMailbox }));

  function chooseMailbox(value) {
    setSelectedMailbox(value); setSelectedFolder("inbox");
    loadMail(value, "inbox");
  }

  return <section className="stack">
    <div className="section-heading">
      <div><p className="eyebrow">CEO-communicatie</p><h2>Mail</h2><p>Beheer iedere mailbox afzonderlijk vanuit Horeca OS.</p></div>
      <div className="toolbar"><button type="button" className="primary" disabled={!connected.length} onClick={() => setCompose({ open: true, mailbox: connected[0]?.mailbox || "", to: "", subject: "", content: "" })}>Nieuwe e-mail</button><button type="button" className="secondary" onClick={() => loadMail()} disabled={loading}>{loading ? "Laden…" : "Mail verversen"}</button></div>
    </div>
    {connectionNotice && <div className="notice successNotice">{connectionNotice}</div>}
    {message && <div className="notice warning">{message}</div>}
    <div className="panel stack">
      <h3>Mailboxen</h3>
      {mailboxes.map((item) => <div className="connectionRow" key={item.mailbox}><div><strong>{item.mailbox}</strong><small>{item.connected ? "Ingelogd bij Microsoft" : "Nog niet gekoppeld"}</small></div><div className="toolbar">{item.connected && <span className="status connected">Ingelogd</span>}<button type="button" className={item.connected ? "secondary" : "primary"} onClick={() => connectMicrosoft(item.mailbox)} disabled={Boolean(connecting)}>{connecting === item.mailbox ? "Microsoft openen…" : item.connected ? "Mailrechten vernieuwen" : "Inloggen"}</button></div></div>)}
    </div>
    {compose.open && <div className="panel stack"><h3>Nieuwe e-mail</h3><label>Van<select value={compose.mailbox} onChange={(event) => setCompose({ ...compose, mailbox: event.target.value })}>{connected.map((item) => <option key={item.mailbox}>{item.mailbox}</option>)}</select></label><label>Aan<input value={compose.to} onChange={(event) => setCompose({ ...compose, to: event.target.value })} placeholder="naam@bedrijf.nl" /></label><label>Onderwerp<input value={compose.subject} onChange={(event) => setCompose({ ...compose, subject: event.target.value })} /></label><label>Bericht<textarea value={compose.content} onChange={(event) => setCompose({ ...compose, content: event.target.value })} /></label><div className="toolbar"><button className="primary" type="button" disabled={Boolean(working)} onClick={() => mailAction(compose.mailbox, { action: "send", to: compose.to, subject: compose.subject, content: compose.content }, `E-mail naar ${compose.to} verzenden?`)}>Verzenden</button><button className="secondary" type="button" onClick={() => setCompose({ ...compose, open: false })}>Annuleren</button></div></div>}
    <div className="panel stack">
      <div className="toolbar">
        <label>Mailbox<select value={selectedMailbox} onChange={(event) => chooseMailbox(event.target.value)}><option value="all">Alle mailboxen</option>{mailboxes.map((item) => <option key={item.mailbox} value={item.mailbox}>{item.mailbox}</option>)}</select></label>
        {selectedMailbox !== "all" && <label>Map<select value={selectedFolder} onChange={(event) => { setSelectedFolder(event.target.value); loadMail(selectedMailbox, event.target.value); }}><option value="all">Alle e-mail</option>{(activeBox?.folders || []).map((folder) => <option key={folder.id} value={folder.id}>{folder.displayName} ({folder.unreadItemCount || 0} ongelezen)</option>)}</select></label>}
      </div>
      {!loading && visible.length === 0 && <p>Nog geen e-mails gevonden.</p>}
      {visible.map((mail) => <article className="panel stack" key={`${mail.mailbox}-${mail.id}`}>
        <div className="connectionRow"><div><p className="eyebrow">{mail.mailbox} {!mail.isRead && <span className="status">Nieuw</span>}</p><h3>{mail.subject || "(Geen onderwerp)"}</h3><p><strong>{mail.from?.emailAddress?.name || mail.from?.emailAddress?.address || "Onbekende afzender"}</strong>{mail.from?.emailAddress?.address ? ` · ${mail.from.emailAddress.address}` : ""}</p><small>{new Date(mail.receivedDateTime).toLocaleString("nl-NL")}</small></div>{mail.webLink && <a className="secondary" href={mail.webLink} target="_blank" rel="noreferrer">Volledig openen</a>}</div>
        {mail.bodyPreview && <p>{mail.bodyPreview}</p>}
        <div className="toolbar"><button type="button" className="secondary" onClick={() => setReplying((current) => ({ ...current, [mail.id]: current[mail.id] ?? "" }))}>Beantwoorden</button><button type="button" className="secondary" onClick={() => mailAction(mail.mailbox, { action: "read", messageId: mail.id, isRead: !mail.isRead })}>{mail.isRead ? "Ongelezen" : "Gelezen"}</button>{selectedMailbox !== "all" && <select defaultValue="" onChange={(event) => event.target.value && mailAction(mail.mailbox, { action: "move", messageId: mail.id, folderId: event.target.value }, "Deze e-mail verplaatsen?")}><option value="">Verplaatsen naar…</option>{(activeBox?.folders || []).map((folder) => <option key={folder.id} value={folder.id}>{folder.displayName}</option>)}</select>}<button type="button" className="secondary" onClick={() => mailAction(mail.mailbox, { action: "delete", messageId: mail.id }, "Deze e-mail verwijderen?")}>Verwijderen</button></div>
        {Object.prototype.hasOwnProperty.call(replying, mail.id) && <div className="stack"><textarea placeholder="Schrijf je antwoord" value={replying[mail.id]} onChange={(event) => setReplying({ ...replying, [mail.id]: event.target.value })} /><button type="button" className="primary" disabled={!replying[mail.id]?.trim() || Boolean(working)} onClick={() => mailAction(mail.mailbox, { action: "reply", messageId: mail.id, comment: replying[mail.id] }, "Dit antwoord nu verzenden?")}>Antwoord verzenden</button></div>}
      </article>)}
    </div>
  </section>;
}

function SocialInbox({ workspaceId, businessId, businesses, canManage, session }) {
  const [items, setItems] = useState([]);
  const [accounts, setAccounts] = useState({});
  const [channelFilter, setChannelFilter] = useState("all");
  const [typeFilter, setTypeFilter] = useState("all");
  const [workflowFilter, setWorkflowFilter] = useState("all");
  const [pageSize, setPageSize] = useState(10);
  const [page, setPage] = useState(1);
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(false);
  const [syncing, setSyncing] = useState(false);

  const loadSocialItems = useCallback(async () => {
    setLoading(true); setMessage("");
    let query = supabase.from("social_content_items")
      .select("id,business_id,account_id,content_type,direction,status,workflow_status,handled_at,body,media,permalink,published_at,created_at")
      .eq("workspace_id", workspaceId)
      .in("content_type", ["post", "comment", "message"])
      .order("published_at", { ascending: false, nullsFirst: false })
      .limit(1000);
    if (businessId !== "all") query = query.eq("business_id", businessId);
    const { data: rows, error } = await query;
    if (error) { setMessage(`Social-inbox kon niet worden geladen: ${error.message}`); setLoading(false); return; }
    const accountIds = [...new Set((rows || []).map((item) => item.account_id).filter(Boolean))];
    let accountMap = {};
    if (accountIds.length) {
      const { data: accountRows } = await supabase.from("integration_accounts")
        .select("id,provider,display_name").eq("workspace_id", workspaceId).in("id", accountIds);
      accountMap = Object.fromEntries((accountRows || []).map((account) => [account.id, account]));
    }
    setAccounts(accountMap); setItems(rows || []); setLoading(false);
  }, [businessId, workspaceId]);

  async function syncSocialItems() {
    if (syncing) return;
    const targetIds = businessId === "all" ? businesses.map((business) => business.id) : [businessId];
    if (!targetIds.length) { setMessage("Geen vestiging beschikbaar om te synchroniseren."); return; }
    setSyncing(true); setMessage("");
    const headers = { "content-type": "application/json", authorization: `Bearer ${session?.access_token || ""}` };
    const attempts = await Promise.all(targetIds.flatMap((targetBusinessId) => [
      fetch("/api/integrations/meta/sync", {
        method: "POST", headers,
        body: JSON.stringify({ workspaceId, businessId: targetBusinessId }),
      }).then(async (response) => ({ provider: "Instagram", businessId: targetBusinessId, response, result: await response.json().catch(() => ({})) })),
      fetch("/api/integrations/facebook/sync", {
        method: "POST", headers,
        body: JSON.stringify({ workspaceId, businessId: targetBusinessId }),
      }).then(async (response) => ({ provider: "Facebook", businessId: targetBusinessId, response, result: await response.json().catch(() => ({})) })),
    ]));
    const failures = attempts.filter((attempt) => !attempt.response.ok);
    const successes = attempts.filter((attempt) => attempt.response.ok);
    await loadSocialItems();
    if (failures.length) {
      const detail = failures.map((attempt) => `${attempt.provider}: ${attempt.result.error || "synchronisatie mislukt"}`).join(" · ");
      setMessage(`${successes.length} koppeling(en) bijgewerkt. ${detail}`);
    } else {
      setMessage(`Facebook en Instagram zijn bijgewerkt voor ${targetIds.length} vestiging${targetIds.length === 1 ? "" : "en"}. WhatsApp komt realtime binnen.`);
    }
    setSyncing(false);
  }

  async function updateWorkflowStatus(itemId, workflowStatus) {
    const handled = workflowStatus === "handled";
    const { error } = await supabase.from("social_content_items").update({
      workflow_status: workflowStatus,
      handled_at: handled ? new Date().toISOString() : null,
      handled_by: handled ? session?.user?.id || null : null,
    }).eq("id", itemId).eq("workspace_id", workspaceId);
    if (error) { setMessage(`Werkstatus kon niet worden opgeslagen: ${error.message}`); return false; }
    setItems((current) => current.map((item) => item.id === itemId ? { ...item, workflow_status: workflowStatus, handled_at: handled ? new Date().toISOString() : null } : item));
    setMessage(workflowStatus === "handled" ? "Item is afgehandeld." : workflowStatus === "in_progress" ? "Item staat in behandeling." : "Item is opnieuw als nieuw gemarkeerd.");
    return true;
  }

  useEffect(() => { loadSocialItems(); }, [loadSocialItems]);
  useEffect(() => { setPage(1); }, [businessId, channelFilter, typeFilter, workflowFilter, pageSize]);

  const businessNames = Object.fromEntries(businesses.map((business) => [business.id, business.name]));
  const channelName = (item) => accounts[item.account_id]?.provider === "whatsapp" ? "WhatsApp" : String(item.permalink || "").includes("instagram.com") || ["instagram", "meta"].includes(accounts[item.account_id]?.provider) ? "Instagram" : String(item.permalink || "").includes("facebook.com") || accounts[item.account_id]?.provider === "facebook" ? "Facebook" : accounts[item.account_id]?.display_name || "Sociaal";
  const filtered = items.filter((item) => (channelFilter === "all" || channelName(item) === channelFilter) && (typeFilter === "all" || item.content_type === typeFilter) && (workflowFilter === "all" || (item.workflow_status || "new") === workflowFilter));
  const pageCount = Math.max(1, Math.ceil(filtered.length / pageSize));
  const currentPage = Math.min(page, pageCount);
  const visible = filtered.slice((currentPage - 1) * pageSize, currentPage * pageSize);
  const inbound = items.filter((item) => item.direction === "inbound").length;
  const openItems = items.filter((item) => item.direction === "inbound" && (item.workflow_status || "new") !== "handled").length;

  return <section className="socialInbox">
    <div className="socialInboxHeader"><div><p className="eyebrow">Sociale kanalen</p><h2>Berichten & reacties</h2><p>WhatsApp, Facebook en Instagram centraal, met behoud van de scheiding per vestiging.</p></div><div className="socialInboxFilters">
      <label>Kanaal<select value={channelFilter} onChange={(event) => setChannelFilter(event.target.value)}><option value="all">Alle kanalen</option><option value="WhatsApp">WhatsApp</option><option value="Facebook">Facebook</option><option value="Instagram">Instagram</option></select></label>
      <label>Soort<select value={typeFilter} onChange={(event) => setTypeFilter(event.target.value)}><option value="all">Alles</option><option value="message">Privéberichten</option><option value="comment">Reacties</option><option value="post">Berichten</option></select></label>
      <label>Werkstatus<select value={workflowFilter} onChange={(event) => setWorkflowFilter(event.target.value)}><option value="all">Alle statussen</option><option value="new">Nieuw</option><option value="in_progress">In behandeling</option><option value="handled">Afgehandeld</option></select></label>
      <label>Zichtbaar<select value={pageSize} onChange={(event) => setPageSize(Number(event.target.value))}>{[10,25,100].map((amount) => <option value={amount} key={amount}>{amount}</option>)}</select></label>
      <button type="button" className="secondaryButton" onClick={syncSocialItems} disabled={loading || syncing}>{syncing ? "Synchroniseren…" : loading ? "Ophalen…" : "Kanalen verversen"}</button>
    </div></div>
    {message && <div className="notice">{message}</div>}
    <div className="socialInboxSummary"><strong>{items.length}</strong> items <span>·</span><strong>{inbound}</strong> reacties van gasten <span>·</span><strong>{openItems}</strong> open <span>·</span><strong>{new Set(items.map((item) => item.business_id)).size}</strong> vestigingen</div>
    <div className="socialInboxList">
      {!loading && visible.length === 0 && <Empty text="Nog geen sociale berichten of reacties voor deze selectie." />}
      {visible.map((item) => {
        const media = Array.isArray(item.media) ? item.media[0] || {} : {};
        const author = media.sender_name || (item.direction === "outbound" ? accounts[item.account_id]?.display_name : "Gast");
        return <article className={`socialInboxItem ${item.direction}`} key={item.id}>
          <header><div><span className={`channelBadge ${channelName(item).toLowerCase()}`}>{channelName(item)}</span><b>{author}</b></div><span className="status">{item.workflow_status === "handled" ? "Afgehandeld" : item.workflow_status === "in_progress" ? "In behandeling" : "Nieuw"}</span></header>
          <small>{businessNames[item.business_id] || "Onbekende vestiging"} · {formatDate(item.published_at || item.created_at)}</small>
          <p>{item.body || "Geen tekst meegeleverd."}</p>
          <div className="socialInboxActions">{item.permalink && <a className="secondaryButton" href={item.permalink} target="_blank" rel="noreferrer">Openen op {channelName(item)}</a>}
            {canManage && ["comment", "message"].includes(item.content_type) && <SocialReply item={item} channel={channelName(item)} workspaceId={workspaceId} session={session} onPublished={async () => { const marked = await updateWorkflowStatus(item.id, "handled"); if (marked) await loadSocialItems(); }} />}
            {canManage && item.direction === "inbound" && <select aria-label={`Werkstatus voor ${author}`} value={item.workflow_status || "new"} onChange={(event) => updateWorkflowStatus(item.id, event.target.value)}><option value="new">Nieuw</option><option value="in_progress">In behandeling</option><option value="handled">Afgehandeld</option></select>}
          </div>
        </article>;
      })}
    </div>
    {filtered.length > pageSize && <nav className="reviewPagination" aria-label="Social-inbox pagina's"><button type="button" className="secondaryButton" disabled={currentPage === 1} onClick={() => setPage((value) => Math.max(1, value - 1))}>Vorige</button><span>Pagina {currentPage} van {pageCount} · {filtered.length} items</span><button type="button" className="secondaryButton" disabled={currentPage === pageCount} onClick={() => setPage((value) => Math.min(pageCount, value + 1))}>Volgende</button></nav>}
  </section>;
}

function ReviewsInbox({ workspaceId, businessId, businesses, session, canManage, canAdd }) {
  const [reviews, setReviews] = useState([]); const [reviewMessage, setReviewMessage] = useState(""); const [statusFilter, setStatusFilter] = useState("all"); const [reviewPageSize, setReviewPageSize] = useState(2); const [reviewPage, setReviewPage] = useState(1); const [publishingReviewId, setPublishingReviewId] = useState("");
  const loadReviews = useCallback(async () => { const pageSize = 1000; const allRows = []; for (let from = 0; ; from += pageSize) { let query = supabase.from("customer_reviews").select("*").eq("workspace_id", workspaceId).order("reviewed_at", { ascending: false }).range(from, from + pageSize - 1); if (businessId !== "all") query = query.eq("business_id", businessId); const { data: rows, error } = await query; if (error) { setReviewMessage(`Reviews konden niet worden geladen: ${error.message}`); return; } allRows.push(...(rows || [])); if (!rows || rows.length < pageSize) break; } setReviews(allRows); }, [businessId, workspaceId]);
  useEffect(() => { loadReviews(); }, [loadReviews]);
  useEffect(() => { setReviewPage(1); }, [businessId, statusFilter]);
  async function addReview(event) { event.preventDefault(); const form = new FormData(event.currentTarget); const sourceRating = String(form.get("rating")); const { error } = await supabase.from("customer_reviews").insert({ workspace_id: workspaceId, business_id: String(form.get("businessId")), source: String(form.get("source")), reviewer_name: String(form.get("reviewer") || "").trim() || null, rating: Number(sourceRating), title: String(form.get("title") || "").trim() || null, review_text: String(form.get("text") || "").trim(), reviewed_at: new Date().toISOString() }); setReviewMessage(error ? `Review niet opgeslagen: ${error.message}` : "Review toegevoegd aan de inbox."); if (!error) { event.currentTarget.reset(); loadReviews(); } }
  async function publishReview(event, id) { event.preventDefault(); const form = new FormData(event.currentTarget); const responseText = String(form.get("response") || "").trim(); if (!responseText) { setReviewMessage("Schrijf eerst een reactie."); return; } setPublishingReviewId(id); setReviewMessage(""); const response = await fetch(`/api/reviews/${id}/reply`, { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${session.access_token}` }, body: JSON.stringify({ workspaceId, responseText }) }); const result = await response.json().catch(() => ({})); setReviewMessage(response.ok ? "De reactie is door het reviewplatform bevestigd en geplaatst." : result.error || "De reactie kon niet worden geplaatst."); setPublishingReviewId(""); if (response.ok) loadReviews(); }
  async function uploadReviews(event) {
    event.preventDefault(); const form = new FormData(event.currentTarget); const file = form.get("file");
    if (!(file instanceof File) || !file.size) { setReviewMessage("Kies eerst een CSV-bestand."); return; }
    if (file.size > 2 * 1024 * 1024) { setReviewMessage("Het bestand mag maximaal 2 MB zijn."); return; }
    const rows = parseReviewCsv(await file.text());
    if (!rows.length) { setReviewMessage("Geen geldige reviews gevonden. Gebruik kolommen: score, review, naam, datum, titel."); return; }
    const business = String(form.get("businessId")); const source = String(form.get("source"));
    const payload = rows.slice(0, 500).map((row) => ({ workspace_id: workspaceId, business_id: business, source, reviewer_name: row.name || null, rating: row.rating, title: row.title || null, review_text: row.text, reviewed_at: reviewDateIso(row.date) }));
    const { error } = await supabase.from("customer_reviews").insert(payload);
    setReviewMessage(error ? `Upload niet verwerkt: ${error.message}` : `${payload.length} reviews succesvol geÃƒÂ¯mporteerd.`); if (!error) { event.currentTarget.reset(); loadReviews(); }
  }
  const filteredReviews = statusFilter === "all" ? reviews : reviews.filter((review) => review.status === statusFilter); const pageCount = Math.max(1, Math.ceil(filteredReviews.length / reviewPageSize)); const currentPage = Math.min(reviewPage, pageCount); const visibleReviews = filteredReviews.slice((currentPage - 1) * reviewPageSize, currentPage * reviewPageSize); const ratedReviews = reviews.filter((item) => Number.isFinite(Number(item.rating)) && Number(item.rating) >= 1); const average = ratedReviews.length ? ratedReviews.reduce((sum, item) => sum + Number(item.rating), 0) / ratedReviews.length : 0; const positive = ratedReviews.filter((item) => item.rating >= 4).length; const open = reviews.filter((item) => item.status === "new" || item.status === "in_progress").length; const negative = ratedReviews.filter((item) => item.rating <= 2).length; const withoutRating = reviews.length - ratedReviews.length;
  return <><section className="pageIntro reviewIntro"><div><p className="eyebrow">Reputatiemanagement</p><h2>Reviews</h2><p>Alle gastreacties centraal beoordelen, opvolgen en beantwoorden.</p></div><div className="reviewFilters"><label>Status<select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)}><option value="all">Alle reviews</option><option value="new">Nieuw</option><option value="in_progress">In behandeling</option><option value="responded">Beantwoord</option><option value="archived">Gearchiveerd</option></select></label><label>Zichtbaar<select value={reviewPageSize} onChange={(event) => { setReviewPageSize(Number(event.target.value)); setReviewPage(1); }}>{[2,10,25,100].map((amount) => <option value={amount} key={amount}>{amount} reviews</option>)}</select></label></div></section>{reviewMessage && <div className="notice">{reviewMessage}</div>}<section className="kpis secondary"><Card label="Totaal reviews" value={reviews.length} sub={`${ratedReviews.length} met cijfer Ã‚Â· ${withoutRating} zonder cijfer`} /><Card label="Gemiddelde score" value={average ? average.toFixed(2) : "Ã¢â‚¬â€œ"} sub={`Gebaseerd op ${ratedReviews.length} broncijfers`} /><Card label="Goede reviews" value={positive} sub="4 of 5 sterren" tone="success" /><Card label="Kritieke reviews" value={negative} sub="1 of 2 sterren" tone={negative ? "danger" : "success"} /><Card label="Op te volgen" value={open} sub="Nieuw of in behandeling" tone={open ? "warning" : "success"} /><Card label="Beantwoord" value={reviews.filter((item) => item.status === "responded").length} sub="Afgeronde reacties" /></section><section className="reviewLayout"><Panel title="Review-inbox" subtitle="Nieuwste reacties bovenaan">{filteredReviews.length === 0 && <Empty text="Nog geen reviews gevonden." />}{visibleReviews.map((review) => { const hasRating = Number.isFinite(Number(review.rating)) && Number(review.rating) >= 1; return <article className={`reviewCard ${hasRating ? `rating${review.rating}` : "ratingUnknown"}`} key={review.id}><header><div><strong>{hasRating ? `${"\u2605".repeat(review.rating)}${"\u2606".repeat(5-review.rating)}` : "Geen cijfer aangeleverd"}</strong><b>{review.reviewer_name || "Anonieme gast"}</b></div><span className="status">{reviewStatusLabel(review.status)}</span></header><small>{review.source} Ã‚Â· {formatDate(review.reviewed_at)}</small>{review.title && <h3>{review.title}</h3>}<p>{review.review_text}</p>{canManage && <details className="reviewReply"><summary>Reageren</summary><form onSubmit={(event) => publishReview(event, review.id)}><textarea name="response" defaultValue={review.response_text || ""} placeholder="Schrijf je reactie aan de gast" required /><button className="primary" disabled={publishingReviewId === review.id}>{publishingReviewId === review.id ? "PlaatsenÃ¢â‚¬Â¦" : "Reactie plaatsen"}</button><small>De status verandert pas naar beantwoord nadat het reviewplatform de plaatsing bevestigt.</small></form></details>}</article>; })}{filteredReviews.length > reviewPageSize && <nav className="reviewPagination" aria-label="Reviewpagina's"><button type="button" className="secondaryButton" disabled={currentPage === 1} onClick={() => setReviewPage((page) => Math.max(1, page - 1))}>Vorige</button><span>Pagina {currentPage} van {pageCount} Ã‚Â· {filteredReviews.length} reviews</span><button type="button" className="secondaryButton" disabled={currentPage === pageCount} onClick={() => setReviewPage((page) => Math.min(pageCount, page + 1))}>Volgende</button></nav>}</Panel>{canAdd && <Panel title="Reviews uploaden" subtitle="Importeer maximaal 500 reviews uit een CSV-bestand"><form className="reviewForm uploadReviews" onSubmit={uploadReviews}><label>Vestiging<select name="businessId" required defaultValue={businessId === "all" ? businesses[0]?.id : businessId}>{businesses.map((business) => <option value={business.id} key={business.id}>{business.name}</option>)}</select></label><label>Bron<select name="source" defaultValue="Google"><option>Google</option><option>Robuust</option><option>Tripadvisor</option><option>Facebook</option><option>Overig</option></select></label><label>CSV-bestand<input name="file" type="file" accept=".csv,text/csv" required /></label><small>Kolommen: score, review, naam, datum en titel. Score en review zijn verplicht.</small><button className="primary">Reviews uploaden</button></form></Panel>}{canAdd && <Panel title="Review toevoegen" subtitle="Handmatig, totdat bronnen automatisch gekoppeld zijn"><form className="reviewForm" onSubmit={addReview}><label>Vestiging<select name="businessId" required defaultValue={businessId === "all" ? businesses[0]?.id : businessId}>{businesses.map((business) => <option value={business.id} key={business.id}>{business.name}</option>)}</select></label><label>Bron<select name="source" defaultValue="Google"><option>Google</option><option>Robuust</option><option>Tripadvisor</option><option>Facebook</option><option>Overig</option></select></label><label>Gast<input name="reviewer" /></label><label>Score<select name="rating" defaultValue="5">{[5,4,3,2,1].map((score) => <option value={score} key={score}>{score} sterren</option>)}</select></label><label>Titel<input name="title" /></label><label>Review<textarea name="text" required /></label><button className="primary">Review toevoegen</button></form></Panel>}</section></>;
}

function reviewStatusLabel(status) { return ({ new: "Nieuw", in_progress: "In behandeling", responded: "Beantwoord", archived: "Gearchiveerd" })[status] || status; }
function reviewDateIso(value) { const parsed = value ? new Date(value) : new Date(); return Number.isNaN(parsed.getTime()) ? new Date().toISOString() : parsed.toISOString(); }
function parseReviewCsv(text) { const lines = String(text || "").replace(/^\uFEFF/, "").split(/\r?\n/).filter((line) => line.trim()); if (lines.length < 2) return []; const delimiter = lines[0].includes(";") ? ";" : ","; const parse = (line) => { const cells = []; let value = "", quoted = false; for (let i = 0; i < line.length; i += 1) { const char = line[i]; if (char === '"' && line[i + 1] === '"') { value += '"'; i += 1; } else if (char === '"') quoted = !quoted; else if (char === delimiter && !quoted) { cells.push(value.trim()); value = ""; } else value += char; } cells.push(value.trim()); return cells; }; const headers = parse(lines[0]).map((item) => item.toLowerCase()); const find = (...names) => headers.findIndex((header) => names.includes(header)); const ratingIndex = find("score", "rating", "sterren"); const textIndex = find("review", "tekst", "reviewtekst", "comment"); const nameIndex = find("naam", "name", "reviewer", "gast"); const dateIndex = find("datum", "date", "reviewed_at"); const titleIndex = find("titel", "title"); if (ratingIndex < 0 || textIndex < 0) return []; return lines.slice(1).map(parse).map((cells) => ({ rating: Math.min(5, Math.max(1, Number(cells[ratingIndex]))), text: cells[textIndex]?.trim(), name: nameIndex >= 0 ? cells[nameIndex]?.trim() : "", date: dateIndex >= 0 ? cells[dateIndex]?.trim() : "", title: titleIndex >= 0 ? cells[titleIndex]?.trim() : "" })).filter((row) => Number.isFinite(row.rating) && row.text); }

function FoodcostDashboard({ analytics }) {
  return <>
    <section className="pageIntro"><p className="eyebrow">Foodcost dashboard</p><h2>Marge en prijsbewaking</h2><p>Actuele berekening uit inkoopprijzen, recepturen en verkoopprijzen.</p></section>
    <section className="kpis">
      <Card label="Gemiddelde foodcost" value={analytics.average == null ? "ÃƒÂ¢Ã¢â€šÂ¬Ã¢â‚¬Â" : `${analytics.average.toFixed(1)}%`} sub={`${analytics.items.length} verkoopbare gerechten`} />
      <Card label="Beste marge" value={analytics.best?.name || "ÃƒÂ¢Ã¢â€šÂ¬Ã¢â‚¬Â"} sub={analytics.best ? `${analytics.best.foodcost.toFixed(1)}% foodcost` : "Nog geen complete kostprijs"} tone="success" />
      <Card label="Hoogste foodcost" value={analytics.worst?.name || "ÃƒÂ¢Ã¢â€šÂ¬Ã¢â‚¬Â"} sub={analytics.worst ? `${analytics.worst.foodcost.toFixed(1)}% foodcost` : "Nog geen complete kostprijs"} tone={analytics.worst?.foodcost > 40 ? "danger" : "normal"} />
      <Card label="Prijswaarschuwingen" value={analytics.warnings.length} sub="Gerechten boven doel of 40%" tone={analytics.warnings.length ? "warning" : "success"} />
    </section>
    <section className="panel"><div className="panelHead"><h2>Gerechten</h2><p>Foodcost is exclusief btw-effecten en volgt de actuele productprijs.</p></div>
      <div className="tableWrap"><table><thead><tr><th>Gerecht</th><th>Kostprijs</th><th>Verkoopprijs</th><th>Foodcost</th><th>Doel</th><th>Status</th></tr></thead><tbody>
        {analytics.items.map((item) => <tr key={item.id}><td><b>{item.name}</b></td><td>{money(item.cost)}</td><td>{money(item.sellingPrice)}</td><td>{item.foodcost.toFixed(1)}%</td><td>{item.target ? `${item.target}%` : "ÃƒÂ¢Ã¢â€šÂ¬Ã¢â‚¬Â"}</td><td><span className={`status ${item.warning ? "pending" : "connected"}`}>{item.warning ? "Controleren" : "Op koers"}</span></td></tr>)}
      </tbody></table></div>{!analytics.items.length && <Empty text="Voeg producten, ingrediÃƒÆ’Ã‚Â«nten, receptregels en menu-items toe om foodcost te berekenen." />}
    </section>
  </>;
}

function ProductOverview({ products, suppliers }) {
  const supplierMap = new Map(suppliers.map((item) => [item.id, item.name]));
  return <DataPage title="Producten" subtitle="Inkoopprijzen en verpakkingsinhoud per gekozen scope"><div className="cardGrid">{products.map((product) => <article className="entityCard" key={product.id}><span>{product.category || "Ongecategoriseerd"}</span><h3>{product.name}</h3><strong>{money(product.purchase_price)}</strong><small>{product.content_quantity || "ÃƒÂ¢Ã¢â€šÂ¬Ã¢â‚¬Â"} {product.content_unit || ""} Ãƒâ€šÃ‚Â· {supplierMap.get(product.supplier_id) || "Geen leverancier"}</small></article>)}</div>{!products.length && <Empty text="Geen foodcostproducten gevonden." />}</DataPage>;
}

function RecipeOverview({ analytics }) {
  return <DataPage title="Recepturen" subtitle="Kostprijsopbouw gekoppeld aan actieve menu-items"><div className="cardGrid">{analytics.items.map((recipe) => <article className="entityCard" key={recipe.id}><span>{recipe.category || "Menu"}</span><h3>{recipe.name}</h3><strong>{money(recipe.cost)}</strong><small>{recipe.lines} receptregel(s) Ãƒâ€šÃ‚Â· {recipe.foodcost.toFixed(1)}% foodcost</small></article>)}</div>{!analytics.items.length && <Empty text="Nog geen complete recepturen gevonden." />}</DataPage>;
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
        {error && <div className="notice">{error}</div>}<form action={sendMessage} className="chatComposer"><textarea name="message" maxLength="4000" required placeholder="Bijvoorbeeld: welke gerechten vragen vandaag marge-aandacht?" /><button className="primary" disabled={sending}>{sending ? "AnalyserenÃƒÂ¢Ã¢â€šÂ¬Ã‚Â¦" : "Versturen"}</button></form>
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
      <button className="primary" disabled={verifying}>{verifying ? "ControlerenÃ¢â‚¬Â¦" : "Veilig inloggen"}</button>
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
    {!enrollment && !error && <p>Beveiligde QR-code voorbereidenÃ¢â‚¬Â¦</p>}
    {enrollment && <form onSubmit={confirmEnrollment} className="stack">
      <div className="mfaQr"><img src={enrollment.qr} alt="QR-code voor de authenticator-app" /></div>
      <details><summary>QR-code werkt niet?</summary><p>Voer deze sleutel handmatig in:</p><code className="mfaSecret">{enrollment.secret}</code></details>
      <label>Code uit authenticator<input value={code} onChange={(event) => setCode(event.target.value.replace(/\D/g, "").slice(0, 6))} inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6}" minLength="6" maxLength="6" required /></label>
      <button className="primary" disabled={verifying}>{verifying ? "ActiverenÃ¢â‚¬Â¦" : "2FA activeren"}</button>
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
  const [metaAccounts, setMetaAccounts] = useState([]);
  const [metaConfiguration, setMetaConfiguration] = useState({ ready: false, missing: [] });
  const [facebookAccounts, setFacebookAccounts] = useState([]);
  const [facebookConfiguration, setFacebookConfiguration] = useState({ ready: false, missing: [] });
  const [whatsappAccounts, setWhatsappAccounts] = useState([]);
  const [whatsappConfiguration, setWhatsappConfiguration] = useState({ ready: false, missing: [], webhookUrl: "" });
  const [brevoByBusiness, setBrevoByBusiness] = useState({});
  const [syncingBrevoBusinessId, setSyncingBrevoBusinessId] = useState("");
  const [microsoftConnection, setMicrosoftConnection] = useState(null);
  const [microsoftConfiguration, setMicrosoftConfiguration] = useState({ ready: false, missing: [] });
  const [integrationMessage, setIntegrationMessage] = useState("");
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
          <button className="primary" disabled={connecting}>{connecting ? "Verbinding controlerenÃ¢â‚¬Â¦" : "Robuust verbinden"}</button>
        </form>
      </article>
      <article className="panel">
        <div className="panelHead"><div><h2>Verbindingsstatus</h2><p>OfficiÃƒÂ«le Robuust Reserveringen-API.</p></div></div>
        {!accounts.length && <Empty text="Nog geen Robuust-koppeling ingesteld." />}
        {accounts.map((account) => <div className="connectionRow" key={account.id}><div><strong>{account.display_name || "Robuust"}</strong><span>PID: {account.external_account_id}</span><small>{account.last_synced_at ? `Gecontroleerd op ${formatDate(account.last_synced_at)}` : "Nog niet gecontroleerd"}</small></div><span className={`status ${account.connection_status}`}>{statusLabel[account.connection_status] || account.connection_status}</span></div>)}
        <div className="apiScopeList"><h3>Beschikbaar via de publieke API</h3><span>Ã¢Å“â€œ Partnerbedrijf herkennen</span><span>Ã¢Å“â€œ Beschikbaarheid van reserveringen controleren</span><span>Ã¢â‚¬â€œ Omzet, producten en medewerkers: aanvullende toegang van Robuust nodig</span></div>
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
          <button className="primary" disabled={connecting || !metaConfiguration.ready}>{connecting ? "Instagram openenÃ¢â‚¬Â¦" : "Instagram-profiel koppelen"}</button>
        </form>
      </article>
      <article className="panel">
        <div className="panelHead"><div><h2>Instagram per vestiging</h2><p>Elk profiel hoort bij precies ÃƒÂ©ÃƒÂ©n Horeca OS-bedrijf.</p></div></div>
        {!metaAccounts.length && <Empty text="Nog geen Instagram-profiel technisch gekoppeld." />}
        {businesses.map((business) => { const account = metaAccounts.find((item) => item.business_id === business.id); return <div className="connectionRow" key={business.id}><div><strong>{business.name}</strong><span>{account ? `@${account.display_name}` : "Geen profiel gekoppeld"}</span><small>{account?.last_synced_at ? `Laatst gecontroleerd ${formatDate(account.last_synced_at)}` : account?.token_expires_at ? `Token geldig tot ${formatDate(account.token_expires_at)}` : "Koppel het juiste Instagram-profiel"}</small></div>{account && <div><button className="secondaryButton" type="button" disabled={testingMetaBusinessId === business.id || syncingMetaBusinessId === business.id} onClick={() => verifyMeta(business.id)}>{testingMetaBusinessId === business.id ? "TestenÃ¢â‚¬Â¦" : "Verbinding testen"}</button><button className="secondaryButton" type="button" disabled={syncingMetaBusinessId === business.id || testingMetaBusinessId === business.id} onClick={() => syncMeta(business.id)}>{syncingMetaBusinessId === business.id ? "OphalenÃ¢â‚¬Â¦" : "Reacties ophalen"}</button></div>}<span className={`status ${account?.connection_status || "not_configured"}`}>{account ? statusLabel[account.connection_status] || account.connection_status : "Niet ingesteld"}</span></div>; })}
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
          <button className="primary" disabled={connecting || !facebookConfiguration.ready}>{connecting ? "Facebook openenâ€¦" : "Facebookpagina koppelen"}</button>
        </form>
      </article>
      <article className="panel">
        <div className="panelHead"><div><h2>Facebook per vestiging</h2><p>Voor reacties, paginaberichten en later campagne-KPI's.</p></div></div>
        {!facebookAccounts.length && <Empty text="Nog geen Facebookpagina technisch gekoppeld." />}
        {businesses.map((business) => { const account = facebookAccounts.find((item) => item.business_id === business.id); const canSync = account?.granted_scopes?.includes("pages_read_engagement"); return <div className="connectionRow" key={business.id}><div><strong>{business.name}</strong><span>{account?.display_name || "Geen Facebookpagina gekoppeld"}</span><small>{account?.last_synced_at ? `Laatst gecontroleerd ${formatDate(account.last_synced_at)}` : account?.token_expires_at ? `Token geldig tot ${formatDate(account.token_expires_at)}` : "Koppel eerst Instagram en daarna Facebook"}</small></div>{account && <button className="secondaryButton" type="button" disabled={!canSync || syncingFacebookBusinessId === business.id} onClick={() => syncFacebook(business.id)}>{canSync ? (syncingFacebookBusinessId === business.id ? "OphalenÃƒÂ¢Ã¢â€šÂ¬Ã‚Â¦" : "Berichten & reacties ophalen") : "Meta-leesrecht vereist"}</button>}<span className={`status ${account?.connection_status || "not_configured"}`}>{account ? statusLabel[account.connection_status] || account.connection_status : "Niet ingesteld"}</span></div>; })}
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
          <label className="full">Competenties<input name="competencies" placeholder="Bijvoorbeeld BHV, sociale hygiÃƒÂ«ne, wijnkennis" /></label>
          <label>Adres<input name="address" autoComplete="street-address" /></label>
          <div className="splitFields"><label>Postcode<input name="postalCode" autoComplete="postal-code" /></label><label>Woonplaats<input name="city" autoComplete="address-level2" /></label></div>
          <label>Geboorteplaats<input name="birthplace" /></label>
          <label>Geboortedatum<input name="birthDate" type="date" /></label>
          <fieldset className="full"><legend>Functie(s)</legend><div className="checkGrid">{EMPLOYEE_FUNCTION_OPTIONS.map(([value, label]) => <label className="checkOption" key={value}><input type="checkbox" name="functions" value={value} />{label}</label>)}</div></fieldset>
          <fieldset><legend>Loonkosten type</legend><label className="radioOption"><input type="radio" name="wageType" value="hourly" />Uurloon (oproepkracht)</label><label className="radioOption"><input type="radio" name="wageType" value="monthly" />Maandloon (vaste dienst)</label></fieldset>
          <label>Loon (Ã¢â€šÂ¬)<input name="wageAmount" type="number" min="0" step="0.01" /></label>
          <label>BSN-nummer<input name="bsn" inputMode="numeric" autoComplete="off" placeholder="Wordt versleuteld opgeslagen" /></label>
          <label>Bankrekening<input name="iban" autoComplete="off" placeholder="Wordt versleuteld opgeslagen" /></label>
          <label>Ranking<input name="ranking" type="number" min="-1" defaultValue="10" /><small>-1 verbergt de medewerker in Robuust-lijsten.</small></label>
          <label>Robuust medewerker-ID<input name="externalEmployeeId" placeholder="Later automatisch gevuld door koppeling" /></label>
          <div className="sensitiveNote full"><strong>Extra beveiligd</strong><span>BSN, bankrekening, pincode, geboortedatum en loon worden versleuteld opgeslagen. Horeca OS-rollen blijven gescheiden van Robuust-functies.</span></div>
          <div className="formActions full"><button type="reset" className="secondaryButton">Leegmaken</button><button className="primary" disabled={loadingUsers}>{loadingUsers ? "Even geduldÃ¢â‚¬Â¦" : "Medewerker aanmaken"}</button></div>
        </form>
      </article>
      <article className="panel usersPanel">
        <div className="panelHead"><div><h2>Actieve en uitgenodigde gebruikers</h2><p>{adminData.users.length} gebruiker(s) binnen deze werkruimte.</p></div></div>
        {loadingUsers && <Empty text="Gebruikers ladenÃ¢â‚¬Â¦" />}
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
  ["finance:read", "FinanciÃƒÂ«n bekijken"], ["foodcost:read", "Foodcost, producten en recepten bekijken"],
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
      : <div className="permissionGrid permissionSummary">{PERMISSION_OPTIONS.map(([value, label]) => <span className={fixedPermissions.has(value) || role.role_key === "owner" ? "granted" : "denied"} key={value}><b>{fixedPermissions.has(value) || role.role_key === "owner" ? "Ã¢Å“â€œ" : "Ã¢â‚¬â€œ"}</b>{label}</span>)}</div>}</fieldset>}
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
      <label>Pincode<input name="pinCode" type="password" inputMode="numeric" autoComplete="new-password" placeholder={employee.has_pin ? "Ingesteld Ã¢â‚¬â€ leeg laten om te behouden" : "Nieuwe pincode"} /></label>
      <label>Telefoonnummer<input name="phone" type="tel" defaultValue={employee.phone || ""} /></label>
      <label>Eerste dag loonverband<input name="employmentStart" type="date" defaultValue={employee.employment_start || ""} /></label>
      <label>Laatste dag loonverband<input name="employmentEnd" type="date" defaultValue={employee.employment_end || ""} /></label>
      <label className="full">Competenties<input name="competencies" defaultValue={(employee.competencies || []).join(", ")} placeholder="Bijvoorbeeld BHV, sociale hygiÃƒÂ«ne, wijnkennis" /></label>
      <label>Adres<input name="address" autoComplete="street-address" defaultValue={employee.address || ""} /></label>
      <div className="splitFields"><label>Postcode<input name="postalCode" autoComplete="postal-code" defaultValue={employee.postal_code || ""} /></label><label>Woonplaats<input name="city" autoComplete="address-level2" defaultValue={employee.city || ""} /></label></div>
      <label>Geboorteplaats<input name="birthplace" defaultValue={employee.birthplace || ""} /></label>
      <label>Geboortedatum<input name="birthDate" type="date" defaultValue={employee.birth_date || ""} /></label>
      <fieldset className="full"><legend>Functie(s)</legend><div className="checkGrid">{EMPLOYEE_FUNCTION_OPTIONS.map(([value, label]) => <label className="checkOption" key={value}><input type="checkbox" name="functions" value={value} defaultChecked={selectedFunctions.includes(value)} />{label}</label>)}</div></fieldset>
      <fieldset><legend>Loonkosten type</legend><label className="radioOption"><input type="radio" name="wageType" value="hourly" defaultChecked={employee.wage_type === "hourly"} />Uurloon</label><label className="radioOption"><input type="radio" name="wageType" value="monthly" defaultChecked={employee.wage_type === "monthly"} />Maandloon</label></fieldset>
      <label>Loon (Ã¢â€šÂ¬)<input name="wageAmount" type="number" min="0" step="0.01" defaultValue={employee.wage_amount ?? ""} /></label>
      <label>BSN-nummer<input name="bsn" inputMode="numeric" autoComplete="off" placeholder={employee.has_bsn ? `Ingesteld Ã¢â‚¬Â¢Ã¢â‚¬Â¢Ã¢â‚¬Â¢Ã¢â‚¬Â¢ ${employee.bsn_last_four}` : "Wordt versleuteld opgeslagen"} /></label>
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
function buildAdvice({ criticalTasks, sales, events, securityWarnings }) { if (criticalTasks.length) return `Pak eerst ${criticalTasks.length} kritieke taak${criticalTasks.length === 1 ? "" : "en"} op.`; if (securityWarnings) return `${securityWarnings} beveiligingscontrole${securityWarnings === 1 ? " vraagt" : "s vragen"} aandacht.`; if (!sales.revenue) return "Er is vandaag nog geen omzet geregistreerd."; if (!events.length) return "De komende agenda is leeg; controleer evenementen en commerciÃƒÆ’Ã‚Â«le planning."; return "De basis is stabiel. Volg omzet en operationele prioriteiten per vestiging."; }
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
  return <div className="hoursRecord"><div className="hoursEntry"><div><b>{timeEntryEmployeeName(entry)} {entry.corrected_at && <em className="restoredBadge">Hersteld</em>}</b><span>{entry.business?.name || businesses.find((item) => item.id === entry.business_id)?.name || "Vestiging"} Ã‚Â· {formatDate(entry.clocked_in_at)}{entry.break_minutes ? ` Ã‚Â· ${entry.break_minutes} min pauze` : ""}</span></div><strong>{entry.clocked_out_at ? formatDuration(minutes) : "Actief"}</strong></div>{entry.correction_reason && <small className="correctionReason">Reden: {entry.correction_reason}</small>}<details className="correctionEditor"><summary>Tijd corrigeren</summary><form onSubmit={(event) => onCorrect(event, entry.id)}><label>Ingeklokt<input name="clockedIn" type="datetime-local" defaultValue={toLocalDateTimeInput(entry.clocked_in_at)} required /></label><label>Uitgeklokt<input name="clockedOut" type="datetime-local" defaultValue={toLocalDateTimeInput(entry.clocked_out_at)} required /></label><label>Pauze (min)<input name="breakMinutes" type="number" min="0" defaultValue={entry.break_minutes || 0} /></label><label>Reden correctie<input name="reason" required maxLength="500" placeholder="Bijv. vergeten uit te klokken" /></label><button className="secondaryButton">Correctie opslaan</button></form></details></div>;
}



