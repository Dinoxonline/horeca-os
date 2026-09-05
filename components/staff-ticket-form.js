"use client";

import { useEffect, useState } from "react";
import { supabase } from "../lib/supabase";

const categories = ["Techniek / reparatie", "Onderhoud", "Voorraad", "Marketing", "Personeel", "Idee of vraag", "Overig"];
const statusLabels = { nieuw: "Nieuw", "in behandeling": "In behandeling", "wacht op informatie": "Wacht op informatie", opgelost: "Opgelost", gesloten: "Gesloten" };

const emptyForm = { category: "Techniek / reparatie", priority: "normaal", title: "", description: "", location: "", reporter_name: "", reporter_contact: "" };

export default function StaffTicketForm({ token }) {
  const [link, setLink] = useState(null);
  const [form, setForm] = useState(emptyForm);
  const [tracking, setTracking] = useState({ ticketNumber: "", contact: "" });
  const [state, setState] = useState({ loading: true, saving: false, message: "", success: false, ticketNumber: "" });
  const [trackingState, setTrackingState] = useState({ loading: false, message: "", ticket: null });

  useEffect(() => {
    supabase.from("staff_ticket_links").select("id, workspace_id, label").eq("token", token).eq("active", true).maybeSingle().then(({ data, error }) => {
      setLink(data || null);
      setState({ loading: false, saving: false, message: error || !data ? "Deze medewerkerslink is niet actief." : "", success: false, ticketNumber: "" });
    });
  }, [token]);

  function update(key, value) { setForm((current) => ({ ...current, [key]: value })); }
  function updateTracking(key, value) { setTracking((current) => ({ ...current, [key]: value })); }

  async function submit(event) {
    event.preventDefault();
    if (!link) return;
    setState({ loading: false, saving: true, message: "", success: false, ticketNumber: "" });
    const { data: created, error } = await supabase.from("staff_tickets").insert({ ...form, workspace_id: link.workspace_id, link_id: link.id }).select("ticket_number").single();
    if (error) {
      setState({ loading: false, saving: false, message: "Melden lukt niet. Controleer de velden en probeer het opnieuw.", success: false, ticketNumber: "" });
      return;
    }
    const ticketNumber = created?.ticket_number ? String(created.ticket_number) : "";
    setTracking({ ticketNumber, contact: form.reporter_contact });
    setForm(emptyForm);
    setState({ loading: false, saving: false, message: "Je melding is ontvangen. Bewaar je ticketnummer om de status later te bekijken.", success: true, ticketNumber });
  }

  async function lookup(event) {
    event.preventDefault();
    setTrackingState({ loading: true, message: "", ticket: null });
    const { data, error } = await supabase.rpc("lookup_staff_ticket", { p_token: token, p_ticket_number: tracking.ticketNumber, p_contact: tracking.contact });
    const ticket = Array.isArray(data) ? data[0] : data;
    if (error || !ticket) {
      setTrackingState({ loading: false, message: "Ticket niet gevonden. Controleer het ticketnummer en contactgegeven.", ticket: null });
      return;
    }
    setTrackingState({ loading: false, message: "", ticket });
  }

  if (state.loading) return <main className="center">Meldformulier laden…</main>;
  if (!link) return <main className="center"><section className="authCard"><h1>Link niet beschikbaar</h1><p>Deze medewerkerslink is niet actief. Vraag een nieuwe link aan de manager.</p></section></main>;

  return <main className="center" style={{ display: "block", padding: "28px 18px", color: "#17324d" }}>
    <section className="authCard" style={{ width: "min(680px, 100%)", margin: "0 auto" }}>
      <p className="eyebrow">MEDEWERKERSLINK</p>
      <h1>Een melding doorgeven</h1>
      <p>Gebruik dit formulier voor alles wat met de zaak te maken heeft: een kapotte lamp, onderhoud, een idee, marketing of een vraag.</p>
      {state.message && <div className="notice">{typeof state.message === "string" ? state.message : "Deze medewerkerslink kon niet worden geladen."}</div>}
      {state.success && <div className="notice" style={{ marginTop: 12 }}><strong>Ticketnummer: #{state.ticketNumber}</strong><br />Gebruik dit nummer en je contactgegeven bij “Ticket volgen”.</div>}
      {!state.success && <form className="stack" onSubmit={submit}>
        <label>Categorie<select value={form.category} onChange={(event) => update("category", event.target.value)}>{categories.map((item) => <option key={item}>{item}</option>)}</select></label>
        <label>Prioriteit<select value={form.priority} onChange={(event) => update("priority", event.target.value)}><option value="laag">Laag</option><option value="normaal">Normaal</option><option value="hoog">Hoog</option><option value="urgent">Urgent</option></select></label>
        <label>Waar gaat het over?*<input required maxLength={160} value={form.title} onChange={(event) => update("title", event.target.value)} placeholder="Bijvoorbeeld: Lamp boven de bar is kapot" /></label>
        <label>Wat is er aan de hand?*<textarea required minLength={5} maxLength={5000} value={form.description} onChange={(event) => update("description", event.target.value)} placeholder="Beschrijf de melding zo duidelijk mogelijk." /></label>
        <label>Locatie<select value={form.location} onChange={(event) => update("location", event.target.value)}><option value="">Kies een locatie</option><option>Caribbean Corner</option><option>Grand Café Het Plein</option><option>Beide locaties</option><option>Overig</option></select></label>
        <label>Jouw naam*<input required minLength={2} maxLength={120} value={form.reporter_name} onChange={(event) => update("reporter_name", event.target.value)} placeholder="Voor- en achternaam" /></label>
        <label>WhatsApp-nummer of e-mailadres*<input required minLength={3} maxLength={160} value={form.reporter_contact} onChange={(event) => update("reporter_contact", event.target.value)} placeholder="Bijvoorbeeld 06-12345678 of naam@bedrijf.nl" /></label>
        <button className="primary" disabled={state.saving}>{state.saving ? "Melding versturen…" : "Melding versturen"}</button>
      </form>}
      {state.success && <button className="primary" onClick={() => setState((current) => ({ ...current, success: false, message: "" }))}>Nog een melding doen</button>}
      <p className="muted" style={{ marginTop: 18 }}>Geen account of wachtwoord nodig.</p>
    </section>

    <section className="authCard" style={{ width: "min(680px, 100%)", margin: "18px auto 0" }}>
      <p className="eyebrow">STATUS</p>
      <h2>Ticket volgen</h2>
      <p>Vul je ticketnummer en hetzelfde WhatsApp-nummer of e-mailadres in om de actuele status te bekijken.</p>
      <form className="stack" onSubmit={lookup}>
        <label>Ticketnummer*<input required value={tracking.ticketNumber} onChange={(event) => updateTracking("ticketNumber", event.target.value)} placeholder="Bijvoorbeeld 10023" /></label>
        <label>WhatsApp-nummer of e-mailadres*<input required minLength={3} value={tracking.contact} onChange={(event) => updateTracking("contact", event.target.value)} placeholder="Hetzelfde contactgegeven als bij de melding" /></label>
        <button className="primary" disabled={trackingState.loading}>{trackingState.loading ? "Status ophalen…" : "Status bekijken"}</button>
      </form>
      {trackingState.message && <div className="notice" style={{ marginTop: 14 }}>{trackingState.message}</div>}
      {trackingState.ticket && <div className="notice" style={{ marginTop: 14 }}>
        <strong>Ticket #{trackingState.ticket.ticket_number}: {trackingState.ticket.title}</strong>
        <p style={{ margin: "8px 0 0" }}>Status: <strong>{statusLabels[trackingState.ticket.status] || trackingState.ticket.status}</strong><br />Prioriteit: {trackingState.ticket.priority}<br />Categorie: {trackingState.ticket.category}{trackingState.ticket.location ? ` · ${trackingState.ticket.location}` : ""}</p>
      </div>}
    </section>
  </main>;
}
