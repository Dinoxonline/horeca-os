"use client";
import { useEffect, useState } from "react";
import PredisContent from "./predis-content";
import ManualPredis from "./manual-predis";
import styles from "./manual-predis.module.css";

export default function PredisWorkspace(props) {
  const [mode, setMode] = useState("content"), [selection, setSelection] = useState(null), [dirty, setDirty] = useState(false);
  useEffect(() => { props.onUnsavedChange?.(dirty); return () => props.onUnsavedChange?.(false); }, [dirty, props.onUnsavedChange]);
  function switchMode(next) { if (next === mode) return; if (!dirty || window.confirm("Je hebt onbewaarde invoer of een lopende aanvraag. Toch wisselen? Bewaarde aanvragen blijven behouden.")) setMode(next); }
  return <div className={styles.root}>
    <div className={styles.actions} role="group" aria-label="Predis-werkwijze"><button type="button" className="secondaryButton" aria-pressed={mode === "content"} onClick={() => switchMode("content")}>Content maken</button><button type="button" className="secondaryButton" aria-pressed={mode === "manual"} onClick={() => switchMode("manual")}>Handmatig plannen en controleren</button></div>
    {mode === "content" ? <PredisContent {...props} onUnsavedChange={setDirty} onUse={result => { setSelection(result); setMode("manual"); }} /> : <ManualPredis {...props} generatedContent={selection} onGeneratedContentApplied={() => setSelection(null)} onUnsavedChange={setDirty} />}
  </div>;
}
