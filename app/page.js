"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "../lib/supabase";

const priorityRank = { critical: 0, high: 1, medium: 2, low: 3 };
const priorityLabel = { critical: "Kritiek", high: "Hoog", medium: "Midden", low: "Laag" };
const statusLabel = { not_started: "Niet gestart", in_progress: "Bezig", blocked: "Geblokkeerd", done: "Gereed" };

const emptyData = {
  tasks: [], businesses: [], decisions: [], events: [], sales: [], products: [], security: [], integrations: [],
};

export default function Home() {
  const [session, setSession] = useState(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [message, setMessage] = useState("");
  const [memberships, setMemberships] = useState([]);
  const [workspaceId, setWorkspaceId] = useState("");
  const [businessId, setBusinessId] = useState("all");
  const [data, setData] = useState(emptyData);

  useEffect(() => {
    supabase.auth.getSession().then(({ data: authData }) => {
      setSession(authData.session);
      setLoading(false);
    });
    const { data: listener } = supabase.auth.onAuthStateChange((_event, nextSession) => setSession(nextSession));
    return () => listener.subscription.unsubscribe();
  }, []);

  useEffect(() => {
    if (!session) return;
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
  }, [session]);

  const loadData = useCallback(async () => {
    if (!workspaceId) return;
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
  }, [workspaceId, businessId]);

  useEffect(() => { loadData(); }, [loadData]);

  const analytics = useMemo(() => buildSalesAnalytics(data.sales, data.products, new Date()), [data.sales, data.products]);
  const activeWorkspace = memberships.find((membership) => membership.workspace_id === workspaceId);
  const activeBusiness = data.businesses.find((business) => business.id === businessId);
  const openTasks = data.tasks.filter((task) => task.status !== "done");
  const criticalTasks = openTasks.filter((task) => task.priority === "critical");
  const priorities = [...openTasks].sort((a, b) => (priorityRank[a.priority] ?? 9) - (priorityRank[b.priority] ?? 9)).slice(0, 6);
  const securityOk = data.security.filter((item) => ["ok", "pass", "passed", "connected"].includes(String(item.status).toLowerCase())).length;
  const securityWarnings = Math.max(data.security.length - securityOk, 0);
  const connectedIntegrations = data.integrations.filter((item) => String(item.status).toLowerCase() === "connected").length;

  async function signIn(formData) {
    setMessage("");
    const { error } = await supabase.auth.signInWithPassword({ email: formData.get("email"), password: formData.get("password") });
    if (error) setMessage(error.message);
  }

  if (loading) return <main className="center">Horeca OS laden…</main>;
  if (!session) return <LoginScreen signIn={signIn} message={message} />;
  if (!workspaceId && memberships.length === 0) return <main className="center">Geen toegankelijke werkruimte gevonden.</main>;

  return (
    <div className="shell">
      <aside className="sidebar">
        <div className="brand">Horeca OS</div>
        <nav><button className="nav active">CEO Home</button><button className="nav">Omzet</button><button className="nav">Agenda</button><button className="nav">Producten</button><button className="nav">Recepturen</button><button className="nav">Security</button></nav>
        <button className="nav logout" onClick={() => supabase.auth.signOut()}>Uitloggen</button>
      </aside>

      <main className="content">
        <header className="topbar">
          <div><p className="eyebrow">Directieoverzicht</p><h1>{activeBusiness?.name || activeWorkspace?.workspace?.name || "Horeca OS"}</h1><p>{session.user.email}</p></div>
          <div className="toolbar">
            {memberships.length > 1 && <label>Werkruimte<select value={workspaceId} onChange={(event) => { setWorkspaceId(event.target.value); setBusinessId("all"); }}>{memberships.map((item) => <option key={item.workspace_id} value={item.workspace_id}>{item.workspace?.name || item.workspace_id}</option>)}</select></label>}
            <label>Vestiging<select value={businessId} onChange={(event) => setBusinessId(event.target.value)}><option value="all">Alle vestigingen</option>{data.businesses.map((business) => <option key={business.id} value={business.id}>{business.name}</option>)}</select></label>
            <button className="refresh" onClick={loadData} disabled={refreshing}>{refreshing ? "Verversen…" : "Data verversen"}</button>
          </div>
        </header>

        {message && <div className="notice">{message}</div>}

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
          <Panel title="Topprioriteiten" subtitle="Wat vandaag bestuurlijke aandacht vraagt">{priorities.length === 0 && <Empty text="Geen openstaande prioriteiten." />}{priorities.map((task) => <div className={`task ${task.priority || "medium"}`} key={task.id}><div><b>{task.title}</b><span>{priorityLabel[task.priority] || task.priority} · {statusLabel[task.status] || task.status}</span></div><span className="pill">{task.assignee?.full_name || "Nog niet toegewezen"}</span></div>)}</Panel>
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
      </main>
    </div>
  );
}

function getDateRanges(now) {
  const todayDate = startOfDay(now);
  const yesterdayDate = addDays(todayDate, -1);
  const weekStartDate = addDays(todayDate, -((todayDate.getDay() + 6) % 7));
  const monthStartDate = new Date(todayDate.getFullYear(), todayDate.getMonth(), 1);
  const previousMonthStart = new Date(todayDate.getFullYear(), todayDate.getMonth() - 1, 1);
  return { today: isoDate(todayDate), yesterday: isoDate(yesterdayDate), weekStart: isoDate(weekStartDate), monthStart: isoDate(monthStartDate), queryStart: isoDate(previousMonthStart) };
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

function LoginScreen({ signIn, message }) {
  return <main className="authPage"><section className="authCard"><div className="brand dark">Horeca OS</div><h1>Veilig inloggen</h1><p>Managementplatform voor jouw horecabedrijven</p>{message && <div className="notice">{message}</div>}<form action={signIn} className="stack"><label>E-mailadres<input name="email" type="email" required autoComplete="email" /></label><label>Wachtwoord<input name="password" type="password" minLength="12" required autoComplete="current-password" /></label><button className="primary">Inloggen</button></form><small>Nieuwe accounts worden uitsluitend door een beheerder toegevoegd.</small></section></main>;
}

function Card({ label, value, sub, tone = "normal" }) { return <article className={`card ${tone}`}><span>{label}</span><strong>{value ?? 0}</strong><small>{sub}</small></article>; }
function ChannelCard({ label, revenue, orders, share: channelShare }) { return <article className="channelCard"><div><span>{label}</span><strong>{money(revenue)}</strong></div><div className="channelMeta"><small>{number(orders)} orders</small><small>{channelShare.toFixed(1)}% van omzet</small></div></article>; }
function Panel({ title, subtitle, children }) { return <article className="panel"><div className="panelHead"><div><h2>{title}</h2><p>{subtitle}</p></div></div>{children}</article>; }
function Empty({ text }) { return <p className="empty">{text}</p>; }
function buildAdvice({ criticalTasks, sales, events, securityWarnings }) { if (criticalTasks.length) return `Pak eerst ${criticalTasks.length} kritieke taak${criticalTasks.length === 1 ? "" : "en"} op.`; if (securityWarnings) return `${securityWarnings} beveiligingscontrole${securityWarnings === 1 ? " vraagt" : "s vragen"} aandacht.`; if (!sales.revenue) return "Er is vandaag nog geen omzet geregistreerd."; if (!events.length) return "De komende agenda is leeg; controleer evenementen en commerciële planning."; return "De basis is stabiel. Volg omzet en operationele prioriteiten per vestiging."; }
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
