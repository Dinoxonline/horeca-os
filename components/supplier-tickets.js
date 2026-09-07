"use client";

import { useEffect, useMemo, useState } from "react";
import { supabase } from "../lib/supabase";

const statuses = ["nieuw", "verzonden", "wacht op leverancier", "in behandeling", "opgelost", "gesloten"];
const statusLabels = { nieuw: "Nieuw", verzonden: "Verzonden", "wacht op leverancier": "Wacht op leverancier", "in behandeling": "In behandeling", opgelost: "Opgelost", gesloten: "Gesloten" };
const priorities = ["urgent", "hoog", "normaal", "laag"];
const priorityLabels = { urgent: "Urgent", hoog: "Hoog", normaal: "Normaal", laag: "Laag" };

function date(value) { return value ? new Date(value).toLocaleString("nl-NL", { dateStyle: "medium", timeStyle: "short" }) : ""; }

export default function SupplierTickets({ workspaceId, suppliers = [], canManage = false }) {
  const [tickets, setTickets] = useState([]);
  const [members, setMembers] = useState([]);
  const [messages, setMessages] = useState({});
  const [filter, setFilter] = useState("open");
  const [supplierFilter, setSupplierFilter] = useState("alle");
  const [search, setSearch] = useState("");
  const [draft, setDraft] = useState({ supplier_id: "", title: "", description: "", priority: "normaal", supplier_email: "", supplier_contact: "", files: [] });
  const [replyDrafts, setReplyDrafts] = useState({});
  const [messageText, setMessageText] = useState("");
  const [saving, setSaving] = useState(false);
  const [sending, setSending] = useState({});
  const [openForm, setOpenForm] = useState(false);
  const [syncing, setSyncing] = useState(false);

  async function load() {
    if (!workspaceId) return;
    const [{ data, error }, { data: people }] = await Promise.all([
      supabase.from("staff_tickets").select("*").eq("workspace_id", workspaceId).eq("ticket_kind", "supplier").order("created_at", { ascending: false }),
      supabase.from("profiles").select("id, full_name").order("full_name"),
    ]);
    if (error) { setMessageText("Leverancierstickets konden niet worden geladen."); return; }
    const rows = data || [];
    setTickets(rows); setMembers(people || []);
    if (rows.length) {
      const { data: conversation } = await supabase.from("staff_ticket_messages").select("*").eq("workspace_id", workspaceId).in("ticket_id", rows.map((row) => row.id)).order("created_at", { ascending: true });
      setMessages((conversation || []).reduce((all, row) => ({ ...all, [row.ticket_id]: [...(all[row.ticket_id] || []), row] }), {}));
    }
  }

  useEffect(() => { load(); }, [workspaceId]);
  function update(key, value) { setDraft((current) => ({ ...current, [key]: value })); }

  async function createTicket(event) {
    event.preventDefault();
    const supplier = suppliers.find((item) => item.id === draft.supplier_id);
    if (!supplier || !draft.title.trim() || !draft.description.trim()) return;
    setSaving(true); setMessageText("");
    const { data: ticket, error } = await supabase.from("staff_tickets").insert({ workspace_id: workspaceId, ticket_kind: "supplier", supplier_id: supplier.id, supplier_email: draft.supplier_email.trim() || supplier.support_email || supplier.email || null, supplier_contact: draft.supplier_contact.trim() || supplier.contact_name || null, category: "Leveranciersupport", priority: draft.priority, status: "nieuw", title: draft.title.trim(), description: draft.description.trim(), location: null, reporter_name: "Horeca OS", reporter_contact: draft.supplier_email.trim() || supplier.support_email || supplier.email || null }).select("id").single();
    setSaving(false);
    if (error) { setMessageText("Het leveranciersticket kon niet worden aangemaakt. Voer eerst de database-update uit als deze functie nieuw is."); return; }
    const uploads = [];
    for (const file of draft.files) {
      const path = `${workspaceId}/supplier/${ticket.id}/${crypto.randomUUID()}-${file.name.replace(/[^a-zA-Z0-9._-]/g, "_")}`;
      const upload = await supabase.storage.from("staff-ticket-attachments").upload(path, file, { contentType: file.type || "application/octet-stream", upsert: false });
      if (upload.error) { setMessageText(`Ticket aangemaakt, maar bijlage ${file.name} kon niet worden opgeslagen.`); } else uploads.push({ path, name: file.name, type: file.type, size: file.size });
    }
    if (uploads.length) await supabase.from("staff_tickets").update({ attachments: uploads }).eq("id", ticket.id).eq("workspace_id", workspaceId);
    setDraft({ supplier_id: "", title: "", description: "", priority: "normaal", supplier_email: "", supplier_contact: "", files: [] }); setOpenForm(false); setMessageText("Leveranciersticket aangemaakt."); load();
  }

  async function updateTicket(id, patch) {
    const { error } = await supabase.from("staff_tickets").update({ ...patch, updated_at: new Date().toISOString() }).eq("workspace_id", workspaceId).eq("id", id).eq("ticket_kind", "supplier");
    if (error) setMessageText("De wijziging kon niet worden opgeslagen."); else load();
  }

  async function addReply(ticket) {
    const body = String(replyDrafts[ticket.id] || "").trim();
    if (!body) return;
    const { data: sessionData } = await supabase.auth.getSession();
    const user = sessionData.session?.user;
    if (!user) return;
    const { error } = await supabase.from("staff_ticket_messages").insert({ workspace_id: workspaceId, ticket_id: ticket.id, author_user_id: user.id, author_name: user.user_metadata?.full_name || user.email || "Beheerder", author_role: "manager", body });
    if (error) setMessageText("De reactie kon niet worden toegevoegd."); else { setReplyDrafts((current) => ({ ...current, [ticket.id]: "" })); load(); }
  }

  async function sendSupplierEmail(ticket) {
    if (!ticket.supplier_email) { setMessageText("Vul eerst een support-e-mailadres in bij dit ticket."); return; }
    const { data: sessionData } = await supabase.auth.getSession();
    const session = sessionData.session;
    if (!session) return;
    setSending((current) => ({ ...current, [ticket.id]: "sending" }));
    const attachments = [];
    for (const attachment of ticket.attachments || []) {
      const downloaded = await supabase.storage.from("staff-ticket-attachments").download(attachment.path);
      if (!downloaded.error && downloaded.data) { const bytes = new Uint8Array(await downloaded.data.arrayBuffer()); let binary = ""; bytes.forEach((byte) => { binary += String.fromCharCode(byte); }); attachments.push({ name: attachment.name, contentType: attachment.type || "application/octet-stream", contentBytes: btoa(binary) }); }
    }
    const response = await fetch("/api/integrations/microsoft/messages/action", { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${session.access_token}` }, body: JSON.stringify({ workspaceId, mailbox: session.user.email, action: "send", to: ticket.supplier_email, subject: `[Horeca OS #${ticket.ticket_number}] ${ticket.title}`, content: `Ticket #${ticket.ticket_number}\n\n${ticket.description}\n\nVermeld in je antwoord ticketnummer #${ticket.ticket_number}, zodat wij alles aan hetzelfde dossier kunnen koppelen.`, attachments }) });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) { setSending((current) => ({ ...current, [ticket.id]: "error" })); setMessageText(result.error || "De e-mail kon niet worden verzonden."); return; }
    await updateTicket(ticket.id, { status: "verzonden", outbound_sent_at: new Date().toISOString() });
    setSending((current) => ({ ...current, [ticket.id]: "sent" }));
  }

  async function syncSupplierReplies() {
    const { data: sessionData } = await supabase.auth.getSession();
    const session = sessionData.session;
    if (!session) return;
    setSyncing(true); setMessageText("");
    const response = await fetch(`/api/integrations/microsoft/messages?workspaceId=${encodeURIComponent(workspaceId)}&mailbox=${encodeURIComponent(session.user.email)}&folderId=inbox`, { headers: { Authorization: `Bearer ${session.access_token}` } });
    const result = await response.json().catch(() => ({}));
    const mailbox = result.mailboxes?.[0];
    let added = 0;
    for (const mail of mailbox?.messages || []) {
      const match = String(mail.subject || "").match(/#(\d+)/);
      const ticket = match && tickets.find((item) => String(item.ticket_number) === match[1]);
      if (!ticket || !mail.id || !mail.from?.emailAddress?.address || mail.from.emailAddress.address.toLowerCase() === session.user.email.toLowerCase()) continue;
      const { data: existing } = await supabase.from("staff_ticket_messages").select("id").eq("workspace_id", workspaceId).eq("external_message_id", mail.id).maybeSingle();
      if (existing) continue;
      const { error } = await supabase.from("staff_ticket_messages").insert({ workspace_id: workspaceId, ticket_id: ticket.id, author_user_id: session.user.id, author_name: mail.from.emailAddress.name || mail.from.emailAddress.address, author_role: "manager", body: mail.bodyPreview || "(Geen tekstvoorbeeld beschikbaar.)", external_message_id: mail.id, source: "supplier_email" });
      if (!error) { await supabase.from("staff_tickets").update({ status: "in behandeling", last_external_message_at: mail.receivedDateTime, updated_at: new Date().toISOString() }).eq("id", ticket.id).eq("workspace_id", workspaceId); added += 1; }
    }
    setSyncing(false); setMessageText(response.ok ? `${added} nieuw ${added === 1 ? "leveranciersantwoord" : "leveranciersantwoorden"} aan tickets toegevoegd.` : (mailbox?.error || "De mailbox kon niet worden gelezen."));
    load();
  }

  const supplierMap = useMemo(() => new Map(suppliers.map((supplier) => [supplier.id, supplier])), [suppliers]);
  const visible = tickets.filter((ticket) => {
    const term = search.trim().toLowerCase();
    const statusMatch = filter === "alle" || (filter === "open" ? !["opgelost", "gesloten"].includes(ticket.status) : ticket.status === filter);
    const supplierMatch = supplierFilter === "alle" || ticket.supplier_id === supplierFilter;
    return statusMatch && supplierMatch && (!term || `${ticket.ticket_number} ${ticket.title} ${ticket.description} ${supplierMap.get(ticket.supplier_id)?.name || ""}`.toLowerCase().includes(term));
  });

  return <section className="panel ticketBackoffice"><div className="panelHead"><div><p className="eyebrow">LEVERANCIERSSUPPORT · TICKETMODULE</p><h2>Leverancierstickets</h2><p>Documenteer storingen en vragen aan Robuust en andere leveranciers. Houd iedere reactie in hetzelfde ticket.</p></div><div className="toolbar"><button className="secondaryButton" type="button" onClick={syncSupplierReplies} disabled={syncing}>{syncing ? "Antwoorden ophalen…" : "Leveranciers-e-mails ophalen"}</button><button className="primary" type="button" onClick={() => setOpenForm((value) => !value)}>{openForm ? "Formulier sluiten" : "Nieuw leveranciersticket"}</button></div></div>
    {messageText && <div className="notice">{messageText}</div>}
    {openForm && <form className="supplierTicketForm" onSubmit={createTicket}><label>Leverancier *<select required value={draft.supplier_id} onChange={(event) => { const value = event.target.value; const selected = suppliers.find((item) => item.id === value); setDraft((current) => ({ ...current, supplier_id: value, supplier_email: selected?.support_email || selected?.email || "", supplier_contact: selected?.contact_name || "" })); }}><option value="">Kies een leverancier</option>{suppliers.filter((item) => item.active !== false).map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label><label>Contactpersoon<input value={draft.supplier_contact} onChange={(event) => update("supplier_contact", event.target.value)} placeholder="Naam contactpersoon" /></label><label>Support e-mailadres<input type="email" value={draft.supplier_email} onChange={(event) => update("supplier_email", event.target.value)} placeholder="support@leverancier.nl" /><small>Vooraf ingevuld vanuit de leverancier, maar aanpasbaar voor dit ticket.</small></label><label>Onderwerp *<input required maxLength={180} value={draft.title} onChange={(event) => update("title", event.target.value)} placeholder="Bijvoorbeeld: Foutmelding in Robuust" /></label><label>Prioriteit<select value={draft.priority} onChange={(event) => update("priority", event.target.value)}>{priorities.map((value) => <option key={value} value={value}>{priorityLabels[value]}</option>)}</select></label><label className="full">Omschrijving *<textarea required minLength={5} maxLength={10000} value={draft.description} onChange={(event) => update("description", event.target.value)} placeholder="Wat gebeurt er, sinds wanneer en wat is al geprobeerd?" /></label><label className="full">Foto, video of document<input type="file" multiple accept="image/jpeg,image/png,video/*,application/pdf,.doc,.docx" onChange={(event) => setDraft((current) => ({ ...current, files: [...event.target.files].filter((file) => file.size <= 10 * 1024 * 1024) }))} /><small>Meerdere bestanden mogelijk; maximaal 10 MB per bestand.</small></label><div className="formActions full"><button className="primary" disabled={saving}>{saving ? "Aanmaken…" : "Ticket aanmaken"}</button></div></form>}
    <div className="ticketFilters"><label className="ticketSearch">Zoeken<input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Ticket, onderwerp, leverancier…" /></label><label>Leverancier<select value={supplierFilter} onChange={(event) => setSupplierFilter(event.target.value)}><option value="alle">Alle leveranciers</option>{suppliers.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label><label>Status<select value={filter} onChange={(event) => setFilter(event.target.value)}><option value="open">Openstaand</option><option value="alle">Alle</option>{statuses.map((value) => <option key={value} value={value}>{statusLabels[value]}</option>)}</select></label><button type="button" className="secondaryButton" onClick={load}>Verversen</button></div>
    <div className="ticketResultMeta"><strong>{visible.length} {visible.length === 1 ? "ticket" : "tickets"}</strong><span>leverancierssupport</span></div>
    {!visible.length ? <p className="empty">Geen leverancierstickets die aan deze selectie voldoen.</p> : <div className="ticketQueue">{visible.map((ticket) => { const supplier = supplierMap.get(ticket.supplier_id); return <article className={`ticketCard ${ticket.priority === "urgent" ? "urgent" : ticket.priority === "hoog" ? "high" : ""}`} key={ticket.id}><div className="ticketCardMain"><div className="ticketCardTop"><span className="ticketNumber">#{ticket.ticket_number}</span><span className={`ticketPriority ${ticket.priority}`}>{priorityLabels[ticket.priority] || ticket.priority}</span><span className="ticketStatus">{statusLabels[ticket.status] || ticket.status}</span><time>{date(ticket.created_at)}</time></div><h3>{ticket.title}</h3><p className="ticketMeta"><strong>{supplier?.name || "Leverancier onbekend"}</strong> · {ticket.supplier_email || "geen supportadres"}</p><p className="ticketDescription">{ticket.description}</p><p className="ticketContact">Eigenaar: {members.find((member) => member.id === ticket.assignee_id)?.full_name || "nog niet toegewezen"}</p><details className="ticketConversation"><summary>Gesprek ({(messages[ticket.id] || []).length})</summary>{(messages[ticket.id] || []).map((item) => <div className={`ticketMessage ${item.author_role === "manager" ? "fromManager" : ""}`} key={item.id}><strong>{item.author_name}</strong><time>{date(item.created_at)}</time><p>{item.body}</p></div>)}<textarea value={replyDrafts[ticket.id] || ""} onChange={(event) => setReplyDrafts((current) => ({ ...current, [ticket.id]: event.target.value }))} placeholder="Interne reactie of ontvangen antwoord vastleggen…" /><button type="button" className="secondaryButton" onClick={() => addReply(ticket)} disabled={!String(replyDrafts[ticket.id] || "").trim()}>Reactie opslaan</button></details></div>{canManage && <div className="ticketActions"><label>Status<select value={ticket.status} onChange={(event) => updateTicket(ticket.id, { status: event.target.value })}>{statuses.map((value) => <option key={value} value={value}>{statusLabels[value]}</option>)}</select></label><label>Prioriteit<select value={ticket.priority} onChange={(event) => updateTicket(ticket.id, { priority: event.target.value })}>{priorities.map((value) => <option key={value} value={value}>{priorityLabels[value]}</option>)}</select></label><label>Toewijzen aan<select value={ticket.assignee_id || ""} onChange={(event) => updateTicket(ticket.id, { assignee_id: event.target.value || null })}><option value="">Nog niet toegewezen</option>{members.map((member) => <option key={member.id} value={member.id}>{member.full_name || member.id}</option>)}</select></label><button type="button" className="secondaryButton" onClick={() => sendSupplierEmail(ticket)} disabled={sending[ticket.id] === "sending"}>{sending[ticket.id] === "sending" ? "E-mail verzenden…" : sending[ticket.id] === "sent" ? "E-mail verzonden" : "E-mail naar leverancier"}</button></div>}</article>; })}</div>}
  </section>;
}
