-- A manual-first promotion checklist. It creates tasks only; it never publishes to a channel.
do $$
declare
  workspace_row record;
  checklist_template_id uuid;
begin
  for workspace_row in select id from public.workspaces loop
    insert into public.process_templates (
      workspace_id,
      template_key,
      name,
      description,
      category,
      active,
      can_be_added_as_module
    )
    values (
      workspace_row.id,
      'event_promotion',
      'Evenement promotiechecklist',
      'Alle handmatige promotietaken voor een evenement, van aanmelden tot nazorg.',
      'marketing',
      true,
      true
    )
    on conflict (workspace_id, template_key) do update set
      name = excluded.name,
      description = excluded.description,
      category = excluded.category,
      active = true,
      can_be_added_as_module = true
    returning id into checklist_template_id;

    if not exists (
      select 1
      from public.process_template_steps
      where template_id = checklist_template_id
    ) then
      insert into public.process_template_steps (
        workspace_id,
        template_id,
        title,
        description,
        relative_days,
        priority,
        role_key,
        sort_order
      )
      values
        (workspace_row.id, checklist_template_id, 'Evenementgegevens en promotieplan vastleggen', 'Leg datum, tijden, locatie, doelgroep, reserveringslink, budget en de gekozen promotiekanalen vast.', -42, 'high', 'manager', 0),
        (workspace_row.id, checklist_template_id, 'Website en evenement publiceren', 'Maak of controleer de evenementpagina op de eigen website. Gebruik overal dezelfde datum, tijden, prijs, beeld en reserveringslink.', -35, 'high', 'marketing', 1),
        (workspace_row.id, checklist_template_id, 'Ontwerp, tekst en video verzamelen', 'Zet de definitieve flyer, caption, foto''s en eventuele artiestenvideo klaar. Controleer artiestnaam, datum en alle praktische informatie.', -30, 'high', 'marketing', 2),
        (workspace_row.id, checklist_template_id, 'Uitagenda Zoetermeer aanmelden', 'Meld het evenement handmatig aan via https://www.uitagendazoetermeer.nl/uitje-aanmelden en bewaar de bevestiging als bewijslink.', -28, 'medium', 'marketing', 3),
        (workspace_row.id, checklist_template_id, 'DJ Guide aanmelden', 'Meld het evenement handmatig aan via https://www.djguide.nl/partytoevoegen.p en bewaar de bevestiging als bewijslink.', -28, 'medium', 'marketing', 4),
        (workspace_row.id, checklist_template_id, 'Uitagenda.nl aanmelden', 'Meld het evenement handmatig aan via https://www.uitagenda.nl/ en bewaar de bevestiging als bewijslink.', -28, 'medium', 'marketing', 5),
        (workspace_row.id, checklist_template_id, 'Salsa.nl vermelding aanmelden', 'Plaats de gratis vermelding handmatig via https://www.salsa.nl/b2b/gratis-vermelding.php-vermelding.php en bewaar de bevestiging als bewijslink.', -28, 'medium', 'marketing', 6),
        (workspace_row.id, checklist_template_id, 'Latinworld aanmelden', 'Controleer de mogelijkheden en meld handmatig aan via http://www.latinworld.nl/. Bewaar de bevestiging als bewijslink.', -28, 'medium', 'marketing', 7),
        (workspace_row.id, checklist_template_id, 'Artist Guide en lokale agenda''s aanmelden', 'Meld het evenement aan bij Artist Guide en andere relevante lokale agenda''s. Noteer per kanaal de status in de taaknotitie.', -28, 'medium', 'marketing', 8),
        (workspace_row.id, checklist_template_id, 'Lokale kranten en gemeente benaderen', 'Stuur de evenementinformatie naar plaatselijke kranten en regel een eventuele gemeentemelding. Noteer contactpersoon en vervolgactie.', -25, 'medium', 'manager', 9),
        (workspace_row.id, checklist_template_id, 'Relevante websites zoeken en aanmelden', 'Zoek via Google naar passende uitagenda''s, muziek- en horecakanalen. Voeg alleen kanalen toe die bij dit evenement passen.', -25, 'low', 'marketing', 10),
        (workspace_row.id, checklist_template_id, 'Facebook-evenement en post voorbereiden', 'Maak het Facebook-evenement en de post handmatig. Tag artiesten, muzikanten en organisatoren; maak medeorganisatoren waar passend.', -21, 'high', 'marketing', 11),
        (workspace_row.id, checklist_template_id, 'Instagram-post en reel voorbereiden', 'Zet de Instagram-post of reel handmatig klaar. Tag artiesten, muzikanten en organisatoren en controleer de caption en hashtags.', -21, 'high', 'marketing', 12),
        (workspace_row.id, checklist_template_id, 'TikTok voorbereiden', 'Maak een passende TikTok of korte video. Controleer dat datum, locatie en call-to-action duidelijk zijn.', -21, 'medium', 'marketing', 13),
        (workspace_row.id, checklist_template_id, 'WhatsApp-groepen klaarzetten', 'Maak een bericht voor de eigen evenementengroep en voor externe groepen. Verstuur pas na een laatste controle van datum, link en beeld.', -18, 'high', 'marketing', 14),
        (workspace_row.id, checklist_template_id, 'Mailing of nieuwsbrief versturen', 'Maak en verstuur de mailing. Test alle links, doelgroep en afzender vooraf en noteer de verzenddatum.', -14, 'high', 'marketing', 15),
        (workspace_row.id, checklist_template_id, 'Artiestenvideo regelen', 'Vraag artiesten om een korte promotievideo, ontvang het bestand en plan de plaatsing.', -14, 'medium', 'marketing', 16),
        (workspace_row.id, checklist_template_id, 'Ontwerp klaarzetten in Predis', 'Gebruik Predis alleen handmatig voor de definitieve creatieve uitwerking. Houd origineel beeld en caption ongewijzigd wanneer dat nodig is; geen automatische publicatie.', -14, 'medium', 'marketing', 17),
        (workspace_row.id, checklist_template_id, 'Meta-planning controleren', 'Plan of controleer Facebook en Instagram handmatig in Meta. Controleer datum, tijd, tags, publiek en de juiste vestiging.', -10, 'high', 'marketing', 18),
        (workspace_row.id, checklist_template_id, 'Betaalde promotie bepalen en instellen', 'Bepaal budget, doelgroep, looptijd en doel. Stel betaalde promotie alleen na goedkeuring handmatig in.', -10, 'high', 'manager', 19),
        (workspace_row.id, checklist_template_id, 'Reserveringen, tickets en Social Deal voorbereiden', 'Pas reserveringstijden en tafels aan, regel ticketing en bepaal of een Social Deal-actie aan of uit moet staan.', -7, 'critical', 'manager', 20),
        (workspace_row.id, checklist_template_id, 'ZFM, televisies en popup-site plaatsen', 'Zet promotie klaar voor ZFM, schermen in de restaurants en de popup-website waar dit relevant is.', -7, 'medium', 'marketing', 21),
        (workspace_row.id, checklist_template_id, 'Winactie en gratis tickets regelen', 'Bepaal de actievoorwaarden, prijs, winnaarscommunicatie en eventuele gratis tickets.', -7, 'medium', 'marketing', 22),
        (workspace_row.id, checklist_template_id, 'Video- en contentplanning bijwerken', 'Plan de benodigde content rondom dit evenement in de maandplanning, met als richtlijn vijf video''s per maand.', -7, 'low', 'marketing', 23),
        (workspace_row.id, checklist_template_id, 'Laatste publicatiecontrole', 'Controleer alle kanalen op juiste datum, tijd, locatie, prijs, artiestentags, reserveringslink en zichtbaarheid.', -2, 'critical', 'manager', 24),
        (workspace_row.id, checklist_template_id, 'Evenement uitvoeren en zichtbaarheid bewaken', 'Controleer tijdens het evenement de zichtbaarheid, tags en praktische communicatie. Leg bruikbaar beeldmateriaal vast.', 0, 'high', 'team', 25),
        (workspace_row.id, checklist_template_id, 'Foto''s en video''s na afloop plaatsen', 'Selecteer en publiceer foto''s en video''s na het evenement. Vraag zo nodig toestemming aan artiesten en aanwezigen.', 1, 'high', 'marketing', 26),
        (workspace_row.id, checklist_template_id, 'Resultaat en vervolgactie evalueren', 'Evalueer bereik, reserveringen, kaartverkoop, omzet, kosten en verbeterpunten. Leg een concrete vervolgactie vast.', 7, 'medium', 'manager', 27);
    end if;
  end loop;
end $$;
