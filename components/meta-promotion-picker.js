"use client";

import { useEffect, useRef, useState } from "react";
import Image from "next/image";
import styles from "./meta-campaign-composer.module.css";

export const SOURCE_LABELS = { new: "Nieuwe advertentie", facebook_events: "Facebook-evenementen", facebook_posts: "Facebookberichten", instagram_posts: "Instagramberichten / Reels" };

export default function MetaPromotionPicker({ draft, onChange, onCatalog, busy }) {
  const [rows, setRows] = useState([]), [after, setAfter] = useState(null), [loading, setLoading] = useState(false), [error, setError] = useState("");
  const [query, setQuery] = useState("");
  const generation = useRef(0);
  const listener = useRef(onCatalog); listener.current = onCatalog;
  async function fetchRows(cursor = "", version = generation.current) {
    setLoading(true); setError("");
    try {
      const result = await listener.current(draft.sourceKind, cursor);
      if (version !== generation.current) return;
      setRows(current => cursor ? [...current, ...(result.options || []).filter(row => !current.some(old => old.id === row.id))] : result.options || []);
      setAfter(result.after || null);
    } catch (failure) { if (version === generation.current) setError(failure.message || "Meta-bronnen konden niet worden opgehaald."); }
    finally { if (version === generation.current) setLoading(false); }
  }
  useEffect(() => {
    const version = ++generation.current;
    setRows([]); setAfter(null); setQuery(""); setError(""); setLoading(false);
    if (draft.sourceKind !== "new") fetchRows("", version);
    return () => { generation.current++; };
  }, [draft.sourceKind]);
  function choose(row) {
    const event = draft.sourceKind === "facebook_events";
    onChange({ sourceId: row.id, sourcePreview: row, objective: event ? "traffic" : "engagement",
      primaryText: row.text.slice(0, 2200), headline: row.name.slice(0, 100), imageUrl: row.image, destinationUrl: row.url,
      placements: event ? "both" : draft.sourceKind === "facebook_posts" ? "facebook" : "instagram", placementFormat: "automatic", callToAction: "learn_more" });
  }
  return <section className={styles.picker} aria-label="Advertentiebron kiezen">
    <h4>Wat wil je promoten?</h4>
    <div className={styles.sourceTabs}>{Object.entries(SOURCE_LABELS).map(([kind, label]) => <button type="button" key={kind} disabled={busy || draft.sourceKind === kind} aria-pressed={draft.sourceKind === kind} onClick={() => onChange({ sourceKind: kind, sourceId: "", sourcePreview: null, objective: kind === "new" || kind === "facebook_events" ? "traffic" : "engagement", placements: kind === "facebook_posts" ? "facebook" : kind === "instagram_posts" ? "instagram" : "both", placementFormat: kind === "new" ? "feed" : "automatic" })}>{label}</button>)}</div>
    {draft.sourceKind !== "new" && <>
      <p className={styles.help}>Alleen bronnen van de gekoppelde pagina of het gekoppelde Instagram-profiel. Gebruik ‘Meer laden’ voor oudere inhoud. Meta bepaalt welke inhoud geschikt is voor promotie.</p>
      <p className={styles.safeNotice}>Controleer eerst in Meta of voor deze bron al een advertentie loopt. Een buiten Horeca OS gemaakte campagne wordt hier niet automatisch herkend.</p>
      {draft.sourceKind === "facebook_events" ? <p className={styles.safeNotice}>Hier maak je een advertentie naar de bestaande evenementpagina. Voor ‘Geïnteresseerd/Gaat’-reacties gebruik je de evenementpromotie in Meta.</p> : <p className={styles.help}>Het bestaande bericht wordt gebruikt, inclusief de oorspronkelijke inhoud. Geen nieuw openbaar bericht. Reels met muziek of andere beperkingen kunnen door Meta worden geweigerd.</p>}
      <label className={styles.field}>Zoek in geladen bronnen<input value={query} onChange={event => setQuery(event.target.value)} placeholder="Titel of tekst" /></label>
      <div className={styles.catalog}>{rows.filter(row => `${row.name} ${row.text}`.toLocaleLowerCase().includes(query.toLocaleLowerCase())).map(row => <article key={row.id} className={draft.sourceId === row.id ? styles.selectedSource : ""}>
        {row.image && <Image src={row.image} alt="" width={72} height={72} unoptimized />}
        <div><strong>{row.name}</strong><small>{row.date ? new Date(row.date).toLocaleString("nl-NL") : "Datum onbekend"} · {row.mediaType}</small>{row.url && <a href={row.url} target="_blank" rel="noreferrer">Origineel bekijken ↗</a>}</div>
        <button type="button" disabled={busy} aria-pressed={draft.sourceId === row.id} onClick={() => choose(row)}>{draft.sourceId === row.id ? "Gekozen" : "Kiezen"}</button>
      </article>)}</div>
      {loading && <p role="status">Bronnen ophalen bij Meta…</p>}
      {!loading && !error && !rows.length && <p>Meta geeft voor deze vestiging geen bronnen terug. Dat kan ook aan de verleende toegang liggen.</p>}
      {error && <p role="alert" className={styles.error}>{error} Controleer de paginatoegang bij Koppelingen; kies geen andere vestiging als omweg.</p>}
      <div className={styles.sourceTabs}><button type="button" disabled={busy || loading} onClick={() => fetchRows()}>Opnieuw ophalen</button>{after && <button type="button" disabled={busy || loading} onClick={() => fetchRows(after)}>Meer laden</button>}</div>
      {draft.sourcePreview && <p role="status">Gekozen: <strong>{draft.sourcePreview.name}</strong></p>}
    </>}
  </section>;
}
