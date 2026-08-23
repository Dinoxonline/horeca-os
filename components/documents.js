"use client";

import { useEffect, useState } from "react";
import { supabase } from "../lib/supabase";

const categories = ["recipe", "work_instruction", "menu", "marketing", "hr", "safety", "supplier", "other"];
const categoryLabels = { recipe: "Recepten", work_instruction: "Werkinstructies", menu: "Menukaarten", marketing: "Marketing", hr: "Personeel", safety: "Veiligheid", supplier: "Leveranciers", other: "Overig" };

export default function Documents({ workspaceId, businessId, userId, canManage = false }) {
  const [documents, setDocuments] = useState([]);
  const [form, setForm] = useState({ title: "", category: "recipe", dropbox_path: "", dropbox_shared_link: "", access_mode: "workspace", description: "" });
  const [message, setMessage] = useState("");

  async function load() {
    if (!workspaceId) return;
    const { data, error } = await supabase.from("documents").select("*, businesses(name)").eq("workspace_id", workspaceId).order("updated_at", { ascending: false });
    if (error) setMessage(error.message);
    setDocuments(data || []);
  }

  useEffect(() => { load(); }, [workspaceId]);

  async function save(event) {
    event.preventDefault();
    if (!canManage || !form.title.trim() || !form.dropbox_path.trim()) return;
    const { error } = await supabase.from("documents").insert({
      ...form,
      title: form.title.trim(),
      workspace_id: workspaceId,
      business_id: businessId === "all" ? null : businessId,
      created_by: userId,
    });
    setMessage(error ? error.message : "Document toegevoegd aan de HorecaOS-bibliotheek.");
    if (!error) {
      setForm({ title: "", category: "recipe", dropbox_path: "", dropbox_shared_link: "", access_mode: "workspace", description: "" });
      load();
    }
  }

  return (
    <>
      <section className="pageIntro">
        <p className="eyebrow">DOCUMENTEN</p>
        <h2>Documentenbibliotheek</h2>
        <p>Dropbox blijft de opslag. Horeca OS bewaart de vindbaarheid, categorie, proceskoppeling en toegangsregel.</p>
      </section>
      {message && <div className="notice">{message}</div>}
      <div className="dashboardGrid">
        <section className="panel">
          <div className="panelHead"><div><p className="eyebrow">DOCUMENT KOPPELEN</p><h3>Dropbox-document toevoegen</h3></div></div>
          {!canManage && <p>Alleen een eigenaar of manager kan documenten koppelen.</p>}
          <form onSubmit={save} className="stack">
            <label>Naam<input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} placeholder="Bijvoorbeeld: Werkinstructie Grill Your Own" disabled={!canManage} /></label>
            <label>Categorie<select value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })} disabled={!canManage}>{categories.map((key) => <option key={key} value={key}>{categoryLabels[key]}</option>)}</select></label>
            <label>Dropbox-pad<input value={form.dropbox_path} onChange={(e) => setForm({ ...form, dropbox_path: e.target.value })} placeholder="/HorecaOS/Recepten/..." disabled={!canManage} /></label>
            <label>Dropbox-link<input value={form.dropbox_shared_link} onChange={(e) => setForm({ ...form, dropbox_shared_link: e.target.value })} placeholder="Optionele gedeelde link" disabled={!canManage} /></label>
            <label>Toegang<select value={form.access_mode} onChange={(e) => setForm({ ...form, access_mode: e.target.value })} disabled={!canManage}><option value="workspace">Iedereen met documententoegang</option><option value="managers">Alleen managers</option><option value="specific">Specifieke medewerkers</option><option value="private">Alleen ik</option></select></label>
            <label>Toelichting<textarea value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} disabled={!canManage} /></label>
            <button className="primary" type="submit" disabled={!canManage || !form.title.trim() || !form.dropbox_path.trim()}>Document koppelen</button>
          </form>
        </section>
        <section className="panel">
          <div className="panelHead"><div><p className="eyebrow">BIBLIOTHEEK</p><h3>Gekoppelde documenten</h3></div><button type="button" className="secondary" onClick={load}>Verversen</button></div>
          {documents.length === 0 ? <p>Nog geen documenten gekoppeld.</p> : <div className="tableLike">{documents.map((document) => <div className="task" key={document.id}><div><strong>{document.title}</strong><span>{categoryLabels[document.category] || "Overig"} · {document.businesses?.name || "Alle vestigingen"} · {document.access_mode}</span><small>{document.dropbox_path}</small></div>{document.dropbox_shared_link ? <a className="pill" href={document.dropbox_shared_link} target="_blank" rel="noreferrer">Openen</a> : <span className="pill">Dropbox-pad</span>}</div>)}</div>}
        </section>
      </div>
    </>
  );
}
