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
  const [authMode, setAuthMode] = useState("login");
  const [access, setAccess] = useState("checking");
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
    if (!session) { setAccess("login_required"); return; }
    let active = true;
    (async () => {
      const { data: claimed } = await supabase.rpc("claim_staff_access", { p_token: token });
      const { data: status } = await supabase.rpc("get_staff_access_status", { p_token: token });
      if (!active) return;
      setAccess(claimed || status === "approved" ? "approved" : status || "not_requested");
    })();
    return () => { active = false; };
  }, [session, token]);

  useEffect(() => {
    if (!session || access !== "approved") return;
    supabase.from("staff_ticket_links").select("id, workspace_id, label").eq("token", token).eq("active", true).maybeSingle().then(({ data, error }) => {
      setLink(data || null);
      setState({ loading: false, saving: false, message: error || !data ? "Deze medewerkerslink is niet actief." : "", success: false, ticketNumber: "" });
    });
  }, [access, session, token]);

  function update(key, value) { setForm((current) => ({ ...current, [key]: value })); }
  function updateTracking(key, value) { setTracking((current) => ({ ...current, [key]: value })); }

  async function signIn(event) {
    event.preventDefault(); setAuthMessage("");
    const data = new FormData(event.currentTarget);
    const { error } = await supabase.auth.signInWithPassword({ email: data.get("email"), password: data.get("password") });
    if (error) setAuthMessage("Inloggen lukt niet. Controleer je e-mailadres en wachtwoord.");
  }

  async function signUp(event) {
    event.preventDefault(); setAuthMessage("");
    const data = new FormData(event.currentTarget);
    const response = await fetch("/api/staff-access/signup", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        token,
        email: String(data.get("email") || "").trim(),
        fullName: String(data.get("fullName") || "").trim(),
        password: data.get("password"),
      }),
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) { setAuthMessage(result.error || "Account aanmaken lukt niet. Probeer het opnieuw."); return; }
    const { error } = await supabase.auth.signInWithPassword({ email: data.get("email"), password: data.get("password") });
    if (error) { setAuthMessage("Account aangemaakt. Log nu in met je nieuwe account; daarna wacht je op goedkeuring."); return; }
    setAuthMessage("Je account is aangemaakt. Wacht op goedkeuring van de beheerder.");
  }

  async function submit(event) {
    event.preventDefault(); if (!link) return;
    setState({ loading: false, saving: true, message: "", success: false, ticketNumber: "" });
    const { data: created, error } = await supabase.rpc("submit_staff_ticket", { p_token: token, p_category: form.category, p_priority: form.priority, p_title: form.title, p_description: form.description, p_location: form.location });
    if (error) { setState({ loading: false, saving: false, message: error.message?.includes("toegang") ? "Je account is nog niet goedgekeurd voor deze medewerkerslink." : "Melden lukt niet. Probeer het opnieuw.", success: false, ticketNumber: "" }); return; }
    const ticketNumber = created ? String(created) : "";
    const files = [...(event.currentTarget.elements.namedItem("attachments")?.files || []), ...(event.currentTarget.elements.namedItem("cameraAttachment")?.files || [])];
    let attachmentMessage = "";
    for (const file of files) {
      const uploadData = new FormData();
      uploadData.append("token", token);
      uploadData.append("ticketNumber", ticketNumber);
      uploadData.append("file", file);
      try {
        const uploadResponse = await Promise.race([
          fetch("/api/staff-tickets/attachment", {
            method: "POST",
            headers: { Authorization: `Bearer ${session.access_token}` },
            body: uploadData,
          }),
          new Promise((_, reject) => window.setTimeout(() => reject(new Error("timeout")), 15000)),
        ]);
        if (!uploadResponse.ok) attachmentMessage = " Het ticket is wel aangemaakt, maar een bijlage kon niet worden opgeslagen.";
      } catch {
        attachmentMessage = " Het ticket is wel aangemaakt, maar de bijlage kon niet worden opgeslagen. Probeer een kleiner bestand.";
      }
    }
    setTracking({ ticketNumber }); setForm(emptyForm);
    setState({ loading: false, saving: false, message: `Je melding is ontvangen.${files.length ? ` ${files.length} bijlage${files.length === 1 ? "" : "n"} toegevoegd.` : ""}${attachmentMessage} Bewaar je ticketnummer om de status later te bekijken.`, success: true, ticketNumber });
  }

  async function lookup(event) {
    event.preventDefault(); setTrackingState({ loading: true, message: "", ticket: null });
    const { data, error } = await supabase.rpc("lookup_staff_ticket", { p_token: token, p_ticket_number: tracking.ticketNumber });
    const ticket = Array.isArray(data) ? data[0] : data;
    setTrackingState(error || !ticket ? { loading: false, message: "Ticket niet gevonden onder jouw account. Controleer het ticketnummer.", ticket: null } : { loading: false, message: "", ticket });
  }

  if (authLoading) return <main className="center">Beveiligde medewerkerslink laden…</main>;
  if (!session) return <StaffLogin mode={authMode} setMode={setAuthMode} message={authMessage} onSignIn={signIn} onSignUp={signUp} />;
  if (access === "pending") return <AccessMessage title="Aanvraag in behandeling" text="Je account is aangemaakt. De beheerder moet je aanvraag nog goedkeuren. Daarna kun je via deze link tickets aanmaken." />;
  if (access === "rejected") return <AccessMessage title="Aanvraag afgewezen" text="Je aanvraag voor deze medewerkerslink is afgewezen. Neem contact op met de beheerder." />;
  if (access !== "approved") return <AccessMessage title="Toegang aanvragen" text="Er is nog geen toegangsaanvraag gevonden. Log uit en maak via deze link een account aan." />;
  if (state.loading) return <main className="center">Meldformulier laden…</main>;
  if (!link) return <main className="center"><section className="authCard"><h1>Link niet beschikbaar</h1><p>Deze medewerkerslink is niet actief.</p></section></main>;

  return <main className="center" style={{ display: "block", padding: "28px 18px", color: "#17324d" }}>
    <section className="authCard" style={{ width: "min(680px, 100%)", margin: "0 auto" }}>
      <p className="eyebrow">MEDEWERKERSLINK</p><h1>Een melding doorgeven</h1>
      <p>Gebruik dit formulier voor alles wat met de zaak te maken heeft.</p>
      {state.message && <div className="notice">{state.message}</div>}
      {state.success && <div className="notice"><strong>Ticketnummer: #{state.ticketNumber}</strong><br />Bewaar dit nummer om je melding later terug te vinden.</div>}
      {!state.success && <form className="stack" onSubmit={submit}>
        <label>Categorie<select value={form.category} onChange={(e) => update("category", e.target.value)}>{categories.map((item) => <option key={item}>{item}</option>)}</select></label>
        <label>Prioriteit<select value={form.priority} onChange={(e) => update("priority", e.target.value)}><option value="laag">Laag</option><option value="normaal">Normaal</option><option value="hoog">Hoog</option><option value="urgent">Urgent</option></select></label>
        <label>Waar gaat het over?*<input required maxLength={160} value={form.title} onChange={(e) => update("title", e.target.value)} /></label>
        <label>Wat is er aan de hand?*<textarea required minLength={5} maxLength={5000} value={form.description} onChange={(e) => update("description", e.target.value)} /></label>
        <label>Locatie<select value={form.location} onChange={(e) => update("location", e.target.value)}><option value="">Kies een locatie</option><option>Caribbean Corner</option><option>Grand Café Het Plein</option><option>Beide locaties</option><option>Overig</option></select></label>
        <label>Bestanden uit galerij of bestanden (optioneel)<input name="attachments" type="file" accept="image/jpeg,image/png,application/pdf,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document" multiple /><small>Selecteer hier één of meerdere JPEG-, PNG-, PDF- of Word-bestanden.</small></label>
        <label>Foto maken met camera (optioneel)<input name="cameraAttachment" type="file" accept="image/jpeg,image/png" capture="environment" /><small>Maak direct één foto met de camera.</small></label>
        <button className="primary" disabled={state.saving}>{state.saving ? "Melding versturen…" : "Melding versturen"}</button>
      </form>}
      {state.success && <button className="primary" onClick={() => setState((current) => ({ ...current, success: false, message: "" }))}>Nog een melding doen</button>}
      <p className="muted" style={{ marginTop: 18 }}>Ingelogd als {session.user.email}</p>
    </section>
    <section className="authCard" style={{ width: "min(680px, 100%)", margin: "18px auto 0" }}>
      <p className="eyebrow">STATUS</p><h2>Mijn tickets volgen</h2><p>Je ziet alleen tickets die onder jouw account zijn aangemaakt.</p>
      <form className="stack" onSubmit={lookup}><label>Ticketnummer*<input required value={tracking.ticketNumber} onChange={(e) => updateTracking("ticketNumber", e.target.value)} placeholder="Bijvoorbeeld 10023" /></label><button className="primary" disabled={trackingState.loading}>{trackingState.loading ? "Status ophalen…" : "Status bekijken"}</button></form>
      {trackingState.message && <div className="notice">{trackingState.message}</div>}
      {trackingState.ticket && <div className="notice"><strong>Ticket #{trackingState.ticket.ticket_number}: {trackingState.ticket.title}</strong><p>Status: <strong>{statusLabels[trackingState.ticket.status] || trackingState.ticket.status}</strong><br />Prioriteit: {trackingState.ticket.priority}<br />Categorie: {trackingState.ticket.category}{trackingState.ticket.location ? ` · ${trackingState.ticket.location}` : ""}</p></div>}
    </section>
  </main>;
}

function StaffLogin({ mode, setMode, message, onSignIn, onSignUp }) {
  return <main className="authPage"><section className="authCard"><div className="brand dark">Horeca OS</div><p className="eyebrow">MEDEWERKERSLINK</p><h1>{mode === "login" ? "Inloggen" : "Account aanvragen"}</h1><p>{mode === "login" ? "Log in met je Horeca OS-account." : "Maak een account aan. De beheerder keurt je toegang eerst goed."}</p>{message && <div className="notice">{message}</div>}{mode === "login" ? <form className="stack" onSubmit={onSignIn}><label>E-mailadres<input name="email" type="email" required autoComplete="email" /></label><label>Wachtwoord<input name="password" type="password" required autoComplete="current-password" /></label><button className="primary">Inloggen</button></form> : <form className="stack" onSubmit={onSignUp}><label>Naam<input name="fullName" required minLength={2} autoComplete="name" /></label><label>E-mailadres<input name="email" type="email" required autoComplete="email" /></label><label>Wachtwoord<input name="password" type="password" required minLength={6} autoComplete="new-password" /></label><button className="primary">Account aanvragen</button></form>}<button type="button" className="textButton" onClick={() => { setMode(mode === "login" ? "signup" : "login"); }}>{mode === "login" ? "Nog geen account? Account aanvragen" : "Al een account? Inloggen"}</button></section></main>;
}

function AccessMessage({ title, text }) { return <main className="authPage"><section className="authCard"><div className="brand dark">Horeca OS</div><h1>{title}</h1><p>{text}</p></section></main>; }
