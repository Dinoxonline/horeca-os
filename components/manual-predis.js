"use client";

import { useEffect, useRef, useState } from "react";
import Image from "next/image";
import { instagramEventMedia } from "../lib/instagram-event-media";
import { PREDIS_CHANNELS, PREDIS_STATES, PREDIS_DAYS, localToday, makeManualEntries, validateManualDraft, transferText, manualDistribution, retainedConfirmations } from "../lib/manual-predis";
import styles from "./manual-predis.module.css";

export default function ManualPredis({ item, workspaceId, session, businessName, enabled, linkedSources = [], onSaved, onUnsavedChange }) {
  const dist = manualDistribution(item) || {};
  const initial = () => ({ caption: dist.common?.description || item.body || dist.common?.title || "", assets: [], entries: [], timezone: "Europe/Amsterdam" });
  const [draft, setDraft] = useState(initial);
  const [saved, setSaved] = useState(null);
  const [loaded, setLoaded] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState("");
  const [message, setMessage] = useState("");
  const [failed, setFailed] = useState(false);
  const [mode, setMode] = useState("single");
  const [start, setStart] = useState(localToday);
  const [end, setEnd] = useState(localToday);
  const [time, setTime] = useState("10:00");
  const [days, setDays] = useState([3]);
  const [channels, setChannels] = useState([]);
  const [entryKey, setEntryKey] = useState("");
  const [state, setState] = useState("scheduled");
  const [confirmed, setConfirmed] = useState(false);
  const mounted = useRef(true), lock = useRef(false), requests = useRef(new Set());
  const tokenRef = useRef(session?.access_token); tokenRef.current = session?.access_token;
  const onSavedRef = useRef(onSaved); onSavedRef.current = onSaved;
  const assets = instagramEventMedia(item, linkedSources);
  const hasToken = Boolean(session?.access_token);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; requests.current.forEach(c => c.abort()); }; }, []);
  useEffect(() => { onUnsavedChange?.(dirty || Boolean(busy)); return () => onUnsavedChange?.(false); }, [dirty, busy, onUnsavedChange]);
  useEffect(() => {
    if (typeof window === "undefined") return;
    const warn = event => { if (dirty || busy) { event.preventDefault(); event.returnValue = ""; } };
    window.addEventListener("beforeunload", warn); return () => window.removeEventListener("beforeunload", warn);
  }, [dirty, busy]);

  async function request(action, extra = {}) {
    const context = { workspaceId, businessId: item.business_id, itemId: item.id };
    const controller = new AbortController(); requests.current.add(controller);
    const timer = setTimeout(() => controller.abort(), 20000);
    try {
      const response = await fetch(`/api/marketing/manual-predis${action ? "" : "?" + new URLSearchParams(context)}`, {
        method: action ? "POST" : "GET", signal: controller.signal, cache: "no-store",
        headers: { Authorization: `Bearer ${tokenRef.current || ""}`, "Content-Type": "application/json" },
        ...(action ? { body: JSON.stringify({ ...context, action, expectedRevision: saved?.revision || null, ...extra }) } : {}),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Deze actie is niet gelukt.");
      return data.saved;
    } finally { clearTimeout(timer); requests.current.delete(controller); }
  }
  async function run(label, fn) {
    if (lock.current) return;
    lock.current = true; setBusy(label); setFailed(false); setMessage("");
    try { await fn(); }
    catch (e) { if (mounted.current) { setFailed(true); setMessage(e.name === "AbortError" ? "Geen bevestiging ontvangen. Je invoer blijft staan. Controleer de bewaarde versie voordat je opnieuw handelt." : e.message); } }
    finally { lock.current = false; if (mounted.current) setBusy(""); }
  }
  function accept(next) {
    if (!mounted.current) return;
    setSaved(next); setDraft(next?.draft || initial()); setLoaded(true); setDirty(false); setConfirmed(false); onSavedRef.current?.(next);
  }
  function load() { return run("Voorbereiding laden…", async () => { const next = await request(); accept(next); }); }
  useEffect(() => { if (enabled && hasToken && !loaded && !lock.current) load(); }, [enabled, hasToken]); // Token refresh must not discard input.
  function change(next) { setDraft(next); setDirty(true); setConfirmed(false); setMessage(""); }
  function addMoments() {
    try {
      const next = makeManualEntries({ start, end: mode === "single" ? start : end, time, weekdays: mode === "weekly" ? days : undefined, channels });
      if (!next.length) throw new Error("Geen gekozen weekdagen in deze periode.");
      const unique = new Map([...draft.entries, ...next].map(e => [e.key, e]));
      change(validateManualDraft({ ...draft, entries: [...unique.values()] })); setFailed(false); setMessage(`${next.length} kanaalacties toegevoegd aan je voorbereiding. Bewaar hieronder.`);
    } catch (e) { setFailed(true); setMessage(e.message); }
  }
  async function copy(value, label) {
    try { await navigator.clipboard.writeText(value); setFailed(false); setMessage(`${label} gekopieerd. Er is niets ingepland of gepubliceerd.`); }
    catch { setFailed(true); setMessage("Kopiëren is geblokkeerd. Selecteer de tekst en gebruik Ctrl+C."); }
  }
  function save() {
    let normalized;
    try { normalized = validateManualDraft(draft); } catch (e) { setFailed(true); setMessage(e.message); return; }
    const kept = retainedConfirmations(saved, normalized);
    const reset = Object.keys(saved?.confirmations || {}).some(key => !kept[key]);
    if (reset && !window.confirm("Je wijzigt eerder bevestigde inhoud of momenten. De betrokken bevestigingen worden opnieuw ‘Nog overzetten’. Pas deze ook zelf in Predis aan. Doorgaan?")) return;
    return run("Voorbereiding bewaren…", async () => { const next = await request("save", { draft: normalized, acceptReset: reset }); accept(next); if (mounted.current) setMessage("Bewaard in Horeca OS. Je kunt nu overzetten naar Predis; er is nog niets automatisch ingepland."); });
  }
  const chosen = draft.entries.find(e => e.key === entryKey);
  if (!enabled && !loaded) return null;
  return <section className={styles.root} aria-label="Predis handmatig voorbereiden">
    <div className={styles.notice}><strong>Handmatig via Predis · {businessName}</strong><p>Bereid alles hier voor. Kopieer je tekst, gebruik je media en kies in Predis het juiste merk en account. Bevestig daarna hier wat je daar hebt ingepland. Horeca OS verstuurt niets naar Predis.</p></div>
    {busy && <p role="status">{busy}</p>}
    {message && <p role={failed ? "alert" : "status"} className={failed ? styles.error : styles.notice}>{message}</p>}
    <div className={styles.actions}><button type="button" className="secondaryButton" disabled={!!busy} onClick={() => { if (!dirty || window.confirm("Je hebt onbewaarde wijzigingen. Wil je de bewaarde versie laden en je invoer vervangen?")) load(); }}>Bewaarde versie laden</button>{dirty && <strong>Niet-bewaarde wijzigingen</strong>}</div>
    {!loaded && <p>Open of laad eerst de voorbereiding. Bij een laadfout blijft bewaren geblokkeerd.</p>}
    <fieldset disabled={!loaded || !!busy} className={styles.fields}>
      <legend>1. Tekst en media uit Horeca OS</legend>
      <div className={styles.columns}>
        <div><label>Tekst voor Predis<textarea rows={7} maxLength={10000} value={draft.caption} onChange={e => change({ ...draft, caption: e.target.value })} /></label><div className={styles.actions}><button type="button" className="secondaryButton" onClick={() => copy(draft.caption, "Berichttekst")}>Tekst kopiëren</button><button type="button" className="secondaryButton" onClick={() => { if (window.confirm("Vervang deze berichttekst door de huidige tekst uit Horeca OS?")) change({ ...draft, caption: initial().caption }); }}>Horeca OS-tekst overnemen</button></div><small>Deze tekst is een aparte voorbereiding. De evenementtekst en bestaande publicaties veranderen niet.</small></div>
        <div><strong>Gekozen media ({draft.assets.length}/10)</strong>{!draft.assets.length && <p>Kies hieronder een bestand van dit evenement.</p>}<div className={styles.media}>{draft.assets.map((a, i) => <div key={a.url}>{a.type === "image" ? <Image unoptimized src={a.url} width={240} height={150} alt={a.label} /> : <video src={a.url} controls preload="none" />}<small>{i + 1}. {a.label}</small><a href={a.url} target="_blank" rel="noopener noreferrer">Bestand openen / bewaren</a><button type="button" className="secondaryButton" onClick={() => copy(a.url, "Bestandslink")}>Link kopiëren</button><button type="button" className="secondaryButton" onClick={() => change({ ...draft, assets: draft.assets.filter(x => x.url !== a.url) })}>Verwijderen uit selectie</button></div>)}</div></div>
      </div>
      <details><summary>Media kiezen uit Horeca OS ({assets.length})</summary><p>Gebruik bij een geopend bestand ‘Opslaan als’ en upload het in Predis. Het originele bestand blijft behouden. Berichttype en uitsnede controleer je in Predis.</p><div className={styles.media}>{assets.map(a => <div key={a.url}>{a.type === "image" ? <Image unoptimized src={a.url} width={240} height={150} alt={a.label} /> : <video src={a.url} controls preload="none" />}<small>{a.label}</small><button type="button" className="secondaryButton" disabled={draft.assets.length >= 10 || draft.assets.some(x => x.url === a.url)} onClick={() => change({ ...draft, assets: [...draft.assets, { url: a.url, type: a.type, label: a.label }] })}>{draft.assets.some(x => x.url === a.url) ? "Gekozen" : "Dit bestand kiezen"}</button></div>)}</div>{!assets.length && <p>Nog geen media aan dit evenement gekoppeld. Voeg die toe bij het evenement.</p>}</details>
    </fieldset>
    <fieldset disabled={!loaded || !!busy} className={styles.fields}><legend>2. Gewenste publicatiemomenten</legend>
      <div className={styles.choices}>{Object.entries(PREDIS_CHANNELS).map(([key, name]) => <label key={key}><input type="checkbox" checked={channels.includes(key)} onChange={() => setChannels(channels.includes(key) ? channels.filter(c => c !== key) : [...channels, key])} />{name}</label>)}</div>
      <div className={styles.grid}><label>Momenten toevoegen<select value={mode} onChange={e => setMode(e.target.value)}><option value="single">Losse datum</option><option value="weekly">Weekdagen binnen een periode</option></select></label><label>{mode === "single" ? "Datum" : "Begindatum"}<input type="date" value={start} onChange={e => setStart(e.target.value)} /></label>{mode === "weekly" && <label>Einddatum<input type="date" value={end} min={start} onChange={e => setEnd(e.target.value)} /></label>}<label>Tijd (Nederland)<input type="time" value={time} onChange={e => setTime(e.target.value)} /></label></div>
      {mode === "weekly" && <div className={styles.choices}>{PREDIS_DAYS.map(([day, name]) => <label key={day}><input type="checkbox" checked={days.includes(day)} onChange={() => setDays(days.includes(day) ? days.filter(d => d !== day) : [...days, day])} />{name}</label>)}</div>}
      <button type="button" className="secondaryButton" onClick={addMoments}>Momenten toevoegen aan voorbereiding</button><small>Datums en tijden blijven Nederlandse kloktijd, ook bij zomer-/wintertijd. Controleer in Predis de tijdzone Europe/Amsterdam. Dit maakt nog geen publicatieopdracht.</small>
      <div className={styles.tableWrap}><table><caption>Planning en voortgang per kanaal</caption><thead><tr><th>Gewenst moment</th><th>Kanaal</th><th>Status</th><th>Actie</th></tr></thead><tbody>{draft.entries.map(e => { const c = saved?.confirmations?.[e.key]; return <tr key={e.key}><td>{e.at.slice(8, 10)}-{e.at.slice(5, 7)}-{e.at.slice(0, 4)} · {e.at.slice(11)}</td><td>{PREDIS_CHANNELS[e.channel]}</td><td>{PREDIS_STATES[c?.state] || PREDIS_STATES.pending}{c && <small>Bevestigd op {new Date(c.at).toLocaleString("nl-NL")}{dirty ? " · inhoud gewijzigd; controleer opnieuw" : ""}</small>}</td><td><button type="button" className="secondaryButton" onClick={() => { setEntryKey(e.key); setConfirmed(false); }}>Controleren</button><button type="button" className="secondaryButton" aria-label={`Verwijder ${e.at} ${PREDIS_CHANNELS[e.channel]}`} onClick={() => change({ ...draft, entries: draft.entries.filter(x => x.key !== e.key) })}>×</button></td></tr>; })}</tbody></table></div>
      {!draft.entries.length && <p>Voeg één datum toe, of maak in één keer de momenten voor een hele maand.</p>}
      <div className={styles.actions}><button type="button" className="secondaryButton" onClick={save}>Voorbereiding bewaren in Horeca OS</button><button type="button" className="secondaryButton" onClick={() => copy(transferText(dist.common?.title || "Evenement", draft), "Tekst, media en planning")}>Alles kopiëren</button></div>
    </fieldset>
    <div className={styles.notice}><strong>3. Overzetten en hier bevestigen</strong><p>Open Predis, kies het merk <b>{businessName}</b>, plak de tekst, voeg de gekozen media toe en stel de momenten in. Controleer elk kanaal en bevestig de uitkomst hieronder. Een kopieeractie telt nooit als publicatie.</p><a className="secondaryButton" href="https://app.predis.ai/app/workspace" target="_blank" rel="noopener noreferrer">Predis openen</a><small>Een gekoppeld kanaal kan verlopen zijn; controleer de accountstatus in Predis.</small></div>
    {chosen && <fieldset className={styles.fields} disabled={!!busy || dirty || !loaded}><legend>Status bevestigen</legend><strong>{chosen.at.replace("T", " ")} · {PREDIS_CHANNELS[chosen.channel]}</strong><label>Wat heb je gecontroleerd?<select value={state} onChange={e => { setState(e.target.value); setConfirmed(false); }}><option value="scheduled">Dit moment is ingepland in Predis</option><option value="published">Dit bericht is daadwerkelijk geplaatst</option><option value="pending">Terug naar ‘Nog overzetten’</option></select></label><label className={styles.check}><input type="checkbox" checked={confirmed} onChange={e => setConfirmed(e.target.checked)} />Ik heb dit zelf gecontroleerd voor de juiste vestiging, datum en het juiste kanaal.</label><button type="button" className="secondaryButton" disabled={!confirmed || dirty} onClick={() => run("Status bewaren…", async () => { const next = await request("confirm", { entryKey: chosen.key, state, confirmed }); accept(next); if (mounted.current) setMessage("Je handmatige bevestiging is bewaard. Niet automatisch door Predis gecontroleerd."); })}>Handmatige bevestiging bewaren</button></fieldset>}
    {chosen && dirty && <p>Bewaar eerst de voorbereiding voordat je een status bevestigt.</p>}
    <small>Verwijderen of aanpassen in Horeca OS wijzigt niets in Predis. Pas een reeds ingepland bericht daar ook zelf aan. Bevestigingen worden nooit automatisch ‘Geplaatst’ wanneer de tijd verstrijkt.</small>
  </section>;
}
