"use client";
import { useEffect, useState } from "react";
import PredisContent from "./predis-content";
import ManualPredis from "./manual-predis";
import styles from "./manual-predis.module.css";

export function SavedPredisWorkspace(props) {
  const [open, setOpen] = useState(false);
  return <details onToggle={event => setOpen(event.currentTarget.open)}>
    <summary>Predis — bestaand ontwerp uploaden en inplannen</summary>
    <PredisWorkspace {...props} enabled={open} />
  </details>;
}

export default function PredisWorkspace(props) {
  const [mode, setMode] = useState("manual"), [dirty, setDirty] = useState(false);
  const generating = mode.startsWith("ai_");
  useEffect(() => { props.onUnsavedChange?.(dirty); return () => props.onUnsavedChange?.(false); }, [dirty, props.onUnsavedChange]);
  function switchMode(next) { if (next === mode) return; if (!dirty || window.confirm("Je hebt onbewaarde invoer of een lopende aanvraag. Toch wisselen? Bewaarde aanvragen blijven behouden.")) setMode(next); }
  return <div className={styles.root}>
    <div className={styles.notice}><strong>{generating ? "Nieuw ontwerp met AI maken" : "Bestaand ontwerp uploaden en inplannen"} · {props.businessName}</strong><p>{generating ? "Predis versie 4 maakt een nieuw ontwerp op basis van je evenementgegevens. Het gebruikt geen bestaande flyer als bron." : "Gebruik je kant-en-klare afbeelding, carrousel of video. Bij de uploadroute verandert Horeca OS het bestand niet en wordt geen nieuw AI-ontwerp aangevraagd."}</p></div>
    <div className={styles.actions}><a className="secondaryButton" href="https://app.predis.ai/app/new_post/create" target="_blank" rel="noopener noreferrer">Nieuw bericht maken ↗</a></div>
    {generating && <button type="button" className="secondaryButton" onClick={() => switchMode("manual")}>Terug naar eigen ontwerp</button>}
    {mode === "choose" ? <section className={styles.root} aria-label="Predis-werkwijze kiezen">
      <div className={styles.notice}><strong>1. Wat wil je ongewijzigd uploaden?</strong><p>Predis ondersteunt ongewijzigd uploaden niet via de API. Bereid hier je bestanden en exacte tekst voor en upload ze zelf via ‘Heb je al een ontwerp? Uploaden en inplannen’ in Predis. Hiervoor vragen we geen AI-generatie aan.</p></div>
      <div className={styles.grid}>
        {[['single_image', 'Enkele afbeelding', 'Je bestaande ontwerp behouden.'], ['carousel', 'Carrousel', 'Je bestaande afbeeldingen in de gekozen volgorde.'], ['video', 'Video’s', 'Je bestaande videobestand behouden.']].map(([value, label, help]) => <button type="button" key={value} className={styles.choiceCard} onClick={() => switchMode(value)}><strong>{label}</strong><span>{help}</span><small>Upload voorbereiden · geen AI-bewerking</small></button>)}
      </div>
      <details className={styles.moreOptions}><summary>Bestaande handmatige voorbereiding en bevestigingen</summary><p>Voor eerder bewaarde publicatiemomenten of een bestaand bestand dat je zonder AI wilt gebruiken. Deze route is handmatig en maakt geen nieuw ontwerp.</p><button type="button" className="secondaryButton" onClick={() => switchMode("manual")}>Eigen foto en tekst / eerdere planning</button></details>
      <details className={styles.moreOptions}><summary>Nieuw ontwerp met AI maken (optioneel)</summary><p>Alleen gebruiken als je bewust een nieuw ontwerp wilt. Predis versie 4 maakt een afbeelding of carrousel op basis van de evenementgegevens en kan Predis-tegoed kosten.</p><div className={styles.grid}>{[['single_image', 'AI-afbeelding'], ['carousel', 'AI-carrousel']].map(([value, label]) => <button type="button" key={value} className={styles.choiceCard} onClick={() => switchMode(`ai_${value}`)}><strong>{label}</strong><small>Nieuw ontwerp laten maken</small></button>)}</div></details>
      <details className={styles.moreOptions}><summary>Eerdere AI-aanvragen controleren</summary><p>Deze eerdere opdrachten kunnen je beeld hebben aangepast. Ze worden niet verwijderd of opnieuw verstuurd. Controleer ze los van het uploaden van je oorspronkelijke ontwerp.</p><button type="button" className="secondaryButton" onClick={() => switchMode("history")}>Eerdere AI-resultaten bekijken</button></details>
    </section> : <>
      {mode === "manual" && <details className={styles.moreOptions}>
        <summary>Nieuw AI-ontwerp met Predis maken</summary>
        <p>Alleen voor een nieuw ontwerp. Je bestaande flyer blijft ongewijzigd in de handmatige route hierboven.</p>
        <div className={styles.actions}>
          <button type="button" className="secondaryButton" onClick={() => switchMode("ai_single_image")}>AI-afbeelding maken</button>
          <button type="button" className="secondaryButton" onClick={() => switchMode("ai_carousel")}>AI-carrousel maken</button>
        </div>
      </details>}
      {mode === "history" || generating ? <PredisContent key={mode} {...props} historyOnly={mode === "history"} initialFormat={mode.startsWith("ai_") ? mode.slice(3) : "single_image"} onUnsavedChange={setDirty} /> : <ManualPredis key={mode} {...props} uploadType={mode === "manual" ? undefined : mode} onUnsavedChange={setDirty} />}
    </>}
  </div>;
}
