"use client";

import { useEffect, useMemo, useState } from "react";
import { supabase } from "../lib/supabase";

const priorityRank = { critical: 0, high: 1, medium: 2, low: 3 };
const priorityLabel = {
  critical: "Kritiek",
  high: "Hoog",
  medium: "Midden",
  low: "Laag",
};
const statusLabel = {
  not_started: "Niet gestart",
  in_progress: "Bezig",
  blocked: "Geblokkeerd",
  done: "Gereed",
};

export default function Home() {
  const [session, setSession] = useState(null);
  const [loading, setLoading] = useState(true);
  const [tasks, setTasks] = useState([]);
  const [businesses, setBusinesses] = useState([]);
  const [decisions, setDecisions] = useState([]);
  const [events, setEvents] = useState([]);
  const [message, setMessage] = useState("");

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      setLoading(false);
    });

    const { data: listener } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      setSession(nextSession);
    });

    return () => listener.subscription.unsubscribe();
  }, []);

  useEffect(() => {
    if (session) {
      loadData();
    }
  }, [session]);

  async function loadData() {
    const [taskRes, businessRes, decisionRes, eventRes] = await Promise.all([
      supabase.from("tasks").select("*").order("created_at", { ascending: true }),
      supabase.from("businesses").select("*").order("name"),
      supabase.from("decisions").select("*").order("decided_on", { ascending: false }),
      supabase
        .from("events")
        .select("*")
        .gte("starts_at", new Date().toISOString())
        .order("starts_at", { ascending: true })
        .limit(8),
    ]);

    const firstError = [taskRes, businessRes, decisionRes, eventRes].find((r) => r.error)?.error;
    if (firstError) {
      setMessage(firstError.message);
    }

    setTasks(taskRes.data || []);
    setBusinesses(businessRes.data || []);
    setDecisions(decisionRes.data || []);
    setEvents(eventRes.data || []);
  }

  async function signIn(formData) {
    setMessage("");
    const email = formData.get("email");
    const password = formData.get("password");

    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) {
      setMessage(error.message);
    }
  }

  if (loading) {
    return <main className="center">Horeca OS laden…</main>;
  }

  if (!session) {
    return <LoginScreen signIn={signIn} message={message} />;
  }

  const openTasks = tasks.filter((task) => task.status !== "done");
  const priorities = useMemo(
    () =>
      [...openTasks]
        .sort((a, b) => priorityRank[a.priority] - priorityRank[b.priority])
        .slice(0, 6),
    [openTasks]
  );

  return (
    <div className="shell">
      <aside className="sidebar">
        <div className="brand">Horeca OS</div>
        <button className="nav active">CEO Home</button>
        <button className="nav" onClick={() => supabase.auth.signOut()}>
          Uitloggen
        </button>
      </aside>

      <main className="content">
        <header>
          <div>
            <h1>CEO Home</h1>
            <p>{session.user.email}</p>
          </div>
        </header>

        {message && <div className="notice">{message}</div>}

        <section className="kpis">
          <Card
            label="Bedrijven"
            value={businesses.length}
            sub={businesses.map((business) => business.name).join(" · ")}
          />
          <Card
            label="Open taken"
            value={openTasks.length}
            sub={`${openTasks.filter((task) => task.priority === "critical").length} kritiek`}
          />
          <Card label="Besluiten" value={decisions.length} sub="Centraal vastgelegd" />
          <Card label="Database" value="Live" sub="Supabase EU Central" />
        </section>

        <section className="two">
          <Panel title="Topprioriteiten">
            {priorities.length === 0 && <p>Geen openstaande prioriteiten.</p>}
            {priorities.map((task) => (
              <div className={`task ${task.priority}`} key={task.id}>
                <b>{task.title}</b>
                <span>
                  {priorityLabel[task.priority]} · {statusLabel[task.status]}
                </span>
              </div>
            ))}
          </Panel>

          <Panel title="Komende agenda">
            {events.length === 0 && <p>Geen komende afspraken gevonden.</p>}
            {events.map((event) => (
              <div className="event" key={event.id}>
                <b>{event.title}</b>
                <span>{formatDate(event.starts_at)}</span>
              </div>
            ))}
          </Panel>
        </section>

        <section className="panel ai">
          <h2>AI-directieadvies</h2>
          <p>
            De database, beveiliging en agenda-integratie zijn actief. De volgende
            prioriteit is het zichtbaar maken van omzet, producten, recepturen en
            Security Center in deze app.
          </p>
        </section>
      </main>
    </div>
  );
}

function LoginScreen({ signIn, message }) {
  return (
    <main className="authPage">
      <section className="authCard">
        <div className="brand dark">Horeca OS</div>
        <h1>Inloggen</h1>
        <p>Voor Caribbean Corner en Grandcafé Het Plein</p>

        {message && <div className="notice">{message}</div>}

        <form action={signIn} className="stack">
          <label>
            E-mailadres
            <input name="email" type="email" required autoComplete="email" />
          </label>

          <label>
            Wachtwoord
            <input
              name="password"
              type="password"
              minLength="12"
              required
              autoComplete="current-password"
            />
          </label>

          <button className="primary">Inloggen</button>
        </form>

        <small>Nieuwe accounts worden uitsluitend door een beheerder toegevoegd.</small>
      </section>
    </main>
  );
}

function Card({ label, value, sub }) {
  return (
    <article className="card">
      <span>{label}</span>
      <strong>{value}</strong>
      <small>{sub}</small>
    </article>
  );
}

function Panel({ title, children }) {
  return (
    <article className="panel">
      <h2>{title}</h2>
      {children}
    </article>
  );
}

function formatDate(value) {
  if (!value) return "";
  return new Intl.DateTimeFormat("nl-NL", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}
