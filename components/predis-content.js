"use client";

import { useEffect, useRef, useState } from "react";
import Image from "next/image";
import { PREDIS_FORMATS, PREDIS_JOB_LABELS, predisPrompt } from "../lib/predis-content";
import styles from "./manual-predis.module.css";

export default function PredisContent({ item, workspaceId, session, enabled, businessName, onUse, onUnsavedChange }) {
  const [prompt, setPrompt] = useState(() => predisPrompt(item));
  const [format, setFormat] = useState("single_image"), [photos, setPhotos] = useState([]), [selected, setSelected] = useState([]);
  const [jobs, setJobs] = useState([]), [config, setConfig] = useState(null), [loaded, setLoaded] = useState(false);
  const [confirmed, setConfirmed] = useState(false), [acknowledgePending, setAcknowledgePending] = useState(false);
  const [needsCheck, setNeedsCheck] = useState(false);
  const [busy, setBusy] = useState(false), [dirty, setDirty] = useState(false), [message, setMessage] = useState(""), [error, setError] = useState("");
  const mounted = useRef(true), lock = useRef(false), controllers = useRef(new Set()), requestId = useRef(null);
  const token = useRef(session?.access_token); token.current = session?.access_token;
  const hasToken = Boolean(session?.access_token);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; controllers.current.forEach(c => c.abort()); }; }, []);
  useEffect(() => { onUnsavedChange?.(dirty || busy); return () => onUnsavedChange?.(false); }, [dirty, busy, onUnsavedChange]);
  useEffect(() => {
    if (typeof window === "undefined") return;
    const warn = e => { if (dirty || busy) { e.preventDefault(); e.returnValue = ""; } };
    window.addEventListener("beforeunload", warn); return () => window.removeEventListener("beforeunload", warn);
  }, [dirty, busy]);
  async function request(action, extra = {}) {
    const scope = { workspaceId, businessId: item.business_id, itemId: item.id }, c = new AbortController(); controllers.current.add(c);
    const timer = setTimeout(() => c.abort(), 55000);
    try {
      const response = await fetch(`/api/marketing/predis-content${action ? "" : "?" + new URLSearchParams(scope)}`, { method: action ? "POST" : "GET", cache: "no-store", signal: c.signal,
        headers: { Authorization: `Bearer ${token.current || ""}`, "Content-Type": "application/json" }, ...(action ? { body: JSON.stringify({ ...scope, action, ...extra }) } : {}) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Predis is niet bereikbaar.");
      return data;
    } finally { clearTimeout(timer); controllers.current.delete(c); }
  }
  async function run(fn) {
    if (lock.current) return;
    lock.current = true; setBusy(true); setError(""); setMessage("");
    try { await fn(); } catch (e) { if (mounted.current) setError(e.name === "AbortError" ? "Geen bevestiging ontvangen. Laad eerst de bewaarde aanvragen; niet opnieuw genereren." : e.message); }
    finally { lock.current = false; if (mounted.current) setBusy(false); }
  }
  async function load() {
    return run(async () => {
      const data = await request(); if (!mounted.current) return;
      setJobs(data.jobs); setConfig(data); setPhotos(data.photos); setLoaded(true);
      setNeedsCheck(false);
      if (!loaded && !dirty) setSelected(data.photos.slice(0, 1).map(a => a.url));
      if (requestId.current && data.jobs.some(j => j.id === requestId.current)) { requestId.current = null; setDirty(false); }
    });
  }
  useEffect(() => { if (enabled && hasToken && !loaded && !lock.current) load(); }, [enabled, hasToken]);
  function edit(fn) { fn(); setDirty(true); setConfirmed(false); }
  function generate() {
    if (!confirmed || !loaded || !config?.configured) return;
    return run(async () => {
      requestId.current ||= crypto.randomUUID();
      let data;
      try { data = await request("generate", { requestId: requestId.current, prompt, mediaType: format, mediaUrls: selected, confirmed, acknowledgePending }); }
      catch (e) { if (mounted.current) setNeedsCheck(true); throw e; }
      if (!mounted.current) return;
      setJobs(data.jobs); setDirty(false); setConfirmed(false); setAcknowledgePending(false); requestId.current = null;
      setMessage(data.warning || "Aanvraag bewaard bij dit evenement. Predis maakt de content. Gebruik ‘Resultaat ophalen’ om deze hier te bekijken.");
    });
  }
  function refresh(job) { return run(async () => { const data = await request("refresh", { jobId: job.id }); if (mounted.current) { setJobs(data.jobs); setMessage(data.warning || "Resultaat bewaard bij dit evenement. Er is niets gepubliceerd."); } }); }
  const pending = jobs.some(j => ["submitting", "generating", "unknown"].includes(j.status));
  if (!enabled && !loaded) return null;
  return <section className={styles.root} aria-label="Content maken met Predis">
    <div className={styles.notice}><strong>Content maken met Predis · {businessName}</strong><p>Gebruik de evenementtekst en foto’s als basis. Predis maakt een apart concept; je evenement, website en geplaatste berichten veranderen niet.</p></div>
    {busy && <p role="status">Predis-aanvragen verwerken…</p>}
    {error && <p role="alert" className={styles.error}>{error}</p>}
    {message && <p role="status" className={styles.notice}>{message}</p>}
    <button type="button" className="secondaryButton" disabled={busy} onClick={load}>Bewaarde aanvragen laden</button>
    {loaded && !config?.configured && <div className={styles.notice}><strong>Predis-koppeling nog niet klaar</strong><p>{!config?.hasBrand ? "Koppel het Predis-merk van deze vestiging onder Koppelingen. Voor genereren is daarnaast een API-sleutel op de server nodig." : "Het merk is gekoppeld, maar de Predis API-sleutel moet nog veilig op de server worden ingesteld."}</p><a href="/koppelingen">Naar Koppelingen</a><small>Deel de API-sleutel niet in de chat.</small></div>}
    <fieldset className={styles.fields} disabled={busy || !loaded}><legend>1. Wat wil je laten maken?</legend>
      <label>Opdracht voor Predis<textarea rows={7} maxLength={10000} value={prompt} onChange={e => edit(() => setPrompt(e.target.value))} /></label>
      <button type="button" className="secondaryButton" onClick={() => { if (window.confirm("Je opdracht vervangen door de actuele evenementgegevens?")) edit(() => setPrompt(predisPrompt(item))); }}>Evenementgegevens opnieuw overnemen</button>
      <label>Soort content<select value={format} onChange={e => edit(() => setFormat(e.target.value))}>{Object.entries(PREDIS_FORMATS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
      <strong>Evenementfoto’s meegeven ({selected.length}/10)</strong><small>Zonder selectie kiest Predis zelf beeld. Met selectie gebruiken we het Predis-model dat eigen foto’s ondersteunt. Controleer altijd tekst, uitsnede en eindresultaat.</small>
      <div className={styles.media}>{photos.map(a => <div key={a.url}><Image unoptimized src={a.url} width={240} height={150} alt={a.label} /><label className={styles.check}><input type="checkbox" checked={selected.includes(a.url)} disabled={!selected.includes(a.url) && selected.length >= 10} onChange={() => edit(() => setSelected(selected.includes(a.url) ? selected.filter(u => u !== a.url) : [...selected, a.url]))} />{a.label}</label></div>)}</div>
      {!photos.length && <p>Nog geen foto’s in dit evenement opgeslagen. Predis kan zelf beeld maken.</p>}
      <label className={styles.check}><input type="checkbox" checked={confirmed} onChange={e => setConfirmed(e.target.checked)} />Ik wil deze tekst en gekozen foto’s naar Predis sturen en hiervoor Predis-tegoed gebruiken.</label>
      {pending && <label className={styles.check}><input type="checkbox" checked={acknowledgePending} onChange={e => setAcknowledgePending(e.target.checked)} />Er is nog een open of onzekere aanvraag. Ik heb die gecontroleerd en wil bewust een extra concept laten maken; dit kan opnieuw tegoed kosten.</label>}
      <button type="button" className="secondaryButton" disabled={!config?.configured || !confirmed || (pending && !acknowledgePending) || needsCheck} onClick={generate}>Content laten maken</button>
      {needsCheck && <small>Laad eerst de bewaarde aanvragen om de vorige poging te controleren.</small>}
      {dirty && <small>Opdracht aangepast — nog niet aangevraagd.</small>}
    </fieldset>
    <h4>2. Aanvragen en resultaten bij dit evenement</h4>
    {!jobs.length && <p>Nog geen content aangevraagd vanuit dit scherm.</p>}
    {[...jobs].reverse().map(job => <article key={job.id} className={styles.fields}>
      <strong>{PREDIS_FORMATS[job.mediaType]} · {PREDIS_JOB_LABELS[job.status] || "Status onbekend"}</strong><small>{new Date(job.createdAt).toLocaleString("nl-NL", { timeZone: "Europe/Amsterdam" })} · Nederlandse tijd</small>
      <details><summary>Gebruikte opdracht bekijken</summary><p style={{ whiteSpace: "pre-wrap" }}>{job.prompt}</p></details>
      {job.status !== "ready" && <button type="button" className="secondaryButton" disabled={busy} onClick={() => refresh(job)}>Resultaat ophalen</button>}
      {(job.results || []).map(result => <div key={result.id}>
        <div className={styles.media}>{result.assets.map(asset => <div key={asset.url}>{asset.type === "video" ? <video src={asset.url} controls preload="none" /> : <Image unoptimized src={asset.url} alt="Predis-concept" width={320} height={240} />}<a href={asset.url} target="_blank" rel="noopener noreferrer">Bestand openen / downloaden</a></div>)}</div>
        <p style={{ whiteSpace: "pre-wrap" }}>{result.caption}</p>
        <button type="button" className="secondaryButton" disabled={busy} onClick={() => { if (window.confirm("Deze tekst en media gebruiken in je kanaalvoorbereiding? De huidige voorbereidingstekst en mediaselectie worden vervangen; publicatiemomenten blijven behouden. Er wordt niets gepubliceerd.")) onUse?.(result); }}>Deze content gebruiken</button>
      </div>)}
    </article>)}
    <small>Tekst en resultaatlinks blijven bij dit evenement bewaard. Mediabestanden staan bij Predis; download ze voor een eigen bestandskopie. ‘Klaar’ betekent alleen dat de content is gemaakt, niet ingepland of gepubliceerd.</small>
  </section>;
}
