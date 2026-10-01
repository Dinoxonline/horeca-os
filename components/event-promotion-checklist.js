"use client";

import { useEffect, useState } from "react";
import { ensureEventPromotionProcess, eventPromotionProgress, loadEventPromotionProcess } from "../lib/event-promotion-process";
import { supabase } from "../lib/supabase";

export default function EventPromotionChecklist({ workspaceId, businessId, marketingItemId, title, start, userId, compact = false }) {
  const [process, setProcess] = useState({ run: null, tasks: [] });
  const [loading, setLoading] = useState(true);
  const [starting, setStarting] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [updatingTaskId, setUpdatingTaskId] = useState("");
  const [message, setMessage] = useState("");

  useEffect(() => {
    let active = true;
    if (!workspaceId || !marketingItemId) return undefined;
    setLoading(true);
    loadEventPromotionProcess(supabase, { workspaceId, marketingItemId })
      .then((next) => { if (active) setProcess(next); })
      .catch((error) => { if (active) setMessage(error.message || "De promotiechecklist kon niet worden geladen."); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [workspaceId, marketingItemId]);

  async function startChecklist() {
    setStarting(true); setMessage("");
    try {
      setProcess(await ensureEventPromotionProcess(supabase, { workspaceId, businessId, marketingItemId, title, start, createdBy: userId }));
      setExpanded(true);
    }
    catch (error) { setMessage(error.message || "De promotiechecklist kon niet worden gestart."); }
    finally { setStarting(false); }
  }

  async function toggleTask(task) {
    setUpdatingTaskId(task.id); setMessage("");
    const nextStatus = task.status === "done" ? "not_started" : "done";
    const { error } = await supabase.from("process_run_tasks").update({ status: nextStatus })
      .eq("workspace_id", workspaceId).eq("id", task.id);
    if (error) setMessage(error.message || "De taak kon niet worden bijgewerkt.");
    else setProcess((current) => ({ ...current, tasks: current.tasks.map((item) => item.id === task.id ? { ...item, status: nextStatus } : item) }));
    setUpdatingTaskId("");
  }

  const progress = eventPromotionProgress(process.tasks);
  const nextTask = process.tasks.find((task) => task.status !== "done");
  return <section style={{ display: "grid", gap: 8, marginTop: compact ? 10 : 14, padding: compact ? 12 : 14, border: "1px solid #cbdde5", borderLeft: "4px solid #25889b", borderRadius: 8, background: "#f7fbfc" }}>
    <div><h4 style={{ margin: 0 }}>Promotiechecklist</h4><p style={{ margin: "4px 0 0", color: "#405866", fontSize: 13 }}>Alle handmatige promotietaken voor dit evenement, zonder automatische plaatsing.</p></div>
    {loading ? <small>Checklist laden…</small> : process.run ? <><strong>{progress.done}/{progress.total} taken gereed</strong>{nextTask && <small>Volgende stap: {nextTask.title}</small>}<button type="button" className="secondaryButton" onClick={() => setExpanded((value) => !value)}>{expanded ? "Taken verbergen" : "Taken bekijken en afvinken"}</button>{expanded && <ol style={{ display: "grid", gap: 7, margin: 0, paddingLeft: 22 }}>{process.tasks.map((task) => <li key={task.id} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, padding: "7px 0", borderBottom: "1px solid #dce9ee" }}><span style={{ textDecoration: task.status === "done" ? "line-through" : "none", color: task.status === "done" ? "#51717d" : "#173552" }}>{task.title}</span><button type="button" className="secondaryButton" disabled={updatingTaskId === task.id} onClick={() => toggleTask(task)}>{updatingTaskId === task.id ? "Opslaan…" : task.status === "done" ? "Opnieuw openen" : "Gereed"}</button></li>)}</ol>}</> : <button type="button" className="secondaryButton" disabled={starting} onClick={startChecklist}>{starting ? "Checklist starten…" : "Promotiechecklist starten"}</button>}
    {message && <small role="alert">{message}</small>}
  </section>;
}
