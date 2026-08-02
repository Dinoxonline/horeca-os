"use client";

import { useEffect, useMemo, useState } from "react";
import { supabase } from "../lib/supabase";

const priorityRank = { critical: 0, high: 1, medium: 2, low: 3 };
const priorityLabel = { critical: "Kritiek", high: "Hoog", medium: "Midden", low: "Laag" };
const statusLabel = {
  not_started: "Niet gestart",
  in_progress: "Bezig",
  blocked: "Geblokkeerd",
  done: "Gereed",
};

export default function Home() {
  const [session, setSession] = useState(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [message, setMessage] = useState("");
  const [data, setData] = useState({
    tasks: [],
    businesses: [],
    decisions: [],
    events: [],
    sales: [],
    products: [],
    security: [],
    integrations: [],
  });

  useEffect(() => {
    supabase.auth.getSession().then(({ data: authData }) => {
      setSession(authData.session);
      setLoading(false);
    });

    const { data: listener } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      setSession(nextSession);
    });

    return () => listener.subscription.unsubscribe();
  }, []);

  useEffect(() => {
    if (session) loadData();
  }, [session]);

  async function loadData() {
    setRefreshing(true);
    setMessage("");

    const today = new Date();
    const from = new Date(today);
    from.setDate(from.getDate() - 30);

    const results = await Promise.all([
      supabase.from("tasks").select("*").order("created_at", { ascending: true }),
      supabase.from("businesses").select("*").order("name"),
      supabase.from("decisions").select("*").order("decided_on", { ascending: false }).limit(50),
      supabase.from("events").select("*").gte("starts_at", today.toISOString()).order("starts_at").limit(8),
      supabase.from("sales_daily").select("*").gte("sales_date", isoDate(from)).order("sales_date", { ascending: false }),
      supabase.from("product_sales").select("*").order("quantity", { ascending: false }).limit(8),
      supabase.from("security_checks").select("*").order("check_name"),
      supabase.from("integrations").select("*").order("name"),
    ]);

    const names = ["tasks", "businesses", "decisions", "events", "sales", "products", "security", "integrations"];
    const next = {};
    let firstError = null;

    results.forEach((result, index) => {
      next[names[index]] = result.data || [];
      if (!firstError && result.error) firstError = result.error;
    });

    setData(next);
    if (firstError) setMessage(`Niet alle onderdelen konden worden geladen: ${firstError.message}`);
    setRefreshing(false);
  }

  async function signIn(formData) {
    setMessage("");
    const email = formData.get("email");
    const password = formData.get("password");
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) setMessage(error.message);
  }

  if (loading) return <main className="center">Horeca OS laden…</main>;
  if (!session) return <LoginScreen signIn={signIn} message={message} />;

  const openTasks = data.tasks.filter((task) => task.status !== "done");
  const criticalTasks = openTasks.filter((task) => task.priority === "critical");
  const priorities = [...openTasks]
    .sort((a, b) => (priorityRank[a.priority] ?? 9) - (priorityRank[b.priority] ?? 9))
    .slice(0, 6);

  const todaySales = data.sales.find((row) => row.sales_date === isoDate(new Date()));
  const latestSales = todaySales || data.sales[0];
  const total30 = data.sales.reduce((sum, row) => sum + number(row.total), 0);
  const orders30 = data.sales.reduce((sum, row) => sum + number(row.order_count), 0);
  const averageTicket = orders30 ? total30 / orders30 : number(latestSales?.average_order_value);
  const securityOk = data.security.filter((item) => ["ok", "pass", "passed", "connected"].includes(String(item.status).toLowerCase())).length;
  const securityWarnings = Math.max(data.security.length - securityOk, 0);
  const connectedIntegrations = data.integrations.filter((item) => String(item.status).toLowerCase() === "connected").length;

  return (
    <div className="shell">
      <aside className="sidebar">
        <div className="brand">Horeca OS</div>
        <nav>
          <button className="nav active">CEO Home</button>
          <button className="nav">Omzet</button>
          <button className="nav">Agenda</button>
          <button className="nav">Producten</button>
          <button className="nav">Recepturen</button>
          <button className="nav">Security</button>
        </nav>
        <button className="nav logout" onClick={() => supabase.auth.signOut()}>Uitloggen</button>
      </aside>

      <main className="content">
        <header className="topbar">
          <div>
            <p className="eyebrow">Directieoverzicht</p>
            <h1>Goedendag, Dino</h1>
            <p>{session.user.email}</p>
          </div>
          <button className="refresh" onClick={loadData} disabled={refreshing}>
            {refreshing ? "Verversen…" : "Data verversen"}
          </button>
        </header>

        {message && <div className="notice">{message}</div>}

        <section className="kpis">
          <Card label="Laatste dagomzet" value={money(latestSales?.total)} sub={latestSales?.sales_date ? formatShortDate(latestSales.sales_date) : "Nog geen omzetdata"} />
          <Card label="Orders" value={number(latestSales?.order_count)} sub={`Gemiddelde bon ${money(averageTicket)}`} />
          <Card label="Open taken" value={openTasks.length} sub={`${criticalTasks.length} kritiek`} tone={criticalTasks.length ? "danger" : "normal"} />
          <Card label="Security" value={securityWarnings ? `${securityWarnings} aandacht` : "Op orde"} sub={`${securityOk}/${data.security.length || 0} controles akkoord`} tone={securityWarnings ? "warning" : "success"} />
        </section>

        <section className="kpis secondary">
          <Card label="Omzet 30 dagen" value={money(total30)} sub={`${orders30} orders`} />
          <Card label="Bedrijven" value={data.businesses.length} sub={data.businesses.map((b) => b.name).join(" · ")} />
          <Card label="Integraties" value={`${connectedIntegrations}/${data.integrations.length || 0}`} sub="Verbonden databronnen" />
          <Card label="Besluiten" value={data.decisions.length} sub="Centraal vastgelegd" />
        </section>

        <section className="dashboardGrid">
          <Panel title="Topprioriteiten" subtitle="Wat vandaag bestuurlijke aandacht vraagt">
            {priorities.length === 0 && <Empty text="Geen openstaande prioriteiten." />}
            {priorities.map((task) => (
              <div className={`task ${task.priority || "medium"}`} key={task.id}>
                <div>
                  <b>{task.title}</b>
                  <span>{priorityLabel[task.priority] || task.priority} · {statusLabel[task.status] || task.status}</span>
                </div>
                <span className="pill">{task.owner_name || "Nog niet toegewezen"}</span>
              </div>
            ))}
          </Panel>

          <Panel title="Komende agenda" subtitle="Eerstvolgende afspraken en evenementen">
            {data.events.length === 0 && <Empty text="Geen komende afspraken gevonden." />}
            {data.events.map((event) => (
              <div className="event" key={event.id}>
                <div className="dateBadge">
                  <strong>{new Date(event.starts_at).getDate()}</strong>
                  <span>{new Intl.DateTimeFormat("nl-NL", { month: "short" }).format(new Date(event.starts_at))}</span>
                </div>
                <div>
                  <b>{event.title}</b>
                  <span>{formatDate(event.starts_at)}</span>
                </div>
              </div>
            ))}
          </Panel>

          <Panel title="Topverkopers" subtitle="Producten met het hoogste verkochte aantal">
            {data.products.length === 0 && <Empty text="Nog geen productverkoop geladen." />}
            {data.products.map((product, index) => (
              <div className="rankRow" key={product.id || `${product.product_name}-${index}`}>
                <span className="rank">{index + 1}</span>
                <b>{product.product_name || product.name || "Onbekend product"}</b>
                <strong>{number(product.quantity)}</strong>
              </div>
            ))}
          </Panel>

          <Panel title="Systemen" subtitle="Status van de belangrijkste koppelingen">
            {data.integrations.length === 0 && <Empty text="Geen integraties gevonden." />}
            {data.integrations.map((integration) => (
              <div className="systemRow" key={integration.id}>
                <div>
                  <b>{integration.name}</b>
                  <span>{integration.last_synced_at ? `Laatste sync ${formatDate(integration.last_synced_at)}` : "Nog niet gesynchroniseerd"}</span>
                </div>
                <span className={`status ${String(integration.status).toLowerCase()}`}>
                  {integration.status}
                </span>
              </div>
            ))}
          </Panel>
        </section>

        <section className="panel ai">
          <div>
            <p className="eyebrow light">AI-directieadvies</p>
            <h2>{buildAdvice({ criticalTasks, latestSales, data, securityWarnings })}</h2>
          </div>
          <div className="aiMeta">
            <span>Live database</span>
            <span>Automatische GitHub-deployment</span>
            <span>Dagelijkse back-up</span>
          </div>
        </section>
      </main>
    </div>
  );
}

function buildAdvice({ criticalTasks, latestSales, data, securityWarnings }) {
  if (criticalTasks.length) return `Pak eerst ${criticalTasks.length} kritieke taak${criticalTasks.length === 1 ? "" : "en"} op.`;
  if (securityWarnings) return `Er ${securityWarnings === 1 ? "is" : "zijn"} ${securityWarnings} beveiligingscontrole${securityWarnings === 1 ? "" : "s"} die aandacht vragen.`;
  if (!latestSales) return "Laad de dagelijkse omzet om een volledig directieadvies te krijgen.";
  if (!data.events.length) return "De komende agenda is leeg; controleer evenementen en commerciële planning.";
  return "De basis is stabiel. Volgende focus: dagelijkse omzetimport en recepturen compleet maken.";
}

function LoginScreen({ signIn, message }) {
  return (
    <main className="authPage">
      <section className="authCard">
        <div className="brand dark">Horeca OS</div>
        <h1>Veilig inloggen</h1>
        <p>Voor Caribbean Corner en Grandcafé Het Plein</p>
        {message && <div className="notice">{message}</div>}
        <form action={signIn} className="stack">
          <label>E-mailadres<input name="email" type="email" required autoComplete="email" /></label>
          <label>Wachtwoord<input name="password" type="password" minLength="12" required autoComplete="current-password" /></label>
          <button className="primary">Inloggen</button>
        </form>
        <small>Nieuwe accounts worden uitsluitend door een beheerder toegevoegd.</small>
      </section>
    </main>
  );
}

function Card({ label, value, sub, tone = "normal" }) {
  return <article className={`card ${tone}`}><span>{label}</span><strong>{value ?? 0}</strong><small>{sub}</small></article>;
}

function Panel({ title, subtitle, children }) {
  return <article className="panel"><div className="panelHead"><div><h2>{title}</h2><p>{subtitle}</p></div></div>{children}</article>;
}

function Empty({ text }) {
  return <p className="empty">{text}</p>;
}

function number(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function money(value) {
  return new Intl.NumberFormat("nl-NL", { style: "currency", currency: "EUR" }).format(number(value));
}

function isoDate(date) {
  return new Date(date).toISOString().slice(0, 10);
}

function formatDate(value) {
  if (!value) return "";
  return new Intl.DateTimeFormat("nl-NL", { dateStyle: "medium", timeStyle: "short" }).format(new Date(value));
}

function formatShortDate(value) {
  return new Intl.DateTimeFormat("nl-NL", { dateStyle: "medium" }).format(new Date(`${value}T12:00:00`));
}
