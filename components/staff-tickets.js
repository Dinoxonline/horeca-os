"use client";

import { useEffect, useState } from "react";
import { supabase } from "../lib/supabase";

const statusOptions = ["nieuw", "in behandeling", "wacht op informatie", "opgelost", "gesloten"];
const statusLabels = { nieuw: "Nieuw", "in behandeling": "In behandeling", "wacht op informatie": "Wacht op informatie", opgelost: "Opgelost", gesloten: "Gesloten" };

export default function StaffTickets({ workspaceId, canManage = false }) {
  const [tickets, setTickets] = useState([]);
  const [members, setMembers] = useState([]);
  const [filter, setFilter] = useState("open");
  const [message, setMessage] = useState("");

  async function load() {
    const [{ data, error }, { data: memberRows }] = await Promise.all([
      supabase.from("staff_tickets").select("*").eq("workspace_id", workspaceId).order("created_at", { ascending: false }),
      supabase.from("profiles").select("id, full_name").order("full_name"),
    ]);
    if (error) setMessage(error.message); else setTickets(data || []);
    setMembers(memberRows || []);
  }
  useEffect(() => { if (workspaceId) load(); }, [workspaceId]);

  async function updateTicket(id, patch) {
    const { error } = await supabase.from("staff_tickets").update({ ...patch, updated_at: new Date().toISOString(), ...(patch.status === "opgelost" ? { resolved_at: new Date().toISOString() } : {}) }).eq("workspace_id", workspaceId).eq("id", id);
    if (error) setMessage(error.message); else load();
  }

  const visible = tickets.filter((ticket) => filter === "alle" || (filter === "open" ? !["opgelost", "gesloten"].includes(ticket.status) : ticket.status === filter));
  return <section className="panel">
    <div className="panelHead"><div><p className="eyebrow">TICKETS</p><h2>Medewerkersmeldingen</h2><p>Alle meldingen uit de gedeelde medewerkerslink, met opvolging op één plek.</p></div><div className="toolbar"><button className={filter === "open" ? "primary" : "secondary"} onClick={() => setFilter("open")}>Openstaand</button><button className={filter === "alle" ? "primary" : "secondary"} onClick={() => setFilter("alle")}>Alle</button><button className="secondary" onClick={load}>Verversen</button></div></div>
    {message && <div className="notice">{message}</div>}
    {visible.length === 0 ? <p className="empty">Geen tickets in deze selectie.</p> : <div className="tableLike">{visible.map((ticket) => <article className={`task ${ticket.priority === "urgent" ? "critical" : ticket.priority === "hoog" ? "high" : ""}`} key={ticket.id}>
      <div style={{ flex: 1 }}><strong>#{ticket.ticket_number} · {ticket.title}</strong><span>{ticket.category} · {ticket.location || "Locatie niet opgegeven"} · {ticket.reporter_name} · {new Date(ticket.created_at).toLocaleString("nl-NL")}</span><p style={{ whiteSpace: "pre-wrap" }}>{ticket.description}</p>{ticket.reporter_contact && <small>Contact: {ticket.reporter_contact}</small>}
        {canManage && <><label style={{ display: "block", marginTop: 10 }}>Interne notitie<textarea defaultValue={ticket.internal_note || ""} onBlur={(event) => updateTicket(ticket.id, { internal_note: event.target.value.trim() || null })} placeholder="Afspraken, opvolging of oplossing" /></label></>}
      </div>
      {canManage && <div className="stack" style={{ minWidth: 190 }}><label>Status<select value={ticket.status} onChange={(event) => updateTicket(ticket.id, { status: event.target.value })}>{statusOptions.map((value) => <option key={value} value={value}>{statusLabels[value]}</option>)}</select></label><label>Toewijzen aan<select value={ticket.assignee_id || ""} onChange={(event) => updateTicket(ticket.id, { assignee_id: event.target.value || null })}><option value="">Nog niet toegewezen</option>{members.map((member) => <option key={member.id} value={member.id}>{member.full_name || member.id}</option>)}</select></label></div>}
    </article>)}</div>}
  </section>;
}

