"use client";

import { useEffect, useRef, useState } from "react";
import { META_CAMPAIGN_STATUS_LABELS } from "../lib/meta-campaign-status";
import { publicWebUrl } from "../lib/meta-campaign-settings";

function displayDate(value) {
  return value && Number.isFinite(Date.parse(value)) ? new Date(value).toLocaleString("nl-NL") : "Niet beschikbaar";
}

export default function MetaCampaignStatus({ workspaceId, session, item, paidCampaign, enabled, onSaved }) {
  const [snapshot, setSnapshot] = useState(paidCampaign.live_status || null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const latest = useRef({ item, onSaved });
  latest.current = { item, onSaved };
  const requestRef = useRef(null);

  async function refresh() {
    if (!session?.access_token || requestRef.current) return;
    const controller = new AbortController();
    requestRef.current = controller;
    setBusy(true); setError("");
    try {
      const response = await fetch("/api/integrations/facebook/ads", {
        method: "POST", cache: "no-store", signal: controller.signal,
        headers: { Authorization: `Bearer ${session.access_token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ action: "refresh_status", workspaceId, businessId: item.business_id, campaignId: item.id }),
      });
      const result = await response.json();
      if (!response.ok || !result.paidCampaign?.live_status) throw new Error(result.error || "Meta heeft geen actuele status teruggegeven.");
      if (controller.signal.aborted) return;
      setSnapshot(result.paidCampaign.live_status);
      const current = latest.current.item;
      latest.current.onSaved?.({ ...current, media: (current.media || []).map(entry => entry?.kind === "campaign_distribution" ? { ...entry, facebook_paid_campaign: result.paidCampaign } : entry) });
    } catch (failure) {
      if (!controller.signal.aborted) setError(failure.message || "De statuscontrole is niet gelukt.");
    } finally {
      if (requestRef.current === controller) { requestRef.current = null; setBusy(false); }
    }
  }

  useEffect(() => {
    if (enabled) refresh();
    return () => { requestRef.current?.abort(); requestRef.current = null; };
  }, [enabled, workspaceId, item.id, item.business_id, session?.access_token, paidCampaign.campaign_id]);

  return <section aria-label="Geregistreerde Meta-campagne">
    <h4>Geregistreerde Meta-campagne</h4>
    <p><strong>{paidCampaign.name || "Campagne bij dit evenement"}</strong></p>
    <p role="status"><strong>{snapshot ? META_CAMPAIGN_STATUS_LABELS[snapshot.state] || META_CAMPAIGN_STATUS_LABELS.unknown : "Nog niet gecontroleerd bij Meta"}</strong></p>
    <p>Laatste geslaagde controle: {displayDate(snapshot?.checked_at)}</p>
    {snapshot && <p>Looptijd in Meta: {displayDate(snapshot.start_at)} — {displayDate(snapshot.end_at)}</p>}
    <p>Advertentieaccount: {paidCampaign.ad_account_name || paidCampaign.ad_account_id}. Campagnenummer: {paidCampaign.campaign_id}.</p>
    {paidCampaign.source && <p>Gepromote bron: {paidCampaign.source.name}. {publicWebUrl(paidCampaign.source.url) && <a href={publicWebUrl(paidCampaign.source.url)} target="_blank" rel="noreferrer">Oorspronkelijk bericht of evenement ↗</a>}</p>}
    {paidCampaign.audience_mode && <p>Doelgroep bij aanmaken: {paidCampaign.audience_mode === "saved" ? `opgeslagen Meta-doelgroep (${paidCampaign.saved_audience_id})` : paidCampaign.audience_mode === "advantage" ? "Advantage+" : "zelf samengesteld"}.</p>}
    {paidCampaign.dsa_payor && <p>Bij aanmaken — adverteerder: {paidCampaign.dsa_beneficiary}; betaler: {paidCampaign.dsa_payor}.</p>}
    <p>Dit is de campagne en advertentie die via Horeca OS zijn aangemaakt. ‘Actief’ betekent ingeschakeld, niet dat vertoningen of uitgaven zijn bevestigd. Andere campagnes worden niet automatisch gezocht.</p>
    {error && <p role="alert">Controle niet gelukt: {error} {snapshot ? "Hierboven staat de laatst bekende status, niet een nieuwe bevestiging." : "De huidige status is onbekend."}</p>}
    <button type="button" className="secondaryButton" disabled={busy || !session?.access_token} onClick={refresh}>{busy ? "Status controleren…" : "Status bij Meta controleren"}</button>
    {paidCampaign.manage_url && <a className="secondaryButton" href={paidCampaign.manage_url} target="_blank" rel="noreferrer">In Meta bekijken ↗</a>}
    <p>Deze controle wijzigt geen campagne of budget. Er wordt geen nieuwe campagne aangemaakt.</p>
  </section>;
}
