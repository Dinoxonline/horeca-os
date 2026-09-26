"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { blankQuote, formatMoney, guestSnapshot, validateQuote } from "../lib/quotes";
import styles from "./quotes.module.css";

const emptyGuest = () => ({ name: "", company: "", email: "", phone: "", address: "", notes: "" });
const displayDate = date => /^\d{4}-\d{2}-\d{2}$/.test(date || "") ? date.split("-").reverse().join("-") : "Nog niet ingevuld";
const Field = ({ label, children }) => <label className={styles.field}><span>{label}</span>{children}</label>;
const guestLabel = guest => [guest.name, guest.company].filter(Boolean).join(" · ");

export function QuotePreview({ content, guest, business, number, version }) {
  return <article className={styles.preview} aria-label="Offertevoorbeeld">
    <div className={styles.toolbar}><h2>Vrijblijvende prijsopgave</h2><span className={styles.badge}>Concept · niet verstuurd</span></div>
    <p className={styles.muted}>{number ? `Offerte ${number} · versie ${version}` : "Nog niet opgeslagen"} · {business}</p>
    <div className={styles.grid}><div><h3>Voor {guest?.name || "Kies een gast"}</h3><p>{[guest?.company, guest?.address, guest?.email, guest?.phone].filter(Boolean).join("\n")}</p></div>
      <div><h3>{content.title}</h3><p>{displayDate(content.eventDate)} · {content.guestCount} gasten{"\n"}{content.location}{content.validUntil ? `\nGeldig tot en met ${displayDate(content.validUntil)}` : ""}</p></div></div>
    {content.introduction && <p>{content.introduction}</p>}
    {content.program.length > 0 && <section><h3>Programma · Nederlandse lokale tijd</h3>{content.program.map((row, i) => <p key={i}>{row.time}{row.nextDay ? " (volgende dag)" : ""} — {row.description}</p>)}</section>}
    <section><h3>Begroting · prijzen inclusief btw</h3><div className={styles.tableWrap}><table><thead><tr><th>Omschrijving</th><th>Berekening</th><th>Bedrag</th></tr></thead><tbody>
      {content.lines.map((row, i) => <tr key={i}><td>{row.label}</td><td>{row.quantity}{row.unit === "person" ? " personen" : ""}{row.unit === "hour" ? ` × ${row.hours} uur` : ""}{!row.pending ? ` × ${formatMoney(Number(row.price) * 100)}` : ""}</td><td>{row.pending ? "Nader te bepalen" : formatMoney(row.totalCents)}</td></tr>)}
    </tbody></table></div><div className={styles.total}>{content.pendingCount ? "Subtotaal bekende bedragen, incl. btw" : "Totaal inclusief btw"}<strong>{formatMoney(content.knownTotalCents)}</strong>{content.pendingCount > 0 && <p>{content.pendingCount} post(en) nader te bepalen; niet inbegrepen in dit subtotaal.</p>}</div>
      <p className={styles.muted}>Dit is een offerte, geen btw-factuur. Er is nog geen btw-uitsplitsing.</p></section>
    {content.terms && <section><h3>Afspraken en voorwaarden</h3><p>{content.terms}</p></section>}
  </article>;
}

export default function Quotes({ workspaceId, businessId, businesses = [], session, request: requestOverride }) {
  const sessionRef = useRef(session); sessionRef.current = session;
  const [tab, setTab] = useState("quotes"), [rows, setRows] = useState([]), [more, setMore] = useState(false);
  const [search, setSearch] = useState(""), [page, setPage] = useState(0), [refresh, setRefresh] = useState(0);
  const [loading, setLoading] = useState(false), [busy, setBusy] = useState(false), [error, setError] = useState(""), [notice, setNotice] = useState("");
  const [draft, setDraft] = useState(null), [guestDraft, setGuestDraft] = useState(null);
  const [dirty, setDirty] = useState(false), [guestDirty, setGuestDirty] = useState(false);
  const [guestSearch, setGuestSearch] = useState(""), [guestPage, setGuestPage] = useState(0), [guestChoices, setGuestChoices] = useState([]), [guestMore, setGuestMore] = useState(false);
  const [preview, setPreview] = useState(false), [versions, setVersions] = useState(null), [oldVersion, setOldVersion] = useState(null);
  const busyRef = useRef(false);
  const previewRef = useRef(null);
  const request = useCallback(async input => {
    if (requestOverride) return requestOverride({ workspaceId, ...input });
    const response = await fetch("/api/quotes", { method: "POST", cache: "no-store", signal: AbortSignal.timeout(20000), headers: { "Content-Type": "application/json", Authorization: `Bearer ${sessionRef.current?.access_token || ""}` }, body: JSON.stringify({ workspaceId, ...input }) });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(result.error || "De bewerking kon niet worden bevestigd. Controleer het overzicht voordat je opnieuw probeert.");
    return result;
  }, [workspaceId, requestOverride]);

  useEffect(() => {
    if (tab === "edit") return;
    let active = true;
    setLoading(true);
    const timer = setTimeout(async () => {
      try {
        const result = await request({ action: "list", entity: tab === "guests" ? "guests" : "quotes", businessId: businesses.some(b => b.id === businessId) ? businessId : null, search, page });
        if (active) { setRows(result.rows); setMore(result.hasMore); setError(""); }
      } catch (e) { if (active) { setError(e.message); setRows([]); setMore(false); } }
      finally { if (active) setLoading(false); }
    }, 200);
    return () => { active = false; clearTimeout(timer); };
  }, [request, tab, search, page, refresh, businessId, businesses]);
  useEffect(() => {
    if (tab !== "edit") return;
    let active = true;
    const timer = setTimeout(async () => {
      try {
        const result = await request({ action: "list", entity: "guests", search: guestSearch, page: guestPage });
        if (active) { setGuestChoices(result.rows); setGuestMore(result.hasMore); }
      } catch (e) { if (active) setError(e.message); }
    }, 200);
    return () => { active = false; clearTimeout(timer); };
  }, [request, tab, guestSearch, guestPage, refresh]);
  useEffect(() => {
    if (!preview) return;
    previewRef.current?.scrollIntoView?.({ behavior: "smooth", block: "start" });
    previewRef.current?.focus?.({ preventScroll: true });
  }, [preview]);
  useEffect(() => {
    if (!dirty && !guestDirty) return;
    const warn = e => { e.preventDefault(); e.returnValue = ""; };
    const navigateAway = e => {
      const link = e.target?.closest?.("a[href]");
      if (!link || link.target === "_blank" || e.ctrlKey || e.metaKey || e.shiftKey) return;
      const destination = new URL(link.href, window.location.href);
      if (destination.pathname === window.location.pathname) return;
      if (!window.confirm("Je hebt onbewaarde offerte- of gastgegevens. Toch deze pagina verlaten?")) { e.preventDefault(); e.stopPropagation(); }
    };
    window.addEventListener("beforeunload", warn);
    document.addEventListener("click", navigateAway, true);
    return () => { window.removeEventListener("beforeunload", warn); document.removeEventListener("click", navigateAway, true); };
  }, [dirty, guestDirty]);
  const perform = async action => {
    if (busyRef.current) return;
    busyRef.current = true; setBusy(true); setError(""); setNotice("");
    try { await action(); } catch (e) { setError(e.name === "TimeoutError" ? "Opslaan duurde te lang om te bevestigen. Je invoer blijft staan; controleer eerst het overzicht." : e.message); }
    finally { busyRef.current = false; setBusy(false); }
  };
  const canReplace = changed => !changed || window.confirm("Je hebt onbewaarde wijzigingen. Wil je die verwerpen?");
  const navigate = next => { setTab(next); setSearch(""); setPage(0); setNotice(""); setError(""); };
  const newQuote = () => {
    if (!canReplace(dirty)) return;
    setDraft({ id: crypto.randomUUID(), version: null, business_id: businesses.some(b => b.id === businessId) ? businessId : businesses[0]?.id || "", guest_id: "", guest_snapshot: null, content: blankQuote() });
    setDirty(false); setPreview(false); setVersions(null); setOldVersion(null); navigate("edit");
  };
  const openQuote = row => {
    if (!canReplace(dirty)) return;
    setDraft(row); setDirty(false); setPreview(false); setVersions(null); setOldVersion(null); navigate("edit");
  };
  const editContent = patch => { setDraft(prev => ({ ...prev, content: { ...prev.content, ...patch } })); setDirty(true); setPreview(false); setNotice(""); };
  const editRows = (key, index, patch) => editContent({ [key]: draft.content[key].map((row, i) => i === index ? { ...row, ...patch } : row) });
  const saveQuote = () => perform(async () => {
    validateQuote(draft.content);
    if (!draft.guest_id) throw new Error("Kies eerst een opgeslagen gast, of maak die aan bij Gasten.");
    const { row } = await request({ action: "save_quote", id: draft.id, version: draft.version, businessId: draft.business_id, guestId: draft.guest_id, content: draft.content });
    setDraft(row); setDirty(false); setRefresh(v => v + 1); setVersions(null); setNotice(`Offerte ${row.quote_number} is bewaard als concept (versie ${row.version}). Er is niets verstuurd of ingepland.`);
  });
  const saveGuest = () => perform(async () => {
    const { row } = await request({ action: "save_guest", id: guestDraft.id, version: guestDraft.version, guest: guestDraft });
    setGuestDraft(row); setGuestDirty(false); setRefresh(v => v + 1); setNotice("Gast opgeslagen. Bestaande offertes houden hun oorspronkelijke gastgegevens.");
  });
  let calculated, calculationError;
  if (draft) { try { calculated = validateQuote(draft.content); } catch (e) { calculationError = e.message; } }
  const pagination = (current, next, previous, hasMore) => <div className={styles.actions}><button type="button" className="secondary" disabled={busy || current === 0} onClick={previous}>Vorige</button><span>Pagina {current + 1}</span><button type="button" className="secondary" disabled={busy || !hasMore} onClick={next}>Volgende</button></div>;
  return <section className={styles.module} aria-label="Gasten en offertes">
    <header className={styles.header}><div><h2>Gasten & offertes</h2><p className={styles.muted}>Een gast kiezen, offerte samenstellen en als concept bewaren. Alleen toegankelijk voor de eigenaar.</p></div><button type="button" disabled={busy} onClick={newQuote}>Nieuwe offerte</button></header>
    <nav className={styles.actions} aria-label="Offertemodule"><button type="button" className="secondary" disabled={busy} aria-pressed={tab === "quotes"} onClick={() => navigate("quotes")}>Offertes</button><button type="button" className="secondary" disabled={busy} aria-pressed={tab === "guests"} onClick={() => navigate("guests")}>Gasten</button>{draft && <button type="button" className="secondary" disabled={busy} onClick={() => navigate("edit")}>Verder met huidige offerte{dirty ? " *" : ""}</button>}</nav>
    <p className={styles.notice}>Deze eerste versie bewaart gasten en conceptoffertes met een voorbeeld en versiehistorie. Versturen, digitale acceptatie, definitieve PDF-opmaak en agendakoppeling zijn nog niet actief.</p>
    {tab !== "edit" && error && <p className={styles.error} role="alert">{error}</p>}{tab !== "edit" && notice && <p className={styles.notice} role="status">{notice}</p>}
    {tab !== "edit" && <section className={styles.panel}>
      <div className={styles.toolbar}><Field label={tab === "guests" ? "Zoeken op gastnaam" : "Zoeken op offertenaam"}><input type="search" value={search} onChange={e => { setSearch(e.target.value); setPage(0); }} /></Field>
        <div className={styles.actions}><button type="button" className="secondary" disabled={busy || loading} onClick={() => setRefresh(v => v + 1)}>Overzicht vernieuwen</button>{tab === "guests" && <button type="button" disabled={busy} onClick={() => { if (!canReplace(guestDirty)) return; setGuestDraft({ id: crypto.randomUUID(), version: null, ...emptyGuest() }); setGuestDirty(false); }}>Nieuwe gast</button>}</div></div>
      {loading ? <p role="status">Overzicht laden…</p> : rows.length ? <div className={styles.list}>{rows.map(row => <article key={row.id} className={styles.card}><div><strong>{tab === "guests" ? guestLabel(row) : row.content.title}</strong><p className={styles.muted}>{tab === "guests" ? [row.email, row.phone].filter(Boolean).join(" · ") : `Offerte ${row.quote_number} · ${row.guest_snapshot.name} · ${displayDate(row.content.eventDate)} · Concept · v${row.version}`}</p></div><button type="button" className="secondary" disabled={busy} onClick={() => { if (tab === "quotes") openQuote(row); else if (canReplace(guestDirty)) { setGuestDraft(row); setGuestDirty(false); } }}>Openen</button></article>)}</div> : !error && <p>Nog geen {tab === "guests" ? "gasten" : "offertes"} gevonden.</p>}
      {pagination(page, () => setPage(p => p + 1), () => setPage(p => p - 1), more)}
    </section>}
    {tab === "guests" && guestDraft && <form className={styles.panel} onSubmit={e => { e.preventDefault(); saveGuest(); }}>
      <h3>{guestDraft.version ? "Gast wijzigen" : "Nieuwe gast"}</h3><fieldset disabled={busy} className={styles.grid}>
        {[["name", "Naam *", 160], ["company", "Bedrijf", 160], ["email", "E-mailadres", 254], ["phone", "Telefoon", 60], ["address", "Adres en postcode", 300], ["notes", "Interne notities (niet op de offerte)", 2000]].map(([key, label, max]) => <Field key={key} label={label}><input required={key === "name"} type={key === "email" ? "email" : "text"} maxLength={max} value={guestDraft[key]} onChange={e => { setGuestDraft(g => ({ ...g, [key]: e.target.value })); setGuestDirty(true); }} /></Field>)}
      </fieldset><div className={styles.actions}><button disabled={busy || (!!guestDraft.version && !guestDirty)}>{busy ? "Bezig…" : "Gast bewaren"}</button>{draft && guestDraft.version && <button type="button" className="secondary" disabled={busy || guestDirty} onClick={() => { setDraft(d => ({ ...d, guest_id: guestDraft.id, guest_snapshot: d.guest_id === guestDraft.id ? d.guest_snapshot : guestSnapshot(guestDraft) })); setDirty(true); navigate("edit"); }}>Deze gast gebruiken in offerte</button>}</div>
    </form>}
    {tab === "edit" && draft && <>
      <form className={styles.panel} onSubmit={e => { e.preventDefault(); saveQuote(); }}>
        <div className={styles.toolbar}><h3>{draft.quote_number ? `Offerte ${draft.quote_number}` : "Nieuwe offerte"}</h3><span className={styles.badge}>{dirty || !draft.version ? "Onbewaard concept" : `Bewaard concept · versie ${draft.version}`}</span></div>
        <fieldset disabled={busy} className={styles.panel}><legend>1. Gast en bijeenkomst</legend>
          <div className={styles.grid}><Field label="Vestiging *"><select required value={draft.business_id} onChange={e => { setDraft(d => ({ ...d, business_id: e.target.value })); setDirty(true); }}><option value="">Kies een vestiging</option>{businesses.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}</select></Field>
          <Field label="Zoek een opgeslagen gast op naam"><input value={guestSearch} onChange={e => { setGuestSearch(e.target.value); setGuestPage(0); }} /></Field>
          <Field label="Gast *"><select required value={draft.guest_id} onChange={e => { const g = guestChoices.find(g => g.id === e.target.value); setDraft(d => ({ ...d, guest_id: g?.id || "", guest_snapshot: g ? (d.guest_id === g.id ? d.guest_snapshot : guestSnapshot(g)) : null })); setDirty(true); }}><option value="">Kies een gast</option>{draft.guest_id && !guestChoices.some(g => g.id === draft.guest_id) && <option value={draft.guest_id}>{guestLabel(draft.guest_snapshot)}</option>}{guestChoices.map(g => <option key={g.id} value={g.id}>{guestLabel(g)}{g.email ? ` · ${g.email}` : ""}</option>)}</select></Field>
          <div className={styles.actions}><button type="button" className="secondary" onClick={() => navigate("guests")}>Gast toevoegen of wijzigen</button>{pagination(guestPage, () => setGuestPage(p => p + 1), () => setGuestPage(p => p - 1), guestMore)}</div>
          <Field label="Offertenaam / gelegenheid *"><input required maxLength={200} value={draft.content.title} onChange={e => editContent({ title: e.target.value })} /></Field>
          <Field label="Datum bijeenkomst *"><input required type="date" value={draft.content.eventDate} onChange={e => editContent({ eventDate: e.target.value })} /></Field>
          <Field label="Aantal gasten *"><input required type="number" min="1" max="100000" value={draft.content.guestCount} onChange={e => editContent({ guestCount: e.target.value })} /></Field>
          <Field label="Locatie / ruimte"><input maxLength={300} value={draft.content.location} onChange={e => editContent({ location: e.target.value })} /></Field>
          <Field label="Offerte geldig tot en met"><input type="date" value={draft.content.validUntil} onChange={e => editContent({ validUntil: e.target.value })} /></Field></div>
          <Field label="Persoonlijke inleiding en afspraken"><textarea rows={4} maxLength={10000} value={draft.content.introduction} onChange={e => editContent({ introduction: e.target.value })} /></Field>
          <p className={styles.muted}>Een bewaarde offerte houdt haar eigen kopie van de gastgegevens. Wijzigen in Gasten verandert bestaande offertes niet.</p>
        </fieldset>
        <fieldset disabled={busy} className={styles.panel}><legend>2. Programma</legend><p className={styles.muted}>Tijden zijn Nederlandse lokale tijden. Vink ‘volgende dag’ aan voor bijvoorbeeld 01:00 na een avondfeest.</p>
          {draft.content.program.map((row, i) => <div className={styles.program} key={i}><Field label="Tijd"><input required type="time" value={row.time} onChange={e => editRows("program", i, { time: e.target.value })} /></Field><Field label="Onderdeel"><input required maxLength={300} value={row.description} onChange={e => editRows("program", i, { description: e.target.value })} /></Field><label className={styles.check}><input type="checkbox" checked={row.nextDay} onChange={e => editRows("program", i, { nextDay: e.target.checked })} />Volgende dag</label><button type="button" className="secondary" aria-label={`Programmaonderdeel ${i + 1} verwijderen`} onClick={() => editContent({ program: draft.content.program.filter((_, j) => i !== j) })}>Verwijderen</button></div>)}
          <button type="button" className="secondary" disabled={draft.content.program.length >= 40} onClick={() => editContent({ program: [...draft.content.program, { time: "", description: "", nextDay: false }] })}>Programmaonderdeel toevoegen</button>
        </fieldset>
        <fieldset disabled={busy} className={styles.panel}><legend>3. Begroting</legend><p className={styles.muted}>Vul prijzen inclusief btw in. Aantallen per regel zijn zelfstandig: een wijziging van het aantal gasten past deze niet stilzwijgend aan. Vul 0 in voor inbegrepen onderdelen.</p>
          {draft.content.lines.map((row, i) => <div key={i} className={styles.line}>
            <Field label="Omschrijving *"><input required maxLength={200} value={row.label} onChange={e => editRows("lines", i, { label: e.target.value })} /></Field>
            <Field label="Eenheid"><select value={row.unit} onChange={e => editRows("lines", i, { unit: e.target.value })}><option value="fixed">Stuks / arrangement</option><option value="person">Per persoon</option><option value="hour">Per uur</option></select></Field>
            <Field label="Aantal *"><input required type="number" min="1" max="100000" value={row.quantity} onChange={e => editRows("lines", i, { quantity: e.target.value })} /></Field>
            <Field label="Uren"><input disabled={row.unit !== "hour"} inputMode="decimal" value={row.unit === "hour" ? row.hours : "1"} onChange={e => editRows("lines", i, { hours: e.target.value })} /></Field>
            <Field label="Prijs (€ incl. btw)"><input required={!row.pending} disabled={row.pending} inputMode="decimal" value={row.price} onChange={e => editRows("lines", i, { price: e.target.value })} /></Field>
            <div className={styles.lineFoot}><label className={styles.check}><input type="checkbox" checked={row.pending} onChange={e => editRows("lines", i, { pending: e.target.checked })} />Bedrag nader te bepalen</label><strong>{calculated ? (row.pending ? "Nader te bepalen" : formatMoney(calculated.lines[i].totalCents)) : "—"}</strong><button type="button" className="secondary" disabled={draft.content.lines.length === 1} aria-label={`Begrotingsregel ${i + 1} verwijderen`} onClick={() => editContent({ lines: draft.content.lines.filter((_, j) => i !== j) })}>Verwijderen</button></div>
          </div>)}
          <button type="button" className="secondary" disabled={draft.content.lines.length >= 80} onClick={() => editContent({ lines: [...draft.content.lines, { label: "", unit: "fixed", quantity: "1", hours: "1", price: "", pending: false }] })}>Begrotingsregel toevoegen</button>
          {calculated && <div className={styles.total}>{calculated.pendingCount ? "Subtotaal bekende bedragen, inclusief btw" : "Totaal inclusief btw"}<strong>{formatMoney(calculated.knownTotalCents)}</strong>{calculated.pendingCount > 0 && <p>{calculated.pendingCount} post(en) nog niet inbegrepen.</p>}</div>}
        </fieldset>
        <Field label="4. Afspraken en voorwaarden"><textarea disabled={busy} rows={6} maxLength={12000} value={draft.content.terms} placeholder="Bijvoorbeeld aanbetaling, definitief gastenaantal, catering en annulering. Controleer zelf de actuele afspraken." onChange={e => editContent({ terms: e.target.value })} /></Field>
        <div className={styles.actions}><button disabled={busy || (!!draft.version && !dirty)}>{busy ? "Bezig met bewaren…" : "Concept bewaren in Horeca OS"}</button><button type="button" className="secondary" disabled={busy} onClick={() => { if (!calculated) { setError(calculationError); return; } setPreview(true); }}>Offertevoorbeeld bekijken</button>{draft.version && <button type="button" className="secondary" disabled={busy} onClick={() => perform(async () => { const result = await request({ action: "history", id: draft.id }); setVersions(result.rows); })}>Bewaarde versies bekijken</button>}</div>
        <p className={styles.muted}>Bewaren verstuurt niets en maakt geen evenement aan. Gebruik Gasten om later dezelfde gast opnieuw te kiezen.</p>
        {error && <p className={styles.error} role="alert">{error}</p>}{notice && <p className={styles.notice} role="status">{notice}</p>}
      </form>
      {preview && calculated && <div ref={previewRef} tabIndex={-1}><QuotePreview content={calculated} guest={draft.guest_snapshot} business={businesses.find(b => b.id === draft.business_id)?.name} number={dirty ? null : draft.quote_number} version={draft.version} /></div>}
      {versions && <section className={styles.panel}><h3>Bewaarde versies</h3><p className={styles.muted}>De laatste 50 versies. Bekijken verandert de huidige offerte niet.</p><div className={styles.versions}>{versions.map(v => <div className={styles.toolbar} key={v.version}><span>Versie {v.version} · {new Date(v.saved_at).toLocaleString("nl-NL", { timeZone: "Europe/Amsterdam" })}</span><button type="button" className="secondary" onClick={() => setOldVersion(v.snapshot)}>Deze versie bekijken</button></div>)}</div>{oldVersion && <QuotePreview content={oldVersion.content} guest={oldVersion.guest_snapshot} business={businesses.find(b => b.id === oldVersion.business_id)?.name} number={oldVersion.quote_number} version={oldVersion.version} />}</section>}
    </>}
  </section>;
}
