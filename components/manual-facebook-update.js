"use client";

import { useEffect, useId, useState } from "react";
import { contentDeliveryStatus, contentSnapshot, eventContent, facebookEventId } from "../lib/manual-event-content";
import EventContentSaveNotice from "./event-content-save-notice";

export default function ManualFacebookUpdate({ distribution, dirty, busy, onConfirm, draftContent, sources = [], onChooseSource, onSave, saveNotice, linkCheck = "idle", textMatches = false }) {
  const [checked, setChecked] = useState(false);
  const [message, setMessage] = useState("");
  const [copiedField, setCopiedField] = useState("");
  const fieldId = useId();
  const content = draftContent || eventContent(distribution);
  const id = facebookEventId(distribution);
  const state = contentDeliveryStatus(distribution, "facebook");
  const linkMessage = linkCheck === "pending" ? "Koppeling controleren…" : linkCheck === "error" ? "Koppeling kon niet worden gecontroleerd" : linkCheck === "done" ? "Geen evenement gekoppeld" : "Koppeling nog niet gecontroleerd";
  const confirmationHelp = busy ? "Even wachten: de controle of opslag loopt nog." : !id ? "De Facebook-koppeling moet eerst bevestigd zijn." : dirty || state.key === "needs_update" ? "Kies bij stap 1 je tekstbron en klik op ‘Tekst bewaren in Horeca OS’." : state.key === "manual_confirmed" ? "Deze tekst is al door jou of een collega bevestigd." : "Vink alleen aan als deze titel én beschrijving op Facebook zijn opgeslagen.";
  useEffect(() => { setChecked(false); setMessage(""); setCopiedField(""); }, [content.title, content.description, id, dirty]);
  async function copy(text, field) {
    try { await navigator.clipboard.writeText(text); setCopiedField(field); setMessage(""); }
    catch { setCopiedField(""); setMessage("Kopiëren is geblokkeerd. Selecteer en kopieer de tekst hieronder handmatig."); }
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
      setMessage("Je agendapunt blijft hier open. Geen Facebook-venster verschenen? Gebruik de link ‘Facebook-evenement openen’ hierboven.");
    } catch {
      setMessage("Het aparte venster kon niet worden geopend. Gebruik de link ‘Facebook-evenement openen’ hierboven.");
    }
  }
  if (textMatches && !dirty && !busy && id) return <section className="manualFacebookUpdate" aria-label="Facebook handmatig bijwerken">
    <h4>Tekst komt overeen — geen actie nodig</h4>
    <EventContentSaveNotice notice={saveNotice} />
    <p>De vergelijking bevestigt dat de opgeslagen titel en omschrijving al op Facebook staan. Je hoeft niets te kopiëren of handmatig te bevestigen.</p>
    <a className="secondaryButton" href={`https://www.facebook.com/events/${id}/`} target="_blank" rel="noopener noreferrer">Facebook-evenement bekijken</a>
  </section>;
  return <section className="manualFacebookUpdate" aria-label="Facebook handmatig bijwerken">
    <header className="workspaceHeading"><h4>Facebook handmatig bijwerken</h4><strong className="statusBadge">{!id ? linkMessage : dirty ? "Nog niet bewaard" : state.label}</strong></header>
    {state.at && <small>Door een gebruiker bevestigd op {new Date(state.at).toLocaleString("nl-NL")}. Niet automatisch door Facebook gecontroleerd.</small>}
    {sources.length > 0 && onChooseSource && <div className="sourceChoice">
      <h5>1. Kies en bewaar</h5>
      <div className="sourceControls"><label>Tekstbron<select value={draftContent?.label || ""} disabled={busy} onChange={event => { const source = sources.find(source => source.label === event.target.value); if (source) onChooseSource(source); }}>
        <option value="" disabled>Kies de tekst die je wilt gebruiken</option>
        {sources.map(source => <option key={source.label} value={source.label}>{source.label}</option>)}
      </select></label>
      <button type="button" className="secondaryButton" disabled={busy || !draftContent || !onSave} onClick={() => onSave({ title: content.title, description: content.description })}>Tekst bewaren in Horeca OS</button></div>
      <EventContentSaveNotice notice={saveNotice} />
      <small>Alleen lokaal bewaren; dit wijzigt Facebook en de website niet.</small>
    </div>}
    <div className="facebookWorkspace">
    <div className="copyPane">
    {dirty && <p role="status">Deze keuze is nog niet opgeslagen. Bewaar de tekst eerst; daarna kun je kopiëren.</p>}
    <div className="textField"><div className="fieldHeading"><label htmlFor={`${fieldId}-title`}>Titel</label><span className="copyActions"><span role="status">{copiedField === "title" ? "Titel gekopieerd" : ""}</span><button type="button" className="secondaryButton" disabled={dirty || busy} onClick={() => copy(content.title, "title")}>Titel kopiëren</button></span></div><textarea id={`${fieldId}-title`} readOnly value={content.title} rows={2} /></div>
    <div className="textField"><div className="fieldHeading"><label htmlFor={`${fieldId}-description`}>Beschrijving</label><span className="copyActions"><span role="status">{copiedField === "description" ? "Beschrijving gekopieerd" : ""}</span><button type="button" className="secondaryButton" disabled={dirty || busy} onClick={() => copy(content.description, "description")}>Beschrijving kopiëren</button></span></div><textarea id={`${fieldId}-description`} readOnly value={content.description} rows={8} /></div>
    </div>
    <div className="facebookPane">
    <h5>2. Openen en plakken</h5>
    {id ? <>
      <a className="secondaryButton" href={`https://www.facebook.com/events/${id}/`} target="_blank" rel="noopener noreferrer">Facebook-evenement openen</a>
      <p>Kopieer links. Kies op Facebook <b>Bewerken</b>, plak en sla op.</p>
      <details className="openingHelp"><summary>Naast elkaar openen</summary><p>In Chrome: rechtsklik op de evenementlink hierboven en kies ‘Link openen in gesplitste weergave’.</p><a href={`https://www.facebook.com/events/${id}/`} target="_blank" rel="noopener noreferrer" onClick={openFacebook}>Liever een los venster openen</a></details>
    </> : <p role="status">{linkCheck === "pending" ? "De agenda controleert de Facebook-koppeling automatisch. De knop verschijnt hier zodra het bestaande evenement is gevonden; je hoeft niets opnieuw te starten." : linkCheck === "error" ? "De automatische controle is niet gelukt. Dit betekent niet dat je evenement ontbreekt. Je kunt de controle opnieuw proberen met ‘Bronnen opnieuw vergelijken’." : "Er is nog geen bevestigde Facebook-evenementkoppeling beschikbaar. Je kunt ‘Bronnen opnieuw vergelijken’ gebruiken of het bestaande evenement koppelen. Een Facebookbericht is geen evenement."}</p>}
    <div className="confirmation"><h5>3. Bevestig je wijziging</h5>
    <p id={`${fieldId}-confirmation-help`} className="confirmationHelp">{confirmationHelp}</p>
    <label className="confirmationCheck"><input type="checkbox" aria-describedby={`${fieldId}-confirmation-help`} checked={checked} onChange={event => setChecked(event.target.checked)} disabled={dirty || busy || state.key !== "ready"} /> Ik heb deze titel en beschrijving op Facebook opgeslagen.</label>
    <button type="button" className="primaryButton" disabled={!checked || dirty || busy || state.key !== "ready" || !onConfirm} onClick={() => onConfirm(contentSnapshot(distribution, "facebook"))}>Handmatig bijgewerkt</button>
    </div>
    </div>
    </div>
    {message && <span role="status">{message}</span>}
    <style jsx>{`
      .manualFacebookUpdate{display:grid;gap:14px;margin:12px 0;padding:16px;border:1px solid #b9d5df;border-radius:12px;background:#fff;container-type:inline-size}
      h4,h5,p{margin:0} h4{font-size:16px} h5{font-size:14px} small{color:#405866} label{display:grid;gap:5px}
      .workspaceHeading,.sourceControls,.fieldHeading,.copyActions{display:flex;align-items:center;justify-content:space-between;gap:10px;flex-wrap:wrap}
      .statusBadge{font-size:12px;border-radius:20px;padding:5px 9px;background:#eff8fa;color:#176d7f}
      .sourceControls{align-items:end;justify-content:flex-start}.sourceControls label{flex:1;min-width:140px}
      .facebookWorkspace{display:grid;grid-template-columns:minmax(0,1.4fr) minmax(0,1fr);gap:16px}
      .copyPane,.facebookPane,.sourceChoice,.textField,.confirmation{display:grid;gap:10px;align-content:start;min-width:0}
      .sourceChoice{padding-bottom:12px;border-bottom:1px solid #d7e4e8}.sourceChoice small{font-size:12px}
      .facebookPane{padding:14px;background:#eff8fa;border-radius:8px;font-size:13px;line-height:1.5}
      .confirmation{border-top:1px solid #cbdfe5;padding-top:12px;margin-top:4px}.confirmationHelp{color:#405866}
      .confirmationCheck{display:flex;align-items:flex-start;gap:8px}.confirmationCheck input{flex:0 0 18px;margin:2px 0 0}
      .fieldHeading{font-size:13px;font-weight:700}.copyActions{gap:6px}.copyActions span{font-size:11px;color:#176d7f;font-weight:400}.copyActions button{padding:6px 9px;font-size:12px}
      select{box-sizing:border-box;width:100%;max-width:100%;padding:8px;font:inherit;border:1px solid #b9ccd7;border-radius:6px}
      textarea{box-sizing:border-box;min-width:0;width:100%;resize:vertical;white-space:pre-wrap;font:inherit;font-size:13px;line-height:1.5;padding:10px;border:1px solid #b9ccd7;border-radius:6px;background:#fafcfd;color:#173552}
      input[type=checkbox]{width:18px;height:18px} button,a{justify-self:start;max-width:100%}button:disabled{opacity:.55;cursor:not-allowed}
      .openingHelp summary{cursor:pointer;color:#176d7f;text-decoration:underline}.openingHelp p{margin:8px 0}
      @container(max-width:540px){.facebookWorkspace{grid-template-columns:minmax(0,1fr)}.sourceControls{align-items:stretch}.sourceControls label{flex-basis:100%}}
    `}</style>
  </section>;
}
