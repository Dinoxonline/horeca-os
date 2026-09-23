"use client";

import { useEffect, useMemo, useState } from "react";
import { supabase } from "../lib/supabase";

const typeLabels = {
  event: "Evenement",
  product: "Gerecht of product",
  offer: "Aanbieding",
  package: "Arrangement",
  review: "Review delen",
  custom: "Eigen campagne",
  website_event: "Evenement",
};

function distributionFor(item) {
  return (item?.media || []).find((entry) => entry?.kind === "campaign_distribution") || {};
}

function statusFor(item, distribution) {
  const providerConfirmed = Boolean(
    distribution.provider_delivery?.facebook?.status === "confirmed"
      || distribution.facebook_event_delivery?.status === "confirmed"
      || distribution.provider_delivery?.brevo?.status === "confirmed"
      || distribution.provider_delivery?.google?.status === "confirmed"
      || distribution.published_at
      || item.published_at,
  );
  if (providerConfirmed) return { key: "published", label: "Geplaatst" };
  if (item.scheduled_for) return { key: "scheduled", label: "Ingepland" };
  if (item.workflow_status === "in_progress") return { key: "approved", label: "Goedgekeurd" };
  if (distribution.website_event_status === "cancelled" || distribution.website_event_status === "trash") {
    return { key: "cancelled", label: "Geannuleerd" };
  }
  return { key: "draft", label: "Concept" };
}

function formatDate(value) {
  if (!value) return "Nog geen datum gepland";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Nog geen datum gepland";
  return new Intl.DateTimeFormat("nl-NL", { dateStyle: "medium", timeStyle: "short" }).format(date);
}

export default function MarketingOverview({ workspaceId, businesses, onSelectBusiness }) {
  const [items, setItems] = useState([]);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState("");
  const [refreshKey, setRefreshKey] = useState(0);

  useEffect(() => {
    let active = true;
    async function loadOverview() {
      if (!workspaceId) return;
      setBusy(true);
      setError("");
      const { data, error: queryError } = await supabase.from("social_content_items")
        .select("id,business_id,media,status,workflow_status,scheduled_for,published_at,created_at")
        .eq("workspace_id", workspaceId)
        .filter("media", "cs", JSON.stringify([{ kind: "campaign_distribution" }]))
        .order("scheduled_for", { ascending: true, nullsFirst: false })
        .order("created_at", { ascending: false })
        .range(0, 199);
      if (!active) return;
      if (queryError) setError("Het gecombineerde marketingoverzicht kon niet worden geladen.");
      else setItems(data || []);
      setBusy(false);
    }
    loadOverview();
    return () => { active = false; };
  }, [workspaceId, refreshKey]);

  const itemsByBusiness = useMemo(() => {
    const result = new Map((businesses || []).map((business) => [String(business.id), []]));
    items.forEach((item) => {
      const key = String(item.business_id || "");
      if (result.has(key)) result.get(key).push(item);
    });
    return result;
  }, [businesses, items]);

  return <section className="panel marketingOverview">
    <div className="panelHead marketingOverviewHead">
      <div>
        <p className="eyebrow">MARKETINGOVERZICHT</p>
        <h2>Agenda van beide vestigingen</h2>
        <p>Bekijk in één oogopslag wat er voor Caribbean Corner en Grandcafé Het Plein gepland, goedgekeurd of geplaatst is. Nieuwe campagnes blijven gekoppeld aan één vestiging.</p>
      </div>
      <button type="button" className="secondaryButton" onClick={() => setRefreshKey((value) => value + 1)} disabled={busy}>{busy ? "Overzicht laden…" : "Overzicht verversen"}</button>
    </div>
    {error && <div className="eventResult error"><strong>{error}</strong></div>}
    <div className="marketingOverviewGrid">
      {(businesses || []).map((business) => {
        const businessItems = itemsByBusiness.get(String(business.id)) || [];
        return <article className="marketingVenueColumn" key={business.id}>
          <div className="marketingVenueHead">
            <div><p className="eyebrow">VESTIGING</p><h3>{business.name}</h3></div>
            <button type="button" className="primary" onClick={() => onSelectBusiness(business.id)}>Nieuwe campagne</button>
          </div>
          {busy ? <p className="marketingOverviewEmpty">Campagnes laden…</p> : businessItems.length === 0 ? <div className="marketingOverviewEmpty"><strong>Nog niets ingepland</strong><p>Er zijn nog geen opgeslagen campagnes voor deze vestiging.</p><button type="button" className="secondaryButton" onClick={() => onSelectBusiness(business.id)}>Campagne aanmaken</button></div> : <div className="marketingAgendaList">
            {businessItems.map((item) => {
              const distribution = distributionFor(item);
              const status = statusFor(item, distribution);
              const title = distribution.common?.title || "Zonder titel";
              const type = typeLabels[distribution.common?.campaign_type || distribution.source_type] || "Campagne";
              return <div className="marketingAgendaItem" key={item.id}>
                <div className="marketingAgendaItemTop"><span className="campaignKind">{type}</span><span className={`marketingAgendaStatus ${status.key}`}>{status.label}</span></div>
                <strong>{title}</strong>
                <span>{item.scheduled_for ? formatDate(item.scheduled_for) : `Aangemaakt ${formatDate(item.created_at)}`}</span>
              </div>;
            })}
          </div>}
        </article>;
      })}
    </div>
    <style jsx>{`
      .marketingOverview { margin-bottom: 24px; }
      .marketingOverviewHead { align-items: flex-start; }
      .marketingOverviewHead p:not(.eyebrow) { max-width: 760px; }
      .marketingOverviewGrid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 18px; }
      .marketingVenueColumn { min-width: 0; padding: 18px; border: 1px solid #c6d5df; border-radius: 12px; background: #f8fbfc; }
      .marketingVenueHead { display: flex; align-items: flex-start; justify-content: space-between; gap: 12px; margin-bottom: 12px; }
      .marketingVenueHead h3 { margin: 2px 0 0; }
      .marketingVenueHead button { flex: 0 0 auto; }
      .marketingAgendaList { display: grid; gap: 10px; }
      .marketingAgendaItem { display: grid; gap: 6px; padding: 12px; border: 1px solid #d5e0e7; border-radius: 10px; background: #fff; }
      .marketingAgendaItem > strong { overflow-wrap: anywhere; }
      .marketingAgendaItem > span:last-child { color: #5c7285; font-size: 13px; }
      .marketingAgendaItemTop { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
      .marketingAgendaStatus { padding: 4px 8px; border-radius: 999px; font-size: 12px; font-weight: 800; }
      .marketingAgendaStatus.draft { background: #eef2f5; color: #4c6172; }
      .marketingAgendaStatus.approved, .marketingAgendaStatus.published { background: #e5f6ea; color: #24723b; }
      .marketingAgendaStatus.scheduled { background: #e7f1ff; color: #145dbf; }
      .marketingAgendaStatus.cancelled { background: #f8eaea; color: #a12f2f; }
      .marketingOverviewEmpty { display: grid; gap: 7px; padding: 16px; border: 1px dashed #9cbac3; border-radius: 10px; background: #fff; color: #5c7285; }
      .marketingOverviewEmpty strong { color: #173552; }
      .marketingOverviewEmpty p { margin: 0; }
      @media (max-width: 760px) {
        .marketingOverviewGrid { grid-template-columns: 1fr; }
        .marketingOverviewHead, .marketingVenueHead { display: block; }
        .marketingOverviewHead button, .marketingVenueHead button { width: 100%; margin-top: 12px; }
      }
    `}</style>
  </section>;
}
