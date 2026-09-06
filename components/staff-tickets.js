"use client";

import { useEffect, useMemo, useState } from "react";
import { supabase } from "../lib/supabase";

const statusOptions = ["nieuw", "in behandeling", "wacht op informatie", "opgelost", "gesloten"];
const statusLabels = { nieuw: "Nieuw", "in behandeling": "In behandeling", "wacht op informatie": "Wacht op informatie", opgelost: "Opgelost", gesloten: "Gesloten" };
const priorityOptions = ["urgent", "hoog", "normaal", "laag"];
const priorityLabels = { urgent: "Urgent", hoog: "Hoog", normaal: "Normaal", laag: "Laag" };
const priorityRank = { urgent: 0, hoog: 1, normaal: 2, laag: 3 };
const categoryOptions = ["Techniek / reparatie", "Onderhoud", "Voorraad", "Marketing", "Personeel", "Idee of vraag", "Overig"];
const locationOptions = ["Caribbean Corner", "Grand Café Het Plein", "Beide locaties", "Overig"];

function formatDate(value) {
  return value ? new Date(value).toLocaleString("nl-NL", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" }) : "";
}

function slaHours(priority) {
  return priority === "urgent" ? 1 : priority === "hoog" ? 4 : priority === "normaal" ? 24 : 72;
}

function isOverdue(ticket) {
  return !["opgelost", "gesloten"].includes(ticket.status)
    && Date.now() > new Date(ticket.created_at).getTime() + slaHours(ticket.priority) * 60 * 60 * 1000;
}

function routingRole(category) {
  if (["Techniek / reparatie", "Onderhoud"].includes(category)) return ["manager kitchen", "manager operations"];
  if (category === "Marketing") return ["manager customers", "manager operations"];
  if (category === "Personeel") return ["manager hr"];
  return ["manager operations", "manager customers"];
}

export default function StaffTickets({ workspaceId, canManage = false, session }) {
  const [tickets, setTickets] = useState([]);
  const [members, setMembers] = useState([]);
  const [statusFilter, setStatusFilter] = useState("open");
  const [priorityFilter, setPriorityFilter] = useState("alle");
  const [categoryFilter, setCategoryFilter] = useState("alle");
  const [locationFilter, setLocationFilter] = useState("alle");
  const [assigneeFilter, setAssigneeFilter] = useState("alle");
  const [reporterFilter, setReporterFilter] = useState("alle");
  const [search, setSearch] = useState("");
  const [sort, setSort] = useState("priority");
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(false);
  const [assignmentEmailState, setAssignmentEmailState] = useState({});
  const [messagesByTicket, setMessagesByTicket] = useState({});
  const [replyDrafts, setReplyDrafts] = useState({});
  const [replyState, setReplyState] = useState({});

  async function load() {
    setLoading(true);
    setMessage("");
    const [{ data, error }, membersResponse] = await Promise.all([
      (canManage ? supabase.from("staff_tickets").select("*").eq("workspace_id", workspaceId) : supabase.from("staff_tickets").select("*").eq("workspace_id", workspaceId).eq("assignee_id", session?.user?.id || "__none__")).order("created_at", { ascending: false }),
      fetch(`/api/admin/users?workspaceId=${encodeURIComponent(workspaceId)}`, {
        headers: { Authorization: `Bearer ${session?.access_token || ""}` },
      }),
    ]);
    if (error) setMessage("De tickets konden niet worden geladen. Controleer je verbinding en probeer opnieuw.");
    else {
      const nextTickets = data || [];
      setTickets(nextTickets);
      if (nextTickets.length) {
        const { data: rows } = await supabase.from("staff_ticket_messages").select("*").eq("workspace_id", workspaceId).in("ticket_id", nextTickets.map((ticket) => ticket.id)).order("created_at", { ascending: true });
        setMessagesByTicket((rows || []).reduce((result, item) => ({ ...result, [item.ticket_id]: [...(result[item.ticket_id] || []), item] }), {}));
      }
    }
    const membersResult = await membersResponse.json().catch(() => ({}));
    setMembers((membersResult.users || []).map((member) => ({ id: member.id, full_name: member.fullName || member.email, roles: [...new Set((member.assignments || []).map((item) => item.role?.role_key).filter(Boolean))] })));
    setLoading(false);
  }

  useEffect(() => {
    if (!workspaceId) return undefined;
    load();
    const channel = supabase
      .channel(`staff-tickets-backoffice-${workspaceId}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "staff_tickets", filter: `workspace_id=eq.${workspaceId}` }, load)
      .on("postgres_changes", { event: "*", schema: "public", table: "staff_ticket_messages", filter: `workspace_id=eq.${workspaceId}` }, load)
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [workspaceId]);

  async function updateTicket(id, patch) {
    setMessage("");
    const update = { ...patch, updated_at: new Date().toISOString() };
    if (patch.status === "opgelost" || patch.status === "gesloten") update.resolved_at = new Date().toISOString();
    if (patch.status && !["opgelost", "gesloten"].includes(patch.status)) update.resolved_at = null;
    const { error } = await supabase.from("staff_tickets").update(update).eq("workspace_id", workspaceId).eq("id", id);
    if (error) {
      setMessage("Deze wijziging kon niet worden opgeslagen.");
    } else {
      load();
    }
  }

  async function sendReply(ticket) {
    const body = String(replyDrafts[ticket.id] || "").trim();
    if (!body || !session?.user?.id) return;
    setReplyState((current) => ({ ...current, [ticket.id]: "sending" }));
    const { error } = await supabase.from("staff_ticket_messages").insert({ workspace_id: workspaceId, ticket_id: ticket.id, author_user_id: session.user.id, author_name: session.user.user_metadata?.full_name || session.user.email || (canManage ? "Beheerder" : "Medewerker"), author_role: canManage ? "manager" : "employee", body });
    if (error) { setReplyState((current) => ({ ...current, [ticket.id]: "error" })); setMessage("De reactie kon niet worden geplaatst."); return; }
    setReplyDrafts((current) => ({ ...current, [ticket.id]: "" }));
    setReplyState((current) => ({ ...current, [ticket.id]: "sent" }));
    load();
  }

  async function sendAssignmentEmail(ticket) {
    if (!ticket.assignee_id) return;
    setMessage("");
    setAssignmentEmailState((current) => ({ ...current, [ticket.id]: "sending" }));
    try {
      const response = await fetch("/api/staff-tickets/assignment-email", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${session?.access_token || ""}` },
        body: JSON.stringify({ workspaceId, ticketId: ticket.id, assigneeId: ticket.assignee_id }),
      });
      const result = await response.json().catch(() => ({}));
      const status = response.ok && result.emailSent ? "sent" : "error";
      setAssignmentEmailState((current) => ({ ...current, [ticket.id]: status }));
      setMessage(status === "sent" ? "Toewijzingsmail verstuurd." : result.message || "De toewijzingsmail kon niet worden verstuurd.");
    } catch {
      setAssignmentEmailState((current) => ({ ...current, [ticket.id]: "error" }));
      setMessage("De toewijzingsmail kon niet worden verstuurd.");
    }
  }

  const counts = useMemo(() => ({
    all: tickets.length,
    new: tickets.filter((ticket) => ticket.status === "nieuw").length,
    urgent: tickets.filter((ticket) => ticket.priority === "urgent" && !["opgelost", "gesloten"].includes(ticket.status)).length,
    overdue: tickets.filter(isOverdue).length,
    open: tickets.filter((ticket) => !["opgelost", "gesloten"].includes(ticket.status)).length,
  }), [tickets]);

  const reporterOptions = useMemo(() => [...new Set(tickets.map((ticket) => ticket.reporter_name).filter(Boolean))].sort((a, b) => a.localeCompare(b, "nl")), [tickets]);

  const report = useMemo(() => {
    const openTickets = tickets.filter((ticket) => !["opgelost", "gesloten"].includes(ticket.status));
    const groupBy = (items, key, fallback) => Object.entries(items.reduce((result, item) => { const value = item[key] || fallback; result[value] = (result[value] || 0) + 1; return result; }, {})).sort((a, b) => b[1] - a[1]);
    return {
      open: openTickets.length,
      overdue: openTickets.filter(isOverdue).length,
      categories: groupBy(openTickets, "category", "Overig").slice(0, 4),
      locations: groupBy(openTickets, "location", "Geen locatie").slice(0, 4),
    };
  }, [tickets]);

  const visible = useMemo(() => {
    const term = search.trim().toLowerCase();
    return tickets.filter((ticket) => {
      const matchesStatus = statusFilter === "alle" || (statusFilter === "open" ? !["opgelost", "gesloten"].includes(ticket.status) : ticket.status === statusFilter);
      const matchesPriority = priorityFilter === "alle" || ticket.priority === priorityFilter;
      const matchesCategory = categoryFilter === "alle" || ticket.category === categoryFilter;
      const matchesLocation = locationFilter === "alle" || ticket.location === locationFilter;
      const matchesAssignee = assigneeFilter === "alle" || (assigneeFilter === "niet toegewezen" ? !ticket.assignee_id : ticket.assignee_id === assigneeFilter);
      const matchesReporter = reporterFilter === "alle" || ticket.reporter_name === reporterFilter;
      const haystack = `${ticket.ticket_number} ${ticket.title} ${ticket.description} ${ticket.reporter_name} ${ticket.reporter_contact}`.toLowerCase();
      return matchesStatus && matchesPriority && matchesCategory && matchesLocation && matchesAssignee && matchesReporter && (!term || haystack.includes(term));
    }).sort((a, b) => {
      if (sort === "oldest") return new Date(a.created_at) - new Date(b.created_at);
      if (sort === "newest") return new Date(b.created_at) - new Date(a.created_at);
      return (priorityRank[a.priority] ?? 9) - (priorityRank[b.priority] ?? 9) || new Date(a.created_at) - new Date(b.created_at);
    });
  }, [tickets, statusFilter, priorityFilter, categoryFilter, locationFilter, assigneeFilter, reporterFilter, search, sort]);

  return <section className="panel ticketBackoffice">
    <div className="panelHead">
      <div><p className="eyebrow">TICKETMODULE · BACKOFFICE</p><h2>Medewerkersmeldingen</h2><p>Hier komen alle meldingen uit de gedeelde medewerkerslink binnen. Beoordeel, wijs toe en volg ze op. SLA: urgent 1 uur · hoog 4 uur · normaal 24 uur · laag 72 uur.</p></div>
      <div className="toolbar"><a className="primary" href="/medewerkers/cc-plein-medewerkers">Zelf een ticket aanmaken</a><button className="refresh" onClick={load} disabled={loading}>{loading ? "Laden…" : "Verversen"}</button></div>
    </div>
    <div className="ticketKpis">
      <button className={statusFilter === "open" ? "ticketKpi active" : "ticketKpi"} onClick={() => setStatusFilter("open")}><span>Openstaand</span><strong>{counts.open}</strong><small>actie nodig</small></button>
      <button className={statusFilter === "nieuw" ? "ticketKpi active" : "ticketKpi"} onClick={() => setStatusFilter("nieuw")}><span>Nieuw binnen</span><strong>{counts.new}</strong><small>nog niet beoordeeld</small></button>
      <button className={priorityFilter === "urgent" ? "ticketKpi urgent active" : "ticketKpi urgent"} onClick={() => { setPriorityFilter("urgent"); setStatusFilter("open"); }}><span>Urgent</span><strong>{counts.urgent}</strong><small>hoogste prioriteit</small></button>
      <button className={statusFilter === "alle" ? "ticketKpi active" : "ticketKpi"} onClick={() => setStatusFilter("alle")}><span>Alle tickets</span><strong>{counts.all}</strong><small>inclusief afgerond</small></button>
    </div>
    <div className="ticketReport" aria-label="Ticketrapportage">
      <div><span>Openstaand</span><strong>{report.open}</strong></div>
      <div><span>Te laat</span><strong>{report.overdue}</strong></div>
      <div><span>Meeste categorieën</span><p>{report.categories.length ? report.categories.map(([name, count]) => <span key={name}>{name}: {count}</span>) : "Geen open tickets"}</p></div>
      <div><span>Per locatie</span><p>{report.locations.length ? report.locations.map(([name, count]) => <span key={name}>{name}: {count}</span>) : "Geen open tickets"}</p></div>
    </div>
    <div className="ticketViews" aria-label="Ticketweergave">
      {["open", "nieuw", "in behandeling", "wacht op informatie", "opgelost", "alle"].map((value) => <button key={value} className={statusFilter === value ? "primary" : "secondaryButton"} onClick={() => setStatusFilter(value)}>{value === "open" ? "Openstaand" : value === "alle" ? "Alle" : statusLabels[value]}</button>)}
    </div>
    <div className="ticketFilters">
      <label className="ticketSearch">Zoeken<input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Ticket, onderwerp, melder…" /></label>
      <label>Prioriteit<select value={priorityFilter} onChange={(event) => setPriorityFilter(event.target.value)}><option value="alle">Alle prioriteiten</option>{priorityOptions.map((value) => <option key={value} value={value}>{priorityLabels[value]}</option>)}</select></label>
      <label>Categorie<select value={categoryFilter} onChange={(event) => setCategoryFilter(event.target.value)}><option value="alle">Alle categorieën</option>{categoryOptions.map((value) => <option key={value} value={value}>{value}</option>)}</select></label>
      <label>Locatie<select value={locationFilter} onChange={(event) => setLocationFilter(event.target.value)}><option value="alle">Alle locaties</option>{locationOptions.map((value) => <option key={value} value={value}>{value}</option>)}</select></label>
      <label>Toegewezen aan<select value={assigneeFilter} onChange={(event) => setAssigneeFilter(event.target.value)}><option value="alle">Iedereen</option><option value="niet toegewezen">Niet toegewezen</option>{members.map((member) => <option key={member.id} value={member.id}>{member.full_name || member.id}</option>)}</select></label><label>Ingediend door<select value={reporterFilter} onChange={(event) => setReporterFilter(event.target.value)}><option value="alle">Iedereen</option>{reporterOptions.map((name) => <option key={name} value={name}>{name}</option>)}</select></label>
      <label>Sorteren<select value={sort} onChange={(event) => setSort(event.target.value)}><option value="priority">Urgentie eerst</option><option value="oldest">Oudste eerst</option><option value="newest">Nieuwste eerst</option></select></label>
    </div>
    {message && <div className="notice">{message}</div>}
    <div className="ticketResultMeta"><strong>{visible.length} {visible.length === 1 ? "ticket" : "tickets"}</strong><span>{statusFilter === "open" ? "openstaand" : statusFilter === "alle" ? "alle statussen" : statusLabels[statusFilter]}</span></div>
    {visible.length === 0 ? <p className="empty">Geen tickets die aan deze selectie voldoen.</p> : <div className="ticketQueue">{visible.map((ticket) => <article className={`ticketCard ${ticket.priority === "urgent" ? "urgent" : ticket.priority === "hoog" ? "high" : ""}`} key={ticket.id}>
      <div className="ticketCardMain"><div className="ticketCardTop"><span className="ticketNumber">#{ticket.ticket_number}</span><span className={`ticketPriority ${ticket.priority}`}>{priorityLabels[ticket.priority] || ticket.priority}</span><span className={`ticketStatus ${ticket.status.replaceAll(" ", "-")}`}>{statusLabels[ticket.status] || ticket.status}</span>{isOverdue(ticket) && <span className="ticketStatus overdue">Te laat</span>}<time>{formatDate(ticket.created_at)}</time></div><h3>{ticket.title}</h3><p className="ticketMeta">{ticket.category} · {ticket.location || "Locatie niet opgegeven"} · gemeld door <strong>{ticket.reporter_name}</strong></p>{!ticket.assignee_id && canManage && (() => { const roles = routingRole(ticket.category); const suggestion = members.find((member) => roles.some((role) => member.roles?.includes(role))); return suggestion ? <p className="ticketRouting">Voorgesteld: <strong>{suggestion.full_name}</strong> <button type="button" className="textButton" onClick={() => updateTicket(ticket.id, { assignee_id: suggestion.id })}>Toewijzen</button></p> : null; })()}<p className="ticketDescription">{ticket.description}</p>{ticket.attachments?.length > 0 && <p className="ticketAttachments"><strong>Bijlagen:</strong> {ticket.attachments.map((attachment) => attachment.name).join(", ")}</p>}<p className="ticketContact">Contact: {ticket.reporter_contact || "niet opgegeven"}</p><details className="ticketConversation"><summary>Gesprek ({(messagesByTicket[ticket.id] || []).length})</summary>{(messagesByTicket[ticket.id] || []).map((item) => <div className={`ticketMessage ${item.author_role === "manager" ? "fromManager" : ""}`} key={item.id}><strong>{item.author_name}</strong><time>{formatDate(item.created_at)}</time><p>{item.body}</p></div>)}{(messagesByTicket[ticket.id] || []).length === 0 && <p className="muted">Nog geen reacties.</p>}<textarea value={replyDrafts[ticket.id] || ""} onChange={(event) => setReplyDrafts((current) => ({ ...current, [ticket.id]: event.target.value }))} placeholder="Schrijf een reactie voor de medewerker…" maxLength={5000} /><button type="button" className="secondaryButton" disabled={replyState[ticket.id] === "sending" || !String(replyDrafts[ticket.id] || "").trim()} onClick={() => sendReply(ticket)}>{replyState[ticket.id] === "sending" ? "Reactie plaatsen…" : replyState[ticket.id] === "sent" ? "Reactie geplaatst" : "Reactie versturen"}</button></details>{canManage && <label className="ticketNote">Interne notitie<textarea defaultValue={ticket.internal_note || ""} onBlur={(event) => updateTicket(ticket.id, { internal_note: event.target.value.trim() || null })} placeholder="Afspraken, opvolging of oplossing" /></label>}</div>
      {canManage && <div className="ticketActions"><label>Status<select value={ticket.status} onChange={(event) => updateTicket(ticket.id, { status: event.target.value })}>{statusOptions.map((value) => <option key={value} value={value}>{statusLabels[value]}</option>)}</select></label><label>Prioriteit<select value={ticket.priority} onChange={(event) => updateTicket(ticket.id, { priority: event.target.value })}>{priorityOptions.map((value) => <option key={value} value={value}>{priorityLabels[value]}</option>)}</select></label><label>Toewijzen aan<select value={ticket.assignee_id || ""} onChange={(event) => updateTicket(ticket.id, { assignee_id: event.target.value || null })}><option value="">Nog niet toegewezen</option>{members.map((member) => <option key={member.id} value={member.id}>{member.full_name || member.id}</option>)}</select></label>{ticket.assignee_id && <><button type="button" className="secondaryButton" disabled={assignmentEmailState[ticket.id] === "sending"} onClick={() => sendAssignmentEmail(ticket)}>{assignmentEmailState[ticket.id] === "sending" ? "Bezig met versturen…" : assignmentEmailState[ticket.id] === "sent" ? "E-mail verstuurd" : "Toewijzingsmail versturen"}</button>{assignmentEmailState[ticket.id] === "sent" && <small className="muted">Bevestiging verzonden.</small>}{assignmentEmailState[ticket.id] === "error" && <small className="muted">Versturen mislukt.</small>}</>}</div>}
    </article>)}</div>}
  </section>;
}


