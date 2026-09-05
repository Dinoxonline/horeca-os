"use client";

import { useEffect, useState } from "react";
import { supabase } from "../lib/supabase";

export default function ProcessTrash({ workspaceId, canManage = false, onRefresh }) {
  const [runs, setRuns] = useState([]);
  const [message, setMessage] = useState("");

  async function load() {
    if (!workspaceId) return;
    const { data, error } = await supabase.from("process_runs").select("*, process_templates(name), businesses(name)").eq("workspace_id", workspaceId).not("deleted_at", "is", null).order("deleted_at", { ascending: false }).limit(50);
    if (error) setMessage(error.message);
    setRuns(data || []);
  }

  useEffect(() => { load(); }, [workspaceId]);

  async function restore(run) {
    if (!canManage || !window.confirm("Dit proces terugzetten naar het Werkbord?")) return;
    const { error } = await supabase.from("process_runs").update({ deleted_at: null, deleted_by: null }).eq("workspace_id", workspaceId).eq("id", run.id);
    if (error) setMessage("Herstellen mislukt: " + error.message);
    else { setMessage("Proces hersteld."); await load(); onRefresh?.(); }
  }

  async function removeForever(run) {
    if (!canManage || !window.confirm("Definitief verwijderen? Alle bijbehorende procestaken worden ook verwijderd.")) return;
    if (!window.confirm("Weet u het zeker? Dit kan niet meer ongedaan worden gemaakt.")) return;
    const { error } = await supabase.from("process_runs").delete().eq("workspace_id", workspaceId).eq("id", run.id);
    if (error) setMessage("Definitief verwijderen mislukt: " + error.message);
    else { setMessage("Proces definitief verwijderd."); await load(); onRefresh?.(); }
  }

  return <section className="panel">
    <div className="panelHead"><div><p className="eyebrow">PRULLENBAK</p><h2>Verwijderde processen</h2></div><button type="button" className="secondary" onClick={load}>Verversen</button></div>
    {message && <div className="notice">{message}</div>}
    {!canManage && <p>Je hebt geen rechten om processen uit de prullenbak te beheren.</p>}
    {runs.length === 0 ? <p>De prullenbak is leeg.</p> : <div className="tableLike">{runs.map((run) => <div className="task resolved" key={run.id}><div><strong>{run.name}</strong><span>{run.process_templates?.name || "Proces"} · verwijderd op {new Date(run.deleted_at).toLocaleString("nl-NL")} · {run.businesses?.name || "Alle vestigingen"}</span></div>{canManage && <div className="toolbar"><button type="button" className="secondary" onClick={() => restore(run)}>Herstellen</button><button type="button" className="secondary" onClick={() => removeForever(run)}>Definitief verwijderen</button></div>}</div>)}</div>}
  </section>;
}
