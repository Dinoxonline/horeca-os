"use client";

import { useEffect, useState } from "react";
import { supabase } from "../lib/supabase";

const categories = ["Techniek / reparatie", "Onderhoud", "Voorraad", "Marketing", "Personeel", "Idee of vraag", "Overig"];

export default function StaffTicketForm({ token }) {
  const [link, setLink] = useState(null);
  const [form, setForm] = useState({ category: "Techniek / reparatie", priority: "normaal", title: "", description: "", location: "", reporter_name: "", reporter_contact: "" });
  const [state, setState] = useState({ loading: true, saving: false, message: "", success: false });

  useEffect(() => {
    supabase.from("staff_ticket_links").select("id, workspace_id, label").eq("token", token).eq("active", true).maybeSingle().then(({ data, error }) => {
      setLink(data || null);
      setState({ loading: false, saving: false, message: error || !data ? "Deze medewerkerslink is niet actief." : "", success: false });
    });
  }, [token]);

  function update(key, value) { setForm((current) => ({ ...current, [key]: value })); }

  async function submit(event) {
    event.preventDefault();
    if (!link) return;
    setState({ loading: false, saving: true, message: "", success: false });
    const { error } = await supabase.from("staff_tickets").insert({ ...form, workspace_id: link.workspace_id, link_id: link.id });
    if (error) {
      setState({ loading: false, saving: false, message: "Melden lukt niet. Controleer de velden en probeer het opnieuw.", success: false });
      return;
    }
    setForm({ category: "Techniek / reparatie", priority: "normaal", title: "", description: "", location: "", reporter_name: "", reporter_contact: "" });
    setState({ loading: false, saving: false, message: "Je melding is ontvangen. Bedankt!", success: true });
  }

  if (state.loading) return <main className="center">Meldformulier laden…</main>;
  if (!link) return <main className="center"><section className="authCard"><h1>Link niet beschikbaar</h1><p>Deze medewerkerslink is niet actief. Vraag een nieuwe link aan de manager.</p></section></main>;

  return <main className="center" style={{ display: "block", padding: "28px 18px", color: "#17324d" }}>
    <section className="authCard" style={{ width: "min(680px, 100%)", margin: "0 auto" }}>
      <p className="eyebrow">MEDEWERKERSLINK</p>
      <h1>Een melding doorgeven</h1>
      <p>Gebruik dit formulier voor alles wat met de zaak te maken heeft: een kapotte lamp, onderhoud, een idee, marketing of een vraag.</p>
      {state.message && <div className={state.success ? "notice" : "notice"}>{state.message}</div>}
      {!state.success && <form className="stack" onSubmit={submit}>
        <label>Categorie<select value={form.category} onChange={(event) => update("category", event.target.value)}>{categories.map((item) => <option key={item}>{item}</option>)}</select></label>
        <label>Prioriteit<select value={form.priority} onChange={(event) => update("priority", event.target.value)}><option value="laag">Laag</option><option value="normaal">Normaal</option><option value="hoog">Hoog</option><option value="urgent">Urgent</option></select></label>
        <label>Waar gaat het over?*<input required maxLength={160} value={form.title} onChange={(event) => update("title", event.target.value)} placeholder="Bijvoorbeeld: Lamp boven de bar is kapot" /></label>
        <label>Wat is er aan de hand?*<textarea required minLength={5} maxLength={5000} value={form.description} onChange={(event) => update("description", event.target.value)} placeholder="Beschrijf de melding zo duidelijk mogelijk." /></label>
        <label>Locatie<select value={form.location} onChange={(event) => update("location", event.target.value)}><option value="">Kies een locatie</option><option>Caribbean Corner</option><option>Grand Café Het Plein</option><option>Beide locaties</option><option>Overig</option></select></label>
        <label>Jouw naam*<input required minLength={2} maxLength={120} value={form.reporter_name} onChange={(event) => update("reporter_name", event.target.value)} placeholder="Voor- en achternaam" /></label>
        <label>Hoe kunnen we je bereiken?<input maxLength={160} value={form.reporter_contact} onChange={(event) => update("reporter_contact", event.target.value)} placeholder="Optioneel: WhatsApp of e-mail" /></label>
        <button className="primary" disabled={state.saving}>{state.saving ? "Melding versturen…" : "Melding versturen"}</button>
      </form>}
      {state.success && <button className="primary" onClick={() => setState((current) => ({ ...current, success: false, message: "" }))}>Nog een melding doen</button>}
      <p className="muted" style={{ marginTop: 18 }}>Geen account of wachtwoord nodig.</p>
    </section>
  </main>;
}

