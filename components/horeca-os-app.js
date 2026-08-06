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
      .select("business_id, location_id, role:roles!inner(role_key, role_permissions(permission))")
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
      const permissions = assignment.role?.role_permissions?.map((item) => item.permission) || [];
      return businessMatches && (assignment.role?.role_key === "owner" || permissions.includes(permission));
    });
  }, [activeWorkspace?.role, businessId, roleAssignments]);
  const featureVisibility = useMemo(() => ({
    dashboard: canUseFeature("operations:read") || canUseFeature("operations:manage") || canUseFeature("finance:read"),
    foodcost: canUseFeature("foodcost:read"),
    products: canUseFeature("foodcost:read"),
    recipes: canUseFeature("foodcost:read"),
    suppliers: canUseFeature("foodcost:read"),
    assistant: canUseFeature("ai:use"),
    users: canUseFeature("users:read") || canUseFeature("users:manage"),
    integrations: canUseFeature("integrations:manage"),
    reviews: canUseFeature("reviews:read") || canUseFeature("reviews:manage") || canUseFeature("reviews:respond"),
    marketing: canUseFeature("marketing:read") || canUseFeature("marketing:manage") || canUseFeature("social:read"),
    security: true,
  }), [canUseFeature]);
  const canViewDirectie = isOwner || canUseFeature("operations:manage") || canUseFeature("finance:read");
  const dashboardLabel = isOwner ? "CEO Home" : canViewDirectie ? "Management Home" : "Mijn werk";
  const viewAllowed = featureVisibility[activeView] !== false;
  const mfaRequired = useMemo(() => roleAssignments.some((assignment) => ["owner", "manager"].includes(assignment.role?.role_key)), [roleAssignments]);
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
  if (passwordRecovery) return <PasswordRecoveryScreen onSave={saveRecoveredPassword} message={message} />;
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
    });
  }

  async function updateUser(formData) {
    const form = Object.fromEntries(formData);
    await submitAdminAction({
      action: "replace-assignment", userId: form.userId, roleId: form.roleId,
      businessId: form.businessId || null, locationId: null,
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
          <label>Horeca OS-rol *<select name="roleId" required defaultValue=""><option value="" disabled>Kies een rol</option>{adminData.roles.map((role) => <option key={role.id} value={role.id}>{role.name}</option>)}</select></label>
          <label>Vestigingstoegang<select name="businessId" defaultValue=""><option value="">Alle vestigingen</option>{adminData.businesses.map((business) => <option key={business.id} value={business.id}>{business.name}</option>)}</select></label>
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
            <form action={updateUser} className="userRow">
              <input type="hidden" name="userId" value={user.id} />
              <div className="userIdentity"><strong>{user.fullName || user.email}</strong><span>{user.email}</span><small>{user.confirmed ? "Actief" : "Uitnodiging verstuurd"}</small></div>
              <label>Horeca OS-rol<select name="roleId" required defaultValue={assignment?.role_id || ""}>{adminData.roles.map((role) => <option key={role.id} value={role.id}>{role.name}</option>)}</select></label>
              <label>Toegang<select name="businessId" defaultValue={assignment?.business_id || ""}><option value="">Alle vestigingen</option>{adminData.businesses.map((business) => <option key={business.id} value={business.id}>{business.name}</option>)}</select></label>
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

function PasswordRecoveryScreen({ onSave, message }) {
  return <main className="authPage"><section className="authCard"><div className="brand dark">Horeca OS</div><h1>Nieuw wachtwoord instellen</h1><p>Kies eerst een nieuw wachtwoord. Daarna krijg je toegang tot Horeca OS.</p>{message && <div className="notice">{message}</div>}<form action={onSave} className="stack"><label>Nieuw wachtwoord<input name="password" type="password" minLength="6" required autoComplete="new-password" /></label><label>Herhaal wachtwoord<input name="confirmation" type="password" minLength="6" required autoComplete="new-password" /></label><button className="primary">Wachtwoord opslaan</button></form><small>Gebruik minimaal 6 tekens.</small></section></main>;
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

