"use client";

import { useEffect, useState } from "react";
import { supabase } from "../lib/supabase";

export default function ManagerLogbook({ workspaceId, businessId, businesses = [], userId, canManage = false }) {
  const [entries, setEntries] = useState([]);
  const [newLog, setNewLog] = useState({ title: "", body: "", category: "overdracht", severity: "normaal" });
  const [message, setMessage] = useState("");

  async function load() {
    if (!workspaceId) return;
    const { data, error } = await supabase.from("manager_log_entries").select("id, entry_date, category, title, body, severity, resolved_at, created_at").eq("workspace_id", workspaceId).order("entry_date", { ascending: false }).order("created_at", { ascending: false }).limit(100);
    if (error) setMessage(error.message);
    setEntries(data || []);
  }
  useEffect(() => { load(); }, [workspaceId]);

  async function createEntry(event) {
    event.preventDefault();
    if (!canManage || !newLog.title.trim() || !newLog.body.trim()) return;
    const { error } = await supabase.from("manager_log_entries").insert({ workspace_id: workspaceId, business_id: businessId === "all" ? businesses[0]?.id || null : businessId, entry_date: new Date().toISOString().slice(0, 10), category: newLog.category, title: newLog.title.trim(), body: newLog.body.trim(), severity: newLog.severity, created_by: userId });
    if (error) setMessage("Notitie opslaan mislukt: " + error.message);
    else { setNewLog({ title: "", body: "", category: "overdracht", severity: "normaal" }); setMessage("Notitie opgeslagen."); await load(); }
  }

  async function resolve(entry) {
    if (!canManage) return;
    const { error } = await supabase.from("manager_log_entries").update({ resolved_at: entry.resolved_at ? null : new Date().toISOString() }).eq("workspace_id", workspaceId).eq("id", entry.id);
    if (error) setMessage("Notitie bijwerken mislukt: " + error.message);
    else await load();
  }

  return <section className="panel">
    <div className="panelHead"><div><p className="eyebrow">MANAGER-LOGBOEK</p><h2>Overdracht en bijzonderheden</h2></div><button type="button" className="secondary" onClick={load}>Verversen</button></div>
    {message && <div className="notice">{message}</div>}
    {canManage && <form onSubmit={createEntry} className="stack"><div className="formGrid"><label>Categorie<select value={newLog.category} onChange={(e) => setNewLog((v) => ({ ...v, category: e.target.value }))}><option value="overdracht">Overdracht</option><option value="storing">Storing</option><option value="klacht">Klacht</option><option value="tekort">Tekort</option><option value="afspraak">Afspraak</option><option value="overig">Overig</option></select></label><label>Urgentie<select value={newLog.severity} onChange={(e) => setNewLog((v) => ({ ...v, severity: e.target.value }))}><option value="laag">Laag</option><option value="normaal">Normaal</option><option value="hoog">Hoog</option><option value="kritiek">Kritiek</option></select></label></div><label>Titel<input required value={newLog.title} onChange={(e) => setNewLog((v) => ({ ...v, title: e.target.value }))} placeholder="Bijvoorbeeld: Koeling maakt lawaai" /></label><label>Notitie<textarea required value={newLog.body} onChange={(e) => setNewLog((v) => ({ ...v, body: e.target.value }))} placeholder="Wat moet de volgende dienst of manager weten?" /></label><button className="primary" type="submit">Notitie opslaan</button></form>}
    {entries.length === 0 ? <p>Nog geen managernotities.</p> : <div className="tableLike">{entries.map((entry) => <div className={"task " + (entry.resolved_at ? "resolved" : "")} key={entry.id}><div><strong>{entry.title}</strong><small>{entry.body}</small><span>{entry.entry_date} · {entry.category} · urgentie {entry.severity} · {entry.resolved_at ? "Opgelost" : "Openstaand"}</span></div>{canManage && <button type="button" className="secondary" onClick={() => resolve(entry)}>{entry.resolved_at ? "Opnieuw openen" : "Markeer als opgelost"}</button>}</div>)}</div>}
  </section>;
}
