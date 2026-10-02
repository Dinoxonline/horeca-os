"use client";

import { useEffect, useRef, useState } from "react";
import { whatsappDesktopUrl, whatsappDraft, whatsappShareUrl, prepareWhatsappImage } from "../lib/whatsapp-share";
import styles from "./whatsapp-share.module.css";

export default function WhatsappShare({ item, distribution, workspaceId, session, onPublished, hidden = false, id, panelRef, onToggle }) {
  const draft = whatsappDraft(item, distribution);
  const [text, setText] = useState(draft.text), [image, setImage] = useState(draft.images[0]?.url || "");
  const [file, setFile] = useState(null), [downloadUrl, setDownloadUrl] = useState("");
  const [busy, setBusy] = useState(false), [notice, setNotice] = useState("");
  const [canShareFile, setCanShareFile] = useState(false), [canCopyImage, setCanCopyImage] = useState(false), [open, setOpen] = useState(false);
  const [placed, setPlaced] = useState(distribution.manual_whatsapp?.state === "placed"), [saving, setSaving] = useState(false);
  const request = useRef(null), textarea = useRef(null);
  useEffect(() => () => request.current?.abort(), []);
  useEffect(() => setPlaced(distribution.manual_whatsapp?.state === "placed"), [distribution.manual_whatsapp?.revision, distribution.manual_whatsapp?.state]);
  useEffect(() => {
    if (!file) { setDownloadUrl(""); setCanShareFile(false); setCanCopyImage(false); return; }
    const url = URL.createObjectURL(file); setDownloadUrl(url);
    try { setCanShareFile(Boolean(navigator.share && navigator.canShare?.({ files: [file] }))); } catch { setCanShareFile(false); }
    setCanCopyImage(Boolean(typeof ClipboardItem !== "undefined" && navigator.clipboard?.write));
    return () => URL.revokeObjectURL(url);
  }, [file]);
  function chooseImage(url) {
    request.current?.abort(); request.current = null;
    setImage(url); setFile(null); setBusy(false); setNotice("");
  }
  async function prepare() {
    const controller = new AbortController(); request.current?.abort(); request.current = controller;
    setBusy(true); setNotice("");
    const timer = setTimeout(() => controller.abort(), 20000);
    try {
      const prepared = await prepareWhatsappImage(image, controller.signal);
      if (request.current === controller && !controller.signal.aborted) { setFile(prepared); setNotice("Foto klaargezet. Kies hieronder hoe je wilt delen."); return prepared; }
    } catch (failure) {
      if (request.current === controller) setNotice(`${failure.name === "AbortError" ? "Foto ophalen duurde te lang." : failure.message} Je kunt de originele foto openen en opslaan, en de tekst kopiëren.`);
    } finally { clearTimeout(timer); if (request.current === controller) { request.current = null; setBusy(false); } }
  }
  async function downloadImage() {
    const imageFile = file || await prepare();
    if (!imageFile) return;
    const url = URL.createObjectURL(imageFile), link = document.createElement("a");
    link.href = url; link.download = imageFile.name; document.body.appendChild(link); link.click(); link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    setNotice("Foto gedownload. Voeg die in WhatsApp Desktop toe met het paperclip-icoon.");
  }
  async function copy() {
    try { await navigator.clipboard.writeText(text); setNotice("Tekst gekopieerd. Plak deze in jullie WhatsApp-groep."); }
    catch { textarea.current?.focus(); textarea.current?.select(); setNotice("Kopiëren is geblokkeerd. De tekst is geselecteerd; kopieer deze zelf met Ctrl+C of via het selectiemenu."); }
  }
  async function sharePhoto() {
    try {
      // The file is already prepared: invoke native sharing directly in this click, retaining user activation.
      await navigator.share({ files: [file], text, title: draft.title });
      setNotice("Deelvenster geopend. Kies WhatsApp en jullie groep, controleer foto en tekst en verzend zelf. Horeca OS kan verzending niet bevestigen.");
    } catch (failure) {
      setNotice(failure.name === "AbortError" ? "Delen geannuleerd. Er is geen verzending bevestigd." : "Delen met foto lukt hier niet. Download de foto en kopieer de tekst om zelf in WhatsApp te plaatsen.");
    }
  }
  async function copyImage() {
    try { await navigator.clipboard.write([new ClipboardItem({ [file.type]: file })]); setNotice("Afbeelding gekopieerd. Plak deze in WhatsApp met Ctrl+V."); }
    catch { setNotice("Afbeelding kopiëren lukt in deze browser niet. Download de foto en voeg die zelf toe in WhatsApp."); }
  }
  async function markPlaced() {
    if (!workspaceId || !session?.access_token || !item?.business_id) { setNotice("Open deze route vanuit de publicatiekanalen om WhatsApp als geplaatst te bevestigen."); return; }
    setSaving(true); setNotice("");
    try {
      const response = await fetch("/api/marketing/manual-whatsapp", { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${session.access_token}` }, body: JSON.stringify({ workspaceId, businessId: item.business_id, itemId: item.id, expectedRevision: distribution.manual_whatsapp?.revision || null, action: "mark_published", confirmed: true }) });
      const data = await response.json(); if (!response.ok) throw new Error(data.error || "Bevestigen mislukt.");
      setPlaced(true); onPublished?.(data.saved); setNotice("WhatsApp is als geplaatst gemarkeerd. De kanaalstatus is groen.");
    } catch (failure) { setNotice(failure.message || "Bevestigen mislukt. Probeer opnieuw."); }
    finally { setSaving(false); }
  }
  return <details id={id} ref={panelRef} hidden={hidden} className={`marketingDetailFold ${styles.panel}`} onToggle={event => { setOpen(event.currentTarget.open); onToggle?.(event); }}>
    <summary>WhatsApp handmatig plaatsen</summary>
    {open && <div className={styles.body}>
      <p>Gebruik je eigen WhatsApp of WhatsApp Business. Kies zelf de groep en verstuur het bericht; Horeca OS plaatst niets automatisch.</p>
      <label>Bericht voor je groep<textarea ref={textarea} rows={8} maxLength={4000} value={text} onChange={event => { setText(event.target.value); setNotice(""); }} /><small>{text.length}/4.000 tekens · aanpassingen gelden alleen voor dit deelbericht en worden niet opgeslagen.</small></label>
      <div className={styles.actions}>
        <button type="button" className="secondaryButton" onClick={() => { setText(draft.text); chooseImage(draft.images[0]?.url || ""); }}>Actuele gegevens overnemen</button>
        {text.trim() && <a className="primaryButton" href={whatsappDesktopUrl(text)} onClick={() => setNotice("WhatsApp Desktop wordt geopend met de tekst. Kies zelf de groep, voeg de afbeelding toe en verzend.")}>WhatsApp Desktop openen</a>}
        {text.trim() && <a href={whatsappShareUrl(text)} target="_blank" rel="noreferrer">WhatsApp Web openen</a>}
        <button type="button" className="secondaryButton" disabled={!text.trim()} onClick={copy}>Tekst kopiëren</button>
      </div>
      {draft.images.length > 0 ? <>
        <section aria-label="Kies je WhatsApp-afbeelding"><strong>Kies je foto</strong><div className={styles.imageGrid}>{draft.images.map(entry => <button type="button" key={entry.url} className={`${styles.imageChoice} ${image === entry.url ? styles.selected : ""}`} disabled={busy} onClick={() => chooseImage(entry.url)} aria-pressed={image === entry.url}><img src={entry.url} alt="" /><span>{image === entry.url ? "✓ Gekozen" : "Kiezen"}</span><small>{entry.label}</small></button>)}</div></section>
        {image && <p className={styles.selectedPhoto}>Gekozen foto: <strong>{draft.images.find(entry => entry.url === image)?.label || "afbeelding"}</strong></p>}
        <div className={styles.actions}>
          <button type="button" className="secondaryButton" disabled={busy} onClick={downloadImage}>{busy ? "Foto voorbereiden…" : "Foto downloaden"}</button>
          <button type="button" className="secondaryButton" disabled={busy} onClick={prepare}>{busy ? "Foto klaarzetten…" : "Afbeelding kopiëren voorbereiden"}</button>
          {image && <a href={image} target="_blank" rel="noreferrer">Originele foto openen / opslaan ↗</a>}
          {downloadUrl && <a href={downloadUrl} download={file.name}>Foto downloaden</a>}
          {file && canCopyImage && <button type="button" className="secondaryButton" onClick={copyImage}>Afbeelding kopiëren</button>}
          {file && canShareFile && <button type="button" className="primaryButton" disabled={!text.trim()} onClick={sharePhoto}>Foto en bericht delen</button>}
        </div>
        {file && !canShareFile && <p>Deze browser ondersteunt het delen van bestanden niet. Download de foto, kopieer de tekst en voeg beide zelf toe in WhatsApp.</p>}
        <p>Bij ‘Foto en bericht delen’ kies je WhatsApp in het deelvenster. Controleer of de tekst is overgenomen; sommige apparaten delen alleen de foto.</p>
      </> : <p>Dit dossier heeft nog geen afbeelding. Je kunt tekst en link delen, of eerst een foto aan het evenement/product toevoegen.</p>}
      {notice && <p role="status" className={styles.notice}>{notice}</p>}
      {workspaceId && session?.access_token && <section className={placed ? styles.confirmed : styles.confirm}>
        {placed ? <><strong>✓ Geplaatst op WhatsApp</strong><small>Handmatig bevestigd. De WhatsApp-status is groen.</small></> : <><strong>Klaar met versturen?</strong><small>Bevestig pas nadat je het bericht zelf in WhatsApp hebt verzonden.</small><button type="button" className="primaryButton" disabled={saving} onClick={markPlaced}>{saving ? "Bevestigen…" : "Geplaatst op WhatsApp"}</button></>}
      </section>}
      <small>Horeca OS leest je groepen of contacten niet en kan niet zien of je het bericht hebt verzonden.</small>
    </div>}
  </details>;
}
