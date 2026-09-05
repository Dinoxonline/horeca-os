"use client";

import { useEffect, useState } from "react";
import { supabase } from "../lib/supabase";

const categories = ["Techniek / reparatie", "Onderhoud", "Voorraad", "Marketing", "Personeel", "Idee of vraag", "Overig"];
const statusLabels = { nieuw: "Nieuw", "in behandeling": "In behandeling", "wacht op informatie": "Wacht op informatie", opgelost: "Opgelost", gesloten: "Gesloten" };
const emptyForm = { category: "Techniek / reparatie", priority: "normaal", title: "", description: "", location: "" };

export default function StaffTicketForm({ token }) {
  const [session, setSession] = useState(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [authMessage, setAuthMessage] = useState("");
  const [link, setLink] = useState(null);
  const [form, setForm] = useState(emptyForm);
  const [tracking, setTracking] = useState({ ticketNumber: "" });
  const [state, setState] = useState({ loading: true, saving: false, message: "", success: false, ticketNumber: "" });
  const [trackingState, setTrackingState] = useState({ loading: false, message: "", ticket: null });

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => { setSession(data.session); setAuthLoading(false); });
    const { data: listener } = supabase.auth.onAuthStateChange((_event, nextSession) => { setSession(nextSession); setAuthLoading(false); });
    return () => listener.subscription.unsubscribe();
  }, []);

  useEffect(() => {
    if (!session) return;
    supabase.from("staff_ticket_links").select("id, workspace_id, label").eq("token", token).eq("active", true).maybeSingle().then(({ data, error }) => {
      setLink(data || null);
      setState({ loading: false, saving: false, message: error || !data ? "Deze medewerkerslink is niet actief." : "", success: false, ticketNumber: "" });
    });
  }, [session, token]);

  function update(key, value) { setForm((current) => ({ ...current, [key]: value })); }
  function updateTracking(key, value) { setTracking((current) => ({ ...current, [key]: value })); }

  async function signIn(event) {
    event.preventDefault();
    setAuthMessage("");
    const data = new FormData(event.currentTarget);
    const { error } = await supabase.auth.signInWithPassword({ email: data.get("email"), password: data.get("password") });
    if (error) setAuthMessage("Inloggen lukt niet. Controleer je e-mailadres en wachtwoord.");
  }

  async function submit(event) {
    event.preventDefault();
    if (!link) return;
    setState({ loading: false, saving: true, message: "", success: false, ticketNumber: "" });
    const { data: created, error } = await supabase.rpc("submit_staff_ticket", {
      p_token: token, p_category: form.category, p_priority: form.priority,
      p_title: form.title, p_description: form.description, p_location: form.location,
    });
    if (error) {
      setState({ loading: false, saving: false, message: error.message?.includes("toegang") ? "Je account heeft geen toegang tot deze medewerkerslink." : "Melden lukt niet. Probeer het opnieuw.", success: false, ticketNumber: "" });
      return;
    }
    const ticketNumber = created ? String(created) : "";
    setTracking({ ticketNumber });
    setForm(emptyForm);
    setState({ loading: false, saving: false, message: "Je melding is ontvangen. Bewaar je ticketnummer om de status later te bekijken.", success: true, ticketNumber });
  }

  async function lookup(event) {
    event.preventDefault();
    setTrackingState({ loading: true, message: "", ticket: null });
    const { data, error } = await supabase.rpc("lookup_staff_ticket", { p_token: token, p_ticket_number: tracking.ticketNumber });
    const ticket = Array.isArray(data) ? data[0] : data;
    setTrackingState(error || !ticket
      ? { loading: false, message: "Ticket niet gevonden onder jouw account. Controleer het ticketnummer.", ticket: null }
      : { loading: false, message: "", ticket });
  }

  if (authLoading) return <main className="center">Beveiligde medewerkerslink laden…</main>;
  if (!session) return <StaffLogin message={authMessage} onSubmit={signIn} />;
  if (state.loading) return <main className="center">Meldformulier laden…</main>;
  if (!link) return <main className="center"><section className="authCard"><h1>Link niet beschikbaar</h1><p>Deze medewerkerslink is niet actief. Vraag een nieuwe link aan de manager.</p></section></main>;

  return <main className="center" style={{ display: "block", padding: "28px 18px", color: "#17324d" }}>
    <section className="authCard" style={{ width: "min(680px, 100%)", margin: "0 auto" }}>
      <p className="eyebrow">MEDEWERKERSLINK</p><h1>Een melding doorgeven</h1>
      <p>Gebruik dit formulier voor alles wat met de zaak te maken heeft: een kapotte lamp, onderhoud, een idee, marketing of een vraag.</p>
      {state.message && <div className="notice">{state.message}</div>}
      {state.success && <div className="notice" style={{ marginTop: 12 }}><strong>Ticketnummer: #{state.ticketNumber}</strong><br />Bewaar dit nummer om je melding later terug te vinden.</div>}
      {!state.success && <form className="stack" onSubmit={submit}>
        <label>Categorie<select value={form.category} onChange={(e) => update("category", e.target.value)}>{categories.map((item) => <option key={item}>{item}</option>)}</select></label>
        <label>Prioriteit<select value={form.priority} onChange={(e) => update("priority", e.target.value)}><option value="laag">Laag</option><option value="normaal">Normaal</option><option value="hoog">Hoog</option><option value="urgent">Urgent</option></select></label>
        <label>Waar gaat het over?*<input required maxLength={160} value={form.title} onChange={(e) => update("title", e.target.value)} placeholder="Bijvoorbeeld: Lamp boven de bar is kapot" /></label>
        <label>Wat is er aan de hand?*<textarea required minLength={5} maxLength={5000} value={form.description} onChange={(e) => update("description", e.target.value)} placeholder="Beschrijf de melding zo duidelijk mogelijk." /></label>
        <label>Locatie<select value={form.location} onChange={(e) => update("location", e.target.value)}><option value="">Kies een locatie</option><option>Caribbean Corner</option><option>Grand Café Het Plein</option><option>Beide locaties</option><option>Overig</option></select></label>
        <button className="primary" disabled={state.saving}>{state.saving ? "Melding versturen…" : "Melding versturen"}</button>
      </form>}
      {state.success && <button className="primary" onClick={() => setState((current) => ({ ...current, success: false, message: "" }))}>Nog een melding doen</button>}
      <p className="muted" style={{ marginTop: 18 }}>Ingelogd als {session.user.email}</p>
    </section>
    <section className="authCard" style={{ width: "min(680px, 100%)", margin: "18px auto 0" }}>
      <p className="eyebrow">STATUS</p><h2>Mijn tickets volgen</h2>
      <p>Je ziet alleen tickets die onder jouw ingelogde Horeca OS-account zijn aangemaakt.</p>
      <form className="stack" onSubmit={lookup}>
        <label>Ticketnummer*<input required value={tracking.ticketNumber} onChange={(e) => updateTracking("ticketNumber", e.target.value)} placeholder="Bijvoorbeeld 10023" /></label>
        <button className="primary" disabled={trackingState.loading}>{trackingState.loading ? "Status ophalen…" : "Status bekijken"}</button>
      </form>
      {trackingState.message && <div className="notice" style={{ marginTop: 14 }}>{trackingState.message}</div>}
      {trackingState.ticket && <div className="notice" style={{ marginTop: 14 }}><strong>Ticket #{trackingState.ticket.ticket_number}: {trackingState.ticket.title}</strong><p style={{ margin: "8px 0 0" }}>Status: <strong>{statusLabels[trackingState.ticket.status] || trackingState.ticket.status}</strong><br />Prioriteit: {trackingState.ticket.priority}<br />Categorie: {trackingState.ticket.category}{trackingState.ticket.location ? ` · ${trackingState.ticket.location}` : ""}</p></div>}
    </section>
  </main>;
}

function StaffLogin({ message, onSubmit }) {
  return <main className="authPage"><section className="authCard"><div className="brand dark">Horeca OS</div><p className="eyebrow">MEDEWERKERSLINK</p><h1>Inloggen om een melding te doen</h1><p>Log in met je Horeca OS-account. Daarna kun je tickets aanmaken en je eigen ticketstatus bekijken.</p>{message && <div className="notice">{message}</div>}<form className="stack" onSubmit={onSubmit}><label>E-mailadres<input name="email" type="email" required autoComplete="email" /></label><label>Wachtwoord<input name="password" type="password" required autoComplete="current-password" /></label><button className="primary">Inloggen</button></form><small>Heb je nog geen account? Vraag een beheerder om je toe te voegen aan Horeca OS.</small></section></main>;
}
