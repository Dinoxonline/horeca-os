"use client";
import { useState } from "react";
import { manualDistribution, manualSummary } from "../lib/manual-predis";
import styles from "./manual-predis.module.css";

export default function MarketingWorklist({ items, businesses, onOpen, getStatus }) {
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState("all");
  const [limit, setLimit] = useState(20);
  const rows = items.filter(item => {
    const d = manualDistribution(item) || {}, p = d.manual_predis, entries = p?.draft?.entries || [];
    if (!`${d.common?.title || ""} ${businesses.get(String(item.business_id))?.name || ""} ${d.common?.start || ""}`.toLowerCase().includes(search.toLowerCase())) return false;
    if (filter === "todo") return entries.some(e => !p.confirmations?.[e.key]);
    if (filter === "confirmed") return entries.some(e => p.confirmations?.[e.key]);
    if (filter === "unprepared") return !p;
    return true;
  });
  return <details className={styles.worklist}><summary>Evenementen zoeken en publicatiestatus bekijken ({items.length})</summary><p>Zoek ook buiten de zichtbare agendamaand. Open een evenement voor tekst, media en vervolgstappen.</p><div className={styles.actions}><label>Zoeken <input type="search" value={search} placeholder="Titel, vestiging of datum" onChange={e => { setSearch(e.target.value); setLimit(20); }} /></label><label>Predis-werkvoorraad <select value={filter} onChange={e => { setFilter(e.target.value); setLimit(20); }}><option value="all">Alle evenementen en campagnes</option><option value="todo">Nog overzetten naar Predis</option><option value="confirmed">Met handmatige bevestigingen</option><option value="unprepared">Nog geen Predis-voorbereiding</option></select></label></div><small>{rows.length} gevonden in de geladen marketingitems (maximaal 500 bewaarde items). Een kanaalcontrole is niet hetzelfde als een publicatiebevestiging.</small><div className={styles.results}>{rows.slice(0, limit).map(item => {
    const d = manualDistribution(item) || {};
    return <article className={styles.result} key={item.id}><div><strong>{d.common?.title || "Zonder titel"}</strong><p>{businesses.get(String(item.business_id))?.name} · {String(d.common?.start || item.scheduled_for || "Datum ontbreekt").slice(0, 10)}</p><div className={styles.badges}>{[["website", "Website"], ["facebook", "Facebook"], ["instagram", "Instagram"], ["google", "Google"]].map(([key, name]) => <span key={key}>{name}: {getStatus(item, key).label}</span>)}<span>Predis: {manualSummary(d.manual_predis)}</span></div></div><button type="button" className="secondaryButton" onClick={() => onOpen(item)}>Evenement openen</button></article>;
  })}</div>{!rows.length && <p>Geen passende items. Pas je zoektekst of filter aan.</p>}{rows.length > limit && <button type="button" className="secondaryButton" onClick={() => setLimit(limit + 20)}>Meer resultaten</button>}</details>;
}
