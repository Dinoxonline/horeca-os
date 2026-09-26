"use client";
import { useEffect, useRef, useState } from "react";
import { EVENT_MAILBOX, calendarDistribution, calendarDraft, calendarWebLink, validateCalendarDraft } from "../lib/event-calendar";
import styles from "./manual-predis.module.css";

export default function EventCalendar({ item, workspaceId, session, enabled, onSaved, onUnsavedChange }) {
  const [draft, setDraft] = useState(() => calendarDraft(item));
  const [saved, setSaved] = useState(() => calendarDistribution(item).calendar_channel || null);
  const [candidates, setCandidates] = useState([]), [busy, setBusy] = useState(false), [loaded, setLoaded] = useState(false);
  const [differentAppointments, setDifferentAppointments] = useState(false);
  const [notice, setNotice] = useState(""), [failed, setFailed] = useState(false), [confirmed, setConfirmed] = useState(false), [dirty, setDirty] = useState(false);
  const mounted = useRef(true), lock = useRef(false), controller = useRef(null), callbacks = useRef({ onSaved, onUnsavedChange }), token = useRef(session?.access_token);
  callbacks.current = { onSaved, onUnsavedChange }; token.current = session?.access_token;
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; controller.current?.abort(); }; }, []);
  useEffect(() => { onUnsavedChange?.(dirty || busy); return () => onUnsavedChange?.(false); }, [dirty, busy, onUnsavedChange]);
  useEffect(() => { if (typeof window === "undefined") return; const warn = e => { if (dirty || busy) { e.preventDefault(); e.returnValue = ""; } }; window.addEventListener("beforeunload", warn); return () => window.removeEventListener("beforeunload", warn); }, [dirty,busy]);
  async function run(action, eventId) {
    if (lock.current || !token.current) return;
    let valid;
    if (["create", "update"].includes(action)) { try { valid = validateCalendarDraft(draft); } catch (e) { setFailed(true); setNotice(e.message); return; } }
    lock.current = true; setBusy(true); setNotice(""); setFailed(false);
    controller.current = new AbortController(); const timeout = setTimeout(() => controller.current?.abort(), 55000);
    try {
      const response = await fetch("/api/marketing/event-calendar", { method: "POST", signal: controller.current.signal, headers: { Authorization: `Bearer ${token.current}`, "Content-Type": "application/json" }, body: JSON.stringify({ workspaceId, businessId: item.business_id, itemId: item.id, action, revision: saved?.revision || null, draft: valid, confirmed, eventId, reviewedCandidateIds: differentAppointments ? candidates.map(c => c.id) : [], etag: saved?.remote?.etag }) });
      const data = await response.json();
      if (!mounted.current) return;
      if (data.saved) { setSaved(data.saved); callbacks.current.onSaved?.(data.saved); }
      setCandidates(data.candidates || []);
      setDifferentAppointments(false);
      if (!response.ok || data.error) throw new Error(data.error || "De agenda-actie is niet gelukt.");
      setLoaded(true); setNotice(data.message); setConfirmed(false);
      if (["create", "update"].includes(action)) setDirty(false);
    } catch (e) {
      if (mounted.current) { setFailed(true); setNotice(e.name === "AbortError" ? "Geen bevestiging ontvangen. Controleer opnieuw; de afspraak kan al verwerkt zijn." : e.message); setConfirmed(false); setLoaded(false); }
    } finally { clearTimeout(timeout); lock.current = false; if (mounted.current) setBusy(false); }
  }
  // Load only when this panel is opened; a refreshed login must not reset edits.
  useEffect(() => { if (enabled && !loaded && !lock.current && token.current) run("check"); }, [enabled, Boolean(session?.access_token)]);
  function change(key, value) { setDraft(current => ({ ...current, [key]: value })); setDirty(true); setConfirmed(false); }
  const remote = saved?.remote, linked = Boolean(saved?.event_id), canCreate = loaded && (saved?.status === "missing" || (saved?.status === "candidates" && differentAppointments)) && !linked && !saved?.operation;
  if (!enabled && !loaded) return null;
  return <section className={styles.root} aria-label={`Agenda ${EVENT_MAILBOX}`}>
    <div className={styles.notice}><strong>Agenda {EVENT_MAILBOX}</strong><p>Plan het evenement in deze Microsoft-agenda en controleer de echte afspraak. Dit wijzigt Facebook, Instagram en de website niet. Tijden zijn Nederlandse tijd.</p></div>
    <div className={styles.actions}><button type="button" className="secondaryButton" disabled={busy} onClick={() => run("check")}>{busy ? "Agenda wordt verwerkt…" : "Controleren of het in de agenda staat"}</button><a href="/agenda" target="_blank" rel="noopener noreferrer">Agenda / koppeling openen</a></div>
    {notice && <p className={failed ? styles.error : styles.notice} role={failed ? "alert" : "status"}>{notice}</p>}
    {saved?.checked_at && <small>Laatste controle: {new Date(saved.checked_at).toLocaleString("nl-NL")}</small>}
    {remote && <div className={styles.notice}><strong>{saved?.status === "present" ? "Teruggelezen uit info@leclubbbq.nl" : "Laatst bekende afspraak — huidige status niet bevestigd"}</strong><b>{remote.subject}</b><span>{remote.start.replace("T", " ")} tot {remote.end.replace("T", " ")}</span><span>{remote.location}</span><details><summary>Omschrijving in de agenda bekijken</summary><p style={{whiteSpace:"pre-wrap"}}>{remote.description}</p></details>{calendarWebLink(remote.web_link) && <a href={remote.web_link} target="_blank" rel="noopener noreferrer">Deze afspraak in Outlook openen</a>}{!remote.editable && <p>Deze afspraak is hier alleen te controleren. Wijzig afspraken met deelnemers, herhalingen of vergaderinstellingen in Outlook.</p>}</div>}
    <p>Zoekdrempel voor deze agenda: 10%. Ook afspraken met een afwijkende titel op dezelfde datum worden getoond. Dit zijn suggesties, geen bevestigde koppelingen. Facebook en Instagram behouden hun eigen controles.</p>
    {candidates.length > 0 && <div className={styles.notice}><strong>Mogelijke bestaande afspraken — kies de juiste</strong>{candidates.map(c => <div key={c.id}><b>{c.subject}</b><p>{c.start.replace("T", " ")} · {c.location}</p><small>{c.match?.reason}</small><button type="button" className="secondaryButton" disabled={busy || !confirmed} onClick={() => run("link", c.id)}>Deze bestaande afspraak koppelen</button></div>)}</div>}
    <fieldset className={styles.fields} disabled={busy || Boolean(saved?.operation)}><legend>{linked ? "Afspraak wijzigen" : "Evenement inplannen"}</legend>
      {candidates.length > 0 && <label className={styles.check}><input type="checkbox" checked={differentAppointments} onChange={e => { setDifferentAppointments(e.target.checked); setConfirmed(false); }} />Ik heb alle suggesties bekeken. Dit zijn andere afspraken; mijn evenement staat er niet tussen.</label>}
      <label>Titel in agenda<input value={draft.subject} maxLength={250} onChange={e => change("subject", e.target.value)} /></label>
      <div className={styles.grid}><label>Begintijd (Nederland)<input type="datetime-local" value={draft.start} onChange={e => change("start",e.target.value)} /></label><label>Eindtijd (Nederland)<input type="datetime-local" value={draft.end} onChange={e => change("end",e.target.value)} /></label></div>
      <label>Locatie in agenda<input value={draft.location} maxLength={500} onChange={e => change("location",e.target.value)} /></label>
      <label>Omschrijving in agenda<textarea rows={5} maxLength={20000} value={draft.description} onChange={e => change("description",e.target.value)} /></label>
      <small>Dit zijn de gegevens voor de agenda-afspraak. De opgeslagen evenementgegevens en andere kanalen blijven ongewijzigd.</small>
      <label className={styles.check}><input type="checkbox" checked={confirmed} onChange={e => setConfirmed(e.target.checked)} />Ik heb de afspraakgegevens gecontroleerd en wil deze actie uitvoeren in de agenda van {EVENT_MAILBOX}.</label>
      <div className={styles.actions}><button type="button" className="secondaryButton" disabled={!confirmed || !loaded || (linked ? !remote?.editable || saved?.status !== "present" : !canCreate)} onClick={() => run(linked ? "update" : "create")}>{linked ? "Bestaand agendapunt wijzigen" : "In agenda zetten"}</button>{dirty && <strong>Nog niet in de agenda bewaard</strong>}</div>
      {!loaded && <small>Controleer eerst de agenda voordat je iets wijzigt.</small>}
    </fieldset>
  </section>;
}
