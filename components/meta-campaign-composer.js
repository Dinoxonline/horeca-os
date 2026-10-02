"use client";

import { useEffect, useRef, useState } from "react";
import Image from "next/image";
import MetaAccountBudget from "./meta-account-budget";
import MetaPromotionPicker from "./meta-promotion-picker";
import MetaAudiencePicker from "./meta-audience-picker";
import { META_OBJECTIVES, META_CTA, defaultMetaCampaign, campaignImages, campaignImageForPlacement, campaignBudgetSummary, validateMetaCampaign, publicWebUrl } from "../lib/meta-campaign-settings";
import styles from "./meta-campaign-composer.module.css";

const euros = value => new Intl.NumberFormat("nl-NL", { style: "currency", currency: "EUR" }).format(value);
const countries = { NL: "Nederland", BE: "België", DE: "Duitsland", FR: "Frankrijk", ES: "Spanje", GB: "Verenigd Koninkrijk" };

export default function MetaCampaignComposer({ item, distribution, businessName, pageName, adAccountName, onCreate, onSearch, onCatalog, onUpdateSavedAudience, onDirty, busy, error, initialDraft, onDraftChange, budgetContext, lockToEvent = false }) {
  const [draft, setDraft] = useState(() => ({ ...defaultMetaCampaign(item, distribution), beneficiary: pageName || businessName || "", ...initialDraft, ...(lockToEvent ? { sourceKind: "new", sourceId: "", sourcePreview: null } : {}), editorVersion: 3 }));
  const draftListener = useRef(onDraftChange);
  useEffect(() => { draftListener.current = onDraftChange; }, [onDraftChange]);
  useEffect(() => { draftListener.current?.(draft); }, [draft]);
  const [step, setStep] = useState("campaign");
  const [previewPlatform, setPreviewPlatform] = useState("facebook");
  const [previewStory, setPreviewStory] = useState(false);
  const [localError, setLocalError] = useState("");
  const [searching, setSearching] = useState("");
  const [searchError, setSearchError] = useState("");
  const [locations, setLocations] = useState([]);
  const [interestQuery, setInterestQuery] = useState("");
  const [interestResults, setInterestResults] = useState([]);
  const [failedImage, setFailedImage] = useState("");
  const [previewImageRatio, setPreviewImageRatio] = useState(null);
  const [savedAudienceBusy, setSavedAudienceBusy] = useState(false);
  const [savedAudienceNotice, setSavedAudienceNotice] = useState("");
  const [savedAudienceEditorOpen, setSavedAudienceEditorOpen] = useState(false);
  const [savedAudienceOriginal, setSavedAudienceOriginal] = useState(null);
  const images = campaignImages(distribution);
  const defaultEventImage = campaignImageForPlacement(distribution, draft.placements);
  const budget = campaignBudgetSummary(draft);
  const platform = ["facebook", "instagram"].includes(draft.placements) ? draft.placements : previewPlatform;
  const story = draft.placementFormat === "story" || (draft.placementFormat !== "feed" && previewStory);
  const imageUrl = publicWebUrl(draft.imageUrl);
  useEffect(() => { setPreviewImageRatio(null); }, [imageUrl]);
  const destination = publicWebUrl(draft.destinationUrl);
  const mapQuery = [draft.locationQuery, countries[draft.countries[0]]].filter(Boolean).join(", ");
  const mapZoom = Math.max(8, Math.min(13, Math.round(15 - Math.log2(Math.max(1, Number(draft.radiusKm || 25))))));
  const identity = platform === "facebook" ? (pageName || businessName) : businessName;
  const existingPost = ["facebook_posts", "instagram_posts"].includes(draft.sourceKind);
  const chosenSource = draft.sourceKind !== "new";
  function updateMany(values) { setDraft(current => ({ ...current, ...values })); setLocalError(""); onDirty?.(true); }
  function update(name, value) { setDraft(current => ({ ...current, [name]: value })); setLocalError(""); onDirty?.(true); }
  async function search(resource) {
    const query = resource === "locations" ? draft.locationQuery : interestQuery;
    if (query.trim().length < 2) { setSearchError("Vul minimaal twee letters in om te zoeken."); return; }
    setSearching(resource); setSearchError("");
    try {
      const result = await onSearch(resource, query.trim(), draft.countries[0]);
      if (resource === "locations") setLocations(result); else setInterestResults(result);
      if (!result.length) setSearchError("Meta geeft geen resultaten terug. Probeer een andere zoekterm.");
    } catch (failure) { setSearchError(failure.message || "Zoeken bij Meta is niet gelukt."); }
    finally { setSearching(""); }
  }
  function submit() {
    const invalid = validateMetaCampaign(draft);
    if (invalid) { setLocalError(invalid); return; }
    if (draft.audienceMode !== "saved" && draft.locationQuery.trim() && !draft.locationKey) { setStep("audience"); setLocalError("Zoek de plaats en kies een stad uit de Meta-resultaten."); return; }
    onCreate({ ...draft, startAt: new Date(draft.startAt).toISOString(), endAt: new Date(draft.endAt).toISOString(), editorVersion: 3, launchStatus: "paused" });
  }
  async function updateSavedAudience() {
    if (!onUpdateSavedAudience || !draft.savedAudienceId) return;
    if (draft.locationQuery.trim() && !draft.locationKey) { setSearchError("Zoek de plaats en kies de juiste stad uit de Meta-resultaten."); return; }
    setSavedAudienceBusy(true); setSavedAudienceNotice(""); setSearchError("");
    try {
      const result = await onUpdateSavedAudience(draft);
      updateMany({ savedAudiencePreview: result.targeting || draft.savedAudiencePreview, savedAudienceLocationFromName: false });
      setSavedAudienceNotice("De opgeslagen doelgroep is bijgewerkt in Meta.");
      setSavedAudienceOriginal(null); setSavedAudienceEditorOpen(false); setLocations([]);
    } catch (failure) { setSearchError(failure.message || "De opgeslagen doelgroep kon niet in Meta worden bijgewerkt."); }
    finally { setSavedAudienceBusy(false); }
  }
  function openSavedAudienceEditor() {
    setSavedAudienceOriginal({ countries: draft.countries, locationQuery: draft.locationQuery, locationKey: draft.locationKey, savedAudienceLocationFromName: draft.savedAudienceLocationFromName, radiusKm: draft.radiusKm, ageMin: draft.ageMin, ageMax: draft.ageMax, gender: draft.gender });
    setSavedAudienceNotice(""); setSearchError(""); setSavedAudienceEditorOpen(true);
  }
  function closeSavedAudienceEditor() {
    if (savedAudienceOriginal) updateMany(savedAudienceOriginal);
    setSavedAudienceOriginal(null); setSavedAudienceEditorOpen(false); setLocations([]); setSearchError("");
  }
  const field = (label, name, options = {}) => <label className={styles.field}>{label}<input {...options} value={draft[name]} disabled={busy} onChange={event => update(name, event.target.value)} /></label>;

  return <section className={styles.editor} aria-label="Meta-campagne instellen">
    <header className={styles.header}><div><span className={styles.eyebrow}>META · CAMPAGNE-EDITOR</span><h3>Maak je advertentie</h3><p>{businessName} · {adAccountName}</p></div><span className={styles.badge}>Gepauzeerd concept</span></header>
    <div className={styles.safeNotice}>Je stelt de campagne hier in. Pas na je bevestiging maken we een gepauzeerd concept in Meta. Er wordt nu geen budget besteed.</div>
    <div className={styles.layout}>
      <div className={styles.workspace}>
        <nav className={styles.steps} aria-label="Campagneonderdelen">
          {[["campaign", "1", "Campagne en bron"], ["audience", "2", "Doelgroep en plaatsingen"], ["creative", "3", "Advertentie"]].map(([key, number, label]) => <button key={key} type="button" aria-current={step === key ? "step" : undefined} onClick={() => setStep(key)}><span>{number}</span>{label}</button>)}
        </nav>
        <div className={styles.body}>
          {step === "campaign" && <>
            {lockToEvent
              ? <section className={styles.picker} aria-label="Advertentiebron"><h4>Je promoot dit evenement</h4><p><strong>{distribution.common?.title || item.body || "Dit evenement"}</strong></p><p className={styles.help}>Tekst en ticketlink komen uit dit evenement. Voor Facebook en Instagram gebruiken we standaard het staande posterbeeld; je kunt dit in stap 3 wijzigen.</p></section>
              : <MetaPromotionPicker draft={draft} onChange={updateMany} onCatalog={onCatalog} busy={busy} />}
            <div className={styles.sectionHeading}><h4>Campagne en doel</h4><p>Wat wil je met deze advertentie bereiken?</p></div>
            {field("Campagnenaam", "campaignName", { maxLength: 150 })}
            <fieldset className={styles.objectives}><legend>Campagnedoel</legend>{Object.entries(META_OBJECTIVES).map(([key, value]) => <label key={key} className={draft.objective === key ? styles.selectedObjective : ""}><input type="radio" name={`meta-objective-${item.id}`} checked={draft.objective === key} disabled={busy || chosenSource} onChange={() => update("objective", key)} /><span><strong>{value.label}</strong><small>{value.detail}</small></span></label>)}</fieldset>
            {chosenSource && <p className={styles.help}>Het doel volgt de gekozen bron: betrokkenheid voor berichten, verkeer voor de evenementpagina.</p>}
            <button type="button" className={styles.audienceJump} onClick={() => setStep("audience")}>Doelgroep kiezen of aanpassen →</button>
            <div className={styles.sectionHeading}><h4>Budget en looptijd</h4><p>Het budget geldt voor deze campagne, niet voor de hele vestiging.</p></div>
            {budgetContext && <MetaAccountBudget {...budgetContext} plannedBudget={budget.estimate} />}
            <div className={styles.fields}>
              <label className={styles.field}>Budgettype<select value={draft.budgetType} disabled={busy} onChange={event => update("budgetType", event.target.value)}><option value="daily">Dagbudget</option><option value="lifetime">Totaalbudget voor de looptijd</option></select></label>
              {field(draft.budgetType === "daily" ? "Dagbudget (€)" : "Totaalbudget (€)", "dailyBudget", { type: "number", min: 2, step: "0.01" })}
              {field("Start", "startAt", { type: "datetime-local" })}{field("Einde", "endAt", { type: "datetime-local" })}
            </div>
            <p className={styles.help}>Tijden volgen de tijdzone van je apparaat. Deze editor ondersteunt advertentieaccounts in EUR.</p>
            <div className={styles.budget}><strong>{budget.estimate === null ? "Kies een geldige looptijd" : `${budget.fixed ? "Totaalbudget" : "Budgetindicatie"}: ${euros(budget.estimate)}`}</strong><p>{budget.fixed ? "Dit is het gekozen advertentiebudget voor de volledige looptijd." : "Dagbudget × afgeronde looptijd. Dit is geen harde bestedingslimiet: Meta kan daguitgaven verdelen. Kies totaalbudget voor een vast looptijdbudget."}</p></div>
            <label className={styles.field}>Speciale advertentiecategorie<select disabled={busy} value={draft.specialCategory} onChange={event => update("specialCategory", event.target.value)}><option value="none">Geen — regulier horeca-aanbod of evenement</option><option value="employment">Werkgelegenheid</option><option value="housing">Huisvesting</option><option value="finance">Financiële producten en diensten</option><option value="politics">Maatschappelijke kwesties, verkiezingen of politiek</option></select></label>
            {draft.specialCategory !== "none" && <p className={styles.error} role="alert">Deze categorie vraagt aanvullende Meta-instellingen. Aanmaken vanuit Horeca OS is geblokkeerd. <a href="https://www.facebook.com/adsmanager/" target="_blank" rel="noreferrer">Verder in Meta ↗</a></p>}
            <div className={styles.sectionHeading}><h4>Adverteerder en betaler</h4><p>Wie profiteert van de advertentie, en wie betaalt? Deze namen worden naar Meta gestuurd voor advertentietransparantie. Dit wijzigt je betaalmethode niet.</p></div>
            {field("Adverteerder (begunstigde)", "beneficiary", { maxLength: 200 })}
            {field("Betaler", "payer", { maxLength: 200, placeholder: "Naam van de betalende persoon of onderneming" })}
            <button type="button" disabled={busy} onClick={() => update("payer", draft.beneficiary)}>Betaler is dezelfde als adverteerder</button>
          </>}
          {step === "audience" && <>
            <div className={styles.sectionHeading}><h4>Doelgroep</h4><p>Bepaal waar en aan wie je advertentie wordt getoond.</p></div>
            <MetaAudiencePicker draft={draft} onChange={updateMany} onCatalog={onCatalog} busy={busy || savedAudienceBusy} />
            {draft.audienceMode === "saved" && draft.savedAudienceId && <>
              <section className={styles.audienceEditCard} aria-label="Opgeslagen Meta-doelgroep">
                <div><strong>{draft.savedAudienceName}</strong><small>{draft.locationQuery || "Heel " + (countries[draft.countries[0]] || "land")}{draft.savedAudienceLocationFromName ? " (volgens naam)" : ""} · {draft.radiusKm} km · {draft.ageMin}–{Number(draft.ageMax) >= 65 ? "65+" : draft.ageMax} jaar · {draft.gender === "women" ? "vrouwen" : draft.gender === "men" ? "mannen" : "iedereen"}</small></div>
                <button type="button" disabled={busy || savedAudienceBusy} onClick={openSavedAudienceEditor}>Doelgroep bewerken</button>
              </section>
              {savedAudienceNotice && <p className={styles.success} role="status">{savedAudienceNotice}</p>}
            </>}
            {draft.audienceMode !== "saved" && <>
            {draft.audienceMode === "advantage" && <p className={styles.safeNotice}>Advantage+: interesses, geslacht en maximumleeftijd kunnen als suggesties worden gebruikt, niet als vaste grenzen. Controleer de uiteindelijke doelgroep in Meta vóór activeren.</p>}
            <label className={styles.field}>Land<select disabled={busy} value={draft.countries[0]} onChange={event => { update("countries", [event.target.value]); update("locationKey", ""); setLocations([]); }}>{Object.entries(countries).map(([code, label]) => <option key={code} value={code}>{label}</option>)}</select></label>
            <label className={styles.field}>Plaats (leeg = heel land)<div className={styles.search}><input value={draft.locationQuery} disabled={busy} placeholder="Bijvoorbeeld Zoetermeer" onChange={event => { update("locationQuery", event.target.value); update("locationKey", ""); setLocations([]); }} /><button type="button" disabled={busy || Boolean(searching)} onClick={() => search("locations")}>{searching === "locations" ? "Zoeken…" : "Zoek plaats"}</button></div></label>
            {locations.length > 0 && <label className={styles.field}>Kies de plaats uit Meta<select disabled={busy} value={draft.locationKey} onChange={event => { const chosen = locations.find(location => location.key === event.target.value); update("locationKey", chosen?.key || ""); if (chosen) update("locationQuery", chosen.name); }}><option value="">Selecteer een plaats</option>{locations.map(location => <option key={location.key} value={location.key}>{location.name} · {location.region} · {location.country}</option>)}</select></label>}
            <div className={styles.fields}>
              {field("Straal rond de plaats (km)", "radiusKm", { type: "number", min: 1, max: 80 })}
              <label className={styles.field}>Geslacht<select value={draft.gender} disabled={busy} onChange={event => update("gender", event.target.value)}><option value="all">Iedereen</option><option value="women">Vrouwen</option><option value="men">Mannen</option></select></label>
              {field("Minimumleeftijd", "ageMin", { type: "number", min: 18, max: 65 })}
              <label className={styles.field}>Maximumleeftijd<select disabled={busy} value={draft.ageMax} onChange={event => update("ageMax", event.target.value)}>{Array.from({ length: 48 }, (_, index) => index + 18).map(age => <option key={age} value={age}>{age === 65 ? "65+" : age}</option>)}</select></label>
            </div>
            <label className={styles.field}>Interesses (optioneel)<div className={styles.search}><input disabled={busy} value={interestQuery} placeholder="Bijvoorbeeld live muziek" onChange={event => { setInterestQuery(event.target.value); setInterestResults([]); }} /><button type="button" disabled={busy || Boolean(searching)} onClick={() => search("interests")}>{searching === "interests" ? "Zoeken…" : "Zoek interesse"}</button></div></label>
            {interestResults.length > 0 && <div className={styles.searchResults} aria-label="Meta-interesses">{interestResults.filter(interest => !draft.interests.some(chosen => chosen.id === interest.id)).map(interest => <button type="button" key={interest.id} disabled={busy || draft.interests.length >= 10} onClick={() => update("interests", [...draft.interests, interest])}>+ {interest.name}</button>)}</div>}
            <div className={styles.chips}>{draft.interests.map(interest => <button type="button" key={interest.id} disabled={busy} aria-label={`${interest.name} verwijderen`} onClick={() => update("interests", draft.interests.filter(chosen => chosen.id !== interest.id))}>{interest.name} ×</button>)}</div>
            <p className={styles.help}>Zonder interesses gebruik je een brede doelgroep binnen je locatie en leeftijd. Meta bepaalt de uiteindelijke levering; dit scherm toont geen geschat bereik.</p>
            {searchError && <p className={styles.error} role="alert">{searchError}</p>}
            </>}
            <div className={styles.sectionHeading}><h4>Plaatsingen</h4><p>Kies op welke kanalen je zichtbaar wilt zijn.</p></div>
            <div className={styles.fields}>
              <label className={styles.field}>Kanalen<select disabled={busy || existingPost} value={draft.placements} onChange={event => { const placements = event.target.value; const currentDefault = campaignImageForPlacement(distribution, draft.placements); updateMany({ placements, ...(!existingPost && defaultEventImage?.url && draft.imageUrl === currentDefault?.url ? { imageUrl: campaignImageForPlacement(distribution, placements)?.url || draft.imageUrl } : {}) }); }}><option value="both">Facebook en Instagram</option><option value="facebook">Alleen Facebook</option><option value="instagram">Alleen Instagram</option></select></label>
              <label className={styles.field}>Plaatsingen<select disabled={busy || existingPost} value={draft.placementFormat} onChange={event => update("placementFormat", event.target.value)}><option value="feed">Feeds</option><option value="story">Stories</option><option value="feed_story">Feeds en Stories</option><option value="automatic">Meta kiest binnen deze kanalen</option></select></label>
            </div>
            <p className={styles.help}>Stories en Instagram worden hier op mobiel gericht. Gebruik Meta Ads Manager voor afzonderlijke Reels-instellingen en plaatsingsspecifieke beelden.</p>
          </>}
          {step === "creative" && <>
            <div className={styles.sectionHeading}><h4>Identiteit en advertentie</h4><p>De gekoppelde pagina van {businessName} blijft de afzender.</p></div>
            <div className={styles.identity}><span className={styles.avatar}>{(businessName || "H").slice(0, 1)}</span><div><strong>{pageName || businessName}</strong><small>Facebookpagina van deze vestiging · Instagram wordt bij Meta gecontroleerd</small></div></div>
            {existingPost ? <div className={styles.budget}><strong>Bestaand bericht: {draft.sourcePreview?.name || "Nog niet gekozen"}</strong><p>De oorspronkelijke tekst, foto, video of carrousel blijft behouden. Het voorbeeld toont alleen een samenvatting / stilstaand beeld.</p>{draft.sourcePreview?.url && <a href={draft.sourcePreview.url} target="_blank" rel="noreferrer">Origineel bekijken ↗</a>}<button type="button" onClick={() => setStep("campaign")}>Ander bericht kiezen</button></div> : <>
            <label className={styles.field}>Advertentietekst<textarea rows={5} maxLength={2200} disabled={busy} value={draft.primaryText} onChange={event => update("primaryText", event.target.value)} /><small>{draft.primaryText.length}/2.200 tekens</small></label>
            {field("Kop", "headline", { maxLength: 100 })}{field("Beschrijving (optioneel)", "description", { maxLength: 200 })}
            <div className={styles.sectionHeading}><h4>Afbeelding</h4><p>Kies een evenementbeeld of gebruik een openbare afbeeldingslink.</p></div>
            {images.length > 0 && <div className={styles.imageChoices}>{images.map(image => <button type="button" key={image.url} disabled={busy} aria-pressed={draft.imageUrl === image.url} onClick={() => update("imageUrl", image.url)}>{image.label}</button>)}</div>}
            {field("Afbeeldingslink", "imageUrl", { type: "url", placeholder: "https://…/afbeelding.jpg" })}
            <p className={styles.help}>Eén afbeelding per advertentie. Voor Stories is een staand beeld geschikt. Meta kan het beeld per plaatsing anders uitsnijden.</p>
            {draft.sourceKind === "facebook_events" ? <p>Bestemming: de gekozen Facebook-evenementpagina. <a href={draft.sourcePreview?.url} target="_blank" rel="noreferrer">Evenement bekijken ↗</a></p> : field("Website- of ticketlink", "destinationUrl", { type: "url", placeholder: "https://…" })}
            <label className={styles.field}>Actieknop<select disabled={busy} value={draft.callToAction} onChange={event => update("callToAction", event.target.value)}>{Object.entries(META_CTA).map(([key, value]) => <option value={key} key={key}>{value.label}</option>)}</select></label>
            </>}
          </>}
          <div className={styles.navigation}><button type="button" disabled={step === "campaign" || busy} onClick={() => setStep(step === "creative" ? "audience" : "campaign")}>Vorige</button>{step !== "creative" && <button type="button" className={styles.primary} onClick={() => setStep(step === "campaign" ? "audience" : "creative")}>Volgende</button>}</div>
        </div>
      </div>
      <aside className={styles.previewColumn} aria-label="Advertentievoorbeeld">
        <div className={styles.previewHeading}><h4>Advertentievoorbeeld</h4><span>Indicatief</span></div>
        <div className={styles.previewTabs} aria-label="Voorbeeldkanaal">{["facebook", "instagram"].filter(channel => draft.placements === "both" || draft.placements === "automatic" || draft.placements === channel).map(channel => <button type="button" key={channel} aria-pressed={platform === channel} onClick={() => setPreviewPlatform(channel)}>{channel === "facebook" ? "Facebook" : "Instagram"}</button>)}</div>
        {["automatic", "feed_story"].includes(draft.placementFormat) && <div className={styles.previewTabs}><button type="button" aria-pressed={!story} onClick={() => setPreviewStory(false)}>Feed</button><button type="button" aria-pressed={story} onClick={() => setPreviewStory(true)}>Story</button></div>}
        <div className={`${styles.adCard} ${story ? styles.story : ""}`}>
          <div className={styles.adIdentity}><span className={styles.avatar}>{(identity || "H").slice(0, 1)}</span><div><strong>{identity || "Jouw vestiging"}</strong><small>Gesponsord · {platform === "facebook" ? "Facebook" : "Instagram"}</small></div><span aria-hidden="true">···</span></div>
          {!story && <p className={styles.adText}>{draft.primaryText || "Je advertentietekst verschijnt hier."}</p>}
          <div className={styles.adImage} style={!story && previewImageRatio ? { aspectRatio: String(previewImageRatio) } : undefined}>{imageUrl && failedImage !== imageUrl ? <Image src={imageUrl} alt="Gekozen advertentiebeeld" fill unoptimized sizes="(max-width: 800px) 90vw, 340px" onLoad={event => { const { naturalWidth, naturalHeight } = event.currentTarget; if (naturalWidth && naturalHeight) setPreviewImageRatio(naturalWidth / naturalHeight); }} onError={() => setFailedImage(imageUrl)} /> : <span>{imageUrl ? "Afbeelding niet te laden — controleer de link" : "Kies een afbeelding bij Advertentie"}</span>}</div>
          {!existingPost && <div className={styles.adLink}><div><small>{destination ? new URL(destination).hostname : "JOUW WEBSITE"}</small><strong>{draft.headline || "Kop van je advertentie"}</strong>{draft.description && <p>{draft.description}</p>}</div><span className={styles.fakeCta}>{META_CTA[draft.callToAction]?.label}</span></div>}
          {!story && <div className={styles.adActions} aria-hidden="true">{platform === "facebook" ? "Vind ik leuk  ·  Reageren  ·  Delen" : "♡   ◯   ↗"}</div>}
        </div>
        <p className={styles.help}>Benadering van de gekozen plaatsing, geen officieel Meta-voorbeeld. Uitsnede, profielnaam, tekstweergave en knop kunnen afwijken. Controleer het definitieve concept in Meta.</p>
      </aside>
    </div>
    {savedAudienceEditorOpen && <div className={styles.audienceModalBackdrop} role="presentation">
      <section className={styles.audienceModal} role="dialog" aria-modal="true" aria-label="Doelgroep bewerken">
        <header className={styles.audienceModalHeader}><h3>Doelgroep bewerken</h3><button type="button" aria-label="Doelgroep bewerken sluiten" disabled={savedAudienceBusy} onClick={closeSavedAudienceEditor}>×</button></header>
        <div className={styles.audienceModalBody}>
          <div className={styles.ageRange} aria-label="Leeftijdsbereik"><span>{draft.ageMin}</span><div><input type="range" min={18} max={65} value={draft.ageMin} disabled={busy || savedAudienceBusy} onChange={event => update("ageMin", Math.min(Number(event.target.value), Number(draft.ageMax)))} /><input type="range" min={18} max={65} value={draft.ageMax} disabled={busy || savedAudienceBusy} onChange={event => update("ageMax", Math.max(Number(event.target.value), Number(draft.ageMin)))} /></div><span>{Number(draft.ageMax) >= 65 ? "65+" : draft.ageMax}</span></div>
          <div className={styles.audienceFields}>
            <label className={styles.field}>Land<select disabled={busy || savedAudienceBusy} value={draft.countries[0]} onChange={event => { update("countries", [event.target.value]); update("locationKey", ""); setLocations([]); }}>{Object.entries(countries).map(([code, label]) => <option key={code} value={code}>{label}</option>)}</select></label>
            <label className={styles.field}>Geslacht<select value={draft.gender} disabled={busy || savedAudienceBusy} onChange={event => update("gender", event.target.value)}><option value="all">Iedereen</option><option value="women">Vrouwen</option><option value="men">Mannen</option></select></label>
          </div>
          <label className={styles.field}>Locaties<div className={styles.search}><input value={draft.locationQuery} disabled={busy || savedAudienceBusy} placeholder="Typ om een plaats toe te voegen" onChange={event => { updateMany({ locationQuery: event.target.value, locationKey: "", savedAudienceLocationFromName: false }); setLocations([]); }} /><button type="button" disabled={busy || savedAudienceBusy || Boolean(searching)} onClick={() => search("locations")}>{searching === "locations" ? "Zoeken…" : "Zoek plaats"}</button></div></label>
          {draft.savedAudienceLocationFromName && <p className={styles.modalHelp}>Meta gaf de locatie niet terug. {draft.locationQuery} komt uit de naam van deze doelgroep. Zoek en kies deze plaats in Meta voordat je opslaat.</p>}
          {draft.locationQuery && <div className={styles.locationChip}>{draft.locationQuery}{draft.locationKey ? ` · ${draft.radiusKm} km` : ""}</div>}
          {mapQuery && <div className={styles.audienceMap}><iframe title="Kaart van de doelgroep" src={`https://maps.google.com/maps?q=${encodeURIComponent(mapQuery)}&z=${mapZoom}&output=embed`} loading="lazy" /><div className={styles.mapRadius} aria-hidden="true" style={{ width: `${Math.min(68, Math.max(24, 16 + Number(draft.radiusKm || 25) * 0.8))}%` }} /><span>Gekozen locatie · straal {draft.radiusKm} km</span></div>}
          {locations.length > 0 && <label className={styles.field}>Kies de plaats uit Meta<select disabled={busy || savedAudienceBusy} value={draft.locationKey} onChange={event => { const chosen = locations.find(location => location.key === event.target.value); updateMany({ locationKey: chosen?.key || "", ...(chosen ? { locationQuery: chosen.name, savedAudienceLocationFromName: false } : {}) }); }}><option value="">Selecteer een plaats</option>{locations.map(location => <option key={location.key} value={location.key}>{location.name} · {location.region} · {location.country}</option>)}</select></label>}
          <label className={styles.rangeLabel}>Straal rond de plaats <strong>{draft.radiusKm} km</strong><input type="range" min={1} max={80} value={draft.radiusKm} disabled={busy || savedAudienceBusy} onChange={event => update("radiusKm", event.target.value)} /></label>
          <p className={styles.modalHelp}>Opslaan wijzigt deze bestaande Meta-doelgroep. Andere campagnes die deze doelgroep gebruiken, krijgen dezelfde aanpassing.</p>
          {searchError && <p className={styles.error} role="alert">{searchError}</p>}
        </div>
        <footer className={styles.audienceModalActions}><button type="button" disabled={savedAudienceBusy} onClick={closeSavedAudienceEditor}>Annuleren</button><button type="button" className={styles.primary} disabled={busy || savedAudienceBusy || !onUpdateSavedAudience} onClick={updateSavedAudience}>{savedAudienceBusy ? "Opslaan…" : "Doelgroep opslaan"}</button></footer>
      </section>
    </div>}
    <footer className={styles.footer}>
      {(localError || error) && <p className={styles.error} role="alert">{localError || error}</p>}
      <div><p>Wijzigingen worden bewaard bij het aanmaken van het Meta-concept.</p><button type="button" className={styles.primary} disabled={busy || Boolean(searching)} onClick={submit}>{busy ? "Meta-concept maken…" : "Controleren en concept maken"}</button></div>
      <details><summary>Meer mogelijkheden in Meta</summary><p>Nieuwe video- en carrouseladvertenties, evenementreacties (Geïnteresseerd/Gaat), conversies met pixel, leadformulieren, nieuwe klantdoelgroepen, A/B-tests en geavanceerde biedstrategieën stel je rechtstreeks in Meta Ads Manager in. Bestaande berichten en Reels kun je hierboven selecteren; Meta controleert of promotie is toegestaan.</p></details>
    </footer>
  </section>;
}
