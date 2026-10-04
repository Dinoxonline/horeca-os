"use client";
import { useState } from "react";
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
  return <div className={styles.root}>
    <div className={styles.notice}><strong>Bestaand ontwerp uploaden en inplannen · {props.businessName}</strong><p>Gebruik je kant-en-klare afbeelding, carrousel of video. Bij deze uploadroute verandert Horeca OS het bestand niet en wordt geen nieuw AI-ontwerp aangevraagd.</p></div>
    <div className={styles.actions}><a className="secondaryButton" href="https://app.predis.ai/app/new_post/create" target="_blank" rel="noopener noreferrer">Nieuw bericht maken ↗</a></div>
    <ManualPredis {...props} />
  </div>;
}
