"use client";

import { useEffect, useState } from "react";
import { supabase } from "../lib/supabase";

export default function ProcessAudit({ workspaceId, canManage = false }) {
  const [entries, setEntries] = useState([]);
  const [message, setMessage] = useState("");

  async function load() {
    if (!workspaceId) return;
    const { data, error } = await supabase.from("audit_log").select("id, actor_id, table_name, action, record_id, old_data, new_data, created_at").eq("workspace_id", workspaceId).in("table_name", ["process_templates", "process_template_steps", "process_runs", "process_run_tasks"]).not("actor_id", "is", null).order("created_at", { ascending: false }).limit(100);
    if (error) setMessage(error.message);
    setEntries(filterAuditEntries(data || []));
  }

  useEffect(() => { load(); }, [workspaceId]);

  async function restore(entry) {
    if (!canManage || !entry.old_data || !["process_templates", "process_template_steps", "process_runs", "process_run_tasks"].includes(entry.table_name)) return;
    if (!window.confirm("Deze vorige versie herstellen? De huidige versie blijft zichtbaar in het logboek.")) return;
    const { error } = await supabase.from(entry.table_name).upsert(entry.old_data, { onConflict: "id" });
    if (error) setMessage("Herstellen mislukt: " + error.message);
    else { setMessage("Vorige versie hersteld."); await load(); }
  }

  return <section className="panel">
    <div className="panelHead"><div><p className="eyebrow">WIJZIGINGSLOGBOEK</p><h2>Wie heeft wat gewijzigd?</h2></div><button type="button" className="secondary" onClick={load}>Verversen</button></div>
    {message && <div className="notice">{message}</div>}
    {entries.length === 0 ? <p>Nog geen wijzigingen in de processen geregistreerd.</p> : <div className="tableLike">{entries.map((entry) => <div className="task" key={entry.id}><div><strong>{auditActionLabel(entry.action)} · {auditTableLabel(entry.table_name)}</strong><span>{new Date(entry.created_at).toLocaleString("nl-NL")} · record {String(entry.record_id || "").slice(0, 8)} · door {String(entry.actor_id).slice(0, 8)}</span></div>{canManage && entry.old_data && <button type="button" className="secondary" onClick={() => restore(entry)}>Herstellen</button>}</div>)}</div>}
  </section>;
}

function filterAuditEntries(entries) {
  const processCreations = entries.filter((entry) => entry.table_name === "process_runs" && entry.action === "INSERT");
  const assignmentBatchCounts = entries.reduce((counts, entry) => {
    if (entry.table_name === "process_run_tasks" && entry.action === "UPDATE" && entry.new_data?.run_id) {
      const key = entry.new_data.run_id + "|" + entry.created_at;
      counts.set(key, (counts.get(key) || 0) + 1);
    }
    return counts;
  }, new Map());
  return entries.filter((entry) => {
    if (entry.action === "UPDATE" && entry.old_data && entry.new_data && entry.table_name === "process_runs") {
      const oldData = { ...entry.old_data }; const newData = { ...entry.new_data };
      delete oldData.updated_at; delete newData.updated_at;
      if (JSON.stringify(oldData) === JSON.stringify(newData)) return false;
    }
    if (entry.table_name === "process_run_tasks" && entry.action === "UPDATE" && entry.old_data && entry.new_data && entry.new_data.run_id) {
      const oldData = { ...entry.old_data }; const newData = { ...entry.new_data };
      delete oldData.assigned_to; delete newData.assigned_to; delete oldData.updated_at; delete newData.updated_at;
      const key = entry.new_data.run_id + "|" + entry.created_at;
      if (assignmentBatchCounts.get(key) >= 3 && JSON.stringify(oldData) === JSON.stringify(newData)) return false;
    }
    if (entry.table_name === "process_run_tasks" && entry.action === "INSERT" && entry.new_data?.run_id) {
      return !processCreations.some((processEntry) => processEntry.new_data?.id === entry.new_data.run_id && Math.abs(new Date(processEntry.created_at).getTime() - new Date(entry.created_at).getTime()) <= 10000);
    }
    return true;
  });
}

function auditActionLabel(action) { return { INSERT: "Aangemaakt", UPDATE: "Gewijzigd", DELETE: "Verwijderd" }[action] || action; }
function auditTableLabel(tableName) { return { process_templates: "proces", process_template_steps: "processtap", process_runs: "gestart proces", process_run_tasks: "procestaak" }[tableName] || tableName; }
