"use client";
import { useEffect, useState } from "react";
import PredisContent from "./predis-content";
import ManualPredis from "./manual-predis";
import styles from "./manual-predis.module.css";

export function SavedPredisWorkspace(props) {
  const [open, setOpen] = useState(false);
  return <details onToggle={event => setOpen(event.currentTarget.open)}>
    <summary>Predis — eerst content maken, daarna inplannen</summary>
    <PredisWorkspace {...props} enabled={open} />
  </details>;
}

export default function PredisWorkspace(props) {
  const [mode, setMode] = useState("choose"), [dirty, setDirty] = useState(false);
  useEffect(() => { props.onUnsavedChange?.(dirty); return () => props.onUnsavedChange?.(false); }, [dirty, props.onUnsavedChange]);
  function switchMode(next) { if (next === mode) return; if (!dirty || window.confirm("Je hebt onbewaarde invoer of een lopende aanvraag. Toch wisselen? Bewaarde aanvragen blijven behouden.")) setMode(next); }
  return <div className={styles.root}>
    <div className={styles.notice}><strong>Eerst maken, daarna pas inplannen · {props.businessName}</strong><p>1. Kies je content → 2. Laat Predis maken en bekijk het resultaat → 3. Plan het bestaande ontwerp in Predis in. Maken plant of publiceert niets.</p></div>
    <div className={styles.actions}><a className="secondaryButton" href="https://app.predis.ai/app/content_library" target="_blank" rel="noopener noreferrer">Inhoudsbibliotheek openen ↗</a><a className="secondaryButton" href="https://app.predis.ai/app/content_calendar" target="_blank" rel="noopener noreferrer">Bestaande Predis-planning bekijken ↗</a></div>
    {mode === "choose" ? <section className={styles.root} aria-label="Predis-werkwijze kiezen">
      <div className={styles.notice}><strong>1. Wat wil je laten maken?</strong><p>Je tekst en gekozen bronfoto’s worden na jouw maakopdracht automatisch naar het Predis-merk van deze vestiging gestuurd. Je hoeft ze niet handmatig over te zetten. Een vorm kiezen kost nog geen tegoed.</p></div>
      <div className={styles.grid}>
        {[['single_image', 'Afbeelding', 'Een nieuw AI-ontwerp met bijschrift.'], ['carousel', 'Carrousel', 'Meerdere afbeeldingen met bijschrift.'], ['video', 'Video', 'Een AI-video op basis van je opdracht.']].map(([value, label, help]) => <button type="button" key={value} className={styles.choiceCard} onClick={() => switchMode(value)}><strong>{label}</strong><span>{help}</span><small>Vanuit Horeca OS · credits pas na bevestiging</small></button>)}
      </div>
      <details className={styles.moreOptions}><summary>Bestaande handmatige voorbereiding en bevestigingen</summary><p>Voor eerder bewaarde publicatiemomenten of een bestaand bestand dat je zonder AI wilt gebruiken. Deze route is handmatig en maakt geen nieuw ontwerp.</p><button type="button" className="secondaryButton" onClick={() => switchMode("manual")}>Eigen foto en tekst / eerdere planning</button></details>
      <div className={styles.notice}><strong>Speciale vormen in Predis</strong><p>Deze opties zijn nog niet aangesloten op Horeca OS. De links openen het keuzescherm van Predis; kies daar de gewenste vorm. Er worden geen foto’s of tekst meegestuurd.</p></div>
      <div className={styles.grid}>{['Productadvertentievideo', 'UGC', 'Gezichtsloze video', 'Productfotoshoot'].map(label => <a key={label} className={styles.choiceCard} href="https://app.predis.ai/app/new_post/create" target="_blank" rel="noopener noreferrer"><strong>{label}</strong><small>Kiezen in Predis ↗</small></a>)}</div>
    </section> : <>
      <button type="button" className="secondaryButton" onClick={() => switchMode("choose")}>Andere werkwijze kiezen</button>
      {mode === "manual" ? <ManualPredis {...props} onUnsavedChange={setDirty} /> : <PredisContent key={mode} {...props} initialFormat={mode} onUnsavedChange={setDirty} />}
    </>}
  </div>;
}
