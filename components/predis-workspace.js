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
  const [mode, setMode] = useState("choose"), [dirty, setDirty] = useState(false);
  useEffect(() => { props.onUnsavedChange?.(dirty); return () => props.onUnsavedChange?.(false); }, [dirty, props.onUnsavedChange]);
  function switchMode(next) { if (next === mode) return; if (!dirty || window.confirm("Je hebt onbewaarde invoer of een lopende aanvraag. Toch wisselen? Bewaarde aanvragen blijven behouden.")) setMode(next); }
  return <div className={styles.root}>
    <div className={styles.notice}><strong>{mode.startsWith("ai_") ? "Nieuw ontwerp met AI maken" : "Bestaand ontwerp uploaden en inplannen"} · {props.businessName}</strong><p>{mode.startsWith("ai_") ? "Je hebt bewust de aparte AI-route gekozen. Predis kan je beeld en opmaak veranderen; dit is geen ongewijzigde upload." : "Gebruik je kant-en-klare afbeelding, carrousel of video. Bij de uploadroute verandert Horeca OS het bestand niet en wordt geen nieuw AI-ontwerp aangevraagd."}</p></div>
    <div className={styles.actions}><a className="secondaryButton" href="https://app.predis.ai/app/content_library" target="_blank" rel="noopener noreferrer">Inhoudsbibliotheek openen ↗</a><a className="secondaryButton" href="https://app.predis.ai/app/content_calendar" target="_blank" rel="noopener noreferrer">Bestaande Predis-planning bekijken ↗</a></div>
    {mode === "choose" ? <section className={styles.root} aria-label="Predis-werkwijze kiezen">
      <div className={styles.notice}><strong>1. Wat wil je ongewijzigd uploaden?</strong><p>Dit hoort bij ‘Heb je al een ontwerp? Uploaden en inplannen’ in Predis. Automatisch uploaden is nog niet aangesloten: hieronder bereid je de originele bestanden voor en zet je ze zelf in de Predis-inhoudsbibliotheek.</p></div>
      <div className={styles.grid}>
        {[['single_image', 'Enkele afbeelding', 'Je bestaande ontwerp behouden.'], ['carousel', 'Carrousel', 'Je bestaande afbeeldingen in de gekozen volgorde.'], ['video', 'Video’s', 'Je bestaande videobestand behouden.']].map(([value, label, help]) => <button type="button" key={value} className={styles.choiceCard} onClick={() => switchMode(value)}><strong>{label}</strong><span>{help}</span><small>Upload voorbereiden · geen AI-bewerking</small></button>)}
      </div>
      <details className={styles.moreOptions}><summary>Bestaande handmatige voorbereiding en bevestigingen</summary><p>Voor eerder bewaarde publicatiemomenten of een bestaand bestand dat je zonder AI wilt gebruiken. Deze route is handmatig en maakt geen nieuw ontwerp.</p><button type="button" className="secondaryButton" onClick={() => switchMode("manual")}>Eigen foto en tekst / eerdere planning</button></details>
      <details className={styles.moreOptions}><summary>Nieuw ontwerp met AI maken (optioneel)</summary><p>Alleen gebruiken als je bewust een ander ontwerp wilt. Predis gebruikt je bestanden als bronmateriaal en kan tekst, beeld en opmaak veranderen. Dit is geen ongewijzigde upload en kan Predis-tegoed kosten.</p><div className={styles.grid}>{[['single_image', 'AI-afbeelding'], ['carousel', 'AI-carrousel'], ['video', 'AI-video']].map(([value, label]) => <button type="button" key={value} className={styles.choiceCard} onClick={() => switchMode(`ai_${value}`)}><strong>{label}</strong><small>Nieuw ontwerp laten maken · bestaand beeld kan veranderen</small></button>)}</div></details>
      <details className={styles.moreOptions}><summary>Eerdere AI-aanvragen controleren</summary><p>Deze eerdere opdrachten kunnen je beeld hebben aangepast. Ze worden niet verwijderd of opnieuw verstuurd. Controleer ze los van het uploaden van je oorspronkelijke ontwerp.</p><button type="button" className="secondaryButton" onClick={() => switchMode("history")}>Eerdere AI-resultaten bekijken</button></details>
    </section> : <>
      <button type="button" className="secondaryButton" onClick={() => switchMode("choose")}>Andere werkwijze kiezen</button>
      {mode === "history" || mode.startsWith("ai_") ? <PredisContent key={mode} {...props} historyOnly={mode === "history"} initialFormat={mode.startsWith("ai_") ? mode.slice(3) : "single_image"} onUnsavedChange={setDirty} /> : <ManualPredis key={mode} {...props} uploadType={mode === "manual" ? undefined : mode} onUnsavedChange={setDirty} />}
    </>}
  </div>;
}
