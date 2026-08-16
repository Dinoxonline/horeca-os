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
  { key: "website_denhaag", label: "DenHaag.com", route: "website", routeLabel: "Via de officiÃ«le evenementaanmelding", submissionUrl: "https://denhaag.com/nl/aanmelden-evenement", fallbackLabel: "Alleen gebruiken wanneer het evenement relevant is voor Den Haag" },
  { key: "website_marktenmeer", label: "MarktenMeer", route: "website", routeLabel: "Invullen via het marktformulier", submissionUrl: "https://marktenmeer.nl/markt-aanmelden/", email: "info@marktenmeer.nl", fallbackLabel: "Alleen geschikt voor markten, braderieÃ«n en fairs; e-mail is beschikbaar als reserve" },
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
  { pattern: /cuban salsa parties/i, level: "conditional", text: "Alleen Cubaanse salsa; maximaal twee berichten en eerst Ã©Ã©n nieuw lid uitnodigen." },
  { pattern: /latin event promotion/i, level: "allowed", text: "Latin-promotie toegestaan; maximaal Ã©Ã©n bericht per evenement per week." },
  { pattern: /latin events parties groep nederland/i, level: "allowed", text: "Alleen Latin-evenementen; maximaal Ã©Ã©n plaatsing per week." },
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
  { pattern: /expat group/i, level: "conditional", text: "Alleen Engelstalige, leuke activiteiten; gewone commerciÃ«le reclame is verboden." },
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
    const price = ticket.type === "free" ? "Gratis" : `â‚¬ ${Number(ticket.price || 0).toFixed(2).replace(".", ",")}`;
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
      badge: "Aanmeldpagina â€” handmatige controle",
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
    location: isPlein ? "GrandcafÃ© Het Plein" : "Caribbean Corner",
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
  const [facebookBrowserHelperReady, setFacebookBrowserHelperReady] = useState(false);
  const [facebookBrowserHelperVersion, setFacebookBrowserHelperVersion] = useState("");
  const [facebookGroupAutomationStatus, setFacebookGroupAutomationStatus] = useState({});
  const [facebookGroupShareClock, setFacebookGroupShareClock] = useState(() => Date.now());
  const [facebookGroupShareProgressLoaded, setFacebookGroupShareProgressLoaded] = useState(false);
  const [newFacebookGroup, setNewFacebookGroup] = useState({ name: "", url: "" });
  const [facebookEventLinkEdits, setFacebookEventLinkEdits] = useState({});
  const [facebookEventOrganizerChecks, setFacebookEventOrganizerChecks] = useState({});
  const [facebookEventManualLinkIds, setFacebookEventManualLinkIds] = useState([]);
  const [facebookAccount, setFacebookAccount] = useState(null);
  const [facebookAdsAccount, setFacebookAdsAccount] = useState(null);
  const [facebookAdDrafts, setFacebookAdDrafts] = useState({});
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
  useEffect(() => {
    function handleFacebookHelperMessage(event) {
      if (event.source !== window || event.origin !== window.location.origin || event.data?.source !== "horeca-os-facebook-helper") return;
      if (event.data.type === "READY") {
        const version = String(event.data.version || "0.0.0");
        const [major = 0, minor = 0, patch = 0] = version.split(".").map(Number);
        const compatible = major > 1 || (major === 1 && (minor > 1 || (minor === 1 && patch >= 3)));
        setFacebookBrowserHelperVersion(version);
        return setFacebookBrowserHelperReady(compatible);
      }
      if (event.data.type === "START_RESULT" && !event.data.payload?.ok) return setResult({ ok: false, message: event.data.payload?.error || "De Facebookgroepen-helper kon de ronde niet starten." });
      if (event.data.type !== "GROUP_ROUND_PROGRESS") return;
      const payload = event.data.payload || {};
      const campaignId = String(payload.campaignId || "");
      if (!campaignId) return;
      setFacebookGroupAutomationStatus((current) => ({ ...current, [campaignId]: payload }));
      if (Array.isArray(payload.completed)) {
        setFacebookGroupShareProgress((current) => ({
          ...current,
          [campaignId]: {
            ...(current[campaignId] || {}),
            completed: Array.from(new Set([...(current[campaignId]?.completed || []), ...payload.completed.map(String)])),
            waitUntil: payload.nextAt || 0,
          },
        }));
      }
    }
    window.addEventListener("message", handleFacebookHelperMessage);
    window.postMessage({ source: "horeca-os", type: "HELPER_PING" }, window.location.origin);
    return () => window.removeEventListener("message", handleFacebookHelperMessage);
  }, []);
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
    ...(enabledChannels.length === 0 ? ["Kies minimaal Ã©Ã©n promotiekanaal."] : []),
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
      setUploadMessage({ ok: false, message: "Sleep Ã©Ã©n afbeelding tegelijk naar een afbeeldingsvak." });
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
      setUploadMessage({ ok: false, message: "Sleep Ã©Ã©n bronafbeelding tegelijk. Horeca OS maakt daar alle mogelijke formaten van." });
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
        throw new Error(`${slot.label} heeft na het bijsnijden minimaal ${slot.width} Ã— ${slot.height} bruikbare pixels nodig. Deze foto is ${loaded.width} Ã— ${loaded.height} px.`);
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
          ? `${slot.label} is automatisch bijgesneden met focus op ${cropFocus === "top" ? "boven" : cropFocus === "bottom" ? "onder" : "het midden"} en aangepast van ${prepared.originalWidth} Ã— ${prepared.originalHeight} naar ${slot.width} Ã— ${slot.height} px.`
          : prepared.resized
            ? `${slot.label} is automatisch verkleind van ${prepared.originalWidth} Ã— ${prepared.originalHeight} naar ${slot.width} Ã— ${slot.height} px en geÃ¼pload.`
            : `${slot.label} is correct geÃ¼pload.`,
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
          : "De Eventin-afbeelding en alle vier socialmediaformaten zijn geÃ¼pload.",
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
      setResult({ ok: true, message: `${payload.events?.length || 0} bestaande Eventin-evenementen gevonden. Er is nog niets geÃ¯mporteerd of gewijzigd.${payload.warning ? ` ${payload.warning}` : ""}` });
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
        throw new Error(`De Eventin-locatie â€œ${fullEvent.location}â€ bevat zowel Caribbean Corner als Grand CafÃ© Het Plein. Kies in Eventin eerst Ã©Ã©n duidelijke venue.`);
      }
      if (!eventLocationMatchesBusiness(fullEvent.location, selectedBusiness)) {
        throw new Error(`Dit Eventin-evenement hoort bij â€œ${fullEvent.location}â€ en kan niet onder â€œ${selectedBusiness?.name || "de gekozen vestiging"}â€ worden gekoppeld. Kies eerst de juiste vestiging.`);
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
        message: `â€œ${fullEvent.title || "Het evenement"}â€ is volledig als nieuw concept overgenomen. Wijzig nu minimaal de datum, tijden en gewenste tekst. Het oorspronkelijke evenement blijft ongewijzigd.`,
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
      setResult({ ok: true, message: "De volledige Eventin-gegevens worden geladenÃ¢â‚¬Â¦" });
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
      googleTopic: payloads.google?.topic_type || (storedType === "event" ? "EVENT" : storedType === "offer" ? "OFFER" : "STANDARDçÝõîÚ$z{-®éÜj×â#à¢ÆF—b6Æ74æÖSÒ&W†—7F–æuvV'6—FTWfVçG4†VB#ãÆF—cãÇ6Æ74æÖSÒ&W–V'&÷r#ä$U5DäDRtT%4•DRÔtTäDÂ÷ãÆƒ3äWfVçF–âÖWfVæVÖVçFVâ¶÷VÆVãÂöƒ3ãÇä†–W"7Fâ&W7FæFRWfVæVÖVçFVâ'Bfâæ–WWvRVâ÷vW6ÆvVâ6×væW2âÆFVâVâ¶÷VÆVâfW&æFW'Bæ–WG2÷FRvV'6—FRãÂ÷ãÂöF—cãÆ'WGFöâG—SÒ&'WGFöâ"6Æ74æÖSÒ'6V6öæF'”'WGFöâ"öä6Æ–6³×¶ÆöDÖævVEvV'6—FTWfVçG7ÒF—6&ÆVC×¶ÖævVDWfVçG4ÆöF–æwÓç¶ÖævVDWfVçG4ÆöF–ærò$WfVæVÖVçFVâÆFVî(
b"¢$&W7FæFRWfVæVÖVçFVâÆFVâ'ÓÂö'WGFöããÂöF—cà¢¶ÖævVEvV'6—FTWfVçG2æÆVæwF‚âbbÆF—b6Æ74æÖSÒ&ÖævVDWfVçEf–Wt'WGFöç2#à¢Æ'WGFöâG—SÒ&'WGFöâ"6Æ74æÖS×²6†÷tW‡—&VEvV'6—FTWfVçG2ò&7F—fR"¢"'Òöä6Æ–6³×²‚’Óâ6WE6†÷tW‡—&VEvV'6—FTWfVçG2†fÇ6R—Óä7GVVÆRWfVæVÖVçFVâ‡¶7W'&VçDÖævVEvV'6—FTWfVçG2æÆVæwF‡Ò“Âö'WGFöãà¢Æ'WGFöâG—SÒ&'WGFöâ"6Æ74æÖS×·6†÷tW‡—&VEvV'6—FTWfVçG2ò&7F—fRW‡—&VB"¢"'Òöä6Æ–6³×²‚’Óâ6WE6†÷tW‡—&VEvV'6—FTWfVçG2‡G'VR—ÓåfW&Æ÷VâWfVæVÖVçFVâ‡¶W‡—&VDÖævVEvV'6—FTWfVçG2æÆVæwF‡Ò“Âö'WGFöãà¢ÂöF—cçÐ¢¶ÖævVEvV'6—FTWfVçG2æÆVæwF‚âbbÆÆ&VÂ6Æ74æÖSÒ&ÖævVDWfVçE6V&6‚#å¦öV¶Vâ–â·6†÷tW‡—&VEvV'6—FTWfVçG2ò'fW&Æ÷Vâ"¢&7GVVÆR'ÒWfVæVÖVçFVãÆ–çWBG—SÒ'6V&6‚"fÇVS×¶ÖævVDWfVçE6V&6‡Òöä6†ævS×²†WfVçB’Óâ6WDÖævVDWfVçE6V&6‚†WfVçBçF&vWBçfÇVR—ÒÆ6V†öÆFW#Ò%¦öV²÷æÒÂÆö6F–RÂFGVÒöb¦""óãÂöÆ&VÃçÐ¢¶ÖævVEvV'6—FTWfVçG2æÆVæwF‚âbbf—6–&ÆTÖævVEvV'6—FTWfVçG2æÆVæwF‚ÓÓÒbbÇ6Æ74æÖSÒ&V×G”ÖævVDWfVçG2#ç¶ÖævVDWfVçE6V&6…VW'’òvVVâWfVæVÖVçFVâvWföæFVâfö÷"(	ÂG¶ÖævVDWfVçE6V&6‚çG&–Ò‚—Þ(	Òæ¢6†÷tW‡—&VEvV'6—FTWfVçG2ò$W"¦–¦âvVVâfW&Æ÷VâWfVæVÖVçFVââ"¢$W"¦–¦âvVVâ7GVVÆRWfVæVÖVçFVââ'ÓÂ÷çÐ¢·f—6–&ÆTÖævVEvV'6—FTWfVçG2æÆVæwF‚âbbÆF—b6Æ74æÖSÒ&ÖævVDWfVçDw&–B#ç·f—6–&ÆTÖævVEvV'6—FTWfVçG2æÖ‚†WfVçD—FVÒ’Óâ°¢6öç7BÆ–æ¶VBÒWfVçD6×–vç2ç6öÖR‚†6×–vâ’Óâ†6×–vâæÖVF–ÇÂµÒ’ç6öÖR‚†VçG'’’ÓâVçG'“òæ¶–æBÓÓÒ&6×–våöF—7G&–'WF–öâ"bb7G&–ær†VçG'’æWfVçF–åöWfVçEö–BÇÂ""’ÓÓÒ7G&–ær†WfVçD—FVÒæ–B’’“°¢6öç7B–æ6ö×ÆWFRÒWfVçD—FVÒç7F'BÇÂWfVçD—FVÒæVæBÇÂWfVçD—FVÒæÆö6F–öã°¢&WGW&âÆ'F–6ÆR¶W“×¶WfVçD—FVÒæ–GÓà¢ÆF—cãÇ7G&öæsç¶WfVçD—FVÒçF—FÆWÓÂ÷7G&öæsãÇ7ãç¶WfVçD—FVÒç&VDöæÇ’ò$vWV&Æ–6VW&B+rÆÆVVâÖÆW¦Vâ"¢WfVçD—FVÒç7FGW2ÓÓÒ&G&gB"ò$WfVçF–âÖ6öæ6WB"¢$vWV&Æ–6VW&B'ÓÂ÷7ããÂöF—cà¢Çç¶WfVçD—FVÒç7F'Bòf÷&ÖDæÄFFUF–ÖR†WfVçD—FVÒç7F'B’¢WfVçD—FVÒæWfVçDFFRòf÷&ÖDæÄFFR†WfVçD—FVÒæWfVçDFFR’¢$FGVÒÖöWBæ¶÷VÆVâv÷&FVâvV6öçG&öÆVW&B'×¶WfVçD—FVÒæÆö6F–öâò+rG¶WfVçD—FVÒæÆö6F–öçÖ¢"'ÓÂ÷à¢¶–æ6ö×ÆWFRbbÇ6ÖÆÃäFR÷fW'¦–6‡G6Æ–§7B&WfBæ–WBÆÆRWfVçF–â×fVÆFVââ&–¢¶÷VÆVâ†ÇB†÷&V6õ2VW'7BFRföÆÆVF–vRFGVÒÂF–¦BÂÆö6F–RÂf&VVÆF–ærVâF–6¶WG2÷ãÂ÷6ÖÆÃçÐ¢ÆF—b6Æ74æÖSÒ&ÖævVDWfVçD7F–öç2#ç¶WfVçD—FVÒç7FGW2ÓÒ&G&gB"bbWfVçD—FVÒçW&ÂbbÆ‡&Vc×¶WfVçD—FVÒçW&ÇÒF&vWCÒ%ö&Ææ²"&VÃÒ&æ÷&VfW'&W"#åvV'6—FR÷VæVãÂöç×¶WfVçD—FVÒç7FGW2ÓÓÒ&G&gB"bbÇ6ÖÆÃäæöræ–WB÷Væ&#Â÷6ÖÆÃçÓÆ'WGFöâG—SÒ&'WGFöâ"F—6&ÆVC×¶Æ–æ¶VBÇÂ–×÷'F–ætWfVçD–BÓÓÒWfVçD—FVÒæ–GÒöä6Æ–6³×²‚’Óâ–×÷'DÖævVEvV'6—FTWfVçB†WfVçD—FVÒ—Óç¶Æ–æ¶VBò$ÂvV¶÷VÆB"¢–×÷'F–ætWfVçD–BÓÓÒWfVçD—FVÒæ–Bò$ÆFVî(
b"¢$â†÷&V6õ2¶÷VÆVâ'ÓÂö'WGFöããÆ'WGFöâG—SÒ&'WGFöâ"6Æ74æÖSÒ&6÷”ÖævVDWfVçB"F—6&ÆVC×¶–×÷'F–ætWfVçD–BÓÓÒWfVçD—FVÒæ–GÒöä6Æ–6³×²‚’ÓâW6TÖævVEvV'6—FTWfVçD4æWr†WfVçD—FVÒ—Óç¶–×÷'F–ætWfVçD–BÓÓÒWfVçD—FVÒæ–Bò$ÆFVî(
b"¢$Ç2æ–WWrWfVæVÖVçBvV''V–¶Vâ'ÓÂö'WGFöããÂöF—cà¢Âö'F–6ÆSã°¢Ò—ÓÂöF—cçÐ¢ÂöF—cçÐ¢¶–çFW&æÄVF—F÷&–ÄVÖ–ÂbbÆF—b6Æ74æÖSÒ&–çFW&æÄVÖ–Ä÷fW&Æ’"&öÆSÒ&F–Æör"&–ÖÖöFÃÒ'G'VR"&–ÖÆ&VÃ×¶RÖÖ–Âfö÷"G¶–çFW&æÄVF—F÷&–ÄVÖ–ÂçF&vWDÆ&VÇÖÓà¢ÆF—b6Æ74æÖSÒ&–çFW&æÄVÖ–Ä6ö×÷6W"#à¢ÆF—b6Æ74æÖSÒ&–çFW&æÄVÖ–Ä†VB#ãÆF—cãÇ6Æ74æÖSÒ&W–V'&÷r#ä”åDU$äRRÔÔ”Ä4ôåE$ôÄSÂ÷ãÆƒ3ç¶–çFW&æÄVF—F÷&–ÄVÖ–ÂçF&vWDÆ&VÇÓÂöƒ3ãÂöF—cãÆ'WGFöâG—SÒ&'WGFöâ"öä6Æ–6³×²‚’Óâ6WD–çFW&æÄVF—F÷&–ÄVÖ–Â†çVÆÂ—Óå6ÇV—FVãÂö'WGFöããÂöF—cà¢ÆÆ&VÃäãÆ–çWBfÇVS×¶–çFW&æÄVF—F÷&–ÄVÖ–ÂçFòÇÂ"'Òöä6†ævS×²†WfVçB’Óâ6WD–çFW&æÄVF—F÷&–ÄVÖ–Â‚†7W'&VçB’Óâ‡²ââæ7W'&VçBÂFó¢WfVçBçF&vWBçfÇVRÒ’—ÒóãÂöÆ&VÃà¢ÆÆ&VÃäöæFW'vW'Æ–çWBfÇVS×¶–çFW&æÄVF—F÷&–ÄVÖ–Âç7V&¦V7GÒöä6†ævS×²†WfVçB’Óâ6WD–çFW&æÄVF—F÷&–ÄVÖ–Â‚†7W'&VçB’Óâ‡²ââæ7W'&VçBÂ7V&¦V7C¢WfVçBçF&vWBçfÇVRÒ’—ÒóãÂöÆ&VÃà¢ÆÆ&VÃä&W&–6‡CÇFW‡F&V&÷w3Ò#b"fÇVS×¶–çFW&æÄVF—F÷&–ÄVÖ–Âæ&öG—Òöä6†ævS×²†WfVçB’Óâ6WD–çFW&æÄVF—F÷&–ÄVÖ–Â‚†7W'&VçB’Óâ‡²ââæ7W'&VçBÂ&öG“¢WfVçBçF&vWBçfÇVRÒ’—ÒóãÂöÆ&VÃà¢ÆF—b6Æ74æÖSÒ&–çFW&æÄVÖ–Äfö÷FW"#ãÇ7ãä¦R&Æ–¦gB–â†÷&V6õ2âW"v÷&GBæöræ–WG2fW'7GWW&BãÂ÷7ããÆ'WGFöâG—SÒ&'WGFöâ"öä6Æ–6³×¶7–æ2‚’Óâ²G'’²v—Bæf–vF÷"æ6Æ—&ö&Bçw&—FUFW‡B†ã¢G¶–çFW&æÄVF—F÷&–ÄVÖ–ÂçF÷ÕÆäöæFW'vW'¢G¶–çFW&æÄVF—F÷&–ÄVÖ–Âç7V&¦V7GÕÆåÆâG¶–çFW&æÄVF—F÷&–ÄVÖ–Âæ&öG—Ö“²6WE&W7VÇB‡²ö³¢G'VRÂÖW76vS¢$FRföÆÆVF–vRRÖÖ–Â—2vV¶÷–VW&Bâ"Ò“²Ò6F6‚²6WE&W7VÇB‡²ö³¢fÇ6RÂÖW76vS¢$¶÷œ:·&Vâ—2æ–WBvVÇV·Bâ"Ò“²Ò×ÓåföÆÆVF–vRRÖÖ–Â¶÷œ:·&VãÂö'WGFöããÂöF—cà¢ÂöF—cà¢ÂöF—cçÐ¢Ç7G–ÆR§7ƒç¶ ¢æ–ÖvUWÆöE7V66W77¶F—7Æ“¦&Æö6³¶Ö&v–â×F÷£wƒ¶6öÆ÷#¢3#3fCCc¶föçB×6—¦S£7‡ÒçWÆöFVD–ÖvT7F–öç7¶F—7Æ“¦fÆWƒ¶fÆW‚×w&§w&¶Æ–vâÖ—FV×3¦6VçFW#¶v£ƒ¶Ö&v–â×F÷£w‡ÒæF÷væÆöD–ÖvW¶&÷&FW#£‚6öÆ–B3#Sƒƒ–#¶&÷&FW"×&F—W3£wƒ·FF–æs£g‚—ƒ¶&6¶w&÷VæC¢6ffc¶6öÆ÷#¢3sfCvc¶föçC¦–æ†W&—C¶föçB×6—¦S£'ƒ¶föçB×vV–v‡C£ƒ¶7W'6÷#§ö–çFW'ÒæWfVçF–ä–ÖvU&Wf–WsæF—g¶F—7Æ“¦fÆWƒ¶Ö–â×v–GFƒ£¶fÆW‚ÖF—&V7F–öã¦6öÇVÖã¶Æ–vâÖ—FV×3¦fÆW‚×7F'C¶v£w‡ÒæWfVçF–ä–ÖvU&Wf–WsæF—b6ÖÆÇ¶Ö‚×v–GFƒ£cƒ¶÷fW&fÆ÷r×w&¦ç—v†W&WÐ¢æVF—F÷&–Å7V&Ö—76–öä7F–öç7¶F—7Æ“¦w&–C¶v£‡ƒ¶Ö&v–â×F÷£ƒ¶&÷&FW#£‚6öÆ–B6CVSSs¶&÷&FW"×&F—W3£ƒ¶&6¶w&÷VæC¢6cFc†f¶÷fW&fÆ÷s¦†–FFVçÒæVF—F÷&–Å7V&Ö—76–öåFövvÆW¶F—7Æ“¦fÆWƒ¶Æ–vâÖ—FV×3¦6VçFW#¶§W7F–g’Ö6öçFVçC§76RÖ&WGvVVã¶v£'ƒ·v–GFƒ£S·FF–æs£'‚Gƒ¶&÷&FW#£¶&6¶w&÷VæC¢6cFc†f¶6öÆ÷#¢3s3SS#¶föçC¦–æ†W&—C¶7W'6÷#§ö–çFW#·FW‡BÖÆ–vã¦ÆVgGÒæVF—F÷&–Å7V&Ö—76–öåFövvÆR7ç¶F—7Æ“¦fÆWƒ¶Æ–vâÖ—FV×3¦6VçFW#¶v£—ƒ¶Ö–â×v–GFƒ£ÒæVF—F÷&–Å7V&Ö—76–öåFövvÆR6ÖÆÇ·FF–æs£G‚wƒ¶&÷&FW"×&F—W3£““—ƒ¶&6¶w&÷VæC¢6ffc¶6öÆ÷#¢3V3s#ƒS¶föçB×6—¦S£ƒ·v†—FR×76S¦æ÷w&ÒæVF—F÷&–Å7V&Ö—76–öåFövvÆSæ'¶6öÆ÷#¢3sfCvgÒæVF—F÷&–Ä'VÆ´7F–öç7¶F—7Æ“¦fÆWƒ¶Æ–vâÖ—FV×3¦6VçFW#¶§W7F–g’Ö6öçFVçC§76RÖ&WGvVVã¶v£'ƒ¶Ö&v–ã£'ƒ·FF–æs£ƒ¶&÷&FW"×&F—W3£—ƒ¶&6¶w&÷VæC¢6S–cfVS¶6öÆ÷#¢3#3fCCgÒæVF—F÷&–Ä'VÆ´7F–öç3ç7ç¶F—7Æ“¦w&–C¶v£7‡ÒæVF—F÷&–Ä'VÆ´7F–öç3æF—g¶F—7Æ“¦fÆWƒ¶fÆW‚×w&§w&¶v£w‡ÒæVF—F÷&–Ä'VÆ´7F–öç2'WGFöâÂæVF—F÷&–Å7V&Ö—76–öå&÷r'WGFöç¶&÷&FW#£‚6öÆ–B3#Sƒƒ–#¶&÷&FW"×&F—W3£‡ƒ·FF–æs£‡‚ƒ¶&6¶w&÷VæC¢6ffc¶6öÆ÷#¢3sfCvc¶föçC¦–æ†W&—C¶föçB×vV–v‡C£ƒ¶7W'6÷#§ö–çFW'ÒæVF—F÷&–Ä'VÆ´7F–öç2'WGFöã¦Æ7BÖ6†–ÆG¶&6¶w&÷VæC¢3#Sƒƒ–#¶6öÆ÷#¢6ffgÒæVF—F÷&–Å7V&Ö—76–öäÆ—7G¶F—7Æ“¦w&–C¶v£‡ƒ·FF–æs£'‡ÒæVF—F÷&–Å7V&Ö—76–öå&÷w¶F—7Æ“¦w&–C¶w&–B×FV×ÆFRÖ6öÇVÖç3¦WFòÖ–æÖ‚ƒC‚Ãg"’WFó¶Æ–vâÖ—FV×3¦6VçFW#¶v£‡ƒ·FF–æs£ƒ¶&÷&FW"×&F—W3£‡ƒ¶&6¶w&÷VæC¢6ffgÒæVF—F÷&–Å7V&Ö—76–öå&÷sç6ÖÆÇ¶w&–BÖ6öÇVÖã£"òÓ¶6öÆ÷#¢3V3s#ƒWÒæVF—F÷&–Å&÷WFT&FvW¶F—7Æ“¦–æÆ–æRÖfÆWƒ·FF–æs£W‚‡ƒ¶&÷&FW"×&F—W3£““—ƒ¶&6¶w&÷VæC¢6ffc&C¶6öÆ÷#¢3ƒV#¶föçB×6—¦S£'ƒ¶föçB×vV–v‡C£ƒÒæVF—F÷&–Å&÷WFRÖVÖ–ÂæVF—F÷&–Å&÷WFT&FvW¶&6¶w&÷VæC¢6S–cfVS¶6öÆ÷#¢3#3fCCgÒæVF—F÷&–Å&÷WFTW‡ÆæF–öç¶F—7Æ“¦&Æö6³¶Ö&v–â×F÷£wƒ¶6öÆ÷#¢3V3s#ƒWÒæVF—F÷&–ÄVÖ–Ä6†ö–6W¶F—7Æ“¦fÆWƒ¶Æ–vâÖ—FV×3¦6VçFW#¶v£wƒ·FF–æs£w‚—ƒ¶&÷&FW#£‚6öÆ–B3–6&33¶&÷&FW"×&F—W3£‡ƒ¶&6¶w&÷VæC¢6cvf&f3¶6öÆ÷#¢3s3SS#¶föçB×vV–v‡C£ƒÒæVF—F÷&–ÄVÖ–Ä6†ö–6R–çWG·v–GFƒ¦WF÷ÒæVF—F÷&–ÄVÖ–Ä6†ö–6R7ç¶föçB×6—¦S£7‡ÒæVF—F÷&–Å7V&Ö—76–öä7F–öç3ç6ÖÆÇ·FF–æs£'‚'ƒ¶6öÆ÷#¢3V3s#ƒWÒæ–çFW&æÄVÖ–Ä÷fW&Æ—·÷6—F–öã¦f—†VC¶–ç6WC£·¢Ö–æFWƒ£¶F—7Æ“¦w&–C·Æ6RÖ—FV×3¦6VçFW#·FF–æs£#ƒ¶&6¶w&÷VæC§&v&ƒ2Ã3BÃS"Âãc"—Òæ–çFW&æÄVÖ–Ä6ö×÷6W'¶F—7Æ“¦w&–C¶v£'ƒ·v–GFƒ¦Ö–âƒsc‚ÃR“¶Ö‚Ö†V–v‡C¦6Æ2ƒf‚ÒC‚“¶÷fW&fÆ÷s¦WFó·FF–æs£#ƒ¶&÷&FW"×&F—W3£Gƒ¶&6¶w&÷VæC¢6ffc¶&÷‚×6†F÷s£#G‚s‚&v&ƒÃÃÂã#‚—Òæ–çFW&æÄVÖ–Ä†VBÂæ–çFW&æÄVÖ–Äfö÷FW'¶F—7Æ“¦fÆWƒ¶Æ–vâÖ—FV×3¦6VçFW#¶§W7F–g’Ö6öçFVçC§76RÖ&WGvVVã¶v£'‡Òæ–çFW&æÄVÖ–Ä†VBƒ2Âæ–çFW&æÄVÖ–Ä†VB¶Ö&v–ã£Òæ–çFW&æÄVÖ–Ä†VB'WGFöâÂæ–çFW&æÄVÖ–Äfö÷FW"'WGFöç¶&÷&FW#£‚6öÆ–B3#Sƒƒ–#¶&÷&FW"×&F—W3£‡ƒ·FF–æs£—‚'ƒ¶&6¶w&÷VæC¢6ffc¶6öÆ÷#¢3sfCvc¶föçC¦–æ†W&—C¶föçB×vV–v‡C£ƒ¶7W'6÷#§ö–çFW'Òæ–çFW&æÄVÖ–Äfö÷FW"7ç¶6öÆ÷#¢3V3s#ƒWÒæ–çFW&æÄVÖ–Äfö÷FW"'WGFöç¶&6¶w&÷VæC¢3#Sƒƒ–#¶6öÆ÷#¢6ffgÐ¢æ6ö×ÆWFVDf6V&öö´w&÷WÆ–æ·7¶F—7Æ“¦fÆWƒ¶fÆW‚×w&§w&¶Æ–vâÖ—FV×3¦6VçFW#¶v£wƒ¶fÆW‚Ö&6—3£S·FF–æs£ƒ¶&÷&FW#£‚6öÆ–B6#†6&V¶&÷&FW"×&F—W3£‡ƒ¶&6¶w&÷VæC¢6ffgÒæ6ö×ÆWFVDf6V&öö´w&÷WÆ–æ·27G&öærÂæ6ö×ÆWFVDf6V&öö´w&÷WÆ–æ·26ÖÆÇ¶fÆW‚Ö&6—3£WÒæ6ö×ÆWFVDf6V&öö´w&÷WÆ–æ·2¶&÷&FW#£‚6öÆ–B3ƒsvc#¶&÷&FW"×&F—W3£wƒ·FF–æs£w‚—ƒ¶6öÆ÷#¢3CVF&c¶föçB×vV–v‡C£ƒ·FW‡BÖFV6÷&F–öã¦æöæWÒæ6ö×ÆWFVDf6V&öö´w&÷WÆ–æ·26ÖÆÇ¶6öÆ÷#¢3V3s#ƒWÐ¢æÖævVDWfVçEf–Wt'WGFöç7¶F—7Æ“¦fÆWƒ¶fÆW‚×w&§w&¶v£‡ƒ¶Ö&v–â×F÷£G‡ÒæÖævVDWfVçEf–Wt'WGFöç2'WGFöç¶&÷&FW#£‚6öÆ–B3–6&33¶&÷&FW"×&F—W3£—ƒ·FF–æs£—‚'ƒ¶&6¶w&÷VæC¢6ffc¶6öÆ÷#¢3CSƒcc¶föçB×vV–v‡C£ƒ¶7W'6÷#§ö–çFW'ÒæÖævVDWfVçEf–Wt'WGFöç2'WGFöâæ7F—fW¶&÷&FW"Ö6öÆ÷#¢3#Sƒƒ–#¶&6¶w&÷VæC¢3#Sƒƒ–#¶6öÆ÷#¢6ffgÒæÖævVDWfVçEf–Wt'WGFöç2'WGFöâæ7F—fRæW‡—&VG¶&÷&FW"Ö6öÆ÷#¢3†V#¶&6¶w&÷VæC¢3†V#ÒæÖævVDWfVçE6V&6‡¶Ö&v–â×F÷£'‡ÒæÖævVDWfVçE6V&6‚–çWG¶Ö‚×v–GFƒ£cC‡ÒæV×G”ÖævVDWfVçG7¶Ö&v–ã£G‚·FF–æs£Gƒ¶&÷&FW"×&F—W3£—ƒ¶&6¶w&÷VæC¢6VVc&cS¶6öÆ÷#¢3V3s#ƒWÐ¢çF–6¶WDVF—F÷'¶Ö&v–ã£·FF–æs£gƒ¶&÷&FW#£‚6öÆ–B63fCVFc¶&÷&FW"×&F—W3£'‡ÒçF–6¶WDVF—F÷#ç¶Ö&v–ã£'‚'ƒ¶6öÆ÷#¢3V3s#ƒWÒçF–6¶WDFFU&Vg&W6‡¶F—7Æ“¦fÆWƒ¶Æ–vâÖ—FV×3¦6VçFW#¶§W7F–g’Ö6öçFVçC§76RÖ&WGvVVã¶v£Gƒ¶Ö&v–ã£'‚·FF–æs£'ƒ¶&÷&FW#£‚6öÆ–B3–6&33¶&÷&FW"×&F—W3£ƒ¶&6¶w&÷VæC¢6VVcvc—ÒçF–6¶WDFFU&Vg&W6ƒæF—g¶F—7Æ“¦fÆWƒ¶fÆW‚ÖF—&V7F–öã¦6öÇVÖã¶v£7‡ÒçF–6¶WDFFU&Vg&W6‚7ç¶6öÆ÷#¢3V3s#ƒS¶föçB×6—¦S£7‡ÒçF–6¶WDFFU&Vg&W6‚'WGFöç¶fÆWƒ£WFó¶&÷&FW#£¶&÷&FW"×&F—W3£‡ƒ·FF–æs£‚7ƒ¶&6¶w&÷VæC¢3#Sƒƒ–#¶6öÆ÷#¢6ffc¶föçC¦–æ†W&—C¶föçB×vV–v‡C£ƒ¶7W'6÷#§ö–çFW'ÒçF–6¶WEf&–F–öç¶Ö&v–â×F÷£'ƒ·FF–æs£Gƒ¶&÷&FW#£‚6öÆ–B6CVSSs¶&÷&FW"×&F—W3£ƒ¶&6¶w&÷VæC¢6c†f&f7ÒçF–6¶WEf&–F–öä†VG¶F—7Æ“¦fÆWƒ¶Æ–vâÖ—FV×3¦6VçFW#¶§W7F–g’Ö6öçFVçC§76RÖ&WGvVVã¶v£'ƒ¶Ö&v–âÖ&÷GFöÓ£'‡ÒçF–6¶WEf&–F–öäw&–G¶F—7Æ“¦w&–C¶w&–B×FV×ÆFRÖ6öÇVÖç3§&WVBƒ"ÆÖ–æÖ‚ƒÃg"’“¶v£'‡Òç&VÖ÷fUF–6¶WG¶&÷&FW#£¶&6¶w&÷VæC¦æöæS¶6öÆ÷#¢6&c&c¶föçB×vV–v‡C£ƒ·FW‡BÖFV6÷&F–öã§VæFW&Æ–æS¶7W'6÷#§ö–çFW'ÒæFEF–6¶WG¶Ö&v–â×F÷£'ƒ¶&÷&FW#£‚6öÆ–B3#Sƒƒ–#¶&÷&FW"×&F—W3£—ƒ·FF–æs£‚Gƒ¶&6¶w&÷VæC¢6ffc¶6öÆ÷#¢3sfCvc¶föçB×vV–v‡C£ƒ¶7W'6÷#§ö–çFW'Ð¢æW†—7F–æuvV'6—FTWfVçG7¶Ö&v–â×F÷£#'ƒ·FF–æs£‡ƒ¶&÷&FW#£‚6öÆ–B63fCVFc¶&÷&FW"×&F—W3£'ƒ¶&6¶w&÷VæC¢6c†f&f7ÒæW†—7F–æuvV'6—FTWfVçG4†VG¶F—7Æ“¦fÆWƒ¶Æ–vâÖ—FV×3¦fÆW‚×7F'C¶§W7F–g’Ö6öçFVçC§76RÖ&WGvVVã¶v£g‡ÒæW†—7F–æuvV'6—FTWfVçG4†VBƒ2ÂæW†—7F–æuvV'6—FTWfVçG4†VB¶Ö&v–ã£ÒæW†—7F–æuvV'6—FTWfVçG4†VCæ'WGFöç¶fÆWƒ£WF÷ÒæÖævVDWfVçDw&–G¶F—7Æ“¦w&–C¶v£ƒ¶Ö&v–â×F÷£G‡ÒæÖævVDWfVçDw&–B'F–6ÆW¶F—7Æ“¦w&–C¶v£wƒ·FF–æs£'ƒ¶&÷&FW#£‚6öÆ–B6CVSSs¶&÷&FW"×&F—W3£ƒ¶&6¶w&÷VæC¢6ffgÒæÖævVDWfVçDw&–B'F–6ÆSæF—c¦f—'7BÖ6†–ÆG¶F—7Æ“¦fÆWƒ¶§W7F–g’Ö6öçFVçC§76RÖ&WGvVVã¶v£‡ÒæÖævVDWfVçDw&–B'F–6ÆR7ç·FF–æs£G‚‡ƒ¶&÷&FW"×&F—W3£““—ƒ¶&6¶w&÷VæC¢6VVcvc“¶6öÆ÷#¢3sfCvc¶föçB×6—¦S£'ƒ¶föçB×vV–v‡C£ƒÒæÖævVDWfVçDw&–B¶Ö&v–ã£¶6öÆ÷#¢3CSƒcgÒæÖævVDWfVçDw&–B6ÖÆÇ¶6öÆ÷#¢3ƒV#ÒæÖævVDWfVçD7F–öç7¶F—7Æ“¦fÆWƒ¶fÆW‚×w&§w&¶v£‡ƒ¶Æ–vâÖ—FV×3¦6VçFW'ÒæÖævVDWfVçD7F–öç2ÂæÖævVDWfVçD7F–öç2'WGFöç¶&÷&FW#£‚6öÆ–B3#Sƒƒ–#¶&÷&FW"×&F—W3£‡ƒ·FF–æs£w‚ƒ¶&6¶w&÷VæC¢6ffc¶6öÆ÷#¢3sfCvc¶föçB×vV–v‡C£ƒ·FW‡BÖFV6÷&F–öã¦æöæS¶7W'6÷#§ö–çFW'ÒæÖævVDWfVçD7F–öç2æ6÷”ÖævVDWfVçG¶&÷&FW"Ö6öÆ÷#¢3sƒ“–3¶6öÆ÷#¢3CSƒcgÒæÖævVDWfVçD7F–öç2'WGFöã¦F—6&ÆVG¶÷6—G“¢ãSS¶7W'6÷#¦æ÷BÖÆÆ÷vVGÐ¢æ6×–vä6&DÖ–ç¶F—7Æ“¦fÆWƒ¶v£Gƒ¶Ö–â×v–GFƒ£¶fÆWƒ£Òæ6×–vä6&D–ÖvW¶fÆWƒ£3'‡Òæ6×–vä6&D–ÖvR–Öw¶F—7Æ“¦&Æö6³·v–GFƒ£3'ƒ¶†V–v‡C£“gƒ¶&÷&FW"×&F—W3£ƒ¶ö&¦V7BÖf—C¦6÷fW#¶&6¶w&÷VæC¢6VVc&cWÒæ6×–vä6&D6öçFVçG¶Ö–â×v–GFƒ£¶fÆWƒ£ÒçvV'6—FTWfVçE7FFW¶Ö&v–ã£‡‚–×÷'FçC·FF–æs£‡‚ƒ¶&÷&FW"×&F—W3£‡ƒ¶&6¶w&÷VæC¢6VVcvc“¶6öÆ÷#¢3sfCvgÒçvV'6—FTWfVçE7FFRæ6æ6VÆÆVG¶&6¶w&÷VæC¢6c†VV¶6öÆ÷#¢6&c&gÒæ6×–våv÷&¶fÆ÷w¶F—7Æ“¦w&–C¶v£‡ƒ¶Ö&v–â×F÷£ƒ·FF–æs£ƒ¶&÷&FW#£‚6öÆ–B6#†6FCƒ¶&÷&FW"×&F—W3£—ƒ¶&6¶w&÷VæC¢6cvff'Òæ6×–våv÷&¶fÆ÷r¶Ö&v–ã£¶6öÆ÷#¢3CSƒcc¶föçB×6—¦S£7‡Òæ6×–våv÷&¶fÆ÷u7FW7¶F—7Æ“¦w&–C¶w&–B×FV×ÆFRÖ6öÇVÖç3§&WVBƒBÆÖ–æÖ‚ƒ#‚Ãg"’“¶v£g‡Òæ6×–våv÷&¶fÆ÷u7FW27ç·FF–æs£w‚—ƒ¶&÷&FW"×&F—W3£wƒ¶&6¶w&÷VæC¢6SvVFc¶6öÆ÷#¢3S#css3¶föçB×6—¦S£'ƒ¶föçB×vV–v‡C£ƒ·FW‡BÖÆ–vã¦6VçFW'Òæ6×–våv÷&¶fÆ÷u7FW27âæFöæW¶&6¶w&÷VæC¢6Sc6Sƒ¶6öÆ÷#¢3sc6GÒæ6×–våv÷&¶fÆ÷u7FW27âæ7W'&VçG¶&6¶w&÷VæC¢3ƒsvc#¶6öÆ÷#¢6ffgÒæ6öæ6WEV&Æ—6„WfVçD'WGFöç¶&÷&FW#£‚6öÆ–B3#3ƒFc¶6öÆ÷#¢3sc6C¶&6¶w&÷VæC¢6VVfc7Òæ6öæ6WEvV'6—FTG&gD'WGFöç¶&÷&FW#£‚6öÆ–B63ƒ†ƒ¶6öÆ÷#¢3ƒV#Òæ6öæ6WD6æ6VÄWfVçD'WGFöç¶&÷&FW#£‚6öÆ–B63“VCVC¶6öÆ÷#¢6&c&gÒæ6öæ6WD7F–öç2æ6öæ6WD6æ6VÄFVÆWFTWfVçD'WGFöç¶&÷&FW#£‚6öÆ–B3†ccc¶6öÆ÷#¢6ffc¶&6¶w&÷VæC¢6&c&gÒæ6öæ6WD7F–öç2æ6öæ6WDf6V&ööµV&Æ—6„'WGFöç¶&÷&FW#£‚6öÆ–B3ƒsvc#¶6öÆ÷#¢6ffc¶&6¶w&÷VæC¢3ƒsvc'Ð¢æf6V&öö´FW7F–æF–öç¶F—7Æ“¦w&–C¶v£7ƒ·FF–æs£‚'ƒ¶&÷&FW"ÖÆVgC£G‚6öÆ–B3ƒsvc#¶&÷&FW"×&F—W3£‡ƒ¶&6¶w&÷VæC¢6VVcVfgÒæf6V&öö´FW7F–æF–öâç&VG’7G&öæw¶6öÆ÷#¢3CVF&gÒæf6V&öö´FW7F–æF–öâæÖ—76–æw¶&÷&FW"ÖÆVgBÖ6öÆ÷#¢6SF“#¶&6¶w&÷VæC¢6ffc&C¶6öÆ÷#¢3ƒV#Òæf6V&öö´FW7F–æF–öâ7ç¶föçB×6—¦S£7‡Òæ6†ææVÄ7F–öç2Âæ6†ææVÅÆææ–æt7F–öç7¶F—7Æ“¦fÆWƒ¶fÆW‚×w&§w&¶Æ–vâÖ—FV×3¦6VçFW#¶v£g‡Òæ6†ææVÅÆææ–æt7F–öç2–çWG·v–GFƒ£“ƒ·FF–æs£g‚‡ƒ¶föçB×6—¦S£‡Òæ6†ææVÄÖævTÆ–æ·¶F—7Æ“¦–æÆ–æRÖfÆWƒ¶Æ–vâÖ—FV×3¦6VçFW#¶&÷&FW#£‚6öÆ–B7W'&VçD6öÆ÷#¶&÷&FW"×&F—W3£wƒ·FF–æs£W‚wƒ¶&6¶w&÷VæC¢6ffc·FW‡BÖFV6÷&F–öã¦æöæWÒæ6æ6VÄ6†ææVÄ'WGFöç¶6öÆ÷#¢6&c&b–×÷'FçGÒæf6V&öö´w&÷W–6¶W'¶F—7Æ“¦w&–C¶v£—ƒ·FF–æs£'ƒ¶&÷&FW"×&F—W3£—ƒ¶&6¶w&÷VæC¢6cVc†fÒæf6V&öö´w&÷W–6¶W"¶Ö&v–ã£Òæf6V&öö´w&÷W–6¶W$†VG¶F—7Æ“¦fÆWƒ¶§W7F–g’Ö6öçFVçC§76RÖ&WGvVVã¶v£'ƒ¶Æ–vâÖ—FV×3¦6VçFW'Òæf6V&öö´w&÷W–6¶W$†VB7ç·FF–æs£W‚‡ƒ¶&÷&FW"×&F—W3£““—ƒ¶&6¶w&÷VæC¢6SVVffc¶6öÆ÷#¢3CVF&c¶föçB×6—¦S£'ƒ¶föçB×vV–v‡C£ƒÒæf6V&öö´w&÷W6fVDÆ—7G7¶F—7Æ“¦w&–C¶v£—ƒ·FF–æs£'ƒ¶&÷&FW#£‚6öÆ–B6#†6FCƒ¶&÷&FW"×&F—W3£—ƒ¶&6¶w&÷VæC¢6ffgÒæf6V&öö´w&÷W6fVDÆ—7G3æF—c¦f—'7BÖ6†–ÆBÂæf6V&öö´w&÷WÆ—7DV×G—¶6öÆ÷#¢3CSƒcc¶föçB×6—¦S£7‡Òæf6V&öö´w&÷WÆ—7D7&VFW¶F—7Æ“¦w&–C¶w&–B×FV×ÆFRÖ6öÇVÖç3¦Ö–æÖ‚ƒ#‚Ãg"’WFó¶v£‡‡Òæf6V&öö´w&÷WÆ—7D7&VFR'WGFöâÂæf6V&öö´w&÷W6fVDÆ—7Dw&–B'WGFöç¶&÷&FW#£‚6öÆ–B3cƒc–¶&÷&FW"×&F—W3£‡ƒ·FF–æs£‡‚ƒ¶&6¶w&÷VæC¢6ffc¶6öÆ÷#¢3cfCvC¶föçB×vV–v‡C£ƒ¶7W'6÷#§ö–çFW'Òæf6V&öö´w&÷WÆ—7D7&VFR'WGFöã¦F—6&ÆVBÂæf6V&öö´w&÷W6fVDÆ—7Dw&–B'WGFöã¦F—6&ÆVG¶7W'6÷#¦æ÷BÖÆÆ÷vVC¶÷6—G“¢ãWÒæf6V&öö´w&÷W6fVDÆ—7Dw&–G¶F—7Æ“¦w&–C¶w&–B×FV×ÆFRÖ6öÇVÖç3§&WVB†WFòÖf—BÆÖ–æÖ‚ƒ#ƒ‚Ãg"’“¶v£‡‡Òæf6V&öö´w&÷W6fVDÆ—7Dw&–B'F–6ÆW¶F—7Æ“¦w&–C¶v£‡ƒ·FF–æs£ƒ¶&÷&FW"×&F—W3£‡ƒ¶&6¶w&÷VæC¢6VVc†fÒæf6V&öö´w&÷W6fVDÆ—7Dw&–B'F–6ÆSç7ç¶F—7Æ“¦fÆWƒ¶§W7F–g’Ö6öçFVçC§76RÖ&WGvVVã¶v£‡‡Òæf6V&öö´w&÷W6fVDÆ—7Dw&–B'F–6ÆR6ÖÆÇ¶6öÆ÷#¢3CSƒcgÒæf6V&öö´w&÷W6fVDÆ—7Dw&–B'F–6ÆSæF—g¶F—7Æ“¦fÆWƒ¶fÆW‚×w&§w&¶v£g‡Òæf6V&öö´w&÷W6fVDÆ—7Dw&–B'WGFöâæFævW'¶&÷&FW"Ö6öÆ÷#¢6#3C“C“¶6öÆ÷#¢6&c&gÒæf6V&öö´w&÷WGf–6UæVÇ¶F—7Æ“¦w&–C¶w&–B×FV×ÆFRÖ6öÇVÖç3£g"WFó¶v£g‚'ƒ·FF–æs£ƒ¶&÷&FW#£‚6öÆ–B3sf#““#¶&÷&FW"×&F—W3£—ƒ¶&6¶w&÷VæC¢6VVfc7Òæf6V&öö´w&÷WGf–6UæVÃæF—bÂæf6V&öö´w&÷WGf–6UæVÂ¶w&–BÖ6öÇVÖã£Òæf6V&öö´w&÷WGf–6UæVÃæF—g¶F—7Æ“¦fÆWƒ¶fÆW‚×w&§w&¶v£w‚'‡Òæf6V&öö´w&÷WGf–6UæVÃæF—b7ç¶6öÆ÷#¢3#3fCCc¶föçB×vV–v‡C£ƒÒæf6V&öö´w&÷WGf–6UæVÂ¶6öÆ÷#¢3CSƒcc¶föçB×6—¦S£7‡Òæf6V&öö´w&÷WGf–6UæVÂ'WGFöç¶w&–BÖ6öÇVÖã£#¶w&–B×&÷s£ó3¶Æ–vâ×6VÆc¦6VçFW#¶&÷&FW#£‚6öÆ–B3#3ƒFc¶&÷&FW"×&F—W3£‡ƒ·FF–æs£—‚ƒ¶&6¶w&÷VæC¢6ffc¶6öÆ÷#¢3sc6C¶föçB×vV–v‡C£ƒ¶7W'6÷#§ö–çFW'Òæf6V&öö´w&÷WFööÇ7¶F—7Æ“¦w&–C¶w&–B×FV×ÆFRÖ6öÇVÖç3¦Ö–æÖ‚ƒ##‚Ãg"’WFó¶Æ–vâÖ—FV×3¦VæC¶v£‡Òæf6V&öö´w&÷WFööÇ3æF—g¶F—7Æ“¦fÆWƒ¶v£w‡Òæf6V&öö´w&÷WFööÇ2'WGFöç¶&÷&FW#£‚6öÆ–B3ƒsvc#¶&÷&FW"×&F—W3£‡ƒ·FF–æs£—‚ƒ¶&6¶w&÷VæC¢6ffc¶6öÆ÷#¢3CVF&c¶föçB×vV–v‡C£ƒ¶7W'6÷#§ö–çFW'Òæf6V&öö´w&÷WÆ—7G¶F—7Æ“¦w&–C¶v£wƒ¶Ö‚Ö†V–v‡C£33ƒ¶÷fW&fÆ÷s¦WFó·FF–æs£G‚‡‚G‚'ƒ¶&÷&FW"Ö&Æö6³£‚6öÆ–B6CVSSwÒæf6V&öö´w&÷W6†ö–6W¶F—7Æ“¦fÆWƒ¶Æ–vâÖ—FV×3¦6VçFW#¶§W7F–g’Ö6öçFVçC§76RÖ&WGvVVã¶v£ƒ·FF–æs£‡ƒ¶&÷&FW"×&F—W3£‡‡Òæf6V&öö´w&÷W6†ö–6Rç6VæFW$Ö—76–æw¶&6¶w&÷VæC¢6ffc&CÒæf6V&öö´w&÷W6†ö–6Rç6VæFW%&VG—¶&6¶w&÷VæC¢6S–cfVWÒæf6V&öö´w&÷W6†ö–6Rç&V6öÖÖVæFVG¶&÷‚×6†F÷s¦–ç6WBG‚3#3ƒFgÒæf6V&öö´w&÷W6†ö–6Ræfö–G¶&6¶w&÷VæC¢6ffcc¶&÷‚×6†F÷s¦–ç6WBG‚6&c&gÒæf6V&öö´w&÷W6†ö–6RÆ&VÂ7ç¶F—7Æ“¦w&–GÒæf6V&öö´w&÷W6†ö–6RÆ&VÂ'¶F—7Æ“¦fÆWƒ¶fÆW‚×w&§w&¶Æ–vâÖ—FV×3¦6VçFW#¶v£g‡Òæf6V&öö´w&÷W6†ö–6RÆ&VÂV×·FF–æs£'‚gƒ¶&÷&FW"×&F—W3£““—ƒ¶&6¶w&÷VæC¢6CvcS¶6öÆ÷#¢3sc6C¶föçB×6—¦S£ƒ¶föçB×7G–ÆS¦æ÷&ÖÇÒæf6V&öö´w&÷W6†ö–6RÆ&VÂVÒæ6öæF—F–öæÇ¶&6¶w&÷VæC¢6ffc&C¶6öÆ÷#¢3ƒV#Òæf6V&öö´w&÷W6†ö–6RÆ&VÂVÒæfö–G¶&6¶w&÷VæC¢6cVFVFS¶6öÆ÷#¢6&c&gÒæf6V&öö´w&÷W6†ö–6RÆ&VÂ6ÖÆÇ¶föçB×vV–v‡C£cÒæf6V&öö´w&÷W6†ö–6SæF—g¶F—7Æ“¦fÆWƒ¶v£‡‡Òæf6V&öö´w&÷W6†ö–6R'WGFöç¶&÷&FW#£¶&6¶w&÷VæC¦æöæS¶6öÆ÷#¢6&c&c·FW‡BÖFV6÷&F–öã§VæFW&Æ–æS¶7W'6÷#§ö–çFW'Òæf6V&öö´w&÷W6†ö–6R'WGFöã¦f—'7BÖ6†–ÆC¦æ÷Bƒ¦Æ7BÖ6†–ÆB—¶6öÆ÷#¢3CVF&gÒæf6V&öö´w&÷WFG¶F—7Æ“¦w&–C¶w&–B×FV×ÆFRÖ6öÇVÖç3£g"ãFg"WFó¶v£‡‡Òæf6V&öö´w&÷WFB'WGFöâÂæf6V&öö´w&÷W6†&T7F–öç2'WGFöç¶&÷&FW#£‚6öÆ–B3ƒsvc#¶&÷&FW"×&F—W3£‡ƒ·FF–æs£—‚ƒ¶&6¶w&÷VæC¢6ffc¶6öÆ÷#¢3CVF&c¶föçB×vV–v‡C£ƒ¶7W'6÷#§ö–çFW'Òæf6V&öö´w&÷W6†&T7F–öç7¶F—7Æ“¦fÆWƒ¶fÆW‚×w&§w&¶Æ–vâÖ—FV×3¦6VçFW#¶v£wƒ¶Ö&v–â×F÷£ƒ·FF–æs£ƒ¶&÷&FW"ÖÆVgC£G‚6öÆ–B3ƒsvc#¶&÷&FW"×&F—W3£‡ƒ¶&6¶w&÷VæC¢6VVcVfgÒæf6V&öö´w&÷W6†&T7F–öç27G&öærÂæf6V&öö´w&÷W6†&T7F–öç3ç¶fÆW‚Ö&6—3£S¶Ö&v–ã£Òæf6V&öö´w&÷W6†&T7F–öç2¶6öÆ÷#¢3CSƒcc¶föçB×6—¦S£7‡Òæf6V&öö´w&÷W6VæFW$7F–öç¶F—7Æ“¦w&–C¶v£7ƒ·FF–æs£‡ƒ¶&÷&FW"×&F—W3£‡ƒ¶&6¶w&÷VæC¢6ffgÒæf6V&öö´w&÷W6VæFW$7F–öâæ&Æö6¶VG¶&÷&FW#£‚6öÆ–B63“F#F#¶&6¶w&÷VæC¢6ffccÒæf6V&öö´w&÷W6VæFW$7F–öâ7ç¶föçB×6—¦S£'ƒ¶föçB×vV–v‡C£ƒÒæf6V&öö´w&÷WFVÆ•6WGF–æw7¶F—7Æ“¦w&–C¶w&–B×FV×ÆFRÖ6öÇVÖç3§&WVBƒ"ÆÖ–æÖ‚ƒS‚Ã##‚’“¶v£‡ƒ¶fÆW‚Ö&6—3£WÒæf6V&öö´w&÷WFVÆ•6WGF–æw2–çWG·FF–æs£w‚—‡Òæf6V&öö´w&÷Wv—G·FF–æs£—‚ƒ¶&÷&FW"×&F—W3£‡ƒ¶&6¶w&÷VæC¢6ffc&C¶6öÆ÷#¢3ƒV#–×÷'FçGÒæf6V&öö´w&÷W6ö×ÆWFW·FF–æs£—‚ƒ¶&÷&FW"×&F—W3£‡ƒ¶&6¶w&÷VæC¢6S–cfVS¶6öÆ÷#¢3#3fCCb–×÷'FçGÒæf6V&öö´w&÷W6†&T7F–öç2æf6V&öö´w&÷W&W6WG¶Ö&v–âÖÆVgC¦WFó¶&÷&FW"Ö6öÆ÷#¢3sƒ“–3¶6öÆ÷#¢3CSƒcgÐ¢æf6V&öö´6†ææVÅ6V7F–öç¶w&–BÖ6öÇVÖã£òÓÒæf6V&öö´w&÷WFööÇ3æF—g¶fÆW‚×w&§w&¶§W7F–g’Ö6öçFVçC¦fÆW‚ÖVæGÒæf6V&öö´w&÷WÆ—7G¶Ö–â×v–GFƒ£¶÷fW&fÆ÷r×ƒ¦†–FFVçÒæf6V&öö´w&÷WÆ—7Bæ6ö×7G¶Ö‚Ö†V–v‡C£C3ƒ¶÷fW&fÆ÷r×“¦WF÷Òæf6V&öö´w&÷WÆ—7BæW‡æFVG¶Ö‚Ö†V–v‡C¦æöæS¶÷fW&fÆ÷s§f—6–&ÆWÒæf6V&öö´w&÷W6†ö–6W¶Ö–â×v–GFƒ£·FF–æs£‡Òæf6V&öö´w&÷W6†ö–6RÆ&VÂÂæf6V&öö´w&÷W6†ö–6RÆ&VÂ7ç¶Ö–â×v–GFƒ£Òæf6V&öö´w&÷W6†ö–6RÆ&VÂ6ÖÆÇ¶÷fW&fÆ÷r×w&¦ç—v†W&WÒæf6V&öö´w&÷W6†ö–6SæF—g¶fÆW‚×w&§w&¶§W7F–g’Ö6öçFVçC¦fÆW‚ÖVæGÐ¢æ6×–våG—Tw&–G¶F—7Æ“¦w&–C¶w&–B×FV×ÆFRÖ6öÇVÖç3§&WVBƒ2ÆÖ–æÖ‚ƒÃg"’“¶v£ƒ¶Ö&v–ã£#‡Òæ6×–våG—Tw&–B'WGFöç¶F—7Æ“¦fÆWƒ¶fÆW‚ÖF—&V7F–öã¦6öÇVÖã¶v£Gƒ·FW‡BÖÆ–vã¦ÆVgC·FF–æs£Gƒ¶&÷&FW#£‚6öÆ–B63fCVFc¶&÷&FW"×&F—W3£'ƒ¶&6¶w&÷VæC¢6ffc¶6öÆ÷#¢3s3SS#¶7W'6÷#§ö–çFW'Òæ6×–våG—Tw&–B'WGFöâæ7F—fW¶&÷&FW"Ö6öÆ÷#¢3#Sƒƒ–#¶&6¶w&÷VæC¢6VVcvc“¶&÷‚×6†F÷s¦–ç6WB‚3#Sƒƒ–'Òæ6×–våG—Tw&–B7ç¶föçB×6—¦S£7ƒ¶6öÆ÷#¢3V3s#ƒS¶föçB×vV–v‡C£CÐ¢æWfVçEv÷&·76T6†ö÷6W'¶F—7Æ“¦w&–C¶v£Gƒ¶Ö&v–ã£#ƒ·FF–æs£‡ƒ¶&÷&FW#£‚6öÆ–B6#–C&F¶&÷&FW"×&F—W3£Gƒ¶&6¶w&÷VæC¢6c†f&f7ÒæWfVçEv÷&·76T6†ö÷6W"ƒ2ÂæWfVçEv÷&·76T6†ö÷6W"¶Ö&v–ã£ÒæWfVçEv÷&·76T6†ö–6W7¶F—7Æ“¦w&–C¶w&–B×FV×ÆFRÖ6öÇVÖç3§&WVBƒ2ÆÖ–æÖ‚ƒÃg"’“¶v£'‡ÒæWfVçEv÷&·76T6†ö–6W2'WGFöç¶F—7Æ“¦fÆWƒ¶Ö–âÖ†V–v‡C£'ƒ¶fÆW‚ÖF—&V7F–öã¦6öÇVÖã¶v£gƒ·FF–æs£gƒ¶&÷&FW#£‚6öÆ–B63fCVFc¶&÷&FW"×&F—W3£'ƒ¶&6¶w&÷VæC¢6ffc¶6öÆ÷#¢3s3SS#·FW‡BÖÆ–vã¦ÆVgC¶7W'6÷#§ö–çFW'ÒæWfVçEv÷&·76T6†ö–6W2'WGFöâæ7F—fW¶&÷&FW"Ö6öÆ÷#¢3#Sƒƒ–#¶&6¶w&÷VæC¢6Vcvc“¶&÷‚×6†F÷s¦–ç6WB'‚3#Sƒƒ–'ÒæWfVçEv÷&·76T6†ö–6W27G&öæw¶föçB×6—¦S£g‡ÒæWfVçEv÷&·76T6†ö–6W27ç¶6öÆ÷#¢3V3s#ƒS¶Æ–æRÖ†V–v‡C£ãGÐ¢æ7&VF÷%V–6´&'·÷6—F–öã§7F–6·“·F÷£ƒ·¢Ö–æFWƒ£#¶F—7Æ“¦fÆWƒ¶Æ–vâÖ—FV×3¦6VçFW#¶§W7F–g’Ö6öçFVçC§76RÖ&WGvVVã¶v£'ƒ¶Ö&v–ã£‡ƒ·FF–æs£ƒ¶&÷&FW#£‚6öÆ–B6#–C&F¶&÷&FW"×&F—W3£'ƒ¶&6¶w&÷VæC§&v&ƒ#SRÃ#SRÃ#SRÂã“r“¶&÷‚×6†F÷s£‡‚#G‚&v&ƒ#2ÃS2Ãƒ"Âã"“¶&6¶G&÷Öf–ÇFW#¦&ÇW"ƒ‡‚—Òæ7&VF÷%V–6´Æ–æ·2Âæ7&VF÷%V–6´7F–öç7¶F—7Æ“¦fÆWƒ¶Æ–vâÖ—FV×3¦6VçFW#¶v£w‡Òæ7&VF÷%V–6´Æ–æ·7¶Ö–â×v–GFƒ£¶÷fW&fÆ÷r×ƒ¦WF÷Òæ7&VF÷%V–6´&"'WGFöç¶fÆWƒ£WFó¶&÷&FW#£‚6öÆ–B3–6&33¶&÷&FW"×&F—W3£‡ƒ·FF–æs£‡‚ƒ¶&6¶w&÷VæC¢6cvf&f3¶6öÆ÷#¢3sfCvc¶föçC¦–æ†W&—C¶föçB×6—¦S£7ƒ¶föçB×vV–v‡C£ƒ¶7W'6÷#§ö–çFW'Òæ7&VF÷%V–6´7F–öç2'WGFöç¶&÷&FW"Ö6öÆ÷#¢3#Sƒƒ–#¶&6¶w&÷VæC¢3#Sƒƒ–#¶6öÆ÷#¢6ffgÒæ7&VF÷%V–6´7F–öç2ç6V6öæF'”'WGFöç¶&6¶w&÷VæC¢6ffc¶6öÆ÷#¢3sfCvgÒæ7&VF÷%6V7F–öç·67&öÆÂÖÖ&v–â×F÷£“'‡Ð¢æÖ—76–æt6†ææVÄæ÷F–6W¶Ö&v–ã£‡‚–×÷'FçC·FF–æs£—‚ƒ¶&÷&FW"ÖÆVgC£G‚6öÆ–B6SF“#¶&÷&FW"×&F—W3£‡ƒ¶&6¶w&÷VæC¢6ffc&C¶6öÆ÷#¢3ƒV#Òç&÷FV7FVD6×–väæ÷F–6W¶Ö&v–ã£‡‚–×÷'FçC·FF–æs£—‚ƒ¶&÷&FW"ÖÆVgC£G‚6öÆ–B3sƒ“–3¶&÷&FW"×&F—W3£‡ƒ¶&6¶w&÷VæC¢6VVc&cS¶6öÆ÷#¢3CSƒcgÒçÆ6VD6×–väÆö6·¶Ö&v–ã£‡‚–×÷'FçC·FF–æs£—‚ƒ¶&÷&FW"ÖÆVgC£G‚6öÆ–B36“CSS¶&÷&FW"×&F—W3£‡ƒ¶&6¶w&÷VæC¢6S–cfVS¶6öÆ÷#¢3#3fCCgÒæ6öæ6WD†VF–æw¶F—7Æ“¦fÆWƒ¶fÆW‚×w&§w&¶v£wƒ¶Æ–vâÖ—FV×3¦6VçFW#¶Ö&v–âÖ&÷GFöÓ£W‡Òæ6×–vä¶–æG¶F—7Æ“¦&Æö6³·v–GFƒ¦Ö‚Ö6öçFVçC·FF–æs£G‚‡ƒ¶&÷&FW"×&F—W3£““—ƒ¶&6¶w&÷VæC¢6VVcvc“¶6öÆ÷#¢3sfCvc¶föçB×6—¦S£'ƒ¶föçB×vV–v‡C£ƒÒæ6öæ6WE6fVDG¶Ö&v–ã£G‚–×÷'FçC¶6öÆ÷#¢3V3s#ƒS¶föçB×6—¦S£'‡Òæ&÷fÅ7FFW·FF–æs£G‚‡ƒ¶&÷&FW"×&F—W3£““—ƒ¶föçB×6—¦S£'ƒ¶föçB×vV–v‡C£ƒÒæ&÷fÅ7FFRæG&gG¶&6¶w&÷VæC¢6VVc&cS¶6öÆ÷#¢3F3cs'Òæ&÷fÅ7FFRæ&÷fVG¶&6¶w&÷VæC¢6SVcfV¶6öÆ÷#¢3#Cs#6'Òæ6×–vå7FGW2'F–6ÆSæF—c¦f—'7BÖ6†–ÆB7G&öæw¶F—7Æ“¦&Æö6·Òç7FGW2æÆö6Ç¶&6¶w&÷VæC¢6VVc&cS¶6öÆ÷#¢3F3cs'ÒæVF—F–ætæ÷F–6W¶F—7Æ“¦fÆWƒ¶v£ƒ¶Æ–vâÖ—FV×3¦6VçFW#¶Ö&v–ã£G‚·FF–æs£'‚Gƒ¶&÷&FW"ÖÆVgC£G‚6öÆ–B3#Sƒƒ–#¶&÷&FW"×&F—W3£‡ƒ¶&6¶w&÷VæC¢6VVcvc“¶6öÆ÷#¢3s3SS'ÒæVF—F–ætæ÷F–6R7ç¶fÆWƒ£¶6öÆ÷#¢3V3s#ƒWÒæVF—F–ætæ÷F–6R'WGFöç¶&÷&FW#£‚6öÆ–B3#Sƒƒ–#¶&÷&FW"×&F—W3£‡ƒ·FF–æs£‡‚ƒ¶&6¶w&÷VæC¢6ffc¶6öÆ÷#¢3sfCvc¶föçB×vV–v‡C£ƒ¶7W'6÷#§ö–çFW'Òæ6öæ6WDf–ÇFW'7¶F—7Æ“¦w&–C¶w&–B×FV×ÆFRÖ6öÇVÖç3§&WVBƒ2ÆÖ–æÖ‚ƒÃg"’“¶v£'ƒ¶Ö&v–ã£g‚‡Òæ6öæ6WE6V&6‡¶w&–BÖ6öÇVÖã£òÓÒæ6öæ6WDf–ÇFW%7VÖÖ'—¶F—7Æ“¦fÆWƒ¶Æ–vâÖ—FV×3¦6VçFW#¶§W7F–g’Ö6öçFVçC§76RÖ&WGvVVã¶v£'ƒ¶Ö&v–âÖ&÷GFöÓ£gƒ¶6öÆ÷#¢3V3s#ƒS¶föçB×6—¦S£7‡Òæ6öæ6WDf–ÇFW%7VÖÖ'’'WGFöç¶&÷&FW#£¶&6¶w&÷VæC¦æöæS¶6öÆ÷#¢3sfCvc¶föçC¦–æ†W&—C¶föçB×vV–v‡C£ƒ·FW‡BÖFV6÷&F–öã§VæFW&Æ–æS¶7W'6÷#§ö–çFW'ÒæV×G”6öæ6WG7·FF–æs£gƒ¶&÷&FW"×&F—W3£ƒ¶&6¶w&÷VæC¢6cVc†f¶6öÆ÷#¢3V3s#ƒWÒæV×G”6×–vå7FFW¶F—7Æ“¦w&–C¶§W7F–g’Ö—FV×3§7F'C¶v£‡ƒ¶Ö&v–â×F÷£gƒ·FF–æs£‡ƒ¶&÷&FW#£‚F6†VB3–6&33¶&÷&FW"×&F—W3£'ƒ¶&6¶w&÷VæC¢6c†f&f7ÒæV×G”6×–vå7FFR¶Ö&v–ã£¶6öÆ÷#¢3V3s#ƒWÒæV×G”6×–vå7FFR'WGFöç¶&÷&FW#£¶&÷&FW"×&F—W3£—ƒ·FF–æs£‚Gƒ¶&6¶w&÷VæC¢3#Sƒƒ–#¶6öÆ÷#¢6ffc¶föçB×vV–v‡C£ƒ¶7W'6÷#§ö–çFW'Òæ6öæ6WD7F–öç7¶F—7Æ“¦fÆWƒ¶fÆW‚×w&§w&¶v£wƒ¶Ö&v–â×F÷£—‡Òæ6öæ6WD7F–öç2'WGFöâÂæ6öæ6WE66†VGVÆR'WGFöç·FF–æs£‡‚ƒ¶&÷&FW"×&F—W3£‡ƒ¶&6¶w&÷VæC¢6ffc¶föçB×vV–v‡C£ƒ¶7W'6÷#§ö–çFW'Òæ6öæ6WD7F–öç2'WGFöã¦F—6&ÆVBÂæ6öæ6WE66†VGVÆR'WGFöã¦F—6&ÆVG¶÷6—G“¢ãSS¶7W'6÷#§v—GÒæ6öæ6WD÷Vä'WGFöç¶&÷&FW#£‚6öÆ–B3#Sƒƒ–#¶6öÆ÷#¢3sfCvgÒæ6öæ6WD&÷fT'WGFöç¶&÷&FW#£‚6öÆ–B36“CSS¶6öÆ÷#¢3#Cs#6'Òæ6öæ6WDGWÆ–6FT'WGFöç¶&÷&FW#£‚6öÆ–B3sƒ“–3¶6öÆ÷#¢3CSƒcgÒæ6öæ6WDFVÆWFT'WGFöç¶&÷&FW#£‚6öÆ–B63“VCVC¶6öÆ÷#¢6&c&gÒæ6öæ6WE66†VGVÆW¶F—7Æ“¦fÆWƒ¶fÆW‚×w&§w&¶v£‡ƒ¶Æ–vâÖ—FV×3¦fÆW‚ÖVæC¶Ö&v–â×F÷£ƒ·FF–æs£ƒ¶&÷&FW"×&F—W3£—ƒ¶&6¶w&÷VæC¢6cVc†fÒæ6öæ6WE66†VGVÆRÆ&VÇ¶Ö–â×v–GFƒ£##‡Òæ6öæ6WE66†VGVÆR'WGFöç¶&÷&FW#£‚6öÆ–B3#Sƒƒ–#¶6öÆ÷#¢3sfCvgÒæ6öæ6WE66†VGVÆR7ç¶Æ–vâ×6VÆc¦6VçFW#¶6öÆ÷#¢3CSƒcc¶föçB×6—¦S£7ƒ¶föçB×vV–v‡C£sÐ¢çÆ6VÖVçD6†ö–6W7¶F—7Æ“¦w&–C¶v£‡‡ÒçÆ6VÖVçD6†ö–6W3ç7ç¶föçB×vV–v‡C£ƒÒçÆ6VÖVçD6†ö–6W2Æ&VÇ¶föçB×vV–v‡C£sÒæf6V&öö´WfVçDÆ–æ´7F–öç7¶F—7Æ“¦w&–C¶v£‡ƒ¶Ö&v–â×F÷£ƒ·FF–æs£'ƒ¶&÷&FW"×&F—W3£—ƒ¶&6¶w&÷VæC¢6VVcvfÒæf6V&öö´WfVçDÖçVÅv÷&¶fÆ÷w¶F—7Æ“¦w&–C¶v£—‡Òæf6V&öö´WfVçDÖçVÅv÷&¶fÆ÷r¶Ö&v–ã£¶6öÆ÷#¢3CSƒcgÒæf6V&öö´WfVçDÖçVÅFövvÆW¶§W7F–g’×6VÆc§7F'C¶&÷&FW#£‚6öÆ–B3#Sƒƒ–#¶&÷&FW"×&F—W3£‡ƒ·FF–æs£‡‚ƒ¶&6¶w&÷VæC¢6ffc¶6öÆ÷#¢3sfCvc¶föçC¦–æ†W&—C¶föçB×vV–v‡C£ƒ¶7W'6÷#§ö–çFW'Òæf6V&öö´WfVçDÖçVÄf–VÆG7¶F—7Æ“¦w&–C¶w&–B×FV×ÆFRÖ6öÇVÖç3¦Ö–æÖ‚ƒ##‚Ãg"’WFó¶v£‡ƒ¶Æ–vâÖ—FV×3¦6VçFW#·FF–ær×F÷£G‡Òæf6V&öö´WfVçDÖçVÄf–VÆG3âæ6†V6·¶w&–BÖ6öÇVÖã£òÓÒæf6V&öö´WfVçDÖçVÄf–VÆG2–çWG¶Ö–â×v–GFƒ£Òæf6V&öö´WfVçDÖçVÄf–VÆG2'WGFöç¶&÷&FW#£‚6öÆ–B3#Sƒƒ–#¶&÷&FW"×&F—W3£‡ƒ·FF–æs£—‚ƒ¶&6¶w&÷VæC¢3#Sƒƒ–#¶6öÆ÷#¢6ffc¶föçC¦–æ†W&—C¶föçB×vV–v‡C£ƒ¶7W'6÷#§ö–çFW'Òæ'&WfôVF–Væ6U–6¶W'¶F—7Æ“¦w&–C¶v£‡ƒ·FF–æs£ƒ¶&÷&FW"×&F—W3£—ƒ¶&6¶w&÷VæC¢6cVc†fÒæ'&WfôVF–Væ6U–6¶W"¶Ö&v–ã£Òæ'&WfôVF–Væ6U–6¶W"6ÖÆÇ¶6öÆ÷#¢3V3s#ƒWÒæ'&WfôVF–Væ6TW'&÷'¶6öÆ÷#¢6&c&gÒç&VF—4vVæW&F–öä6†ö–6W¶F—7Æ“¦w&–C¶v£‡ƒ·FF–æs£ƒ¶&÷&FW"×&F—W3£—ƒ¶&6¶w&÷VæC¢6cVc†fÒç&VF—4vVæW&F–öä6†ö–6R6ÖÆÇ¶6öÆ÷#¢3V3s#ƒWÒç7FvvW$f–VÆG7¶F—7Æ“¦w&–C¶w&–B×FV×ÆFRÖ6öÇVÖç3§&WVBƒ"ÆÖ–æÖ‚ƒÃg"’“¶v£'‡ÒæWfVçF–äFW7F–æF–öç¶F—7Æ“¦w&–C¶w&–B×FV×ÆFRÖ6öÇVÖç3¦Ö–æÖ‚ƒ#C‚Ãg"’Ö–æÖ‚ƒ#C‚Ãg"“¶Æ–vâÖ—FV×3¦VæC¶v£ƒ·FF–æs£7ƒ¶&÷&FW#£‚6öÆ–B3SvCvC¶&÷&FW"×&F—W3£ƒ¶&6¶w&÷VæC¢6S–cfVWÒæWfVçF–äFW7F–æF–öãâæ6†V6·¶Æ–vâ×6VÆc¦6VçFW#¶6öÆ÷#¢3#3fCCgÒæWfVçF–äFW7F–æF–öãç6ÖÆÇ¶w&–BÖ6öÇVÖã£òÓ¶6öÆ÷#¢3CSƒcgÐ¢æWfVçD7&VF÷$w&–BÂæ6†ææVÄFWF–Ç7¶F—7Æ“¦w&–C¶w&–B×FV×ÆFRÖ6öÇVÖç3§&WVBƒ"ÆÖ–æÖ‚ƒÃg"’“¶v£G‡Òæ6†ææVÄFWF–Ç2f–VÆG6WG¶Ö&v–ã£·FF–æs£Gƒ¶&÷&FW#£‚6öÆ–B63fCVFc¶&÷&FW"×&F—W3£'ƒ¶F—7Æ“¦w&–C¶v£‡Òæ6†ææVÄFWF–Ç2ÆVvVæBÂæWfVçDFW7F–æF–öç2ÆVvVæG¶föçB×vV–v‡C£ƒÒæ6†ææVÄFWF–Ç2¶Ö&v–ã£¶6öÆ÷#¢3V3s#ƒWÒæ6†ææVÄ6†V6·7¶F—7Æ“¦w&–C¶w&–B×FV×ÆFRÖ6öÇVÖç3§&WVBƒ"ÆÖ–æÖ‚ƒÃg"’“¶v£—‡Òæ6†ææVÄ6†V6·¶F—7Æ“¦fÆWƒ¶fÆW‚ÖF—&V7F–öã§&÷s¶Æ–vâÖ—FV×3¦6VçFW#¶§W7F–g’Ö6öçFVçC§76RÖ&WGvVVã¶v£‡ƒ·FF–æs£—‚ƒ¶&÷&FW#£‚6öÆ–B6CVSSs¶&÷&FW"×&F—W3£—ƒ¶&6¶w&÷VæC¢6ffgÒæ6†ææVÄ6†V6²æ6†V6·¶Ö&v–ã£Òæ6†ææVÄ6†V6²6ÖÆÇ·FF–æs£G‚wƒ¶&÷&FW"×&F—W3£““—ƒ¶&6¶w&÷VæC¢6VVcvc“¶6öÆ÷#¢3sfCvc¶föçB×6—¦S£ƒ·v†—FR×76S¦æ÷w&ÒæVF—F÷&–ÄvVæF–6¶W'¶Ö–â×v–GFƒ£¶÷fW&fÆ÷s¦†–FFVçÒæVF—F÷&–ÅF&vWD'VÆ´7F–öç7¶F—7Æ“¦fÆWƒ¶fÆW‚×w&§w&¶v£‡‡ÒæVF—F÷&–ÅF&vWD'VÆ´7F–öç2'WGFöç¶&÷&FW#£‚6öÆ–B3#Sƒƒ–#¶&÷&FW"×&F—W3£‡ƒ·FF–æs£—‚'ƒ¶&6¶w&÷VæC¢6ffc¶6öÆ÷#¢3sfCvc¶föçC¦–æ†W&—C¶föçB×vV–v‡C£ƒ¶7W'6÷#§ö–çFW'ÒæVF—F÷&–ÅF&vWD'VÆ´7F–öç2'WGFöã¦f—'7BÖ6†–ÆG¶&6¶w&÷VæC¢3#Sƒƒ–#¶6öÆ÷#¢6ffgÒæVF—F÷&–ÅF&vWDw&–G¶w&–B×FV×ÆFRÖ6öÇVÖç3§&WVB†WFòÖf—BÆÖ–æÖ‚†Ö–âƒRÃ3C‚’Ãg"’—ÒæVF—F÷&–ÅF&vWD6&G¶F—7Æ“¦&Æö6³¶Ö–â×v–GFƒ£ÒæVF—F÷&–ÅF&vWD†VG¶F—7Æ“¦fÆWƒ¶Æ–vâÖ—FV×3¦fÆW‚×7F'C¶§W7F–g’Ö6öçFVçC§76RÖ&WGvVVã¶v£ƒ¶Ö–â×v–GFƒ£ÒæVF—F÷&–ÅF&vWD†VBæ6†V6·¶Ö–â×v–GFƒ£ÒæVF—F÷&–ÅF&vWD†VB6ÖÆÇ¶fÆWƒ£WFó¶Ö‚×v–GFƒ£SRS·v†—FR×76S¦æ÷&ÖÃ·FW‡BÖÆ–vã§&–v‡GÒæVF—F÷&–ÅF&vWDÆ–æ·7¶F—7Æ“¦fÆWƒ¶fÆW‚×w&§w&¶v£g‚'ƒ¶Ö&v–â×F÷£‡ƒ¶Ö–â×v–GFƒ£ÒæVF—F÷&–ÅF&vWDÆ–æ·2ÂæVF—F÷&–ÅF&vWDÆ–æ·27ç¶Ö‚×v–GFƒ£S¶÷fW&fÆ÷r×w&¦ç—v†W&S·v÷&BÖ'&V³¦'&V²×v÷&GÒæVF—F÷&–ÅF&vWD†–çG¶F—7Æ“¦&Æö6³¶Ö&v–â×F÷£wƒ·v†—FR×76S¦æ÷&ÖÂ–×÷'FçGÒæ6†ææVÅ6fWG”æ÷FW¶Ö&v–ã£·FF–æs£‚'ƒ¶&÷&FW"ÖÆVgC£G‚6öÆ–B3#Sƒƒ–#¶&÷&FW"×&F—W3£‡ƒ¶&6¶w&÷VæC¢6VVcvc“¶6öÆ÷#¢3CSƒcgÒæ6†V6·¶fÆW‚ÖF—&V7F–öã§&÷s¶Æ–vâÖ—FV×3¦6VçFW'Òçv–FW¶w&–BÖ6öÇVÖã£òÓÖÆ&VÇ¶F—7Æ“¦fÆWƒ¶fÆW‚ÖF—&V7F–öã¦6öÇVÖã¶v£gƒ¶föçB×vV–v‡C£s¶6öÆ÷#¢3s3SS'Ö–çWBÇ6VÆV7BÇFW‡F&V·v–GFƒ£S¶&÷‚×6—¦–æs¦&÷&FW"Ö&÷ƒ¶&÷&FW#£‚6öÆ–B63fCVFc¶&÷&FW"×&F—W3£—ƒ·FF–æs£‚'ƒ¶&6¶w&÷VæC¢6ffc¶6öÆ÷#¢3s3SS#¶föçC¦–æ†W&—G×FW‡F&V·&W6—¦S§fW'F–6ÇÒæ6†V6²–çWBÂæWfVçDFW7F–æF–öç2–çWE·G—SÖ6†V6¶&÷…×·v–GFƒ¦WF÷Òæ–ÖvUWÆöG7·FF–æs£gƒ¶&÷&FW#£‚6öÆ–B63fCVFc¶&÷&FW"×&F—W3£'ƒ¶&6¶w&÷VæC¢6c†f&f7Òæ–ÖvUWÆöD†VBÂæ–ÖvT†VÇÂçWÆöFVD–ÖvR¶Ö&v–ã£G‚¶6öÆ÷#¢3V3s#ƒWÒæWfVçF–ä–ÖvU7FGW7¶F—7Æ“¦fÆWƒ¶Æ–vâÖ—FV×3¦6VçFW#¶§W7F–g’Ö6öçFVçC§76RÖ&WGvVVã¶v£gƒ¶Ö&v–â×F÷£Gƒ·FF–æs£7ƒ¶&÷&FW"×&F—W3£ƒ¶&÷&FW#£‚6öÆ–B6CVSSwÒæWfVçF–ä–ÖvU7FGW3æF—c¦f—'7BÖ6†–ÆG¶F—7Æ“¦fÆWƒ¶fÆW‚ÖF—&V7F–öã¦6öÇVÖã¶v£G‡ÒæWfVçF–ä–ÖvU7FGW27ç¶föçB×vV–v‡C£ƒÒæWfVçF–ä–ÖvU7FGW26ÖÆÇ¶6öÆ÷#¢3V3s#ƒWÒæWfVçF–ä–ÖvU7FGW2ç&VG—¶&÷&FW"Ö6öÆ÷#¢3SvCvC¶&6¶w&÷VæC¢6S–cfVWÒæWfVçF–ä–ÖvU7FGW2ç&VG’7ç¶6öÆ÷#¢3#3fCCgÒæWfVçF–ä–ÖvU7FGW2æV×G—¶&6¶w&÷VæC¢6ffgÒæWfVçF–ä–ÖvU&Wf–Ww¶F—7Æ“¦w&–C¶w&–B×FV×ÆFRÖ6öÇVÖç3£s'‚Ö–æÖ‚ƒƒ‚Ãc‚“¶Æ–vâÖ—FV×3¦6VçFW#¶v£—‡ÒæWfVçF–ä–ÖvU&Wf–Wr–Öw¶F—7Æ“¦&Æö6³·v–GFƒ£s'ƒ¶†V–v‡C£s'ƒ¶&÷&FW"×&F—W3£‡ƒ¶ö&¦V7BÖf—C¦6÷fW'ÒæWfVçF–ä–ÖvU&Wf–Wr6ÖÆÇ¶÷fW&fÆ÷r×w&¦ç—v†W&WÒæ7&÷fö7W7¶Ö&v–â×F÷£Gƒ·FF–æs£'ƒ¶&÷&FW"×&F—W3£ƒ¶&6¶w&÷VæC¢6VVcvc—Òæ7&÷fö7W26VÆV7G¶Ö&v–â×F÷£'‡Òæ7&÷fö7W26ÖÆÇ¶6öÆ÷#¢3V3s#ƒS¶föçB×vV–v‡C£SÒæ–ÖvU6Æ÷Dw&–G¶F—7Æ“¦w&–C¶w&–B×FV×ÆFRÖ6öÇVÖç3§&WVBƒ"ÆÖ–æÖ‚ƒÃg"’“¶v£'ƒ¶Ö&v–â×F÷£G‡Òæ–ÖvU6Æ÷G¶F—7Æ“¦fÆWƒ¶§W7F–g’Ö6öçFVçC§76RÖ&WGvVVã¶v£'ƒ¶Ö–âÖ†V–v‡C£#Wƒ·FF–æs£7ƒ¶&÷&FW#£‚6öÆ–B6CVSSs¶&÷&FW"×&F—W3£ƒ¶&6¶w&÷VæC¢6ffc·G&ç6—F–öã¦&÷&FW"Ö6öÆ÷"ãW2V6RÆ&6¶w&÷VæBãW2V6RÇG&ç6f÷&ÒãW2V6WÒæ–ÖvU6Æ÷Bæ–ÖvU6Æ÷DÆÇ¶Ö&v–â×F÷£Gƒ¶&÷&FW#£'‚F6†VB3#Sƒƒ–#¶&6¶w&÷VæC¢6VVc–fÒæ–ÖvU6Æ÷BæW†7G¶&÷&FW"Ö6öÆ÷#¢3SvCvGÒæ–ÖvU6Æ÷BæG&vv–æw¶&÷&FW#£'‚F6†VB3#Sƒƒ–#¶&6¶w&÷VæC¢6Svcfcƒ·G&ç6f÷&Ó§G&ç6ÆFU’‚Ó'‚—Òæ–ÖvU6Æ÷CæF—c¦f—'7BÖ6†–ÆG¶F—7Æ“¦fÆWƒ¶fÆW‚ÖF—&V7F–öã¦6öÇVÖã¶v£G‡Òæ–ÖvU6Æ÷B7ç¶föçB×vV–v‡C£ƒ¶6öÆ÷#¢3sfCvgÒæ–ÖvU6Æ÷B6ÖÆÇ¶6öÆ÷#¢3V3s#ƒS¶Ö‚×v–GFƒ£##‡Òæ–ÖvTG&÷¦öæW¶Ö–â×v–GFƒ£ƒƒ¶F—7Æ“¦fÆWƒ¶fÆW‚ÖF—&V7F–öã¦6öÇVÖã¶Æ–vâÖ—FV×3¦6VçFW#¶§W7F–g’Ö6öçFVçC¦6VçFW#¶v£wƒ·FF–æs£'ƒ¶&÷&FW#£'‚F6†VB3–6&33¶&÷&FW"×&F—W3£ƒ¶&6¶w&÷VæC¢6cvf&f3·FW‡BÖÆ–vã¦6VçFW'Òæ–ÖvTG&÷¦öæSç7G&öæw¶6öÆ÷#¢3sfCvc¶föçB×6—¦S£7‡Òæ–ÖvTG&÷¦öæSç6ÖÆÂÂç&WÆ6T†–çG¶6öÆ÷#¢3V3s#ƒS¶föçB×vV–v‡C£cÒçWÆöD'WGFöç¶Æ–vâ×6VÆc¦6VçFW#¶F—7Æ“¦–æÆ–æRÖfÆWƒ¶7W'6÷#§ö–çFW#¶&6¶w&÷VæC¢3#Sƒƒ–#¶6öÆ÷#¢6ffc·FF–æs£‚'ƒ¶&÷&FW"×&F—W3£‡ƒ·FW‡BÖÆ–vã¦6VçFW'ÒçWÆöD'WGFöâ–çWG¶F—7Æ“¦æöæWÒçWÆöFVD–ÖvW¶Ö–â×v–GFƒ£CW‡Òæ–ÖvU&Wf–Ww¶†V–v‡C£sGƒ¶&÷&FW"×&F—W3£‡ƒ¶&6¶w&÷VæB×6—¦S¦6÷fW#¶&6¶w&÷VæB×÷6—F–öã¦6VçFW'ÒçWÆöFVD–ÖvR¶föçB×6—¦S£'‡Òç&VÖ÷fT–ÖvW¶&÷&FW#£¶&6¶w&÷VæC¦æöæS¶6öÆ÷#¢6#66·FW‡BÖFV6÷&F–öã§VæFW&Æ–æS¶7W'6÷#§ö–çFW#·FF–æs£G‚ÒçWÆöDÖW76vW·FF–æs£—‚ƒ¶&÷&FW"×&F—W3£‡‡ÒçWÆöDÖW76vRç7V66W77¶&6¶w&÷VæC¢6S–cfVS¶6öÆ÷#¢3#3fCCgÒçWÆöDÖW76vRæW'&÷'¶&6¶w&÷VæC¢6ffc&C¶6öÆ÷#¢3ƒV#ÒæWfVçDFW7F–æF–öç7¶Ö&v–ã£‡‚·FF–æs£gƒ¶&÷&FW#£‚6öÆ–B63fCVFc¶&÷&FW"×&F—W3£'ƒ¶F—7Æ“¦w&–C¶v£'‡ÒæWfVçE&Wf–WrÂæWfVçE&W7VÇG·FF–æs£gƒ¶Ö&v–ã£G‚¶&÷&FW"×&F—W3£'ƒ¶&6¶w&÷VæC¢6VVcvc—ÒæÖVF–6†V6·¶Ö&v–â×F÷£Gƒ·FF–æs£'‚Gƒ¶&÷&FW"×&F—W3£—‡ÒæÖVF–6†V6²VÇ¶Ö&v–ã£‡‚·FF–ærÖÆVgC£#‡ÒæÖVF–6†V6µ&VG—¶&6¶w&÷VæC¢6S–cfVS¶6öÆ÷#¢3#3fCCgÒæÖVF–6†V6µv&æ–æw¶&6¶w&÷VæC¢6ffc&C¶6öÆ÷#¢3ƒV#Òæ6†ææVÄ–ÖvU&Wf–Wtw&–G¶F—7Æ“¦w&–C¶w&–B×FV×ÆFRÖ6öÇVÖç3§&WVBƒ"ÆÖ–æÖ‚ƒÃg"’“¶v£'ƒ¶Ö&v–â×F÷£g‡Òæ6†ææVÄ–ÖvU&Wf–Ww¶&6¶w&÷VæC¢6ffc¶&÷&FW#£‚6öÆ–B63fCVFc¶&÷&FW"×&F—W3£ƒ·FF–æs£'‡Òæ6†ææVÄ–ÖvU&Wf–Wt†VG¶F—7Æ“¦fÆWƒ¶Æ–vâÖ—FV×3¦6VçFW#¶§W7F–g’Ö6öçFVçC§76RÖ&WGvVVã¶v£ƒ¶Ö&v–âÖ&÷GFöÓ£‡Òæ6†ææVÄ–ÖvU&Wf–Wt†VB7ç¶föçB×6—¦S£'ƒ·FF–æs£W‚‡ƒ¶&÷&FW"×&F—W3£““—‡Òæ–ÖvU&VG—¶&6¶w&÷VæC¢6S–cfVS¶6öÆ÷#¢3#3fCCgÒæ–ÖvTÖ—76–æw¶&6¶w&÷VæC¢6ffc&C¶6öÆ÷#¢3ƒV#Òæ6†ææVÄ–ÖvU&Wf–Wr–Öw¶F—7Æ“¦&Æö6³·v–GFƒ£S¶†V–v‡C£ƒƒ¶ö&¦V7BÖf—C¦6öçF–ã¶&6¶w&÷VæC¢6cFcvc“¶&÷&FW"×&F—W3£‡‡Òæ6†ææVÄ–ÖvU&Wf–Wr¶Ö&v–ã£—‚7‡Òæ6†ææVÄ–ÖvU&Wf–Wr6ÖÆÇ¶F—7Æ“¦&Æö6³¶6öÆ÷#¢3V3s#ƒS¶Æ–æRÖ†V–v‡C£ãGÒæ6†ææVÄ–ÖvU&Wf–WræfÆÆ&6´æ÷F–6W¶6öÆ÷#¢3ƒV#ÒæÖ—76–æt–ÖvTæ÷F–6W·FF–æs£gƒ¶&6¶w&÷VæC¢6ffc†Sc¶&÷&FW"×&F—W3£‡ƒ¶6öÆ÷#¢3ƒV#ÒæWfVçE&W7VÇBç7V66W77¶&÷&FW"ÖÆVgC£W‚6öÆ–B3&&cfGÒæWfVçE&W7VÇBæW'&÷'¶&6¶w&÷VæC¢6ffc&C¶&÷&FW"ÖÆVgC£W‚6öÆ–B6SF“'ÒæV&Ç”G&gD7F–öç¶F—7Æ“¦fÆWƒ¶Æ–vâÖ—FV×3¦6VçFW#¶§W7F–g’Ö6öçFVçC§76RÖ&WGvVVã¶v£gƒ¶Ö&v–â×F÷£‡ƒ·FF–æs£Gƒ¶&÷&FW#£‚F6†VB3–6&33¶&÷&FW"×&F—W3£ƒ¶&6¶w&÷VæC¢6c†f&f7ÒæV&Ç”G&gD7F–öâ¶Ö&v–ã£G‚¶6öÆ÷#¢3V3s#ƒWÒæV&Ç”G&gD7F–öâ'WGFöç¶fÆWƒ£WFó¶&÷&FW#£‚6öÆ–B3#Sƒƒ–#¶&÷&FW"×&F—W3£—ƒ·FF–æs£‚Wƒ¶&6¶w&÷VæC¢6ffc¶6öÆ÷#¢3sfCvc¶föçB×vV–v‡C£ƒ¶7W'6÷#§ö–çFW'ÒæWfVçD7F–öç7¶F—7Æ“¦fÆWƒ¶v£'ƒ¶§W7F–g’Ö6öçFVçC¦fÆW‚ÖVæC¶Ö&v–â×F÷£‡‡ÒæWfVçD7F–öç2'WGFöç¶&÷&FW#£¶&÷&FW"×&F—W3£—ƒ·FF–æs£'‚‡ƒ¶&6¶w&÷VæC¢3#Sƒƒ–#¶6öÆ÷#¢6ffc¶föçB×vV–v‡C£ƒ¶7W'6÷#§ö–çFW'ÒæWfVçD7F–öç2ç6V6öæF'”'WGFöç¶&6¶w&÷VæC¢6ffc¶6öÆ÷#¢3sfCvc¶&÷&FW#£‚6öÆ–B3#Sƒƒ–'Ö'WGFöã¦F—6&ÆVG¶÷6—G“¢ãSS¶7W'6÷#¦æ÷BÖÆÆ÷vVGÒæ6×–vå7FGW7¶Ö&v–â×F÷£#'ƒ·FF–ær×F÷£#ƒ¶&÷&FW"×F÷£‚6öÆ–B6CVSSwÒç7FGW4†VBÂæ6×–vå7FGW2'F–6ÆW¶F—7Æ“¦fÆWƒ¶§W7F–g’Ö6öçFVçC§76RÖ&WGvVVã¶v£gƒ¶Æ–vâÖ—FV×3¦fÆW‚×7F'GÒæ6×–vå7FGW2'F–6ÆW·FF–æs£G‚¶&÷&FW"×F÷£‚6öÆ–B6SS–VWÒç7FGW4†VBƒ2Âæ6×–vå7FGW2¶Ö&v–ã£Òç7FGW5–ÆÇ7¶F—7Æ“¦fÆWƒ¶fÆW‚×w&§w&¶v£wƒ¶§W7F–g’Ö6öçFVçC¦fÆW‚ÖVæGÒç7FGW7¶F—7Æ“¦fÆWƒ¶Æ–vâÖ—FV×3¦6VçFW#¶v£‡ƒ·FF–æs£w‚—ƒ¶&÷&FW"×&F—W3£'ƒ¶&6¶w&÷VæC¢6S–cfVS¶6öÆ÷#¢3#3fCCc¶föçB×6—¦S£7‡Òç7FGW2'WGFöç¶&÷&FW#£‚6öÆ–B7W'&VçD6öÆ÷#¶&÷&FW"×&F—W3£wƒ·FF–æs£W‚wƒ¶&6¶w&÷VæC¢6ffc¶6öÆ÷#¦–æ†W&—C¶föçC¦–æ†W&—C¶föçB×vV–v‡C£ƒ¶7W'6÷#§ö–çFW'Òç7FGW2'WGFöã¦F—6&ÆVG¶÷6—G“¢ãS¶7W'6÷#¦æ÷BÖÆÆ÷vVGÒç7FGW2æW‡G&övVvWfVç5öæöF–w¶&6¶w&÷VæC¢6ffc&C¶6öÆ÷#¢3ƒV#ÒæÆöDÖ÷&T6×–vç7¶F—7Æ“¦&Æö6³¶Ö&v–ã£G‚WFòGƒ¶&÷&FW#£‚6öÆ–B3#Sƒƒ–#¶&÷&FW"×&F—W3£—ƒ·FF–æs£‚gƒ¶&6¶w&÷VæC¢6ffc¶6öÆ÷#¢3sfCvc¶föçB×vV–v‡C£ƒ¶7W'6÷#§ö–çFW'ÒæÆöDÖ÷&T6×–vç3¦F—6&ÆVG¶÷6—G“¢ãSS¶7W'6÷#§v—GÒç7FGW4æ÷FW¶6öÆ÷#¢3V3s#ƒS¶föçB×6—¦S£7‡ÔÖVF–†Ö‚×v–GFƒ£sc‚—²æV&Ç”G&gD7F–öç¶F—7Æ“¦&Æö6·ÒæV&Ç”G&gD7F–öâ'WGFöç·v–GFƒ£S¶Ö&v–â×F÷£‡Òæ6×–våG—Tw&–BÂæWfVçD7&VF÷$w&–BÂæ6†ææVÄFWF–Ç2Âæ6†ææVÄ6†V6·2Âæ–ÖvU6Æ÷Dw&–BÂæ6öæ6WDf–ÇFW'2Âæ6†ææVÄ–ÖvU&Wf–Wtw&–BÂç7FvvW$f–VÆG7¶w&–B×FV×ÆFRÖ6öÇVÖç3£g'Òçv–FW¶w&–BÖ6öÇVÖã¦WF÷Òæ–ÖvU6Æ÷BÂæWfVçF–ä–ÖvU7FGW7¶F—7Æ“¦&Æö6·ÒæWfVçF–ä–ÖvU&Wf–Ww¶Ö&v–â×F÷£'‡ÒçWÆöD'WGFöç¶Ö&v–â×F÷£'‡ÒæWfVçD7F–öç7¶fÆW‚ÖF—&V7F–öã¦6öÇVÖçÒç7FGW4†VBÂæ6×–vå7FGW2'F–6ÆW¶F—7Æ“¦&Æö6·Òç7FGW5–ÆÇ7¶§W7F–g’Ö6öçFVçC¦fÆW‚×7F'C¶Ö&v–â×F÷£‡×Ð¢ÖVF–†Ö‚×v–GFƒ£sc‚—²çF–6¶WEf&–F–öäw&–BÂæf6V&öö´w&÷WFBÂæf6V&öö´w&÷WFööÇ2Âæf6V&öö´w&÷WFVÆ•6WGF–æw2ÂæWfVçEv÷&·76T6†ö–6W2Âæf6V&öö´w&÷WGf–6UæVÂÂæf6V&öö´w&÷WÆ—7D7&VFRÂæ6×–våv÷&¶fÆ÷u7FW7¶w&–B×FV×ÆFRÖ6öÇVÖç3£g'Òæf6V&öö´w&÷WGf–6UæVÃæF—bÂæf6V&öö´w&÷WGf–6UæVÂÂæf6V&öö´w&÷WGf–6UæVÂ'WGFöç¶w&–BÖ6öÇVÖã£¶w&–B×&÷s¦WF÷Òæf6V&öö´w&÷W–6¶W$†VG¶Æ–vâÖ—FV×3¦fÆW‚×7F'GÒæf6V&öö´w&÷WFööÇ3æF—g¶fÆW‚×w&§w&Òæf6V&öö´w&÷W6†&T7F–öç2'WGFöç·v–GFƒ£WÒæf6V&öö´w&÷W6†&T7F–öç2æf6V&öö´w&÷W&W6WG¶Ö&v–âÖÆVgC£Òæ6×–vä6&DÖ–ç¶F—7Æ“¦&Æö6·Òæ6×–vä6&D–ÖvW¶Ö&v–âÖ&÷GFöÓ£‡Òæ6×–vä6&D–ÖvR–Öw·v–GFƒ£S¶Ö‚×v–GFƒ£##ƒ¶†V–v‡C£#‡Òæ7&VF÷%V–6´&'·F÷£gƒ¶F—7Æ“¦&Æö6³·FF–æs£‡‡Òæ7&VF÷%V–6´Æ–æ·2Âæ7&VF÷%V–6´7F–öç7¶÷fW&fÆ÷r×ƒ¦WF÷Òæ7&VF÷%V–6´7F–öç7¶Ö&v–â×F÷£w‡Òæ7&VF÷%V–6´&"'WGFöç·FF–æs£‡ƒ¶föçB×6—¦S£'‡Òæ7&VF÷%6V7F–öç·67&öÆÂÖÖ&v–â×F÷£#g‡ÒæVF—F÷&–Ä'VÆ´7F–öç2Âæ–çFW&æÄVÖ–Ä†VBÂæ–çFW&æÄVÖ–Äfö÷FW'¶Æ–vâÖ—FV×3§7G&WF6ƒ¶fÆW‚ÖF—&V7F–öã¦6öÇVÖçÒæVF—F÷&–Ä'VÆ´7F–öç3æF—g¶F—7Æ“¦w&–GÒæVF—F÷&–Å7V&Ö—76–öåFövvÆR7ç¶Æ–vâÖ—FV×3¦fÆW‚×7F'C¶fÆW‚ÖF—&V7F–öã¦6öÇVÖçÒæ–çFW&æÄVÖ–Ä÷fW&Æ—·FF–æs£‡‡×Ð¢æ6†ææVÅ&Wf–Wt6öçG&öÇ7¶F—7Æ“¦fÆWƒ¶Æ–vâÖ—FV×3¦6VçFW#¶§W7F–g’Ö6öçFVçC§76RÖ&WGvVVã¶v£‡ƒ¶Ö&v–â×F÷£‡ƒ·FF–æs£Wƒ¶&÷&FW#£‚6öÆ–B3–6&33¶&÷&FW"×&F—W3£'ƒ¶&6¶w&÷VæC¢6c†f&f7Òæ6†ææVÅ&Wf–Wt6öçG&öÇ2¶Ö&v–ã£G‚¶6öÆ÷#¢3V3s#ƒWÒæ6†ææVÅ&Wf–Wt'WGFöç7¶F—7Æ“¦fÆWƒ¶fÆW‚×w&§w&¶v£‡‡Òæ6†ææVÅ&Wf–Wt'WGFöç2'WGFöç¶&÷&FW#£‚6öÆ–B3#Sƒƒ–#¶&÷&FW"×&F—W3£—ƒ·FF–æs£‚7ƒ¶&6¶w&÷VæC¢6ffc¶6öÆ÷#¢3sfCvc¶föçC¦–æ†W&—C¶föçB×vV–v‡C£ƒ¶7W'6÷#§ö–çFW'Òæ6†ææVÅ&Wf–Wt'WGFöç2'WGFöâæ7F—fW¶&6¶w&÷VæC¢3#Sƒƒ–#¶6öÆ÷#¢6ffgÒæ6†ææVÅ7V6–f–5&Wf–Ww¶Ö&v–ã£G‚·FF–æs£gƒ¶&÷&FW#£'‚6öÆ–B3#Sƒƒ–#¶&÷&FW"×&F—W3£'ƒ¶&6¶w&÷VæC¢6VVcvc“·67&öÆÂÖÖ&v–â×F÷£‡Òæ6†ææVÅ7V6–f–5&Wf–Wt†VG¶F—7Æ“¦fÆWƒ¶Æ–vâÖ—FV×3¦6VçFW#¶§W7F–g’Ö6öçFVçC§76RÖ&WGvVVã¶v£'ƒ¶Ö&v–âÖ&÷GFöÓ£G‡Òæ6†ææVÅ7V6–f–5&Wf–Wt†VB7âÂævöövÆUF÷–4Æ&VÇ·FF–æs£W‚—ƒ¶&÷&FW"×&F—W3£““—ƒ¶&6¶w&÷VæC¢6S–cfVS¶6öÆ÷#¢3#3fCCc¶föçB×6—¦S£'ƒ¶föçB×vV–v‡C£ƒÒç&÷f–FW%&Wf–Wt6&G¶F—7Æ“¦w&–C¶w&–B×FV×ÆFRÖ6öÇVÖç3¦Ö–æÖ‚ƒƒ‚Ã#ƒ‚’g#¶v£‡ƒ·FF–æs£Gƒ¶&÷&FW"×&F—W3£ƒ¶&6¶w&÷VæC¢6ffgÒç&÷f–FW%&Wf–Wt6&B–ÖrÂç&÷f–FW%&Wf–WuÆ6V†öÆFW'·v–GFƒ£S¶†V–v‡C£##ƒ¶&÷&FW"×&F—W3£—ƒ¶ö&¦V7BÖf—C¦6öçF–ã¶&6¶w&÷VæC¢6ccFcgÒç&÷f–FW%&Wf–WuÆ6V†öÆFW'¶F—7Æ“¦fÆWƒ¶Æ–vâÖ—FV×3¦6VçFW#¶§W7F–g’Ö6öçFVçC¦6VçFW#·FF–æs£Gƒ¶&÷‚×6—¦–æs¦&÷&FW"Ö&÷ƒ¶6öÆ÷#¢3V3s#ƒS·FW‡BÖÆ–vã¦6VçFW'Òç&÷f–FW%&Wf–Wt6&Bƒ7¶Ö&v–ã£g‚‡Òç&÷f–FW%&Wf–WuFW‡G·v†—FR×76S§&R×w&¶Æ–æRÖ†V–v‡C£ãSWÒç&÷f–FW%&Wf–Wt6&B6ÖÆÇ¶F—7Æ“¦&Æö6³¶Ö&v–â×F÷£ƒ¶6öÆ÷#¢3V3s#ƒWÒæVÖ–Å&÷f–FW%&Wf–Ww·FF–æs£gƒ¶&÷&FW"×&F—W3£ƒ¶&6¶w&÷VæC¢6ffgÒæVÖ–Å&÷f–FW%&Wf–Wsç¶÷fW&fÆ÷r×w&¦ç—v†W&WÒæVÖ–Å&Wf–Wt&öG—¶Ö&v–ã£G‚·FF–æs£gƒ¶&÷&FW#£‚6öÆ–B6CVSSs¶&÷&FW"×&F—W3£—ƒ¶&6¶w&÷VæC¢6ff6fGÒævöövÆU&÷f–FW%&Wf–Wr'WGFöç·v–GFƒ¦WFó¶Ö&v–â×F÷£‡‡ÔÖVF–†Ö‚×v–GFƒ£sc‚—²æ6†ææVÅ&Wf–Wt6öçG&öÇ7¶F—7Æ“¦&Æö6·Òæ6†ææVÅ&Wf–Wt'WGFöç7¶Ö&v–â×F÷£'‡Òæ6†ææVÅ&Wf–Wt'WGFöç2'WGFöç·v–GFƒ£WÒç&÷f–FW%&Wf–Wt6&G¶w&–B×FV×ÆFRÖ6öÇVÖç3£g'×Ð¢ÖVF–†Ö‚×v–GFƒ£sc‚—²æf6V&öö´WfVçDÖçVÄf–VÆG7¶w&–B×FV×ÆFRÖ6öÇVÖç3£g'Òæf6V&öö´WfVçDÖçVÄf–VÆG3âæ6†V6·¶w&–BÖ6öÇVÖã¦WF÷×Ð¢æ6×–vå7FGW2'F–6ÆW¶F—7Æ“¦w&–C¶w&–B×FV×ÆFRÖ6öÇVÖç3¦Ö–æÖ‚ƒÃg"“¶v£'ƒ·v–GFƒ£WÐ¢æ6×–vå7FGW2'F–6ÆSâæ6×–vä6&DÖ–ç·v–GFƒ£S¶Ö‚×v–GFƒ£WÐ¢æ6×–vå7FGW2'F–6ÆSâç7FGW5–ÆÇ7·v–GFƒ£S¶§W7F–g’Ö6öçFVçC¦fÆW‚×7F'GÐ¢æ6×–vå7FGW2'F–6ÆSâç7FGW5–ÆÇ2ç7FGW7¶Ö‚×v–GFƒ£S¶fÆW‚×w&§w&¶÷fW&fÆ÷r×w&¦ç—v†W&WÐ¢æ6öæ6WDWfVçF–å&Wf–Wt'WGFöç¶&÷&FW#£‚6öÆ–B3#Sƒƒ–#¶6öÆ÷#¢3sfCvgÐ¢ç6fVD6†ææVÅæVÇ¶Ö&v–â×F÷£'ƒ·FF–æs£Gƒ¶&÷&FW#£‚6öÆ–B63fCVFc¶&÷&FW"×&F—W3£'ƒ¶&6¶w&÷VæC¢6c†f&f7Ð¢ç6fVD6†ææVÅæVÄ†VG¶F—7Æ“¦fÆWƒ¶Æ–vâÖ—FV×3¦fÆW‚×7F'C¶§W7F–g’Ö6öçFVçC§76RÖ&WGvVVã¶v£Gƒ¶Ö&v–âÖ&÷GFöÓ£‡Ð¢ç6fVD6†ææVÅæVÄ†VBƒBÂç6fVD6†ææVÅæVÄ†VB¶Ö&v–ã£Òç6fVD6†ææVÅæVÄ†VB¶Ö&v–â×F÷£7ƒ¶6öÆ÷#¢3V3s#ƒS¶föçB×6—¦S£7‡Ð¢ç6fVD6†ææVÅæVÄ†VCç7ç¶fÆWƒ£WFó·FF–æs£W‚—ƒ¶&÷&FW"×&F—W3£““—ƒ¶&6¶w&÷VæC¢6S–cfVS¶6öÆ÷#¢3#3fCCc¶föçB×6—¦S£'ƒ¶föçB×vV–v‡C£ƒÐ¢ç6fVDWfVçF–åæVÇ¶&÷&FW"ÖÆVgC£G‚6öÆ–B3–#SSÒç6fVD6ÆVæF%æVÇ¶&÷&FW"ÖÆVgC£G‚6öÆ–B3#Sƒƒ–'Òç6fVD6ÆVæF%æVÂæ6æ6VÆÆVG¶&÷&FW"ÖÆVgBÖ6öÆ÷#¢6#3C“C“¶&6¶w&÷VæC¢6ffc†c‡Ð¢ç6fVD6†ææVÄÆ–æ·¶F—7Æ“¦–æÆ–æRÖfÆWƒ¶&÷&FW#£‚6öÆ–B3#Sƒƒ–#¶&÷&FW"×&F—W3£‡ƒ·FF–æs£‡‚ƒ¶&6¶w&÷VæC¢6ffc¶6öÆ÷#¢3sfCvc¶föçB×vV–v‡C£ƒ·FW‡BÖFV6÷&F–öã¦æöæWÐ¢ç6fVDÖævVÖVçEæVÇ¶Ö&v–â×F÷£'ƒ·FF–æs£Gƒ¶&÷&FW#£'‚6öÆ–B3s6#V3¶&÷&FW"×&F—W3£'ƒ¶&6¶w&÷VæC¢6cfc–f'Òç6fVDÖævVÖVçD†VF–æw¶Ö&v–âÖ&÷GFöÓ£'‡Òç6fVDÖævVÖVçD†VF–ærƒG¶Ö&v–ã£Òç6fVDÖævVÖVçD†VF–ær¶Ö&v–ã£G‚¶6öÆ÷#¢3FcccsS¶föçB×6—¦S£7‡Òç6fVDÖævVÖVçEæVÂæ6öæ6WD7F–öç7¶Ö&v–â×F÷£Ð¢æf6V&öö´WfVçDÆ–æ´7F–öç7¶Ö&v–â×F÷£'‚–×÷'FçC·FF–æs£G‚–×÷'FçC¶&÷&FW#£‚6öÆ–B6#†6&V–×÷'FçC¶&÷&FW"ÖÆVgC£G‚6öÆ–B3ƒsvc"–×÷'FçC¶&÷&FW"×&F—W3£'‚–×÷'FçC¶&6¶w&÷VæC¢6VVcVfb–×÷'FçGÐ¢ç6fVDf6V&ööµ&–Ö'”7F–öç¶Ö&v–âÖ&÷GFöÓ£‡Òç6fVDf6V&ööµ&–Ö'”7F–öâ'WGFöç¶&÷&FW#£‚6öÆ–B3ƒsvc#¶&÷&FW"×&F—W3£‡ƒ·FF–æs£—‚'ƒ¶&6¶w&÷VæC¢3ƒsvc#¶6öÆ÷#¢6ffc¶föçC¦–æ†W&—C¶föçB×vV–v‡C£ƒ¶7W'6÷#§ö–çFW'Ð¢ç6fVDf6V&öö´G5æVÇ¶&÷&FW"ÖÆVgC£G‚6öÆ–B3ƒsvc#¶&6¶w&÷VæC¢6cvffgÒç6fVDf6V&öö´G5æVÂæ7F—fW¶&÷&FW"Ö6öÆ÷#¢3&c–Sc3¶&6¶w&÷VæC¢6c&f&cgÒæf6V&öö´G46öææV7G¶F—7Æ“¦w&–C¶v£‡Òæf6V&öö´G46öææV7BÂæf6V&ööµ–D6×–vå7VÖÖ'’¶Ö&v–ã£Òæf6V&öö´G46öææV7B'WGFöâÂæf6V&öö´G57F'D'WGFöç¶§W7F–g’×6VÆc§7F'C¶&÷&FW#£‚6öÆ–B3ƒsvc#¶&÷&FW"×&F—W3£‡ƒ·FF–æs£‚7ƒ¶&6¶w&÷VæC¢3ƒsvc#¶6öÆ÷#¢6ffc¶föçC¦–æ†W&—C¶föçB×vV–v‡C£ƒ¶7W'6÷#§ö–çFW'Òæf6V&öö´G4f÷&×¶F—7Æ“¦w&–C¶w&–B×FV×ÆFRÖ6öÇVÖç3§&WVBƒ2ÆÖ–æÖ‚ƒÃg"’“¶v£'‡Òæf6V&öö´G4f÷&ÒÆ&VÇ¶F—7Æ“¦w&–C¶v£Wƒ¶föçB×vV–v‡C£ƒÒæf6V&öö´G4f÷&Ò–çWBÂæf6V&öö´G4f÷&Ò6VÆV7G¶Ö–â×v–GFƒ£Òæf6V&öö´G5v–FW¶w&–BÖ6öÇVÖã§7â'Òæf6V&öö´G57VæEv&æ–æw¶w&–BÖ6öÇVÖã£òÓ¶F—7Æ“¦w&–C¶v£7ƒ·FF–æs£ƒ¶&÷&FW"ÖÆVgC£G‚6öÆ–B6C“–#c¶&÷&FW"×&F—W3£‡ƒ¶&6¶w&÷VæC¢6ffcFCc¶6öÆ÷#¢3fSFCÒæf6V&öö´G57F'D'WGFöç¶w&–BÖ6öÇVÖã£òÓÒæf6V&ööµ–D6×–vå7VÖÖ'—¶F—7Æ“¦w&–C¶v£w‡Ð¢ç6fVDWfVçF–å&Wf–Ww¶Ö&v–ã£‚Gƒ·FF–æs£Gƒ¶&÷&FW#£'‚6öÆ–B3#Sƒƒ–#¶&÷&FW"×&F—W3£'ƒ¶&6¶w&÷VæC¢6VVcvc—Ð¢ç6fVDWfVçF–å&Wf–Wt†VG¶F—7Æ“¦fÆWƒ¶Æ–vâÖ—FV×3¦6VçFW#¶§W7F–g’Ö6öçFVçC§76RÖ&WGvVVã¶v£'ƒ¶Ö&v–âÖ&÷GFöÓ£'‡Ð¢ç6fVDWfVçF–å&Wf–Wt†VB'WGFöç¶&÷&FW#£‚6öÆ–B3#Sƒƒ–#¶&÷&FW"×&F—W3£‡ƒ·FF–æs£w‚ƒ¶&6¶w&÷VæC¢6ffc¶6öÆ÷#¢3sfCvc¶föçC¦–æ†W&—C¶föçB×vV–v‡C£ƒ¶7W'6÷#§ö–çFW'Ð¢ç6fVDWfVçF–å&Wf–Wt&öG—¶F—7Æ“¦w&–C¶w&–B×FV×ÆFRÖ6öÇVÖç3¦Ö–æÖ‚ƒƒ‚Ã#ƒ‚’g#¶v£‡ƒ·FF–æs£Gƒ¶&÷&FW"×&F—W3£ƒ¶&6¶w&÷VæC¢6ffgÐ¢ç6fVDWfVçF–å&Wf–Wt&öG’–Öw·v–GFƒ£S¶†V–v‡C£##ƒ¶&÷&FW"×&F—W3£—ƒ¶ö&¦V7BÖf—C¦6öçF–ã¶&6¶w&÷VæC¢6ccFcgÐ¢ç6fVDWfVçF–å&Wf–Wt&öG’ƒ7¶Ö&v–ã£G‚‡Ð¢ç6fVDWfVçF–å&Wf–Wt&öG’6ÖÆÇ¶F—7Æ“¦&Æö6³¶Ö&v–â×F÷£ƒ¶6öÆ÷#¢3V3s#ƒWÐ¢ÖVF–†Ö‚×v–GFƒ£sc‚—²ç6fVDWfVçF–å&Wf–Wt&öG’Âæf6V&öö´G4f÷&×¶w&–B×FV×ÆFRÖ6öÇVÖç3£g'Òç6fVD6†ææVÅæVÄ†VG¶F—7Æ“¦&Æö6·Òç6fVD6†ææVÅæVÄ†VCç7ç¶F—7Æ“¦–æÆ–æRÖ&Æö6³¶Ö&v–â×F÷£‡‡×Ð¢æf6V&öö´w&÷W6VæFW$7F–öãç7G&öæw¶föçB×6—¦S£G‡Òæf6V&öö´w&÷W6VæFW$7F–öãç6ÖÆÇ¶6öÆ÷#¢3CSƒcgÒæf6V&öö´w&÷W7FGW4w&–G¶F—7Æ“¦w&–C¶w&–B×FV×ÆFRÖ6öÇVÖç3§&WVBƒ"ÆÖ–æÖ‚ƒ##‚Ãg"’“¶v£W‚Gƒ·FF–æs£‡ƒ¶&÷&FW"×&F—W3£wƒ¶&6¶w&÷VæC¢6cVc†fÒæf6V&öö´w&÷W7FGW4w&–B7ç¶föçB×vV–v‡C£SÒæ6ö×ÆWFVDf6V&öö´w&÷W&÷w¶F—7Æ“¦fÆWƒ¶fÆW‚×w&§w&¶Æ–vâÖ—FV×3¦6VçFW#¶§W7F–g’Ö6öçFVçC§76RÖ&WGvVVã¶v£‡ƒ·FF–æs£w‚Ð¢æf6V&öö´w&÷W7F÷$vFW¶F—7Æ“¦w&–C¶w&–B×FV×ÆFRÖ6öÇVÖç3¦Ö–æÖ‚ƒ#C‚Ãg"’WFó¶Æ–vâÖ—FV×3¦6VçFW#¶v£—‚Gƒ¶fÆW‚Ö&6—3£S·FF–æs£ƒ¶&÷&FW#£'‚6öÆ–B63“F#F#¶&÷&FW"×&F—W3£—ƒ¶&6¶w&÷VæC¢6ffccÒæf6V&öö´w&÷W7F÷$vFRæ6öæf—&ÖVG¶&÷&FW"Ö6öÆ÷#¢3#3ƒFc¶&6¶w&÷VæC¢6S–cfVWÒæf6V&öö´w&÷W7F÷$vFSæF—g¶F—7Æ“¦w&–GÒæf6V&öö´w&÷W7F÷$vFR7ç¶6öÆ÷#¢3CSƒcc¶föçB×6—¦S£'‡Òæf6V&öö´w&÷W7F÷$vFSæÂæf6V&öö´w&÷W7F÷$vFSæ'WGFöâÂæf6V&öö´w&÷WÖçVÄÆ–æ·¶F—7Æ“¦–æÆ–æRÖfÆWƒ¶§W7F–g’Ö6öçFVçC¦6VçFW#¶&÷&FW#£‚6öÆ–B3ƒsvc#¶&÷&FW"×&F—W3£‡ƒ·FF–æs£—‚ƒ¶&6¶w&÷VæC¢6ffc¶6öÆ÷#¢3CVF&c¶föçC¦–æ†W&—C¶föçB×vV–v‡C£ƒ·FW‡BÖFV6÷&F–öã¦æöæS¶7W'6÷#§ö–çFW'Òæf6V&öö´w&÷W7F÷$vFSæ'WGFöç¶&6¶w&÷VæC¢3ƒsvc#¶6öÆ÷#¢6ffgÒæf6V&öö´w&÷W7F÷$vFSæ'WGFöã¦F—6&ÆVG¶÷6—G“¢ãSS¶7W'6÷#¦æ÷BÖÆÆ÷vVGÒæf6V&öö´w&÷W7F÷$vFSç¶w&–BÖ6öÇVÖã£òÓ¶Ö&v–ã£¶6öÆ÷#¢3CSƒcc¶föçB×6—¦S£7‡Ð¢ÓÂ÷7G–ÆSà¢Â÷6V7F–öãã°§Ð Ð Ð 