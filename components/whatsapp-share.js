"use client";

import { useEffect, useRef, useState } from "react";
import Image from "next/image";
import { whatsappDraft, whatsappShareUrl, prepareWhatsappImage } from "../lib/whatsapp-share";
import styles from "./whatsapp-share.module.css";

export default function WhatsappShare({ item, distribution }) {
  const draft = whatsappDraft(item, distribution);
  const [text, setText] = useState(draft.text), [image, setImage] = useState(draft.images[0]?.url || "");
  const [file, setFile] = useState(null), [downloadUrl, setDownloadUrl] = useState("");
  const [busy, setBusy] = useState(false), [notice, setNotice] = useState("");
  const [canShareFile, setCanShareFile] = useState(false), [open, setOpen] = useState(false);
  const request = useRef(null), textarea = useRef(null);
  useEffect(() => () => request.current?.abort(), []);
  useEffect(() => {
    if (!file) { setDownloadUrl(""); setCanShareFile(false); return; }
    const url = URL.createObjectURL(file); setDownloadUrl(url);
    try { setCanShareFile(Boolean(navigator.share && navigator.canShare?.({ files: [file] }))); } catch { setCanShareFile(false); }
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
      if (request.current === controller && !controller.signal.aborted) { setFile(prepared); setNotice("Foto klaargezet. Kies hieronder hoe je wilt delen."); }
    } catch (failure) {
      if (request.current === controller) setNotice(`${failure.name === "AbortError" ? "Foto ophalen duurde te lang." : failure.message} Je kunt de originele foto openen en opslaan, en de tekst kopiëren.`);
    } finally { clearTimeout(timer); if (request.current === controller) { request.current = null; setBusy(false); } }
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
  return <details className={`marketingDetailFold ${styles.panel}`} onToggle={event => setOpen(event.currentTarget.open)}>
    <summary>Delen via WhatsApp — evenement of product</summary>
    {open && <div className={styles.body}>
      <p>Gebruik je eigen WhatsApp of WhatsApp Business. Jij kiest de groep en drukt op verzenden. Er is geen extra koppeling nodig.</p>
      <label>Bericht voor je groep<textarea ref={textarea} rows={8} maxLength={4000} value={text} onChange={event => { setText(event.target.value); setNotice(""); }} /><small>{text.length}/4.000 tekens · aanpassingen gelden alleen voor dit deelbericht en worden niet opgeslagen.</small></label>
      <div className={styles.actions}>
        <button type="button" className="secondaryButton" onClick={() => { setText(draft.text); chooseImage(draft.images[0]?.url || ""); }}>Actuele gegevens overnemen</button>
        {text.trim() && <a className="primaryButton" href={whatsappShareUrl(text)} target="_blank" rel="noreferrer" onClick={() => setNotice("WhatsApp openen aangevraagd, alleen met tekst en link. Kies zelf de groep en verzend. De foto wordt via deze knop niet meegestuurd.")}>WhatsApp openen met tekst en link</a>}
        <button type="button" className="secondaryButton" disabled={!text.trim()} onClick={copy}>Tekst kopiëren</button>
      </div>
      {draft.images.length > 0 ? <>
        <label>Afbeelding<select value={image} disabled={busy} onChange={event => chooseImage(event.target.value)}>{draft.images.map(entry => <option key={entry.url} value={entry.url}>{entry.label}</option>)}</select></label>
        {image && <Image className={styles.preview} src={image} alt="Afbeelding voor je WhatsApp-bericht" width={280} height={200} unoptimized />}
        <div className={styles.actions}>
          <button type="button" className="secondaryButton" disabled={busy} onClick={prepare}>{busy ? "Foto klaarzetten…" : "Foto klaarzetten"}</button>
          {image && <a href={image} target="_blank" rel="noreferrer">Originele foto openen / opslaan ↗</a>}
          {downloadUrl && <a href={downloadUrl} download={file.name}>Foto downloaden</a>}
          {file && canShareFile && <button type="button" className="primaryButton" disabled={!text.trim()} onClick={sharePhoto}>Foto en bericht delen</button>}
        </div>
        {file && !canShareFile && <p>Deze browser ondersteunt het delen van bestanden niet. Download de foto, kopieer de tekst en voeg beide zelf toe in WhatsApp.</p>}
        <p>Bij ‘Foto en bericht delen’ kies je WhatsApp in het deelvenster. Controleer of de tekst is overgenomen; sommige apparaten delen alleen de foto.</p>
      </> : <p>Dit dossier heeft nog geen afbeelding. Je kunt tekst en link delen, of eerst een foto aan het evenement/product toevoegen.</p>}
      {notice && <p role="status" className={styles.notice}>{notice}</p>}
      <small>Horeca OS leest je groepen of contacten niet en kan niet zien of je het bericht hebt verzonden. Dit verandert de publicatiestatus niet.</small>
    </div>}
  </details>;
}
