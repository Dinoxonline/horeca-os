"use client";

import { useEffect, useMemo, useState } from "react";
import { supabase } from "../lib/supabase";

const TEMPLATE_HINTS = {
  event: "Evenement lanceren en promoten",
  dish: "Nieuw gerecht of drankje",
  menu: "Nieuwe menukaart",
  newsletter: "Nieuwsbrief",
  marketing_campaign: "Promotiecampagne",
  daily_opening: "Dagelijkse opening",
  weekly_review: "Wekelijkse managementcheck",
  monthly_menu_review: "Maandelijkse menureview",
  vacancy: "Vacature",
  grill_your_own: "Nieuw concept",
};

export default function Workboard({ workspaceId, businessId, userId, businesses = [], tasks = [], canManage = false, canMonitor = false, onRefresh }) {
  const [templates, setTemplates] = useState([]);
  const [steps, setSteps] = useState([]);
  const [runs, setRuns] = useState([]);
  const [processTasks, setProcessTasks] = useState([]);
  const [members, setMembers] = useState([]);
  const [mineOnly, setMineOnly] = useState(!canMonitor);
  const [assignedFilter, setAssignedFilter] = useState("");
  const [customTemplate, setCustomTemplate] = useState({ name: "", category: "operations", description: "", steps: "" });
  const [dueFilter, setDueFilter] = useState("all");
  const [runFilter, setRunFilter] = useState("active");
  const [selectedTemplateId, setSelectedTemplateId] = useState("");
  const [name, setName] = useState("");
  const [anchorDate, setAnchorDate] = useState(new Date().toISOString().slice(0, 10));
  const [message, setMessage] = useState("");
  const [saving, setSaving] = useState(false);
  const [showCreateForm, setShowCreateForm] = useState(true);
  const [expandedRunId, setExpandedRunId] = useState(null);

  async function load() {
    if (!workspaceId) return;
    const [{ data: templateRows, error: templateError }, { data: stepRows }, { data: runRows }, { data: processTaskRows, error: processTaskError }, { data: memberRows }] = await Promise.all([
      supabase.from("process_templates").select("*").eq("workspace_id", workspaceId).eq("active", true).order("name"),
      supabase.from("process_template_steps").select("*").eq("workspace_id", workspaceId).order("sort_order"),
      supabase.from("process_runs").select("*, process_templates(name), businesses(name)").eq("workspace_id", workspaceId).order("created_at", { ascending: false }).limit(12),
      supabase.from("process_run_tasks").select("*, process_runs(name)").eq("workspace_id", workspaceId).order("due_date", { ascending: true }).limit(200),
      supabase.from("workspace_members").select("user_id").eq("workspace_id", workspaceId),
    ]);
    if (templateError || processTaskError) setMessage(templateError?.message || processTaskError?.message || "Procesgegevens konden niet worden geladen.");
    setTemplates(templateRows || []);
    setSteps(stepRows || []);
    setRuns(runRows || []);
    setProcessTasks(processTaskRows || []);
    const memberIds = (memberRows || []).map((item) => item.user_id).filter(Boolean);
    if (memberIds.length) {
      const { data: profileRows } = await supabase.from("profiles").select("id, full_name").in("id", memberIds).order("full_name");
      setMembers(profileRows || []);
    } else setMembers([]);
    setSelectedTemplateId((current) => current || templateRows?.[0]?.id || "");
  }

  useEffect(() => { load(); }, [workspaceId]);
  useEffect(() => { setMineOnly(!canMonitor); }, [canMonitor]);

  const selectedTemplate = templates.find((item) => item.id === selectedTemplateId);
  const selectedSteps = useMemo(() => steps.filter((item) => item.template_id === selectedTemplateId), [steps, selectedTemplateId]);
  const openTasks = tasks.filter((task) => task.status !== "done");
  const myRunIds = new Set(processTasks.filter((task) => task.assigned_to === userId).map((task) => task.run_id));
  const visibleRuns = runs.filter((run) => (runFilter === "all" || (runFilter === "active" ? run.status === "active" : run.status === "completed")) && (canMonitor || !mineOnly || myRunIds.has(run.id)));
  const processProgress = useMemo(() => processTasks.reduce((map, task) => {
    const current = map[task.run_id] || { total: 0, done: 0 };
    current.total += 1;
    if (task.status === "done") current.done += 1;
    map[task.run_id] = current;
    return map;
  }, {}), [processTasks]);
  const runAssignees = useMemo(() => processTasks.reduce((map, task) => {
    const current = map[task.run_id] || { assignedTo: task.assigned_to || "", mixed: false };
    if (current.assignedTo && task.assigned_to && current.assignedTo !== task.assigned_to) current.mixed = true;
    if (!current.assignedTo && task.assigned_to) current.assignedTo = task.assigned_to;
    map[task.run_id] = current;
    return map;
  }, {}), [processTasks]);
  const visibleProcessTasks = mineOnly ? processTasks.filter((task) => task.assigned_to === userId) : processTasks;
  const filteredProcessTasks = visibleProcessTasks.filter((task) => {
    const due = task.due_date?.slice(0, 10);
    if (assignedFilter && task.assigned_to !== assignedFilter) return false;
    if (dueFilter === "blocked") return task.status === "blocked";
    if (dueFilter === "today") return due === today;
    if (dueFilter === "overdue") return due && due < today;
    if (dueFilter === "upcoming") return due && due > today;
    return true;
  });
  const selectedProcessTasks = expandedRunId ? filteredProcessTasks.filter((task) => task.run_id === expandedRunId) : [];
  const openProcessTasks = visibleProcessTasks.filter((task) => task.status !== "done");
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
    setShowCreateForm(false);
    setSaving(false);
    await load();
    onRefresh?.();
  }

  async function assignRun(runId, memberId) {
    if (!canManage) return;
    const { error } = await supabase.from("process_run_tasks").update({ assigned_to: memberId || null }).eq("run_id", runId);
    if (error) setMessage(error.message);
    else {
      setMessage(memberId ? "Alle taken van dit proces zijn toegewezen." : "Toewijzing van dit proces verwijderd.");
      await load();
      onRefresh?.();
    }
  }

  return (
    <>
      <section className="pageIntro">
        <p className="eyebrow">WERKBORD</p>
        <h2>Van idee naar uitvoering</h2>
        <p>Start een proces en Horeca OS maakt automatisch de bijbehorende checklist, deadlines en opvolging.</p>
      </section>

      {message && <div className="notice">{message}</div>}
      {canMonitor && !canManage && <div className="notice">Je kijkt mee in dit Werkbord. Je kunt voortgang bekijken, maar geen taken toewijzen of wijzigen.</div>}

      <div className="taskLegend"><span><i style={{ display: "inline-block", width: 12, height: 12, borderRadius: 3, background: "#fff7ed", borderLeft: "4px solid #f59e0b", marginRight: 6 }} />Oranje: taak van iemand anders</span><span><i style={{ display: "inline-block", width: 12, height: 12, borderRadius: 3, background: "#f8fafc", marginRight: 6 }} />Normaal: jouw taak of niet toegewezen</span></div>

      <section className="kpis secondary">
        <Metric label="Vandaag" value={todayTasks.length} sub="openstaande taken" />
        <Metric label="Te laat" value={overdueTasks.length} sub="directe opvolging nodig" />
        <Metric label="Openstaand" value={openTasks.length + openProcessTasks.length} sub="taken in Horeca OS" />
        <Metric label="Processen" value={runs.length} sub="recent gestart" />
      </section>

      {canManage && <div className="dashboardGrid">
        <section className="panel">
          <div className="panelHead"><div><p className="eyebrow">WERKACTIE</p><h3>Proces starten</h3></div><button type="button" className="secondary" onClick={() => setShowCreateForm((value) => !value)}>{showCreateForm ? "Sluiten" : "Nieuw proces"}</button></div>
          {showCreateForm && <form onSubmit={createProcess} className="stack">
            <label>Proces<select value={selectedTemplateId} onChange={(event) => setSelectedTemplateId(event.target.value)} disabled={!canManage}>{templates.map((template) => <option key={template.id} value={template.id}>{template.name}</option>)}</select></label>
            <label>Naam van dit initiatief<input value={name} onChange={(event) => setName(event.target.value)} placeholder="Bijvoorbeeld: Nieuw concept september" disabled={!canManage} /></label>
            <label>Start- of uitvoeringsdatum<input type="date" value={anchorDate} onChange={(event) => setAnchorDate(event.target.value)} disabled={!canManage} /></label>
            {businessId === "all" && <p className="muted">Er wordt standaard een vestiging gekozen. Kies bovenaan een vestiging als dit proces locatiegebonden is.</p>}
            <button className="primary" type="submit" disabled={!canManage || saving || !selectedTemplateId || !name.trim()}>{saving ? "Proces starten…" : "Proces starten"}</button>
          </form>}
        </section>


      </div>}

      <section className="panel">
        <div className="panelHead"><div><p className="eyebrow">OPVOLGING</p><h3>Processen volgen</h3></div><div><button type="button" className={runFilter === "active" ? "primary" : "secondary"} onClick={() => setRunFilter("active")}>Actief</button> <button type="button" className={runFilter === "completed" ? "primary" : "secondary"} onClick={() => setRunFilter("completed")}>Afgerond</button> <button type="button" className={runFilter === "all" ? "primary" : "secondary"} onClick={() => setRunFilter("all")}>Alles</button> <button type="button" className="secondary" onClick={load}>Verversen</button></div></div>
        {visibleRuns.length === 0 ? <p>{runFilter === "completed" ? "Er zijn nog geen afgeronde processen." : "Er zijn geen actieve processen."}</p> : <div className="tableLike">{visibleRuns.map((run) => <div className={"task " + (expandedRunId === run.id ? "selected" : "")} key={run.id}><div><strong>{run.name}</strong><span>{run.process_templates?.name || "Proces"} · {run.businesses?.name || "Alle vestigingen"} · {run.anchor_date}</span><progress style={{ accentColor: run.status === "completed" ? "#16a34a" : processTasks.some((task) => task.run_id === run.id && task.status !== "done" && task.due_date && task.due_date < today) ? "#dc2626" : "#f59e0b" }} value={processProgress[run.id]?.done || 0} max={processProgress[run.id]?.total || 1} /><button type="button" className="secondary" onClick={() => setExpandedRunId((current) => current === run.id ? null : run.id)}>{processProgress[run.id]?.done || 0}/{processProgress[run.id]?.total || 0} gereed · {processTasks.filter((task) => task.run_id === run.id && task.status !== "done").length} openstaand · {processTasks.filter((task) => task.run_id === run.id && task.status !== "done" && task.due_date && task.due_date < today).length} te laat · {expandedRunId === run.id ? "Verberg taken" : "Bekijk taken"}</button></div><select value={runAssignees[run.id]?.mixed ? "__mixed__" : (runAssignees[run.id]?.assignedTo || "")} disabled={!canManage} onChange={(event) => assignRun(run.id, event.target.value === "__mixed__" ? "" : event.target.value)}><option value="">Hele proces toewijzen…</option>{runAssignees[run.id]?.mixed && <option value="__mixed__" disabled>Meerdere medewerkers</option>}{members.map((member) => <option key={member.id} value={member.id}>{member.full_name || member.id}</option>)}</select></div>)}</div>}
      </section>

      <section className="panel">
        <div className="panelHead"><div><p className="eyebrow">PROCES-TAKEN</p><h3>{expandedRunId ? (runs.find((run) => run.id === expandedRunId)?.name || "Geselecteerd proces") : "Taken bekijken"}</h3></div><div>{expandedRunId && <button type="button" className="secondary" onClick={() => setExpandedRunId(null)}>Sluiten</button>} <button type="button" className="secondary" onClick={() => setMineOnly((value) => !value)}>{mineOnly ? "Alle taken" : "Mijn taken"}</button> <button type="button" className="secondary" onClick={load}>Verversen</button></div></div>
        {!expandedRunId ? <p>Klik bij een proces op de voortgang om de onderliggende taken te bekijken.</p> : <><div className="filterRow"><select value={assignedFilter} onChange={(event) => setAssignedFilter(event.target.value)}><option value="">Alle medewerkers</option>{members.map((member) => <option key={member.id} value={member.id}>{member.full_name || member.id}</option>)}</select><button type="button" className={dueFilter === "all" ? "primary" : "secondary"} onClick={() => setDueFilter("all")}>Alle</button><button type="button" className={dueFilter === "today" ? "primary" : "secondary"} onClick={() => setDueFilter("today")}>Vandaag</button><button type="button" className={dueFilter === "overdue" ? "primary" : "secondary"} onClick={() => setDueFilter("overdue")}>Te laat</button><button type="button" className={dueFilter === "blocked" ? "primary" : "secondary"} onClick={() => setDueFilter("blocked")}>Geblokkeerd</button><button type="button" className={dueFilter === "upcoming" ? "primary" : "secondary"} onClick={() => setDueFilter("upcoming")}>Komend</button></div>
        {selectedProcessTasks.length === 0 ? <p>{mineOnly ? "Er zijn geen taken aan jou toegewezen." : "Geen taken voor deze filter."}</p> : <div className="tableLike">{selectedProcessTasks.map((task) => <ProcessTaskRow key={task.id} task={task} members={members} currentUserId={userId} canManage={canManage} canAct={canManage || task.assigned_to === userId} onUpdate={async (patch) => {
          const { error } = await supabase.from("process_run_tasks").update(patch).eq("id", task.id);
          if (error) setMessage(error.message); else { setMessage("Taak bijgewerkt."); await load(); onRefresh?.(); }
        }} />)}</div>}</>}
      </section>




    </>
  );
}

function ProcessTaskRow({ task, members, currentUserId, canManage, canAct, onUpdate }) {
  const assignedMember = members.find((member) => member.id === task.assigned_to);
  const belongsToOther = Boolean(task.assigned_to && task.assigned_to !== currentUserId);
  const statuses = [
    { value: "not_started", label: task.assigned_to ? "Toegewezen" : "Niet toegewezen" },
    { value: "in_progress", label: "Bezig" },
    { value: "blocked", label: "Geblokkeerd" },
    { value: "done", label: "Gereed" },
  ];
  const statusIndex = statuses.findIndex((item) => item.value === task.status);
  return <div className={"task " + (task.priority || "medium") + (belongsToOther ? " taskAssignedElsewhere" : "")} style={belongsToOther ? { background: "#fff7ed", borderLeft: "4px solid #f59e0b" } : undefined}>
    <div><strong>{task.title}</strong>{task.description && <small>{task.description}</small>}<span>{task.process_runs?.name || "Proces"} · deadline {task.due_date || "geen"} · {belongsToOther ? `Door ${assignedMember?.full_name || "een andere medewerker"}` : task.assigned_to ? "Aan jou toegewezen" : "nog toe te wijzen"} · {task.priority || "medium"}</span></div>
    <select value={task.assigned_to || ""} disabled={!canManage} onChange={(event) => onUpdate({ assigned_to: event.target.value || null })}>
      <option value="">Niet toegewezen</option>{members.map((member) => <option key={member.id} value={member.id}>{member.full_name || member.id}</option>)}
    </select>
    <div className="statusBar" aria-label="Voortgang taak">
      {statuses.map((status, index) => {
        const isCurrent = task.status === status.value;
        const canSelect = canManage || (canAct && index > statusIndex && task.status !== "blocked" && task.status !== "done");
        return <button type="button" key={status.value} className={isCurrent ? "primary" : "secondary"} disabled={!canSelect && !isCurrent} onClick={() => canSelect && onUpdate({ status: status.value, completed_at: status.value === "done" ? new Date().toISOString() : null })}>{status.label}</button>;
      })}
    </div>
    {task.status === "blocked" && <input defaultValue={task.blocker_note || ""} placeholder="Waarom geblokkeerd?" disabled={!canAct} onBlur={(event) => onUpdate({ blocker_note: event.target.value.trim() || null })} />}
  </div>;
}

function Metric({ label, value, sub }) { return <div className="card"><span>{label}</span><strong>{value}</strong><small>{sub}</small></div>; }
