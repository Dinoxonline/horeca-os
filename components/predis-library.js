"use client";
import { useEffect, useRef, useState } from "react";
import Image from "next/image";
import { PREDIS_FORMATS } from "../lib/predis-content";
import styles from "./manual-predis.module.css";

export default function PredisLibrary({ item, workspaceId, session, enabled, onUnsavedChange, onLibrarySaved }) {
  const [linked, setLinked] = useState([]), [listing, setListing] = useState(null), [selection, setSelection] = useState(null);
  const [format, setFormat] = useState("single_image"), [busy, setBusy] = useState(false), [error, setError] = useState(""), [message, setMessage] = useState("");
  const [configured, setConfigured] = useState(null);
  const [diagnostics, setDiagnostics] = useState(null);
  const token = useRef(session?.access_token); token.current = session?.access_token;
  const active = useRef(null), sequence = useRef(0);
  const hasToken = Boolean(session?.access_token);
  useEffect(() => { onUnsavedChange?.(busy); return () => onUnsavedChange?.(false); }, [busy, onUnsavedChange]);
  async function request(extra = {}, write = false) {
    if (!enabled || !token.current || active.current) return;
    const c = new AbortController(), version = ++sequence.current;
    active.current = c; setBusy(true); setError(""); setMessage(""); setDiagnostics(null);
    if (extra.list === "1") { setListing(null); setSelection(null); }
    const timer = setTimeout(() => c.abort(), 25000);
    const scope = { workspaceId, businessId: item.business_id, itemId: item.id };
    try {
      const response = await fetch(`/api/marketing/predis-library${write ? "" : "?" + new URLSearchParams({ ...scope, ...extra })}`, {
        method: write ? "POST" : "GET", cache: "no-store", signal: c.signal,
        headers: { Authorization: `Bearer ${token.current}`, "Content-Type": "application/json" },
        ...(write ? { body: JSON.stringify({ ...scope, ...extra }) } : {}),
      });
      const data = await response.json();
      if (version !== sequence.current) return;
      if (data.diagnostics) setDiagnostics(data.diagnostics);
      if (!response.ok) throw new Error(data.error || "Predis-posts zijn niet bereikbaar.");
      setLinked(data.linked || []);
      if (typeof data.configured === "boolean") setConfigured(data.configured);
      if (data.posts) { setListing(data); setSelection(null); }
      if (write) {
        setSelection(null); onLibrarySaved?.({ posts: data.linked });
        setMessage(data.alreadyLinked ? "Deze post was al gekoppeld; er is geen extra kopie gemaakt." : "Post gekoppeld aan dit evenement. Niets gewijzigd in Predis en niets ingepland of gepubliceerd.");
      }
    } catch (e) {
      if (version === sequence.current) setError(e.name === "AbortError" ? "Geen bevestiging ontvangen. Controleer eerst de bewaarde koppelingen." : e.message);
    } finally {
      clearTimeout(timer);
      if (version === sequence.current) { active.current = null; setBusy(false); }
    }
  }
  useEffect(() => {
    setLinked([]); setListing(null); setSelection(null); setConfigured(null); setError(""); setMessage(""); setBusy(false); setDiagnostics(null);
    if (enabled && hasToken) void request();
    return () => { sequence.current++; active.current?.abort(); active.current = null; };
  }, [enabled, hasToken, workspaceId, item.business_id, item.id]);
  function fetchPage(page = 1) { setSelection(null); void request({ list: "1", mediaType: format, page: String(page) }); }
  function preview(post) {
    return <><div className={styles.media}>{post.assets.map((asset, i) => <div key={`${asset.url}:${i}`}>
      {asset.type === "video" ? <video src={asset.url} controls preload="none" /> : <Image src={asset.url} alt={`Predis-afbeelding ${i + 1}`} width={300} height={140} unoptimized loading="lazy" referrerPolicy="no-referrer" />}
    </div>)}</div><p style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>{post.caption || "Geen bijschrift"}</p><small>Postnummer: {post.id} · {PREDIS_FORMATS[post.mediaType]}</small></>;
  }
  const disabled = busy || !enabled || !hasToken;
  return <section className={styles.root} aria-label="Bestaande Predis-post koppelen">
    <div className={styles.notice}><strong>Via de API gemaakte posts ophalen en koppelen</strong><p>Deze ophaalroute geeft alleen posts terug die via de API zijn gemaakt: geen nieuwe AI-aanvraag en geen publicatie.</p><p>Handmatige uploads en posts uit de Predis-webapp worden met het huidige filter niet teruggegeven. Gebruik voor eigen ontwerpen de handmatige voorbereiding en bevestig daar zelf de uitkomst. Laat een ontbrekende post niet opnieuw door AI maken.</p></div>
    {configured === false && <p className={styles.error}>De Predis-koppeling voor deze vestiging is niet compleet. Controleer Koppelingen.</p>}
    {!hasToken && <p>Log in om bestaande posts op te halen.</p>}
    <label>Inhoudstype<select value={format} disabled={disabled} onChange={e => { setFormat(e.target.value); setListing(null); setSelection(null); setDiagnostics(null); setError(""); }}>{Object.entries(PREDIS_FORMATS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
    <div className={styles.actions}><button type="button" className="primaryButton" disabled={disabled || configured !== true} onClick={() => fetchPage()}>Posts ophalen uit Predis</button><button type="button" className="secondaryButton" disabled={disabled} onClick={() => request()}>Bewaarde koppelingen controleren</button></div>
    <div className={styles.actions}><button type="button" className="secondaryButton" disabled={disabled || configured !== true} onClick={() => request({ list: "1", diagnose: "1", mediaType: format, page: String(listing?.page || 1) })}>Ophaaldiagnose uitvoeren</button><small>Controleert alleen het gekozen inhoudstype en de huidige pagina. Geen contentgeneratie of publicatie.</small></div>
    {busy && <p role="status">Bezig met ophalen of koppelen…</p>}{error && <p role="alert" className={styles.error}>{error}</p>}{message && <p role="status" className={styles.notice}>{message}</p>}
    {diagnostics && <section className={styles.notice} aria-label="Uitslag ophaaldiagnose">
      <strong>Uitslag ophaaldiagnose</strong><p role="status">{diagnostics.message}</p>
      <small>Controle: {diagnostics.checkedAt} · Merk-ID: {diagnostics.brandId}</small>
      <p>{PREDIS_FORMATS[diagnostics.mediaType]} · aangevraagde pagina {diagnostics.page} · maximaal {diagnostics.requestedItems} posts</p>
      <div className={styles.tableWrap}><table><caption>Antwoord van Predis</caption><tbody>
        <tr><th scope="row">Antwoordcode (HTTP)</th><td>{diagnostics.httpStatus ?? "Geen antwoord"}</td></tr>
        <tr><th scope="row">Leesbaar JSON-antwoord</th><td>{diagnostics.validJson ? "Ja" : "Nee"}</td></tr>
        <tr><th scope="row">Posts ontvangen</th><td>{diagnostics.received ?? "Onbekend — geen geldige posts-lijst"}</td></tr>
        <tr><th scope="row">Posts gecontroleerd</th><td>{diagnostics.inspected ?? "Niet gecontroleerd"}</td></tr>
        <tr><th scope="row">Bruikbaar volgens formaatcontrole</th><td>{diagnostics.usable}</td></tr>
        <tr><th scope="row">Overgeslagen</th><td>{diagnostics.skipped}</td></tr>
        <tr><th scope="row">Dubbele posts</th><td>{diagnostics.duplicates}</td></tr>
        <tr><th scope="row">Buiten paginalimiet van 20</th><td>{diagnostics.overflow}</td></tr>
        <tr><th scope="row">Aantal pagina’s gemeld door Predis</th><td>{diagnostics.reportedPages ?? "Ontbreekt of onverwacht formaat"}</td></tr>
      </tbody></table></div>
      {Object.entries(diagnostics.reasons).map(([reason, count]) => <p key={reason}>{count} × {reason}</p>)}
      {diagnostics.nestedPostsCount !== null && <p>Posts op een andere plaats in het antwoord (data.posts): {diagnostics.nestedPostsCount}. Deze worden niet automatisch overgenomen.</p>}
      {diagnostics.providerErrors.map((message, i) => <p key={i}>{message}</p>)}
      <small>Veilige samenvatting, geen ruwe fouttekst of API-sleutel. Je kunt hiervan een screenshot delen. Dit controleert niet je volledige Predis-bibliotheek.</small>
    </section>}
    {listing && !selection && <section className={styles.root} aria-label="Beschikbare Predis-posts">
      <p>Pagina {listing.page} van {listing.totalPages} · alleen posts die Predis via de API teruggeeft.</p>
      {!listing.posts.length && <p>Geen bruikbare posts op deze pagina. Dit betekent niet dat je inhoudsbibliotheek leeg is. Je kunt voorlopig verder in Predis zelf.</p>}
      {listing.skipped > 0 && <p>{listing.skipped} post(s) overgeslagen: geen volledig, ondersteund resultaat ontvangen.</p>}
      {listing.posts.map(post => <article className={styles.step} key={post.key}>{preview(post)}<button type="button" className="secondaryButton" disabled={disabled || linked.some(p => p.key === post.key)} onClick={() => setSelection(post)}>{linked.some(p => p.key === post.key) ? "Al gekoppeld" : "Deze post kiezen"}</button></article>)}
      <div className={styles.actions}><button type="button" disabled={disabled || listing.page <= 1} onClick={() => fetchPage(listing.page - 1)}>Vorige pagina</button><button type="button" disabled={disabled || listing.page >= listing.totalPages} onClick={() => fetchPage(listing.page + 1)}>Volgende pagina</button></div>
    </section>}
    {selection && <section className={styles.notice} aria-label="Gekozen post bevestigen"><strong>Deze post koppelen aan dit evenement?</strong>{preview(selection)}<p>Alleen een kopie van de tekst en verwijzingen naar de media worden in het evenement bewaard. De oorspronkelijke evenementtekst, handmatige planning en eerdere AI-aanvragen blijven behouden.</p><div className={styles.actions}><button type="button" className="primaryButton" disabled={disabled} onClick={() => request({ action: "link", confirmed: true, postId: selection.id, fingerprint: selection.fingerprint, page: listing.page, mediaType: listing.mediaType }, true)}>Post aan dit evenement koppelen</button><button type="button" disabled={disabled} onClick={() => setSelection(null)}>Annuleren</button></div></section>}
    <section className={styles.root} aria-label="Gekoppelde Predis-posts"><h4>Gekoppeld aan dit evenement ({linked.length})</h4>{linked.map(post => <details key={post.key} className={styles.step}><summary>{PREDIS_FORMATS[post.mediaType]} · {post.caption?.slice(0, 70) || post.id}</summary>{preview(post)}<small>Bewaarde momentopname, geen automatische synchronisatie. Media blijven bij Predis; een verlopen verwijzing kan een lege voorvertoning geven.</small></details>)}</section>
    <p>Daarna kun je de post in Predis zelf inplannen. Deze koppeling bevestigt niet dat hij is ingepland of gepubliceerd.</p>
  </section>;
}
