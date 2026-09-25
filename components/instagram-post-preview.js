"use client";

import { useState } from "react";
import Image from "next/image";

// Local presentation only: this component never prepares or publishes media.
export default function InstagramPostPreview({ draft, accountName, businessName, prepared = false }) {
  const assets = draft?.assets || [];
  const format = draft?.format || "feed";
  // Reset navigation when media/order/format changes, not on every caption edit.
  const mediaKey = JSON.stringify([format, ...assets.map(asset => asset.url)]);
  return <PreviewContent key={mediaKey} assets={assets} format={format} caption={draft?.caption || ""} accountName={accountName} businessName={businessName} prepared={prepared} />;
}

function PreviewContent({ assets, format, caption, accountName, businessName, prepared }) {
  const [index, setIndex] = useState(0);
  const [expanded, setExpanded] = useState(false);
  const [naturalRatio, setNaturalRatio] = useState(null);
  const [failedUrl, setFailedUrl] = useState(null);
  const asset = assets[index];
  const first = assets[0];
  const vertical = format === "story" || format === "reel";
  const ratio = first?.width && first?.height ? first.width / first.height : naturalRatio || 4 / 5;
  const handle = accountName ? `@${accountName.replace(/^@/, "")}` : businessName || "Instagram-account";
  const title = ({ feed: "Feedbericht", carousel: "Carrousel", story: "Story", reel: "Reel" })[format] || "Feedbericht";
  return <section className="igMock" aria-label="Instagram-voorbeeld">
    <div className="igMockHeading"><strong>Instagram-voorbeeld</strong><span>{title} · {prepared ? "Voorbereid" : "Concept"}</span></div>
    <div className={`igMockPhone ${vertical ? "igMockVertical" : ""}`}>
      <div className="igMockAccount"><span className="igMockAvatar" aria-hidden="true">{(businessName || accountName || "IG").slice(0, 2).toUpperCase()}</span><strong>{handle}</strong><span aria-hidden="true">•••</span></div>
      <div className="igMockMedia" style={{ aspectRatio: vertical ? "9 / 16" : String(Math.max(0.8, Math.min(1.91, ratio))) }}>
        {!asset ? <p className="igMockEmpty">Kies een {format === "reel" ? "video" : "foto of video"} uit Horeca OS om het voorbeeld te zien.</p>
          : failedUrl === asset.url ? <p className="igMockEmpty" role="status">Dit bestand kan niet in het voorbeeld worden geladen. Controleer je gekozen media.</p>
          : asset.type === "video" ? <video key={asset.url} src={asset.url} controls playsInline preload="metadata" aria-label={`Instagram-voorbeeld video ${index + 1}`} onError={() => setFailedUrl(asset.url)} onLoadedMetadata={event => { if (index === 0 && event.currentTarget.videoHeight) setNaturalRatio(event.currentTarget.videoWidth / event.currentTarget.videoHeight); }} />
          : <Image key={asset.url} src={asset.url} alt={`Instagram-voorbeeld foto ${index + 1} van ${assets.length}`} fill unoptimized sizes="(max-width: 760px) 80vw, 340px" onError={() => setFailedUrl(asset.url)} onLoad={event => { if (index === 0 && event.currentTarget.naturalHeight) setNaturalRatio(event.currentTarget.naturalWidth / event.currentTarget.naturalHeight); }} />}
        {format === "story" && <div className="igMockStoryBar" aria-hidden="true" />}
        {format === "reel" && <span className="igMockReelBadge">Reel</span>}
        {format === "carousel" && assets.length > 1 && <span className="igMockCounter">{index + 1}/{assets.length}</span>}
      </div>
      {format === "carousel" && assets.length > 1 && <nav className="igMockNavigation" aria-label="Voorbeeld carrousel bedienen">
        <button type="button" aria-label="Vorig beeld in voorbeeld" disabled={index === 0} onClick={() => setIndex(value => Math.max(0, value - 1))}>‹</button>
        <span aria-live="polite">Beeld {index + 1} van {assets.length}</span>
        <button type="button" aria-label="Volgend beeld in voorbeeld" disabled={index === assets.length - 1} onClick={() => setIndex(value => Math.min(assets.length - 1, value + 1))}>›</button>
      </nav>}
      {format !== "story" && <div className="igMockText">
        <div className="igMockIcons" aria-hidden="true">
          <svg viewBox="0 0 24 24"><path d="M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.7l-1.1-1.1a5.5 5.5 0 0 0-7.8 7.8L12 21l8.8-8.6a5.5 5.5 0 0 0 0-7.8Z" /></svg>
          <svg viewBox="0 0 24 24"><path d="M21 11.5a9 9 0 0 1-9 9 10 10 0 0 1-4-.9L3 21l1.4-5a9 9 0 1 1 16.6-4.5Z" /></svg>
          <svg viewBox="0 0 24 24"><path d="m22 2-7 20-4-9-9-4 20-7ZM11 13 22 2" /></svg>
          <svg className="igMockBookmark" viewBox="0 0 24 24"><path d="M5 3h14v18l-7-5-7 5V3Z" /></svg>
        </div>
        <p className={`igMockCaption ${expanded ? "igMockExpanded" : ""}`}><strong>{handle}</strong>{" "}{caption || "Je bijschrift verschijnt hier."}</p>
        {caption && <button type="button" className="igMockExpand" aria-expanded={expanded} onClick={() => setExpanded(value => !value)}>{expanded ? "Minder tekst" : "Volledig bijschrift bekijken"}</button>}
      </div>}
    </div>
    <p className="igMockDisclaimer">Voorbeeld in Horeca OS, geen live Instagram-bericht. De uiteindelijke weergave kan afwijken. Je media worden hier niet bijgesneden.</p>
    {format === "story" && <p className="igMockDisclaimer">Een Story heeft geen los bijschrift. Tekst moet al in je foto of video staan.</p>}
    <style jsx>{`
      .igMock{display:grid;gap:10px;min-width:0;align-content:start;color:#17212b}
      .igMockHeading{display:flex;justify-content:space-between;gap:8px;flex-wrap:wrap;font-size:13px}.igMockHeading span{color:#627384;font-size:12px}
      .igMockPhone{width:100%;max-width:340px;margin:0 auto;border:1px solid #d7dde2;border-radius:14px;overflow:hidden;background:#fff;box-shadow:0 3px 12px #1735520a;font-family:Arial,sans-serif}
      .igMockVertical{max-width:270px}.igMockAccount{display:flex;align-items:center;gap:9px;padding:11px 12px;font-size:12px}.igMockAccount strong{flex:1;min-width:0;overflow-wrap:anywhere}.igMockAccount>span:last-child{letter-spacing:2px}
      .igMockAvatar{display:grid;place-items:center;flex-shrink:0;width:29px;height:29px;border-radius:50%;border:2px solid #c64d86;background:#fff;color:#344454;font-size:10px;font-weight:700}
      .igMockMedia{position:relative;background:#f1f3f5;overflow:hidden;width:100%}.igMockVertical .igMockMedia{background:#121820}
      .igMockMedia :global(img),.igMockMedia video{display:block;width:100%;height:100%;max-height:none;object-fit:contain;background:transparent}
      .igMockEmpty{height:100%;display:grid;place-content:center;padding:22px;text-align:center;color:#65717d;font-size:13px;line-height:1.5;margin:0}.igMockVertical .igMockEmpty{color:#e4e9ee}
      .igMockStoryBar{position:absolute;top:8px;left:10px;right:10px;height:3px;background:#ffffffad;border-radius:4px;pointer-events:none}
      .igMockCounter,.igMockReelBadge{position:absolute;top:10px;right:10px;background:#17212bc9;color:#fff;font-size:12px;padding:4px 8px;border-radius:12px;pointer-events:none}.igMockReelBadge{left:10px;right:auto}
      .igMockNavigation{display:flex;align-items:center;justify-content:space-between;padding:6px 12px;gap:10px;font-size:12px}.igMockNavigation button{display:grid;place-content:center;width:32px;height:32px;border:1px solid #d5dde3;background:white;border-radius:50%;color:#17212b;font-size:23px;cursor:pointer;padding:0}.igMockNavigation button:disabled{opacity:.35;cursor:default}
      .igMockText{padding:10px 12px 13px;display:grid;gap:8px}.igMockIcons{display:flex;gap:12px}.igMockIcons svg{width:21px;height:21px;fill:none;stroke:currentColor;stroke-width:1.7;stroke-linecap:round;stroke-linejoin:round}.igMockBookmark{margin-left:auto}
      .igMockCaption{margin:0;white-space:pre-wrap;overflow-wrap:anywhere;font-size:12px;line-height:1.5;display:-webkit-box;-webkit-line-clamp:3;-webkit-box-orient:vertical;overflow:hidden}.igMockExpanded{display:block;max-height:220px;overflow:auto}
      .igMockExpand{border:0;background:none;color:#567081;padding:0;text-align:left;font-size:12px;cursor:pointer;justify-self:start}.igMockExpand:focus-visible,.igMockNavigation button:focus-visible{outline:2px solid #168499;outline-offset:2px}
      .igMockDisclaimer{font-size:11px;line-height:1.5;color:#627384;margin:0}
    `}</style>
  </section>;
}
