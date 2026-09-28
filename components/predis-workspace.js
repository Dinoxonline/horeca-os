"use client";
import { useEffect, useState } from "react";
import PredisContent from "./predis-content";
import ManualPredis from "./manual-predis";
import styles from "./manual-predis.module.css";

export default function PredisWorkspace(props) {
  const [mode, setMode] = useState("choose"), [selection, setSelection] = useState(null), [dirty, setDirty] = useState(false);
  useEffect(() => { props.onUnsavedChange?.(dirty); return () => props.onUnsavedChange?.(false); }, [dirty, props.onUnsavedChange]);
  function switchMode(next) { if (next === mode) return; if (!dirty || window.confirm("Je hebt onbewaarde invoer of een lopende aanvraag. Toch wisselen? Bewaarde aanvragen blijven behouden.")) setMode(next); }
  return <div className={styles.root}>
    {mode === "choose" ? <section className={styles.root} aria-label="Predis-werkwijze kiezen">
      <div className={styles.notice}><strong>Wat wil je maken?</strong><p>Kies zelf je werkwijze. Een keuze opent alleen de voorbereiding: er wordt niets gegenereerd, ingepland of gepubliceerd.</p></div>
      <div className={styles.grid}>
        <button type="button" className={styles.choiceCard} onClick={() => switchMode("manual")}><strong>Eigen foto en tekst</strong><span>Gebruik je bestaande flyer of video en je eigen bijschrift.</span><small>Geen AI-generatie · handmatig overzetten naar Predis</small></button>
        {[['single_image', 'Afbeelding', 'Een nieuw AI-ontwerp met bijschrift.'], ['carousel', 'Carrousel', 'Meerdere afbeeldingen met bijschrift.'], ['video', 'Video', 'Een AI-video op basis van je opdracht.']].map(([value, label, help]) => <button type="button" key={value} className={styles.choiceCard} onClick={() => switchMode(value)}><strong>{label}</strong><span>{help}</span><small>Vanuit Horeca OS · credits pas na bevestiging</small></button>)}
      </div>
      <div className={styles.notice}><strong>Speciale vormen in Predis</strong><p>Deze opties zijn nog niet aangesloten op Horeca OS. De links openen het keuzescherm van Predis; kies daar de gewenste vorm. Er worden geen foto’s of tekst meegestuurd.</p></div>
      <div className={styles.grid}>{['Productadvertentievideo', 'UGC', 'Gezichtsloze video', 'Productfotoshoot'].map(label => <a key={label} className={styles.choiceCard} href="https://app.predis.ai/app/new_post/create" target="_blank" rel="noopener noreferrer"><strong>{label}</strong><small>Kiezen in Predis ↗</small></a>)}</div>
    </section> : <>
      <button type="button" className="secondaryButton" onClick={() => switchMode("choose")}>Andere werkwijze kiezen</button>
      {mode === "manual" ? <ManualPredis {...props} generatedContent={selection} onGeneratedContentApplied={() => setSelection(null)} onUnsavedChange={setDirty} /> : <PredisContent key={mode} {...props} initialFormat={mode} onUnsavedChange={setDirty} onUse={result => { setSelection(result); setMode("manual"); }} />}
    </>}
  </div>;
}
