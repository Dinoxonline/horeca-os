"use client";
import styles from './event-dossier.module.css';

export default function EventinSaveConfirmation({ title, status, warning, busy, error, onContinue, onEdit }) {
  return <section className={styles.completion} aria-label="Eventin-stap afgerond">
    <p className="eyebrow">WEBSITE (EVENTIN) · OPGESLAGEN</p>
    <h3>{title}</h3>
    <p role="status">{status === 'publish' ? 'Het evenement is opgeslagen op de website.' : 'Het evenement is als concept opgeslagen in Eventin.'} Deze stap is afgerond.</p>
    {warning && <p>{warning}</p>}
    <p>De volgende stap is Facebook. Er wordt daar nog niets automatisch geplaatst.</p>
    <div className={styles.completionActions}>
      <button type="button" className="secondaryButton" disabled={busy} onClick={onEdit}>Websitegegevens opnieuw bewerken</button>
      <button type="button" disabled={busy} onClick={onContinue}>Verder naar Facebook</button>
    </div>
    {error && <p role="alert">{error}</p>}
  </section>;
}
