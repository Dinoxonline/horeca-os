"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import NextImage from "next/image";
import { supabase } from "../lib/supabase";

const channelDefaults = {
  brevo: true, facebook: true, instagram: true, tiktok: false,
  whatsapp: false, google: true, predis: false,
};

const imageSlots = [
  { key: "landscape", label: "Liggend", width: 1200, height: 630, ratio: "1,91:1", channels: "Facebook, Google Bedrijfsprofiel en Brevo" },
  { key: "square", label: "Vierkant", width: 1080, height: 1080, ratio: "1:1", channels: "Instagram, Facebook en Predis" },
  { key: "portrait", label: "Staand bericht", width: 1080, height: 1350, ratio: "4:5", channels: "Instagram-feed" },
  { key: "vertical", label: "Story, Reel en TikTok", width: 1080, height: 1920, ratio: "9:16", channels: "Stories, Reels, TikTok en WhatsApp Status" },
];

const emptyImages = Object.fromEntries(imageSlots.map(({ key }) => [key, null]));
const defaultTicketVariation = { id: "ticket-1", name: "Gratis ticket", type: "free", price: "0", capacity: "", salesStart: "", salesEnd: "", minQuantity: "1", maxQuantity: "10" };

const campaignTypes = [
  ["event", "Evenement", "Met Eventin, datum, tickets en agenda"],
  ["product", "Gerecht of product", "Gerecht, drankje of ander product"],
  ["offer", "Aanbieding", "Actieprijs en geldigheidsperiode"],
  ["package", "Arrangement", "Groepen, feesten, verhuur of menu"],
  ["review", "Review delen", "Maak van een gastbeoordeling content"],
  ["custom", "Eigen campagne", "Vrij nieuwsbericht of merkverhaal"],
];

const campaignTitleLabels = {
  event: "Evenementnaam",
  product: "Productnaam",
  offer: "Naam van aanbieding",
  package: "Arrangementnaam",
  review: "Titel voor reviewbericht",
  custom: "Campagnenaam",
};

const editorialAgendaTargets = [
  { key: "email_salsa", label: "Salsa.nl", route: "email", routeLabel: "Per e-mail aanmelden", infoUrl: "https://www.salsa.nl/b2b/gratis-vermelding.php", email: "redactie@salsa.nl" },
  { key: "email_zoetermeer_nieuws", label: "Zoetermeer.Nieuws.nl", route: "email", routeLabel: "Persbericht per e-mail", websiteUrl: "https://zoetermeer.nieuws.nl/", email: "zoetermeer@nieuws.nl" },
  { key: "email_zoetermeers_dagblad", label: "Zoetermeers Dagblad", route: "email", routeLabel: "Persbericht per e-mail", websiteUrl: "https://zoetermeersdagblad.nl/", email: "redactie@zoetermeersdagblad.nl" },
  { key: "email_streekblad", label: "Streekblad Zoetermeer", route: "email", routeLabel: "Redactie per e-mail", websiteUrl: "https://www.streekbladzoetermeer.nl/agenda", email: "redactiestreekblad@telstarmediacentrum.nl" },
  { key: "email_zfm", label: "ZFM Zoetermeer", route: "website", routeLabel: "Via de uitagenda aanmelden", submissionUrl: "https://tockify.com/tkf2/submitEvent/0fbdcd2a8e104de3ad865d21cd3959a0", email: "algemeen@zfmzoetermeer.nl", fallbackLabel: "Lukt het formulier niet? Gebruik dan e-mail als reserveoptie" },
  { key: "email_zoetermeer_actief", label: "Zoetermeer Actief", route: "email", routeLabel: "Redactie per e-mail", websiteUrl: "https://zoetermeeractief.nl/", email: "info@zoetermeeractief.nl" },
  { key: "email_vrijetijdkrant", label: "Vrijetijdkrant", route: "website", routeLabel: "Evenement via formulier aanmelden", submissionUrl: "https://www.vrijetijdkrant.nl/evenement-aanmelden/", email: "info@vrijetijdkrant.nl", fallbackLabel: "Werkt het formulier niet? E-mail om hulp" },
  { key: "email_eventtip", label: "Eventtip / Culturele Uitagenda", route: "website", routeLabel: "Invullen via het aanmeldformulier", submissionUrl: "https://cultureleuitagendaform.thefeedfactory.nl/?id=cultureleuitagenda", email: "info@eventconnectors.nl", fallbackLabel: "Werkt het formulier niet? E-mail de redactie" },
  { key: "email_wat_te_doen", label: "Wat te doen Vandaag", route: "website", routeLabel: "Invullen via het aanmeldformulier", submissionUrl: "https://wattedoenvandaag.nl/uitje-evenement-aanmelden/", email: "info@wattedoenvandaag.nl", fallbackLabel: "Evenement langer dan twee weken of formulier werkt niet? E-mail de redactie" },
  { key: "email_evenementen", label: "Evenementen.nl", route: "website", routeLabel: "Eerst via de website aanmelden", submissionUrl: "https://www.evenementen.nl/", email: "info@evenementen.nl", fallbackLabel: "Geeft de website een fout? E-mail de redactie" },
  { key: "website_muziekladder", label: "Muziekladder", route: "website", routeLabel: "Gratis via het aanmeldformulier", submissionUrl: "https://muziekladder.nl/nl/muziekformulier", fallbackLabel: "Vooral geschikt voor muziek-, dans- en live-evenementen" },
  { key: "website_eventbrite", label: "Eventbrite", route: "website", routeLabel: "Via het organisatoraccount", submissionUrl: "https://www.eventbrite.nl/manage/events/create", fallbackLabel: "Ook bruikbaar voor gratis tickets en reserveringen" },
  { key: "website_denhaag", label: "DenHaag.com", route: "website", routeLabel: "Via de officiële evenementaanmelding", submissionUrl: "https://denhaag.com/nl/aanmelden-evenement", fallbackLabel: "Alleen gebruiken wanneer het evenement relevant is voor Den Haag" },
  { key: "website_marktenmeer", label: "MarktenMeer", route: "website", routeLabel: "Invullen via het marktformulier", submissionUrl: "https://marktenmeer.nl/markt-aanmelden/", email: "info@marktenmeer.nl", fallbackLabel: "Alleen geschikt voor markten, braderieën en fairs; e-mail is beschikbaar als reserve" },
  { key: "email_uitzinnig", label: "Uitzinnig.nl", route: "website", routeLabel: "Aanmelden via de organisatoromgeving", submissionUrl: "https://www.uitzinnig.nl/promoot-evenement.aspx", email: "redactie@uitzinnig.nl", fallbackLabel: "Inloggen kan nodig zijn; e-mail de redactie als aanmelden niet lukt" },
  { key: "email_evenementenloket", label: "Evenementenloket Zoetermeer", route: "email", routeLabel: "Promotieverzoek per e-mail", websiteUrl: "https://www.zoetermeer.nl/evenement-organiseren", email: "evenementenloket@zoetermeer.nl", fallbackLabel: "Voor gemeentelijke communicatie en lokaal bereik" },
  { key: "website_uit_zoetermeer", label: "Uit Zoetermeer", route: "website", routeLabel: "Controleer eerst of het evenement al bestaat", submissionUrl: "https://www.uitzoetermeer.nl/", fallbackLabel: "Voorkom dubbele vermeldingen" },
  { key: "website_hipsy", label: "Hipsy", route: "website", routeLabel: "Gratis evenementpagina via organisatoraccount", submissionUrl: "https://hipsy.nl/event-aanmaken", fallbackLabel: "Account en organisatorpagina nodig" },
  { key: "website_gratisuitje", label: "Gratisuitje.nl", route: "website", routeLabel: "Via de website aanmelden", submissionUrl: "https://www.gratisuitje.nl/", fallbackLabel: "Alleen voor gratis evenementen" },
];

const editorialReferenceTargets = [
  { label: "Guestzone", status: "Handmatige stap nodig", note: "Organisatieaccount wachtte op controle door de redactie.", url: "https://guestzone.nl/" },
  { label: "LatinWorld", status: "Handmatige stap nodig", note: "Persoonlijk akkoord met de voorwaarden is vereist.", url: "https://www.latinworld.nl/" },
  { label: "Partyflock", status: "Handmatige stap nodig", note: "Account en robotcontrole zijn vereist.", url: "https://partyflock.nl/agenda" },
  { label: "AllEvents", status: "Handmatige stap nodig", note: "Een organisatoraccount en -pagina zijn vereist.", url: "https://allevents.in/" },
  { label: "Google Bedrijfsprofiel", status: "Via koppeling", note: "Gebruik hiervoor de aparte Google-bestemming bovenaan; inloggen kan nodig zijn.", url: "https://business.google.com/" },
  { label: "DagjeWeg.nl", status: "Geblokkeerd", note: "De beveiligingscontrole blokkeerde de aanmelding.", url: "https://www.dagjeweg.nl/" },
  { label: "indebuurt", status: "Geblokkeerd", note: "De aanmeldpagina was niet toegankelijk.", url: "https://indebuurt.nl/zoetermeer/" },
  { label: "DJGuide", status: "Geblokkeerd", note: "De aanmeldpagina was niet toegankelijk.", url: "https://www.djguide.nl/" },
  { label: "Uitidee", status: "Niet gebruiken", note: "De geschikte plaatsing bleek betaald en is daarom afgevallen.", url: "https://www.uitidee.nl/" },
  { label: "Zoetermeerse Zakenvrouwen", status: "Niet geschikt", note: "Accepteert alleen zakelijke kennis- en inspiratiebijeenkomsten.", url: "https://zoetermeersezakenvrouwen.nl/" },
];

const emptyEditorialTargets = Object.fromEntries(editorialAgendaTargets.map(({ key }) => [key, false]));

const emptyForm = {
  campaignType: "event",
  title: "", shortDescription: "", description: "", start: "", end: "",
  location: "Caribbean Corner, Dorpsstraat 114A, Zoetermeer", imageUrl: "", eventinImage: null, images: emptyImages, videoUrl: "",
  organizer: "Caribbean Corner", contactEmail: "info@caribbeancorner.nl", language: "nl",
  ctaLabel: "Meer informatie", ctaUrl: "", ticketType: "free", ticketPrice: "0", capacity: "", ticketVariations: [{ ...defaultTicketVariation }],
  status: "draft", calendarMailbox: "info@leclubbbq.nl", addToCalendar: true, preparePromotion: true,
  channels: channelDefaults,
  brevoSubject: "", brevoPreview: "", brevoAudience: "",
  facebookText: "", facebookPlacements: ["feed"], instagramFormat: "post", instagramCaption: "",
  staggerEnabled: true, staggerMinMinutes: "15", staggerMaxMinutes: "45",
  tiktokCaption: "", tiktokPrivacy: "PUBLIC_TO_EVERYONE", tiktokComments: true,
  whatsappTemplate: "", whatsappMessage: "",
  googleTopic: "EVENT", predisType: "afbeelding", predisTone: "Gastvrij en energiek", predisGenerate: false,
  editorialTargets: emptyEditorialTargets,
  regularPrice: "", campaignPrice: "", discountCode: "", validFrom: "", validUntil: "",
  groupSize: "", pricePerPerson: "", reviewerName: "", reviewScore: "5", reviewSource: "",
};

const channelLabels = {
  brevo: "Nieuwsbrief via Brevo", facebook: "Facebook", instagram: "Instagram",
  tiktok: "TikTok", whatsapp: "WhatsApp Business", google: "Google Bedrijfsprofiel", predis: "Predis",
};

const channelModes = {
  brevo: "Brevo-concept", predis: "Optioneel extern concept",
  facebook: "Intern concept", instagram: "Intern concept", tiktok: "Intern concept",
  whatsapp: "Intern concept", google: "Intern concept",
};

const copyableChannels = new Set(["facebook", "instagram", "tiktok", "whatsapp", "google"]);
const campaignPageSize = 50;

const facebookGroupRuleHints = [
  { pattern: /segwaert 079|surinaams eten|festival maatjes|uitgaanstips 40\+|party fun nl/i, level: "avoid", text: "Niet adviseren: reclame of zelfpromotie is hier niet toegestaan." },
  { pattern: /surinaamse lekkernijen/i, level: "conditional", text: "Alleen gebruiken na toestemming van de beheerder." },
  { pattern: /cuban salsa parties/i, level: "conditional", text: "Alleen Cubaanse salsa; maximaal twee berichten en eerst één nieuw lid uitnodigen." },
  { pattern: /latin event promotion/i, level: "allowed", text: "Latin-promotie toegestaan; maximaal één bericht per evenement per week." },
  { pattern: /latin events parties groep nederland/i, level: "allowed", text: "Alleen Latin-evenementen; maximaal één plaatsing per week." },
  { pattern: /latin vibes agenda/i, level: "allowed", text: "Latin-evenementen toegestaan met datum, plaats en flyer." },
  { pattern: /comedyfans nederland/i, level: "allowed", text: "Organisatoren mogen Nederlandse comedy-evenementen delen." },
  { pattern: /muziek optreden/i, level: "allowed", text: "Geschikt voor optredens van bands en muzikanten; vermeld wie, waar en wanneer." },
  { pattern: /karaoke nederland en omstreken/i, level: "allowed", text: "Geschikt voor uitnodigingen voor karaoke-evenementen." },
  { pattern: /party plaza nl/i, level: "allowed", text: "Feest-, catering- en locatiegerelateerde reclame is toegestaan." },
  { pattern: /marktplaats zoetermeer vrij adverteren|ondernemers marktplaats zoetermeer|reclame groep voor kleine bedrijven/i, level: "allowed", text: "Bedrijfsreclame is toegestaan." },
  { pattern: /promoten.*reclame maken zonder regels|reclame voor ondernemers/i, level: "allowed", text: "Promotie van producten of diensten is toegestaan." },
  { pattern: /foodtruck festival en evenementen/i, level: "allowed", text: "Alleen foodbranche, foodtrucks en bijpassende evenementen." },
  { pattern: /trouwlocaties.*feestlocaties/i, level: "allowed", text: "Geschikt voor promotie als trouw- of feestlocatie." },
  { pattern: /restotips den haag/i, level: "conditional", text: "Schrijf dit als een nuttige restauranttip, niet als harde reclame." },
  { pattern: /expat group/i, level: "conditional", text: "Alleen Engelstalige, leuke activiteiten; gewone commerciële reclame is verboden." },
];

function facebookGroupAdvice(group, form, business) {
  const name = String(group?.name || "");
  const normalizedName = normalizeVenue(name);
  const content = normalizeVenue([form.title, form.shortDescription, form.description, form.location, form.campaignType].filter(Boolean).join(" "));
  const businessName = normalizeVenue(business?.name);
  const matchedRule = facebookGroupRuleHints.find((rule) => rule.pattern.test(name));
  if (matchedRule?.level === "avoid") return { recommended: false, score: -100, level: "avoid", reason: matchedRule.text };

  let score = 0;
  const reasons = [];
  const matches = (source, pattern) => pattern.test(source);
  if (matches(normalizedName, /zoetermeer|noordhove|segwaert|de leyens/)) { score += 5; reasons.push("lokale doelgroep"); }
  if (businessName.includes("caribbean corner") && matches(normalizedName, /carib|surina|antill|hindo|latin|reggae|cuba|afro|desi|hindi/)) { score += 3; reasons.push("past bij Caribbean Corner"); }
  if (matches(content, /latin|salsa|bachata|kizomba|cuba/) && matches(normalizedName, /latin|salsa|bachata|kizomba|cuba/)) { score += 6; reasons.push("Latin-evenement"); }
  if (matches(content, /karaoke/) && matches(normalizedName, /karaoke/)) { score += 7; reasons.push("karaoke"); }
  if (matches(content, /comedy|stand up/) && matches(normalizedName, /comedy/)) { score += 7; reasons.push("comedy"); }
  if (matches(content, /live|band|muziek|music|zanger|optreden/) && matches(normalizedName, /live|band|muziek|music|zanger|optreden|wereldmuziek/)) { score += 6; reasons.push("live muziek"); }
  if (matches(content, /ladies|dames|vrouwen/) && matches(normalizedName, /ladies|dames|vrouwen/)) { score += 7; reasons.push("Ladies Night"); }
  if (matches(content, /eten|gerecht|menu|bbq|barbecue|sparerib|spare rib|truki pan|catering|cocktail/) && matches(normalizedName, /eten|food|horeca|restaurant|resto|catering|hapje|bbq|cocktail/)) { score += 6; reasons.push("eten en horeca"); }
  if (matches(content, /zaal|locatie|verhuur|bruiloft|trouw|bedrijfsfeest|feestje|arrangement/) && matches(normalizedName, /zaal|locatie|verhuur|bruiloft|trouw|bedrijfsfeest|feest|party plaza/)) { score += 6; reasons.push("feest of locatie"); }
  if (matches(normalizedName, /reclame|promot|vrij adverteren|ondernemers marktplaats/)) { score += 3; reasons.push("promotiegroep"); }
  if (matchedRule?.level === "allowed") score += 2;
  if (matchedRule?.level === "conditional") score -= 1;

  return {
    recommended: score >= 6,
    score,
    level: matchedRule?.level || "unknown",
    reason: matchedRule?.text || (reasons.length ? `Past bij ${reasons.join(", ")}. Controleer voor plaatsing altijd de actuele groepsregels.` : "Geen duidelijke inhoudelijke match gevonden."),
  };
}

function channelConceptText(distribution, channel, fallbackBody = "") {
  const payload = distribution?.channel_payloads?.[channel] || {};
  const common = distribution?.common || {};
  if (channel === "facebook") return payload.text || common.short_description || fallbackBody;
  if (channel === "instagram") return payload.caption || common.short_description || fallbackBody;
  if (channel === "tiktok") return payload.caption || common.short_description || fallbackBody;
  if (channel === "whatsapp") return payload.message || common.short_description || fallbackBody;
  if (channel === "google") return [
    common.title,
    common.short_description || common.description || fallbackBody,
    common.cta?.url,
  ].filter(Boolean).join("\n\n");
  return "";
}

function calendarEventDescription(form, websiteUrl) {
  const tickets = (form.ticketVariations || []).map((ticket) => {
    const price = ticket.type === "free" ? "Gratis" : `€ ${Number(ticket.price || 0).toFixed(2).replace(".", ",")}`;
    const capacity = ticket.capacity ? `${ticket.capacity} beschikbaar` : "onbeperkt";
    return `- ${ticket.name || "Ticket"}: ${price} (${capacity})`;
  });
  return [
    form.description.trim() || form.shortDescription.trim(),
    tickets.length ? `Tickets:\n${tickets.join("\n")}` : "",
    form.organizer.trim() ? `Organisator: ${form.organizer.trim()}` : "",
    form.contactEmail.trim() ? `Contact: ${form.contactEmail.trim()}` : "",
    websiteUrl ? `Website: ${websiteUrl}` : "",
  ].filter(Boolean).join("\n\n");
}

function editorialEmailDraft(target, common = {}, sourceUrl = "") {
  const description = common.description || common.short_description || "";
  const imageUrl = common.image_url || common.images?.landscape?.url || common.images?.square?.url || "";
  const lines = [
    `Beste redactie van ${target.label},`,
    "",
    `Graag melden wij het volgende evenement van ${common.organizer || "onze locatie"} aan:`,
    "",
    `Titel: ${common.title || ""}`,
    common.start ? `Begint: ${formatNlDateTime(common.start)}` : "",
    common.end ? `Eindigt: ${formatNlDateTime(common.end)}` : "",
    common.location ? `Locatie: ${common.location}` : "",
    description ? `Omschrijving: ${description}` : "",
    sourceUrl ? `Evenementpagina: ${sourceUrl}` : "",
    imageUrl ? `Openbare beeldlink: ${imageUrl}` : "",
    common.contact_email ? `Contact: ${common.contact_email}` : "",
    "",
    "Met vriendelijke groet,",
    common.organizer || "Horeca OS",
  ].filter(Boolean);
  return {
    targetLabel: target.label,
    to: target.email,
    subject: `Evenement aanmelden: ${common.title || "evenement"}`,
    body: lines.join("\n"),
  };
}

function editorialTargetDetails(target) {
  const currentTarget = editorialAgendaTargets.find(({ key }) => key === target?.key) || {};
  return { ...(target || {}), ...currentTarget, status: target?.status || currentTarget.status };
}

function editorialRoutePresentation(target) {
  if (target.route === "email" && target.email) {
    return {
      badge: "Automatisch per e-mail",
      explanation: "Horeca OS vult de e-mail volledig in. Na jouw controle kan deze samen met de andere geselecteerde e-mails worden verzonden.",
    };
  }
  if (target.submissionUrl) {
    return {
      badge: "Aanmeldpagina — handmatige controle",
      explanation: "Deze website biedt geen betrouwbare automatische koppeling. Horeca OS bewaart je invoer voordat de aanmeldpagina opent.",
    };
  }
  return {
    badge: "Instructies controleren",
    explanation: "Controleer eerst de werkwijze van dit kanaal.",
  };
}

function siteForBusiness(business) {
  return "caribbeancorner.nl";
}

function defaultsForBusiness(business) {
  const name = String(business?.name || "").trim();
  const isPlein = name.toLowerCase().includes("plein");
  return {
    organizer: name || emptyForm.organizer,
    location: isPlein ? "Grandcafé Het Plein" : "Caribbean Corner",
    contactEmail: isPlein ? "" : emptyForm.contactEmail,
  };
}

function normalizeVenue(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function eventLocationMatchesBusiness(location, business) {
  const normalizedLocation = normalizeVenue(location);
  const normalizedBusiness = normalizeVenue(business?.name);
  if (!normalizedLocation || !normalizedBusiness) return false;
  const acceptedNames = normalizedBusiness.includes("plein")
    ? ["grandcafe het plein", "grand cafe het plein", "het plein"]
    : normalizedBusiness.includes("caribbean corner")
      ? ["caribbean corner"]
      : [normalizedBusiness];
  return acceptedNames.some((name) => normalizedLocation.includes(name) || name.includes(normalizedLocation));
}

function eventLocationIsAmbiguous(location) {
  const normalizedLocation = normalizeVenue(location);
  return normalizedLocation.includes("caribbean corner") && normalizedLocation.includes("plein");
}

function providerDeliveryConfirmed(delivery) {
  const status = String(delivery?.status || "").toLowerCase();
  return ["confirmed", "published", "posted", "delivered"].includes(status)
    && Boolean(delivery?.confirmed_at || delivery?.published_at || delivery?.provider_post_id || delivery?.external_id || delivery?.permalink);
}

function distributionHasProviderConfirmation(distribution) {
  return Object.values(distribution?.provider_delivery || {}).some(providerDeliveryConfirmed);
}

function campaignDeletionBlockReason(item, distribution) {
  if (distributionHasProviderConfirmation(distribution)) return "Deze campagne heeft een bevestigde externe plaatsing en blijft daarom bewaard.";
  if (item?.scheduled_for) return "Trek eerst de interne planning in voordat je dit concept verwijdert.";
  if (item?.workflow_status === "in_progress") return "Trek eerst de goedkeuring in voordat je dit concept verwijdert.";
  return "";
}

function campaignEditingBlockReason(item, distribution) {
  if (distributionHasProviderConfirmation(distribution)) return "Deze campagne heeft een bevestigde externe plaatsing. Dupliceer haar om veilig een nieuwe versie te maken.";
  if (item?.scheduled_for) return "Trek eerst de interne planning in voordat je dit concept bewerkt.";
  if (item?.workflow_status === "in_progress") return "Trek eerst de goedkeuring in voordat je dit concept bewerkt.";
  return "";
}

function channelsNeedingDetails(distribution) {
  return (distribution?.target_channels || []).filter((channel) => distribution?.channel_status?.[channel] === "extra_gegevens_nodig");
}

function formatChannelList(channels) {
  return channels.map((channel) => channelLabels[channel] || channel).join(", ");
}

function formatNlDateTime(value) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat("nl-NL", {
    timeZone: "Europe/Amsterdam", day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit",
  }).format(date);
}

function formatNlDate(value) {
  if (!value) return "";
  const date = new Date(`${value}T12:00:00`);
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat("nl-NL", {
    timeZone: "Europe/Amsterdam", day: "numeric", month: "long", year: "numeric",
  }).format(date);
}

function suggestedPromotionCopy({ title, start, location, description }) {
  const eventTitle = String(title || "").trim();
  if (!eventTitle) return "";
  const comparableTitle = eventTitle.toLocaleLowerCase("nl-NL").replace(/[^a-z0-9]+/g, "");
  const detail = String(description || "")
    .split(/\n+/)
    .map((line) => line.replace(/<[^>]+>/g, "").trim())
    .find((line) => line.length >= 50 && line.toLocaleLowerCase("nl-NL").replace(/[^a-z0-9]+/g, "") !== comparableTitle);
  const date = start && !Number.isNaN(new Date(start).getTime())
    ? new Intl.DateTimeFormat("nl-NL", { timeZone: "Europe/Amsterdam", weekday: "long", day: "numeric", month: "long", hour: "2-digit", minute: "2-digit" }).format(new Date(start))
    : "";
  const venue = String(location || "").trim();
  const comparableVenue = venue.toLocaleLowerCase("nl-NL").replace(/[^a-z0-9]+/g, "");
  const venueAlreadyNamed = comparableVenue && comparableTitle.includes(comparableVenue);
  const opening = `${eventTitle}${date ? ` op ${date}` : ""}${venue && !venueAlreadyNamed ? ` bij ${venue}` : ""}.`;
  return `${opening}${detail ? ` ${detail}` : ""}`.slice(0, 280).trim();
}

function toLocalDateTimeInput(value) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 16);
}

function normalizeOvernightEnd(startValue, endValue) {
  if (!startValue || !endValue || String(startValue).slice(0, 10) !== String(endValue).slice(0, 10)) return endValue;
  const start = new Date(startValue);
  const end = new Date(endValue);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || end > start) return endValue;
  end.setDate(end.getDate() + 1);
  return toLocalDateTimeInput(end);
}

function buildChannelSchedule(channels, baseDate, minMinutes, maxMinutes, enabled) {
  let cursor = baseDate.getTime();
  return Object.fromEntries(channels.map((channel, index) => {
    if (index > 0 && enabled) {
      const delay = Math.floor(Math.random() * (maxMinutes - minMinutes + 1)) + minMinutes;
      cursor += delay * 60_000;
    }
    return [channel, new Date(cursor).toISOString()];
  }));
}

function formHasCampaignContent(form) {
  return [
    form.title, form.shortDescription, form.description, form.start, form.end,
    form.imageUrl, form.eventinImage?.url, form.videoUrl, form.ctaUrl, form.brevoSubject, form.brevoPreview,
    form.facebookText, form.instagramCaption, form.tiktokCaption,
    form.whatsappTemplate, form.whatsappMessage, form.regularPrice, form.campaignPrice,
    form.discountCode, form.validFrom, form.validUntil, form.groupSize, form.pricePerPerson,
    form.reviewerName, form.reviewSource,
    ...Object.values(form.images || {}).map((image) => image?.url || ""),
  ].some((value) => String(value || "").trim());
}

function formDraftStorageKey(workspaceId, businessId) {
  return `horeca-os:marketing-form:${workspaceId}:${businessId}`;
}

function formUiStorageKey(workspaceId, businessId) {
  return `horeca-os:marketing-ui:${workspaceId}:${businessId}`;
}

export default function CentralEventCreator({ workspaceId, businessId, businesses, session }) {
  const [form, setForm] = useState(emptyForm);
  const automaticShortTextRef = useRef("");
  const automaticFacebookTextRef = useRef("");
  const facebookGroupListRef = useRef(null);
  const [eventWorkspaceView, setEventWorkspaceView] = useState("");
  const [preview, setPreview] = useState(false);
  const [previewChannel, setPreviewChannel] = useState("");
  const [savedEventPreviewId, setSavedEventPreviewId] = useState(null);
  const [expandedEditorialCampaignIds, setExpandedEditorialCampaignIds] = useState([]);
  const [editorialEmailSelections, setEditorialEmailSelections] = useState({});
  const [internalEditorialEmail, setInternalEditorialEmail] = useState(null);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState(null);
  const [uploadingSlot, setUploadingSlot] = useState("");
  const [uploadMessage, setUploadMessage] = useState(null);
  const [draggingSlot, setDraggingSlot] = useState("");
  const [cropFocus, setCropFocus] = useState("center");
  const [eventCampaigns, setEventCampaigns] = useState([]);
  const [eventThumbnailUrls, setEventThumbnailUrls] = useState({});
  const eventThumbnailRequestsRef = useRef(new Set());
  const [campaignListBusy, setCampaignListBusy] = useState(false);
  const [hasMoreCampaigns, setHasMoreCampaigns] = useState(false);
  const [editingCampaignId, setEditingCampaignId] = useState(null);
  const [editingWebsiteEvent, setEditingWebsiteEvent] = useState(null);
  const [conceptBusyId, setConceptBusyId] = useState(null);
  const [conceptTypeFilter, setConceptTypeFilter] = useState("all");
  const [conceptStatusFilter, setConceptStatusFilter] = useState("all");
  const [conceptSearch, setConceptSearch] = useState("");
  const [conceptSort, setConceptSort] = useState("newest");
  const [conceptSchedule, setConceptSchedule] = useState({});
  const [channelScheduleEdits, setChannelScheduleEdits] = useState({});
  const [managedWebsiteEvents, setManagedWebsiteEvents] = useState([]);
  const [showExpiredWebsiteEvents, setShowExpiredWebsiteEvents] = useState(false);
  const [managedEventSearch, setManagedEventSearch] = useState("");
  const [managedEventsLoading, setManagedEventsLoading] = useState(false);
  const [importingEventId, setImportingEventId] = useState("");
  const managedEventsRequestRef = useRef(0);
  const [brevoLists, setBrevoLists] = useState([]);
  const [selectedBrevoListIds, setSelectedBrevoListIds] = useState([]);
  const [brevoSenderEmail, setBrevoSenderEmail] = useState("");
  const [brevoLoading, setBrevoLoading] = useState(false);
  const [brevoError, setBrevoError] = useState("");
  const [editingBrevoDraftId, setEditingBrevoDraftId] = useState(null);
  const [facebookGroups, setFacebookGroups] = useState([]);
  const [selectedFacebookGroupIds, setSelectedFacebookGroupIds] = useState([]);
  const [facebookGroupsLoading, setFacebookGroupsLoading] = useState(false);
  const [facebookGroupsError, setFacebookGroupsError] = useState("");
  const [facebookGroupSearch, setFacebookGroupSearch] = useState("");
  const [facebookGroupLists, setFacebookGroupLists] = useState([]);
  const [facebookGroupListName, setFacebookGroupListName] = useState("");
  const [facebookGroupListsBusy, setFacebookGroupListsBusy] = useState(false);
  const [showAllFacebookGroups, setShowAllFacebookGroups] = useState(false);
  const [facebookGroupShareProgress, setFacebookGroupShareProgress] = useState({});
  const [facebookGroupShareClock, setFacebookGroupShareClock] = useState(() => Date.now());
  const [facebookGroupShareProgressLoaded, setFacebookGroupShareProgressLoaded] = useState(false);
  const [newFacebookGroup, setNewFacebookGroup] = useState({ name: "", url: "" });
  const [facebookEventLinkEdits, setFacebookEventLinkEdits] = useState({});
  const [facebookEventOrganizerChecks, setFacebookEventOrganizerChecks] = useState({});
  const [facebookEventManualLinkIds, setFacebookEventManualLinkIds] = useState([]);
  const [facebookAccount, setFacebookAccount] = useState(null);
  const [facebookAccountLoading, setFacebookAccountLoading] = useState(false);
  const [predisBrandId, setPredisBrandId] = useState("");
  const [predisConnected, setPredisConnected] = useState(false);
  const [pendingPredisGeneration, setPendingPredisGeneration] = useState(null);
  const [copiedChannelKey, setCopiedChannelKey] = useState("");
  const [restoredDraftKey, setRestoredDraftKey] = useState("");
  const selectedBusiness = useMemo(() => businesses.find((item) => item.id === businessId) || businesses[0], [businessId, businesses]);
  const visibleFacebookGroups = useMemo(() => {
    const query = facebookGroupSearch.trim().toLocaleLowerCase("nl-NL");
    const groups = query
      ? facebookGroups.filter((group) => group.name.toLocaleLowerCase("nl-NL").includes(query))
      : facebookGroups;
    return [...groups].sort((left, right) => left.name.localeCompare(right.name, "nl"));
  }, [facebookGroupSearch, facebookGroups]);
  const facebookGroupAdviceById = useMemo(() => new Map(facebookGroups.map((group) => [String(group.id), facebookGroupAdvice(group, form, selectedBusiness)])), [facebookGroups, form.title, form.shortDescription, form.description, form.location, form.campaignType, selectedBusiness]);
  const recommendedFacebookGroups = useMemo(() => facebookGroups
    .map((group) => ({ group, advice: facebookGroupAdviceById.get(String(group.id)) }))
    .filter(({ advice }) => advice?.recommended)
    .sort((left, right) => right.advice.score - left.advice.score || left.group.name.localeCompare(right.group.name, "nl")), [facebookGroups, facebookGroupAdviceById]);
  useEffect(() => {
    if (!workspaceId) return;
    try {
      const stored = window.localStorage.getItem(`horeca-os-facebook-group-progress:${workspaceId}`);
      setFacebookGroupShareProgress(stored ? JSON.parse(stored) : {});
    } catch {
      setFacebookGroupShareProgress({});
    } finally {
      setFacebookGroupShareProgressLoaded(true);
    }
  }, [workspaceId]);
  useEffect(() => {
    if (!workspaceId || !facebookGroupShareProgressLoaded) return;
    try {
      window.localStorage.setItem(`horeca-os-facebook-group-progress:${workspaceId}`, JSON.stringify(facebookGroupShareProgress));
    } catch {}
  }, [facebookGroupShareProgress, facebookGroupShareProgressLoaded, workspaceId]);
  useEffect(() => {
    const hasActiveWait = Object.values(facebookGroupShareProgress).some((progress) => Number(progress?.waitUntil || 0) > Date.now());
    if (!hasActiveWait) return undefined;
    const timer = window.setInterval(() => setFacebookGroupShareClock(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [facebookGroupShareProgress]);
  const selectedBrevoLists = useMemo(() => brevoLists.filter((item) => selectedBrevoListIds.includes(String(item.id))), [brevoLists, selectedBrevoListIds]);
  const brevoRecipientCount = selectedBrevoLists.reduce((total, item) => total + Number(item.totalSubscribers || item.uniqueSubscribers || 0), 0);
  const site = siteForBusiness(selectedBusiness);
  const saveCurrentUiState = (scrollY = window.scrollY) => {
    const selectedBusinessId = selectedBusiness?.id || businessId;
    if (!workspaceId || !selectedBusinessId) return;
    try {
      window.localStorage.setItem(formUiStorageKey(workspaceId, selectedBusinessId), JSON.stringify({
        eventWorkspaceView,
        savedEventPreviewId,
        scrollY,
        savedAt: new Date().toISOString(),
      }));
    } catch {
      // De pagina blijft bruikbaar als lokale opslag door de browser wordt geweigerd.
    }
  };
  const saveCurrentFormDraft = (scrollY = window.scrollY) => {
    const selectedBusinessId = selectedBusiness?.id || businessId;
    if (!workspaceId || !selectedBusinessId || editingCampaignId || editingWebsiteEvent) return;
    saveCurrentUiState(scrollY);
    const draftKey = formDraftStorageKey(workspaceId, selectedBusinessId);
    try {
      if (formHasCampaignContent(form)) {
        window.localStorage.setItem(draftKey, JSON.stringify({
          form,
          ui: { eventWorkspaceView, scrollY },
          savedAt: new Date().toISOString(),
        }));
      } else {
        window.localStorage.removeItem(draftKey);
      }
    } catch {
      // Het formulier blijft bruikbaar als lokale opslag door de browser wordt geweigerd.
    }
  };
  const update = (key, value) => {
    setForm((current) => ({ ...current, [key]: value }));
    if (key === "predisGenerate" && !value) setPendingPredisGeneration(null);
    setPreview(false); setPreviewChannel(""); setResult(null);
  };
  const updateTicketVariation = (id, key, value) => setForm((current) => ({
    ...current,
    ticketVariations: (current.ticketVariations || []).map((ticket) => ticket.id === id ? { ...ticket, [key]: value } : ticket),
  }));
  const addTicketVariation = () => setForm((current) => ({
    ...current,
    ticketVariations: [...(current.ticketVariations || []), { ...defaultTicketVariation, id: `ticket-${Date.now()}`, name: `Ticket ${(current.ticketVariations || []).length + 1}` }],
  }));
  const removeTicketVariation = (id) => setForm((current) => ({ ...current, ticketVariations: (current.ticketVariations || []).filter((ticket) => ticket.id !== id) }));
  useEffect(() => {
    const correctedEnd = normalizeOvernightEnd(form.start, form.end);
    if (!correctedEnd || correctedEnd === form.end) return;
    setForm((current) => current.start === form.start && current.end === form.end ? { ...current, end: correctedEnd } : current);
    setPreview(false);
    setResult({ ok: true, message: "De eindtijd ligt na middernacht. Horeca OS heeft de einddatum daarom op de volgende dag gezet." });
  }, [form.start, form.end]);
  useEffect(() => {
    const suggestion = suggestedPromotionCopy(form);
    if (!suggestion) return;
    setForm((current) => {
      const shortWasAutomatic = !current.shortDescription.trim() || current.shortDescription === automaticShortTextRef.current;
      const nextShort = shortWasAutomatic ? suggestion : current.shortDescription;
      const facebookWasAutomatic = !current.facebookText.trim() || current.facebookText === automaticFacebookTextRef.current;
      const nextFacebook = facebookWasAutomatic ? nextShort : current.facebookText;
      automaticShortTextRef.current = shortWasAutomatic ? nextShort : "";
      automaticFacebookTextRef.current = facebookWasAutomatic ? nextFacebook : "";
      if (nextShort === current.shortDescription && nextFacebook === current.facebookText) return current;
      return { ...current, shortDescription: nextShort, facebookText: nextFacebook };
    });
  }, [form.title, form.start, form.location, form.description]);
  const refreshTicketSalesDates = () => {
    if (!form.start || Number.isNaN(new Date(form.start).getTime())) {
      setResult({ ok: false, message: "Vul eerst bovenaan een geldige begindatum van het evenement in." });
      return;
    }
    const salesStart = toLocalDateTimeInput(new Date());
    const salesEnd = form.start;
    setForm((current) => ({
      ...current,
      ticketVariations: (current.ticketVariations || []).map((ticket) => ({ ...ticket, salesStart, salesEnd })),
    }));
    setPreview(false);
    setResult({ ok: true, message: "De ticketverkoop start nu en eindigt wanneer het evenement begint." });
  };
  const startNewCampaign = () => {
    const defaults = defaultsForBusiness(selectedBusiness);
    const draftKey = workspaceId && selectedBusiness?.id ? formDraftStorageKey(workspaceId, selectedBusiness.id) : "";
    if (draftKey) window.localStorage.removeItem(draftKey);
    setForm({
      ...emptyForm,
      images: { ...emptyImages },
      channels: { ...channelDefaults },
      editorialTargets: { ...emptyEditorialTargets },
      organizer: defaults.organizer,
      location: defaults.location,
      contactEmail: defaults.contactEmail,
    });
    setEditingCampaignId(null);
    setEditingWebsiteEvent(null);
    setEditingBrevoDraftId(null);
    setSelectedBrevoListIds([]);
    setSelectedFacebookGroupIds([]);
    setPendingPredisGeneration(null);
    setEventWorkspaceView("new");
    setPreview(false);
    setResult({ ok: true, message: "Er staat een leeg nieuw campagneformulier klaar. Het bestaande evenement is niet gewijzigd." });
    window.scrollTo({ top: 0, behavior: "smooth" });
  };
  const selectCampaignType = (campaignType) => {
    if (campaignType === form.campaignType) {
      if (campaignType === "event") setEventWorkspaceView("");
      return;
    }
    if (formHasCampaignContent(form) && !window.confirm("Je hebt al campagnegegevens ingevuld. Wil je deze wissen en doorgaan met een ander campagnetype?")) return;
    setForm((current) => ({
      ...emptyForm,
      campaignType,
      googleTopic: campaignType === "event" ? "EVENT" : campaignType === "offer" ? "OFFER" : "STANDARD",
      organizer: current.organizer,
      location: current.location,
      contactEmail: current.contactEmail,
      calendarMailbox: current.calendarMailbox,
      addToCalendar: current.addToCalendar,
      preparePromotion: current.preparePromotion,
      channels: current.channels,
      staggerEnabled: current.staggerEnabled,
      staggerMinMinutes: current.staggerMinMinutes,
      staggerMaxMinutes: current.staggerMaxMinutes,
    }));
    setSelectedBrevoListIds([]);
    setSelectedFacebookGroupIds([]);
    setEditingCampaignId(null); setEditingWebsiteEvent(null); setEditingBrevoDraftId(null); setPendingPredisGeneration(null); setPreview(false); setResult(null);
    setEventWorkspaceView(campaignType === "event" ? "" : "new");
  };
  const toggleChannel = (channel) => update("channels", { ...form.channels, [channel]: !form.channels[channel] });
  const toggleFacebookPlacement = (placement) => {
    const current = form.facebookPlacements || [];
    update("facebookPlacements", current.includes(placement) ? current.filter((item) => item !== placement) : [...current, placement]);
  };
  const applyFacebookGroupAdvice = () => {
    const advisedIds = recommendedFacebookGroups
      .map(({ group }) => String(group.id));
    setSelectedFacebookGroupIds(advisedIds);
    setResult({
      ok: true,
      message: advisedIds.length
        ? `${advisedIds.length} aanbevolen Facebookgroepen zijn aangevinkt. Controleer de selectie zelf; er wordt nog niets geplaatst.`
        : "Er zijn voor deze inhoud nog geen Facebookgroepen aanbevolen.",
    });
  };
  const selectVisibleFacebookGroups = () => {
    const selectableIds = visibleFacebookGroups
      .filter((group) => facebookGroupAdviceById.get(String(group.id))?.level !== "avoid")
      .map((group) => String(group.id));
    setSelectedFacebookGroupIds((current) => [...new Set([...current, ...selectableIds])]);
  };
  const toggleFacebookGroupSelection = (groupId) => {
    const listScrollTop = facebookGroupListRef.current?.scrollTop || 0;
    const pageScrollTop = window.scrollY;
    const id = String(groupId);
    setSelectedFacebookGroupIds((current) => current.includes(id) ? current.filter((selectedId) => selectedId !== id) : [...current, id]);
    window.requestAnimationFrame(() => {
      window.requestAnimationFrame(() => {
        if (facebookGroupListRef.current) facebookGroupListRef.current.scrollTop = listScrollTop;
        window.scrollTo({ top: pageScrollTop, behavior: "instant" });
      });
    });
  };
  const enabledChannels = form.preparePromotion ? Object.keys(form.channels).filter((channel) => form.channels[channel]) : [];
  const preferredImageKeys = (channel) => {
    if (channel === "instagram") return form.instagramFormat === "reel" || form.instagramFormat === "story"
      ? ["vertical", "portrait", "square", "landscape"]
      : ["portrait", "square", "vertical", "landscape"];
    if (channel === "tiktok" || channel === "whatsapp") return ["vertical", "portrait", "square", "landscape"];
    if (channel === "predis") return ["square", "portrait", "landscape", "vertical"];
    return ["landscape", "square", "portrait", "vertical"];
  };
  const channelImagePreviews = enabledChannels.map((channel) => {
    const preferredKeys = preferredImageKeys(channel);
    const selectedKey = preferredKeys.find((key) => form.images?.[key]?.url);
    const selectedImage = selectedKey ? form.images[selectedKey] : null;
    const externalUrl = !selectedImage ? form.imageUrl.trim() : "";
    return {
      channel,
      label: channelLabels[channel],
      preferredKey: preferredKeys[0],
      selectedKey,
      image: selectedImage,
      imageUrl: selectedImage?.url || externalUrl,
      isFallback: Boolean(selectedKey && selectedKey !== preferredKeys[0]),
      isExternal: Boolean(externalUrl),
    };
  });
  const channelMediaIssues = form.preparePromotion ? [
    ...(form.channels.facebook && !(form.facebookPlacements || []).length ? ["Facebook: kies Feed, Verhaal of Reel."] : []),
    ...(enabledChannels.length === 0 ? ["Kies minimaal één promotiekanaal."] : []),
    ...channelImagePreviews.flatMap((item) => {
      const videoRequired = item.channel === "tiktok"
        || (item.channel === "instagram" && form.instagramFormat === "reel")
        || (item.channel === "predis" && form.predisType === "video");
      if (videoRequired && !form.videoUrl.trim()) {
        return [`${item.label}: voeg een videolink toe.`];
      }
      if (!videoRequired && !item.imageUrl) {
        return [`${item.label}: upload een afbeelding of voeg een externe afbeeldingslink toe.`];
      }
      return [];
    }),
  ] : [];
  const mediaReady = channelMediaIssues.length === 0;
  const isEvent = form.campaignType === "event";
  const campaignTypeLabel = campaignTypes.find(([id]) => id === form.campaignType)?.[1] || "Campagne";
  const campaignTitleLabel = campaignTitleLabels[form.campaignType] || "Campagnenaam";
  const filteredEventCampaigns = useMemo(() => {
    const searchTerm = conceptSearch.trim().toLocaleLowerCase("nl-NL");
    return eventCampaigns.filter((item) => {
      const distribution = (item.media || []).find((entry) => entry?.kind === "campaign_distribution") || {};
      const storedType = distribution.common?.campaign_type || (distribution.source_type === "website_event" ? "event" : distribution.source_type) || "custom";
      const workStatus = distributionHasProviderConfirmation(distribution) ? "published" : item.scheduled_for ? "scheduled" : item.workflow_status === "in_progress" ? "approved" : "draft";
      const searchableText = [
        distribution.common?.title,
        distribution.common?.short_description,
        distribution.common?.description,
        item.body,
      ].filter(Boolean).join(" ").toLocaleLowerCase("nl-NL");
      return (conceptTypeFilter === "all" || storedType === conceptTypeFilter)
        && (conceptStatusFilter === "all" || workStatus === conceptStatusFilter)
        && (!searchTerm || searchableText.includes(searchTerm));
    }).sort((left, right) => {
      const leftTime = new Date(left.created_at).getTime();
      const rightTime = new Date(right.created_at).getTime();
      return conceptSort === "oldest" ? leftTime - rightTime : rightTime - leftTime;
    });
  }, [eventCampaigns, conceptTypeFilter, conceptStatusFilter, conceptSearch, conceptSort]);

  function handleImageDrop(slot, event) {
    event.preventDefault();
    event.stopPropagation();
    setDraggingSlot("");
    const files = Array.from(event.dataTransfer?.files || []);
    if (files.length > 1) {
      setUploadMessage({ ok: false, message: "Sleep één afbeelding tegelijk naar een afbeeldingsvak." });
      return;
    }
    if (files[0]) uploadImage(slot, files[0]);
  }

  function handleAllImageDrop(event) {
    event.preventDefault();
    event.stopPropagation();
    setDraggingSlot("");
    const files = Array.from(event.dataTransfer?.files || []);
    if (files.length > 1) {
      setUploadMessage({ ok: false, message: "Sleep één bronafbeelding tegelijk. Horeca OS maakt daar alle mogelijke formaten van." });
      return;
    }
    if (files[0]) uploadImageToAll(files[0]);
  }

  async function prepareImageForSlot(file, slot) {
    const loaded = await new Promise((resolve, reject) => {
      const url = URL.createObjectURL(file);
      const image = new window.Image();
      image.onload = () => resolve({ image, url, width: image.naturalWidth, height: image.naturalHeight });
      image.onerror = () => { URL.revokeObjectURL(url); reject(new Error("Afbeelding kon niet worden gelezen.")); };
      image.src = url;
    });

    try {
      const sourceRatio = loaded.width / loaded.height;
      const targetRatio = slot.width / slot.height;
      const ratioDifference = Math.abs(sourceRatio - targetRatio) / targetRatio;
      const cropped = ratioDifference > 0.01;
      let sourceX = 0;
      let sourceY = 0;
      let sourceWidth = loaded.width;
      let sourceHeight = loaded.height;

      if (sourceRatio > targetRatio) {
        sourceWidth = loaded.height * targetRatio;
        sourceX = (loaded.width - sourceWidth) / 2;
      } else if (sourceRatio < targetRatio) {
        sourceHeight = loaded.width / targetRatio;
        sourceY = cropFocus === "top" ? 0 : cropFocus === "bottom" ? loaded.height - sourceHeight : (loaded.height - sourceHeight) / 2;
      }

      if (sourceWidth < slot.width || sourceHeight < slot.height) {
        throw new Error(`${slot.label} heeft na het bijsnijden minimaal ${slot.width} × ${slot.height} bruikbare pixels nodig. Deze foto is ${loaded.width} × ${loaded.height} px.`);
      }
      if (!cropped && loaded.width === slot.width && loaded.height === slot.height) {
        return { file, width: loaded.width, height: loaded.height, resized: false, cropped: false, focus: cropFocus, originalWidth: loaded.width, originalHeight: loaded.height };
      }

      const canvas = document.createElement("canvas");
      canvas.width = slot.width;
      canvas.height = slot.height;
      const context = canvas.getContext("2d");
      if (!context) throw new Error("De afbeelding kon niet automatisch worden aangepast.");
      context.imageSmoothingEnabled = true;
      context.imageSmoothingQuality = "high";
      context.drawImage(loaded.image, sourceX, sourceY, sourceWidth, sourceHeight, 0, 0, slot.width, slot.height);
      const blob = await new Promise((resolve) => canvas.toBlob(resolve, file.type, file.type === "image/png" ? undefined : 0.92));
      if (!blob) throw new Error("De afbeelding kon niet automatisch worden aangepast.");
      const extension = file.name.includes(".") ? file.name.slice(file.name.lastIndexOf(".")) : "";
      const baseName = extension ? file.name.slice(0, -extension.length) : file.name;
      const resizedFile = new File([blob], `${baseName}-${slot.width}x${slot.height}${extension}`, { type: file.type, lastModified: Date.now() });
      return { file: resizedFile, width: slot.width, height: slot.height, resized: true, cropped, focus: cropFocus, originalWidth: loaded.width, originalHeight: loaded.height };
    } finally {
      URL.revokeObjectURL(loaded.url);
    }
  }

  async function uploadImage(slot, file) {
    if (!file) return;
    if (!["image/jpeg", "image/png", "image/webp"].includes(file.type)) return setUploadMessage({ ok: false, message: "Gebruik een JPG-, PNG- of WebP-afbeelding." });
    if (file.size > 10 * 1024 * 1024) return setUploadMessage({ ok: false, message: "De afbeelding mag maximaal 10 MB zijn." });
    setUploadingSlot(slot.key); setUploadMessage(null);
    try {
      const prepared = await prepareImageForSlot(file, slot);
      const safeName = prepared.file.name.toLowerCase().replace(/[^a-z0-9._-]+/g, "-");
      const path = `${workspaceId}/${selectedBusiness?.id || businessId || "algemeen"}/${slot.key}-${Date.now()}-${safeName}`;
      const { error } = await supabase.storage.from("marketing-assets").upload(path, prepared.file, { cacheControl: "31536000", contentType: prepared.file.type, upsert: false });
      if (error) throw error;
      const { data } = supabase.storage.from("marketing-assets").getPublicUrl(path);
      setForm((current) => ({ ...current, images: { ...current.images, [slot.key]: {
        url: data.publicUrl, path, name: prepared.file.name, width: prepared.width, height: prepared.height,
        originalWidth: prepared.originalWidth, originalHeight: prepared.originalHeight, matches: true, resized: prepared.resized, cropped: prepared.cropped, focus: prepared.focus,
      } } }));
      setUploadMessage({
        ok: true,
        message: prepared.cropped
          ? `${slot.label} is automatisch bijgesneden met focus op ${cropFocus === "top" ? "boven" : cropFocus === "bottom" ? "onder" : "het midden"} en aangepast van ${prepared.originalWidth} × ${prepared.originalHeight} naar ${slot.width} × ${slot.height} px.`
          : prepared.resized
            ? `${slot.label} is automatisch verkleind van ${prepared.originalWidth} × ${prepared.originalHeight} naar ${slot.width} × ${slot.height} px en geüpload.`
            : `${slot.label} is correct geüpload.`,
      });
      setPreview(false); setResult(null);
    } catch (error) { setUploadMessage({ ok: false, message: error.message || "Uploaden is niet gelukt." }); }
    finally { setUploadingSlot(""); }
  }

  async function uploadImageToAll(file) {
    if (!file) return;
    if (!["image/jpeg", "image/png", "image/webp"].includes(file.type)) return setUploadMessage({ ok: false, message: "Gebruik een JPG-, PNG- of WebP-afbeelding." });
    if (file.size > 10 * 1024 * 1024) return setUploadMessage({ ok: false, message: "De afbeelding mag maximaal 10 MB zijn." });
    setUploadingSlot("all"); setUploadMessage(null);
    const uploadedImages = {};
    const failures = [];

    try {
      const eventinSafeName = file.name.toLowerCase().replace(/[^a-z0-9._-]+/g, "-");
      const eventinPath = `${workspaceId}/${selectedBusiness?.id || businessId || "algemeen"}/eventin-${Date.now()}-${eventinSafeName}`;
      const { error: eventinUploadError } = await supabase.storage.from("marketing-assets").upload(eventinPath, file, { cacheControl: "31536000", contentType: file.type, upsert: false });
      if (eventinUploadError) throw eventinUploadError;
      const { data: eventinPublicData } = supabase.storage.from("marketing-assets").getPublicUrl(eventinPath);

      for (const slot of imageSlots) {
        try {
          const prepared = await prepareImageForSlot(file, slot);
          const safeName = prepared.file.name.toLowerCase().replace(/[^a-z0-9._-]+/g, "-");
          const path = `${workspaceId}/${selectedBusiness?.id || businessId || "algemeen"}/${slot.key}-${Date.now()}-${safeName}`;
          const { error } = await supabase.storage.from("marketing-assets").upload(path, prepared.file, { cacheControl: "31536000", contentType: prepared.file.type, upsert: false });
          if (error) throw error;
          const { data } = supabase.storage.from("marketing-assets").getPublicUrl(path);
          uploadedImages[slot.key] = {
            url: data.publicUrl, path, name: prepared.file.name, width: prepared.width, height: prepared.height,
            originalWidth: prepared.originalWidth, originalHeight: prepared.originalHeight, matches: true,
            resized: prepared.resized, cropped: prepared.cropped, focus: prepared.focus,
          };
        } catch (error) {
          failures.push(`${slot.label}: ${error.message || "niet gelukt"}`);
        }
      }

      const completed = Object.keys(uploadedImages).length;
      setForm((current) => ({
        ...current,
        eventinImage: { url: eventinPublicData.publicUrl, path: eventinPath, name: file.name },
        images: { ...current.images, ...uploadedImages },
      }));
      setPreview(false); setResult(null);
      setUploadMessage({
        ok: true,
        message: failures.length
          ? `De Eventin-afbeelding is opgeslagen. ${completed} van de ${imageSlots.length} socialmediaformaten zijn gemaakt. ${failures.join(" ")}`
          : "De Eventin-afbeelding en alle vier socialmediaformaten zijn geüpload.",
      });
    } finally {
      setUploadingSlot("");
    }
  }

  async function removeImage(slotKey) {
    const image = form.images?.[slotKey];
    if (image?.path) await supabase.storage.from("marketing-assets").remove([image.path]);
    setForm((current) => ({ ...current, images: { ...current.images, [slotKey]: null } }));
    setPreview(false); setResult(null);
  }

  async function downloadUploadedImage(image, fallbackName) {
    if (!image?.url) return;
    try {
      const response = await fetch(image.url);
      if (!response.ok) throw new Error("download mislukt");
      const blob = await response.blob();
      const objectUrl = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = objectUrl;
      link.download = image.name || fallbackName;
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(objectUrl);
    } catch {
      window.open(image.url, "_blank", "noopener,noreferrer");
      setUploadMessage({ ok: false, message: "De afbeelding is in een nieuw tabblad geopend. Kies daar Afbeelding opslaan als om haar te downloaden." });
    }
  }

  async function loadEventCampaigns({ append = false } = {}) {
    if (!workspaceId || campaignListBusy) return;
    const from = append ? eventCampaigns.length : 0;
    setCampaignListBusy(true);
    let query = supabase.from("social_content_items")
      .select("id,body,media,status,workflow_status,scheduled_for,published_at,permalink,created_at")
      .eq("workspace_id", workspaceId)
      .filter("media", "cs", JSON.stringify([{ kind: "campaign_distribution" }]))
      .order("created_at", { ascending: conceptSort === "oldest" })
      .range(from, from + campaignPageSize - 1);
    if (selectedBusiness?.id || businessId) query = query.eq("business_id", selectedBusiness?.id || businessId);
    const { data, error } = await query;
    if (error) {
      setResult({ ok: false, message: append ? "Meer campagnes konden niet worden geladen." : "Opgeslagen campagnes konden niet worden geladen." });
      setCampaignListBusy(false);
      return;
    }
    const nextCampaigns = data || [];
    setHasMoreCampaigns(nextCampaigns.length === campaignPageSize);
    setEventCampaigns((current) => {
      if (!append) return nextCampaigns;
      const currentIds = new Set(current.map((item) => item.id));
      return [...current, ...nextCampaigns.filter((item) => !currentIds.has(item.id))];
    });
    setCampaignListBusy(false);
  }

  async function loadManagedWebsiteEvents() {
    const selectedBusinessId = selectedBusiness?.id || businessId;
    if (!workspaceId || !selectedBusinessId) return;
    const requestId = managedEventsRequestRef.current + 1;
    managedEventsRequestRef.current = requestId;
    setManagedEventsLoading(true);
    setResult(null);
    try {
      const query = new URLSearchParams({ workspaceId, businessId: selectedBusinessId, site });
      const response = await fetch(`/api/marketing/website-events/create?${query}`, {
        headers: { Authorization: `Bearer ${session.access_token}` },
        signal: AbortSignal.timeout(25000),
      });
      const payload = await response.json().catch(() => ({}));
      if (requestId !== managedEventsRequestRef.current) return;
      if (!response.ok) throw new Error(payload.error || "De bestaande website-evenementen konden niet worden geladen.");
      setManagedWebsiteEvents((payload.events || []).map((eventItem) => ({ ...eventItem, businessId: selectedBusinessId, site, readOnly: Boolean(payload.readOnly) })));
      setResult({ ok: true, message: `${payload.events?.length || 0} bestaande Eventin-evenementen gevonden. Er is nog niets geïmporteerd of gewijzigd.${payload.warning ? ` ${payload.warning}` : ""}` });
    } catch (error) {
      if (requestId !== managedEventsRequestRef.current) return;
      setManagedWebsiteEvents([]);
      setResult({ ok: false, message: error.name === "TimeoutError"
        ? "Eventin reageert te langzaam. Probeer het over enkele seconden opnieuw."
        : error.message || "De bestaande website-evenementen konden niet worden geladen." });
    } finally {
      if (requestId === managedEventsRequestRef.current) setManagedEventsLoading(false);
    }
  }

  async function campaignAccountForBusiness(selectedBusinessId) {
    if (!selectedBusinessId) return null;
    const { data, error } = await supabase.from("integration_accounts")
      .select("id,provider")
      .eq("workspace_id", workspaceId)
      .eq("business_id", selectedBusinessId);
    if (error) throw error;
    return (data || []).find((account) => account.provider === "marketing")
      || (data || []).find((account) => account.provider === "meta")
      || (data || [])[0]
      || null;
  }

  async function importManagedWebsiteEvent(eventItem) {
    const selectedBusinessId = selectedBusiness?.id || businessId;
    if (!selectedBusinessId || !eventItem?.id) return;
    if (eventItem.businessId !== selectedBusinessId || eventItem.site !== site) {
      return setResult({ ok: false, message: "De vestiging is tijdens het laden gewijzigd. Laad de Eventin-evenementen opnieuw voor de gekozen vestiging." });
    }
    setImportingEventId(eventItem.id);
    setResult(null);
    try {
      const detailQuery = new URLSearchParams({
        workspaceId,
        businessId: selectedBusinessId,
        site,
        eventId: String(eventItem.id),
        importEvent: "1",
      });
      const detailResponse = await fetch(`/api/marketing/website-events/create?${detailQuery}`, {
        headers: { Authorization: `Bearer ${session.access_token}` },
      });
      const detailPayload = await detailResponse.json().catch(() => ({}));
      if (!detailResponse.ok) throw new Error(detailPayload.error || "De volledige Eventin-gegevens konden niet worden geladen.");
      const fullEvent = { ...eventItem, ...(detailPayload.event || {}) };
      if (!fullEvent.start || !fullEvent.end || !fullEvent.location) {
        throw new Error("Eventin heeft geen volledige datum, tijd en locatie teruggestuurd. Het evenement is daarom niet gekoppeld.");
      }
      if (eventLocationIsAmbiguous(fullEvent.location)) {
        throw new Error(`De Eventin-locatie “${fullEvent.location}” bevat zowel Caribbean Corner als Grand Café Het Plein. Kies in Eventin eerst één duidelijke venue.`);
      }
      if (!eventLocationMatchesBusiness(fullEvent.location, selectedBusiness)) {
        throw new Error(`Dit Eventin-evenement hoort bij “${fullEvent.location}” en kan niet onder “${selectedBusiness?.name || "de gekozen vestiging"}” worden gekoppeld. Kies eerst de juiste vestiging.`);
      }
      const { data: existingRows, error: existingError } = await supabase.from("social_content_items")
        .select("id,media")
        .eq("workspace_id", workspaceId)
        .eq("business_id", selectedBusinessId)
        .filter("media", "cs", JSON.stringify([{ kind: "campaign_distribution", eventin_event_id: String(eventItem.id) }]))
        .limit(1);
      if (existingError) throw existingError;
      if (existingRows?.length) {
        setResult({ ok: true, message: `${eventItem.title} is al aan Horeca OS gekoppeld.` });
        await loadEventCampaigns();
        return;
      }
      const integration = await campaignAccountForBusiness(selectedBusinessId);
      if (!integration?.id) throw new Error("De interne marketingkoppeling ontbreekt.");
      const common = {
        campaign_type: "event",
        title: fullEvent.title || "Bestaand evenement",
        short_description: "",
        description: fullEvent.description || "",
        start: fullEvent.start,
        end: fullEvent.end,
        location: fullEvent.location,
        image_url: fullEvent.imageUrl || "",
        images: emptyImages,
        video_url: "",
        organizer: selectedBusiness?.name || "",
        contact_email: "",
        language: "nl",
        cta: { label: "Meer informatie", url: fullEvent.url || "" },
        tickets: fullEvent.ticketVariations?.length
          ? { ...(fullEvent.tickets || {}), variations: fullEvent.ticketVariations }
          : { ...(fullEvent.tickets || { type: "none", price: "0", capacity: "" }), variations: [] },
        website_url: fullEvent.url || "",
      };
      const distribution = {
        kind: "campaign_distribution",
        source_type: "website_event",
        source_url: fullEvent.url || "",
        eventin_event_id: String(eventItem.id),
        website_event_status: fullEvent.status || "publish",
        eventin_management_mode: eventItem.readOnly ? "read_only" : "secured",
        imported_from_eventin: true,
        imported_at: new Date().toISOString(),
        common,
        target_channels: [],
        channel_payloads: {},
        channel_status: {},
        channel_schedule: {},
        provider_delivery: {},
        scheduling_status: "draft",
      };
      const { error } = await supabase.from("social_content_items").insert({
        workspace_id: workspaceId,
        business_id: selectedBusinessId,
        account_id: integration.id,
        content_type: "post",
        direction: "outbound",
        body: fullEvent.description || fullEvent.title || "Bestaand evenement",
        media: [distribution],
        status: "draft",
        workflow_status: "new",
        scheduled_for: null,
        created_by: session.user.id,
      });
      if (error) throw error;
      setResult({ ok: true, message: `${eventItem.title} is aan Horeca OS gekoppeld. Eventin en andere kanalen zijn niet gewijzigd.` });
      await loadEventCampaigns();
    } catch (error) {
      setResult({ ok: false, message: error.message || "Het bestaande evenement kon niet worden gekoppeld." });
    } finally {
      setImportingEventId("");
    }
  }

  async function useManagedWebsiteEventAsNew(eventItem) {
    const selectedBusinessId = selectedBusiness?.id || businessId;
    if (!selectedBusinessId || !eventItem?.id) return;
    if (eventItem.businessId !== selectedBusinessId || eventItem.site !== site) {
      return setResult({ ok: false, message: "De vestiging is tijdens het laden gewijzigd. Laad de Eventin-evenementen opnieuw voor de gekozen vestiging." });
    }
    setImportingEventId(eventItem.id);
    setResult(null);
    try {
      const detailQuery = new URLSearchParams({
        workspaceId,
        businessId: selectedBusinessId,
        site,
        eventId: String(eventItem.id),
        importEvent: "1",
      });
      const detailResponse = await fetch(`/api/marketing/website-events/create?${detailQuery}`, {
        headers: { Authorization: `Bearer ${session.access_token}` },
      });
      const detailPayload = await detailResponse.json().catch(() => ({}));
      if (!detailResponse.ok) throw new Error(detailPayload.error || "De volledige Eventin-gegevens konden niet worden geladen.");
      const fullEvent = { ...eventItem, ...(detailPayload.event || {}) };
      const defaults = defaultsForBusiness(selectedBusiness);
      const variations = Array.isArray(fullEvent.ticketVariations) && fullEvent.ticketVariations.length
        ? fullEvent.ticketVariations.map((ticket, index) => ({ ...ticket, id: `copy-ticket-${Date.now()}-${index}` }))
        : [];
      setForm({
        ...emptyForm,
        campaignType: "event",
        title: fullEvent.title || "",
        description: fullEvent.description || "",
        start: fullEvent.start || "",
        end: fullEvent.end || "",
        location: fullEvent.location || defaults.location,
        imageUrl: fullEvent.imageUrl || "",
        eventinImage: fullEvent.imageUrl ? { url: fullEvent.imageUrl, name: "Afbeelding uit het oorspronkelijke Eventin-evenement" } : null,
        images: { ...emptyImages },
        organizer: defaults.organizer,
        contactEmail: defaults.contactEmail,
        ctaUrl: "",
        ticketType: fullEvent.tickets?.type || "none",
        ticketPrice: fullEvent.tickets?.price || "0",
        capacity: fullEvent.tickets?.capacity || "",
        ticketVariations: variations,
        status: "draft",
        channels: { ...channelDefaults },
        editorialTargets: { ...emptyEditorialTargets },
      });
      setEditingCampaignId(null);
      setEditingWebsiteEvent(null);
      setEditingBrevoDraftId(null);
      setSelectedBrevoListIds([]);
      setSelectedFacebookGroupIds([]);
      setPendingPredisGeneration(null);
      setEventWorkspaceView("new");
      setPreview(false);
      setResult({
        ok: true,
        message: `“${fullEvent.title || "Het evenement"}” is volledig als nieuw concept overgenomen. Wijzig nu minimaal de datum, tijden en gewenste tekst. Het oorspronkelijke evenement blijft ongewijzigd.`,
      });
      window.scrollTo({ top: 0, behavior: "smooth" });
    } catch (error) {
      setResult({ ok: false, message: error.message || "Het evenement kon niet als nieuw concept worden overgenomen." });
    } finally {
      setImportingEventId("");
    }
  }

  async function openCampaignConcept(item, asCopy = false) {
    const distribution = (item.media || []).find((entry) => entry?.kind === "campaign_distribution");
    if (!distribution) return;
    const isWebsiteEvent = distribution.source_type === "website_event";
    const editingBlockReason = isWebsiteEvent ? "" : campaignEditingBlockReason(item, distribution);
    if (!asCopy && editingBlockReason) return setResult({ ok: false, message: editingBlockReason });
    let common = distribution.common || {};
    if (isWebsiteEvent && !asCopy) {
      setConceptBusyId(item.id);
      setResult({ ok: true, message: "De volledige Eventin-gegevens worden geladenâ€¦" });
      try {
        const query = new URLSearchParams({
          workspaceId,
          businessId: selectedBusiness?.id || businessId || "",
          site,
          eventId: String(distribution.eventin_event_id || ""),
          campaignId: String(item.id),
        });
        const response = await fetch(`/api/marketing/website-events/create?${query}`, { headers: { Authorization: `Bearer ${session.access_token}` } });
        const result = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(result.error || "De volledige Eventin-gegevens konden niet worden geladen.");
        const event = result.event || {};
        const hasStoredDescription = Object.prototype.hasOwnProperty.call(common, "description");
        common = {
          ...common,
          title: event.title || common.title,
          // Horeca OS is the source of truth for edited copy. Eventin's rendered
          // description also contains generated location and ticket paragraphs.
          // Preserve an intentionally emptied description as well.
          description: hasStoredDescription ? common.description : event.description || "",
          // Horeca OS keeps the requested local date/time as the source of truth.
          // Older Eventin records can report a malformed day after an ISO-date write.
          start: common.start || event.start,
          end: common.end || event.end,
          location: event.location || common.location,
          image_url: event.imageUrl || common.image_url,
          website_status: event.status || distribution.website_event_status || common.website_status,
          website_url: event.url || common.website_url,
          cta: { ...(common.cta || {}), url: event.url || common.cta?.url || distribution.source_url || "" },
          tickets: { ...(common.tickets || {}), ...(event.tickets || {}), variations: event.ticketVariations?.length ? event.ticketVariations : common.tickets?.variations },
        };
      } catch (error) {
        setResult({ ok: false, message: `${error.message || "Eventin kon niet worden geladen"} Het evenement is niet geopend, zodat bestaande gegevens niet per ongeluk worden overschreven.` });
        return;
      } finally {
        setConceptBusyId(null);
      }
    }
    const commercial = common.commercial || {};
    const review = common.review || {};
    const payloads = distribution.channel_payloads || {};
    const targetChannels = distribution.target_channels || [];
    const storedType = common.campaign_type || (distribution.source_type === "website_event" ? "event" : distribution.source_type) || "custom";
    const channels = Object.fromEntries(Object.keys(channelDefaults).map((channel) => [channel, targetChannels.includes(channel)]));
    setForm({
      ...emptyForm,
      campaignType: storedType,
      status: common.website_status || distribution.website_event_status || emptyForm.status,
      title: common.title || "", shortDescription: common.short_description || "", description: common.description || item.body || "",
      start: common.start || "", end: common.end || "", location: common.location || emptyForm.location,
      imageUrl: common.image_url || "", eventinImage: common.image_url ? { url: common.image_url, name: "Bestaande Eventin-afbeelding" } : null,
      images: { ...emptyImages, ...(common.images || {}) }, videoUrl: common.video_url || "",
      organizer: common.organizer || emptyForm.organizer, contactEmail: common.contact_email || emptyForm.contactEmail, language: common.language || "nl",
      ctaLabel: common.cta?.label || emptyForm.ctaLabel, ctaUrl: common.cta?.url || distribution.source_url || "",
      ticketType: common.tickets?.type || "free", ticketPrice: common.tickets?.price || "0", capacity: common.tickets?.capacity || "",
      ticketVariations: Array.isArray(common.tickets?.variations)
        ? common.tickets.variations
        : [{ ...defaultTicketVariation, type: common.tickets?.type || "free", price: common.tickets?.price || "0", capacity: common.tickets?.capacity || "" }],
      preparePromotion: targetChannels.length > 0, channels,
      editorialTargets: {
        ...emptyEditorialTargets,
        ...Object.fromEntries((distribution.editorial_submissions || []).map((target) => [target.key, true])),
      },
      brevoSubject: payloads.brevo?.subject || "", brevoPreview: payloads.brevo?.preview_text || "", brevoAudience: payloads.brevo?.list_names?.join(", ") || payloads.brevo?.audience || "",
      facebookText: payloads.facebook?.text || "", facebookPlacements: payloads.facebook?.placements || ["feed"], instagramFormat: payloads.instagram?.format || "post", instagramCaption: payloads.instagram?.caption || "",
      tiktokCaption: payloads.tiktok?.caption || "", tiktokPrivacy: payloads.tiktok?.privacy || emptyForm.tiktokPrivacy, tiktokComments: payloads.tiktok?.comments_enabled ?? true,
      whatsappTemplate: payloads.whatsapp?.template_name || "", whatsappMessage: payloads.whatsapp?.message || "",
      googleTopic: payloads.google?.topic_type || (storedType === "event" ? "EVENT" : storedType === "offer" ? "OFFER" : "STANDARD"),
      predisType: payloads.predis?.content_type || "afbeelding", predisTone: payloads.predis?.tone || emptyForm.predisTone, predisGenerate: false,
      staggerEnabled: distribution.schedule_settings?.stagger_enabled ?? true,
      staggerMinMinutes: String(distribution.schedule_settings?.min_minutes ?? 15), staggerMaxMinutes: String(distribution.schedule_settings?.max_minutes ?? 45),
      regularPrice: commercial.regular_price || "", campaignPrice: commercial.campaign_price || "", discountCode: commercial.discount_code || "",
      validFrom: commercial.valid_from || "", validUntil: commercial.valid_until || "", groupSize: commercial.group_size || "", pricePerPerson: commercial.price_per_person || "",
      reviewerName: review.reviewer_name || "", reviewScore: review.score || "5", reviewSource: review.source || "",
    });
    setEditingCampaignId(item.id);
    setEventWorkspaceView("new");
    setEditingWebsiteEvent(isWebsiteEvent ? { eventId: distribution.eventin_event_id, campaignId: item.id, url: distribution.source_url, calendarDelivery: distribution.calendar_delivery || null } : null);
    setEditingBrevoDraftId(distribution.provider_delivery?.brevo?.draft_id || null);
    setSelectedBrevoListIds((payloads.brevo?.list_ids || []).map(String));
    setSelectedFacebookGroupIds((payloads.facebook?.group_sharing?.groups || []).map((group) => String(group.id)));
    setPendingPredisGeneration(null);
    setPreview(false);
    setResult({ ok: true, message: isWebsiteEvent ? "Het website-evenement is geopend voor bewerking. Opslaan werkt hetzelfde Eventin-evenement en het bestaande marketingdossier bij." : "Het campagneconcept is geopend en kan nu op dezelfde plek worden bijgewerkt." });
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function duplicateCampaignConcept(item) {
    openCampaignConcept(item, true);
    setEditingCampaignId(null);
    setEditingWebsiteEvent(null);
    setEditingBrevoDraftId(null);
    setPendingPredisGeneration(null);
    setResult({ ok: true, message: "Het concept is als kopie geopend. Pas eventueel de naam of inhoud aan en sla het op als nieuw concept." });
  }

  async function deleteCampaignConcept(item) {
    const distribution = (item.media || []).find((entry) => entry?.kind === "campaign_distribution") || {};
    const completedFacebookGroups = facebookGroupShareProgress[item.id]?.completed || [];
    if (completedFacebookGroups.length > 0) {
      return setResult({
        ok: false,
        message: "Dit dossier bevat handmatig bevestigde plaatsingen in Facebookgroepen. Verwijder die berichten eerst in Facebook en zet daarna de groepsvoortgang terug; pas dan kan het Horeca OS-dossier veilig worden verwijderd.",
      });
    }
    const deletionBlockReason = campaignDeletionBlockReason(item, distribution);
    if (deletionBlockReason) return setResult({ ok: false, message: deletionBlockReason });
    const title = distribution.common?.title || "dit concept";
    const brevoDraftId = distribution.provider_delivery?.brevo?.draft_id;
    if (!window.confirm(`Weet je zeker dat je ${title} wilt verwijderen?${brevoDraftId ? " Het gekoppelde Brevo-concept wordt eveneens verwijderd." : ""} Een bestaand website-evenement blijft staan.`)) return;
    setConceptBusyId(item.id);
    setResult(null);
    try {
      if (brevoDraftId) {
        const brevoResponse = await fetch("/api/integrations/brevo", {
          method: "DELETE",
          headers: { Authorization: `Bearer ${session.access_token}`, "Content-Type": "application/json" },
          body: JSON.stringify({ id: brevoDraftId, workspaceId, businessId: item.business_id || selectedBusiness?.id || businessId }),
        });
        const brevoResult = await brevoResponse.json().catch(() => ({}));
        if (!brevoResponse.ok) throw new Error(brevoResult.error || "Het gekoppelde Brevo-concept kon niet worden verwijderd.");
      }
      const { error } = await supabase.from("social_content_items").delete().eq("id", item.id).eq("workspace_id", workspaceId);
      if (error) throw error;
      if (editingCampaignId === item.id) { setEditingCampaignId(null); setEditingWebsiteEvent(null); }
      setResult({ ok: true, message: "Het marketingconcept is verwijderd. Een gekoppeld website-evenement is niet gewijzigd." });
      await loadEventCampaigns();
    } catch (error) {
      setResult({ ok: false, message: error.message || "Het concept kon niet worden verwijderd." });
    } finally {
      setConceptBusyId(null);
    }
  }

  async function cleanupDeletedWebsiteEvent(item) {
    const distribution = (item.media || []).find((entry) => entry?.kind === "campaign_distribution") || {};
    const title = distribution.common?.title || "dit verwijderde evenement";
    if (!window.confirm(`Dossier van ${title} definitief opruimen? Een nog gekoppelde Microsoft-afspraak wordt eveneens verwijderd.`)) return;
    setConceptBusyId(item.id);
    setResult(null);
    try {
      const calendarDelivery = distribution.calendar_delivery || {};
      if (calendarDelivery.event_id && calendarDelivery.mailbox && calendarDelivery.status !== "deleted") {
        const calendarResponse = await fetch("/api/integrations/microsoft/calendar/action", {
          method: "DELETE",
          headers: { Authorization: `Bearer ${session.access_token}`, "Content-Type": "application/json" },
          body: JSON.stringify({ workspaceId, mailbox: calendarDelivery.mailbox, eventId: calendarDelivery.event_id }),
        });
        const calendarResult = await calendarResponse.json().catch(() => ({}));
        if (!calendarResponse.ok) throw new Error(calendarResult.error || "De gekoppelde agenda-afspraak kon niet worden verwijderd.");
      }
      const { error } = await supabase.from("social_content_items").delete().eq("id", item.id).eq("workspace_id", workspaceId);
      if (error) throw error;
      if (editingCampaignId === item.id) { setEditingCampaignId(null); setEditingWebsiteEvent(null); }
      setResult({ ok: true, message: "Het achtergebleven Horeca OS-dossier en de gekoppelde agenda-afspraak zijn opgeruimd." });
      await loadEventCampaigns();
    } catch (error) {
      setResult({ ok: false, message: error.message || "Het achtergebleven dossier kon niet veilig worden opgeruimd." });
    } finally {
      setConceptBusyId(null);
    }
  }

  async function setConceptApproval(item, approved) {
    const distribution = (item.media || []).find((entry) => entry?.kind === "campaign_distribution") || {};
    if (distributionHasProviderConfirmation(distribution)) {
      return setResult({ ok: false, message: "Deze geplaatste campagne is vergrendeld. Dupliceer haar om een nieuwe versie te maken." });
    }
    const incompleteChannels = channelsNeedingDetails(distribution);
    if (approved && incompleteChannels.length > 0) {
      return setResult({ ok: false, message: `Vul eerst de ontbrekende gegevens aan voor: ${formatChannelList(incompleteChannels)}.` });
    }
    const nextChannelStatus = Object.fromEntries((distribution.target_channels || []).map((channel) => {
      const current = distribution.channel_status?.[channel];
      return [channel, current === "extra_gegevens_nodig" ? current : approved ? "goedgekeurd" : "klaar_voor_controle"];
    }));
    const nextDistribution = {
      ...distribution,
      channel_status: nextChannelStatus,
      ...(approved ? {} : { channel_schedule: {}, scheduling_status: "draft" }),
    };
    const nextMedia = (item.media || []).map((entry) => entry?.kind === "campaign_distribution" ? nextDistribution : entry);
    setConceptBusyId(item.id);
    setResult(null);
    try {
      const { error } = await supabase.from("social_content_items").update({ status: "draft", workflow_status: approved ? "in_progress" : "new", scheduled_for: approved ? item.scheduled_for : null, media: nextMedia }).eq("id", item.id).eq("workspace_id", workspaceId);
      if (error) throw error;
      setResult({ ok: true, message: approved ? "Het campagneconcept is goedgekeurd. Er is nog niets gepubliceerd." : "De goedkeuring is ingetrokken. Het item staat weer als concept klaar." });
      await loadEventCampaigns();
    } catch (error) {
      setResult({ ok: false, message: error.message || "De conceptstatus kon niet worden aangepast." });
    } finally {
      setConceptBusyId(null);
    }
  }

  async function scheduleConcept(item, cancel = false) {
    const distribution = (item.media || []).find((entry) => entry?.kind === "campaign_distribution") || {};
    if (distributionHasProviderConfirmation(distribution)) {
      return setResult({ ok: false, message: "De planning van een bevestigde plaatsing kan niet meer worden gewijzigd. Dupliceer de campagne voor een nieuwe planning." });
    }
    const incompleteChannels = channelsNeedingDetails(distribution);
    if (!cancel && incompleteChannels.length > 0) {
      return setResult({ ok: false, message: `Inplannen kan pas nadat deze kanalen zijn aangevuld: ${formatChannelList(incompleteChannels)}.` });
    }
    const localValue = conceptSchedule[item.id] || {};
    if (!cancel && (!localValue.date || !localValue.time)) return setResult({ ok: false, message: "Kies eerst een datum en tijd voor deze campagne." });
    const scheduledFor = cancel ? null : new Date(`${localValue.date}T${localValue.time}`);
    if (!cancel && (Number.isNaN(scheduledFor.getTime()) || scheduledFor <= new Date())) return setResult({ ok: false, message: "Kies een geldig publicatiemoment in de toekomst." });
    const nextChannelStatus = Object.fromEntries((distribution.target_channels || []).map((channel) => {
      const current = distribution.channel_status?.[channel];
      return [channel, current === "extra_gegevens_nodig" ? current : cancel ? "goedgekeurd" : "ingepland"];
    }));
    const scheduledIso = cancel ? null : scheduledFor.toISOString();
    const scheduleSettings = distribution.schedule_settings || {};
    const nextSchedule = cancel ? {} : buildChannelSchedule(
      distribution.target_channels || [],
      scheduledFor,
      Number(scheduleSettings.min_minutes ?? 15),
      Number(scheduleSettings.max_minutes ?? 45),
      scheduleSettings.stagger_enabled ?? true,
    );
    const nextProviderDelivery = Object.fromEntries((distribution.target_channels || []).map((channel) => [
      channel,
      distribution.provider_delivery?.[channel] || { status: "not_submitted" },
    ]));
    const nextDistribution = {
      ...distribution,
      channel_status: nextChannelStatus,
      channel_schedule: nextSchedule,
      provider_delivery: nextProviderDelivery,
      scheduling_status: cancel ? "approved" : "lokaal_ingepland",
    };
    const nextMedia = (item.media || []).map((entry) => entry?.kind === "campaign_distribution" ? nextDistribution : entry);
    setConceptBusyId(item.id);
    setResult(null);
    try {
      const { error } = await supabase.from("social_content_items").update({ status: cancel ? "draft" : "scheduled", workflow_status: "in_progress", scheduled_for: scheduledIso, media: nextMedia }).eq("id", item.id).eq("workspace_id", workspaceId);
      if (error) throw error;
      setResult({ ok: true, message: cancel ? "De planning is ingetrokken. De campagne blijft goedgekeurd, maar wordt niet gepubliceerd." : "De campagne is intern ingepland. Per kanaal is een apart tijdstip vastgelegd; pas na een bevestiging van het kanaal tonen we Geplaatst." });
      if (cancel) setConceptSchedule((current) => ({ ...current, [item.id]: { date: "", time: "" } }));
      await loadEventCampaigns();
    } catch (error) {
      setResult({ ok: false, message: error.message || "De planning kon niet worden opgeslagen." });
    } finally {
      setConceptBusyId(null);
    }
  }

  async function updateChannelPlanning(item, channel, cancel = false) {
    const distribution = (item.media || []).find((entry) => entry?.kind === "campaign_distribution") || {};
    const delivery = distribution.provider_delivery?.[channel] || {};
    if (providerDeliveryConfirmed(delivery)) {
      return setResult({ ok: false, message: `${channelLabels[channel] || channel} heeft de plaatsing al bevestigd. Beheer deze publicatie via de plaatsingslink of rechtstreeks bij het kanaal.` });
    }
    const editKey = `${item.id}-${channel}`;
    const localValue = channelScheduleEdits[editKey] ?? toLocalDateTimeInput(distribution.channel_schedule?.[channel] || item.scheduled_for);
    if (!cancel && !localValue) return setResult({ ok: false, message: "Kies eerst een nieuw publicatiemoment voor dit kanaal." });
    const nextDate = cancel ? null : new Date(localValue);
    if (!cancel && (Number.isNaN(nextDate.getTime()) || nextDate <= new Date())) {
      return setResult({ ok: false, message: "Kies een geldig publicatiemoment in de toekomst." });
    }
    if (cancel && !window.confirm(`Planning voor ${channelLabels[channel] || channel} intrekken? Andere kanalen blijven ongewijzigd.`)) return;

    const storedSchedule = distribution.channel_schedule || {};
    const nextSchedule = Object.keys(storedSchedule).length > 0
      ? { ...storedSchedule }
      : Object.fromEntries((distribution.target_channels || [])
        .filter((targetChannel) => !providerDeliveryConfirmed(distribution.provider_delivery?.[targetChannel] || {}))
        .map((targetChannel) => [targetChannel, item.scheduled_for])
        .filter(([, value]) => Boolean(value)));
    if (cancel) delete nextSchedule[channel];
    else nextSchedule[channel] = nextDate.toISOString();
    const remainingDates = Object.values(nextSchedule)
      .map((value) => new Date(value))
      .filter((date) => !Number.isNaN(date.getTime()))
      .sort((left, right) => left - right);
    const nextChannelStatus = {
      ...(distribution.channel_status || {}),
      [channel]: cancel ? "goedgekeurd" : "ingepland",
    };
    const nextDistribution = {
      ...distribution,
      channel_status: nextChannelStatus,
      channel_schedule: nextSchedule,
      scheduling_status: remainingDates.length ? "lokaal_ingepland" : "approved",
    };
    const nextMedia = (item.media || []).map((entry) => entry?.kind === "campaign_distribution" ? nextDistribution : entry);
    setConceptBusyId(item.id);
    setResult(null);
    try {
      const { error } = await supabase.from("social_content_items")
        .update({ status: remainingDates.length ? "scheduled" : "draft", workflow_status: "in_progress", scheduled_for: remainingDates[0]?.toISOString() || null, media: nextMedia })
        .eq("id", item.id)
        .eq("workspace_id", workspaceId);
      if (error) throw error;
      setChannelScheduleEdits((current) => ({ ...current, [editKey]: cancel ? "" : localValue }));
      setResult({
        ok: true,
        message: cancel
          ? `De interne planning voor ${channelLabels[channel] || channel} is ingetrokken. Andere kanalen zijn niet gewijzigd.`
          : `Het publicatiemoment voor ${channelLabels[channel] || channel} is aangepast. Er is nog niets extern gewijzigd of gepubliceerd.`,
      });
      await loadEventCampaigns();
    } catch (error) {
      setResult({ ok: false, message: error.message || "De kanaalplanning kon niet worden aangepast." });
    } finally {
      setConceptBusyId(null);
    }
  }

  function showChannelManagementGuidance(channel, delivery) {
    const label = channelLabels[channel] || channel;
    const hasLink = Boolean(delivery?.permalink || delivery?.result_url);
    setResult({
      ok: true,
      message: hasLink
        ? `Open de bevestigde plaatsing bij ${label} om haar daar te bewerken of te verwijderen. Horeca OS markeert een externe plaatsing niet als geannuleerd zonder bevestiging van het kanaal.`
        : `${label} heeft de plaatsing bevestigd, maar geen beheerlink teruggegeven. Beheer of annuleer haar rechtstreeks in ${label}; Horeca OS bewaart de plaatsingshistorie.`,
    });
  }

  useEffect(() => {
    if (!selectedBusiness?.id) return;
    const defaults = defaultsForBusiness(selectedBusiness);
    const draftKey = workspaceId ? formDraftStorageKey(workspaceId, selectedBusiness.id) : "";
    let savedDraft = null;
    let savedForm = null;
    let savedUi = null;
    if (draftKey) {
      try {
        savedDraft = JSON.parse(window.localStorage.getItem(draftKey) || "null");
        savedForm = savedDraft?.form || null;
        savedUi = JSON.parse(window.localStorage.getItem(formUiStorageKey(workspaceId, selectedBusiness.id)) || "null");
      } catch {
        window.localStorage.removeItem(draftKey);
      }
    }
    setRestoredDraftKey("");
    setForm(savedForm ? {
      ...emptyForm,
      ...savedForm,
      images: { ...emptyImages, ...(savedForm.images || {}) },
      channels: { ...channelDefaults, ...(savedForm.channels || {}) },
      editorialTargets: { ...emptyEditorialTargets, ...(savedForm.editorialTargets || {}) },
    } : {
      ...emptyForm,
      images: { ...emptyImages },
      channels: { ...channelDefaults },
      editorialTargets: { ...emptyEditorialTargets },
      organizer: defaults.organizer,
      location: defaults.location,
      contactEmail: defaults.contactEmail,
    });
    setRestoredDraftKey(draftKey);
    setEditingCampaignId(null);
    setEditingWebsiteEvent(null);
    setEditingBrevoDraftId(null);
    setPendingPredisGeneration(null);
    setManagedWebsiteEvents([]);
    setManagedEventSearch("");
    setImportingEventId("");
    managedEventsRequestRef.current += 1;
    setManagedEventsLoading(false);
    setPreview(false);
    setResult(null);
    const restoredUi = savedUi || savedDraft?.ui || {};
    setEventWorkspaceView(restoredUi.eventWorkspaceView || (savedForm?.campaignType === "event" ? "new" : ""));
    setSavedEventPreviewId(restoredUi.savedEventPreviewId || null);
    if (Number.isFinite(restoredUi.scrollY)) {
      window.setTimeout(() => window.scrollTo({ top: restoredUi.scrollY, behavior: "auto" }), 0);
    }
  }, [selectedBusiness?.id, workspaceId]);

  useEffect(() => {
    const selectedBusinessId = selectedBusiness?.id || businessId;
    if (!workspaceId || !selectedBusinessId) return;
    if (editingCampaignId || editingWebsiteEvent) return;
    const draftKey = formDraftStorageKey(workspaceId, selectedBusinessId);
    if (restoredDraftKey !== draftKey) return;
    const timer = window.setTimeout(() => {
      try {
        saveCurrentFormDraft();
      } catch {
        // Het formulier blijft bruikbaar als lokale opslag door de browser wordt geweigerd.
      }
    }, 400);
    return () => window.clearTimeout(timer);
  }, [form, eventWorkspaceView, workspaceId, selectedBusiness?.id, businessId, restoredDraftKey, editingCampaignId, editingWebsiteEvent]);

  useEffect(() => {
    const preserveDraft = () => saveCurrentFormDraft();
    const preserveHiddenDraft = () => {
      if (document.visibilityState === "hidden") preserveDraft();
    };
    window.addEventListener("pagehide", preserveDraft);
    document.addEventListener("visibilitychange", preserveHiddenDraft);
    return () => {
      window.removeEventListener("pagehide", preserveDraft);
      document.removeEventListener("visibilitychange", preserveHiddenDraft);
    };
  }, [form, eventWorkspaceView, workspaceId, selectedBusiness?.id, businessId, editingCampaignId, editingWebsiteEvent]);

  useEffect(() => {
    if (!workspaceId || !selectedBusiness?.id) return;
    const timer = window.setTimeout(() => saveCurrentUiState(), 200);
    return () => window.clearTimeout(timer);
  }, [eventWorkspaceView, savedEventPreviewId, workspaceId, selectedBusiness?.id]);

  useEffect(() => {
    const selectedBusinessId = selectedBusiness?.id || businessId;
    if (!workspaceId || !selectedBusinessId) {
      setPredisBrandId("");
      setPredisConnected(false);
      return;
    }
    let active = true;
    const storageKey = `horeca-os:predis:${workspaceId}:${selectedBusinessId}`;
    setPredisBrandId("");
    setPredisConnected(false);
    setForm((current) => ({ ...current, predisGenerate: false }));
    setPendingPredisGeneration(null);
    const query = new URLSearchParams({ workspaceId, businessId: selectedBusinessId, config: "1" });
    fetch(`/api/integrations/predis?${query}`, { headers: { Authorization: `Bearer ${session.access_token}` } })
      .then(async (response) => ({ response, result: await response.json().catch(() => ({})) }))
      .then(({ response, result }) => {
        if (!active || !response.ok) return;
        const savedBrandId = result.connected ? result.brandId || "" : "";
        setPredisBrandId(savedBrandId);
        setPredisConnected(Boolean(savedBrandId));
        if (savedBrandId) {
          setForm((current) => formHasCampaignContent(current)
            ? current
            : { ...current, channels: { ...current.channels, predis: true } });
        }
        if (savedBrandId) window.localStorage.setItem(storageKey, savedBrandId);
      })
      .catch(() => {});
    return () => { active = false; };
  }, [workspaceId, selectedBusiness?.id, businessId, session.access_token]);

  useEffect(() => {
    const selectedBusinessId = selectedBusiness?.id || businessId;
    if (!workspaceId || !selectedBusinessId || !form.channels.brevo) {
      setBrevoLists([]);
      setSelectedBrevoListIds([]);
      setBrevoSenderEmail("");
      setBrevoError("");
      return;
    }
    let active = true;
    setBrevoLoading(true);
    setBrevoError("");
    const query = `workspaceId=${encodeURIComponent(workspaceId)}&businessId=${encodeURIComponent(selectedBusinessId)}&resource=lists`;
    fetch(`/api/integrations/brevo?${query}`, { headers: { Authorization: `Bearer ${session.access_token}` } })
      .then(async (response) => ({ ok: response.ok, result: await response.json().catch(() => ({})) }))
      .then(({ ok, result }) => {
        if (!active) return;
        if (!ok) {
          setBrevoLists([]);
          setSelectedBrevoListIds([]);
          setBrevoError(result.error || "De Brevo-doelgroepen konden niet worden geladen.");
          return;
        }
        const lists = result.lists || [];
        setBrevoLists(lists);
        setBrevoSenderEmail(result.senderEmail || "");
        setSelectedBrevoListIds((current) => current.filter((id) => lists.some((item) => String(item.id) === id)));
      })
      .catch(() => {
        if (!active) return;
        setBrevoLists([]);
        setSelectedBrevoListIds([]);
        setBrevoError("Brevo kon niet worden bereikt.");
      })
      .finally(() => { if (active) setBrevoLoading(false); });
    return () => { active = false; };
  }, [workspaceId, selectedBusiness?.id, businessId, form.channels.brevo, session.access_token]);

  useEffect(() => {
    const selectedBusinessId = selectedBusiness?.id || businessId;
    if (!workspaceId || !selectedBusinessId || !form.channels.facebook) {
      setFacebookGroups([]); setSelectedFacebookGroupIds([]); setFacebookGroupsError("");
      return;
    }
    let active = true;
    setFacebookGroupsLoading(true); setFacebookGroupsError("");
    const query = new URLSearchParams({ workspaceId, businessId: selectedBusinessId });
    fetch(`/api/integrations/facebook/groups?${query}`, { headers: { Authorization: `Bearer ${session.access_token}` } })
      .then(async (response) => ({ ok: response.ok, result: await response.json().catch(() => ({})) }))
      .then(({ ok, result }) => {
        if (!active) return;
        if (!ok) throw new Error(result.error || "De Facebookgroepen konden niet worden geladen.");
        setFacebookGroups(result.groups || []);
        setSelectedFacebookGroupIds((current) => current.filter((id) => (result.groups || []).some((group) => String(group.id) === id)));
      })
      .catch((error) => { if (active) setFacebookGroupsError(error.message); })
      .finally(() => { if (active) setFacebookGroupsLoading(false); });
    return () => { active = false; };
  }, [workspaceId, selectedBusiness?.id, businessId, form.channels.facebook, session.access_token]);

  useEffect(() => {
    const selectedBusinessId = selectedBusiness?.id || businessId;
    if (!workspaceId || !selectedBusinessId || !form.channels.facebook) {
      setFacebookGroupLists([]);
      return;
    }
    let active = true;
    const query = new URLSearchParams({ workspaceId, businessId: selectedBusinessId });
    fetch(`/api/integrations/facebook/group-lists?${query}`, { headers: { Authorization: `Bearer ${session.access_token}` } })
      .then(async (response) => ({ ok: response.ok, result: await response.json().catch(() => ({})) }))
      .then(({ ok, result }) => {
        if (!active) return;
        if (!ok) throw new Error(result.error || "De opgeslagen groepenlijsten konden niet worden geladen.");
        setFacebookGroupLists(result.lists || []);
      })
      .catch((error) => { if (active) setFacebookGroupsError(error.message); });
    return () => { active = false; };
  }, [workspaceId, selectedBusiness?.id, businessId, form.channels.facebook, session.access_token]);

  useEffect(() => {
    const selectedBusinessId = selectedBusiness?.id || businessId;
    if (!workspaceId || !selectedBusinessId) {
      setFacebookAccount(null);
      return;
    }
    let active = true;
    setFacebookAccountLoading(true);
    fetch(`/api/integrations/facebook?workspaceId=${encodeURIComponent(workspaceId)}`, {
      headers: { Authorization: `Bearer ${session.access_token}` },
    })
      .then(async (response) => ({ ok: response.ok, result: await response.json().catch(() => ({})) }))
      .then(({ ok, result }) => {
        if (!active) return;
        if (!ok) throw new Error(result.error || "De Facebookpagina kon niet worden gecontroleerd.");
        setFacebookAccount((result.accounts || []).find((account) => account.business_id === selectedBusinessId) || null);
      })
      .catch(() => { if (active) setFacebookAccount(null); })
      .finally(() => { if (active) setFacebookAccountLoading(false); });
    return () => { active = false; };
  }, [workspaceId, selectedBusiness?.id, businessId, session.access_token]);

  useEffect(() => { loadEventCampaigns(); }, [workspaceId, selectedBusiness?.id, businessId, conceptSort]);

  useEffect(() => {
    const selectedBusinessId = selectedBusiness?.id || businessId;
    if (!workspaceId || !selectedBusinessId) return;

    const campaignsWithoutImage = eventCampaigns.flatMap((item) => {
      const distribution = (item.media || []).find((entry) => entry?.kind === "campaign_distribution") || {};
      const storedImageUrl = distribution.common?.image_url
        || distribution.common?.images?.landscape?.url
        || distribution.common?.images?.square?.url
        || distribution.common?.images?.portrait?.url;
      const eventId = distribution.eventin_event_id;
      if (distribution.source_type !== "website_event"
        || distribution.website_event_status === "trash"
        || storedImageUrl
        || !eventId
        || eventThumbnailUrls[item.id]
        || eventThumbnailRequestsRef.current.has(item.id)) {
        return [];
      }
      return [{ campaignId: item.id, eventId }];
    });

    campaignsWithoutImage.forEach(({ campaignId, eventId }) => {
      eventThumbnailRequestsRef.current.add(campaignId);
      const query = new URLSearchParams({
        workspaceId,
        businessId: selectedBusinessId,
        site,
        eventId: String(eventId),
        campaignId: String(campaignId),
      });
      fetch(`/api/marketing/website-events/create?${query}`, {
        headers: { Authorization: `Bearer ${session.access_token}` },
      })
        .then(async (response) => ({ ok: response.ok, result: await response.json().catch(() => ({})) }))
        .then(({ ok, result }) => {
          if (!ok || !result.event?.imageUrl) return;
          setEventThumbnailUrls((current) => ({ ...current, [campaignId]: result.event.imageUrl }));
        })
        .catch(() => {
          eventThumbnailRequestsRef.current.delete(campaignId);
        });
    });
  }, [eventCampaigns, eventThumbnailUrls, workspaceId, selectedBusiness?.id, businessId, site, session.access_token]);

  const validate = () => {
    if (!form.title.trim()) return `Vul een naam in voor ${campaignTypeLabel.toLowerCase()}.`;
    if (isEvent && (!form.start || !form.end)) return "Vul een begin- en eindmoment in.";
    if (isEvent && !form.location.trim()) return "Vul de locatie van het evenement in.";
    if (isEvent && !form.contactEmail.trim()) return "Vul het contact-e-mailadres van de vestiging in.";
    if (isEvent && new Date(form.end) <= new Date(form.start)) return "Het eindmoment moet na het beginmoment liggen.";
    if (isEvent) {
      for (const ticket of form.ticketVariations || []) {
        if (!ticket.name?.trim()) return "Geef ieder tickettype een naam.";
        if (ticket.type === "paid" && Number(ticket.price) <= 0) return `Vul een geldige prijs in voor ${ticket.name}.`;
        if (ticket.capacity && Number(ticket.capacity) < 1) return `Vul een geldige capaciteit in voor ${ticket.name}.`;
        if (ticket.salesStart && ticket.salesEnd && new Date(ticket.salesEnd) <= new Date(ticket.salesStart)) return `De verkoopperiode van ${ticket.name} is niet geldig.`;
        if (Number(ticket.minQuantity || 1) < 1 || Number(ticket.maxQuantity || 1) < Number(ticket.minQuantity || 1)) return `Controleer de minimale en maximale afname van ${ticket.name}.`;
      }
    }
    if (form.campaignType === "offer" && (!form.campaignPrice || !form.validUntil)) return "Vul de actieprijs en einddatum in.";
    if (form.campaignType === "review" && !form.description.trim()) return "Vul de reviewtekst in.";
    if (form.preparePromotion && form.channels.brevo && !form.brevoSubject.trim()) return "Vul voor Brevo een onderwerpregel in.";
    if (form.preparePromotion && form.channels.brevo && !form.organizer.trim()) return "Vul voor Brevo een afzendernaam in.";
    if (form.preparePromotion && form.channels.brevo && !(form.description.trim() || form.shortDescription.trim())) return "Vul voor Brevo een promotietekst of volledige omschrijving in.";
    if (form.preparePromotion && form.channels.brevo && brevoLoading) return "Wacht tot de Brevo-doelgroepen zijn geladen.";
    if (form.preparePromotion && form.channels.brevo && brevoError) return brevoError;
    if (form.preparePromotion && form.channels.brevo && selectedBrevoListIds.length === 0) return "Kies voor Brevo minimaal één doelgroep.";
    if (form.preparePromotion && form.channels.facebook && !(form.facebookPlacements || []).length) return "Kies voor Facebook minimaal Feed, Verhaal of Reel.";
    if (form.preparePromotion && form.channels.tiktok && !form.videoUrl.trim()) return "TikTok heeft een videolink nodig.";
    if (form.preparePromotion && form.channels.whatsapp && !form.whatsappTemplate.trim()) return "WhatsApp heeft voor geplande verzending een goedgekeurde templatenaam nodig.";
    if (form.preparePromotion && form.channels.google && !form.shortDescription.trim()) return "Google heeft een korte promotietekst nodig.";
    if (form.preparePromotion && form.channels.google && !isEvent && !form.ctaUrl.trim()) return "Google heeft een knoplink nodig.";
    if (form.preparePromotion && form.channels.predis && form.predisGenerate && (!predisConnected || !predisBrandId)) return "Koppel voor deze vestiging eerst een Predis-merk onder Koppelingen.";
    if (form.preparePromotion && form.channels.predis && form.predisGenerate && (form.description.trim().length < 20 || form.description.trim().split(/\s+/).length < 3)) return "Beschrijf voor Predis de campagne met minimaal 20 tekens en 3 woorden.";
    if (form.preparePromotion && form.staggerEnabled && (Number(form.staggerMinMinutes) < 1 || Number(form.staggerMaxMinutes) < 1)) return "Vul voor de spreiding minimaal 1 minuut in.";
    if (form.preparePromotion && form.staggerEnabled && Number(form.staggerMinMinutes) > Number(form.staggerMaxMinutes)) return "De minimale spreiding kan niet hoger zijn dan de maximale spreiding.";
    if (!mediaReady) return `Vul eerst alle kanaalmedia in: ${channelMediaIssues.join(" ")}`;
    return "";
  };

  const showPreview = () => { const error = validate(); if (error) return setResult({ ok: false, message: error }); setResult(null); setPreviewChannel(""); setPreview(true); };
  const showChannelPreview = (channel) => {
    if (!form.title.trim()) return setResult({ ok: false, message: "Vul eerst de evenementnaam in." });
    if (channel === "eventin" && (!form.start || !form.end || !form.location.trim())) return setResult({ ok: false, message: "Vul voor de Eventin-controle eerst datum, tijd en locatie in." });
    if (channel === "email" && !(form.shortDescription.trim() || form.description.trim())) return setResult({ ok: false, message: "Vul voor de e-mailcontrole eerst een korte promotietekst of volledige omschrijving in." });
    if (channel === "google" && !form.shortDescription.trim()) return setResult({ ok: false, message: "Vul voor Google eerst de korte promotietekst in." });
    setResult(null);
    setPreviewChannel(channel);
    setPreview(true);
    window.requestAnimationFrame(() => document.getElementById("kanaal-controle")?.scrollIntoView({ behavior: "smooth", block: "center" }));
  };

  async function saveIncompleteDraft() {
    if (!form.title.trim()) return setResult({ ok: false, message: `Vul minimaal een naam in voor ${campaignTypeLabel.toLowerCase()}.` });
    if (!(form.shortDescription.trim() || form.description.trim())) return setResult({ ok: false, message: "Vul minimaal een korte promotietekst of volledige omschrijving in." });
    setBusy(true);
    setResult(null);
    try {
      const integration = await campaignAccountForBusiness(selectedBusiness?.id || businessId);
      if (!integration?.id) throw new Error("Het interne marketingconcept kan niet worden opgeslagen: marketingkoppeling ontbreekt.");

      const imageFor = (key, fallbackKeys = []) => form.images?.[key]?.url || fallbackKeys.map((item) => form.images?.[item]?.url).find(Boolean) || form.imageUrl.trim();
      const common = {
        campaign_type: form.campaignType,
        title: form.title.trim(), short_description: form.shortDescription.trim(), description: form.description.trim(),
        start: form.start, end: form.end, location: form.location.trim(), image_url: imageFor("landscape", ["square", "portrait", "vertical"]), images: form.images, video_url: form.videoUrl.trim(),
        organizer: form.organizer.trim(), contact_email: form.contactEmail.trim(), language: form.language,
        cta: { label: form.ctaLabel, url: form.ctaUrl.trim() },
        tickets: { type: form.ticketType, price: form.ticketPrice, capacity: form.capacity, variations: form.ticketVariations || [] }, website_url: "",
        commercial: { regular_price: form.regularPrice, campaign_price: form.campaignPrice, discount_code: form.discountCode, valid_from: form.validFrom, valid_until: form.validUntil, group_size: form.groupSize, price_per_person: form.pricePerPerson },
        review: { reviewer_name: form.reviewerName.trim(), score: form.reviewScore, source: form.reviewSource.trim() },
      };
      const channel_payloads = {
        brevo: {
          subject: form.brevoSubject.trim(), preview_text: form.brevoPreview.trim(),
          audience: selectedBrevoLists.map((item) => item.name).join(", "),
          list_ids: selectedBrevoListIds.map(Number), list_names: selectedBrevoLists.map((item) => item.name),
          recipient_count: brevoRecipientCount, sender_email: brevoSenderEmail,
          image_url: imageFor("landscape", ["square"]),
        },
        facebook: { text: form.facebookText.trim() || form.shortDescription.trim() || form.description.trim(), cta: common.cta, image_url: imageFor("landscape", ["square"]), placements: form.facebookPlacements, destination: facebookAccount ? { business_id: selectedBusiness?.id || businessId, page_id: facebookAccount.external_account_id, page_name: facebookAccount.display_name } : null, group_sharing: { mode: "guided", business_id: selectedBusiness?.id || businessId, groups: facebookGroups.filter((group) => selectedFacebookGroupIds.includes(String(group.id))).map((group) => ({ id: group.id, name: group.name, url: group.group_url, sender_page_id: group.sender_page_id, sender_page_name: group.sender_page_name, sender_verified_at: group.sender_verified_at })) } },
        instagram: { format: form.instagramFormat, caption: form.instagramCaption.trim() || form.shortDescription.trim() || form.description.trim(), image_url: form.instagramFormat === "reel" || form.instagramFormat === "story" ? imageFor("vertical", ["portrait", "square"]) : imageFor("portrait", ["square", "vertical"]) },
        tiktok: { caption: form.tiktokCaption.trim() || form.shortDescription.trim() || form.description.trim(), privacy: form.tiktokPrivacy, comments_enabled: form.tiktokComments, image_url: imageFor("vertical", ["portrait"]) },
        whatsapp: { template_name: form.whatsappTemplate.trim(), message: form.whatsappMessage.trim() || form.shortDescription.trim() || form.description.trim(), image_url: imageFor("vertical", ["landscape", "square"]) },
        google: { topic_type: form.googleTopic, summary: form.shortDescription.trim(), event: { title: form.title.trim(), start: form.start, end: form.end }, call_to_action: common.cta, image_url: imageFor("landscape", ["square"]) },
        predis: { content_type: form.predisType, tone: form.predisTone.trim(), prompt: form.description.trim() || form.shortDescription.trim(), images: form.images, generate_requested: false, brand_id: "" },
      };
      const baseDetailsMissing = (isEvent && (!form.start || !form.end || !form.location.trim() || !form.contactEmail.trim()))
        || (form.campaignType === "offer" && (!form.campaignPrice || !form.validUntil))
        || (form.campaignType === "review" && !form.description.trim());
      const channel_status = Object.fromEntries(enabledChannels.map((channel) => {
        const payload = channel_payloads[channel] || {};
        const media = channelImagePreviews.find((item) => item.channel === channel);
        const videoRequired = channel === "tiktok"
          || (channel === "instagram" && form.instagramFormat === "reel")
          || (channel === "predis" && form.predisType === "video");
        const mediaMissing = videoRequired ? !common.video_url : !media?.imageUrl;
        const detailsMissing = (channel === "brevo" && (!payload.subject || !payload.audience || !common.organizer))
          || (channel === "facebook" && !(payload.placements || []).length)
          || (channel === "whatsapp" && !payload.template_name)
          || (channel === "google" && (!payload.summary || !payload.call_to_action?.url));
        return [channel, baseDetailsMissing || mediaMissing || detailsMissing ? "extra_gegevens_nodig" : "klaar_voor_controle"];
      }));
      const provider_delivery = Object.fromEntries(enabledChannels.map((channel) => [channel, { status: "not_submitted" }]));
      const distribution = {
        kind: "campaign_distribution", source_type: form.campaignType, source_url: form.ctaUrl.trim(),
        eventin_event_id: null, common, target_channels: enabledChannels, channel_payloads, channel_status,
        editorial_submissions: editorialAgendaTargets.filter(({ key }) => form.editorialTargets?.[key]).map((target) => ({ ...target, status: "ready" })),
        schedule_settings: { stagger_enabled: form.staggerEnabled, min_minutes: Number(form.staggerMinMinutes) || 15, max_minutes: Number(form.staggerMaxMinutes) || 45 },
        channel_schedule: {}, provider_delivery, scheduling_status: "draft",
      };
      const record = {
        account_id: integration.id, business_id: selectedBusiness?.id || businessId || null,
        content_type: "post", direction: "outbound", body: form.description.trim() || form.shortDescription.trim(),
        media: [distribution], status: "draft", workflow_status: "new", scheduled_for: null, created_by: session.user.id,
      };
      const { error } = editingCampaignId
        ? await supabase.from("social_content_items").update(record).eq("id", editingCampaignId).eq("workspace_id", workspaceId)
        : await supabase.from("social_content_items").insert({ ...record, workspace_id: workspaceId });
      if (error) throw error;
      setResult({ ok: true, message: `${campaignTypeLabel} is intern als vroeg concept opgeslagen. Er is niets gepubliceerd, verzonden of ingepland.` });
      setEditingCampaignId(null);
      setEditingWebsiteEvent(null);
      setPreview(false);
      await loadEventCampaigns();
    } catch (error) {
      setResult({ ok: false, message: error.message || "Het vroege concept kon niet worden opgeslagen." });
    } finally {
      setBusy(false);
    }
  }

  async function createPromotionDraft(websiteEvent, calendarDelivery = null) {
    const integration = await campaignAccountForBusiness(selectedBusiness?.id || businessId);
    if (!integration?.id) return { warning: "Promotieconcept kon niet worden opgeslagen: marketingkoppeling ontbreekt." };
    const imageFor = (key, fallbackKeys = []) => form.images?.[key]?.url || fallbackKeys.map((item) => form.images?.[item]?.url).find(Boolean) || form.imageUrl.trim();
    const common = {
      campaign_type: form.campaignType,
      title: form.title.trim(), short_description: form.shortDescription.trim(), description: form.description.trim(),
      start: form.start, end: form.end, location: form.location.trim(), image_url: imageFor("landscape", ["square", "portrait", "vertical"]), images: form.images, video_url: form.videoUrl.trim(),
      organizer: form.organizer.trim(), contact_email: form.contactEmail.trim(), language: form.language,
      cta: { label: form.ctaLabel, url: form.ctaUrl.trim() || websiteEvent.url },
      tickets: { type: form.ticketType, price: form.ticketPrice, capacity: form.capacity, variations: form.ticketVariations || [] }, website_url: websiteEvent.url,
      commercial: { regular_price: form.regularPrice, campaign_price: form.campaignPrice, discount_code: form.discountCode, valid_from: form.validFrom, valid_until: form.validUntil, group_size: form.groupSize, price_per_person: form.pricePerPerson },
      review: { reviewer_name: form.reviewerName.trim(), score: form.reviewScore, source: form.reviewSource.trim() },
    };
    const channel_payloads = {
      brevo: {
        subject: form.brevoSubject.trim(), preview_text: form.brevoPreview.trim(),
        audience: selectedBrevoLists.map((item) => item.name).join(", "),
        list_ids: selectedBrevoListIds.map(Number), list_names: selectedBrevoLists.map((item) => item.name),
        recipient_count: brevoRecipientCount, sender_email: brevoSenderEmail,
        image_url: imageFor("landscape", ["square"]),
      },
      facebook: { text: form.facebookText.trim() || form.shortDescription.trim(), cta: common.cta, image_url: imageFor("landscape", ["square"]), placements: form.facebookPlacements, destination: facebookAccount ? { business_id: selectedBusiness?.id || businessId, page_id: facebookAccount.external_account_id, page_name: facebookAccount.display_name } : null, group_sharing: { mode: "guided", business_id: selectedBusiness?.id || businessId, groups: facebookGroups.filter((group) => selectedFacebookGroupIds.includes(String(group.id))).map((group) => ({ id: group.id, name: group.name, url: group.group_url, sender_page_id: group.sender_page_id, sender_page_name: group.sender_page_name, sender_verified_at: group.sender_verified_at })) } },
      instagram: { format: form.instagramFormat, caption: form.instagramCaption.trim() || form.shortDescription.trim(), image_url: form.instagramFormat === "reel" || form.instagramFormat === "story" ? imageFor("vertical", ["portrait", "square"]) : imageFor("portrait", ["square", "vertical"]) },
      tiktok: { caption: form.tiktokCaption.trim() || form.shortDescription.trim(), privacy: form.tiktokPrivacy, comments_enabled: form.tiktokComments, image_url: imageFor("vertical", ["portrait"]) },
      whatsapp: { template_name: form.whatsappTemplate.trim(), message: form.whatsappMessage.trim() || form.shortDescription.trim(), image_url: imageFor("vertical", ["landscape", "square"]) },
      google: { topic_type: form.googleTopic, summary: form.shortDescription.trim(), event: { title: form.title.trim(), start: form.start, end: form.end }, call_to_action: common.cta, image_url: imageFor("landscape", ["square"]) },
      predis: { content_type: form.predisType, tone: form.predisTone.trim(), prompt: form.description.trim(), images: form.images, generate_requested: form.predisGenerate && predisConnected, brand_id: form.predisGenerate && predisConnected ? predisBrandId : "" },
    };
    const channel_status = Object.fromEntries(enabledChannels.map((channel) => {
      const payload = channel_payloads[channel] || {};
      const missing = (channel === "brevo" && (!payload.subject || !payload.audience)) ||
        (channel === "tiktok" && !common.video_url) || (channel === "whatsapp" && !payload.template_name) ||
        (channel === "google" && (!payload.summary || !payload.call_to_action?.url));
      return [channel, missing ? "extra_gegevens_nodig" : "klaar_voor_controle"];
    }));
    let brevoDraft = null;
    if (form.preparePromotion && form.channels.brevo) {
      const brevoResponse = await fetch("/api/integrations/brevo", {
        method: editingBrevoDraftId ? "PATCH" : "POST",
        headers: { Authorization: `Bearer ${session.access_token}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          id: editingBrevoDraftId || undefined,
          workspaceId,
          businessId: selectedBusiness?.id || businessId,
          listIds: selectedBrevoListIds.map(Number),
          campaignName: form.title.trim(),
          senderName: form.organizer.trim(),
          subject: form.brevoSubject.trim(),
          content: form.description.trim() || form.shortDescription.trim(),
        }),
      }).catch(() => null);
      const brevoResult = brevoResponse ? await brevoResponse.json().catch(() => ({})) : {};
      if (!brevoResponse?.ok) return { warning: brevoResult.error || "Het Brevo-concept kon niet worden opgeslagen." };
      brevoDraft = brevoResult.draft;
      setEditingBrevoDraftId(brevoDraft.id);
    }
    let predisGeneration = form.preparePromotion && form.channels.predis && form.predisGenerate && predisConnected ? pendingPredisGeneration : null;
    if (form.preparePromotion && form.channels.predis && form.predisGenerate && predisConnected && !predisGeneration) {
      const predisResponse = await fetch("/api/integrations/predis", {
        method: "POST",
        headers: { Authorization: `Bearer ${session.access_token}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          workspaceId,
          businessId: selectedBusiness?.id || businessId,
          brandId: predisBrandId,
          prompt: `${form.description.trim()}\n\nToon: ${form.predisTone.trim()}`,
          mediaType: form.predisType === "video" ? "video" : form.predisType === "carousel" ? "carousel" : "single_image",
        }),
      }).catch(() => null);
      const predisResult = predisResponse ? await predisResponse.json().catch(() => ({})) : {};
      if (!predisResponse?.ok) return { warning: predisResult.error || "Het Predis-concept kon niet worden gestart." };
      predisGeneration = { post_ids: (predisResult.postIds || []).map(String), status: predisResult.status || "inProgress" };
      setPendingPredisGeneration(predisGeneration);
    }
    const providerDelivery = Object.fromEntries(enabledChannels.map((channel) => [
      channel,
      channel === "brevo" && brevoDraft
        ? { status: "draft_saved", draft_id: brevoDraft.id, recipient_count: brevoDraft.recipient_count }
        : channel === "predis" && predisGeneration
          ? { status: "generating", post_ids: predisGeneration.post_ids, provider_status: predisGeneration.status }
          : { status: "not_submitted" },
    ]));
    const distribution = { kind: "campaign_distribution", source_type: isEvent ? "website_event" : form.campaignType, source_url: websiteEvent.url,
      eventin_event_id: websiteEvent.id, website_event_status: websiteEvent.status || "draft", common, target_channels: enabledChannels, channel_payloads, channel_status,
      editorial_submissions: editorialAgendaTargets.filter(({ key }) => form.editorialTargets?.[key]).map((target) => ({ ...target, status: "ready" })),
      schedule_settings: { stagger_enabled: form.staggerEnabled, min_minutes: Number(form.staggerMinMinutes) || 15, max_minutes: Number(form.staggerMaxMinutes) || 45 },
      channel_schedule: {}, provider_delivery: providerDelivery, calendar_delivery: calendarDelivery };
    const record = {
      account_id: integration.id, business_id: selectedBusiness?.id || businessId || null,
      content_type: "post", direction: "outbound", body: form.description.trim() || form.shortDescription.trim(),
      media: [distribution], status: "draft", workflow_status: "new", scheduled_for: null, created_by: session.user.id,
    };
    const { error } = editingCampaignId
      ? await supabase.from("social_content_items").update(record).eq("id", editingCampaignId).eq("workspace_id", workspaceId)
      : await supabase.from("social_content_items").insert({ ...record, workspace_id: workspaceId });
    return error ? { warning: "Het evenement staat op de website, maar het promotieconcept kon niet worden opgeslagen." } : { ok: true };
  }

  async function publishFacebookCampaign(item) {
    const distribution = (item.media || []).find((entry) => entry?.kind === "campaign_distribution") || {};
    const title = distribution.common?.title || "dit evenement";
    if (!window.confirm(`Plaats “${title}” nu echt op de gekoppelde Facebookpagina?`)) return;
    setConceptBusyId(item.id);
    setResult(null);
    try {
      const response = await fetch("/api/integrations/facebook/publish", {
        method: "POST",
        headers: { Authorization: `Bearer ${session.access_token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ workspaceId, businessId: item.business_id || selectedBusiness?.id || businessId, campaignId: item.id }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Het Facebookbericht kon niet worden geplaatst.");
      if (result.distribution) {
        setEventCampaigns((current) => current.map((campaign) => campaign.id === item.id
          ? { ...campaign, media: (campaign.media || []).map((entry) => entry?.kind === "campaign_distribution" ? result.distribution : entry) }
          : campaign));
      }
      setResult({ ok: true, message: `Het evenement is op ${result.post?.pageName || "Facebook"} geplaatst.` });
      await loadEventCampaigns();
    } catch (error) {
      setResult({ ok: false, message: error.message || "Het Facebookbericht kon niet worden geplaatst." });
    } finally {
      setConceptBusyId(null);
    }
  }

  async function saveFacebookGroup() {
    const selectedBusinessId = selectedBusiness?.id || businessId;
    setFacebookGroupsError("");
    try {
      const response = await fetch("/api/integrations/facebook/groups", {
        method: "POST",
        headers: { Authorization: `Bearer ${session.access_token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ workspaceId, businessId: selectedBusinessId, name: newFacebookGroup.name, groupUrl: newFacebookGroup.url }),
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(result.error || "De Facebookgroep kon niet worden opgeslagen.");
      setFacebookGroups((current) => [...current, result.group].sort((a, b) => a.name.localeCompare(b.name, "nl")));
      setSelectedFacebookGroupIds((current) => [...new Set([...current, String(result.group.id)])]);
      setNewFacebookGroup({ name: "", url: "" });
    } catch (error) { setFacebookGroupsError(error.message); }
  }

  async function removeFacebookGroup(group) {
    if (!window.confirm(`Verwijder “${group.name}” uit de keuzelijst? Bestaande dossiers blijven ongewijzigd.`)) return;
    const response = await fetch("/api/integrations/facebook/groups", {
      method: "DELETE",
      headers: { Authorization: `Bearer ${session.access_token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ workspaceId, businessId: selectedBusiness?.id || businessId, groupId: group.id }),
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) return setFacebookGroupsError(result.error || "De Facebookgroep kon niet worden verwijderd.");
    setFacebookGroups((current) => current.filter((item) => item.id !== group.id));
    setSelectedFacebookGroupIds((current) => current.filter((id) => id !== String(group.id)));
  }

  async function saveFacebookGroupList() {
    const name = facebookGroupListName.trim();
    if (!name) return setFacebookGroupsError("Geef de lijst eerst een naam, bijvoorbeeld Karaoke of Wedding.");
    if (!selectedFacebookGroupIds.length) return setFacebookGroupsError("Vink eerst minimaal één Facebookgroep aan.");
    setFacebookGroupListsBusy(true); setFacebookGroupsError("");
    try {
      const response = await fetch("/api/integrations/facebook/group-lists", {
        method: "POST",
        headers: { Authorization: `Bearer ${session.access_token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ workspaceId, businessId: selectedBusiness?.id || businessId, name, groupIds: selectedFacebookGroupIds }),
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(result.error || "De groepenlijst kon niet worden opgeslagen.");
      setFacebookGroupLists((current) => [...current, result.list].sort((a, b) => a.name.localeCompare(b.name, "nl")));
      setFacebookGroupListName("");
      setResult({ ok: true, message: `De lijst “${result.list.name}” is opgeslagen met ${result.list.group_ids.length} Facebookgroepen.` });
    } catch (error) { setFacebookGroupsError(error.message); }
    finally { setFacebookGroupListsBusy(false); }
  }

  function applyFacebookGroupList(list) {
    const availableIds = new Set(facebookGroups.map((group) => String(group.id)));
    const ids = (list.group_ids || []).map(String).filter((id) => availableIds.has(id));
    setSelectedFacebookGroupIds(ids);
    setResult({ ok: true, message: `De lijst “${list.name}” is toegepast. Je kunt de ${ids.length} vinkjes nog aanpassen.` });
  }

  async function updateFacebookGroupList(list) {
    if (!selectedFacebookGroupIds.length) return setFacebookGroupsError("Vink eerst minimaal één Facebookgroep aan.");
    setFacebookGroupListsBusy(true); setFacebookGroupsError("");
    try {
      const response = await fetch("/api/integrations/facebook/group-lists", {
        method: "PATCH",
        headers: { Authorization: `Bearer ${session.access_token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ workspaceId, businessId: selectedBusiness?.id || businessId, listId: list.id, groupIds: selectedFacebookGroupIds }),
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(result.error || "De groepenlijst kon niet worden bijgewerkt.");
      setFacebookGroupLists((current) => current.map((item) => item.id === list.id ? result.list : item));
      setResult({ ok: true, message: `De lijst “${list.name}” bevat nu ${result.list.group_ids.length} Facebookgroepen.` });
    } catch (error) { setFacebookGroupsError(error.message); }
    finally { setFacebookGroupListsBusy(false); }
  }

  async function removeFacebookGroupList(list) {
    if (!window.confirm(`Verwijder de opgeslagen lijst “${list.name}”? De Facebookgroepen zelf blijven bestaan.`)) return;
    setFacebookGroupListsBusy(true); setFacebookGroupsError("");
    try {
      const response = await fetch("/api/integrations/facebook/group-lists", {
        method: "DELETE",
        headers: { Authorization: `Bearer ${session.access_token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ workspaceId, businessId: selectedBusiness?.id || businessId, listId: list.id }),
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(result.error || "De groepenlijst kon niet worden verwijderd.");
      setFacebookGroupLists((current) => current.filter((item) => item.id !== list.id));
    } catch (error) { setFacebookGroupsError(error.message); }
    finally { setFacebookGroupListsBusy(false); }
  }

  async function verifyFacebookGroupSender(group) {
    setFacebookGroupsError("");
    const response = await fetch("/api/integrations/facebook/groups", {
      method: "PATCH",
      headers: { Authorization: `Bearer ${session.access_token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ workspaceId, businessId: selectedBusiness?.id || businessId, groupId: group.id }),
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) return setFacebookGroupsError(result.error || "De bedrijfsafzender kon niet worden ingesteld.");
    setFacebookGroups((current) => current.map((item) => item.id === group.id ? result.group : item));
    setResult({ ok: true, message: `${result.group.sender_page_name} is als gewenste afzender gekoppeld aan ${group.name}. Facebook bepaalt vervolgens of deze pagina in de groep mag plaatsen.` });
  }

  async function openFacebookGroup(distribution, group) {
    const text = channelConceptText(distribution, "facebook", "");
    const common = distribution.common || {};
    const shareText = [common.title, text, common.start ? `Datum: ${formatNlDateTime(common.start)}` : "", common.location ? `Locatie: ${common.location}` : "", common.website_url || distribution.source_url].filter(Boolean).join("\n\n");
    const groupUrl = group.url || group.group_url;
    if (!groupUrl) return setResult({ ok: false, message: `Voor ${group.name} ontbreekt de Facebook-groepslink.` });
    if (!group.sender_page_id || !group.sender_verified_at) return setResult({ ok: false, message: `Plaatsing geblokkeerd: stel voor ${group.name} eerst de bedrijfspagina als afzender in.` });
    if (facebookAccount && String(group.sender_page_id) !== String(facebookAccount.external_account_id)) return setResult({ ok: false, message: `Plaatsing geblokkeerd: ${group.name} hoort bij ${group.sender_page_name}, niet bij ${facebookAccount.display_name}.` });
    window.open(groupUrl, "_blank", "noopener,noreferrer");
    try { await navigator.clipboard.writeText(shareText); } catch {}
    setResult({ ok: true, message: `${group.name} is geopend en de tekst is gekopieerd. Plaats alleen wanneer Facebook zichtbaar ${group.sender_page_name} als afzender toont. Bevestig de plaatsing daarna apart in Horeca OS.` });
  }

  function confirmFacebookGroupPosted(group, campaignId, roundGroups, remainingAfterRound, delayMin, delayMax) {
    setFacebookGroupShareProgress((current) => {
      const previous = current[campaignId] || { completed: [], waitUntil: 0, round: 1 };
      const completed = Array.from(new Set([...previous.completed, String(group.id || group.url)]));
      const roundDone = roundGroups.every((roundGroup) => completed.includes(String(roundGroup.id || roundGroup.url)));
      const minimum = Math.max(0, Number(delayMin) || 0);
      const maximum = Math.max(minimum, Number(delayMax) || minimum);
      const delayMinutes = roundDone && remainingAfterRound > 0
        ? Math.floor(Math.random() * (maximum - minimum + 1)) + minimum
        : 0;
      return {
        ...current,
        [campaignId]: {
          ...previous,
          completed,
          round: roundDone && remainingAfterRound > 0 ? previous.round + 1 : previous.round,
          waitUntil: delayMinutes ? Date.now() + delayMinutes * 60 * 1000 : 0,
          lastDelayMinutes: delayMinutes,
        },
      };
    });
    setResult({ ok: true, message: `De plaatsing in ${group.name} is als voltooid bevestigd.` });
  }

  async function openFacebookEventCreator(distribution) {
    const common = distribution.common || {};
    const websiteEventStatus = distribution.website_event_status || common.website_status || "draft";
    const eventinTicketUrl = common.website_url || distribution.source_url || "";
    if (distribution.source_type === "website_event" && websiteEventStatus !== "publish") {
      return setResult({ ok: false, message: "Publiceer het evenement eerst in Eventin. Daarna haalt Horeca OS de openbare ticketlink op en kan het Facebook-evenement worden voorbereid." });
    }
    if (distribution.source_type === "website_event" && !eventinTicketUrl) {
      return setResult({ ok: false, message: "Eventin is gepubliceerd, maar de openbare ticketlink ontbreekt nog. Ververs de status en probeer het daarna opnieuw." });
    }
    const facebook = distribution.channel_payloads?.facebook || {};
    const destination = facebook.destination || (facebookAccount ? { page_id: facebookAccount.external_account_id, page_name: facebookAccount.display_name } : null);
    if (!destination?.page_id) {
      return setResult({ ok: false, message: `Voor ${selectedBusiness?.name || "deze vestiging"} is nog geen eigen Facebookpagina gekoppeld. Koppel die eerst onder Koppelingen.` });
    }
    const eventText = [
      common.title,
      facebook.text || common.short_description || common.description,
      common.start ? `Begint: ${formatNlDateTime(common.start)}` : "",
      common.end ? `Eindigt: ${formatNlDateTime(common.end)}` : "",
      common.location ? `Locatie: ${common.location}` : "",
      eventinTicketUrl ? `Tickets: ${eventinTicketUrl}` : "",
    ].filter(Boolean).join("\n\n");
    const facebookWindow = window.open("https://www.facebook.com/events/create/", "_blank", "noopener,noreferrer");
    let copied = false;
    try {
      await navigator.clipboard.writeText(eventText);
      copied = true;
    } catch {}
    const eventImageUrl = facebook.image_url || common.image_url || "";
    if (eventImageUrl) {
      await downloadUploadedImage({ url: eventImageUrl, name: `${common.title || "facebook-evenement"}.jpg` }, "facebook-evenement.jpg");
    }
    setResult({
      ok: Boolean(facebookWindow),
      message: facebookWindow
        ? `Facebook Evenement maken is geopend voor ${destination.page_name}. ${copied ? "Alle evenementgegevens staan op het klembord." : "Kopieer de evenementgegevens uit Horeca OS."} ${eventImageUrl ? "De evenementafbeelding is gedownload." : "Voeg in Facebook nog een afbeelding toe."} Kies de pagina ${destination.page_name}, plak de gegevens en bevestig het evenement.`
        : "De browser heeft het Facebook-tabblad geblokkeerd. Sta pop-ups voor Horeca OS toe en probeer het opnieuw.",
    });
  }

  async function saveFacebookEventLink(item) {
    const distribution = (item.media || []).find((entry) => entry?.kind === "campaign_distribution") || {};
    const expectedPageName = distribution.channel_payloads?.facebook?.destination?.page_name || facebookAccount?.display_name || "de gekoppelde bedrijfspagina";
    if (!facebookEventOrganizerChecks[item.id]) {
      return setResult({ ok: false, message: `Bevestig eerst dat ${expectedPageName} in Facebook als organisator staat. Zo wordt een persoonlijk profiel nooit ongemerkt gekoppeld.` });
    }
    const currentLink = distribution.facebook_event_delivery?.permalink || "";
    const permalink = (facebookEventLinkEdits[item.id] ?? currentLink).trim();
    if (!/^https:\/\/(www\.)?facebook\.com\/events\/\d+\/?(?:[?#].*)?$/i.test(permalink)) {
      return setResult({ ok: false, message: "Vul een geldige Facebook-evenementlink in, bijvoorbeeld https://www.facebook.com/events/123456789." });
    }
    const eventId = permalink.match(/\/events\/(\d+)/i)?.[1] || "";
    const nextDistribution = {
      ...distribution,
      facebook_event_delivery: {
        status: "confirmed",
        external_id: eventId,
        permalink: `https://www.facebook.com/events/${eventId}`,
        business_id: selectedBusiness?.id || businessId,
        page_id: distribution.channel_payloads?.facebook?.destination?.page_id || facebookAccount?.external_account_id || "",
        page_name: distribution.channel_payloads?.facebook?.destination?.page_name || facebookAccount?.display_name || "",
        confirmed_at: new Date().toISOString(),
      },
    };
    const nextMedia = (item.media || []).map((entry) => entry?.kind === "campaign_distribution" ? nextDistribution : entry);
    setConceptBusyId(item.id);
    setResult(null);
    try {
      const { error } = await supabase.from("social_content_items").update({ media: nextMedia }).eq("id", item.id).eq("workspace_id", workspaceId);
      if (error) throw error;
      setFacebookEventLinkEdits((current) => ({ ...current, [item.id]: `https://www.facebook.com/events/${eventId}` }));
      setResult({ ok: true, message: "Het Facebook-evenement is aan dit Horeca OS-dossier gekoppeld." });
      await loadEventCampaigns();
    } catch (error) {
      setResult({ ok: false, message: error.message || "De Facebook-evenementlink kon niet worden opgeslagen." });
    } finally {
      setConceptBusyId(null);
    }
  }

  async function createEvent() {
    const error = validate(); if (error) return setResult({ ok: false, message: error });
    setBusy(true); setResult(null); const steps = [];
    try {
      const updatingWebsiteEvent = Boolean(editingWebsiteEvent?.eventId);
      const response = await fetch("/api/marketing/website-events/create", { method: updatingWebsiteEvent ? "PATCH" : "POST", headers: { Authorization: `Bearer ${session.access_token}`, "Content-Type": "application/json" }, body: JSON.stringify({ workspaceId, site, ...form, imageUrl: form.eventinImage?.url || form.imageUrl, eventId: editingWebsiteEvent?.eventId, campaignId: editingWebsiteEvent?.campaignId, businessId: selectedBusiness?.id || businessId || null }) });
      const website = await response.json(); if (!response.ok) throw new Error(website.error || (updatingWebsiteEvent ? "Het website-evenement kon niet worden gewijzigd." : "Het website-evenement kon niet worden aangemaakt."));
      steps.push({ label: updatingWebsiteEvent ? "Website en Eventin bijgewerkt" : "Website en Eventin", ok: true, detail: website.event.url });
      let calendarDelivery = editingWebsiteEvent?.calendarDelivery || null;
      if (form.addToCalendar) {
        const updatingCalendar = Boolean(updatingWebsiteEvent && calendarDelivery?.event_id);
        const calendarResponse = await fetch("/api/integrations/microsoft/calendar/action", { method: updatingCalendar ? "PATCH" : "POST", headers: { Authorization: `Bearer ${session.access_token}`, "Content-Type": "application/json" }, body: JSON.stringify({ workspaceId, mailbox: form.calendarMailbox.trim(), eventId: updatingCalendar ? calendarDelivery.event_id : undefined, subject: form.title.trim(), description: calendarEventDescription(form, website.event.url), start: form.start, end: form.end, location: form.location.trim(), attendees: [], recurrence: "none", reminderMinutes: 60, showAs: "busy" }) });
        const calendar = await calendarResponse.json();
        if (calendarResponse.ok) {
          calendarDelivery = { status: "confirmed", mailbox: form.calendarMailbox.trim(), event_id: calendar.event?.id || calendarDelivery?.event_id || "", web_link: calendar.event?.webLink || calendarDelivery?.web_link || "", updated_at: new Date().toISOString() };
          steps.push({ label: `Agenda ${form.calendarMailbox}`, ok: true, detail: updatingCalendar ? "Bestaande afspraak bijgewerkt." : "Afspraak aangemaakt." });
        } else {
          calendarDelivery = { ...(calendarDelivery || {}), status: "failed", mailbox: form.calendarMailbox.trim(), error: calendar.error || "Niet toegevoegd.", updated_at: new Date().toISOString() };
          steps.push({ label: `Agenda ${form.calendarMailbox}`, ok: false, detail: calendarDelivery.error });
        }
      }
      const promotion = await createPromotionDraft(website.event, calendarDelivery);
      steps.push(promotion.ok
        ? { label: form.preparePromotion ? `Horeca OS-beheerdossier en marketingconcept (${enabledChannels.length} kanalen)` : "Horeca OS-beheerdossier", ok: true }
        : { label: "Horeca OS-beheerdossier", ok: false, detail: promotion.warning });
      if (!promotion.ok) {
        setResult({ ok: false, message: `Eventin-concept ${website.event.id} is aangemaakt, maar het beheerdossier kon niet worden opgeslagen. Maak het evenement niet opnieuw aan.`, steps });
        return;
      }
      const selectedBusinessId = selectedBusiness?.id || businessId;
      if (workspaceId && selectedBusinessId) {
        window.localStorage.removeItem(formDraftStorageKey(workspaceId, selectedBusinessId));
      }
      setResult({ ok: true, message: updatingWebsiteEvent ? "Het bestaande evenement is bijgewerkt." : website.event.status === "draft" ? "Het evenement is als Eventin-concept opgeslagen. Publiceer het hieronder wanneer alles klopt." : "Het evenement is verwerkt.", steps, url: website.event.status === "publish" ? website.event.url : "" }); setEditingWebsiteEvent(null); setEditingCampaignId(null); setPreview(false); await loadEventCampaigns();
    } catch (requestError) { setResult({ ok: false, message: requestError.message }); } finally { setBusy(false); }
  }

  async function recoverCalendarDelivery(distribution) {
    if (distribution.calendar_delivery?.event_id && distribution.calendar_delivery?.mailbox) {
      return distribution.calendar_delivery;
    }
    const common = distribution.common || {};
    const startDate = new Date(common.start || "");
    const endDate = new Date(common.end || "");
    if (!common.title || Number.isNaN(startDate.getTime()) || Number.isNaN(endDate.getTime())) return null;
    const rangeStart = new Date(startDate.getTime() - 86400000).toISOString();
    const rangeEnd = new Date(endDate.getTime() + 86400000).toISOString();
    const query = new URLSearchParams({ workspaceId, start: rangeStart, end: rangeEnd });
    const response = await fetch(`/api/integrations/microsoft/calendar?${query}`, {
      headers: { Authorization: `Bearer ${session.access_token}` },
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) return null;
    const normalizedTitle = String(common.title).trim().toLocaleLowerCase("nl");
    const candidates = (result.accounts || []).flatMap((account) => (account.events || [])
      .filter((event) => String(event.subject || "").trim().toLocaleLowerCase("nl") === normalizedTitle)
      .filter((event) => Math.abs(new Date(event.start?.dateTime).getTime() - startDate.getTime()) < 60000)
      .map((event) => ({ account, event })));
    if (candidates.length !== 1) return null;
    const { account, event } = candidates[0];
    return {
      status: "confirmed",
      mailbox: account.mailbox,
      event_id: event.id,
      web_link: event.webLink || "",
      recovered_at: new Date().toISOString(),
    };
  }

  async function changeWebsiteEventStatus(item, mode) {
    const distribution = (item.media || []).find((entry) => entry?.kind === "campaign_distribution") || {};
    const id = String(distribution.eventin_event_id || "");
    if (!id) return setResult({ ok: false, message: "Het Eventin-ID ontbreekt. Open het evenement via de bronlink en beheer het daar handmatig." });
    const movingToPublish = mode === "publish";
    const repairingPublishedEvent = movingToPublish && distribution.website_event_status === "publish";
    const movingToDraft = mode === "draft";
    const cancellingOnline = mode === "cancelled";
    const cancellingAndDeleting = mode === "trash";
    const confirmed = window.confirm(movingToPublish
      ? repairingPublishedEvent
        ? "De WordPress- en Eventin-agendastatus opnieuw synchroniseren? Hiermee wordt het evenement niet dubbel aangemaakt."
        : "Dit Eventin-concept nu openbaar publiceren op de website? De promotie op andere kanalen verandert niet automatisch."
      : movingToDraft
        ? "Dit evenement van de website halen en als Eventin-concept bewaren? De promotie op andere kanalen verandert niet automatisch."
        : cancellingOnline
          ? "Dit evenement annuleren? Het blijft online staan en krijgt duidelijk de status Geannuleerd. Tickets zijn daarna niet meer bedoeld voor verkoop."
          : "Dit evenement annuleren en verwijderen? Het verdwijnt van de website en het Horeca OS-beheerdossier wordt verwijderd. Dit kan niet vanuit Horeca OS worden teruggedraaid.");
    if (!confirmed) return;
    setConceptBusyId(item.id);
    setResult(null);
    try {
      const response = await fetch("/api/marketing/website-events/create", {
        method: movingToPublish ? "PATCH" : "DELETE",
        headers: { Authorization: `Bearer ${session.access_token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ workspaceId, site, businessId: item.business_id || selectedBusiness?.id || businessId || null, campaignId: item.id, eventId: id, mode, action: movingToPublish ? "publish" : undefined }),
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(result.error || "Eventin heeft de actie niet geaccepteerd.");
      let calendarDelivery = distribution.calendar_delivery || null;
      let calendarSyncError = "";
      if ((cancellingOnline || cancellingAndDeleting) && !calendarDelivery?.event_id) {
        calendarDelivery = await recoverCalendarDelivery(distribution);
        if (!calendarDelivery) {
          if (cancellingAndDeleting) {
            calendarDelivery = { status: "deleted", mailbox: distribution.calendar_delivery?.mailbox || "", already_deleted: true, error: "", updated_at: new Date().toISOString() };
          } else {
            calendarSyncError = "De bestaande agenda-afspraak kon niet eenduidig worden teruggevonden.";
            calendarDelivery = { status: "failed", mailbox: "", error: calendarSyncError, updated_at: new Date().toISOString() };
          }
        }
      }
      if ((cancellingOnline || cancellingAndDeleting) && calendarDelivery?.event_id && calendarDelivery?.mailbox) {
        const calendarResponse = await fetch("/api/integrations/microsoft/calendar/action", {
          method: cancellingAndDeleting ? "DELETE" : "PATCH",
          headers: { Authorization: `Bearer ${session.access_token}`, "Content-Type": "application/json" },
          body: JSON.stringify(cancellingAndDeleting
            ? { workspaceId, mailbox: calendarDelivery.mailbox, eventId: calendarDelivery.event_id }
            : {
                workspaceId, mailbox: calendarDelivery.mailbox, eventId: calendarDelivery.event_id,
                subject: `GEANNULEERD – ${distribution.common?.title || "Evenement"}`,
                description: `GEANNULEERD\n\n${distribution.common?.description || item.body || ""}\n\nWebsite: ${distribution.source_url || ""}`,
                start: distribution.common?.start, end: distribution.common?.end, location: distribution.common?.location || "",
                attendees: [], recurrence: "none", reminderMinutes: 60, showAs: "free",
              }),
        });
        const calendarResult = await calendarResponse.json().catch(() => ({}));
        if (calendarResponse.ok) {
          calendarDelivery = { ...calendarDelivery, status: cancellingAndDeleting ? "deleted" : "cancelled", updated_at: new Date().toISOString(), error: "" };
        } else {
          calendarSyncError = calendarResult.error || "De gekoppelde agenda-afspraak kon niet worden aangepast.";
          calendarDelivery = { ...calendarDelivery, status: "failed", error: calendarSyncError, updated_at: new Date().toISOString() };
        }
      }
      if (cancellingAndDeleting) {
        if (calendarSyncError) {
          const failedDistribution = { ...distribution, website_event_status: "deleted", calendar_delivery: calendarDelivery };
          const failedMedia = (item.media || []).map((entry) => entry?.kind === "campaign_distribution" ? failedDistribution : entry);
          await supabase.from("social_content_items").update({ media: failedMedia }).eq("id", item.id).eq("workspace_id", workspaceId);
          setResult({ ok: false, message: `Het evenement is uit Eventin verwijderd, maar de agenda-afspraak kon niet worden verwijderd: ${calendarSyncError}` });
          await loadEventCampaigns();
          return;
        }
        const { error } = await supabase.from("social_content_items").delete().eq("id", item.id).eq("workspace_id", workspaceId);
        if (error) {
          setResult({ ok: false, message: "Het evenement is uit Eventin verwijderd, maar het Horeca OS-beheerdossier kon niet worden verwijderd. Ververs de status en verwijder het dossier daarna afzonderlijk." });
        } else {
          if (editingCampaignId === item.id) { setEditingCampaignId(null); setEditingWebsiteEvent(null); }
          setResult({ ok: true, message: "Het evenement is geannuleerd en verwijderd uit Eventin en Horeca OS." });
        }
        await loadEventCampaigns();
        return;
      }
      const publicEventUrl = movingToPublish ? String(result.event?.url || distribution.source_url || "") : distribution.source_url;
      const nextWebsiteStatus = result.event?.status || (movingToPublish ? "publish" : movingToDraft ? "draft" : "cancelled");
      const nextCommon = {
        ...(distribution.common || {}),
        website_status: nextWebsiteStatus,
        website_url: movingToPublish ? publicEventUrl : (distribution.common?.website_url || distribution.source_url || ""),
        cta: {
          ...(distribution.common?.cta || {}),
          url: movingToPublish ? publicEventUrl : (distribution.common?.cta?.url || distribution.source_url || ""),
        },
      };
      const nextDistribution = {
        ...distribution,
        source_url: movingToPublish ? publicEventUrl : distribution.source_url,
        website_event_status: nextWebsiteStatus,
        common: nextCommon,
        calendar_delivery: calendarDelivery,
      };
      const nextMedia = (item.media || []).map((entry) => entry?.kind === "campaign_distribution" ? nextDistribution : entry);
      const { error } = await supabase.from("social_content_items").update({ media: nextMedia }).eq("id", item.id).eq("workspace_id", workspaceId);
      if (error) {
        setResult({ ok: false, message: `Eventin is ${movingToPublish ? "gepubliceerd" : movingToDraft ? "naar concept gezet" : "geannuleerd"}, maar de lokale status kon niet worden bijgewerkt. Ververs de status en controleer het evenement.` });
      } else {
        setResult({ ok: true, message: movingToPublish
          ? "Het Eventin-evenement is gepubliceerd en de openbare ticketlink is opgeslagen. Je kunt nu het Facebook-evenement voorbereiden."
          : movingToDraft
            ? "Het website-evenement staat nu als Eventin-concept. Andere kanalen zijn niet gewijzigd."
            : calendarSyncError
              ? `Het evenement is in Eventin geannuleerd, maar de agenda kon niet worden bijgewerkt: ${calendarSyncError}`
              : "Het evenement blijft online staan en wordt in Eventin én Microsoft Agenda duidelijk als Geannuleerd weergegeven. Andere kanalen zijn niet automatisch gewijzigd." });
      }
      await loadEventCampaigns();
    } catch (error) {
      setResult({ ok: false, message: error.message || "Het website-evenement kon niet worden aangepast." });
    } finally {
      setConceptBusyId(null);
    }
  }

  async function copyChannelConcept(item, distribution, channel) {
    const text = channelConceptText(distribution, channel, item.body);
    if (!text) return setResult({ ok: false, message: `Er is nog geen tekst voor ${channelLabels[channel] || channel}.` });
    try {
      await navigator.clipboard.writeText(text);
      const key = `${item.id}-${channel}`;
      setCopiedChannelKey(key);
      window.setTimeout(() => setCopiedChannelKey((current) => current === key ? "" : current), 2000);
    } catch {
      setResult({ ok: false, message: "Kopiëren is niet gelukt. Open het concept en selecteer de tekst handmatig." });
    }
  }

  async function sendAllEditorialEmails(item, distribution, selectedKeys) {
    const targets = (distribution.editorial_submissions || [])
      .map(editorialTargetDetails)
      .filter((target) => target.email && selectedKeys.includes(target.key));
    const mailbox = distribution.calendar_delivery?.mailbox || form.calendarMailbox.trim();
    if (!targets.length) return setResult({ ok: false, message: "Vink eerst minimaal één e-mailkanaal aan." });
    if (!mailbox) return setResult({ ok: false, message: "Koppel eerst de Microsoft-mailbox van deze vestiging." });
    setConceptBusyId(item.id);
    setResult(null);
    const failed = [];
    try {
      for (const target of targets) {
        const draft = editorialEmailDraft(target, distribution.common, distribution.source_url);
        const response = await fetch("/api/integrations/microsoft/messages/action", {
          method: "POST",
          headers: { Authorization: `Bearer ${session.access_token}`, "Content-Type": "application/json" },
          body: JSON.stringify({ workspaceId, mailbox, action: "send", to: draft.to, subject: draft.subject, content: draft.body }),
        });
        if (!response.ok) failed.push(target.label);
      }
      setResult(failed.length
        ? { ok: false, message: `${targets.length - failed.length} van ${targets.length} e-mails zijn verstuurd. Niet gelukt: ${failed.join(", ")}.` }
        : { ok: true, message: `Alle ${targets.length} redactie-e-mails zijn vanuit ${mailbox} verstuurd.` });
    } catch (error) {
      setResult({ ok: false, message: error.message || "De redactie-e-mails konden niet worden verstuurd." });
    } finally {
      setConceptBusyId(null);
    }
  }

  async function createStandaloneCampaign() {
    const error = validate(); if (error) return setResult({ ok: false, message: error });
    setBusy(true); setResult(null);
    try {
      const promotion = await createPromotionDraft({ id: null, url: form.ctaUrl.trim() });
      if (!promotion.ok) throw new Error(promotion.warning || "Het campagneconcept kon niet worden opgeslagen.");
      setResult({ ok: true, message: `${campaignTypeLabel} is als campagneconcept opgeslagen.` });
      setEditingCampaignId(null); setEditingWebsiteEvent(null); setPreview(false); await loadEventCampaigns();
    } catch (requestError) { setResult({ ok: false, message: requestError.message }); }
    finally { setBusy(false); }
  }

  function scrollToCreatorSection(sectionId) {
    const section = document.getElementById(sectionId)
      || (sectionId === "opgeslagen-campagnes" ? document.querySelector(".campaignStatus") : null);
    section?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  const currentManagedWebsiteEvents = managedWebsiteEvents.filter((eventItem) => !eventItem.expired);
  const expiredManagedWebsiteEvents = managedWebsiteEvents.filter((eventItem) => eventItem.expired);
  const managedEventSearchQuery = managedEventSearch.trim().toLocaleLowerCase("nl-NL");
  const visibleManagedWebsiteEvents = (showExpiredWebsiteEvents ? expiredManagedWebsiteEvents : currentManagedWebsiteEvents).filter((eventItem) => {
    if (!managedEventSearchQuery) return true;
    const dateText = eventItem.start ? formatNlDateTime(eventItem.start) : eventItem.eventDate ? formatNlDate(eventItem.eventDate) : "";
    return [eventItem.title, eventItem.location, eventItem.start, eventItem.end, eventItem.eventDate, dateText]
      .some((value) => String(value || "").toLocaleLowerCase("nl-NL").includes(managedEventSearchQuery));
  });

  return <section className="panel" style={{ marginBottom: 24 }}>
    <div className="panelHead"><div><p className="eyebrow">CAMPAGNEBOUWER</p><h2>Wat wil je promoten?</h2><p>Kies eerst het soort campagne. Horeca OS toont daarna alleen de gegevens die daarvoor nodig zijn.</p></div></div>
    {editingCampaignId && <div className="editingNotice"><strong>{editingWebsiteEvent ? "Website-evenement bewerken" : "Concept bewerken"}</strong><span>{editingWebsiteEvent ? "Je wijzigingen worden na bevestiging in hetzelfde Eventin-evenement en marketingdossier opgeslagen." : "Je wijzigingen vervangen dit opgeslagen concept wanneer je opnieuw opslaat."}</span><button type="button" onClick={startNewCampaign}>Nieuw evenement</button></div>}
    <div className="campaignTypeGrid">{campaignTypes.map(([id, label, help]) => <button type="button" key={id} className={form.campaignType === id ? "active" : ""} onClick={() => selectCampaignType(id)}><strong>{label}</strong><span>{help}</span></button>)}</div>
    {isEvent && <div className="eventWorkspaceChooser">
      <div><p className="eyebrow">EVENEMENTEN</p><h3>Wat wil je doen?</h3><p>Kies één onderdeel. Horeca OS toont daarna alleen wat je daarvoor nodig hebt.</p></div>
      <div className="eventWorkspaceChoices">
        <button type="button" className={eventWorkspaceView === "new" ? "active" : ""} onClick={() => setEventWorkspaceView("new")}><strong>Nieuw evenement maken</strong><span>Vul gegevens, afbeeldingen, tickets en bestemmingen in.</span></button>
        <button type="button" className={eventWorkspaceView === "existing" ? "active" : ""} onClick={() => { setEventWorkspaceView("existing"); if (managedWebsiteEvents.length === 0) loadManagedWebsiteEvents(); }}><strong>Bestaand evenement</strong><span>Laad een Eventin-evenement en koppel het aan Horeca OS.</span></button>
        <button type="button" className={eventWorkspaceView === "saved" ? "active" : ""} onClick={() => { setEventWorkspaceView("saved"); loadEventCampaigns(); }}><strong>Opgeslagen evenementen</strong><span>Bekijk, bewerk, dupliceer, publiceer of annuleer.</span></button>
      </div>
    </div>}
    {(!isEvent || eventWorkspaceView === "new") && <>
    <nav className="creatorQuickBar" aria-label="Formuliernavigatie">
      <div className="creatorQuickLinks">
        <button type="button" onClick={() => scrollToCreatorSection("campagne-basis")}>1. Basis</button>
        <button type="button" onClick={() => scrollToCreatorSection("campagne-afbeeldingen")}>2. Afbeeldingen</button>
        {isEvent && <button type="button" onClick={() => scrollToCreatorSection("campagne-tickets")}>3. Tickets</button>}
        <button type="button" onClick={() => scrollToCreatorSection("campagne-bestemmingen")}>{isEvent ? "4." : "3."} Bestemmingen</button>
      </div>
      <div className="creatorQuickActions">
        <button type="button" className="secondaryButton" onClick={editingWebsiteEvent ? showPreview : saveIncompleteDraft} disabled={busy}>{busy ? "Bezig…" : editingWebsiteEvent ? "Wijziging controleren" : "Concept opslaan"}</button>
        <button type="button" onClick={showPreview} disabled={busy}>Controleren</button>
        {preview && <button type="button" onClick={isEvent ? createEvent : createStandaloneCampaign} disabled={busy || !mediaReady}>{busy ? "Bezig…" : editingWebsiteEvent ? "Bijwerken" : isEvent ? form.status === "publish" ? "Publiceren" : "Aanmaken" : "Opslaan"}</button>}
      </div>
    </nav>
    <div className="eventCreatorGrid creatorSection" id="campagne-basis">
      <label>Vestiging<select value={selectedBusiness?.id || ""} disabled><option>{selectedBusiness?.name || "Kies eerst een vestiging bovenaan"}</option></select></label>
      <label>{campaignTitleLabel} *<input value={form.title} onChange={(e) => update("title", e.target.value)} /></label>
      {isEvent && <><label>Begint *<input type="datetime-local" value={form.start} onInput={(e) => update("start", e.currentTarget.value)} onChange={(e) => update("start", e.currentTarget.value)} /></label><label>Eindigt *<input type="datetime-local" min={form.start || undefined} value={form.end} onInput={(e) => update("end", e.currentTarget.value)} onChange={(e) => update("end", e.currentTarget.value)} /><small>Kan niet vóór de begintijd liggen. Na middernacht wordt automatisch de volgende dag.</small></label><label className="wide">Locatie *<input value={form.location} onChange={(e) => update("location", e.target.value)} /></label></>}
      {(form.campaignType === "product" || form.campaignType === "offer") && <><label>Normale prijs<input type="number" min="0" step="0.01" value={form.regularPrice} onChange={(e) => update("regularPrice", e.target.value)} /></label><label>{form.campaignType === "offer" ? "Actieprijs *" : "Promotieprijs"}<input type="number" min="0" step="0.01" value={form.campaignPrice} onChange={(e) => update("campaignPrice", e.target.value)} /></label></>}
      {form.campaignType === "offer" && <><label>Actiecode<input value={form.discountCode} onChange={(e) => update("discountCode", e.target.value)} /></label><label>Geldig vanaf<input type="date" value={form.validFrom} onChange={(e) => update("validFrom", e.target.value)} /></label><label>Geldig tot *<input type="date" value={form.validUntil} onChange={(e) => update("validUntil", e.target.value)} /></label></>}
      {form.campaignType === "package" && <><label>Aantal personen<input type="number" min="1" value={form.groupSize} onChange={(e) => update("groupSize", e.target.value)} /></label><label>Prijs per persoon<input type="number" min="0" step="0.01" value={form.pricePerPerson} onChange={(e) => update("pricePerPerson", e.target.value)} /></label><label>Beschikbaar vanaf<input type="date" value={form.validFrom} onChange={(e) => update("validFrom", e.target.value)} /></label><label>Beschikbaar tot<input type="date" value={form.validUntil} onChange={(e) => update("validUntil", e.target.value)} /></label></>}
      {form.campaignType === "review" && <><label>Naam gast<input value={form.reviewerName} onChange={(e) => update("reviewerName", e.target.value)} /></label><label>Beoordeling<select value={form.reviewScore} onChange={(e) => update("reviewScore", e.target.value)}>{[5,4,3,2,1].map((score) => <option key={score} value={score}>{score} sterren</option>)}</select></label><label className="wide">Bron of reviewlink<input type="url" value={form.reviewSource} onChange={(e) => update("reviewSource", e.target.value)} /></label></>}
      <label className="wide">Korte promotietekst<textarea rows={3} value={form.shortDescription} onChange={(e) => update("shortDescription", e.target.value)} placeholder="De kernboodschap voor Google, WhatsApp en sociale media." /></label>
      <label className="wide">{form.campaignType === "review" ? "Reviewtekst *" : "Volledige omschrijving"}<textarea rows={6} value={form.description} onChange={(e) => update("description", e.target.value)} /></label>
      <div className="imageUploads wide creatorSection" id="campagne-afbeeldingen">
        <div className="imageUploadHead"><strong>Afbeeldingen per kanaal</strong><p>Upload één bronafbeelding voor alle formaten, of lever per kanaal een eigen uitsnede aan.</p></div>
        <article className={`eventinImageStatus ${form.eventinImage?.url ? "ready" : "empty"}`}>
          <div>
            <strong>Eventin-afbeelding</strong>
            {form.eventinImage?.url
              ? <><span>✓ Opgeslagen en klaar voor Eventin</span><small>Deze originele foto wordt bij het aanmaken van het evenement naar Eventin gestuurd. De sociale formaten hieronder staan hiervan los.</small></>
              : <><span>Nog geen afbeelding gekozen</span><small>Kies hieronder een bronafbeelding. De originele foto wordt apart voor Eventin bewaard, ook als geen sociaal formaat kan worden gemaakt.</small></>}
          </div>
          {form.eventinImage?.url && <div className="eventinImagePreview">
            <img src={form.eventinImage.url} alt="Geselecteerde Eventin-afbeelding" />
            <div><small>{form.eventinImage.name || "Bronafbeelding"}</small><button type="button" className="downloadImage" onClick={() => downloadUploadedImage(form.eventinImage, "eventin-afbeelding")}>Downloaden</button></div>
          </div>}
        </article>
        <label className="cropFocus">Focuspunt bij automatisch bijsnijden
          <select value={cropFocus} onChange={(event) => setCropFocus(event.target.value)}>
            <option value="top">Boven — behoud gezichten of tekst bovenin</option>
            <option value="center">Midden — standaard</option>
            <option value="bottom">Onder — behoud tekst of details onderin</option>
          </select>
          <small>Horeca OS houdt dit deel zoveel mogelijk in beeld wanneer een foto niet dezelfde verhouding heeft.</small>
        </label>
        <article
          className={`imageSlot imageSlotAll ${draggingSlot === "all" ? "dragging" : ""}`}
          onDragEnter={(event) => { event.preventDefault(); setDraggingSlot("all"); }}
          onDragOver={(event) => { event.preventDefault(); event.dataTransfer.dropEffect = "copy"; setDraggingSlot("all"); }}
          onDragLeave={(event) => { if (!event.currentTarget.contains(event.relatedTarget)) setDraggingSlot(""); }}
          onDrop={handleAllImageDrop}
        >
          <div><strong>Eén bronafbeelding voor alle formaten</strong><span>Horeca OS maakt automatisch 1,91:1, 1:1, 4:5 en 9:16</span><small>Je kunt een automatisch gemaakte uitsnede hieronder altijd vervangen.</small></div>
          <div className="imageDropZone">
            <strong>{draggingSlot === "all" ? "Laat de bronafbeelding hier los" : "Sleep één afbeelding hierheen"}</strong>
            <small>of</small>
            <label className="uploadButton">{uploadingSlot === "all" ? "Alle formaten maken…" : "Bronafbeelding kiezen"}<input type="file" accept="image/jpeg,image/png,image/webp" disabled={Boolean(uploadingSlot)} onChange={(e) => uploadImageToAll(e.target.files?.[0])} /></label>
          </div>
        </article>
        <div className="imageSlotGrid">{imageSlots.map((slot) => {
          const uploaded = form.images?.[slot.key];
          const isDragging = draggingSlot === slot.key;
          return <article
            className={`imageSlot ${uploaded?.matches ? "exact" : ""} ${isDragging ? "dragging" : ""}`}
            key={slot.key}
            onDragEnter={(event) => { event.preventDefault(); setDraggingSlot(slot.key); }}
            onDragOver={(event) => { event.preventDefault(); event.dataTransfer.dropEffect = "copy"; setDraggingSlot(slot.key); }}
            onDragLeave={(event) => { if (!event.currentTarget.contains(event.relatedTarget)) setDraggingSlot(""); }}
            onDrop={(event) => handleImageDrop(slot, event)}
          >
            <div><strong>{slot.label}</strong><span>{slot.width} × {slot.height} px · {slot.ratio}</span><small>{slot.channels}</small></div>
            {uploaded ? <div className="uploadedImage">
              <div className="imagePreview" style={{ backgroundImage: `url(${uploaded.url})` }} aria-label={`Voorbeeld ${slot.label}`} />
              <strong className="imageUploadSuccess">✓ Upload gelukt</strong>
              <p>{uploaded.width} × {uploaded.height} px {uploaded.matches ? "· Perfect formaat" : "· Afwijkend formaat"}</p>
              <small className="replaceHint">Sleep een nieuwe afbeelding hierheen om te vervangen.</small>
              <div className="uploadedImageActions"><button type="button" className="downloadImage" onClick={() => downloadUploadedImage(uploaded, `${slot.key}-${slot.width}x${slot.height}`)}>Downloaden</button><button type="button" className="removeImage" onClick={() => removeImage(slot.key)}>Verwijderen</button></div>
            </div> : <div className="imageDropZone">
              <strong>{isDragging ? "Laat de afbeelding hier los" : "Sleep een afbeelding hierheen"}</strong>
              <small>of</small>
              <label className="uploadButton">{uploadingSlot === slot.key ? "Bezig met uploaden…" : "Afbeelding kiezen"}<input type="file" accept="image/jpeg,image/png,image/webp" disabled={Boolean(uploadingSlot)} onChange={(e) => uploadImage(slot, e.target.files?.[0])} /></label>
            </div>}
          </article>;
        })}</div>
        <p className="imageHelp">JPG, PNG of WebP · maximaal 10 MB per afbeelding.</p>
        {uploadMessage && <p className={`uploadMessage ${uploadMessage.ok ? "success" : "error"}`}>{uploadMessage.message}</p>}
      </div>
      <label>Externe afbeeldingslink (optioneel)<input type="url" value={form.imageUrl} onChange={(e) => update("imageUrl", e.target.value)} placeholder="Alleen als alternatief voor upload" /></label>
      <label>Videolink<input type="url" value={form.videoUrl} onChange={(e) => update("videoUrl", e.target.value)} placeholder="Verplicht wanneer TikTok is gekozen" /></label>
      <label>Organisator<input value={form.organizer} onChange={(e) => update("organizer", e.target.value)} /></label>
      <label>Contact-e-mail *<input type="email" value={form.contactEmail} onChange={(e) => update("contactEmail", e.target.value)} /></label>
      <label>Knoptekst<input value={form.ctaLabel} onChange={(e) => update("ctaLabel", e.target.value)} /></label>
      <label>Knoplink<input type="url" value={form.ctaUrl} onChange={(e) => update("ctaUrl", e.target.value)} placeholder="Leeg = de nieuwe evenementpagina" /></label>
      {isEvent && <fieldset className="ticketEditor wide creatorSection" id="campagne-tickets"><legend>Tickets</legend>
        <p>Maak meerdere tickettypen, bijvoorbeeld Earlybird, Regular en Latebird. Geen ticketregels betekent: geen tickets.</p>
        <p>Laat de verkoopperiode leeg om tickets vanaf vandaag tot het einde van het evenement te verkopen.</p>
        {(form.ticketVariations || []).length > 0 && <div className="ticketDateRefresh"><div><strong>Oude verkoopdatums overgenomen?</strong><span>Pas alle tickettypen tegelijk aan: start verkoop nu, einde verkoop bij aanvang van het evenement.</span></div><button type="button" onClick={refreshTicketSalesDates}>Verkoopdatums aanpassen</button></div>}
        {(form.ticketVariations || []).map((ticket, index) => <article className="ticketVariation" key={ticket.id}>
          <div className="ticketVariationHead"><strong>Tickettype {index + 1}</strong><button type="button" className="removeTicket" onClick={() => removeTicketVariation(ticket.id)}>Verwijderen</button></div>
          <div className="ticketVariationGrid">
            <label>Naam *<input value={ticket.name} onChange={(e) => updateTicketVariation(ticket.id, "name", e.target.value)} placeholder="Bijvoorbeeld Earlybird" /></label>
            <label>Soort<select value={ticket.type} onChange={(e) => updateTicketVariation(ticket.id, "type", e.target.value)}><option value="free">Gratis</option><option value="paid">Betaald</option></select></label>
            <label>Prijs<input type="number" min="0" step="0.01" disabled={ticket.type !== "paid"} value={ticket.price} onChange={(e) => updateTicketVariation(ticket.id, "price", e.target.value)} /></label>
            <label>Capaciteit<input type="number" min="1" value={ticket.capacity} onChange={(e) => updateTicketVariation(ticket.id, "capacity", e.target.value)} placeholder="Leeg = onbeperkt" /></label>
            <label>Start verkoop (optioneel)<input type="datetime-local" value={ticket.salesStart} onInput={(e) => updateTicketVariation(ticket.id, "salesStart", e.currentTarget.value)} onChange={(e) => updateTicketVariation(ticket.id, "salesStart", e.currentTarget.value)} /><small>Leeg = vandaag</small></label>
            <label>Einde verkoop (optioneel)<input type="datetime-local" value={ticket.salesEnd} onInput={(e) => updateTicketVariation(ticket.id, "salesEnd", e.currentTarget.value)} onChange={(e) => updateTicketVariation(ticket.id, "salesEnd", e.currentTarget.value)} /><small>Leeg = einde evenement</small></label>
            <label>Minimum per bestelling<input type="number" min="1" value={ticket.minQuantity} onChange={(e) => updateTicketVariation(ticket.id, "minQuantity", e.target.value)} /></label>
            <label>Maximum per bestelling<input type="number" min="1" value={ticket.maxQuantity} onChange={(e) => updateTicketVariation(ticket.id, "maxQuantity", e.target.value)} /></label>
          </div>
        </article>)}
        <button type="button" className="addTicket" onClick={addTicketVariation}>+ Tickettype toevoegen</button>
      </fieldset>}
    </div>

    <fieldset className="eventDestinations creatorSection" id="campagne-bestemmingen"><legend>Bestemmingen</legend>
      {isEvent && <div className="eventinDestination">
        <label className="check"><input type="checkbox" checked readOnly /> Eventin op caribbeancorner.nl</label>
        <label>Eventin-publicatie<select value={form.status} onChange={(e) => update("status", e.target.value)}><option value="draft">Eerst als concept</option><option value="publish">Direct publiceren</option></select></label>
        <small>De gekozen vestiging wordt als locatie gebruikt. Bij ‘Direct publiceren’ komt het evenement meteen openbaar in Eventin; bij ‘Eerst als concept’ kun je het daar nog controleren.</small>
      </div>}
      {isEvent && <><label className="check"><input type="checkbox" checked={form.addToCalendar} onChange={(e) => update("addToCalendar", e.target.checked)} /> Microsoft-agenda</label>
      {form.addToCalendar && <label>Agenda-e-mailadres<input type="email" value={form.calendarMailbox} onChange={(e) => update("calendarMailbox", e.target.value)} /></label>}</>}
      <label className="check"><input type="checkbox" checked={form.preparePromotion} onChange={(e) => update("preparePromotion", e.target.checked)} /> Promotieconcept voor andere kanalen</label>
      {form.preparePromotion && <>
        <div className="channelChecks">{Object.entries(channelLabels).map(([key, label]) => <label className="channelCheck" key={key}><span className="check"><input type="checkbox" checked={form.channels[key]} onChange={() => toggleChannel(key)} /> {label}</span><small>{key === "predis" && !predisConnected ? "Niet gekoppeld" : channelModes[key]}</small></label>)}</div>
        <p className="channelSafetyNote">Selecteren publiceert niets automatisch. Brevo slaat een concept bij Brevo op. Facebook krijgt na opslaan een aparte knop “Op Facebook plaatsen”. De overige kanalen blijven interne concepten in Horeca OS.</p>
      </>}
      {isEvent && <div className="editorialAgendaPicker" style={{ display: "grid", gap: "10px", marginTop: "4px", padding: "14px", border: "1px solid #c6d5df", borderRadius: "12px", background: "#f8fbfc" }}>
        <strong>Uitagenda's, media en evenementensites</strong>
        <p>Kies zelf waar je het evenement wilt aanbieden. Groen betekent dat Horeca OS de e-mail kan voorbereiden en verzenden. Oranje betekent dat de externe website nog handmatig gecontroleerd moet worden.</p>
        <div className="editorialTargetBulkActions">
          <button type="button" onClick={() => update("editorialTargets", Object.fromEntries(editorialAgendaTargets.map((target) => [target.key, true])))}>Alles selecteren</button>
          <button type="button" onClick={() => update("editorialTargets", { ...emptyEditorialTargets })}>Alles deselecteren</button>
        </div>
        <div className="channelChecks editorialTargetGrid">{editorialAgendaTargets.map((target) => {
          const routePresentation = editorialRoutePresentation(target);
          return <div className={`channelCheck editorialTargetCard editorialRoute-${target.route}`} key={target.key}>
          <div className="editorialTargetHead">
            <label className="check"><input type="checkbox" checked={Boolean(form.editorialTargets?.[target.key])} onChange={() => update("editorialTargets", { ...emptyEditorialTargets, ...(form.editorialTargets || {}), [target.key]: !form.editorialTargets?.[target.key] })} /> {target.label}</label>
            <small className="editorialRouteBadge"><b>{routePresentation.badge}</b></small>
          </div>
          <small className="editorialRouteExplanation">{routePresentation.explanation}</small>
          <div className="editorialTargetLinks">
            {target.submissionUrl && <a href={target.submissionUrl} target="_blank" rel="noreferrer" onClick={() => saveCurrentFormDraft()}>Handmatige aanmeldpagina openen</a>}
            {!target.submissionUrl && (target.infoUrl || target.websiteUrl) && <a href={target.infoUrl || target.websiteUrl} target="_blank" rel="noreferrer" onClick={() => saveCurrentFormDraft()}>Website ter controle bekijken</a>}
            {target.email && <span>E-mail: {target.email}</span>}
          </div>
          {target.fallbackLabel && <small className="editorialTargetHint">{target.fallbackLabel}</small>}
        </div>})}</div>
        <details style={{ marginTop: "4px", padding: "10px 12px", border: "1px solid #d7e1e7", borderRadius: "10px", background: "#fff" }}>
          <summary style={{ cursor: "pointer", fontWeight: 700 }}>Kanalen met een handmatige stap, blokkade of eerdere afwijzing ({editorialReferenceTargets.length})</summary>
          <p style={{ margin: "8px 0" }}>Deze kanalen zijn bewaard uit de eerdere promotielijst, maar staan niet tussen de normale keuzes omdat ze niet direct of niet gratis bruikbaar zijn.</p>
          <div style={{ display: "grid", gap: "8px" }}>{editorialReferenceTargets.map((target) => <div key={target.label} style={{ padding: "9px 10px", border: "1px solid #e0e7eb", borderRadius: "8px" }}>
            <div style={{ display: "flex", flexWrap: "wrap", justifyContent: "space-between", gap: "6px" }}><strong>{target.label}</strong><span>{target.status}</span></div>
            <small>{target.note}</small>
            <div><a href={target.url} target="_blank" rel="noreferrer">Website bekijken</a></div>
          </div>)}</div>
        </details>
      </div>}
    </fieldset>

    {form.preparePromotion && <div className="channelDetails">
      {form.channels.brevo && <fieldset><legend>Brevo — veilig als concept</legend>
        <label>Onderwerp *<input value={form.brevoSubject} onChange={(e) => update("brevoSubject", e.target.value)} /></label>
        <label>Voorbeeldtekst<input value={form.brevoPreview} onChange={(e) => update("brevoPreview", e.target.value)} /></label>
        <div className="brevoAudiencePicker">
          <strong>Doelgroep(en) *</strong>
          {brevoLoading && <p>Brevo-doelgroepen laden…</p>}
          {!brevoLoading && brevoError && <p className="brevoAudienceError">{brevoError}</p>}
          {!brevoLoading && !brevoError && brevoLists.length === 0 && <p>Geen Brevo-doelgroepen beschikbaar voor deze vestiging.</p>}
          {brevoLists.map((list) => <label className="check" key={list.id}>
            <input type="checkbox" checked={selectedBrevoListIds.includes(String(list.id))} onChange={() => {
              const id = String(list.id);
              setSelectedBrevoListIds((current) => current.includes(id) ? current.filter((item) => item !== id) : [...current, id]);
              setPreview(false); setResult(null);
            }} />
            {list.name} ({Number(list.totalSubscribers || list.uniqueSubscribers || 0).toLocaleString("nl-NL")} ontvangers)
          </label>)}
          {selectedBrevoListIds.length > 0 && <p><b>{brevoRecipientCount.toLocaleString("nl-NL")} ontvangers geselecteerd</b>{brevoSenderEmail ? ` · afzender ${brevoSenderEmail}` : ""}</p>}
          <small>Horeca OS slaat alleen een Brevo-concept op. Vanuit deze stap wordt niets verzonden.</small>
        </div>
      </fieldset>}
      {form.channels.facebook && <fieldset className="wide facebookChannelSection"><legend>Facebook — klaarzetten voor publicatie</legend>
        <div className={`facebookDestination ${facebookAccount ? "ready" : "missing"}`}><strong>{facebookAccountLoading ? "Facebookpagina controleren…" : facebookAccount ? `Bestemming: ${facebookAccount.display_name}` : `Geen Facebookpagina gekoppeld voor ${selectedBusiness?.name || "deze vestiging"}`}</strong><span>{facebookAccount ? `Alleen de pagina, agenda en groepen van ${selectedBusiness?.name || "deze vestiging"} worden gebruikt.` : "Koppel eerst de eigen Facebookpagina onder Koppelingen. Horeca OS gebruikt nooit automatisch de pagina van een andere vestiging."}</span></div>
        <div className="placementChoices"><span>Plaatsing *</span><label className="check"><input type="checkbox" checked={(form.facebookPlacements || []).includes("feed")} onChange={() => toggleFacebookPlacement("feed")} /> Facebookpagina</label></div>
        {isEvent && <div className="facebookDestination ready"><strong>Facebookbericht automatisch; Facebook-agenda vereist bevestiging</strong><span>Het paginabericht kan Horeca OS automatisch plaatsen. Meta staat niet toe dat Horeca OS zelfstandig een Facebook-agenda-evenement aanmaakt. Na het opslaan opent Horeca OS daarom het juiste Facebookprofiel met alle gegevens en de afbeelding voorbereid.</span></div>}
        <label>Berichttekst<textarea rows={3} value={form.facebookText} onChange={(e) => update("facebookText", e.target.value)} placeholder="Leeg = korte promotietekst" /></label>
        <small>Horeca OS vult afbeelding, datum, locatie, tickets en Eventin-link automatisch aan. Publiceren gebeurt pas met de aparte bevestigingsknop bij het opgeslagen evenement.</small>
        <div className="facebookGroupPicker">
          <div className="facebookGroupPickerHead"><strong>Groepen voor {selectedBusiness?.name || "deze vestiging"}</strong><span>{selectedFacebookGroupIds.length} geselecteerd</span></div>
          <section className="facebookGroupSavedLists">
            <div>
              <strong>Eigen groepenlijsten</strong>
              <p>Sla de huidige vinkjes op als bijvoorbeeld Karaoke, Wedding of Ladies Night.</p>
            </div>
            <div className="facebookGroupListCreate"><input value={facebookGroupListName} onChange={(event) => setFacebookGroupListName(event.target.value)} placeholder="Naam van de nieuwe lijst" maxLength={80} /><button type="button" disabled={facebookGroupListsBusy || !selectedFacebookGroupIds.length} onClick={saveFacebookGroupList}>Huidige selectie opslaan</button></div>
            {facebookGroupLists.length > 0 && <div className="facebookGroupSavedListGrid">{facebookGroupLists.map((list) => <article key={list.id}>
              <span><b>{list.name}</b><small>{(list.group_ids || []).length} groepen</small></span>
              <div><button type="button" disabled={facebookGroupListsBusy} onClick={() => applyFacebookGroupList(list)}>Toepassen</button><button type="button" disabled={facebookGroupListsBusy || !selectedFacebookGroupIds.length} onClick={() => updateFacebookGroupList(list)}>Bijwerken met huidige vinkjes</button><button type="button" disabled={facebookGroupListsBusy} className="danger" onClick={() => removeFacebookGroupList(list)}>Verwijderen</button></div>
            </article>)}</div>}
            {!facebookGroupLists.length && <p className="facebookGroupListEmpty">Nog geen eigen groepenlijsten opgeslagen voor deze vestiging.</p>}
          </section>
          {facebookGroups.length > 0 && <div className="facebookGroupAdvicePanel">
            <div><strong>Advies voor deze campagne</strong><span>{recommendedFacebookGroups.length > 0 ? `${recommendedFacebookGroups.length} passende groepen gevonden` : "Nog geen duidelijke match"}</span></div>
            <p>Horeca OS kijkt naar locatie, onderwerp en bekende groepsregels. Je kunt ieder vinkje daarna zelf wijzigen. Er wordt nooit vanuit dit advies geplaatst.</p>
            <button type="button" disabled={recommendedFacebookGroups.length === 0 || !facebookAccount} onClick={applyFacebookGroupAdvice}>Aanbevolen groepen aanvinken</button>
          </div>}
          {facebookGroups.length > 0 && <div className="facebookGroupTools">
            <label>Groep zoeken<input type="search" value={facebookGroupSearch} onChange={(event) => setFacebookGroupSearch(event.target.value)} placeholder="Zoek op groepsnaam" /></label>
            <div><button type="button" disabled={visibleFacebookGroups.length === 0} onClick={selectVisibleFacebookGroups}>Alles zichtbaar aanvinken</button><button type="button" disabled={selectedFacebookGroupIds.length === 0} onClick={() => setSelectedFacebookGroupIds([])}>Alles uitvinken</button><button type="button" disabled={visibleFacebookGroups.length === 0} onClick={() => setShowAllFacebookGroups((current) => !current)}>{showAllFacebookGroups ? "Lijst inklappen" : `Volledige lijst tonen (${visibleFacebookGroups.length})`}</button></div>
          </div>}
          {facebookGroupsLoading && <p>Facebookgroepen laden…</p>}
          <div ref={facebookGroupListRef} className={`facebookGroupList ${showAllFacebookGroups ? "expanded" : "compact"}`}>{visibleFacebookGroups.map((group) => {
            const senderReady = Boolean(group.sender_page_id && group.sender_verified_at && facebookAccount && String(group.sender_page_id) === String(facebookAccount.external_account_id));
            const advice = facebookGroupAdviceById.get(String(group.id));
            const isSelected = selectedFacebookGroupIds.includes(String(group.id));
            return <div className={`facebookGroupChoice ${senderReady ? "senderReady" : "senderMissing"} ${isSelected ? "selected" : ""} ${advice?.recommended ? "recommended" : ""} ${advice?.level === "avoid" ? "avoid" : ""}`} key={group.id}>
              <label className="check"><input type="checkbox" disabled={advice?.level === "avoid"} checked={isSelected} onChange={() => toggleFacebookGroupSelection(group.id)} /> <span><b>{group.name}{isSelected && <em>Aangevinkt</em>}{advice?.level === "conditional" && <em className="conditional">Voorwaarden</em>}{advice?.level === "avoid" && <em className="avoid">Niet gebruiken</em>}</b><small>{advice?.reason}</small><small>{senderReady ? `Gewenste afzender: ${group.sender_page_name} · jij bevestigt iedere plaatsing zelf` : "Wel geselecteerd, maar plaatsing geblokkeerd totdat de bedrijfsafzender is gekoppeld"}</small></span></label>
              <div>{!senderReady && <button type="button" disabled={!facebookAccount} onClick={() => verifyFacebookGroupSender(group)}>Koppel {facebookAccount?.display_name || "bedrijfspagina"}</button>}<button type="button" onClick={() => removeFacebookGroup(group)}>Verwijderen</button></div>
            </div>;
          })}</div>
          {!facebookGroupsLoading && facebookGroups.length === 0 && <p>Nog geen groepen opgeslagen voor deze vestiging.</p>}
          {!facebookGroupsLoading && facebookGroups.length > 0 && visibleFacebookGroups.length === 0 && <p>Geen groepen gevonden voor “{facebookGroupSearch}”.</p>}
          {!facebookGroupsLoading && visibleFacebookGroups.length > 0 && <div className="facebookGroupSavedLists facebookGroupListSaveBottom">
            <div><strong>Selectie klaar?</strong><p>Sla de {selectedFacebookGroupIds.length} aangevinkte groepen direct op als een herbruikbare lijst.</p></div>
            <div className="facebookGroupListCreate"><input value={facebookGroupListName} onChange={(event) => setFacebookGroupListName(event.target.value)} placeholder="Naam van de nieuwe lijst" maxLength={80} /><button type="button" disabled={facebookGroupListsBusy || !selectedFacebookGroupIds.length} onClick={saveFacebookGroupList}>Huidige selectie opslaan</button></div>
          </div>}
          <div className="facebookGroupAdd"><input value={newFacebookGroup.name} onChange={(event) => setNewFacebookGroup((current) => ({ ...current, name: event.target.value }))} placeholder="Naam van de groep" /><input value={newFacebookGroup.url} onChange={(event) => setNewFacebookGroup((current) => ({ ...current, url: event.target.value }))} placeholder="https://www.facebook.com/groups/…" /><button type="button" onClick={saveFacebookGroup}>Groep toevoegen</button></div>
          {facebookGroupsError && <p className="brevoAudienceError">{facebookGroupsError}</p>}
          <small>Deze lijst hoort uitsluitend bij {selectedBusiness?.name || "de gekozen vestiging"}. Advies is nooit toestemming tot plaatsing: jij controleert de vinkjes en bevestigt later iedere groepsplaatsing zelf.</small>
        </div>
      </fieldset>}
      {form.channels.instagram && <fieldset><legend>Instagram — intern concept</legend><label>Vorm<select value={form.instagramFormat} onChange={(e) => update("instagramFormat", e.target.value)}><option value="post">Post</option><option value="reel">Reel</option><option value="story">Story</option><option value="carousel">Carrousel</option></select></label><label>Bijschrift<textarea rows={3} value={form.instagramCaption} onChange={(e) => update("instagramCaption", e.target.value)} /></label></fieldset>}
      {form.channels.tiktok && <fieldset><legend>TikTok — intern concept, video verplicht</legend><label>Bijschrift<textarea rows={3} value={form.tiktokCaption} onChange={(e) => update("tiktokCaption", e.target.value)} /></label><label>Zichtbaarheid<select value={form.tiktokPrivacy} onChange={(e) => update("tiktokPrivacy", e.target.value)}><option value="PUBLIC_TO_EVERYONE">Openbaar</option><option value="MUTUAL_FOLLOW_FRIENDS">Vrienden</option><option value="SELF_ONLY">Alleen ik</option></select></label><label className="check"><input type="checkbox" checked={form.tiktokComments} onChange={(e) => update("tiktokComments", e.target.checked)} /> Reacties toestaan</label></fieldset>}
      {form.channels.whatsapp && <fieldset><legend>WhatsApp Business — intern concept</legend><label>Goedgekeurde templatenaam *<input value={form.whatsappTemplate} onChange={(e) => update("whatsappTemplate", e.target.value)} /></label><label>Bericht<textarea rows={3} value={form.whatsappMessage} onChange={(e) => update("whatsappMessage", e.target.value)} /></label></fieldset>}
      {form.channels.google && <fieldset><legend>Google Bedrijfsprofiel — intern concept</legend><label>Soort bericht<select value={form.googleTopic} onChange={(e) => update("googleTopic", e.target.value)}><option value="EVENT">Evenement</option><option value="STANDARD">Update</option><option value="OFFER">Aanbieding</option></select></label><p>Gebruikt titel, datum/tijd, korte tekst, afbeelding en knoplink uit de basis.</p></fieldset>}
      {form.channels.predis && <fieldset><legend>Predis — veilig als concept</legend>
        <label>Soort concept<select value={form.predisType} onChange={(e) => update("predisType", e.target.value)}><option value="afbeelding">Afbeelding</option><option value="video">Video</option><option value="carousel">Carrousel</option></select></label>
        <label>Toon<input value={form.predisTone} onChange={(e) => update("predisTone", e.target.value)} /></label>
        <div className="predisGenerationChoice">
          <strong>{predisConnected ? "Predis-merk gevonden voor deze vestiging" : "Predis is nog niet gekoppeld voor deze vestiging"}</strong>
          <label className="check"><input type="checkbox" checked={Boolean(form.predisGenerate)} disabled={!predisConnected} onChange={(e) => update("predisGenerate", e.target.checked)} /> Predis-concept laten maken bij opslaan</label>
          <small>Standaard uit. Ook wanneer dit aanstaat, wordt het resultaat alleen als concept gemaakt en nooit automatisch gepubliceerd.</small>
        </div>
      </fieldset>}
      <fieldset className="wide"><legend>Spreiding per kanaal</legend><label className="check"><input type="checkbox" checked={Boolean(form.staggerEnabled)} onChange={(event) => update("staggerEnabled", event.target.checked)} /> Willekeurige wachttijd tussen de kanalen</label>{form.staggerEnabled && <div className="staggerFields"><label>Minimaal aantal minuten<input type="number" min="0" max="1440" value={form.staggerMinMinutes} onChange={(event) => update("staggerMinMinutes", event.target.value)} /></label><label>Maximaal aantal minuten<input type="number" min="0" max="1440" value={form.staggerMaxMinutes} onChange={(event) => update("staggerMaxMinutes", event.target.value)} /></label></div>}<p>Horeca OS toont vooraf het interne tijdschema. Een kanaal krijgt pas de status ‘geplaatst’ nadat de aanbieder dit heeft bevestigd.</p></fieldset>
    </div>}

    <section className="channelPreviewControls">
      <div><strong>Controleren per kanaal</strong><p>Bekijk vooraf precies wat Eventin, de e-mail en Google Bedrijfsprofiel ontvangen. Controleren verstuurt of publiceert nog niets.</p></div>
      <div className="channelPreviewButtons">
        <button type="button" className={previewChannel === "eventin" ? "active" : ""} onClick={() => showChannelPreview("eventin")}>Eventin controleren</button>
        <button type="button" className={previewChannel === "email" ? "active" : ""} onClick={() => showChannelPreview("email")}>E-mail controleren</button>
        <button type="button" className={previewChannel === "google" ? "active" : ""} onClick={() => showChannelPreview("google")}>Google controleren</button>
      </div>
    </section>

    {previewChannel && <div className="channelSpecificPreview" id="kanaal-controle">
      <div className="channelSpecificPreviewHead"><strong>{previewChannel === "eventin" ? "Voorbeeld voor Eventin" : previewChannel === "email" ? "Voorbeeld van de e-mail" : "Voorbeeld voor Google Bedrijfsprofiel"}</strong><span>Alleen controleren</span></div>
      {previewChannel === "eventin" && <div className="providerPreviewCard">
        {form.eventinImage?.url ? <img src={form.eventinImage.url} alt="Eventin-voorbeeld" /> : <div className="providerPreviewPlaceholder">Nog geen Eventin-afbeelding</div>}
        <div><h3>{form.title}</h3><p><b>Datum en tijd:</b> {form.start ? new Date(form.start).toLocaleString("nl-NL") : "niet ingevuld"} – {form.end ? new Date(form.end).toLocaleString("nl-NL") : "niet ingevuld"}</p><p><b>Locatie:</b> {form.location || "niet ingevuld"}</p><p className="providerPreviewText">{form.description || form.shortDescription || "Nog geen omschrijving"}</p><p><b>Tickets:</b> {form.tickets.length ? form.tickets.map((ticket) => `${ticket.name || "Ticket"} (${ticket.type === "paid" ? `€ ${Number(ticket.price || 0).toFixed(2)}` : "gratis"})`).join(" · ") : "geen tickets"}</p><small>Status bij opslaan: {form.status === "publish" ? "direct publiceren" : "eerst als concept"}</small></div>
      </div>}
      {previewChannel === "email" && <div className="emailProviderPreview">
        <p><b>Aan:</b> {editorialAgendaTargets.filter(({ key }) => form.editorialTargets?.[key]).map(({ email, label }) => email || label).join(", ") || (form.channels.brevo ? selectedBrevoLists.map((item) => item.name).join(", ") : "nog geen ontvangers geselecteerd")}</p>
        <p><b>Onderwerp:</b> {form.brevoSubject || form.title}</p>
        {form.brevoPreview && <p><b>Voorbeeldregel:</b> {form.brevoPreview}</p>}
        <div className="emailPreviewBody"><p><b>{form.title}</b></p>{form.shortDescription && <p>{form.shortDescription}</p>}<p className="providerPreviewText">{form.description || "Nog geen volledige omschrijving"}</p>{isEvent && <p>{form.start ? new Date(form.start).toLocaleString("nl-NL") : "Datum niet ingevuld"}<br />{form.location || "Locatie niet ingevuld"}</p>}</div>
        <small>Dit is een voorbeeld. Er wordt vanuit deze knop geen e-mail verzonden.</small>
      </div>}
      {previewChannel === "google" && <div className="providerPreviewCard googleProviderPreview">
        {channelImagePreviews.find((item) => item.channel === "google")?.imageUrl ? <img src={channelImagePreviews.find((item) => item.channel === "google")?.imageUrl} alt="Google Bedrijfsprofiel-voorbeeld" /> : <div className="providerPreviewPlaceholder">Nog geen Google-afbeelding</div>}
        <div><span className="googleTopicLabel">{form.googleTopic === "EVENT" ? "Evenement" : form.googleTopic === "OFFER" ? "Aanbieding" : "Update"}</span><h3>{form.title}</h3><p className="providerPreviewText">{form.shortDescription || "Nog geen korte promotietekst"}</p>{isEvent && <p><b>{form.start ? new Date(form.start).toLocaleString("nl-NL") : "Datum niet ingevuld"}</b><br />{form.location || "Locatie niet ingevuld"}</p>}<button type="button" disabled>{form.ctaText || "Meer informatie"}</button><small>Knoplink: {form.ctaUrl || "wordt na het aanmaken de Eventin-pagina"}</small></div>
      </div>}
    </div>}

    {preview && !previewChannel && <div className="eventPreview">
      <strong>Controle voor opslaan</strong>
      <p><b>{campaignTypeLabel}: {form.title}</b></p>
      {isEvent && <><p>{new Date(form.start).toLocaleString("nl-NL")} - {new Date(form.end).toLocaleString("nl-NL")}</p><p>{form.location}</p></>}
      <ul>{isEvent && <li>Website: {site} ({form.status === "publish" ? "direct openbaar" : "concept"})</li>}{isEvent && form.addToCalendar && <li>Agenda: {form.calendarMailbox}</li>}{form.preparePromotion && <li>Promotie: {enabledChannels.map((key) => channelLabels[key]).join(", ")}</li>}{isEvent && <li>Redacties: {editorialAgendaTargets.filter(({ key }) => form.editorialTargets?.[key]).map(({ label }) => label).join(", ") || "geen geselecteerd"}</li>}</ul>
      {form.preparePromotion && <div className={mediaReady ? "mediaCheck mediaCheckReady" : "mediaCheck mediaCheckWarning"}>
        <strong>{mediaReady ? "Alle gekozen kanalen zijn gereed." : "Nog niet gereed voor opslaan."}</strong>
        {!mediaReady && <ul>{channelMediaIssues.map((issue) => <li key={issue}>{issue}</li>)}</ul>}
      </div>}
      {form.preparePromotion && <div className="channelImagePreviewGrid">
        {channelImagePreviews.map((item) => {
          const selectedSlot = imageSlots.find((slot) => slot.key === item.selectedKey);
          const preferredSlot = imageSlots.find((slot) => slot.key === item.preferredKey);
          return <article className="channelImagePreview" key={item.channel}>
            <div className="channelImagePreviewHead"><strong>{item.label}</strong><span className={item.imageUrl ? "imageReady" : "imageMissing"}>{item.imageUrl ? "Beeld gereed" : "Geen beeld"}</span></div>
            {item.imageUrl ? <>
              <img src={item.imageUrl} alt={`Voorbeeld voor ${item.label}`} />
              <p><b>{item.isExternal ? "Externe afbeeldingslink" : selectedSlot?.label}</b>{selectedSlot ? ` - ${selectedSlot.width} x ${selectedSlot.height} px` : ""}</p>
              {item.isFallback && <small className="fallbackNotice">Alternatief gebruikt. Ideaal voor dit kanaal: {preferredSlot?.label} ({preferredSlot?.width} x {preferredSlot?.height} px).</small>}
              {item.channel === "predis" && <small>Predis ontvangt alle geüploade formaten; hierboven staat het primaire voorbeeld.</small>}
            </> : <p className="missingImageNotice">Upload bij voorkeur {preferredSlot?.label} ({preferredSlot?.width} x {preferredSlot?.height} px).</p>}
          </article>;
        })}
      </div>}
    </div>}
    {result && <div className={result.ok ? "eventResult success" : "eventResult error"}><strong>{result.message}</strong>{result.steps?.map((step) => <p key={step.label}>{step.ok ? "✓" : "!"} {step.label}{step.detail ? `: ${step.detail}` : ""}</p>)}{result.url && <a href={result.url} target="_blank" rel="noreferrer">Evenement op de website openen</a>}</div>}
    <div className="earlyDraftAction"><div><strong>{editingWebsiteEvent ? "Bestaand evenement bijwerken" : "Nog niet alles compleet?"}</strong><p>{editingWebsiteEvent ? "Controleer de wijzigingen en werk daarna hetzelfde Eventin-evenement en dezelfde agenda-afspraak bij." : "Sla de basis intern op. Ontbrekende kanaalgegevens krijgen de status Extra gegevens nodig. Er wordt niets gepubliceerd, verzonden of ingepland."}</p></div><button type="button" className="secondaryButton" onClick={editingWebsiteEvent ? showPreview : saveIncompleteDraft} disabled={busy}>{busy ? "Bezig met opslaan…" : editingWebsiteEvent ? "Wijziging controleren" : "Basisconcept opslaan"}</button></div>
    <div className="eventActions"><button type="button" className="secondaryButton" onClick={showPreview} disabled={busy}>Voorbeeld controleren</button>{preview && <button type="button" onClick={isEvent ? createEvent : createStandaloneCampaign} disabled={busy || !mediaReady} title={!mediaReady ? "Vul eerst de ontbrekende media in." : ""}>{busy ? "Bezig met opslaan…" : editingWebsiteEvent ? "Evenement bijwerken" : isEvent ? (form.status === "publish" ? "Evenement publiceren" : "Evenement als concept aanmaken") : "Campagneconcept opslaan"}</button>}</div>
    </>}
    {(!isEvent || eventWorkspaceView === "saved") && <div className="campaignStatus creatorSection" id="opgeslagen-campagnes"><div className="statusHead"><div><p className="eyebrow">OPGESLAGEN CONCEPTEN</p><h3>Campagnes per soort</h3></div><button type="button" className="secondaryButton" onClick={() => loadEventCampaigns()} disabled={campaignListBusy}>{campaignListBusy ? "Campagnes laden…" : "Status verversen"}</button></div>
      {eventCampaigns.length === 0 ? <div className="emptyCampaignState">
        <strong>Nog geen campagneconcepten opgeslagen</strong>
        <p>Maak hierboven je eerste campagne. Na het opslaan verschijnt die hier met controle-, planning- en kopieerknoppen per kanaal.</p>
        <button type="button" onClick={() => window.scrollTo({ top: 0, behavior: "smooth" })}>Nieuwe campagne maken</button>
      </div> : <>
        <div className="conceptFilters"><label className="conceptSearch">Zoek campagne<input type="search" value={conceptSearch} onChange={(event) => setConceptSearch(event.target.value)} placeholder="Zoek op naam of promotietekst" /></label><label>Soort campagne<select value={conceptTypeFilter} onChange={(event) => setConceptTypeFilter(event.target.value)}><option value="all">Alle soorten</option>{campaignTypes.map(([id, label]) => <option key={id} value={id}>{label}</option>)}</select></label><label>Werkstatus<select value={conceptStatusFilter} onChange={(event) => setConceptStatusFilter(event.target.value)}><option value="all">Alle statussen</option><option value="draft">Concept</option><option value="approved">Goedgekeurd</option><option value="scheduled">Ingepland</option><option value="published">Geplaatst</option></select></label><label>Volgorde<select value={conceptSort} onChange={(event) => setConceptSort(event.target.value)}><option value="newest">Nieuwste eerst</option><option value="oldest">Oudste eerst</option></select></label></div>
        <div className="conceptFilterSummary">
          <span>{filteredEventCampaigns.length} van {eventCampaigns.length} geladen {eventCampaigns.length === 1 ? "campagne" : "campagnes"} zichtbaar</span>
          {(conceptSearch.trim() || conceptTypeFilter !== "all" || conceptStatusFilter !== "all") && <button type="button" onClick={() => { setConceptSearch(""); setConceptTypeFilter("all"); setConceptStatusFilter("all"); }}>Zoeken en filters wissen</button>}
        </div>
        {filteredEventCampaigns.length === 0 && <p className="emptyConcepts">Geen opgeslagen campagnes gevonden met deze zoekopdracht en filters.</p>}
        {filteredEventCampaigns.map((item) => {
        const distribution = (item.media || []).find((entry) => entry?.kind === "campaign_distribution") || {};
        const storedType = distribution.common?.campaign_type || distribution.source_type;
        const isWebsiteEvent = distribution.source_type === "website_event";
        const websiteEventStatus = distribution.website_event_status || "publish";
        const websiteEventCancelled = ["cancelled", "trash"].includes(websiteEventStatus);
        const websiteEventDeleted = websiteEventStatus === "trash";
        const websiteEventReadOnly = distribution.eventin_management_mode === "read_only";
        const eventImageUrl = distribution.common?.image_url
          || distribution.common?.images?.landscape?.url
          || distribution.common?.images?.square?.url
          || distribution.common?.images?.portrait?.url
          || eventThumbnailUrls[item.id]
          || "";
        const typeLabel = campaignTypes.find(([id]) => id === storedType)?.[1] || (storedType === "website_event" ? "Evenement" : "Campagne");
        const conceptBusy = conceptBusyId === item.id;
        const approved = item.workflow_status === "in_progress";
        const providerConfirmed = distributionHasProviderConfirmation(distribution);
        const incompleteChannels = channelsNeedingDetails(distribution);
        const hasIncompleteChannels = incompleteChannels.length > 0;
        const editingBlockReason = isWebsiteEvent ? "" : campaignEditingBlockReason(item, distribution);
        const selectedGroupTargets = distribution.channel_payloads?.facebook?.group_sharing?.groups || [];
        const groupShareState = facebookGroupShareProgress[item.id] || { completed: [], waitUntil: 0, round: 1, delayMin: 5, delayMax: 15 };
        const completedGroupIds = new Set(groupShareState.completed || []);
        const deletionBlockReason = completedGroupIds.size > 0
          ? "Verwijder eerst de handmatig geplaatste Facebookgroepberichten en zet daarna de groepsvoortgang terug."
          : campaignDeletionBlockReason(item, distribution);
        const pendingGroupTargets = selectedGroupTargets.filter((group) => !completedGroupIds.has(String(group.id || group.url)));
        const currentGroupRound = pendingGroupTargets.slice(0, 10);
        const remainingAfterGroupRound = Math.max(0, pendingGroupTargets.length - currentGroupRound.length);
        const groupRoundWaiting = Number(groupShareState.waitUntil || 0) > facebookGroupShareClock;
        const groupRoundWaitSeconds = groupRoundWaiting ? Math.ceil((groupShareState.waitUntil - facebookGroupShareClock) / 1000) : 0;
        const facebookGroupImage = distribution.channel_payloads?.facebook?.image_url || distribution.common?.image_url || "";
        const facebookEventDelivery = distribution.facebook_event_delivery || {};
        const facebookDestination = distribution.channel_payloads?.facebook?.destination || (facebookAccount ? { page_id: facebookAccount.external_account_id, page_name: facebookAccount.display_name } : null);
        const facebookEnabled = (distribution.target_channels || []).includes("facebook");
        const eventinPublishedWithTicketLink = !isWebsiteEvent || (websiteEventStatus === "publish" && Boolean(distribution.source_url));
        const facebookEventReady = !facebookEnabled || (facebookEventDelivery.status === "confirmed" && Boolean(facebookEventDelivery.permalink));
        const facebookGroupsReady = selectedGroupTargets.length === 0 || completedGroupIds.size >= selectedGroupTargets.length;
        const campaignWorkflowStep = !eventinPublishedWithTicketLink ? 1 : !facebookEventReady ? 2 : !facebookGroupsReady ? 3 : 4;
        const editorialTargets = distribution.editorial_submissions || [];
        const editorialEmailTargets = editorialTargets.map(editorialTargetDetails).filter((target) => target.email);
        const defaultEditorialEmailKeys = editorialEmailTargets.filter((target) => target.route === "email").map((target) => target.key);
        const selectedEditorialEmailKeys = editorialEmailSelections[String(item.id)] ?? defaultEditorialEmailKeys;
        const editorialExpanded = expandedEditorialCampaignIds.includes(String(item.id));

        return <article key={item.id}>
          <div className="campaignCardMain">
            {eventImageUrl && <div className="campaignCardImage"><NextImage src={eventImageUrl} alt={`Afbeelding van ${distribution.common?.title || typeLabel}`} width={132} height={96} sizes="132px" unoptimized loader={({ src }) => src} /></div>}
            <div className="campaignCardContent">
            <div className="conceptHeading">
              <span className="campaignKind">{typeLabel}</span>
              <span className={`approvalState ${approved ? "approved" : "draft"}`}>
                {providerConfirmed ? "Geplaatst bevestigd" : item.scheduled_for ? "Intern ingepland" : approved ? "Goedgekeurd" : "Concept"}
              </span>
            </div>
            <strong>{distribution.common?.title || typeLabel}</strong>
            <p className="conceptSavedAt">Opgeslagen: {formatNlDateTime(item.created_at)}</p>
            <p>{distribution.source_url && (!isWebsiteEvent || ["publish", "cancelled"].includes(websiteEventStatus)) ? <a href={distribution.source_url} target="_blank" rel="noreferrer">Bron openen</a> : isWebsiteEvent && websiteEventStatus === "draft" ? "Nog niet openbaar op de website" : "Campagneconcept in Horeca OS"}</p>
            {isWebsiteEvent && <p className={`websiteEventState ${websiteEventCancelled ? "cancelled" : ""}`}><b>Website-evenement:</b> {websiteEventDeleted ? "Verwijderd" : websiteEventCancelled ? "Geannuleerd — blijft online" : websiteEventStatus === "draft" ? "Eventin-concept" : "Gepubliceerd"}</p>}
            {isWebsiteEvent && !websiteEventCancelled && <div className="campaignWorkflow">
              <div className="campaignWorkflowSteps" aria-label="Publicatievolgorde">
                <span className={campaignWorkflowStep === 1 ? "current" : campaignWorkflowStep > 1 ? "done" : ""}>1. Eventin</span>
                <span className={campaignWorkflowStep === 2 ? "current" : campaignWorkflowStep > 2 ? "done" : ""}>2. Facebook-evenement</span>
                <span className={campaignWorkflowStep === 3 ? "current" : campaignWorkflowStep > 3 ? "done" : ""}>3. Facebookgroepen</span>
                <span className={campaignWorkflowStep === 4 ? "current" : ""}>4. Overige kanalen</span>
              </div>
              <p>{campaignWorkflowStep === 1
                ? "Controleer eerst het Eventin-concept en publiceer het. Daarna gebruikt Horeca OS de openbare ticketlink automatisch in de volgende stap."
                : campaignWorkflowStep === 2
                  ? "Eventin is gepubliceerd en de ticketlink is beschikbaar. Maak en controleer nu het Facebook-evenement."
                  : campaignWorkflowStep === 3
                    ? "Het Facebook-evenement is geplaatst. Rond nu de gekozen Facebookgroepen af."
                    : "Eventin, het Facebook-evenement en de Facebookgroepen zijn afgerond. Ga nu verder met e-mail, uitagenda’s en overige kanalen."}</p>
            </div>}
            <section className="savedManagementPanel">
              <div className="savedManagementHeading"><h4>Beheer in Horeca OS</h4><p>Algemene acties voor het volledige evenement. Dit blok hoort niet bij Microsoft Agenda, Eventin of Facebook.</p></div>
              <div className="conceptActions">
                <button type="button" className="conceptOpenButton" disabled={conceptBusy || websiteEventCancelled || websiteEventReadOnly || Boolean(editingBlockReason)} title={websiteEventReadOnly ? "Beveiligde Eventin-koppeling vereist" : websiteEventCancelled ? "Een geannuleerd website-evenement kan niet meer worden bijgewerkt; dupliceer het voor een nieuwe versie." : editingBlockReason} onClick={() => openCampaignConcept(item)}>{isWebsiteEvent ? websiteEventCancelled || websiteEventReadOnly ? "Bewerken geblokkeerd" : "Evenement bewerken" : editingBlockReason ? "Bewerken geblokkeerd" : "Concept bewerken"}</button>
                {isWebsiteEvent && !websiteEventCancelled && websiteEventStatus === "draft" && <button type="button" className="conceptPublishEventButton" disabled={conceptBusy || websiteEventReadOnly} onClick={() => changeWebsiteEventStatus(item, "publish")}>{conceptBusy ? "Publiceren…" : websiteEventReadOnly ? "Koppeling nodig" : "Publiceren"}</button>}
                {isWebsiteEvent && !websiteEventCancelled && websiteEventStatus === "publish" && <button type="button" className="conceptPublishEventButton" disabled={conceptBusy || websiteEventReadOnly} onClick={() => changeWebsiteEventStatus(item, "publish")}>{conceptBusy ? "Controleren…" : websiteEventReadOnly ? "Koppeling nodig" : "Eventin-agenda herstellen"}</button>}
                {isWebsiteEvent && !websiteEventCancelled && <button type="button" className="conceptWebsiteDraftButton" disabled={conceptBusy || websiteEventReadOnly || websiteEventStatus === "draft"} onClick={() => changeWebsiteEventStatus(item, "draft")}>{websiteEventReadOnly ? "Koppeling nodig" : websiteEventStatus === "draft" ? "Staat als concept" : "Naar concept"}</button>}
                {isWebsiteEvent && !websiteEventCancelled && <button type="button" className="conceptCancelEventButton" disabled={conceptBusy || websiteEventReadOnly} onClick={() => changeWebsiteEventStatus(item, "cancelled")}>Annuleren</button>}
                {isWebsiteEvent && !websiteEventDeleted && <button type="button" className="conceptCancelDeleteEventButton" disabled={conceptBusy || websiteEventReadOnly} onClick={() => changeWebsiteEventStatus(item, "trash")}>Annuleren en verwijderen</button>}
                <button type="button" className="conceptApproveButton" disabled={conceptBusy || providerConfirmed || (!approved && hasIncompleteChannels)} title={providerConfirmed ? "Geplaatste campagne vergrendeld" : !approved && hasIncompleteChannels ? `Vul eerst aan: ${formatChannelList(incompleteChannels)}` : ""} onClick={() => setConceptApproval(item, !approved)}>{providerConfirmed ? "Status vergrendeld" : approved ? "Terug naar concept" : "Goedkeuren"}</button>
                <button type="button" className="conceptDuplicateButton" disabled={conceptBusy} onClick={() => duplicateCampaignConcept(item)}>Dupliceren</button>
                {(distribution.target_channels || []).includes("facebook") && (!isWebsiteEvent || campaignWorkflowStep === 4) && !providerDeliveryConfirmed(distribution.provider_delivery?.facebook || {}) && <button type="button" className="conceptFacebookPublishButton" disabled={conceptBusy || !approved || websiteEventCancelled || hasIncompleteChannels || !facebookDestination?.page_id} title={!facebookDestination?.page_id ? "Koppel eerst de Facebookpagina van deze vestiging" : !approved ? "Keur het concept eerst goed" : ""} onClick={() => publishFacebookCampaign(item)}>{conceptBusy ? "Plaatsen…" : `Op ${facebookDestination?.page_name || "Facebook"} plaatsen`}</button>}
                {isWebsiteEvent && websiteEventDeleted && <button type="button" className="conceptDeleteButton" disabled={conceptBusy} onClick={() => cleanupDeletedWebsiteEvent(item)}>{conceptBusy ? "Opruimen..." : "Dossier en agenda opruimen"}</button>}
                {!isWebsiteEvent && <button type="button" className="conceptDeleteButton" disabled={conceptBusy || Boolean(deletionBlockReason)} title={deletionBlockReason} onClick={() => deleteCampaignConcept(item)}>{conceptBusy ? "Bezig..." : deletionBlockReason ? "Verwijderen geblokkeerd" : "Verwijderen"}</button>}
              </div>
            </section>
            {isWebsiteEvent && <section className="savedChannelPanel savedEventinPanel">
              <div className="savedChannelPanelHead"><div><h4>Eventin</h4><p>Website-evenement, evenementpagina en tickets</p></div><span>{websiteEventDeleted ? "Verwijderd" : websiteEventCancelled ? "Geannuleerd" : websiteEventStatus === "draft" ? "Concept" : "Gepubliceerd"}</span></div>
              <button type="button" className="conceptEventinPreviewButton" aria-expanded={savedEventPreviewId === String(item.id)} onClick={() => setSavedEventPreviewId((current) => current === String(item.id) ? null : String(item.id))}>{savedEventPreviewId === String(item.id) ? "Eventin-voorbeeld sluiten" : "Eventin-voorbeeld bekijken"}</button>
            </section>}
            {isWebsiteEvent && savedEventPreviewId === String(item.id) && <div className="savedEventinPreview" role="region" aria-label="Eventin-voorbeeld">
              <div className="savedEventinPreviewHead"><strong>Eventin-voorbeeld</strong><button type="button" onClick={() => setSavedEventPreviewId(null)}>Sluiten</button></div>
              <div className="savedEventinPreviewBody">
                {eventImageUrl ? <NextImage src={eventImageUrl} alt="Eventin-afbeelding" width={280} height={220} sizes="280px" unoptimized loader={({ src }) => src} /> : <div className="providerPreviewPlaceholder">Nog geen afbeelding</div>}
                <div>
                  <h3>{distribution.common?.title || "Naamloos evenement"}</h3>
                  <p><b>Datum en tijd:</b> {distribution.common?.start ? new Date(distribution.common.start).toLocaleString("nl-NL") : "niet ingevuld"} – {distribution.common?.end ? new Date(distribution.common.end).toLocaleString("nl-NL") : "niet ingevuld"}</p>
                  <p><b>Locatie:</b> {distribution.common?.location || "niet ingevuld"}</p>
                  <p className="providerPreviewText">{distribution.common?.description || distribution.common?.short_description || "Nog geen omschrijving"}</p>
                  <p><b>Tickets:</b> {distribution.common?.tickets?.variations?.length ? distribution.common.tickets.variations.map((ticket) => `${ticket.name || "Ticket"} (${ticket.type === "paid" ? `€ ${Number(ticket.price || 0).toFixed(2)}` : "gratis"})`).join(" · ") : "geen tickets"}</p>
                  <small>Dit is alleen een controleweergave. Er wordt niets gepubliceerd of gewijzigd.</small>
                </div>
              </div>
            </div>}
            {distribution.calendar_delivery && <section className={`savedChannelPanel savedCalendarPanel ${["failed", "cancelled"].includes(distribution.calendar_delivery.status) ? "cancelled" : ""}`}>
              <div className="savedChannelPanelHead"><div><h4>Microsoft-agenda</h4><p>{distribution.calendar_delivery.status === "confirmed" ? `Afspraak bevestigd en geplaatst in ${distribution.calendar_delivery.mailbox}` : distribution.calendar_delivery.status === "cancelled" ? `Afspraak geannuleerd in ${distribution.calendar_delivery.mailbox}` : distribution.calendar_delivery.status === "deleted" ? "Afspraak verwijderd" : `Nog niet geplaatst in ${distribution.calendar_delivery.mailbox || "de gekozen agenda"}`}</p></div><span>{distribution.calendar_delivery.status === "confirmed" ? "Afspraak geplaatst" : distribution.calendar_delivery.status === "cancelled" ? "Geannuleerd" : distribution.calendar_delivery.status === "deleted" ? "Verwijderd" : "Niet geplaatst"}</span></div>
              {["confirmed", "cancelled"].includes(distribution.calendar_delivery.status) && distribution.calendar_delivery.web_link && <a className="savedChannelLink" href={distribution.calendar_delivery.web_link} target="_blank" rel="noopener noreferrer" onClick={() => saveCurrentUiState()}>Agenda-afspraak bekijken</a>}
            </section>}
            {editorialTargets.length > 0 && (!isWebsiteEvent || campaignWorkflowStep === 4) && <div className="editorialSubmissionActions">
              <button type="button" className="editorialSubmissionToggle" aria-expanded={editorialExpanded} onClick={() => setExpandedEditorialCampaignIds((current) => current.includes(String(item.id)) ? current.filter((id) => id !== String(item.id)) : [...current, String(item.id)])}>
                <span><strong>Uitagenda's en redacties</strong><small>{editorialTargets.length} gekozen</small></span>
                <b>{editorialExpanded ? "Inklappen" : "Bekijken"}</b>
              </button>
              {editorialExpanded && <>
              <div className="editorialBulkActions"><span><b>{selectedEditorialEmailKeys.length} van {editorialEmailTargets.length} e-mails geselecteerd.</b> Websites met een eigen formulier staan standaard uit en blijven handmatige controlepunten.</span><div><button type="button" disabled={!selectedEditorialEmailKeys.length} onClick={() => {
                const firstEmailTarget = editorialEmailTargets.find((target) => selectedEditorialEmailKeys.includes(target.key));
                if (firstEmailTarget) setInternalEditorialEmail(editorialEmailDraft(firstEmailTarget, distribution.common, distribution.source_url));
              }}>E-mailvoorbeeld bekijken</button><button type="button" disabled={conceptBusy || !selectedEditorialEmailKeys.length} onClick={() => sendAllEditorialEmails(item, distribution, selectedEditorialEmailKeys)}>{conceptBusy ? "E-mails versturen…" : `Geselecteerde e-mails versturen (${selectedEditorialEmailKeys.length})`}</button></div></div>
              <div className="editorialSubmissionList">{editorialTargets.map((savedTarget) => {
                const target = editorialTargetDetails(savedTarget);
                const routePresentation = editorialRoutePresentation(target);
                return <div key={target.key} className={`editorialSubmissionRow editorialRoute-${target.route}`}>
                  {target.email && <label className="editorialEmailChoice">
                    <input type="checkbox" checked={selectedEditorialEmailKeys.includes(target.key)} onChange={(event) => setEditorialEmailSelections((current) => {
                      const campaignKey = String(item.id);
                      const currentKeys = current[campaignKey] ?? defaultEditorialEmailKeys;
                      const nextKeys = event.target.checked
                        ? [...new Set([...currentKeys, target.key])]
                        : currentKeys.filter((key) => key !== target.key);
                      return { ...current, [campaignKey]: nextKeys };
                    })} />
                    <span>{selectedEditorialEmailKeys.includes(target.key) ? "Meenemen in verzending" : "Niet versturen"}</span>
                  </label>}
                  <b>{target.label}</b>
                  <span className="editorialRouteBadge">{routePresentation.badge}</span>
                  <small>{routePresentation.explanation}</small>
                  {target.submissionUrl && <a href={target.submissionUrl} target="_blank" rel="noreferrer">Handmatige aanmeldpagina openen</a>}
                  {target.email && <button type="button" onClick={() => setInternalEditorialEmail(editorialEmailDraft(target, distribution.common, distribution.source_url))}>{target.route === "email" ? "E-mail intern controleren" : "E-mail gebruiken als website niet werkt"}</button>}
                </div>;
              })}</div>
              <small>Een klaargezette e-mail bevat titel, datum, tijden, locatie, omschrijving, evenementlink, afbeelding en contactgegevens. Controleer hem voordat je hem verstuurt.</small>
              </>}
            </div>}
            {websiteEventReadOnly && <p className="protectedCampaignNotice"><b>Alleen-lezen:</b> stel later de beveiligde Eventin-koppeling in om dit evenement vanuit Horeca OS te bewerken of annuleren.</p>}
            {hasIncompleteChannels && <p className="missingChannelNotice"><b>Nog aanvullen:</b> {formatChannelList(incompleteChannels)}. Goedkeuren en inplannen blijven geblokkeerd.</p>}
            {deletionBlockReason && <p className="protectedCampaignNotice"><b>Verwijderen geblokkeerd:</b> {deletionBlockReason}</p>}
            {editingBlockReason && <p className="protectedCampaignNotice"><b>Bewerken geblokkeerd:</b> {editingBlockReason}</p>}
            {providerConfirmed && <p className="placedCampaignLock"><b>Geplaatste campagne vergrendeld.</b> Goedkeuring en planning blijven ongewijzigd. Gebruik Dupliceren voor een nieuwe versie.</p>}
            {isWebsiteEvent && campaignWorkflowStep >= 2 && (distribution.target_channels || []).includes("facebook") && <div className={`facebookEventLinkActions ${facebookEventReady ? "confirmed" : ""}`}>
              <div className="savedChannelPanelHead"><div><h4>Facebook-evenement</h4><p>Evenement op de Facebookpagina van deze vestiging</p></div><span>{facebookEventDelivery.status === "confirmed" ? "Geplaatst" : "Nog niet geplaatst"}</span></div>
              {!facebookEventReady && <div className="savedFacebookPrimaryAction"><button type="button" disabled={!facebookDestination?.page_id || !distribution.source_url} title={!facebookDestination?.page_id ? "Koppel eerst de Facebookpagina van deze vestiging" : !distribution.source_url ? "De openbare Eventin-ticketlink ontbreekt nog" : "Kopieert de evenementgegevens inclusief ticketlink, downloadt de afbeelding en opent Facebook voor de vereiste bevestiging"} onClick={() => openFacebookEventCreator(distribution)}>{!distribution.source_url ? "Ticketlink ophalen" : "Facebook-evenement voorbereiden"}</button></div>}
              <strong>Facebookpagina: {facebookDestination?.page_name || "niet gekoppeld"}</strong>
              {facebookEventDelivery.status === "confirmed" && facebookEventDelivery.permalink
                ? <div className="savedFacebookPlaced"><p><b>Facebook-evenement geplaatst.</b> De koppeling is bevestigd en opgeslagen in Horeca OS.</p><a className="savedChannelLink" href={facebookEventDelivery.permalink} target="_blank" rel="noopener noreferrer" onClick={() => saveCurrentUiState()}>Facebook-evenement bekijken</a></div>
                : <div className="facebookEventManualWorkflow">
                  <p><b>Nog niet gekoppeld.</b> Meta ondersteunt geen automatische aanmaak van pagina-evenementen. Klik hierboven op <b>Open Facebook en bevestig evenement</b>. Horeca OS kopieert de tekst, downloadt de afbeelding en opent Facebook. Koppel daarna de nieuwe Facebook-link terug aan dit dossier.</p>
                  <button type="button" className="facebookEventManualToggle" onClick={() => setFacebookEventManualLinkIds((current) => current.includes(String(item.id)) ? current.filter((id) => id !== String(item.id)) : [...current, String(item.id)])}>
                    {facebookEventManualLinkIds.includes(String(item.id)) ? "Koppelvelden verbergen" : "Bestaand Facebook-evenement koppelen"}
                  </button>
                  {facebookEventManualLinkIds.includes(String(item.id)) && <div className="facebookEventManualFields">
                  <label className="check"><input type="checkbox" checked={Boolean(facebookEventOrganizerChecks[item.id])} onChange={(event) => setFacebookEventOrganizerChecks((current) => ({ ...current, [item.id]: event.target.checked }))} /> Ik heb gecontroleerd dat <b>{facebookDestination?.page_name || "de gekoppelde bedrijfspagina"}</b> de organisator is</label>
                  <input type="url" aria-label={`Facebook-evenementlink voor ${distribution.common?.title || typeLabel}`} value={facebookEventLinkEdits[item.id] || ""} onChange={(event) => setFacebookEventLinkEdits((current) => ({ ...current, [item.id]: event.target.value }))} placeholder="https://www.facebook.com/events/…" />
                  <button type="button" disabled={conceptBusy || !facebookEventOrganizerChecks[item.id] || !facebookEventLinkEdits[item.id]?.trim()} onClick={() => saveFacebookEventLink(item)}>Link aan dossier koppelen</button>
                  </div>}
                </div>}
            </div>}
            {selectedGroupTargets.length > 0 && (!isWebsiteEvent || campaignWorkflowStep >= 3) && <div className="facebookGroupShareActions">
              <strong>Facebookgroepen · ronde {groupShareState.round || 1}</strong>
              <p>{completedGroupIds.size} van {selectedGroupTargets.length} groepen afgerond. Per ronde worden maximaal 10 groepen aangeboden; iedere plaatsing bevestig je zelf in Facebook.</p>
              <div className="facebookGroupDelaySettings">
                <label>Wachttijd vanaf (minuten)<input type="number" min="0" max="240" value={groupShareState.delayMin ?? 5} onChange={(event) => setFacebookGroupShareProgress((current) => ({ ...current, [item.id]: { ...groupShareState, delayMin: event.target.value } }))} /></label>
                <label>Wachttijd tot (minuten)<input type="number" min="0" max="240" value={groupShareState.delayMax ?? 15} onChange={(event) => setFacebookGroupShareProgress((current) => ({ ...current, [item.id]: { ...groupShareState, delayMax: event.target.value } }))} /></label>
              </div>
              {facebookGroupImage && <a href={facebookGroupImage} target="_blank" rel="noopener noreferrer">Afbeelding openen</a>}
              {groupRoundWaiting
                ? <p className="facebookGroupWait">Volgende ronde beschikbaar over {Math.floor(groupRoundWaitSeconds / 60)}:{String(groupRoundWaitSeconds % 60).padStart(2, "0")} minuten · willekeurige pauze van {groupShareState.lastDelayMinutes} minuten.</p>
                : currentGroupRound.map((storedGroup) => {
                  const group = facebookGroups.find((candidate) => String(candidate.id) === String(storedGroup.id) || candidate.group_url === storedGroup.url) || storedGroup;
                  const senderReady = Boolean(group.sender_page_id && group.sender_verified_at && facebookAccount && String(group.sender_page_id) === String(facebookAccount.external_account_id));
                  return <div className={`facebookGroupSenderAction ${senderReady ? "ready" : "blocked"}`} key={group.id || group.url}><span>{senderReady ? `Controleer in Facebook of je werkelijk plaatst als ${group.sender_page_name}` : "Gewenste bedrijfsafzender niet gekoppeld"}</span><div><button type="button" disabled={!senderReady} onClick={() => openFacebookGroup(distribution, group)}>{senderReady ? `Open ${group.name}` : `${group.name} geblokkeerd`}</button><button type="button" disabled={!senderReady} onClick={() => confirmFacebookGroupPosted(group, item.id, currentGroupRound, remainingAfterGroupRound, groupShareState.delayMin ?? 5, groupShareState.delayMax ?? 15)}>Plaatsing bevestigen</button></div></div>;
                })}
              {completedGroupIds.size > 0 && <div className="completedFacebookGroupLinks">
                <strong>Handmatig geplaatste groepen</strong>
                {selectedGroupTargets.filter((group) => completedGroupIds.has(String(group.id || group.url))).map((group) => <a key={group.id || group.url} href={group.url || group.group_url} target="_blank" rel="noopener noreferrer">Open {group.name}</a>)}
                <small>Facebook geeft Horeca OS geen beheerlink naar het afzonderlijke groepsbericht. Verwijder het bericht daarom in de groep zelf.</small>
              </div>}
              {pendingGroupTargets.length === 0 && <p className="facebookGroupComplete">Alle gekozen Facebookgroepen zijn voor deze campagne afgerond.</p>}
              <button type="button" className="facebookGroupReset" onClick={() => setFacebookGroupShareProgress((current) => ({ ...current, [item.id]: { completed: [], waitUntil: 0, round: 1, delayMin: groupShareState.delayMin ?? 5, delayMax: groupShareState.delayMax ?? 15 } }))}>Voortgang opnieuw beginnen</button>
            </div>}
            {approved && !providerConfirmed && <div className="conceptSchedule">
              <label>Publicatiedatum<input type="date" disabled={hasIncompleteChannels || Boolean(item.scheduled_for)} value={conceptSchedule[item.id]?.date || ""} onInput={(event) => { const value = event.currentTarget.value; setConceptSchedule((current) => ({ ...current, [item.id]: { ...(current[item.id] || {}), date: value } })); }} /></label>
              <label>Publicatietijd<input type="time" disabled={hasIncompleteChannels || Boolean(item.scheduled_for)} value={conceptSchedule[item.id]?.time || ""} onInput={(event) => { const value = event.currentTarget.value; setConceptSchedule((current) => ({ ...current, [item.id]: { ...(current[item.id] || {}), time: value } })); }} /></label>
              {item.scheduled_for ? <>
                <span>Intern basisplan: {formatNlDateTime(item.scheduled_for)}</span>
                <button type="button" disabled={conceptBusy} onClick={() => scheduleConcept(item, true)}>Planning intrekken</button>
              </> : <button type="button" disabled={conceptBusy || hasIncompleteChannels} title={hasIncompleteChannels ? `Vul eerst aan: ${formatChannelList(incompleteChannels)}` : ""} onClick={() => scheduleConcept(item)}>Intern inplannen</button>}
            </div>}
            </div>
          </div>
          <div className="statusPills">
            {(distribution.target_channels || []).length === 0 && <span className={`status local ${isWebsiteEvent ? websiteEventStatus : ""}`}>
              {isWebsiteEvent
                ? websiteEventDeleted
                  ? "Verwijderd uit Eventin"
                  : websiteEventCancelled
                    ? "Eventin · Geannuleerd en online"
                    : websiteEventStatus === "draft"
                      ? "Eventin · Alleen als concept opgeslagen"
                      : "Eventin · Gepubliceerd op de website"
                : "Alleen als concept opgeslagen"}
            </span>}
            {(!isWebsiteEvent || campaignWorkflowStep === 4) && (distribution.target_channels || []).map((channel) => {
              const stored = distribution.channel_status?.[channel];
              const delivery = distribution.provider_delivery?.[channel] || {};
              const confirmed = providerDeliveryConfirmed(delivery);
              const channelSchedule = distribution.channel_schedule || {};
              const plannedAt = channelSchedule[channel] || (Object.keys(channelSchedule).length === 0 ? item.scheduled_for : null);
              const label = confirmed
                ? "Geplaatst (bevestigd)"
                : delivery.status === "draft_saved"
                  ? "Concept bij Brevo opgeslagen"
                  : delivery.status === "generating"
                    ? "Predis maakt een concept"
                    : delivery.status === "draft_ready"
                      ? "Predis-concept gereed"
                      : delivery.status === "generation_failed"
                        ? "Predis-generatie mislukt"
                        : plannedAt
                          ? `Intern concept gepland: ${formatNlDateTime(plannedAt)}`
                          : stored === "extra_gegevens_nodig"
                            ? "Extra gegevens nodig"
                            : approved ? "Intern concept goedgekeurd" : "Intern concept klaar voor controle";

              const copyKey = `${item.id}-${channel}`;
              const scheduleEditKey = `${item.id}-${channel}`;
              const conceptText = channelConceptText(distribution, channel, item.body);
              return <div className={`status ${stored || "klaar_voor_controle"}`} key={channel}>
                <span><b>{channelLabels[channel] || channel}</b> · {label}
                  {confirmed && delivery.permalink && <> · <a href={delivery.permalink} target="_blank" rel="noreferrer">Openen</a></>}
                  {channel === "predis" && delivery.status === "draft_ready" && delivery.result_url && <> · <a href={delivery.result_url} target="_blank" rel="noreferrer">Resultaat openen</a></>}
                </span>
                <div className="channelActions">
                  {plannedAt && !confirmed && <div className="channelPlanningActions">
                    <input type="datetime-local" aria-label={`Publicatiemoment voor ${channelLabels[channel] || channel}`} value={channelScheduleEdits[scheduleEditKey] ?? toLocalDateTimeInput(plannedAt)} onChange={(event) => setChannelScheduleEdits((current) => ({ ...current, [scheduleEditKey]: event.target.value }))} />
                    <button type="button" disabled={conceptBusy} onClick={() => updateChannelPlanning(item, channel)}>Tijd opslaan</button>
                    <button type="button" className="cancelChannelButton" disabled={conceptBusy} onClick={() => updateChannelPlanning(item, channel, true)}>Planning intrekken</button>
                  </div>}
                  {confirmed && <>
                    {(delivery.permalink || delivery.result_url) && <a className="channelManageLink" href={delivery.permalink || delivery.result_url} target="_blank" rel="noreferrer">Plaatsing beheren</a>}
                    <button type="button" onClick={() => showChannelManagementGuidance(channel, delivery)}>Bewerken of annuleren</button>
                  </>}
                  {copyableChannels.has(channel) && <button type="button" disabled={!conceptText} onClick={() => copyChannelConcept(item, distribution, channel)}>
                    {copiedChannelKey === copyKey ? "Gekopieerd ✓" : "Tekst kopiëren"}
                  </button>}
                </div>
              </div>;
            })}
          </div>
        </article>;
      })}
        {hasMoreCampaigns && <button type="button" className="loadMoreCampaigns" onClick={() => loadEventCampaigns({ append: true })} disabled={campaignListBusy}>{campaignListBusy ? "Campagnes laden…" : "Meer campagnes laden"}</button>}
      </>}
      <p className="statusNote">Een kanaal wordt pas als geplaatst getoond nadat Horeca OS een plaatsingsbevestiging heeft opgeslagen.</p>
    </div>}
    {isEvent && eventWorkspaceView === "existing" && <div className="existingWebsiteEvents creatorSection" id="bestaande-evenementen">
      <div className="existingWebsiteEventsHead"><div><p className="eyebrow">BESTAANDE WEBSITE-AGENDA</p><h3>Eventin-evenementen koppelen</h3><p>Hier staan bestaande evenementen apart van nieuwe en opgeslagen campagnes. Laden en koppelen verandert niets op de website.</p></div><button type="button" className="secondaryButton" onClick={loadManagedWebsiteEvents} disabled={managedEventsLoading}>{managedEventsLoading ? "Evenementen laden…" : "Bestaande evenementen laden"}</button></div>
      {managedWebsiteEvents.length > 0 && <div className="managedEventViewButtons">
        <button type="button" className={!showExpiredWebsiteEvents ? "active" : ""} onClick={() => setShowExpiredWebsiteEvents(false)}>Actuele evenementen ({currentManagedWebsiteEvents.length})</button>
        <button type="button" className={showExpiredWebsiteEvents ? "active expired" : ""} onClick={() => setShowExpiredWebsiteEvents(true)}>Verlopen evenementen ({expiredManagedWebsiteEvents.length})</button>
      </div>}
      {managedWebsiteEvents.length > 0 && <label className="managedEventSearch">Zoeken in {showExpiredWebsiteEvents ? "verlopen" : "actuele"} evenementen<input type="search" value={managedEventSearch} onChange={(event) => setManagedEventSearch(event.target.value)} placeholder="Zoek op naam, locatie, datum of jaar" /></label>}
      {managedWebsiteEvents.length > 0 && visibleManagedWebsiteEvents.length === 0 && <p className="emptyManagedEvents">{managedEventSearchQuery ? `Geen evenementen gevonden voor “${managedEventSearch.trim()}”.` : showExpiredWebsiteEvents ? "Er zijn geen verlopen evenementen." : "Er zijn geen actuele evenementen."}</p>}
      {visibleManagedWebsiteEvents.length > 0 && <div className="managedEventGrid">{visibleManagedWebsiteEvents.map((eventItem) => {
        const linked = eventCampaigns.some((campaign) => (campaign.media || []).some((entry) => entry?.kind === "campaign_distribution" && String(entry.eventin_event_id || "") === String(eventItem.id)));
        const incomplete = !eventItem.start || !eventItem.end || !eventItem.location;
        return <article key={eventItem.id}>
          <div><strong>{eventItem.title}</strong><span>{eventItem.readOnly ? "Gepubliceerd · alleen-lezen" : eventItem.status === "draft" ? "Eventin-concept" : "Gepubliceerd"}</span></div>
          <p>{eventItem.start ? formatNlDateTime(eventItem.start) : eventItem.eventDate ? formatNlDate(eventItem.eventDate) : "Datum moet na koppelen worden gecontroleerd"}{eventItem.location ? ` · ${eventItem.location}` : ""}</p>
          {incomplete && <small>De overzichtslijst bevat niet alle Eventin-velden. Bij koppelen haalt Horeca OS eerst de volledige datum, tijd, locatie, afbeelding en tickets op.</small>}
          <div className="managedEventActions">{eventItem.status !== "draft" && eventItem.url && <a href={eventItem.url} target="_blank" rel="noreferrer">Website openen</a>}{eventItem.status === "draft" && <small>Nog niet openbaar</small>}<button type="button" disabled={linked || importingEventId === eventItem.id} onClick={() => importManagedWebsiteEvent(eventItem)}>{linked ? "Al gekoppeld" : importingEventId === eventItem.id ? "Laden…" : "Aan Horeca OS koppelen"}</button><button type="button" className="copyManagedEvent" disabled={importingEventId === eventItem.id} onClick={() => useManagedWebsiteEventAsNew(eventItem)}>{importingEventId === eventItem.id ? "Laden…" : "Als nieuw evenement gebruiken"}</button></div>
        </article>;
      })}</div>}
    </div>}
    {internalEditorialEmail && <div className="internalEmailOverlay" role="dialog" aria-modal="true" aria-label={`E-mail voor ${internalEditorialEmail.targetLabel}`}>
      <div className="internalEmailComposer">
        <div className="internalEmailHead"><div><p className="eyebrow">INTERNE E-MAILCONTROLE</p><h3>{internalEditorialEmail.targetLabel}</h3></div><button type="button" onClick={() => setInternalEditorialEmail(null)}>Sluiten</button></div>
        <label>Aan<input value={internalEditorialEmail.to || ""} onChange={(event) => setInternalEditorialEmail((current) => ({ ...current, to: event.target.value }))} /></label>
        <label>Onderwerp<input value={internalEditorialEmail.subject} onChange={(event) => setInternalEditorialEmail((current) => ({ ...current, subject: event.target.value }))} /></label>
        <label>Bericht<textarea rows="16" value={internalEditorialEmail.body} onChange={(event) => setInternalEditorialEmail((current) => ({ ...current, body: event.target.value }))} /></label>
        <div className="internalEmailFooter"><span>Je blijft in Horeca OS. Er wordt nog niets verstuurd.</span><button type="button" onClick={async () => { try { await navigator.clipboard.writeText(`Aan: ${internalEditorialEmail.to}\nOnderwerp: ${internalEditorialEmail.subject}\n\n${internalEditorialEmail.body}`); setResult({ ok: true, message: "De volledige e-mail is gekopieerd." }); } catch { setResult({ ok: false, message: "Kopiëren is niet gelukt." }); } }}>Volledige e-mail kopiëren</button></div>
      </div>
    </div>}
    <style jsx>{`
      .imageUploadSuccess{display:block;margin-top:7px;color:#236d46;font-size:13px}.uploadedImageActions{display:flex;flex-wrap:wrap;align-items:center;gap:10px;margin-top:7px}.downloadImage{border:1px solid #25889b;border-radius:7px;padding:6px 9px;background:#fff;color:#176d7f;font:inherit;font-size:12px;font-weight:800;cursor:pointer}.eventinImagePreview>div{display:flex;min-width:0;flex-direction:column;align-items:flex-start;gap:7px}.eventinImagePreview>div small{max-width:160px;overflow-wrap:anywhere}
      .editorialSubmissionActions{display:grid;gap:8px;margin-top:10px;border:1px solid #d5e0e7;border-radius:10px;background:#f4f8fa;overflow:hidden}.editorialSubmissionToggle{display:flex;align-items:center;justify-content:space-between;gap:12px;width:100%;padding:12px 14px;border:0;background:#f4f8fa;color:#173552;font:inherit;cursor:pointer;text-align:left}.editorialSubmissionToggle span{display:flex;align-items:center;gap:9px;min-width:0}.editorialSubmissionToggle small{padding:4px 7px;border-radius:999px;background:#fff;color:#5c7285;font-size:11px;white-space:nowrap}.editorialSubmissionToggle>b{color:#176d7f}.editorialBulkActions{display:flex;align-items:center;justify-content:space-between;gap:12px;margin:0 12px;padding:11px;border-radius:9px;background:#e9f6ee;color:#236d46}.editorialBulkActions>span{display:grid;gap:3px}.editorialBulkActions>div{display:flex;flex-wrap:wrap;gap:7px}.editorialBulkActions button,.editorialSubmissionRow button{border:1px solid #25889b;border-radius:8px;padding:8px 10px;background:#fff;color:#176d7f;font:inherit;font-weight:800;cursor:pointer}.editorialBulkActions button:last-child{background:#25889b;color:#fff}.editorialSubmissionList{display:grid;gap:8px;padding:0 12px}.editorialSubmissionRow{display:grid;grid-template-columns:auto minmax(140px,1fr) auto;align-items:center;gap:8px;padding:10px;border-radius:8px;background:#fff}.editorialSubmissionRow>small{grid-column:2/-1;color:#5c7285}.editorialRouteBadge{display:inline-flex;padding:5px 8px;border-radius:999px;background:#fff2d1;color:#815b00;font-size:12px;font-weight:800}.editorialRoute-email .editorialRouteBadge{background:#e9f6ee;color:#236d46}.editorialRouteExplanation{display:block;margin-top:7px;color:#5c7285}.editorialEmailChoice{display:flex;align-items:center;gap:7px;padding:7px 9px;border:1px solid #9cbac3;border-radius:8px;background:#f7fbfc;color:#173552;font-weight:800}.editorialEmailChoice input{width:auto}.editorialEmailChoice span{font-size:13px}.editorialSubmissionActions>small{padding:0 12px 12px;color:#5c7285}.internalEmailOverlay{position:fixed;inset:0;z-index:1000;display:grid;place-items:center;padding:20px;background:rgba(13,34,52,.62)}.internalEmailComposer{display:grid;gap:12px;width:min(760px,100%);max-height:calc(100vh - 40px);overflow:auto;padding:20px;border-radius:14px;background:#fff;box-shadow:0 24px 70px rgba(0,0,0,.28)}.internalEmailHead,.internalEmailFooter{display:flex;align-items:center;justify-content:space-between;gap:12px}.internalEmailHead h3,.internalEmailHead p{margin:0}.internalEmailHead button,.internalEmailFooter button{border:1px solid #25889b;border-radius:8px;padding:9px 12px;background:#fff;color:#176d7f;font:inherit;font-weight:800;cursor:pointer}.internalEmailFooter span{color:#5c7285}.internalEmailFooter button{background:#25889b;color:#fff}
      .completedFacebookGroupLinks{display:flex;flex-wrap:wrap;align-items:center;gap:7px;flex-basis:100%;padding:10px;border:1px solid #b8cbea;border-radius:8px;background:#fff}.completedFacebookGroupLinks strong,.completedFacebookGroupLinks small{flex-basis:100%}.completedFacebookGroupLinks a{border:1px solid #1877f2;border-radius:7px;padding:7px 9px;color:#145dbf;font-weight:800;text-decoration:none}.completedFacebookGroupLinks small{color:#5c7285}
      .managedEventViewButtons{display:flex;flex-wrap:wrap;gap:8px;margin-top:14px}.managedEventViewButtons button{border:1px solid #9cbac3;border-radius:9px;padding:9px 12px;background:#fff;color:#405866;font-weight:800;cursor:pointer}.managedEventViewButtons button.active{border-color:#25889b;background:#25889b;color:#fff}.managedEventViewButtons button.active.expired{border-color:#8a5b00;background:#8a5b00}.managedEventSearch{margin-top:12px}.managedEventSearch input{max-width:640px}.emptyManagedEvents{margin:14px 0 0;padding:14px;border-radius:9px;background:#eef2f5;color:#5c7285}
      .ticketEditor{margin:0;padding:16px;border:1px solid #c6d5df;border-radius:12px}.ticketEditor>p{margin:2px 0 12px;color:#5c7285}.ticketDateRefresh{display:flex;align-items:center;justify-content:space-between;gap:14px;margin:12px 0;padding:12px;border:1px solid #9cbac3;border-radius:10px;background:#eef7f9}.ticketDateRefresh>div{display:flex;flex-direction:column;gap:3px}.ticketDateRefresh span{color:#5c7285;font-size:13px}.ticketDateRefresh button{flex:0 0 auto;border:0;border-radius:8px;padding:10px 13px;background:#25889b;color:#fff;font:inherit;font-weight:800;cursor:pointer}.ticketVariation{margin-top:12px;padding:14px;border:1px solid #d5e0e7;border-radius:10px;background:#f8fbfc}.ticketVariationHead{display:flex;align-items:center;justify-content:space-between;gap:12px;margin-bottom:12px}.ticketVariationGrid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px}.removeTicket{border:0;background:none;color:#a12f2f;font-weight:800;text-decoration:underline;cursor:pointer}.addTicket{margin-top:12px;border:1px solid #25889b;border-radius:9px;padding:10px 14px;background:#fff;color:#176d7f;font-weight:800;cursor:pointer}
      .existingWebsiteEvents{margin-top:22px;padding:18px;border:1px solid #c6d5df;border-radius:12px;background:#f8fbfc}.existingWebsiteEventsHead{display:flex;align-items:flex-start;justify-content:space-between;gap:16px}.existingWebsiteEventsHead h3,.existingWebsiteEventsHead p{margin:0}.existingWebsiteEventsHead>button{flex:0 0 auto}.managedEventGrid{display:grid;gap:10px;margin-top:14px}.managedEventGrid article{display:grid;gap:7px;padding:12px;border:1px solid #d5e0e7;border-radius:10px;background:#fff}.managedEventGrid article>div:first-child{display:flex;justify-content:space-between;gap:10px}.managedEventGrid article span{padding:4px 8px;border-radius:999px;background:#eef7f9;color:#176d7f;font-size:12px;font-weight:800}.managedEventGrid p{margin:0;color:#405866}.managedEventGrid small{color:#815b00}.managedEventActions{display:flex;flex-wrap:wrap;gap:8px;align-items:center}.managedEventActions a,.managedEventActions button{border:1px solid #25889b;border-radius:8px;padding:7px 10px;background:#fff;color:#176d7f;font-weight:800;text-decoration:none;cursor:pointer}.managedEventActions .copyManagedEvent{border-color:#78909c;color:#405866}.managedEventActions button:disabled{opacity:.55;cursor:not-allowed}
      .campaignCardMain{display:flex;gap:14px;min-width:0;flex:1}.campaignCardImage{flex:0 0 132px}.campaignCardImage img{display:block;width:132px;height:96px;border-radius:10px;object-fit:cover;background:#eef2f5}.campaignCardContent{min-width:0;flex:1}.websiteEventState{margin:8px 0 0!important;padding:8px 10px;border-radius:8px;background:#eef7f9;color:#176d7f}.websiteEventState.cancelled{background:#f8eaea;color:#a12f2f}.campaignWorkflow{display:grid;gap:8px;margin-top:10px;padding:11px;border:1px solid #b8cdd8;border-radius:9px;background:#f7fafb}.campaignWorkflow p{margin:0;color:#405866;font-size:13px}.campaignWorkflowSteps{display:grid;grid-template-columns:repeat(4,minmax(120px,1fr));gap:6px}.campaignWorkflowSteps span{padding:7px 9px;border-radius:7px;background:#e7edf0;color:#526773;font-size:12px;font-weight:800;text-align:center}.campaignWorkflowSteps span.done{background:#e1f3e8;color:#17613d}.campaignWorkflowSteps span.current{background:#1877f2;color:#fff}.conceptPublishEventButton{border:1px solid #23804f;color:#17613d;background:#eefaf3}.conceptWebsiteDraftButton{border:1px solid #c88a18;color:#815b00}.conceptCancelEventButton{border:1px solid #c95d5d;color:#a12f2f}.conceptActions .conceptCancelDeleteEventButton{border:1px solid #8f1f1f;color:#fff;background:#a12f2f}.conceptActions .conceptFacebookPublishButton{border:1px solid #1877f2;color:#fff;background:#1877f2}
      .facebookDestination{display:grid;gap:3px;padding:11px 12px;border-left:4px solid #1877f2;border-radius:8px;background:#eef5ff}.facebookDestination.ready strong{color:#145dbf}.facebookDestination.missing{border-left-color:#e4a91b;background:#fff2d1;color:#815b00}.facebookDestination span{font-size:13px}.channelActions,.channelPlanningActions{display:flex;flex-wrap:wrap;align-items:center;gap:6px}.channelPlanningActions input{width:190px;padding:6px 8px;font-size:11px}.channelManageLink{display:inline-flex;align-items:center;border:1px solid currentColor;border-radius:7px;padding:5px 7px;background:#fff;text-decoration:none}.cancelChannelButton{color:#a12f2f!important}.facebookGroupPicker{display:grid;gap:9px;padding:12px;border-radius:9px;background:#f5f8fa}.facebookGroupPicker p{margin:0}.facebookGroupPickerHead{display:flex;justify-content:space-between;gap:12px;align-items:center}.facebookGroupPickerHead span{padding:5px 8px;border-radius:999px;background:#e5efff;color:#145dbf;font-size:12px;font-weight:800}.facebookGroupSavedLists{display:grid;gap:9px;padding:12px;border:1px solid #b8cdd8;border-radius:9px;background:#fff}.facebookGroupSavedLists>div:first-child p,.facebookGroupListEmpty{color:#405866;font-size:13px}.facebookGroupListCreate{display:grid;grid-template-columns:minmax(200px,1fr) auto;gap:8px}.facebookGroupListCreate button,.facebookGroupSavedListGrid button{border:1px solid #16869a;border-radius:8px;padding:8px 10px;background:#fff;color:#0f6d7d;font-weight:800;cursor:pointer}.facebookGroupListCreate button:disabled,.facebookGroupSavedListGrid button:disabled{cursor:not-allowed;opacity:.5}.facebookGroupSavedListGrid{display:grid;grid-template-columns:repeat(auto-fit,minmax(280px,1fr));gap:8px}.facebookGroupSavedListGrid article{display:grid;gap:8px;padding:10px;border-radius:8px;background:#eef8fa}.facebookGroupSavedListGrid article>span{display:flex;justify-content:space-between;gap:8px}.facebookGroupSavedListGrid article small{color:#405866}.facebookGroupSavedListGrid article>div{display:flex;flex-wrap:wrap;gap:6px}.facebookGroupSavedListGrid button.danger{border-color:#b34949;color:#a12f2f}.facebookGroupAdvicePanel{display:grid;grid-template-columns:1fr auto;gap:6px 12px;padding:11px;border:1px solid #76b992;border-radius:9px;background:#eefaf3}.facebookGroupAdvicePanel>div,.facebookGroupAdvicePanel p{grid-column:1}.facebookGroupAdvicePanel>div{display:flex;flex-wrap:wrap;gap:7px 12px}.facebookGroupAdvicePanel>div span{color:#236d46;font-weight:800}.facebookGroupAdvicePanel p{color:#405866;font-size:13px}.facebookGroupAdvicePanel button{grid-column:2;grid-row:1/3;align-self:center;border:1px solid #23804f;border-radius:8px;padding:9px 11px;background:#fff;color:#17613d;font-weight:800;cursor:pointer}.facebookGroupTools{display:grid;grid-template-columns:minmax(220px,1fr) auto;align-items:end;gap:10px}.facebookGroupTools>div{display:flex;gap:7px}.facebookGroupTools button{border:1px solid #1877f2;border-radius:8px;padding:9px 11px;background:#fff;color:#145dbf;font-weight:800;cursor:pointer}.facebookGroupList{display:grid;gap:7px;max-height:330px;overflow:auto;padding:4px 8px 4px 2px;border-block:1px solid #d5e0e7}.facebookGroupChoice{display:flex;align-items:center;justify-content:space-between;gap:10px;padding:8px;border-radius:8px}.facebookGroupChoice.senderMissing{background:#fff2d1}.facebookGroupChoice.senderReady{background:#e9f6ee}.facebookGroupChoice.recommended{box-shadow:inset 4px 0 #23804f}.facebookGroupChoice.avoid{background:#fff0f0;box-shadow:inset 4px 0 #a12f2f}.facebookGroupChoice label span{display:grid}.facebookGroupChoice label b{display:flex;flex-wrap:wrap;align-items:center;gap:6px}.facebookGroupChoice label em{padding:2px 6px;border-radius:999px;background:#d7f0e1;color:#17613d;font-size:10px;font-style:normal}.facebookGroupChoice label em.conditional{background:#fff2d1;color:#815b00}.facebookGroupChoice label em.avoid{background:#f5dede;color:#a12f2f}.facebookGroupChoice label small{font-weight:600}.facebookGroupChoice>div{display:flex;gap:8px}.facebookGroupChoice button{border:0;background:none;color:#a12f2f;text-decoration:underline;cursor:pointer}.facebookGroupChoice button:first-child:not(:last-child){color:#145dbf}.facebookGroupAdd{display:grid;grid-template-columns:1fr 1.4fr auto;gap:8px}.facebookGroupAdd button,.facebookGroupShareActions button{border:1px solid #1877f2;border-radius:8px;padding:9px 11px;background:#fff;color:#145dbf;font-weight:800;cursor:pointer}.facebookGroupShareActions{display:flex;flex-wrap:wrap;align-items:center;gap:7px;margin-top:10px;padding:10px;border-left:4px solid #1877f2;border-radius:8px;background:#eef5ff}.facebookGroupShareActions strong,.facebookGroupShareActions>p{flex-basis:100%;margin:0}.facebookGroupShareActions p{color:#405866;font-size:13px}.facebookGroupSenderAction{display:grid;gap:3px;padding:8px;border-radius:8px;background:#fff}.facebookGroupSenderAction.blocked{border:1px solid #c94b4b;background:#fff0f0}.facebookGroupSenderAction span{font-size:12px;font-weight:800}.facebookGroupDelaySettings{display:grid;grid-template-columns:repeat(2,minmax(150px,220px));gap:8px;flex-basis:100%}.facebookGroupDelaySettings input{padding:7px 9px}.facebookGroupWait{padding:9px 11px;border-radius:8px;background:#fff2d1;color:#815b00!important}.facebookGroupComplete{padding:9px 11px;border-radius:8px;background:#e9f6ee;color:#236d46!important}.facebookGroupShareActions .facebookGroupReset{margin-left:auto;border-color:#78909c;color:#405866}
      .facebookChannelSection{grid-column:1/-1}.facebookGroupTools>div{flex-wrap:wrap;justify-content:flex-end}.facebookGroupList{min-width:0;overflow-x:hidden}.facebookGroupList.compact{max-height:430px;overflow-y:auto}.facebookGroupList.expanded{max-height:none;overflow:visible}.facebookGroupChoice{min-width:0;padding:10px}.facebookGroupChoice label,.facebookGroupChoice label span{min-width:0}.facebookGroupChoice label small{overflow-wrap:anywhere}.facebookGroupChoice>div{flex-wrap:wrap;justify-content:flex-end}
      .campaignTypeGrid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:10px;margin:0 0 20px}.campaignTypeGrid button{display:flex;flex-direction:column;gap:4px;text-align:left;padding:14px;border:1px solid #c6d5df;border-radius:12px;background:#fff;color:#173552;cursor:pointer}.campaignTypeGrid button.active{border-color:#25889b;background:#eef7f9;box-shadow:inset 0 0 0 1px #25889b}.campaignTypeGrid span{font-size:13px;color:#5c7285;font-weight:400}
      .eventWorkspaceChooser{display:grid;gap:14px;margin:0 0 20px;padding:18px;border:1px solid #b9d2da;border-radius:14px;background:#f8fbfc}.eventWorkspaceChooser h3,.eventWorkspaceChooser p{margin:0}.eventWorkspaceChoices{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:12px}.eventWorkspaceChoices button{display:flex;min-height:112px;flex-direction:column;gap:6px;padding:16px;border:1px solid #c6d5df;border-radius:12px;background:#fff;color:#173552;text-align:left;cursor:pointer}.eventWorkspaceChoices button.active{border-color:#25889b;background:#eaf7f9;box-shadow:inset 0 0 0 2px #25889b}.eventWorkspaceChoices strong{font-size:16px}.eventWorkspaceChoices span{color:#5c7285;line-height:1.4}
      .creatorQuickBar{position:sticky;top:10px;z-index:20;display:flex;align-items:center;justify-content:space-between;gap:12px;margin:0 0 18px;padding:10px;border:1px solid #b9d2da;border-radius:12px;background:rgba(255,255,255,.97);box-shadow:0 8px 24px rgba(23,53,82,.12);backdrop-filter:blur(8px)}.creatorQuickLinks,.creatorQuickActions{display:flex;align-items:center;gap:7px}.creatorQuickLinks{min-width:0;overflow-x:auto}.creatorQuickBar button{flex:0 0 auto;border:1px solid #9cbac3;border-radius:8px;padding:8px 10px;background:#f7fbfc;color:#176d7f;font:inherit;font-size:13px;font-weight:800;cursor:pointer}.creatorQuickActions button{border-color:#25889b;background:#25889b;color:#fff}.creatorQuickActions .secondaryButton{background:#fff;color:#176d7f}.creatorSection{scroll-margin-top:92px}
      .missingChannelNotice{margin:8px 0 0!important;padding:9px 11px;border-left:4px solid #e4a91b;border-radius:8px;background:#fff2d1;color:#815b00}.protectedCampaignNotice{margin:8px 0 0!important;padding:9px 11px;border-left:4px solid #78909c;border-radius:8px;background:#eef2f5;color:#405866}.placedCampaignLock{margin:8px 0 0!important;padding:9px 11px;border-left:4px solid #3a9455;border-radius:8px;background:#e9f6ee;color:#236d46}.conceptHeading{display:flex;flex-wrap:wrap;gap:7px;align-items:center;margin-bottom:5px}.campaignKind{display:block;width:max-content;padding:4px 8px;border-radius:999px;background:#eef7f9;color:#176d7f;font-size:12px;font-weight:800}.conceptSavedAt{margin:4px 0!important;color:#5c7285;font-size:12px}.approvalState{padding:4px 8px;border-radius:999px;font-size:12px;font-weight:800}.approvalState.draft{background:#eef2f5;color:#4c6172}.approvalState.approved{background:#e5f6ea;color:#24723b}.campaignStatus article>div:first-child strong{display:block}.status.local{background:#eef2f5;color:#4c6172}.editingNotice{display:flex;gap:10px;align-items:center;margin:14px 0;padding:12px 14px;border-left:4px solid #25889b;border-radius:8px;background:#eef7f9;color:#173552}.editingNotice span{flex:1;color:#5c7285}.editingNotice button{border:1px solid #25889b;border-radius:8px;padding:8px 11px;background:#fff;color:#176d7f;font-weight:800;cursor:pointer}.conceptFilters{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:12px;margin:16px 0 10px}.conceptSearch{grid-column:1/-1}.conceptFilterSummary{display:flex;align-items:center;justify-content:space-between;gap:12px;margin-bottom:16px;color:#5c7285;font-size:13px}.conceptFilterSummary button{border:0;background:none;color:#176d7f;font:inherit;font-weight:800;text-decoration:underline;cursor:pointer}.emptyConcepts{padding:16px;border-radius:10px;background:#f5f8fa;color:#5c7285}.emptyCampaignState{display:grid;justify-items:start;gap:8px;margin-top:16px;padding:18px;border:1px dashed #9cbac3;border-radius:12px;background:#f8fbfc}.emptyCampaignState p{margin:0;color:#5c7285}.emptyCampaignState button{border:0;border-radius:9px;padding:10px 14px;background:#25889b;color:#fff;font-weight:800;cursor:pointer}.conceptActions{display:flex;flex-wrap:wrap;gap:7px;margin-top:9px}.conceptActions button,.conceptSchedule button{padding:8px 11px;border-radius:8px;background:#fff;font-weight:800;cursor:pointer}.conceptActions button:disabled,.conceptSchedule button:disabled{opacity:.55;cursor:wait}.conceptOpenButton{border:1px solid #25889b;color:#176d7f}.conceptApproveButton{border:1px solid #3a9455;color:#24723b}.conceptDuplicateButton{border:1px solid #78909c;color:#405866}.conceptDeleteButton{border:1px solid #c95d5d;color:#a12f2f}.conceptSchedule{display:flex;flex-wrap:wrap;gap:8px;align-items:flex-end;margin-top:10px;padding:10px;border-radius:9px;background:#f5f8fa}.conceptSchedule label{min-width:220px}.conceptSchedule button{border:1px solid #25889b;color:#176d7f}.conceptSchedule span{align-self:center;color:#405866;font-size:13px;font-weight:700}
      .placementChoices{display:grid;gap:8px}.placementChoices>span{font-weight:800}.placementChoices label{font-weight:700}.facebookEventLinkActions{display:grid;gap:8px;margin-top:10px;padding:12px;border-radius:9px;background:#eef7fa}.facebookEventManualWorkflow{display:grid;gap:9px}.facebookEventManualWorkflow p{margin:0;color:#405866}.facebookEventManualToggle{justify-self:start;border:1px solid #25889b;border-radius:8px;padding:8px 10px;background:#fff;color:#176d7f;font:inherit;font-weight:800;cursor:pointer}.facebookEventManualFields{display:grid;grid-template-columns:minmax(220px,1fr) auto;gap:8px;align-items:center;padding-top:4px}.facebookEventManualFields>.check{grid-column:1/-1}.facebookEventManualFields input{min-width:0}.facebookEventManualFields button{border:1px solid #25889b;border-radius:8px;padding:9px 11px;background:#25889b;color:#fff;font:inherit;font-weight:800;cursor:pointer}.brevoAudiencePicker{display:grid;gap:8px;padding:10px;border-radius:9px;background:#f5f8fa}.brevoAudiencePicker p{margin:0}.brevoAudiencePicker small{color:#5c7285}.brevoAudienceError{color:#a12f2f}.predisGenerationChoice{display:grid;gap:8px;padding:10px;border-radius:9px;background:#f5f8fa}.predisGenerationChoice small{color:#5c7285}.staggerFields{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px}.eventinDestination{display:grid;grid-template-columns:minmax(240px,1fr) minmax(240px,1fr);align-items:end;gap:10px;padding:13px;border:1px solid #57ad7d;border-radius:10px;background:#e9f6ee}.eventinDestination>.check{align-self:center;color:#236d46}.eventinDestination>small{grid-column:1/-1;color:#405866}
      .eventCreatorGrid,.channelDetails{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:14px}.channelDetails fieldset{margin:0;padding:14px;border:1px solid #c6d5df;border-radius:12px;display:grid;gap:10px}.channelDetails legend,.eventDestinations legend{font-weight:800}.channelDetails p{margin:0;color:#5c7285}.channelChecks{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:9px}.channelCheck{display:flex;flex-direction:row;align-items:center;justify-content:space-between;gap:8px;padding:9px 10px;border:1px solid #d5e0e7;border-radius:9px;background:#fff}.channelCheck .check{margin:0}.channelCheck small{padding:4px 7px;border-radius:999px;background:#eef7f9;color:#176d7f;font-size:11px;white-space:nowrap}.editorialAgendaPicker{min-width:0;overflow:hidden}.editorialTargetBulkActions{display:flex;flex-wrap:wrap;gap:8px}.editorialTargetBulkActions button{border:1px solid #25889b;border-radius:8px;padding:9px 12px;background:#fff;color:#176d7f;font:inherit;font-weight:800;cursor:pointer}.editorialTargetBulkActions button:first-child{background:#25889b;color:#fff}.editorialTargetGrid{grid-template-columns:repeat(auto-fit,minmax(min(100%,340px),1fr))}.editorialTargetCard{display:block;min-width:0}.editorialTargetHead{display:flex;align-items:flex-start;justify-content:space-between;gap:10px;min-width:0}.editorialTargetHead .check{min-width:0}.editorialTargetHead small{flex:0 1 auto;max-width:55%;white-space:normal;text-align:right}.editorialTargetLinks{display:flex;flex-wrap:wrap;gap:6px 12px;margin-top:8px;min-width:0}.editorialTargetLinks a,.editorialTargetLinks span{max-width:100%;overflow-wrap:anywhere;word-break:break-word}.editorialTargetHint{display:block;margin-top:7px;white-space:normal!important}.channelSafetyNote{margin:0;padding:10px 12px;border-left:4px solid #25889b;border-radius:8px;background:#eef7f9;color:#405866}.check{flex-direction:row;align-items:center}.wide{grid-column:1/-1}label{display:flex;flex-direction:column;gap:6px;font-weight:700;color:#173552}input,select,textarea{width:100%;box-sizing:border-box;border:1px solid #c6d5df;border-radius:9px;padding:11px 12px;background:#fff;color:#173552;font:inherit}textarea{resize:vertical}.check input,.eventDestinations input[type=checkbox]{width:auto}.imageUploads{padding:16px;border:1px solid #c6d5df;border-radius:12px;background:#f8fbfc}.imageUploadHead p,.imageHelp,.uploadedImage p{margin:4px 0 0;color:#5c7285}.eventinImageStatus{display:flex;align-items:center;justify-content:space-between;gap:16px;margin-top:14px;padding:13px;border-radius:10px;border:1px solid #d5e0e7}.eventinImageStatus>div:first-child{display:flex;flex-direction:column;gap:4px}.eventinImageStatus span{font-weight:800}.eventinImageStatus small{color:#5c7285}.eventinImageStatus.ready{border-color:#57ad7d;background:#e9f6ee}.eventinImageStatus.ready span{color:#236d46}.eventinImageStatus.empty{background:#fff}.eventinImagePreview{display:grid;grid-template-columns:72px minmax(80px,160px);align-items:center;gap:9px}.eventinImagePreview img{display:block;width:72px;height:72px;border-radius:8px;object-fit:cover}.eventinImagePreview small{overflow-wrap:anywhere}.cropFocus{margin-top:14px;padding:12px;border-radius:10px;background:#eef7f9}.cropFocus select{margin-top:2px}.cropFocus small{color:#5c7285;font-weight:500}.imageSlotGrid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px;margin-top:14px}.imageSlot{display:flex;justify-content:space-between;gap:12px;min-height:125px;padding:13px;border:1px solid #d5e0e7;border-radius:10px;background:#fff;transition:border-color .15s ease,background .15s ease,transform .15s ease}.imageSlot.imageSlotAll{margin-top:14px;border:2px dashed #25889b;background:#eef9fa}.imageSlot.exact{border-color:#57ad7d}.imageSlot.dragging{border:2px dashed #25889b;background:#e7f6f8;transform:translateY(-2px)}.imageSlot>div:first-child{display:flex;flex-direction:column;gap:4px}.imageSlot span{font-weight:800;color:#176d7f}.imageSlot small{color:#5c7285;max-width:220px}.imageDropZone{min-width:180px;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:7px;padding:12px;border:2px dashed #9cbac3;border-radius:10px;background:#f7fbfc;text-align:center}.imageDropZone>strong{color:#176d7f;font-size:13px}.imageDropZone>small,.replaceHint{color:#5c7285;font-weight:600}.uploadButton{align-self:center;display:inline-flex;cursor:pointer;background:#25889b;color:#fff;padding:10px 12px;border-radius:8px;text-align:center}.uploadButton input{display:none}.uploadedImage{min-width:145px}.imagePreview{height:74px;border-radius:8px;background-size:cover;background-position:center}.uploadedImage p{font-size:12px}.removeImage{border:0;background:none;color:#a23a3a;text-decoration:underline;cursor:pointer;padding:4px 0}.uploadMessage{padding:9px 11px;border-radius:8px}.uploadMessage.success{background:#e9f6ee;color:#236d46}.uploadMessage.error{background:#fff2d1;color:#815b00}.eventDestinations{margin:18px 0;padding:16px;border:1px solid #c6d5df;border-radius:12px;display:grid;gap:12px}.eventPreview,.eventResult{padding:16px;margin:14px 0;border-radius:12px;background:#eef7f9}.mediaCheck{margin-top:14px;padding:12px 14px;border-radius:9px}.mediaCheck ul{margin:8px 0 0;padding-left:20px}.mediaCheckReady{background:#e9f6ee;color:#236d46}.mediaCheckWarning{background:#fff2d1;color:#815b00}.channelImagePreviewGrid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px;margin-top:16px}.channelImagePreview{background:#fff;border:1px solid #c6d5df;border-radius:10px;padding:12px}.channelImagePreviewHead{display:flex;align-items:center;justify-content:space-between;gap:10px;margin-bottom:10px}.channelImagePreviewHead span{font-size:12px;padding:5px 8px;border-radius:999px}.imageReady{background:#e9f6ee;color:#236d46}.imageMissing{background:#fff2d1;color:#815b00}.channelImagePreview img{display:block;width:100%;height:180px;object-fit:contain;background:#f4f7f9;border-radius:8px}.channelImagePreview p{margin:9px 0 3px}.channelImagePreview small{display:block;color:#5c7285;line-height:1.4}.channelImagePreview .fallbackNotice{color:#815b00}.missingImageNotice{padding:16px;background:#fff8e6;border-radius:8px;color:#815b00}.eventResult.success{border-left:5px solid #2ba66d}.eventResult.error{background:#fff2d1;border-left:5px solid #e4a91b}.earlyDraftAction{display:flex;align-items:center;justify-content:space-between;gap:16px;margin-top:18px;padding:14px;border:1px dashed #9cbac3;border-radius:10px;background:#f8fbfc}.earlyDraftAction p{margin:4px 0 0;color:#5c7285}.earlyDraftAction button{flex:0 0 auto;border:1px solid #25889b;border-radius:9px;padding:11px 15px;background:#fff;color:#176d7f;font-weight:800;cursor:pointer}.eventActions{display:flex;gap:12px;justify-content:flex-end;margin-top:18px}.eventActions button{border:0;border-radius:9px;padding:12px 18px;background:#25889b;color:#fff;font-weight:800;cursor:pointer}.eventActions .secondaryButton{background:#fff;color:#176d7f;border:1px solid #25889b}button:disabled{opacity:.55;cursor:not-allowed}.campaignStatus{margin-top:22px;padding-top:20px;border-top:1px solid #d5e0e7}.statusHead,.campaignStatus article{display:flex;justify-content:space-between;gap:16px;align-items:flex-start}.campaignStatus article{padding:14px 0;border-top:1px solid #e1e9ee}.statusHead h3,.campaignStatus p{margin:0}.statusPills{display:flex;flex-wrap:wrap;gap:7px;justify-content:flex-end}.status{display:flex;align-items:center;gap:8px;padding:7px 9px;border-radius:12px;background:#e9f6ee;color:#236d46;font-size:13px}.status button{border:1px solid currentColor;border-radius:7px;padding:5px 7px;background:#fff;color:inherit;font:inherit;font-weight:800;cursor:pointer}.status button:disabled{opacity:.5;cursor:not-allowed}.status.extra_gegevens_nodig{background:#fff2d1;color:#815b00}.loadMoreCampaigns{display:block;margin:14px auto 4px;border:1px solid #25889b;border-radius:9px;padding:10px 16px;background:#fff;color:#176d7f;font-weight:800;cursor:pointer}.loadMoreCampaigns:disabled{opacity:.55;cursor:wait}.statusNote{color:#5c7285;font-size:13px}@media(max-width:760px){.earlyDraftAction{display:block}.earlyDraftAction button{width:100%;margin-top:10px}.campaignTypeGrid,.eventCreatorGrid,.channelDetails,.channelChecks,.imageSlotGrid,.conceptFilters,.channelImagePreviewGrid,.staggerFields{grid-template-columns:1fr}.wide{grid-column:auto}.imageSlot,.eventinImageStatus{display:block}.eventinImagePreview{margin-top:12px}.uploadButton{margin-top:12px}.eventActions{flex-direction:column}.statusHead,.campaignStatus article{display:block}.statusPills{justify-content:flex-start;margin-top:10px}}
      @media(max-width:760px){.ticketVariationGrid,.facebookGroupAdd,.facebookGroupTools,.facebookGroupDelaySettings,.eventWorkspaceChoices,.facebookGroupAdvicePanel,.facebookGroupListCreate,.campaignWorkflowSteps{grid-template-columns:1fr}.facebookGroupAdvicePanel>div,.facebookGroupAdvicePanel p,.facebookGroupAdvicePanel button{grid-column:1;grid-row:auto}.facebookGroupPickerHead{align-items:flex-start}.facebookGroupTools>div{flex-wrap:wrap}.facebookGroupShareActions button{width:100%}.facebookGroupShareActions .facebookGroupReset{margin-left:0}.campaignCardMain{display:block}.campaignCardImage{margin-bottom:10px}.campaignCardImage img{width:100%;max-width:220px;height:120px}.creatorQuickBar{top:6px;display:block;padding:8px}.creatorQuickLinks,.creatorQuickActions{overflow-x:auto}.creatorQuickActions{margin-top:7px}.creatorQuickBar button{padding:8px;font-size:12px}.creatorSection{scroll-margin-top:126px}.editorialBulkActions,.internalEmailHead,.internalEmailFooter{align-items:stretch;flex-direction:column}.editorialBulkActions>div{display:grid}.editorialSubmissionToggle span{align-items:flex-start;flex-direction:column}.internalEmailOverlay{padding:8px}}
      .channelPreviewControls{display:flex;align-items:center;justify-content:space-between;gap:18px;margin-top:18px;padding:15px;border:1px solid #9cbac3;border-radius:12px;background:#f8fbfc}.channelPreviewControls p{margin:4px 0 0;color:#5c7285}.channelPreviewButtons{display:flex;flex-wrap:wrap;gap:8px}.channelPreviewButtons button{border:1px solid #25889b;border-radius:9px;padding:10px 13px;background:#fff;color:#176d7f;font:inherit;font-weight:800;cursor:pointer}.channelPreviewButtons button.active{background:#25889b;color:#fff}.channelSpecificPreview{margin:14px 0;padding:16px;border:2px solid #25889b;border-radius:12px;background:#eef7f9;scroll-margin-top:110px}.channelSpecificPreviewHead{display:flex;align-items:center;justify-content:space-between;gap:12px;margin-bottom:14px}.channelSpecificPreviewHead span,.googleTopicLabel{padding:5px 9px;border-radius:999px;background:#e9f6ee;color:#236d46;font-size:12px;font-weight:800}.providerPreviewCard{display:grid;grid-template-columns:minmax(180px,280px) 1fr;gap:18px;padding:14px;border-radius:10px;background:#fff}.providerPreviewCard img,.providerPreviewPlaceholder{width:100%;height:220px;border-radius:9px;object-fit:contain;background:#f1f4f6}.providerPreviewPlaceholder{display:flex;align-items:center;justify-content:center;padding:14px;box-sizing:border-box;color:#5c7285;text-align:center}.providerPreviewCard h3{margin:6px 0 10px}.providerPreviewText{white-space:pre-wrap;line-height:1.55}.providerPreviewCard small{display:block;margin-top:10px;color:#5c7285}.emailProviderPreview{padding:16px;border-radius:10px;background:#fff}.emailProviderPreview>p{overflow-wrap:anywhere}.emailPreviewBody{margin:14px 0;padding:16px;border:1px solid #d5e0e7;border-radius:9px;background:#fafcfd}.googleProviderPreview button{width:auto;margin-top:8px}@media(max-width:760px){.channelPreviewControls{display:block}.channelPreviewButtons{margin-top:12px}.channelPreviewButtons button{width:100%}.providerPreviewCard{grid-template-columns:1fr}}
      @media(max-width:760px){.facebookEventManualFields{grid-template-columns:1fr}.facebookEventManualFields>.check{grid-column:auto}}
      .campaignStatus article{display:grid;grid-template-columns:minmax(0,1fr);gap:12px;width:100%}
      .campaignStatus article>.campaignCardMain{width:100%;max-width:100%}
      .campaignStatus article>.statusPills{width:100%;justify-content:flex-start}
      .campaignStatus article>.statusPills .status{max-width:100%;flex-wrap:wrap;overflow-wrap:anywhere}
      .conceptEventinPreviewButton{border:1px solid #25889b;color:#176d7f}
      .savedChannelPanel{margin-top:12px;padding:14px;border:1px solid #c6d5df;border-radius:12px;background:#f8fbfc}
      .savedChannelPanelHead{display:flex;align-items:flex-start;justify-content:space-between;gap:14px;margin-bottom:10px}
      .savedChannelPanelHead h4,.savedChannelPanelHead p{margin:0}.savedChannelPanelHead p{margin-top:3px;color:#5c7285;font-size:13px}
      .savedChannelPanelHead>span{flex:0 0 auto;padding:5px 9px;border-radius:999px;background:#e9f6ee;color:#236d46;font-size:12px;font-weight:800}
      .savedEventinPanel{border-left:4px solid #9b51e0}.savedCalendarPanel{border-left:4px solid #25889b}.savedCalendarPanel.cancelled{border-left-color:#b34949;background:#fff8f8}
      .savedChannelLink{display:inline-flex;border:1px solid #25889b;border-radius:8px;padding:8px 11px;background:#fff;color:#176d7f;font-weight:800;text-decoration:none}
      .savedManagementPanel{margin-top:12px;padding:14px;border:2px solid #173b5c;border-radius:12px;background:#f6f9fb}.savedManagementHeading{margin-bottom:12px}.savedManagementHeading h4{margin:0}.savedManagementHeading p{margin:4px 0 0;color:#4f6675;font-size:13px}.savedManagementPanel .conceptActions{margin-top:0}
      .facebookEventLinkActions{margin-top:12px!important;padding:14px!important;border:1px solid #b8cbea!important;border-left:4px solid #1877f2!important;border-radius:12px!important;background:#eef5ff!important}
      .savedFacebookPrimaryAction{margin-bottom:10px}.savedFacebookPrimaryAction button{border:1px solid #1877f2;border-radius:8px;padding:9px 12px;background:#1877f2;color:#fff;font:inherit;font-weight:800;cursor:pointer}
      .savedEventinPreview{margin:10px 0 4px;padding:14px;border:2px solid #25889b;border-radius:12px;background:#eef7f9}
      .savedEventinPreviewHead{display:flex;align-items:center;justify-content:space-between;gap:12px;margin-bottom:12px}
      .savedEventinPreviewHead button{border:1px solid #25889b;border-radius:8px;padding:7px 10px;background:#fff;color:#176d7f;font:inherit;font-weight:800;cursor:pointer}
      .savedEventinPreviewBody{display:grid;grid-template-columns:minmax(180px,280px) 1fr;gap:18px;padding:14px;border-radius:10px;background:#fff}
      .savedEventinPreviewBody img{width:100%;height:220px;border-radius:9px;object-fit:contain;background:#f1f4f6}
      .savedEventinPreviewBody h3{margin:4px 0 10px}
      .savedEventinPreviewBody small{display:block;margin-top:10px;color:#5c7285}
      @media(max-width:760px){.savedEventinPreviewBody{grid-template-columns:1fr}.savedChannelPanelHead{display:block}.savedChannelPanelHead>span{display:inline-block;margin-top:8px}}
    `}</style>
  </section>;
}


