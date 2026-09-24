"use client";

import { useEffect, useState } from "react";
import { contentDeliveryStatus, contentSnapshot, eventContent, facebookEventId } from "../lib/manual-event-content";

export default function ManualFacebookUpdate({ distribution, dirty, busy, onConfirm, draftContent, sources = [], onChooseSource, onSave }) {
  const [checked, setChecked] = useState(false);
  const [message, setMessage] = useState("");
  const content = draftContent || eventContent(distribution);
  const id = facebookEventId(distribution);
  const state = contentDeliveryStatus(distribution, "facebook");
  useEffect(() => { setChecked(false); setMessage(""); }, [content.title, content.description, id, dirty]);
  async function copy(text) {
    try { await navigator.clipboard.writeText(text); setMessage("Gekopieerd."); }
    catch { setMessage("Kopiëren is geblokkeerd. Selecteer en kopieer de tekst hieronder handmatig."); }
  }
  function openFacebook(event) {
    // Modified clicks retain the browser's ordinary link behavior.
    if (event.ctrlKey || event.metaKey || event.shiftKey || event.altKey || event.button > 0) return;
    event.preventDefault();
    const width = Math.min(760, window.screen.availWidth || 760);
    const height = Math.min(900, window.screen.availHeight || 900);
    const left = (window.screen.availLeft || 0) + Math.max(0, (window.screen.availWidth || width) - width);
    const top = window.screen.availTop || 0;
    try {
      window.open(`https://www.facebook.com/events/${id}/`, "_blank", `popup=yes,width=${width},height=${height},left=${left},top=${top},noopener,noreferrer`);
      // noopener can return null even when opening succeeded; do not claim success.
      setMessage("Je agendapunt blijft hier open. Geen Facebook-venster verschenen? Gebruik ‘Openen in nieuw tabblad’ of sta pop-ups toe.");
    } catch {
      setMessage("Het aparte venster kon niet worden geopend. Gebruik ‘Openen in nieuw tabblad’.");
    }
  }
  return <section className="manualFacebookUpdate" aria-label="Facebook handmatig bijwerken">
    <h4>Facebook handmatig bijwerken</h4>
    <strong>{dirty ? "Sla eerst de gekozen tekst op" : state.label}</strong>
    {state.at && <small>Door een gebruiker bevestigd op {new Date(state.at).toLocaleString("nl-NL")}. Niet automatisch door Facebook gecontroleerd.</small>}
    <p>Werk vanuit dit agendapunt: kies en bewaar de tekst, open Facebook ernaast en plak de tekst daar. Horeca OS wijzigt Facebook niet automatisch.</p>
    {sources.length > 0 && onChooseSource && <div className="sourceChoice">
      <label>Tekstbron<select value={draftContent?.label || ""} disabled={busy} onChange={event => { const source = sources.find(source => source.label === event.target.value); if (source) onChooseSource(source); }}>
        <option value="" disabled>Kies de tekst die je wilt gebruiken</option>
        {sources.map(source => <option key={source.label} value={source.label}>{source.label}</option>)}
      </select></label>
      <button type="button" className="secondaryButton" disabled={busy || !draftContent || !onSave} onClick={() => onSave({ title: content.title, description: content.description })}>Tekst bewaren in Horeca OS</button>
      <small>Dit bewaart alleen de tekst in Horeca OS. De website en Facebook worden niet gewijzigd.</small>
    </div>}
    <div className="facebookWorkspace">
    <div className="copyPane">
    <h5>1. Tekst voor Facebook</h5>
    {dirty && <p role="status">Deze keuze is nog niet opgeslagen. Bewaar de tekst eerst; daarna kun je kopiëren.</p>}
    <label>Titel<textarea readOnly value={content.title} rows={2} /></label>
    <button type="button" className="secondaryButton" disabled={dirty || busy} onClick={() => copy(content.title)}>Titel kopiëren</button>
    <label>Beschrijving<textarea readOnly value={content.description} rows={6} /></label>
    <button type="button" className="secondaryButton" disabled={dirty || busy} onClick={() => copy(content.description)}>Beschrijving kopiëren</button>
    </div>
    <div className="facebookPane">
    <h5>2. Openen en plakken</h5>
    <p>Facebook staat zijn bewerkscherm niet binnen een andere website toe. Deze knop vraagt daarom een compact venster rechts op je scherm aan. Je browser kan het ook als tabblad openen.</p>
    {id ? <>
      <a className="secondaryButton" href={`https://www.facebook.com/events/${id}/`} target="_blank" rel="noopener noreferrer" onClick={openFacebook}>Facebook naast Horeca OS openen</a>
      <a href={`https://www.facebook.com/events/${id}/`} target="_blank" rel="noopener noreferrer">Openen in nieuw tabblad</a>
      <p>Klik op Facebook op Bewerken, plak titel en beschrijving en sla daar op. Zet de vensters zo nodig naast elkaar; dit agendapunt blijft open.</p>
    </> : <p>Klik op ‘Bronnen opnieuw vergelijken’ om een oudere koppeling te controleren. Is er nog geen Facebook-evenement gekoppeld, koppel dan eerst het bestaande evenement. Een Facebookbericht is geen evenement.</p>}
    <h5>3. Bevestigen na opslaan op Facebook</h5>
    <label><input type="checkbox" checked={checked} onChange={event => setChecked(event.target.checked)} disabled={dirty || busy || state.key !== "ready"} /> Ik heb deze titel en beschrijving in het gekoppelde Facebook-evenement opgeslagen.</label>
    <button type="button" className="primaryButton" disabled={!checked || dirty || busy || state.key !== "ready" || !onConfirm} onClick={() => onConfirm(contentSnapshot(distribution, "facebook"))}>Handmatig bijgewerkt</button>
    </div>
    </div>
    {message && <span role="status">{message}</span>}
    <style jsx>{`
      .manualFacebookUpdate{display:grid;gap:12px;margin:18px 0;padding:16px;border:2px solid #25889b;border-radius:9px;background:#fff}
      h4,h5,p{margin:0} h5{font-size:14px} small{color:#405866} label{display:grid;gap:6px}
      .facebookWorkspace{display:grid;grid-template-columns:minmax(0,1.3fr) minmax(0,1fr);gap:20px}
      .copyPane,.facebookPane,.sourceChoice{display:grid;gap:12px;align-content:start;min-width:0}
      .facebookPane{padding:14px;background:#eff8fa;border-radius:8px}
      select{max-width:100%;padding:8px;font:inherit} .sourceChoice{padding-bottom:12px;border-bottom:1px solid #d7e4e8}
      textarea{box-sizing:border-box;width:100%;resize:vertical;white-space:pre-wrap;font:inherit;padding:8px}
      input[type=checkbox]{width:18px;height:18px} button,a{justify-self:start;max-width:100%}
      @media(max-width:700px){.facebookWorkspace{grid-template-columns:minmax(0,1fr)}}
    `}</style>
  </section>;
}
