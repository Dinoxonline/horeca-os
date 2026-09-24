"use client";

import { useEffect, useState } from "react";
import { contentDeliveryStatus, contentSnapshot, eventContent, facebookEventId } from "../lib/manual-event-content";

export default function ManualFacebookUpdate({ distribution, dirty, busy, onConfirm }) {
  const [checked, setChecked] = useState(false);
  const [message, setMessage] = useState("");
  const content = eventContent(distribution);
  const id = facebookEventId(distribution);
  const state = contentDeliveryStatus(distribution, "facebook");
  const website = contentDeliveryStatus(distribution, "website");
  useEffect(() => { setChecked(false); setMessage(""); }, [content.title, content.description, id, dirty]);
  async function copy(text) {
    try { await navigator.clipboard.writeText(text); setMessage("Gekopieerd."); }
    catch { setMessage("Kopiëren is geblokkeerd. Selecteer en kopieer de tekst hieronder handmatig."); }
  }
  return <section className="manualFacebookUpdate" aria-label="Facebook handmatig bijwerken">
    <h4>Facebook handmatig bijwerken</h4>
    <strong>{dirty ? "Sla eerst de gekozen tekst op" : state.label}</strong>
    {state.at && <small>Door een gebruiker bevestigd op {new Date(state.at).toLocaleString("nl-NL")}. Niet automatisch door Facebook gecontroleerd.</small>}
    <small>Website: {website.label}. Een website-update bevestigt geen wijziging op Facebook.</small>
    <p>Sla de gewenste tekst op, plak deze in het bestaande Facebook-evenement en bevestig daarna hieronder. Horeca OS wijzigt Facebook niet automatisch.</p>
    {id ? <a className="secondaryButton" href={`https://www.facebook.com/events/${id}/`} target="_blank" rel="noopener noreferrer">Facebook-evenement openen</a> : <p>Klik op ‘Bronnen opnieuw vergelijken’ om een oudere koppeling te controleren. Is er nog geen Facebook-evenement gekoppeld, koppel dan eerst het bestaande evenement. Een Facebookbericht is geen evenement.</p>}
    <label>Titel<textarea readOnly value={content.title} rows={2} /></label>
    <button type="button" className="secondaryButton" disabled={dirty || busy} onClick={() => copy(content.title)}>Titel kopiëren</button>
    <label>Beschrijving<textarea readOnly value={content.description} rows={6} /></label>
    <button type="button" className="secondaryButton" disabled={dirty || busy} onClick={() => copy(content.description)}>Beschrijving kopiëren</button>
    <label><input type="checkbox" checked={checked} onChange={event => setChecked(event.target.checked)} disabled={dirty || busy || state.key !== "ready"} /> Ik heb deze titel en beschrijving in het gekoppelde Facebook-evenement opgeslagen.</label>
    <button type="button" className="primaryButton" disabled={!checked || dirty || busy || state.key !== "ready" || !onConfirm} onClick={() => onConfirm(contentSnapshot(distribution, "facebook"))}>Handmatig bijgewerkt</button>
    {message && <span role="status">{message}</span>}
    <style jsx>{`
      .manualFacebookUpdate{display:grid;gap:12px;margin:18px 0;padding:16px;border:2px solid #25889b;border-radius:9px;background:#fff}
      h4,p{margin:0} small{color:#405866} label{display:grid;gap:6px}
      textarea{box-sizing:border-box;width:100%;resize:vertical;white-space:pre-wrap;font:inherit;padding:8px}
      input[type=checkbox]{width:18px;height:18px} button,a{justify-self:start;max-width:100%}
    `}</style>
  </section>;
}
