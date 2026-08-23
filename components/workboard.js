"use client";

import { useEffect, useMemo, useState } from "react";
import { supabase } from "../lib/supabase";

const TEMPLATE_HINTS = {
  event: "Evenement lanceren en promoten",
  dish: "Nieuw gerecht of drankje",
  menu: "Nieuwe menukaart",
  newsletter: "Nieuwsbrief",
  vacancy: "Vacature",
  grill_your_own: "Nieuw concept",
};

export default function Workboard({ workspaceId, businessId, userId, businesses = [], tasks = [], canManage = false, onRefresh }) {
  const [templates, setTemplates] = useState([]);
  const [steps, setSteps] = useState([]);
  const [runs, setRuns] = useState([]);
  const [processTasks, setProcessTasks] = useState([]);
  const [selectedTemplateId, setSelectedTemplateId] = useState("");
  const [name, setName] = useState("");
  const [anchorDate, setAnchorDate] = useState(new Date().toISOString().slice(0, 10));
  const [message, setMessage] = useState("");
  const [saving, setSaving] = useState(false);

  async function load() {
    if (!workspaceId) return;
    const [{ data: templateRows, error: templateError }, { data: stepRows }, { data: runRows }, { data: processTaskRows, error: processTaskError }] = await Promise.all([
      supabase.from("process_templates").select("*").eq("workspace_id", workspaceId).eq("active", true).order("name"),
      supabase.from("process_template_steps").select("*").eq("workspace_id", workspaceId).order("sort_order"),
      supabase.from("process_runs").select("*, process_templates(name), businesses(name)").eq("workspace_id", workspaceId).order("created_at", { ascending: false }).limit(12),
      supabase.from("process_run_tasks").select("*, process_runs(name)").eq("workspace_id", workspaceId).order("due_date", { ascending: true }).limit(200),
    ]);
    if (templateError || processTaskError) setMessage(templateError?.message || processTaskError?.message || "Procesgegevens konden niet worden geladen.");
    setTemplates(templateRows || []);
    setSteps(stepRows || []);
    setRuns(runRows || []);
    setProcessTasks(processTaskRows || []);
    setSelectedTemplateId((current) => current || templateRows?.[0]?.id || "");
  }

  useEffect(() => { load(); }, [workspaceId]);

  const selectedTemplate = templates.find((item) => item.id === selectedTemplateId);
  const selectedSteps = useMemo(() => steps.filter((item) => item.template_id === selectedTemplateId), [steps, selectedTemplateId]);
  const openTasks = tasks.filter((task) => task.status !== "done");
  const openProcessTasks = processTasks.filter((task) => task.status !== "done");
  const today = new Date().toISOString().slice(0, 10);
  const todayTasks = [...openTasks, ...openProcessTasks].filter((task) => task.due_date?.slice(0, 10) === today);
  const overdueTasks = [...openTasks, ...openProcessTasks].filter((task) => task.due_date && task.due_date.slice(0, 10) < today);

  async function createProcess(event) {
    event.preventDefault();
    if (!canManage || !selectedTemplate || !name.trim()) return;
    setSaving(true);
    setMessage("");
    const targetBusinessId = businessId === "all" ? businesses[0]?.id || null : businessId;
    const { data: run, error: runError } = await supabase.from("process_runs").insert({
      workspace_id: workspaceId,
      business_id: targetBusinessId,
      template_id: selectedTemplate.id,
      name: name.trim(),
      anchor_date: anchorDate,
      created_by: userId,
    }).select("*").single();
    if (runError) {
      setMessage(runError.message);
      setSaving(false);
      return;
    }
    const taskRows = selectedSteps.map((step) => {
      const due = new Date(anchorDate + "T12:00:00");
      due.setDate(due.getDate() + Number(step.relative_days || 0));
      return {
        workspace_id: workspaceId,
        business_id: targetBusinessId,
        run_id: run.id,
        template_step_id: step.id,
        title: step.title,
        description: step.description,
        due_date: due.toISOString().slice(0, 10),
        priority: step.priority || "medium",
        status: "not_started",
      };
    });
    const { error: taskError } = await supabase.from("process_run_tasks").insert(taskRows);
    if (taskError) {
      setMessage(taskError.message);
      setSaving(false);
      return;
    }
    const createdName = name.trim();
    setName("");
    setMessage("Proces gestart: " + createdName + " (" + taskRows.length + " taken)");
    setSaving(false);
    await load();
    onRefresh?.();
  }

  return (
    <>
      <section className="pageIntro">
        <p className="eyebrow">WERKBORD</p>
        <h2>Van idee naar uitvoering</h2>
        <p>Start een proces en Horeca OS maakt automatisch de bijbehorende checklist, deadlines en opvolging.</p>
      </section>

      {message && <div className="notice">{message}</div>}

      <section className="kpis secondary">
        <Metric label="Vandaag" value={todayTasks.length} sub="openstaande taken" />
        <Metric label="Te laat" value={overdueTasks.length} sub="directe opvolging nodig" />
        <Metric label="Openstaand" value={openTasks.length + openProcessTasks.length} sub="taken in Horeca OS" />
        <Metric label="Processen" value={runs.length} sub="recent gestart" />
      </section>

      <div className="dashboardGrid">
        <section className="panel">
          <div className="panelHead"><div><p className="eyebrow">NIEUW PROCES</p><h3>Wat wil je opstarten?</h3></div></div>
          {!canManage && <p>Je kunt processen bekijken. Een manager of eigenaar kan nieuwe processen starten.</p>}
          <form onSubmit={createProcess} className="stack">
            <label>Proces<select value={selectedTemplateId} onChange={(event) => setSelectedTemplateId(event.target.value)} disabled={!canManage}>{templates.map((template) => <option key={template.id} value={template.id}>{template.name}</option>)}</select></label>
            <label>Naam van dit initiatief<input value={name} onChange={(event) => setName(event.target.value)} placeholder="Bijvoorbeeld: Nieuw concept september" disabled={!canManage} /></label>
            <label>Start- of uitvoeringsdatum<input type="date" value={anchorDate} onChange={(event) => setAnchorDate(event.target.value)} disabled={!canManage} /></label>
            {businessId === "all" && <p className="muted">Er wordt standaard een vestiging gekozen. Kies bovenaan een vestiging als dit proces locatiegebonden is.</p>}
            <button className="primary" type="submit" disabled={!canManage || saving || !selectedTemplateId || !name.trim()}>{saving ? "Proces starten…" : "Proces starten"}</button>
          </form>
        </section>

        <section className="panel">
          <div className="panelHead"><div><p className="eyebrow">CHECKLIST</p><h3>{selectedTemplate?.name || "Kies een proces"}</h3></div></div>
          <p>{selectedTemplate?.description || "Selecteer een proces om de vaste stappen te bekijken."}</p>
          <ol className="processSteps">{selectedSteps.map((step) => <li key={step.id}><strong>{step.title}</strong><span>{(step.relative_days >= 0 ? "+" : "") + step.relative_days} dagen · {step.role_key || "team"} · {step.priority || "medium"}</span></li>)}</ol>
        </section>
      </div>

      <section className="panel">
        <div className="panelHead"><div><p className="eyebrow">OPVOLGING</p><h3>Recent gestarte processen</h3></div><button type="button" className="secondary" onClick={load}>Verversen</button></div>
        {runs.length === 0 ? <p>Er zijn nog geen processen gestart.</p> : <div className="tableLike">{runs.map((run) => <div className="task" key={run.id}><div><strong>{run.name}</strong><span>{run.process_templates?.name || "Proces"} · {run.businesses?.name || "Alle vestigingen"} · {run.anchor_date}</span></div><span className="pill">{run.status}</span></div>)}</div>}
      </section>

      <section className="panel">
        <div className="panelHead"><div><p className="eyebrow">PROCES-TAKEN</p><h3>Afvinken en opvolgen</h3></div><button type="button" className="secondary" onClick={load}>Verversen</button></div>
        {processTasks.length === 0 ? <p>Start een proces om de bijbehorende taken hier te zien.</p> : <div className="tableLike">{processTasks.map((task) => <ProcessTaskRow key={task.id} task={task} canManage={canManage} onChange={async (status) => {
          const { error } = await supabase.from("process_run_tasks").update({ status, completed_at: status === "done" ? new Date().toISOString() : null }).eq("id", task.id);
          if (error) setMessage(error.message); else { setMessage("Taak bijgewerkt."); await load(); onRefresh?.(); }
        }} />)}</div>}
      </section>

      <section className="panel">
        <div className="panelHead"><div><p className="eyebrow">VASTE PROCESBIBLIOTHEEK</p><h3>Beschikbare sjablonen</h3></div></div>
        <div className="templateGrid">{templates.map((template) => <button type="button" className={"templateCard " + (selectedTemplateId === template.id ? "selected" : "")} key={template.id} onClick={() => setSelectedTemplateId(template.id)}><strong>{TEMPLATE_HINTS[template.template_key] || template.name}</strong><span>{template.description}</span></button>)}</div>
      </section>
    </>
  );
}

function ProcessTaskRow({ task, canManage, onChange }) {
  return <div className={"task " + (task.priority || "medium")}>
    <div><strong>{task.title}</strong><span>{task.process_runs?.name || "Proces"} · deadline {task.due_date || "geen"} · {task.priority || "medium"}</span></div>
    <select value={task.status} disabled={!canManage} onChange={(event) => onChange(event.target.value)}>
      <option value="not_started">Niet gestart</option><option value="in_progress">Bezig</option><option value="blocked">Geblokkeerd</option><option value="done">Gereed</option>
    </select>
  </div>;
}

function Metric({ label, value, sub }) { return <div className="card"><span>{label}</span><strong>{value}</strong><small>{sub}</small></div>; }
