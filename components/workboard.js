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
  const [auditEntries, setAuditEntries] = useState([]);
  const [trashRuns, setTrashRuns] = useState([]);
  const [showTrash, setShowTrash] = useState(false);
  const [logEntries, setLogEntries] = useState([]);
  const [newLog, setNewLog] = useState({ title: "", body: "", category: "overdracht", severity: "normaal" });
  const [members, setMembers] = useState([]);
  const [mineOnly, setMineOnly] = useState(!canMonitor);
  const [assignedFilter, setAssignedFilter] = useState("");
  const [customTemplate, setCustomTemplate] = useState({ name: "", category: "operations", description: "", steps: "" });
  const [dueFilter, setDueFilter] = useState("all");
  const [runFilter, setRunFilter] = useState("active");
  const [selectedTemplateId, setSelectedTemplateId] = useState("");
  const [selectedModuleIds, setSelectedModuleIds] = useState([]);
  const [moduleToAdd, setModuleToAdd] = useState("");
  const [name, setName] = useState("");
  const [anchorDate, setAnchorDate] = useState(new Date().toISOString().slice(0, 10));
  const [message, setMessage] = useState("");
  const [saving, setSaving] = useState(false);
  const [showCreateForm, setShowCreateForm] = useState(true);
  const [expandedRunId, setExpandedRunId] = useState(null);
  const [showAddTaskForm, setShowAddTaskForm] = useState(false);
  const [newTask, setNewTask] = useState({ title: "", description: "", dueDate: "", priority: "medium", assignedTo: "", requiresEvidence: false });

  async function load() {
    if (!workspaceId) return;
    const [{ data: templateRows, error: templateError }, { data: stepRows }, { data: runRows }, { data: processTaskRows, error: processTaskError }, { data: memberRows }, { data: auditRows, error: auditError }, { data: logRows, error: logError }] = await Promise.all([
      supabase.from("process_templates").select("*").eq("workspace_id", workspaceId).eq("active", true).order("name"),
      supabase.from("process_template_steps").select("*").eq("workspace_id", workspaceId).order("sort_order"),
      supabase.from("process_runs").select("*, process_templates(name), businesses(name)").eq("workspace_id", workspaceId).is("deleted_at", null).order("created_at", { ascending: false }).limit(12),
      supabase.from("process_run_tasks").select("*, process_runs(name)").eq("workspace_id", workspaceId).order("due_date", { ascending: true }).limit(200),
      supabase.from("workspace_members").select("user_id").eq("workspace_id", workspaceId),
      supabase.from("audit_log").select("id, actor_id, table_name, action, record_id, old_data, new_data, created_at").eq("workspace_id", workspaceId).in("table_name", ["process_templates", "process_template_steps", "process_runs", "process_run_tasks"]).order("created_at", { ascending: false }).limit(30),
      supabase.from("manager_log_entries").select("id, entry_date, category, title, body, severity, resolved_at, created_at").eq("workspace_id", workspaceId).order("entry_date", { ascending: false }).order("created_at", { ascending: false }).limit(30),
    ]);
    if (templateError || processTaskError || auditError || logError) setMessage(templateError?.message || processTaskError?.message || auditError?.message || logError?.message || "Procesgegevens konden niet worden geladen.");
    setTemplates(templateRows || []);
    setSteps(stepRows || []);
    setRuns(runRows || []);
    const { data: trashRows } = await supabase.from("process_runs").select("*, process_templates(name), businesses(name)").eq("workspace_id", workspaceId).not("deleted_at", "is", null).order("deleted_at", { ascending: false }).limit(50);
    setTrashRuns(trashRows || []);
    setProcessTasks(processTaskRows || []);
    setAuditEntries(filterAuditEntries((auditRows || []).filter((entry) => entry.actor_id)));
    setLogEntries(logRows || []);
    const memberIds = (memberRows || []).map((item) => item.user_id).filter(Boolean);
    if (memberIds.length) {
      const [{ data: profileRows }, { data: employeeRows }] = await Promise.all([
        supabase.from("profiles").select("id, full_name").in("id", memberIds).order("full_name"),
        supabase.from("employee_profiles").select("user_id, functions, robuust_roles").eq("workspace_id", workspaceId).in("user_id", memberIds),
      ]);
      const employeeByUserId = new Map((employeeRows || []).map((item) => [item.user_id, item]));
      setMembers((profileRows || []).map((profile) => ({ ...profile, ...(employeeByUserId.get(profile.id) || {}) })));
    } else setMembers([]);
    setSelectedTemplateId((current) => current || templateRows?.[0]?.id || "");
  }

  async function moveProcessToTrash(run) {
    if (!canManage) return;
    if (!window.confirm("Proces naar de prullenbak verplaatsen? De taken blijven bewaard en kunnen worden hersteld.")) return;
    if (!window.confirm("Weet u het zeker? Het proces verdwijnt uit het Werkbord totdat u het herstelt.")) return;
    const { error } = await supabase.from("process_runs").update({ deleted_at: new Date().toISOString(), deleted_by: userId }).eq("workspace_id", workspaceId).eq("id", run.id);
    if (error) setMessage("Verwijderen mislukt: " + error.message);
    else {
      setMessage("Proces naar de prullenbak verplaatst.");
      setExpandedRunId(null);
      await load();
      onRefresh?.();
    }
  }

  async function restoreProcess(run) {
    if (!canManage) return;
    if (!window.confirm("Dit proces terugzetten naar het Werkbord?")) return;
    const { error } = await supabase.from("process_runs").update({ deleted_at: null, deleted_by: null }).eq("workspace_id", workspaceId).eq("id", run.id);
    if (error) setMessage("Herstellen mislukt: " + error.message);
    else {
      setMessage("Proces hersteld.");
      await load();
      onRefresh?.();
    }
  }

  async function permanentlyDeleteProcess(run) {
    if (!canManage) return;
    if (!window.confirm("Definitief verwijderen? Alle bijbehorende procestaken worden ook verwijderd.")) return;
    if (!window.confirm("Weet u het zeker? Dit kan niet meer ongedaan worden gemaakt.")) return;
    const { error } = await supabase.from("process_runs").delete().eq("workspace_id", workspaceId).eq("id", run.id);
    if (error) setMessage("Definitief verwijderen mislukt: " + error.message);
    else {
      setMessage("Proces definitief verwijderd.");
      await load();
      onRefresh?.();
    }
  }

  async function resolveLogEntry(entry) {
    if (!canManage) return;
    const { error } = await supabase.from("manager_log_entries").update({ resolved_at: entry.resolved_at ? null : new Date().toISOString() }).eq("workspace_id", workspaceId).eq("id", entry.id);
    if (error) setMessage("Logboeknotitie bijwerken mislukt: " + error.message);
    else {
      setMessage(entry.resolved_at ? "Notitie opnieuw geopend." : "Notitie gemarkeerd als opgelost.");
      await load();
    }
  }

  async function createLogEntry(event) {
    event.preventDefault();
    if (!canManage || !newLog.title.trim() || !newLog.body.trim()) return;
    const { error } = await supabase.from("manager_log_entries").insert({
      workspace_id: workspaceId,
      business_id: businessId === "all" ? businesses[0]?.id || null : businessId,
      entry_date: new Date().toISOString().slice(0, 10),
      category: newLog.category,
      title: newLog.title.trim(),
      body: newLog.body.trim(),
      severity: newLog.severity,
      created_by: userId,
    });
    if (error) {
      setMessage("Logboeknotitie opslaan mislukt: " + error.message);
      return;
    }
    setNewLog({ title: "", body: "", category: "overdracht", severity: "normaal" });
    setMessage("Notitie aan manager-logboek toegevoegd.");
    await load();
  }

  async function restoreAuditEntry(entry) {
    if (!canManage || !entry.old_data || !["process_templates", "process_template_steps", "process_runs", "process_run_tasks"].includes(entry.table_name)) return;
    if (!window.confirm("Deze vorige versie herstellen? De huidige versie blijft zichtbaar in het logboek.")) return;
    setMessage("");
    const { error } = await supabase.from(entry.table_name).upsert(entry.old_data, { onConflict: "id" });
    if (error) {
      setMessage("Herstellen mislukt: " + error.message);
      return;
    }
    setMessage("Vorige versie hersteld.");
    await load();
    onRefresh?.();
  }

  useEffect(() => { load(); }, [workspaceId]);
  useEffect(() => { setMineOnly(!canMonitor); }, [canMonitor]);

  const selectedTemplate = templates.find((item) => item.id === selectedTemplateId);
  const selectedSteps = useMemo(() => steps.filter((item) => item.template_id === selectedTemplateId), [steps, selectedTemplateId]);
  const moduleTemplates = useMemo(() => templates.filter((item) => item.id !== selectedTemplateId && item.can_be_added_as_module), [templates, selectedTemplateId]);
  const selectedModuleSteps = useMemo(() => steps.filter((item) => selectedModuleIds.includes(item.template_id)), [steps, selectedModuleIds]);
  const availableModuleTemplates = useMemo(() => templates.filter((item) => item.can_be_added_as_module), [templates]);
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
  const today = new Date().toISOString().slice(0, 10);
  const filteredProcessTasks = visibleProcessTasks.filter((task) => {
    const due = task.due_date?.slice(0, 10);
    if (assignedFilter && task.assigned_to !== assignedFilter) return false;
    if (dueFilter === "blocked") return task.status === "blocked";
    if (dueFilter === "today") return due === today;
    if (dueFilter === "overdue") return due && due < today;
    if (dueFilter === "upcoming") return due && due > today;
    return true;
  });
  const selectedProcessTasks = expandedRunId === "__all__" ? filteredProcessTasks : expandedRunId ? filteredProcessTasks.filter((task) => task.run_id === expandedRunId) : [];
  const openProcessTasks = visibleProcessTasks.filter((task) => task.status !== "done");
  const todayTasks = [...openTasks, ...openProcessTasks].filter((task) => task.due_date?.slice(0, 10) === today);
  const overdueTasks = [...openTasks, ...openProcessTasks].filter((task) => task.due_date && task.due_date.slice(0, 10) < today);
  const blockedTasks = openProcessTasks.filter((task) => task.status === "blocked");

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
    const taskRows = [...selectedSteps, ...selectedModuleSteps].map((step) => {
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
        assigned_to: step.role_key ? members.find((member) => [...(member.functions || []), ...(member.robuust_roles || [])].some((role) => String(role).toLowerCase() === String(step.role_key).toLowerCase()))?.id || null : null,
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

  function runAssignmentLabel(runId) {
    const assignment = runAssignees[runId];
    if (!assignment?.assignedTo) return "Nog niet toegewezen";
    if (assignment.mixed) return "Meerdere medewerkers";
    const member = members.find((item) => item.id === assignment.assignedTo);
    return "Toegewezen aan " + (member?.full_name || "medewerker");
  }

  async function addModuleToRun(runId, moduleId) {
    if (!canManage || !runId || !moduleId) return;
    const run = runs.find((item) => item.id === runId);
    const moduleSteps = steps.filter((step) => step.template_id === moduleId && !processTasks.some((task) => task.run_id === runId && task.template_step_id === step.id));
    if (!run || moduleSteps.length === 0) {
      setMessage(moduleSteps.length === 0 ? "Dit onderdeel is al toegevoegd." : "Proces niet gevonden.");
      return;
    }
    const taskRows = moduleSteps.map((step) => {
      const due = new Date(run.anchor_date + "T12:00:00");
      due.setDate(due.getDate() + Number(step.relative_days || 0));
      return {
        workspace_id: workspaceId,
        business_id: run.business_id,
        run_id: run.id,
        template_step_id: step.id,
        title: step.title,
        description: step.description,
        due_date: due.toISOString().slice(0, 10),
        priority: step.priority || "medium",
        assigned_to: step.role_key ? members.find((member) => [...(member.functions || []), ...(member.robuust_roles || [])].some((role) => String(role).toLowerCase() === String(step.role_key).toLowerCase()))?.id || null : null,
        status: "not_started",
      };
    });
    const { error } = await supabase.from("process_run_tasks").insert(taskRows);
    if (error) setMessage("Onderdeel toevoegen mislukt: " + error.message);
    else {
      setModuleToAdd("");
      setMessage("Onderdeel toegevoegd aan dit proces.");
      await load();
      onRefresh?.();
    }
  }

  async function createSubtask(parentTask, title) {
    if (!canManage || !title.trim()) return;
    const { error } = await supabase.from("process_run_tasks").insert({
      workspace_id: workspaceId,
      business_id: parentTask.business_id,
      run_id: parentTask.run_id,
      template_step_id: null,
      parent_task_id: parentTask.id,
      title: title.trim(),
      description: null,
      due_date: parentTask.due_date,
      priority: parentTask.priority || "medium",
      assigned_to: parentTask.assigned_to || null,
      status: "not_started",
    });
    if (error) setMessage("Subtaak toevoegen mislukt: " + error.message);
    else {
      setMessage("Subtaak toegevoegd.");
      await load();
      onRefresh?.();
    }
  }

  async function assignRun(runId, memberId) {
    if (!canManage) return;
    const { error } = await supabase.from("process_run_tasks").update({ assigned_to: memberId || null }).eq("workspace_id", workspaceId).eq("run_id", runId);
    if (error) setMessage(error.message);
    else {
      setMessage(memberId ? "Alle taken van dit proces zijn toegewezen." : "Toewijzing van dit proces verwijderd.");
      await load();
      onRefresh?.();
    }
  }

  function resetNewTask() {
    setNewTask({ title: "", description: "", dueDate: "", priority: "medium", assignedTo: "", requiresEvidence: false });
  }

  async function createCustomTask(event) {
    event.preventDefault();
    if (!canManage || !expandedRunId || expandedRunId === "__all__" || !newTask.title.trim()) return;
    const currentRun = runs.find((run) => run.id === expandedRunId);
    const { error } = await supabase.from("process_run_tasks").insert({
      workspace_id: workspaceId,
      business_id: currentRun?.business_id || null,
      run_id: expandedRunId,
      template_step_id: null,
      title: newTask.title.trim(),
      description: newTask.description.trim() || null,
      due_date: newTask.dueDate || null,
      priority: newTask.priority,
      assigned_to: newTask.assignedTo || null,
      requires_evidence: newTask.requiresEvidence,
      status: "not_started",
    });
    if (error) {
      setMessage(error.message);
      return;
    }
    setMessage("Extra taak toegevoegd aan dit proces.");
    setShowAddTaskForm(false);
    resetNewTask();
    await load();
    onRefresh?.();
  }

  return (
    <>
      <section className="pageIntro">
        <p className="eyebrow">WERKBORD</p>
        <h2>Van idee naar uitvoering</h2>
        <p>Start een proces en Horeca OS maakt automatisch de bijbehorende checklist, deadlines, roltoewijzing en opvolging.</p>
      </section>

      {message && <div className="notice">{message}</div>}
      {canMonitor && !canManage && <div className="notice">Je kijkt mee in dit Werkbord. Je kunt voortgang bekijken, maar geen taken toewijzen of wijzigen.</div>}

      <div className="taskLegend"><span><i style={{ display: "inline-block", width: 12, height: 12, borderRadius: 3, background: "#fff7ed", borderLeft: "4px solid #f59e0b", marginRight: 6 }} />Oranje: taak van iemand anders</span><span><i style={{ display: "inline-block", width: 12, height: 12, borderRadius: 3, background: "#f8fafc", marginRight: 6 }} />Normaal: jouw taak of niet toegewezen</span></div>

      <section className="kpis secondary">
        <Metric label="Vandaag" value={todayTasks.length} sub="openstaande taken" onClick={() => { setDueFilter("today"); const task = openProcessTasks.find((item) => item.due_date?.slice(0, 10) === today); if (task) setExpandedRunId(task.run_id); }} />
        <Metric label="Te laat" value={overdueTasks.length} sub="directe opvolging nodig" onClick={() => { setDueFilter("overdue"); const task = openProcessTasks.find((item) => item.due_date && item.due_date.slice(0, 10) < today); if (task) setExpandedRunId(task.run_id); }} />
        <Metric label="Geblokkeerd" value={blockedTasks.length} sub="hulp of besluit nodig" onClick={() => { setDueFilter("blocked"); if (blockedTasks[0]) setExpandedRunId(blockedTasks[0].run_id); }} />
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
            {moduleTemplates.length > 0 && <fieldset><legend>Onderdelen toevoegen (optioneel)</legend><p className="muted">Kies alleen wat bij dit proces hoort. De gekozen onderdelen worden als extra taken toegevoegd.</p>{moduleTemplates.map((module) => <label key={module.id}><input type="checkbox" checked={selectedModuleIds.includes(module.id)} onChange={(event) => setSelectedModuleIds((current) => event.target.checked ? [...current, module.id] : current.filter((id) => id !== module.id))} disabled={!canManage} /> {module.name}</label>)}</fieldset>}
            {businessId === "all" && <p className="muted">Er wordt standaard een vestiging gekozen. Kies bovenaan een vestiging als dit proces locatiegebonden is.</p>}
            <button className="primary" type="submit" disabled={!canManage || saving || !selectedTemplateId || !name.trim()}>{saving ? "Proces starten…" : "Proces starten"}</button>
          </form>}
        </section>


      </div>}

      <section className="panel">
        <div className="panelHead"><div><p className="eyebrow">OPVOLGING</p><h3>Processen volgen</h3></div><div><button type="button" className={runFilter === "active" ? "primary" : "secondary"} onClick={() => setRunFilter("active")}>Actief</button> <button type="button" className={runFilter === "completed" ? "primary" : "secondary"} onClick={() => setRunFilter("completed")}>Afgerond</button> <button type="button" className={runFilter === "all" ? "primary" : "secondary"} onClick={() => setRunFilter("all")}>Alles</button> <button type="button" className="secondary" onClick={load}>Verversen</button></div></div>
        {visibleRuns.length === 0 ? <p>{runFilter === "completed" ? "Er zijn nog geen afgeronde processen." : "Er zijn geen actieve processen."}</p> : <div className="tableLike">{visibleRuns.map((run) => <div className={"task " + (expandedRunId === run.id ? "selected" : "")} key={run.id}><div><strong>{run.name}</strong><span>{run.process_templates?.name || "Proces"} · {run.businesses?.name || "Alle vestigingen"} · {run.anchor_date} · {run.status === "completed" ? "Afgerond" : "Actief"} · {runAssignmentLabel(run.id)}</span><progress style={{ accentColor: run.status === "completed" ? "#16a34a" : processTasks.some((task) => task.run_id === run.id && task.status !== "done" && task.due_date && task.due_date < today) ? "#dc2626" : "#f59e0b" }} value={processProgress[run.id]?.done || 0} max={processProgress[run.id]?.total || 1} /><button type="button" className="secondary" onClick={() => setExpandedRunId((current) => current === run.id ? null : run.id)}>{processProgress[run.id]?.done || 0}/{processProgress[run.id]?.total || 0} gereed · {processTasks.filter((task) => task.run_id === run.id && task.status !== "done").length} openstaand · {processTasks.filter((task) => task.run_id === run.id && task.status !== "done" && task.due_date && task.due_date < today).length} te laat · {expandedRunId === run.id ? "Verberg taken" : "Bekijk taken"}</button></div><div className="toolbar"><select value={runAssignees[run.id]?.mixed ? "__mixed__" : (runAssignees[run.id]?.assignedTo || "")} disabled={!canManage} onChange={(event) => assignRun(run.id, event.target.value === "__mixed__" ? "" : event.target.value)}><option value="">Hele proces toewijzen…</option>{runAssignees[run.id]?.mixed && <option value="__mixed__" disabled>Meerdere medewerkers</option>}{members.map((member) => <option key={member.id} value={member.id}>{member.full_name || member.id}</option>)}</select>{canManage && <button type="button" className="secondary" onClick={() => moveProcessToTrash(run)} title="Naar prullenbak">🗑️</button>}</div></div>)}</div>}
      </section>

      <section className="panel">
        <div className="panelHead"><div><p className="eyebrow">PROCES-TAKEN</p><h3>{expandedRunId === "__all__" ? "Alle procestaken" : expandedRunId ? (runs.find((run) => run.id === expandedRunId)?.name || "Geselecteerd proces") : "Taken bekijken"}</h3></div><div>{!expandedRunId && <button type="button" className="secondary" onClick={() => { setDueFilter("all"); setAssignedFilter(""); setExpandedRunId("__all__"); }}>Alle procestaken</button>} {expandedRunId && expandedRunId !== "__all__" && canManage && <><button type="button" className="secondary" onClick={() => setShowAddTaskForm((value) => !value)}>{showAddTaskForm ? "Sluiten" : "Extra taak"}</button><select value={moduleToAdd} onChange={(event) => setModuleToAdd(event.target.value)}><option value="">Onderdeel toevoegen…</option>{availableModuleTemplates.map((module) => <option key={module.id} value={module.id}>{module.name}</option>)}</select><button type="button" className="secondary" disabled={!moduleToAdd} onClick={() => addModuleToRun(expandedRunId, moduleToAdd)}>Toevoegen</button></>} {expandedRunId && <button type="button" className="secondary" onClick={() => { setExpandedRunId(null); setShowAddTaskForm(false); resetNewTask(); }}>Sluiten</button>} <button type="button" className="secondary" onClick={() => setMineOnly((value) => !value)}>{mineOnly ? "Alle taken" : "Mijn taken"}</button> <button type="button" className="secondary" onClick={load}>Verversen</button></div></div>
        {showAddTaskForm && expandedRunId && expandedRunId !== "__all__" && canManage && <form onSubmit={createCustomTask} className="panel stack" style={{ marginTop: 12 }}>
          <div><strong>Extra stap aan dit proces toevoegen</strong><p className="muted">Deze taak komt alleen in dit gestarte proces en verandert de basistaken niet.</p></div>
          <label>Taak<input required value={newTask.title} onChange={(event) => setNewTask((current) => ({ ...current, title: event.target.value }))} placeholder="Bijvoorbeeld: QR-codes uitrollen in Grand Café en Caribbean Corner" /></label>
          <label>Omschrijving<textarea value={newTask.description} onChange={(event) => setNewTask((current) => ({ ...current, description: event.target.value }))} placeholder="Beschrijf de tussenstap of het gewenste resultaat." /></label>
          <div className="formGrid">
            <label>Deadline<input type="date" value={newTask.dueDate} onChange={(event) => setNewTask((current) => ({ ...current, dueDate: event.target.value }))} /></label>
            <label>Prioriteit<select value={newTask.priority} onChange={(event) => setNewTask((current) => ({ ...current, priority: event.target.value }))}><option value="critical">Kritiek</option><option value="high">Hoog</option><option value="medium">Normaal</option><option value="low">Laag</option></select></label>
            <label>Toewijzen aan<select value={newTask.assignedTo} onChange={(event) => setNewTask((current) => ({ ...current, assignedTo: event.target.value }))}><option value="">Niet toegewezen</option>{members.map((member) => <option key={member.id} value={member.id}>{member.full_name || member.id}</option>)}</select></label>
          </div>
          <label><input type="checkbox" checked={newTask.requiresEvidence} onChange={(event) => setNewTask((current) => ({ ...current, requiresEvidence: event.target.checked }))} /> Bewijs of oplevernotitie verplicht</label>
          <div className="toolbar"><button className="primary" type="submit">Extra taak toevoegen</button><button type="button" className="secondary" onClick={() => { setShowAddTaskForm(false); resetNewTask(); }}>Annuleren</button></div>
        </form>}
        {!expandedRunId ? <p>Klik bij een proces op de voortgang om de onderliggende taken te bekijken.</p> : <><div className="filterRow"><select value={assignedFilter} onChange={(event) => setAssignedFilter(event.target.value)}><option value="">Alle medewerkers</option>{members.map((member) => <option key={member.id} value={member.id}>{member.full_name || member.id}</option>)}</select><button type="button" className={dueFilter === "all" ? "primary" : "secondary"} onClick={() => setDueFilter("all")}>Alle</button><button type="button" className={dueFilter === "today" ? "primary" : "secondary"} onClick={() => setDueFilter("today")}>Vandaag</button><button type="button" className={dueFilter === "overdue" ? "primary" : "secondary"} onClick={() => setDueFilter("overdue")}>Te laat</button><button type="button" className={dueFilter === "blocked" ? "primary" : "secondary"} onClick={() => setDueFilter("blocked")}>Geblokkeerd</button><button type="button" className={dueFilter === "upcoming" ? "primary" : "secondary"} onClick={() => setDueFilter("upcoming")}>Komend</button></div>
        {selectedProcessTasks.length === 0 ? <p>{mineOnly ? "Er zijn geen taken aan jou toegewezen." : "Geen taken voor deze filter."}</p> : <div className="tableLike">{selectedProcessTasks.map((task) => <ProcessTaskRow key={task.id} task={task} members={members} currentUserId={userId} canManage={canManage} canAct={canManage || task.assigned_to === userId} onCreateSubtask={createSubtask} onUpdate={async (patch) => {
          const { error } = await supabase.from("process_run_tasks").update(patch).eq("workspace_id", workspaceId).eq("id", task.id);
          if (error) setMessage(error.message); else { setMessage("Taak bijgewerkt."); await load(); onRefresh?.(); }
        }} />)}</div>}</>}
      </section>




    </>
  );
}

function ProcessTaskRow({ task, members, currentUserId, canManage, canAct, onCreateSubtask, onUpdate }) {
  const [completionNote, setCompletionNote] = useState(task.completion_note || "");
  const [evidenceUrl, setEvidenceUrl] = useState(task.evidence_url || "");
  const [showSubtaskForm, setShowSubtaskForm] = useState(false);
  const [subtaskTitle, setSubtaskTitle] = useState("");
  const assignedMember = members.find((member) => member.id === task.assigned_to);
  const belongsToOther = Boolean(task.assigned_to && task.assigned_to !== currentUserId);
  const statuses = [
    { value: "not_started", label: task.assigned_to ? "Toegewezen" : "Niet toegewezen" },
    { value: "in_progress", label: "Bezig" },
    { value: "blocked", label: "Geblokkeerd", title: "Kan niet verder door ontbrekende informatie, materiaal of een besluit." },
    { value: "done", label: "Gereed" },
  ];
  const statusIndex = statuses.findIndex((item) => item.value === task.status);
  return <div className={"task " + (task.priority || "medium") + (belongsToOther ? " taskAssignedElsewhere" : "")} style={belongsToOther ? { background: "#fff7ed", borderLeft: "4px solid #f59e0b" } : undefined}>
    <div style={task.parent_task_id ? { paddingLeft: 18, borderLeft: "3px solid #cbd5e1" } : undefined}><strong>{task.parent_task_id ? "↳ " : ""}{task.title}</strong>{task.description && <small>{task.description}</small>}<span>{task.process_runs?.name || "Proces"} · deadline {task.due_date || "geen"} · {belongsToOther ? `Door ${assignedMember?.full_name || "een andere medewerker"}` : task.assigned_to ? "Aan jou toegewezen" : "nog toe te wijzen"} · {task.priority || "medium"}{task.requires_evidence && " · Bewijs verplicht"}{task.parent_task_id && " · Opvolging"}{!task.template_step_id && " · Aangepaste taak"}</span></div>
    <select value={task.assigned_to || ""} disabled={!canManage} onChange={(event) => onUpdate({ assigned_to: event.target.value || null })}>
      <option value="">Niet toegewezen</option>{members.map((member) => <option key={member.id} value={member.id}>{member.full_name || member.id}</option>)}
    </select>
    {(task.requires_evidence || task.status === "done") && <div className="stack" style={{ marginTop: 8 }}>
      <label>Oplevernotitie<textarea value={completionNote} onChange={(event) => setCompletionNote(event.target.value)} placeholder="Wat is precies uitgevoerd of gecontroleerd?" disabled={!canAct || task.status === "done"} /></label>
      <label>Bewijslink<input value={evidenceUrl} onChange={(event) => setEvidenceUrl(event.target.value)} placeholder="Optioneel: link naar foto of document" disabled={!canAct || task.status === "done"} /></label>
    </div>}
    <div className="statusBar" aria-label="Voortgang taak">
      {statuses.map((status, index) => {
        const isCurrent = task.status === status.value;
        const canSelect = canManage || (canAct && index > statusIndex && task.status !== "blocked" && task.status !== "done");
        const needsEvidence = status.value === "done" && task.requires_evidence && !completionNote.trim() && !evidenceUrl.trim();
        return <button type="button" key={status.value} className={isCurrent ? "primary" : "secondary"} title={needsEvidence ? "Vul eerst een oplevernotitie of bewijslink in." : status.title} aria-current={isCurrent ? "step" : undefined} disabled={(!canSelect && !isCurrent) || needsEvidence} onClick={() => canSelect && !needsEvidence && onUpdate({ status: status.value, completion_note: completionNote.trim() || null, evidence_url: evidenceUrl.trim() || null, completed_at: status.value === "done" ? new Date().toISOString() : null })}>{status.label}</button>;
      })}
    </div>
    {canManage && <div className="toolbar" style={{ marginTop: 8 }}><button type="button" className="secondary" onClick={() => setShowSubtaskForm((value) => !value)}>{showSubtaskForm ? "Sluiten" : "Subtaak toevoegen"}</button></div>}
    {showSubtaskForm && canManage && <form className="toolbar" onSubmit={(event) => { event.preventDefault(); onCreateSubtask(task, subtaskTitle); setSubtaskTitle(""); setShowSubtaskForm(false); }}><input required value={subtaskTitle} onChange={(event) => setSubtaskTitle(event.target.value)} placeholder="Naam van de kleine stap" /><button type="submit" className="primary">Toevoegen</button></form>}
    {task.status === "blocked" && <input defaultValue={task.blocker_note || ""} placeholder="Waarom geblokkeerd?" disabled={!canAct} onBlur={(event) => onUpdate({ blocker_note: event.target.value.trim() || null })} />}
  </div>;
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
      const oldData = { ...entry.old_data };
      const newData = { ...entry.new_data };
      delete oldData.updated_at;
      delete newData.updated_at;
      if (JSON.stringify(oldData) === JSON.stringify(newData)) return false;
    }
    if (entry.table_name === "process_run_tasks" && entry.action === "UPDATE" && entry.old_data && entry.new_data && entry.new_data.run_id) {
      const oldData = { ...entry.old_data };
      const newData = { ...entry.new_data };
      delete oldData.assigned_to;
      delete newData.assigned_to;
      delete oldData.updated_at;
      delete newData.updated_at;
      const key = entry.new_data.run_id + "|" + entry.created_at;
      if (assignmentBatchCounts.get(key) >= 3 && JSON.stringify(oldData) === JSON.stringify(newData)) return false;
    }
    if (entry.table_name === "process_run_tasks" && entry.action === "INSERT" && entry.new_data?.run_id) {
      return !processCreations.some((processEntry) => processEntry.new_data?.id === entry.new_data.run_id && Math.abs(new Date(processEntry.created_at).getTime() - new Date(entry.created_at).getTime()) <= 10000);
    }
    return true;
  });
}

function auditActionLabel(action) {
  return { INSERT: "Aangemaakt", UPDATE: "Gewijzigd", DELETE: "Verwijderd" }[action] || action;
}

function auditTableLabel(tableName) {
  return { process_templates: "proces", process_template_steps: "processtap", process_runs: "gestart proces", process_run_tasks: "procestaak" }[tableName] || tableName;
}

function Metric({ label, value, sub, onClick }) { const content = <><span>{label}</span><strong>{value}</strong><small>{sub}</small></>; return onClick ? <button type="button" className="card" onClick={onClick}>{content}</button> : <div className="card">{content}</div>; }