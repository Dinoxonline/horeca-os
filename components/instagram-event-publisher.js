"use client";

import { useEffect, useRef, useState } from "react";
import Image from "next/image";
import { withRequestTimeout } from "../lib/request-timeout";
import { INSTAGRAM_FORMATS, validateInstagramDraft, instagramJobLabel } from "../lib/instagram-publishing";
import { instagramEventMedia } from "../lib/instagram-event-media";
import { prepareInstagramPhoto, uploadInstagramPhoto } from "../lib/instagram-photo";
import { waitForInstagramPreparation } from "../lib/instagram-preparation";
import InstagramPostPreview from "./instagram-post-preview";

export default function InstagramEventPublisher({ item, workspaceId, session, businessName, onPublished, linkedSources = [], mediaLoading = false }) {
  const distribution = (item.media || []).find(entry => entry?.kind === "campaign_distribution") || {};
  const [format, setFormat] = useState("feed");
  const [caption, setCaption] = useState(distribution.channel_payloads?.instagram?.text || distribution.common?.description || item.body || "");
  const [assets, setAssets] = useState([]);
  const [shareToFeed, setShareToFeed] = useState(true);
  const [account, setAccount] = useState(null);
  const [loaded, setLoaded] = useState(false);
  const [warning, setWarning] = useState("");
  const [jobs, setJobs] = useState(distribution.instagram_publications || {});
  const [busy, setBusy] = useState("");
  const [message, setMessage] = useState("");
  const [confirmed, setConfirmed] = useState(false);
  const lock = useRef(false);
  const localPreviews = useRef(new Set());
  const uploadedCopies = useRef(new Map());
  const mounted = useRef(true);
  const controllers = useRef(new Set());
  const statusPanel = useRef(null);
  const [followPreparation, setFollowPreparation] = useState(false);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      for (const controller of controllers.current) controller.abort();
      controllers.current.clear();
      for (const url of localPreviews.current) URL.revokeObjectURL(url);
      localPreviews.current.clear();
    };
  }, []);
  const job = jobs[format];
  useEffect(() => {
    if (!followPreparation) return;
    statusPanel.current?.scrollIntoView?.({ block: "nearest", behavior: "smooth" });
    statusPanel.current?.focus?.({ preventScroll: true });
  }, [followPreparation, job?.status]);
  const locked = job && !["failed", "draft"].includes(job.status);
  const preview = locked ? job.draft : { format, caption: format === "story" ? "" : caption, assets, shareToFeed };
  const profileUrl = account?.name ? `https://www.instagram.com/${encodeURIComponent(account.name)}/` : "https://www.instagram.com/";
  const availableMedia = instagramEventMedia(item, linkedSources);

  async function request(action, extra = {}, timeout = 55000) {
    if (!mounted.current) throw new DOMException("Scherm gesloten", "AbortError");
    const params = { workspaceId, businessId: item.business_id, campaignId: item.id };
    const controller = new AbortController();
    controllers.current.add(controller);
    try {
      const response = await withRequestTimeout(fetch(`/api/integrations/meta/publish${action ? "" : "?" + new URLSearchParams(params)}`, {
        method: action ? "POST" : "GET", signal: controller.signal,
        headers: { Authorization: `Bearer ${session?.access_token || ""}`, "Content-Type": "application/json" },
        ...(action ? { body: JSON.stringify({ ...params, format, action, ...extra }) } : {}),
      }).then(async response => ({ ok: response.ok, payload: await response.json() })), "Geen antwoord ontvangen. Controleer eerst de status voordat je opnieuw handelt.", () => controller.abort(), timeout);
      controller.signal.throwIfAborted();
      if (!mounted.current) throw new DOMException("Scherm gesloten", "AbortError");
      if (response.payload.job && ["status", "publish"].includes(action) && response.payload.job.operation_id !== extra.operationId) throw new Error("De voorbereiding is gewijzigd. Ververs eerst de accountstatus.");
      if (response.payload.job) {
        setJobs(previous => ({ ...previous, [format]: response.payload.job }));
        if (response.payload.job.status === "published") onPublished?.(format, response.payload.job);
      }
      if (!response.ok) throw new Error(response.payload.error || "Instagram-aanvraag mislukt.");
      return response.payload;
    } finally { controllers.current.delete(controller); }
  }
  async function run(label, action) {
    if (lock.current) return;
    lock.current = true; setBusy(label); setMessage(""); setConfirmed(false);
    try { await action(); } catch (error) { if (mounted.current) setMessage(error.message || "Deze actie is niet gelukt."); }
    finally { lock.current = false; if (mounted.current) setBusy(""); }
  }
  async function followStatus(prepared) {
    if (prepared?.status !== "processing") return;
    const controller = new AbortController();
    controllers.current.add(controller);
    try {
      const result = await waitForInstagramPreparation(prepared, async (operationId, timeout) => {
        const response = await request("status", { operationId }, timeout);
        return response.job;
      }, {
        signal: controller.signal,
        onProgress: (attempt, total) => setBusy(`Stap 2 van 3: Instagram verwerkt je media — controle ${attempt} van ${total}…`),
      });
      if (mounted.current && result?.status === "processing") setMessage("Instagram heeft meer tijd nodig. De automatische controle is gestopt. Je voorbereiding blijft bewaard. Kies ‘Verwerking / publicatiestatus controleren’ om verder te gaan; zet het voorbeeld niet opnieuw klaar.");
    } finally { controllers.current.delete(controller); }
  }
  function loadStatus() {
    return run("Account en status laden…", async () => {
      const result = await request();
      const savedDraft = result.publications?.[format];
      if (!loaded && assets.length === 0 && ["draft", "failed"].includes(savedDraft?.status) && savedDraft.draft) {
        setCaption(savedDraft.draft.caption || ""); setAssets(savedDraft.draft.assets || []); setShareToFeed(savedDraft.draft.shareToFeed === true);
      }
      setAccount(result.account); setWarning(result.warning || ""); setJobs(result.publications || {}); setLoaded(true);
      if (!result.warning && result.account) await followStatus(savedDraft);
    });
  }
  function addAsset(asset) {
    if (asset.issue) { setMessage(asset.issue); return; }
    if (assets.some(existing => (existing.sourceUrl || existing.url) === asset.url)) return;
    if (format === "feed" && asset.type !== "image" || format === "reel" && asset.type !== "video") return;
    if (assets.length >= INSTAGRAM_FORMATS[format].max) { setMessage("Het maximale aantal bestanden voor dit formaat is bereikt."); return; }
    if (asset.needsJpeg) return run("JPG-voorbeeld maken…", async () => {
      const prepared = await prepareInstagramPhoto(asset);
      if (!mounted.current) return;
      const url = URL.createObjectURL(prepared.blob);
      localPreviews.current.add(url);
      setAssets(previous => [...previous, { type: "image", url, sourceUrl: asset.url, ...prepared }]);
      setMessage("Foto gekozen. De JPG-kopie wordt pas opgeslagen bij ‘Voorbeeld klaarzetten’. Het origineel blijft behouden; er is niets gepubliceerd.");
    });
    setAssets(previous => [...previous, { type: asset.type, url: asset.url, width: asset.width, height: asset.height }]); setMessage("");
  }
  return <section className="instagramPublisher" aria-label="Instagram plaatsen">
    <p>Maak een publicatie voor <strong>{businessName || "deze vestiging"}</strong>. Dit verandert het Facebook-evenement en de website niet.</p>
    <div className="instagramToolbar">
      <button type="button" className="secondaryButton" disabled={!!busy} onClick={loadStatus}>{loaded ? "Account en status verversen" : "Instagram-account controleren"}</button>
      {account && <strong>Bestemming: @{account.name}</strong>}
      <a href="/koppelingen">Koppeling beheren</a>
    </div>
    {warning && <p role="status">{warning}</p>}
    <label>Wat wil je plaatsen?<select value={format} disabled={!!busy} onChange={event => { setFormat(event.target.value); setAssets([]); setConfirmed(false); setMessage(""); setFollowPreparation(false); }}>
      {Object.entries(INSTAGRAM_FORMATS).map(([key, option]) => <option key={key} value={key}>{option.label}</option>)}
    </select></label>
    <p>{INSTAGRAM_FORMATS[format].hint}</p>
    <div className="instagramFormatHelp"><strong>Aanbevolen formaat voor {INSTAGRAM_FORMATS[format].label.toLowerCase()}</strong><p>{INSTAGRAM_FORMATS[format].recommended}</p><small>Feedbericht en post betekenen hier hetzelfde. JPG, PNG en WebP kun je kiezen; voor PNG en WebP maakt Horeca OS een JPG-kopie zonder bijsnijden. Controleer altijd het voorbeeld.</small></div>
    {!locked && <div className="instagramComposer">
      <div>
        {format !== "story" && <label>Bijschrift<textarea rows={5} value={caption} disabled={!!busy} onChange={event => setCaption(event.target.value)} /><small>{[...caption].length}/2.200 tekens</small></label>}
        {format === "reel" && <label className="instagramCheck"><input type="checkbox" checked={shareToFeed} disabled={!!busy} onChange={event => setShareToFeed(event.target.checked)} />Reel ook delen in de feed</label>}
        <section className="instagramEventMedia" aria-label="Media uit Horeca OS">
          <strong>Media uit Horeca OS</strong>
          <p>Kies een foto of video van dit evenement. Opnieuw uploaden is niet nodig.</p>
          {mediaLoading && <small role="status">Gekoppelde evenementmedia worden nog gecontroleerd…</small>}
          {!availableMedia.length && !mediaLoading && <p>Bij dit evenement is nog geen foto of video beschikbaar. Voeg de media eerst toe aan het evenement in Horeca OS.</p>}
          {format === "reel" && availableMedia.length > 0 && !availableMedia.some(asset => asset.type === "video") && <p>Er is nog geen video gekoppeld aan dit evenement. Voor een Reel is een video nodig.</p>}
          <div className="instagramMediaGrid">{availableMedia.map((asset, index) => {
            const selected = assets.some(chosen => (chosen.sourceUrl || chosen.url) === asset.url);
            const wrongType = format === "feed" && asset.type !== "image" || format === "reel" && asset.type !== "video";
            return <div className="instagramMediaChoice" key={asset.url}>
              {asset.type === "image" ? <Image src={asset.url} width={240} height={150} unoptimized alt={asset.label} /> : <video src={asset.url} controls preload="none" aria-label={asset.label} />}
              <small>{asset.label}</small>
              {asset.width && asset.height && <small>{asset.width} × {asset.height} px</small>}
              <button type="button" className="secondaryButton" aria-label={`Kies ${asset.type === "video" ? "video" : "foto"} ${index + 1}: ${asset.label}`} disabled={!!busy || selected || wrongType || !!asset.issue || assets.length >= INSTAGRAM_FORMATS[format].max} onClick={() => addAsset(asset)}>{selected ? "Gekozen" : asset.type === "video" ? "Deze video gebruiken" : "Deze foto gebruiken"}</button>
              {(asset.issue || wrongType) && <small>{asset.issue || (format === "reel" ? "Voor een Reel kies je een video." : "Kies Reel, Story of Carrousel voor video.")}</small>}
              {asset.needsJpeg && !wrongType && <small>JPG-kopie wordt automatisch gemaakt; origineel blijft behouden.</small>}
            </div>;
          })}</div>
        </section>
      </div>
      <div>
        <InstagramPostPreview draft={preview} accountName={account?.name} businessName={businessName} />
        <strong>Gekozen media — deze volgorde wordt gebruikt</strong>
        {assets.length === 0 && <p>Kies een foto of video bij ‘Media uit Horeca OS’.</p>}
        {assets.map((asset, index) => <div className="instagramAsset" key={index}>
          {asset.type === "image" ? <img src={asset.url} alt={`Voorbeeld ${index + 1}`} /> : <video src={asset.url} controls preload="metadata" />}
          {asset.width && asset.height && <small>{asset.width} × {asset.height} px{asset.blob ? " · JPG-kopie, niet bijgesneden" : ""}</small>}
          {asset.type === "image" && asset.width && asset.height && ["feed", "carousel"].includes(format) && (asset.width / asset.height < 0.8 || asset.width / asset.height > 1.91) && <p role="alert">Deze foto heeft geen geschikte feedverhouding. Kies de staande 4:5- of vierkante versie uit Horeca OS.</p>}
          {format === "story" && asset.width && asset.height && Math.abs(asset.width / asset.height - 9 / 16) > 0.02 && <p>Deze foto is niet schermvullend 9:16. Kies bij voorkeur de Story-versie (1080 × 1920 px).</p>}
          <button type="button" className="secondaryButton" disabled={!!busy} onClick={() => setAssets(previous => previous.filter((_, i) => i !== index))}>Verwijder bestand {index + 1}</button>
        </div>)}
      </div>
    </div>}
    <div className="instagramPublishStatus" ref={statusPanel} tabIndex={-1} aria-label="Voortgang Instagram-publicatie">
      <p className="instagramSteps">1. Foto en tekst kiezen → 2. Voorbeeld klaarzetten → 3. Bevestigen en publiceren</p>
      <strong>{instagramJobLabel(job)}</strong>
      {busy && <p role="status"><span className="marketingLoadingSpinner" aria-hidden="true" /> {busy}</p>}
      {message && <p role="alert">{message}</p>}
      {job?.status === "preparing" && !job.container_id && !busy && <p>De voorbereiding is nog niet afgerond. Blijft dit na het verversen van de accountstatus zo? Kies ‘Voorbereiding herstellen’. Je gekozen foto en tekst blijven bewaard. Dit plaatst niets op Instagram.</p>}
      {job?.error && <p>{job.error}</p>}
      {!locked && <button type="button" className="secondaryButton" disabled={!!busy || !loaded || !!warning || !account} onClick={() => run("Media klaarzetten bij Instagram…", async () => {
        setFollowPreparation(true);
        // Validate the whole draft before saving any local JPEG copies.
        validateInstagramDraft({ format, caption, assets: assets.map(asset => ({ ...asset, url: asset.sourceUrl || asset.url })), shareToFeed });
        if (["feed", "carousel"].includes(format) && assets.some(asset => asset.type === "image" && asset.width && asset.height && (asset.width / asset.height < 0.8 || asset.width / asset.height > 1.91))) throw new Error("Kies voor de feed foto's met een verhouding tussen 4:5 en 1,91:1. Er wordt niets bijgesneden of gepubliceerd.");
        const readyAssets = [];
        for (const asset of assets) {
          if (!mounted.current) return;
          let url = asset.url;
          if (asset.blob) {
            url = uploadedCopies.current.get(asset.blob);
            if (!url) {
              setBusy("JPG-kopie opslaan in Horeca OS…");
              url = await uploadInstagramPhoto(asset.blob, { workspaceId, businessId: item.business_id, campaignId: item.id });
              uploadedCopies.current.set(asset.blob, url);
            }
          }
          readyAssets.push({ type: asset.type, url });
        }
        if (!mounted.current) return;
        setBusy("Media klaarzetten bij Instagram…");
        const draft = validateInstagramDraft({ format, caption, assets: readyAssets, shareToFeed });
        const result = await request("prepare", { accountId: account.id, draft });
        await followStatus(result.job);
      })}>Voorbeeld klaarzetten — nog niet publiceren</button>}
      <div className={locked ? "instagramPreparedLayout" : undefined}>
      {locked && preview && <InstagramPostPreview draft={preview} accountName={job.account_name || account?.name} businessName={businessName} prepared />}
      <div className="instagramPreparedActions">
      {job?.container_id && job.status !== "published" && <button type="button" className="secondaryButton" disabled={!!busy || !loaded || !!warning} onClick={() => run("Instagram-status controleren…", async () => {
        setFollowPreparation(true);
        if (job.status === "processing") await followStatus(job);
        else await request("status", { operationId: job.operation_id });
      })}>Verwerking / publicatiestatus controleren</button>}
      {locked && ["preparing", "processing", "ready"].includes(job.status) && <button type="button" className="secondaryButton" disabled={!!busy || !loaded || !!warning} onClick={() => run("Voorbereiding vrijgeven…", async () => {
        await request("discard", { operationId: job.operation_id });
        setCaption(job.draft.caption); setAssets(job.draft.assets); setShareToFeed(job.draft.shareToFeed);
        setFollowPreparation(false);
        setMessage("Voorbereiding hersteld. Je foto en tekst staan hierboven klaar. Controleer het voorbeeld en kies opnieuw ‘Voorbeeld klaarzetten’. Er is niets gepubliceerd.");
      })}>{job.status === "preparing" && !job.container_id ? "Voorbereiding herstellen — niet publiceren" : "Voorbereiding aanpassen — niet publiceren"}</button>}
      {["preparing", "processing", "ready"].includes(job?.status) && <div className="instagramFinalStep">
        <strong>3. Bevestigen en publiceren</strong>
        <p>{job.status === "ready" ? "Je voorbeeld staat klaar. Bekijk het voorbereide bericht, vink hieronder je bevestiging aan en klik op publiceren." : "Zodra Instagram je media heeft verwerkt, kun je hieronder bevestigen en publiceren. Er is nog niets geplaatst."}</p>
        <label className="instagramCheck"><input type="checkbox" checked={confirmed} disabled={!!busy || job.status !== "ready" || !loaded || !!warning} onChange={event => setConfirmed(event.target.checked)} />Ik wil dit voorbereide bericht nu plaatsen op @{job.account_name}.</label>
        <button type="button" className="primaryButton" disabled={!!busy || job.status !== "ready" || !confirmed || !loaded || !!warning || !account} onClick={() => {
          if (job.status !== "ready" || !confirmed || !loaded || warning || !account) return;
          return run("Publiceren op Instagram…", () => request("publish", { confirm: true, operationId: job.operation_id }));
        }}>Nu publiceren op Instagram</button>
      </div>}
      {job?.status === "published" && <a href={job.permalink?.startsWith("https://www.instagram.com/") ? job.permalink : profileUrl} target="_blank" rel="noopener noreferrer">Bekijk op Instagram</a>}
      </div>
      </div>
    </div>
    <details><summary>Overige Instagram-opties en vereisten</summary>
      <p>Foto's: JPG, maximaal 8 MB. Feedfoto's: verhouding 4:5 tot 1,91:1. Stories en Reels: bij voorkeur 9:16. Instagram controleert het definitieve formaat en de verwerking.</p>
      <p>Stories via de koppeling vereisen een zakelijk account. Muziek uit de Instagram-bibliotheek, stickers, polls, effecten en Live gebruik je in Instagram zelf.</p>
      <a href={profileUrl} target="_blank" rel="noopener noreferrer">Instagram openen voor extra opties</a>
      <p>Er wordt niet automatisch geplaatst of opnieuw gepubliceerd. Bewaar je media zelf; een Story verdwijnt normaal na 24 uur.</p>
    </details>
    <style jsx>{`
      .instagramPublisher{display:grid;gap:12px;font-size:13px}.instagramPublisher p{margin:0;line-height:1.5}
      .instagramPublisher label{display:grid;gap:6px}.instagramPublisher select,.instagramPublisher input:not([type=checkbox]),.instagramPublisher textarea{width:100%;padding:9px;border:1px solid #bfd1dc;border-radius:6px;background:#fff;color:#173552}
      .instagramToolbar{display:flex;gap:10px;align-items:center;flex-wrap:wrap}.instagramComposer{display:grid;grid-template-columns:1fr 1fr;gap:16px}
      .instagramComposer>div{display:grid;gap:12px;align-content:start;min-width:0}.instagramAsset{display:grid;gap:6px}.instagramPublisher img,.instagramPublisher video{width:100%;max-height:200px;object-fit:contain;background:#f3f7f9}
      .instagramPublisher button{width:auto;justify-self:start;margin:0}.instagramPublisher .instagramCheck{display:flex;align-items:center;gap:8px}.instagramCheck input{width:auto}
      .instagramPublishStatus,.instagramFormatHelp{display:grid;gap:10px;padding:12px;background:#eef7f9;border-radius:8px}
      .instagramPreparedLayout{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);gap:20px;align-items:start}.instagramPreparedActions{display:grid;gap:12px;align-content:start;min-width:0}.instagramAsset>img,.instagramAsset>video{max-height:64px;width:64px;justify-self:start}
      .instagramSteps{font-size:12px;color:#486576}.instagramFinalStep{display:grid;gap:10px;border-top:1px solid #bfd1dc;padding-top:12px}.instagramPublishStatus:focus{outline:2px solid #168499;outline-offset:2px}.instagramPublisher button:disabled{opacity:.6;cursor:not-allowed}
      .instagramPublisher details{padding:8px 0}.instagramPublisher summary{cursor:pointer;font-weight:700}.instagramPublisher small{color:#5c7285}.marketingLoadingSpinner{display:inline-block}
      .instagramEventMedia{display:grid;gap:8px}.instagramMediaGrid{display:grid;grid-template-columns:repeat(auto-fit,minmax(130px,1fr));gap:10px;max-height:360px;overflow:auto}.instagramMediaChoice{display:grid;gap:6px;align-content:start;border:1px solid #cbdde5;border-radius:8px;padding:8px}.instagramMediaChoice :global(img),.instagramMediaChoice video{height:110px;width:100%;object-fit:contain}.instagramMediaChoice small{overflow-wrap:anywhere}
      @media(max-width:760px){.instagramComposer,.instagramPreparedLayout{grid-template-columns:1fr}}
    `}</style>
  </section>;
}
