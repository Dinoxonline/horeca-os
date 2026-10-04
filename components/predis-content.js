"use client";

import { useEffect, useRef, useState } from "react";
import Image from "next/image";
import { PREDIS_FORMATS, PREDIS_JOB_LABELS, predisPrompt, predisOwnMediaPrompt } from "../lib/predis-content";
import { nextPredisPoll, PREDIS_POLL_INTERVAL } from "../lib/predis-polling";
import styles from "./manual-predis.module.css";

export default function PredisContent({ item, workspaceId, session, enabled, businessName, onUse, onUnsavedChange, initialFormat = "single_image", historyOnly = false, sourceMode = "ai" }) {
  const ownMedia = sourceMode === "own";
  const defaultPrompt = () => ownMedia ? predisOwnMediaPrompt(item) : predisPrompt(item);
  const [prompt, setPrompt] = useState(defaultPrompt);
  const [format, setFormat] = useState(() => Object.hasOwn(PREDIS_FORMATS, initialFormat) ? initialFormat : "single_image"), [photos, setPhotos] = useState([]), [selected, setSelected] = useState([]);
  const [jobs, setJobs] = useState([]), [config, setConfig] = useState(null), [loaded, setLoaded] = useState(false);
  const [confirmed, setConfirmed] = useState(false), [acknowledgePending, setAcknowledgePending] = useState(false);
  const [needsCheck, setNeedsCheck] = useState(false);
  const [autoChecking, setAutoChecking] = useState(false), [autoFailures, setAutoFailures] = useState(0);
  const [reviewedResult, setReviewedResult] = useState(null);
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
  async function run(fn, background = false) {
    if (lock.current) return;
    lock.current = true;
    if (background) setAutoChecking(true); else { setBusy(true); setError(""); setMessage(""); }
    try { await fn(); } catch (e) { if (mounted.current) setError(e.name === "AbortError" ? "Geen bevestiging ontvangen. Laad eerst de bewaarde aanvragen; niet opnieuw genereren." : e.message); }
    finally { lock.current = false; if (mounted.current) { setBusy(false); setAutoChecking(false); } }
  }
  async function load() {
    return run(async () => {
      const data = await request(); if (!mounted.current) return;
      const available = data.assets || data.photos;
      setJobs(data.jobs); setConfig(data); setPhotos(available); setLoaded(true);
      setNeedsCheck(false);
      setAutoFailures(0);
      if (!loaded && !dirty) setSelected(available.filter(a => format === "video" || a.type !== "video").slice(0, 1).map(a => a.url));
      if (requestId.current && data.jobs.some(j => j.id === requestId.current)) { requestId.current = null; setDirty(false); }
    });
  }
  useEffect(() => { if (enabled && hasToken && !loaded && !lock.current) load(); }, [enabled, hasToken]);
  function edit(fn) { fn(); setDirty(true); setConfirmed(false); }
  function generate() {
    if (historyOnly || !confirmed || !loaded || !config?.configured || (ownMedia && !selected.length)) return;
    return run(async () => {
      requestId.current ||= crypto.randomUUID();
      let data;
      try { data = await request("generate", { requestId: requestId.current, prompt, mediaType: format, mediaUrls: selected, sourceMode, confirmed, acknowledgePending }); }
      catch (e) { if (mounted.current) setNeedsCheck(true); throw e; }
      if (!mounted.current) return;
      setJobs(data.jobs); setDirty(false); setConfirmed(false); setAcknowledgePending(false); requestId.current = null;
      setAutoFailures(0);
      setMessage(data.warning || "Aanvraag geaccepteerd. Predis maakt je content; het resultaat verschijnt hier automatisch zolang dit onderdeel openstaat. Er wordt niets ingepland of gepubliceerd.");
    });
  }
  function refresh(job, background = false) { return run(async () => {
    try {
      const data = await request("refresh", { jobId: job.id });
      if (!mounted.current) return;
      setJobs(data.jobs); setAutoFailures(0); setError("");
      const updated = data.jobs.find(j => j.id === job.id);
      if (!background || data.warning || updated?.status !== "generating") setMessage(data.warning || (updated?.status === "ready" ? "Content klaar bij Predis en resultaat bewaard in Horeca OS. Bekijk eerst het ontwerp; er is niets ingepland of gepubliceerd." : updated?.status === "generation_failed" ? "Predis meldt dat het maken is mislukt. Er is niets opnieuw aangevraagd." : "Nog geen bevestigd resultaat beschikbaar. Er is niets opnieuw aangevraagd."));
    } catch (e) { if (background && mounted.current) setAutoFailures(count => count + 1); throw e; }
  }, background); }
  useEffect(() => {
    if (!enabled || !hasToken || !loaded || busy || autoChecking || autoFailures >= 3) return;
    const job = nextPredisPoll(jobs);
    if (!job) return;
    const timer = setTimeout(() => {
      if (typeof document !== "undefined" && document.visibilityState === "hidden") { setJobs(current => [...current]); return; }
      void refresh(job, true);
    }, PREDIS_POLL_INTERVAL * (autoFailures + 1));
    return () => clearTimeout(timer);
  }, [enabled, hasToken, loaded, busy, autoChecking, jobs, autoFailures]);
  const pending = jobs.some(j => ["submitting", "generating", "unknown"].includes(j.status));
  if (!enabled && !loaded) return null;
  return <section className={styles.root} aria-label="Content maken met Predis">
    {historyOnly ? <div className={styles.notice}><strong>Eerdere AI-aanvragen · {businessName}</strong><p>Alleen eerder aangevraagde resultaten controleren. Dit zijn AI-ontwerpen, geen ongewijzigde uploads. Hier wordt geen nieuwe maakopdracht verstuurd.</p></div> : ownMedia ? <div className={styles.notice}><strong>Eigen beeld gebruiken — proef met Predis · {businessName}</strong><p>Je geselecteerde bestanden gaan via media_urls naar modelversie 2. De opdracht vraagt om beeld en tekst te behouden en niets over het beeld te zetten. Predis kan toch wijzigingen maken: dit is geen gegarandeerd ongewijzigde upload.</p><p>Er wordt één post aangevraagd. Eerst origineel en resultaat vergelijken, daarna zelf beslissen over inplannen. Er wordt niets automatisch gepubliceerd.</p></div> : <div className={styles.notice}><strong>Content maken met Predis · {businessName}</strong><p>Predis maakt een nieuw ontwerp op basis van je tekst en gekozen foto’s. De opdracht gaat automatisch naar het gekoppelde merk van deze vestiging. Eerst het ontwerp bekijken, daarna pas inplannen.</p></div>}
    {busy && <p role="status">Predis-aanvragen verwerken…</p>}
    {autoChecking && <p role="status">Resultaat automatisch controleren…</p>}
    {autoFailures >= 3 && <p className={styles.notice}>Automatisch controleren is gepauzeerd na drie mislukte controles. Gebruik ‘Resultaat ophalen’ om opnieuw te controleren; er wordt geen nieuwe maakopdracht verstuurd.</p>}
    {error && <p role="alert" className={styles.error}>{error}</p>}
    {message && <p role="status" className={styles.notice}>{message}</p>}
    <button type="button" className="secondaryButton" disabled={busy || autoChecking} onClick={load}>Bewaarde aanvragen laden</button>
    {loaded && !config?.configured && <div className={styles.notice}><strong>Predis-koppeling nog niet klaar</strong><p>{!config?.hasBrand ? "Koppel het Predis-merk van deze vestiging onder Koppelingen. Voor genereren is daarnaast een API-sleutel op de server nodig." : "Het merk is gekoppeld, maar de Predis API-sleutel moet nog veilig op de server worden ingesteld."}</p><a href="/koppelingen">Naar Koppelingen</a><small>Deel de API-sleutel niet in de chat.</small></div>}
    {!historyOnly && <fieldset className={styles.fields} disabled={busy || autoChecking || !loaded}><legend>1. Bronmateriaal en maakopdracht</legend>
      <label>Opdracht voor Predis<textarea rows={7} maxLength={10000} value={prompt} onChange={e => edit(() => setPrompt(e.target.value))} /></label>
      <button type="button" className="secondaryButton" onClick={() => { if (window.confirm("Je opdracht vervangen door de actuele evenementgegevens?")) edit(() => setPrompt(defaultPrompt())); }}>Evenementgegevens opnieuw overnemen</button>
      <label>Soort content<select value={format} onChange={e => edit(() => { const next = e.target.value; setFormat(next); setSelected(current => current.filter(url => photos.some(a => a.url === url && (next === "video" || a.type !== "video")))); })}>{Object.entries(PREDIS_FORMATS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
      <strong>Eigen bestanden meegeven ({selected.length}/10)</strong><small>{ownMedia ? "Kies minimaal één opgeslagen evenementbestand. De originele bestanden in Horeca OS blijven behouden. De nummers tonen de volgorde waarin je ze meestuurt." : "Deze bestanden worden meegestuurd als bronmateriaal voor een nieuw ontwerp, niet ongewijzigd geüpload. Zonder selectie kiest Predis zelf beeld. Controleer altijd tekst, uitsnede en eindresultaat."}</small>
      <div className={styles.media}>{photos.filter(a => format === "video" || a.type !== "video").map(a => <div key={a.url}>{a.type === "video" ? <video src={a.url} controls preload="none" /> : <Image unoptimized src={a.url} width={240} height={150} alt={a.label} />}<label className={styles.check}><input type="checkbox" checked={selected.includes(a.url)} disabled={!selected.includes(a.url) && selected.length >= 10} onChange={() => edit(() => setSelected(selected.includes(a.url) ? selected.filter(u => u !== a.url) : [...selected, a.url]))} />{selected.includes(a.url) ? `${selected.indexOf(a.url) + 1}. ` : ""}{a.label}</label><a href={a.url} target="_blank" rel="noopener noreferrer">Origineel bekijken</a></div>)}</div>
      {!photos.filter(a => format === "video" || a.type !== "video").length && <p>{ownMedia ? "Nog geen passend bestand opgeslagen. Voeg eerst je afbeelding of video toe aan het evenement, sla het op en kies daarna ‘Bewaarde aanvragen laden’. Er wordt zonder eigen bestand geen proef gestart." : "Nog geen passend bestand in dit evenement opgeslagen. Predis kan zelf beeld maken."}</p>}
      {ownMedia && <small>Deze proef gebruikt modelversie 2 en kan Predis-tegoed kosten. Controleer hierboven je beeld, bijschrift en vestiging voordat je bevestigt.</small>}
      <label className={styles.check}><input type="checkbox" checked={confirmed} onChange={e => setConfirmed(e.target.checked)} />Ik wil deze tekst en gekozen foto’s naar Predis sturen en hiervoor Predis-tegoed gebruiken.</label>
      {pending && <label className={styles.check}><input type="checkbox" checked={acknowledgePending} onChange={e => setAcknowledgePending(e.target.checked)} />Er is nog een open of onzekere aanvraag. Ik heb die gecontroleerd en wil bewust een extra concept laten maken; dit kan opnieuw tegoed kosten.</label>}
      <button type="button" className="secondaryButton" disabled={!config?.configured || !confirmed || (pending && !acknowledgePending) || needsCheck || (ownMedia && !selected.length)} onClick={generate}>{ownMedia ? "Proef met eigen beeld starten" : "Content laten maken"}</button>
      {needsCheck && <small>Laad eerst de bewaarde aanvragen om de vorige poging te controleren.</small>}
      {dirty && <small>Opdracht aangepast — nog niet aangevraagd.</small>}
    </fieldset>}
    <h4>{historyOnly ? "Bewaarde aanvragen en resultaten" : "2. Aanvragen en resultaten bij dit evenement"}</h4>
    {pending && <small>Geaccepteerde aanvragen worden maximaal 15 minuten automatisch gecontroleerd terwijl dit onderdeel openstaat. Daarna kun je zelf ‘Resultaat ophalen’ kiezen. Een onzekere aanvraag wordt nooit automatisch opnieuw gemaakt.</small>}
    {!jobs.length && <p>Nog geen content aangevraagd vanuit dit scherm.</p>}
    {[...jobs].reverse().map(job => <article key={job.id} className={styles.fields}>
      <strong>{PREDIS_FORMATS[job.mediaType]} · {PREDIS_JOB_LABELS[job.status] || "Status onbekend"}</strong><small>{new Date(job.createdAt).toLocaleString("nl-NL", { timeZone: "Europe/Amsterdam" })} · Nederlandse tijd</small>
      <details><summary>Gebruikte opdracht bekijken</summary><p style={{ whiteSpace: "pre-wrap" }}>{job.prompt}</p></details>
      {job.sourceMode === "own" && <section className={styles.fields} aria-label="Origineel vergelijken met Predis"><strong>Origineel — vergelijken met het Predis-resultaat hieronder</strong><div className={styles.media}>{(job.sourceAssets || []).map((asset, i) => <div key={asset.url}>{asset.type === "video" ? <video src={asset.url} controls preload="none" /> : <Image unoptimized src={asset.url} alt={`Origineel ${i + 1}`} width={320} height={240} />}<a href={asset.url} target="_blank" rel="noopener noreferrer">Origineel {i + 1} openen</a></div>)}</div><small>Controleer of tekst, opmaak en uitsnede zijn behouden. Een geslaagde generatie bewijst niet dat het resultaat ongewijzigd is.</small></section>}
      {job.status !== "ready" && <button type="button" className="secondaryButton" disabled={busy || autoChecking} onClick={() => refresh(job)}>Resultaat ophalen</button>}
      {(job.results || []).map(result => <div key={result.id} className={styles.fields}>
        <p className={styles.notice}><strong>Sla het resultaat direct op</strong>Volgens de Predis API-documentatie worden geleverde mediabestanden na één uur verwijderd. Horeca OS bewaart hier de tekst en links, nog geen eigen bestandskopie. Download het resultaat hieronder voordat de link verloopt.</p>
        <div className={styles.media}>{result.assets.map(asset => <div key={asset.url}>{asset.type === "video" ? <video src={asset.url} controls preload="none" /> : <Image unoptimized src={asset.url} alt="Predis-concept" width={320} height={240} />}<a href={asset.url} target="_blank" rel="noopener noreferrer">Bestand openen / downloaden</a></div>)}</div>
        <p style={{ whiteSpace: "pre-wrap" }}>{result.caption}</p>
        <p><small>Predis-contentnummer: {result.id} · merk: {businessName}</small></p>
        <a className="secondaryButton" href="https://app.predis.ai/app/content_library" target="_blank" rel="noopener noreferrer">Ontwerp in de inhoudsbibliotheek bekijken ↗</a>
        {job.status === "ready" && <button type="button" className="secondaryButton" disabled={busy || autoChecking} onClick={() => setReviewedResult(result.id)}>Ontwerp bekeken — verder naar inplannen</button>}
        {job.status === "ready" && reviewedResult === result.id && <section className={styles.step} aria-label="Gemaakte content inplannen"><strong>3. Het bestaande ontwerp inplannen</strong><p>Open de inhoudsbibliotheek, kies daar het merk {businessName} en open het gemaakte ontwerp. Kies vervolgens de kanalen, datum en tijd in Predis. Maak of upload het ontwerp niet opnieuw.</p><a className="secondaryButton" href="https://app.predis.ai/app/content_library" target="_blank" rel="noopener noreferrer">Bestaand ontwerp openen om in te plannen ↗</a><small>Deze knop opent de bibliotheek; hij plant nog niets in en selecteert niet automatisch een merk of ontwerp. Horeca OS bevestigt geen publicatie door alleen deze link te openen.</small></section>}
        {!historyOnly && onUse && <button type="button" className="secondaryButton" disabled={busy || autoChecking} onClick={() => { if (window.confirm("Dit resultaat kopiëren naar de handmatige voorbereiding?")) onUse(result); }}>Kopie gebruiken in handmatige voorbereiding</button>}
      </div>)}
    </article>)}
    <small>Tekst en resultaatlinks blijven bij dit evenement bewaard. Mediabestanden staan bij Predis; download ze voor een eigen bestandskopie. ‘Klaar’ betekent alleen dat de content is gemaakt, niet ingepland of gepubliceerd.</small>
  </section>;
}
