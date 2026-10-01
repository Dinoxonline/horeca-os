"use client";

import { useEffect, useId, useRef, useState } from "react";
import styles from "./meta-campaign-composer.module.css";

const COUNTRY_NAMES = { NL: "Nederland", BE: "België", DE: "Duitsland", FR: "Frankrijk", ES: "Spanje", GB: "Verenigd Koninkrijk" };

export function audienceLocationSummary(targeting) {
  if (!targeting?.geo_locations) return "Locatie niet door Meta teruggegeven — controleer de doelgroep in Meta.";
  const geo = targeting.geo_locations || {};
  const places = [...(geo.countries || []).map(country => COUNTRY_NAMES[country] || country), ...(geo.cities || []).map(city => `${city.name || city.key} + ${city.radius || "?"} ${city.distance_unit || "km"}`), ...(geo.regions || []).map(region => region.name || region.key), ...(geo.zips || []).map(zip => zip.name || zip.key), ...(geo.custom_locations || []).map(location => location.name || location.address || location.key)];
  return places.filter(Boolean).join(", ") || "Locatie niet door Meta teruggegeven — controleer de doelgroep in Meta.";
}

export function audienceSummary(targeting) {
  if (!targeting) return "Doelgroepdetails niet beschikbaar.";
  return `${targeting.age_min || 18}–${targeting.age_max || "65+"} jaar · ${targeting.genders?.length === 1 ? targeting.genders[0] === 1 ? "mannen" : "vrouwen" : "iedereen"}. ${targeting.targeting_automation?.advantage_audience === 1 ? "Advantage+ aan." : ""}`;
}

export default function MetaAudiencePicker({ draft, onChange, onCatalog, busy }) {
  const groupId = useId();
  const [rows, setRows] = useState([]), [after, setAfter] = useState(null), [loading, setLoading] = useState(false), [error, setError] = useState("");
  const resource = draft.audienceMode === "saved" ? "saved_audiences" : "custom_audiences";
  const generation = useRef(0), listener = useRef(onCatalog); listener.current = onCatalog;
  async function fetchRows(cursor = "", version = generation.current) {
    setLoading(true); setError("");
    try {
      const result = await listener.current(resource, cursor);
      if (version !== generation.current) return;
      setRows(current => cursor ? [...current, ...(result.options || []).filter(row => !current.some(old => old.id === row.id))] : result.options || []); setAfter(result.after || null);
    } catch (failure) { if (version === generation.current) setError(failure.message || "Doelgroepen niet beschikbaar."); }
    finally { if (version === generation.current) setLoading(false); }
  }
  useEffect(() => { ++generation.current; setRows([]); setAfter(null); setError(""); setLoading(false); return () => { generation.current++; }; }, [resource]);
  return <section className={styles.picker} aria-label="Meta-doelgroep kiezen">
    <fieldset className={styles.objectives}><legend>Doelgroep kiezen</legend>{[["manual", "Zelf samenstellen", "Locatie, leeftijd, geslacht en interesses zelf instellen."], ["advantage", "Advantage+-doelgroep", "Meta mag je doelgroepsuggesties uitbreiden. Controleer de definitieve grenzen in Meta."], ["saved", "Opgeslagen doelgroep uit Meta", "Hergebruik de bestaande instellingen van dit advertentieaccount."]].map(([mode, label, detail]) => <label key={mode} className={draft.audienceMode === mode ? styles.selectedObjective : ""}><input type="radio" name={groupId} checked={draft.audienceMode === mode} disabled={busy} onChange={() => onChange({ audienceMode: mode })} /><span><strong>{label}</strong><small>{detail}</small></span></label>)}</fieldset>
    <h4>{resource === "saved_audiences" ? "Opgeslagen doelgroepen" : "Aangepaste / vergelijkbare doelgroepen (optioneel)"}</h4>
    <p className={styles.help}>Deze lijst hoort bij het advertentieaccount. Caribbean Corner en Het Plein delen dat account; controleer daarom goed welke doelgroep je kiest. Er worden geen klantlijsten geüpload.</p>
    <div className={styles.sourceTabs}><button type="button" disabled={busy || loading} onClick={() => fetchRows()}>{loading ? "Ophalen…" : "Doelgroepen ophalen"}</button>{after && <button type="button" disabled={busy || loading} onClick={() => fetchRows(after)}>Meer doelgroepen laden</button>}</div>
    {error && <p role="alert" className={styles.error}>{error}</p>}
    {rows.length > 0 && (resource === "saved_audiences" ? <label className={styles.field}>Opgeslagen Meta-doelgroep<select value={draft.savedAudienceId} disabled={busy} onChange={event => { const row = rows.find(row => row.id === event.target.value); onChange({ savedAudienceId: row?.id || "", savedAudienceName: row?.name || "", savedAudiencePreview: row?.targeting || null }); }}><option value="">Kies een doelgroep</option>{rows.map(row => <option key={row.id} value={row.id}>{row.name}</option>)}</select></label> : <div className={styles.catalog}>{rows.map(row => <label key={row.id}><input type="checkbox" disabled={busy || (!draft.customAudienceIds.includes(row.id) && draft.customAudienceIds.length >= 10)} checked={draft.customAudienceIds.includes(row.id)} onChange={event => onChange({ customAudienceIds: event.target.checked ? [...draft.customAudienceIds, row.id] : draft.customAudienceIds.filter(id => id !== row.id) })} />{row.name} · {row.subtype}</label>)}</div>)}
    {!loading && !error && rows.length === 0 && <p className={styles.help}>Haal de lijst op. Als Meta niets teruggeeft, kun je zelf een doelgroep samenstellen of je toegang in Meta controleren.</p>}
    {draft.audienceMode === "saved" && draft.savedAudienceId && <div className={styles.budget}><strong>{draft.savedAudienceName}</strong><p><strong>Locatie: </strong>{audienceLocationSummary(draft.savedAudiencePreview)}</p><p>{audienceSummary(draft.savedAudiencePreview)}</p><p>Ook overige voorwaarden en uitsluitingen blijven behouden. We controleren de doelgroep opnieuw vóór aanmaken; plaatsingen kies je hieronder afzonderlijk.</p></div>}
    {draft.audienceMode !== "saved" && draft.customAudienceIds.length > 0 && <p>{draft.customAudienceIds.length} aangepaste doelgroep(en) gekozen. <button type="button" disabled={busy} onClick={() => onChange({ customAudienceIds: [] })}>Selectie wissen</button></p>}
  </section>;
}
