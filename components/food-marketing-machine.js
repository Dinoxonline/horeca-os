"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "../lib/supabase";

const marketingClasses = {
  hero: { label: "HERO", help: "Trekt nieuwe gasten en verdient de meeste zichtbaarheid.", color: "#9b3d00" },
  profit: { label: "PROFIT", help: "Helpt de besteding en marge per gast verhogen.", color: "#16623f" },
  supporting: { label: "SUPPORTING", help: "Onderdeel van de kaart, zonder extra advertentiedruk.", color: "#1f7182" },
};

const serviceMoments = ["lunch", "diner", "borrel", "dessert", "drank", "overig"];
const allowedTypes = new Set(["image/jpeg", "image/png", "image/webp", "video/mp4", "video/webm", "video/quicktime"]);

function euro(value) {
  const number = Number(value);
  return Number.isFinite(number) ? new Intl.NumberFormat("nl-NL", { style: "currency", currency: "EUR" }).format(number) : "—";
}

function compactList(value) {
  return String(value || "").split(",").map((item) => item.trim()).filter(Boolean).slice(0, 30);
}

function listText(value) {
  return Array.isArray(value) ? value.join(", ") : "";
}

function numberOrNull(value) {
  const number = Number(String(value).replace(",", "."));
  return Number.isFinite(number) && number >= 0 ? number : null;
}

function draftFrom(item) {
  return {
    name: item?.name || "",
    category: item?.category || "",
    short_description: item?.short_description || "",
    long_description: item?.long_description || "",
    selling_price: item?.selling_price ?? "",
    cost_price: item?.cost_price ?? "",
    active: item?.active ?? true,
    available_from: item?.available_from || "",
    available_until: item?.available_until || "",
    service_moments: item?.service_moments || [],
    marketing_class: item?.marketing_class || "supporting",
    priority_score: item?.priority_score ?? "",
    primary_usp: item?.primary_usp || "",
    target_audience: item?.target_audience || "",
    promotion_moments: item?.promotion_moments || "",
    call_to_action: item?.call_to_action || "",
    reservation_url: item?.reservation_url || "",
    landing_page_url: item?.landing_page_url || "",
    keywords: listText(item?.keywords),
    hashtags: listText(item?.hashtags),
    cross_sell_items: listText(item?.cross_sell_items),
    upsell_items: listText(item?.upsell_items),
  };
}

function itemMargin(item) {
  const selling = Number(item?.selling_price);
  const cost = Number(item?.cost_price);
  if (!Number.isFinite(selling) || !Number.isFinite(cost)) return null;
  return selling - cost;
}

function classBadge(value) {
  const item = marketingClasses[value] || marketingClasses.supporting;
  return <span style={{ display: "inline-flex", alignItems: "center", padding: "3px 8px", borderRadius: 99, background: "#eef7f8", color: item.color, fontWeight: 800, fontSize: 12 }}>{item.label}</span>;
}

export default function FoodMarketingMachine({ workspaceId, businessId, businesses, recipes, canManage, session }) {
  const [items, setItems] = useState([]);
  const [media, setMedia] = useState([]);
  const [selectedId, setSelectedId] = useState("");
  const [draft, setDraft] = useState(draftFrom(null));
  const [search, setSearch] = useState("");
  const [classFilter, setClassFilter] = useState("all");
  const [recipeToStart, setRecipeToStart] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [notice, setNotice] = useState("");

  const scopedRecipes = useMemo(() => recipes.filter((recipe) => businessId === "all" || recipe.business_id === businessId), [businessId, recipes]);
  const selected = items.find((item) => item.id === selectedId) || null;
  const selectedMedia = useMemo(() => media.filter((item) => item.item_id === selectedId), [media, selectedId]);

  const load = useCallback(async () => {
    if (!workspaceId) return;
    setLoading(true);
    let itemQuery = supabase.from("food_marketing_items")
      .select("id,workspace_id,business_id,location_id,recipe_id,name,category,short_description,long_description,selling_price,cost_price,active,available_from,available_until,service_moments,marketing_class,priority_score,primary_usp,target_audience,promotion_moments,call_to_action,reservation_url,landing_page_url,keywords,hashtags,cross_sell_items,upsell_items,last_promoted_at,last_promoted_channel,updated_at")
      .eq("workspace_id", workspaceId)
      .order("updated_at", { ascending: false });
    if (businessId !== "all") itemQuery = itemQuery.eq("business_id", businessId);
    const { data: nextItems, error: itemError } = await itemQuery;
    if (itemError) {
      setItems([]); setMedia([]); setNotice(`De Food Marketing Machine kon niet worden geladen: ${itemError.message}`); setLoading(false); return;
    }
    const ids = (nextItems || []).map((item) => item.id);
    let nextMedia = [];
    if (ids.length) {
      const { data, error } = await supabase.from("food_marketing_media")
        .select("id,item_id,storage_path,public_url,file_name,media_kind,media_role,orientation,status,note,created_at")
        .eq("workspace_id", workspaceId)
        .in("item_id", ids)
        .order("created_at", { ascending: false });
      if (error) setNotice(`De mediabibliotheek kon niet volledig worden geladen: ${error.message}`);
      else nextMedia = data || [];
    }
    setItems(nextItems || []);
    setMedia(nextMedia);
    setSelectedId((current) => current && (nextItems || []).some((item) => item.id === current) ? current : nextItems?.[0]?.id || "");
    setLoading(false);
  }, [businessId, workspaceId]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => { setDraft(draftFrom(selected)); }, [selectedId, selected?.updated_at]);

  const visibleItems = useMemo(() => {
    const query = search.trim().toLocaleLowerCase("nl-NL");
    return items.filter((item) => (classFilter === "all" || item.marketing_class === classFilter)
      && (!query || [item.name, item.category, item.primary_usp, item.target_audience].some((value) => String(value || "").toLocaleLowerCase("nl-NL").includes(query))));
  }, [classFilter, items, search]);

  function change(key, value) { setDraft((current) => ({ ...current, [key]: value })); }
  function toggleMoment(value) {
    setDraft((current) => ({ ...current, service_moments: current.service_moments.includes(value)
      ? current.service_moments.filter((item) => item !== value)
      : [...current.service_moments, value] }));
  }

  async function startFromRecipe() {
    const recipe = scopedRecipes.find((item) => item.id === recipeToStart);
    if (!recipe) return setNotice("Kies eerst een gerecht uit de recepturen.");
    setSaving(true); setNotice("");
    const { data, error } = await supabase.from("food_marketing_items").insert({
      workspace_id: workspaceId,
      business_id: recipe.business_id,
      location_id: recipe.location_id || null,
      recipe_id: recipe.id,
      name: recipe.name,
      category: recipe.category || null,
      selling_price: recipe.selling_price ?? null,
    }).select("id").maybeSingle();
    setSaving(false);
    if (error) return setNotice(error.code === "23505" ? "Dit gerecht heeft al een marketingprofiel." : `Aanmaken is niet gelukt: ${error.message}`);
    setRecipeToStart("");
    await load();
    setSelectedId(data.id);
    setNotice(`Marketingprofiel voor ${recipe.name} is klaargezet.`);
  }

  async function addManualDish() {
    const targetBusinessId = businessId === "all" ? businesses[0]?.id : businessId;
    if (!targetBusinessId) return setNotice("Kies eerst een vestiging bovenaan.");
    setSaving(true); setNotice("");
    const { data, error } = await supabase.from("food_marketing_items").insert({ workspace_id: workspaceId, business_id: targetBusinessId, name: "Nieuw gerecht" }).select("id").maybeSingle();
    setSaving(false);
    if (error) return setNotice(`Aanmaken is niet gelukt: ${error.message}`);
    await load(); setSelectedId(data.id); setNotice("Leeg marketingprofiel aangemaakt. Geef het gerecht nu een naam en basisinformatie.");
  }

  async function save() {
    if (!selected) return;
    const name = draft.name.trim();
    if (!name) return setNotice("Vul minimaal de naam van het gerecht in.");
    const sellingPrice = draft.selling_price === "" ? null : numberOrNull(draft.selling_price);
    const costPrice = draft.cost_price === "" ? null : numberOrNull(draft.cost_price);
    const priority = draft.priority_score === "" ? null : numberOrNull(draft.priority_score);
    if ((draft.selling_price !== "" && sellingPrice === null) || (draft.cost_price !== "" && costPrice === null) || (draft.priority_score !== "" && priority === null)) return setNotice("Prijs, kostprijs en prioriteit moeten nul of hoger zijn.");
    setSaving(true); setNotice("");
    const { error } = await supabase.from("food_marketing_items").update({
      name,
      category: draft.category.trim() || null,
      short_description: draft.short_description.trim() || null,
      long_description: draft.long_description.trim() || null,
      selling_price: sellingPrice,
      cost_price: costPrice,
      active: draft.active,
      available_from: draft.available_from || null,
      available_until: draft.available_until || null,
      service_moments: draft.service_moments,
      marketing_class: draft.marketing_class,
      priority_score: priority,
      primary_usp: draft.primary_usp.trim() || null,
      target_audience: draft.target_audience.trim() || null,
      promotion_moments: draft.promotion_moments.trim() || null,
      call_to_action: draft.call_to_action.trim() || null,
      reservation_url: draft.reservation_url.trim() || null,
      landing_page_url: draft.landing_page_url.trim() || null,
      keywords: compactList(draft.keywords),
      hashtags: compactList(draft.hashtags),
      cross_sell_items: compactList(draft.cross_sell_items),
      upsell_items: compactList(draft.upsell_items),
    }).eq("id", selected.id).eq("workspace_id", workspaceId).eq("business_id", selected.business_id);
    setSaving(false);
    if (error) return setNotice(`Opslaan is niet gelukt: ${error.message}`);
    await load(); setNotice("Het marketingprofiel is opgeslagen. Er is niets gepland of gepubliceerd.");
  }

  async function uploadMedia(event) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file || !selected) return;
    if (!allowedTypes.has(file.type) || file.size > 50 * 1024 * 1024) return setNotice("Kies een JPG, PNG, WebP, MP4, WebM of MOV-bestand van maximaal 50 MB.");
    setUploading(true); setNotice("");
    const safeName = file.name.toLocaleLowerCase("nl-NL").replace(/[^a-z0-9._-]+/g, "-").slice(-100) || "media";
    const path = `${workspaceId}/${selected.business_id}/food-marketing/${selected.id}/${crypto.randomUUID()}-${safeName}`;
    const { error: uploadError } = await supabase.storage.from("marketing-assets").upload(path, file, { cacheControl: "31536000", contentType: file.type, upsert: false });
    if (uploadError) { setUploading(false); return setNotice(`Uploaden is niet gelukt: ${uploadError.message}`); }
    const publicUrl = supabase.storage.from("marketing-assets").getPublicUrl(path).data.publicUrl;
    const { error: saveError } = await supabase.from("food_marketing_media").insert({
      workspace_id: workspaceId, business_id: selected.business_id, item_id: selected.id, storage_path: path, public_url: publicUrl,
      file_name: file.name, media_kind: file.type.startsWith("video/") ? "video" : "image", media_role: selectedMedia.length ? "extra" : "main",
      orientation: "unknown", status: "new", uploaded_by: session?.user?.id || null,
    });
    if (saveError) {
      await supabase.storage.from("marketing-assets").remove([path]);
      setUploading(false); return setNotice(`De mediaregistratie is niet gelukt: ${saveError.message}`);
    }
    setUploading(false); await load(); setNotice("Media staat bij dit gerecht als ‘Nieuw’. Beoordeel het voordat je het gebruikt.");
  }

  async function updateMedia(mediaItem, patch) {
    const { error } = await supabase.from("food_marketing_media").update(patch).eq("id", mediaItem.id).eq("workspace_id", workspaceId).eq("business_id", selected.business_id);
    if (error) return setNotice(`Media wijzigen is niet gelukt: ${error.message}`);
    await load();
  }

  const heroCount = items.filter((item) => item.marketing_class === "hero").length;
  const profitCount = items.filter((item) => item.marketing_class === "profit").length;
  const approvedMedia = media.filter((item) => item.status === "approved" || item.status === "used").length;

  return <section>
    <section className="pageIntro"><p className="eyebrow">FOOD MARKETING MACHINE</p><h2>Gerechten als basis voor marketing</h2><p>Leg per gerecht de tekst, marge en herbruikbare media vast. Horeca OS plaatst, plant of besteedt hier niets automatisch.</p></section>
    <section className="kpis">
      <div className="kpiCard"><span>Marketingprofielen</span><strong>{items.length}</strong><small>gerechten en dranken</small></div>
      <div className="kpiCard"><span>HERO</span><strong>{heroCount}</strong><small>extra zichtbaarheid</small></div>
      <div className="kpiCard"><span>PROFIT</span><strong>{profitCount}</strong><small>marge en besteding</small></div>
      <div className="kpiCard"><span>Goedgekeurde media</span><strong>{approvedMedia}</strong><small>klaar voor later gebruik</small></div>
    </section>
    {!canManage && <section className="notice warning">Je kunt de profielen bekijken, maar alleen Marketing of een beheerder kan ze wijzigen.</section>}
    {notice && <section className="notice">{notice}</section>}
    <section className="panel" style={{ marginBottom: 16 }}>
      <div className="panelHead"><div><h3>Start met een gerecht</h3><p>Koppel eerst een bestaande receptuur, of voeg een gerecht toe dat nog niet in de recepturen staat.</p></div></div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 10, alignItems: "end" }}>
        <label style={{ minWidth: 280, flex: "1 1 320px" }}>Bestaande receptuur<select value={recipeToStart} onChange={(event) => setRecipeToStart(event.target.value)} disabled={!canManage || saving}><option value="">Kies een gerecht…</option>{scopedRecipes.map((recipe) => <option key={recipe.id} value={recipe.id}>{recipe.name}{recipe.category ? ` · ${recipe.category}` : ""}</option>)}</select></label>
        <button type="button" className="primaryButton" onClick={startFromRecipe} disabled={!canManage || saving || !recipeToStart}>{saving ? "Bezig…" : "Marketingprofiel maken"}</button>
        <button type="button" className="secondaryButton" onClick={addManualDish} disabled={!canManage || saving}>Nieuw gerecht zonder receptuur</button>
      </div>
    </section>
    <section style={{ display: "grid", gridTemplateColumns: "minmax(260px, .8fr) minmax(0, 2fr)", gap: 16, alignItems: "start" }}>
      <aside className="panel">
        <div className="panelHead"><div><h3>Gerechten</h3><p>Kies een marketingprofiel.</p></div></div>
        <label>Zoeken<input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Naam, categorie of USP" /></label>
        <label>Type<select value={classFilter} onChange={(event) => setClassFilter(event.target.value)}><option value="all">Alle types</option><option value="hero">HERO</option><option value="profit">PROFIT</option><option value="supporting">SUPPORTING</option></select></label>
        <div style={{ display: "grid", gap: 8, marginTop: 14 }}>{loading ? <p>Gerechten laden…</p> : visibleItems.map((item) => <button type="button" key={item.id} onClick={() => setSelectedId(item.id)} style={{ textAlign: "left", padding: 12, borderRadius: 10, border: item.id === selectedId ? "2px solid #1f8a9d" : "1px solid #d5e2e8", background: item.id === selectedId ? "#eef8fa" : "#fff", cursor: "pointer" }}><strong style={{ display: "block", marginBottom: 5 }}>{item.name}</strong><span style={{ display: "flex", justifyContent: "space-between", gap: 8, alignItems: "center" }}>{classBadge(item.marketing_class)}<small>{item.category || "Geen categorie"}</small></span></button>)}{!loading && !visibleItems.length && <p>Maak hierboven het eerste marketingprofiel.</p>}</div>
      </aside>
      <div>{selected ? <FoodProfileEditor item={selected} draft={draft} media={selectedMedia} onChange={change} onToggleMoment={toggleMoment} onSave={save} saving={saving} canManage={canManage} onUpload={uploadMedia} uploading={uploading} onUpdateMedia={updateMedia} /> : <section className="panel"><h3>Nog geen gerecht gekozen</h3><p>Maak bovenaan een marketingprofiel vanuit een receptuur, of voeg een nieuw gerecht toe.</p></section>}</div>
    </section>
  </section>;
}

function FoodProfileEditor({ item, draft, media, onChange, onToggleMoment, onSave, saving, canManage, onUpload, uploading, onUpdateMedia }) {
  const margin = itemMargin({ selling_price: draft.selling_price, cost_price: draft.cost_price });
  return <section className="panel">
    <div className="panelHead"><div><p className="eyebrow">MARKETINGPROFIEL</p><h3>{item.name}</h3><p>{item.recipe_id ? "Gekoppeld aan een bestaande receptuur." : "Handmatig marketingprofiel."}</p></div>{classBadge(draft.marketing_class)}</div>
    <div className="formGrid">
      <label>Naam gerecht *<input value={draft.name} onChange={(event) => onChange("name", event.target.value)} disabled={!canManage} /></label>
      <label>Categorie<input value={draft.category} onChange={(event) => onChange("category", event.target.value)} placeholder="Bijvoorbeeld hoofdgerecht" disabled={!canManage} /></label>
      <label>Verkoopprijs<input inputMode="decimal" value={draft.selling_price} onChange={(event) => onChange("selling_price", event.target.value)} placeholder="0,00" disabled={!canManage} /></label>
      <label>Kostprijs<input inputMode="decimal" value={draft.cost_price} onChange={(event) => onChange("cost_price", event.target.value)} placeholder="0,00" disabled={!canManage} /></label>
      <div className="notice" style={{ margin: 0, alignSelf: "end" }}><strong>Brutomarge</strong><br />{margin === null ? "Vul verkoopprijs en kostprijs in." : euro(margin)}</div>
      <label>Marketingtype<select value={draft.marketing_class} onChange={(event) => onChange("marketing_class", event.target.value)} disabled={!canManage}><option value="hero">HERO — nieuwe gasten trekken</option><option value="profit">PROFIT — marge verhogen</option><option value="supporting">SUPPORTING — basiszichtbaarheid</option></select></label>
      <label>Handmatige prioriteit (0–100)<input type="number" min="0" max="100" value={draft.priority_score} onChange={(event) => onChange("priority_score", event.target.value)} placeholder="Later op basis van resultaten" disabled={!canManage} /></label>
      <label className="checkOption"><input type="checkbox" checked={draft.active} onChange={(event) => onChange("active", event.target.checked)} disabled={!canManage} />Beschikbaar voor marketing</label>
      <label>Beschikbaar vanaf<input type="date" value={draft.available_from} onChange={(event) => onChange("available_from", event.target.value)} disabled={!canManage} /></label>
      <label>Beschikbaar tot<input type="date" value={draft.available_until} onChange={(event) => onChange("available_until", event.target.value)} disabled={!canManage} /></label>
    </div>
    <fieldset style={{ marginTop: 16 }}><legend>Geschikte momenten</legend><div className="checkGrid">{serviceMoments.map((moment) => <label className="checkOption" key={moment}><input type="checkbox" checked={draft.service_moments.includes(moment)} onChange={() => onToggleMoment(moment)} disabled={!canManage} />{moment[0].toUpperCase() + moment.slice(1)}</label>)}</div></fieldset>
    <div className="formGrid" style={{ marginTop: 16 }}>
      <label className="wide">Korte omschrijving<textarea rows="3" value={draft.short_description} onChange={(event) => onChange("short_description", event.target.value)} placeholder="De kern voor een post, kaart of nieuwsbrief." disabled={!canManage} /></label>
      <label className="wide">Lange omschrijving<textarea rows="5" value={draft.long_description} onChange={(event) => onChange("long_description", event.target.value)} placeholder="Volledige beschrijving voor website of landingspagina." disabled={!canManage} /></label>
      <label>Belangrijkste USP<input value={draft.primary_usp} onChange={(event) => onChange("primary_usp", event.target.value)} placeholder="Bijvoorbeeld: langzaam gegaarde spareribs" disabled={!canManage} /></label>
      <label>Doelgroep<input value={draft.target_audience} onChange={(event) => onChange("target_audience", event.target.value)} placeholder="Bijvoorbeeld: vriendengroepen" disabled={!canManage} /></label>
      <label>Geschikte promotiemomenten<input value={draft.promotion_moments} onChange={(event) => onChange("promotion_moments", event.target.value)} placeholder="Bijvoorbeeld: donderdagavond, weekend" disabled={!canManage} /></label>
      <label>Call-to-action<input value={draft.call_to_action} onChange={(event) => onChange("call_to_action", event.target.value)} placeholder="Bijvoorbeeld: Reserveer je tafel" disabled={!canManage} /></label>
      <label>Reserveringslink<input type="url" value={draft.reservation_url} onChange={(event) => onChange("reservation_url", event.target.value)} placeholder="https://…" disabled={!canManage} /></label>
      <label>Landingspagina<input type="url" value={draft.landing_page_url} onChange={(event) => onChange("landing_page_url", event.target.value)} placeholder="https://…" disabled={!canManage} /></label>
      <label>Zoekwoorden<input value={draft.keywords} onChange={(event) => onChange("keywords", event.target.value)} placeholder="komma gescheiden" disabled={!canManage} /></label>
      <label>Hashtags<input value={draft.hashtags} onChange={(event) => onChange("hashtags", event.target.value)} placeholder="#caribbean, #zoetermeer" disabled={!canManage} /></label>
      <label>Cross-sell<input value={draft.cross_sell_items} onChange={(event) => onChange("cross_sell_items", event.target.value)} placeholder="Bijvoorbeeld: coleslaw, funchi fries" disabled={!canManage} /></label>
      <label>Upsell<input value={draft.upsell_items} onChange={(event) => onChange("upsell_items", event.target.value)} placeholder="Bijvoorbeeld: cocktail, dessert" disabled={!canManage} /></label>
    </div>
    <div className="formActions" style={{ marginTop: 16 }}><button type="button" className="primaryButton" onClick={onSave} disabled={!canManage || saving}>{saving ? "Opslaan…" : "Marketingprofiel opslaan"}</button><small>Opslaan bereidt alleen gegevens voor; er gebeurt extern niets.</small></div>
    <section style={{ marginTop: 26, borderTop: "1px solid #dce6ed", paddingTop: 18 }}>
      <div className="panelHead"><div><h3>Herbruikbare media</h3><p>Upload losse keukenfoto's of korte clips. Ze worden eerst beoordeeld voordat ze in content terechtkomen.</p></div></div>
      {canManage && <label className="secondaryButton" style={{ display: "inline-flex", width: "fit-content", cursor: uploading ? "wait" : "pointer" }}><input type="file" accept="image/jpeg,image/png,image/webp,video/mp4,video/webm,video/quicktime" onChange={onUpload} disabled={uploading} style={{ display: "none" }} />{uploading ? "Uploaden…" : "Foto of video toevoegen"}</label>}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(180px, 1fr))", gap: 12, marginTop: 14 }}>{media.map((asset) => <article key={asset.id} style={{ border: "1px solid #d5e2e8", borderRadius: 10, overflow: "hidden", background: "#fff" }}>{asset.media_kind === "video" ? <video src={asset.public_url} controls preload="metadata" style={{ display: "block", width: "100%", aspectRatio: "1 / 1", objectFit: "cover", background: "#172b36" }} /> : <img src={asset.public_url} alt={asset.file_name} style={{ display: "block", width: "100%", aspectRatio: "1 / 1", objectFit: "cover", background: "#eef4f6" }} />}<div style={{ padding: 10 }}><strong style={{ display: "block", fontSize: 13, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{asset.file_name}</strong><small>{asset.media_kind === "video" ? "Video" : "Foto"} · {asset.status}</small>{canManage && <><label style={{ marginTop: 8, fontSize: 12 }}>Status<select value={asset.status} onChange={(event) => onUpdateMedia(asset, { status: event.target.value })}><option value="new">Nieuw</option><option value="review">Te beoordelen</option><option value="approved">Goedgekeurd</option><option value="used">Gebruikt</option><option value="rejected">Afgekeurd</option></select></label><label style={{ marginTop: 8, fontSize: 12 }}>Gebruik<select value={asset.media_role} onChange={(event) => onUpdateMedia(asset, { media_role: event.target.value })}><option value="main">Hoofdmedia</option><option value="extra">Extra</option><option value="staff">Medewerker</option><option value="guest">Gast</option><option value="taste_crew">Taste Crew</option></select></label></>}</div></article>)}</div>
      {!media.length && <p>Nog geen media. Begin bijvoorbeeld met één goede foto of een korte verticale keukenclip.</p>}
    </section>
  </section>;
}
