export const EVENT_PROMOTION_TEMPLATE_KEY = "event_promotion";

export function eventPromotionAnchorDate(value) {
  const date = String(value || "").match(/^\d{4}-\d{2}-\d{2}/)?.[0];
  if (!date) throw new Error("Dit evenement heeft nog geen datum. Voeg eerst een begindatum toe.");
  return date;
}

function taskDueDate(anchorDate, relativeDays) {
  const due = new Date(`${anchorDate}T12:00:00`);
  due.setDate(due.getDate() + Number(relativeDays || 0));
  return due.toISOString().slice(0, 10);
}

export async function loadEventPromotionProcess(client, { workspaceId, marketingItemId }) {
  const { data: run, error: runError } = await client.from("process_runs").select("id,name,anchor_date,status")
    .eq("workspace_id", workspaceId).eq("marketing_item_id", marketingItemId).maybeSingle();
  if (runError) throw runError;
  if (!run) return { run: null, tasks: [] };
  const { data: tasks, error: taskError } = await client.from("process_run_tasks").select("id,template_step_id,title,status")
    .eq("workspace_id", workspaceId).eq("run_id", run.id).order("due_date", { ascending: true });
  if (taskError) throw taskError;
  return { run, tasks: tasks || [] };
}

export async function ensureEventPromotionRun(client, { workspaceId, businessId, marketingItemId, title, start, createdBy }) {
  if (!workspaceId || !businessId || !marketingItemId) throw new Error("Het marketingdossier of de vestiging ontbreekt.");
  const anchorDate = eventPromotionAnchorDate(start);
  const { data: template, error: templateError } = await client.from("process_templates").select("id")
    .eq("workspace_id", workspaceId).eq("template_key", EVENT_PROMOTION_TEMPLATE_KEY).eq("active", true).maybeSingle();
  if (templateError) throw templateError;
  if (!template) throw new Error("De evenement-promotiechecklist is nog niet beschikbaar.");

  let process = await loadEventPromotionProcess(client, { workspaceId, marketingItemId });
  if (!process.run) {
    const { data: createdRun, error: createRunError } = await client.from("process_runs").insert({
      workspace_id: workspaceId, business_id: businessId, marketing_item_id: marketingItemId, template_id: template.id,
      name: `Promotie · ${String(title || "Evenement").trim() || "Evenement"}`,
      anchor_date: anchorDate, created_by: createdBy || null,
    }).select("id,name,anchor_date,status").maybeSingle();
    if (createRunError) {
      process = await loadEventPromotionProcess(client, { workspaceId, marketingItemId });
      if (!process.run) throw createRunError;
    } else process = { run: createdRun, tasks: [] };
  }

  return { ...process, template };
}

export async function ensureEventPromotionProcess(client, options) {
  const { workspaceId, marketingItemId } = options;
  const process = await ensureEventPromotionRun(client, options);
  const { run, template } = process;
  const anchorDate = run.anchor_date;

  const { data: steps, error: stepError } = await client.from("process_template_steps").select("id,title,description,relative_days,priority")
    .eq("workspace_id", workspaceId).eq("template_id", template.id).order("sort_order");
  if (stepError) throw stepError;
  const existingStepIds = new Set(process.tasks.map((task) => task.template_step_id).filter(Boolean));
  const missingSteps = (steps || []).filter((step) => !existingStepIds.has(step.id));
  if (missingSteps.length) {
    const { error: createTasksError } = await client.from("process_run_tasks").insert(missingSteps.map((step) => ({
      workspace_id: workspaceId, business_id: options.businessId, run_id: run.id, template_step_id: step.id,
      title: step.title, description: step.description, due_date: taskDueDate(anchorDate, step.relative_days),
      priority: step.priority || "medium", status: "not_started",
    })));
    if (createTasksError) throw createTasksError;
  }
  return loadEventPromotionProcess(client, { workspaceId, marketingItemId });
}

export function eventPromotionProgress(tasks = []) {
  return { total: tasks.length, done: tasks.filter((task) => task.status === "done").length };
}
