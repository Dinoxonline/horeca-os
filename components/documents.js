"use client";

import { useEffect, useState } from "react";
import { supabase } from "../lib/supabase";

const categories = ["recipe", "work_instruction", "menu", "marketing", "hr", "safety", "supplier", "other"];
const categoryLabels = { recipe: "Recepten", work_instruction: "Werkinstructies", menu: "Menukaarten", marketing: "Marketing", hr: "Personeel", safety: "Veiligheid", supplier: "Leveranciers", other: "Overig" };

export default function Documents({ workspaceId, businessId, userId, canManage = false }) {
  const [documents, setDocuments] = useState([]);
  const [processRuns, setProcessRuns] = useState([]);
  const [members, setMembers] = useState([]);
  const [form, setForm] = useState({ title: "", category: "recipe", dropbox_path: "", dropbox_shared_link: "", access_mode: "workspace", description: "", process_run_id: "", allowed_user_ids: [] });
  const [message, setMessage] = useState("");

  async function load() {
    if (!workspaceId) return;
    const [{ data, error }, { data: runs }, { data: memberRows }] = await Promise.all([
      supabase.from("documents").select("*, businesses(name), process_runs(name)").eq("workspace_id", workspaceId).order("updated_at", { ascending: false }),
      supabase.from("process_runs").select("id, name, status, anchor_date").eq("workspace_id", workspaceId).order("created_at", { ascending: false }).limit(50),
      supabase.from("workspace_members").select("user_id").eq("workspace_id", workspaceId),
    ]);
    if (error) setMessage(error.message);
    setDocuments(data || []);
    setProcessRuns(runs || []);
    const memberIds = (memberRows || []).map((item) => item.user_id).filter(Boolean);
    if (memberIds.length) {
      const { data: profileRows } = await supabase.from("profiles").select("id, full_name").in("id", memberIds).order("full_name");
      setMembers(profileRows || []);
    } else setMembers([]);
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
      process_run_id: form.process_run_id || null,
      allowed_user_ids: form.allowed_user_ids,
    });
    setMessage(error ? error.message : "Document toegevoegd aan de HorecaOS-bibliotheek.");
    if (!error) {
      setForm({ title: "", category: "recipe", dropbox_path: "", dropbox_shared_link: "", access_mode: "workspace", description: "", process_run_id: "", allowed_user_ids: [] });
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
            <label>Toegang<select value={form.access_mode} onChange={(e) => setForm({ ...form, access_mode: e.target.value })} disabled={!canManage}><option value="workspace">Iedereen met documententoegang</option><option value="managers">Alleen managers</option><option value="specific">Specifieke medewerkers</option><option value="private">Alleen ik</option></select></label>\n            <label>Koppel aan proces<select value={form.process_run_id} onChange={(e) => setForm({ ...form, process_run_id: e.target.value })} disabled={!canManage}><option value="">Geen proces</option>{processRuns.map((run) => <option key={run.id} value={run.id}>{run.name} · {run.status}</option>)}</select></label>
            {form.access_mode === "specific" && <fieldset><legend>Wie mag dit document zien?</legend>{members.map((member) => <label key={member.id} className="checkRow"><input type="checkbox" checked={form.allowed_user_ids.includes(member.id)} onChange={(event) => setForm({ ...form, allowed_user_ids: event.target.checked ? [...form.allowed_user_ids, member.id] : form.allowed_user_ids.filter((id) => id !== member.id) })} disabled={!canManage} />{member.full_name || member.id}</label>)}</fieldset>}
            <label>Toelichting<textarea value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} disabled={!canManage} /></label>
            <button className="primary" type="submit" disabled={!canManage || !form.title.trim() || !form.dropbox_path.trim()}>Document koppelen</button>
          </form>
        </section>
        <section className="panel">
          <div className="panelHead"><div><p className="eyebrow">BIBLIOTHEEK</p><h3>Gekoppelde documenten</h3></div><button type="button" className="secondary" onClick={load}>Verversen</button></div>
          {documents.length === 0 ? <p>Nog geen documenten gekoppeld.</p> : <div className="tableLike">{documents.map((document) => <div className="task" key={document.id}><div><strong>{document.title}</strong><span>{categoryLabels[document.category] || "Overig"} · {document.businesses?.name || "Alle vestigingen"} · {document.process_runs?.name || "Los document"} · {document.access_mode}</span><small>{document.dropbox_path}</small></div>{document.dropbox_shared_link ? <a className="pill" href={document.dropbox_shared_link} target="_blank" rel="noreferrer">Openen</a> : <span className="pill">Dropbox-pad</span>}</div>)}</div>}
        </section>
      </div>
    </>
  );
}
