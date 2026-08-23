update public.process_template_steps
set description = case title
  when 'Doel, doelgroep en budget bepalen' then 'Leg vast voor wie dit bedoeld is, wat het doel is en welk budget beschikbaar is.'
  when 'Flyer en beeldmateriaal maken' then 'Maak de flyer in het juiste formaat, controleer logo, datum, prijs, locatie en call-to-action.'
  when 'Nieuwsbrief en social posts voorbereiden' then 'Maak teksten en beelden per kanaal. Controleer links, planning en tone of voice.'
  when 'Recept en proefbereiding vastleggen' then 'Leg ingrediënten, hoeveelheden, bereidingswijze, portie en presentatie vast en doe een proefbereiding.'
  when 'Kostprijs, verkoopprijs en marge controleren' then 'Controleer actuele inkoopprijzen, portiekosten, btw, verkoopprijs en brutomarge.'
  when 'Allergenen en werkinstructie vastleggen' then 'Leg allergenen, kruisbesmetting, bewaartijd, mise-en-place en uitgifte stap voor stap vast.'
  when 'Tekst, beeld en call-to-action maken' then 'Schrijf een duidelijke boodschap met één actie. Controleer beeldkwaliteit en alle links.'
  when 'Links, doelgroep en afzender controleren' then 'Test alle links, controleer doelgroep en afzendernaam en stuur eerst een test naar de verantwoordelijke.'
  when 'Personeel, voorraad en draaiboek controleren' then 'Controleer bezetting, bestellingen, voorraad, timing, verantwoordelijkheden en noodscenario.'
  when 'Medewerkers briefen' then 'Bespreek doel, planning, taakverdeling, gastbenadering, bijzonderheden en wie eindverantwoordelijk is.'
  when 'Website en evenement aanmaken' then 'Maak het evenement aan met juiste titel, datum, tijden, prijs, locatie, reserveringsinformatie en foto.'
  when 'Website, nieuwsbrief en socials voorbereiden' then 'Controleer dat alle kanalen dezelfde naam, datum, prijs, link en beeld gebruiken.'
  when 'Reserveringen en bijzonderheden controleren' then 'Bekijk reserveringen, groepen, dieetwensen, verjaardagen, arrangementen en bijzonderheden van vandaag.'
  when 'Voorraad, mise-en-place en apparatuur controleren' then 'Controleer kritieke voorraad, voorbereidingen, temperaturen, apparatuur en meld ontbrekende zaken direct.'
  when 'Zaal, sanitair en entree controleren' then 'Loop de gastreis na: entree, tafels, verlichting, muziek, toiletten, temperatuur en netheid.'
  when 'Kassa, POS en dagbriefing klaarzetten' then 'Controleer kassa, menu-items, prijzen, betaalmiddelen, reserveringssysteem en briefing voor het team.'
  when 'Omzet, marge en opvallende cijfers bekijken' then 'Bekijk omzet, gemiddelde besteding, marge, drukke momenten en afwijkingen ten opzichte van de vorige week.'
  when 'Actiepunten verdelen en opvolgdatum bepalen' then 'Maak van ieder actiepunt een concrete taak met eigenaar, deadline en duidelijke definitie van gereed.'
  when 'Kostprijzen, marges en prijswijzigingen controleren' then 'Gebruik actuele leveranciersprijzen en controleer of marges en verkoopprijzen nog kloppen.'
  when 'Gastfeedback en teamfeedback verzamelen' then 'Verzamel terugkerende opmerkingen en vertaal ze naar concrete verbeterpunten of besluiten.'
  else description
end
where description is null
  and title in (
    'Doel, doelgroep en budget bepalen',
    'Flyer en beeldmateriaal maken',
    'Nieuwsbrief en social posts voorbereiden',
    'Recept en proefbereiding vastleggen',
    'Kostprijs, verkoopprijs en marge controleren',
    'Allergenen en werkinstructie vastleggen',
    'Tekst, beeld en call-to-action maken',
    'Links, doelgroep en afzender controleren',
    'Personeel, voorraad en draaiboek controleren',
    'Medewerkers briefen',
    'Website en evenement aanmaken',
    'Website, nieuwsbrief en socials voorbereiden',
    'Reserveringen en bijzonderheden controleren',
    'Voorraad, mise-en-place en apparatuur controleren',
    'Zaal, sanitair en entree controleren',
    'Kassa, POS en dagbriefing klaarzetten',
    'Omzet, marge en opvallende cijfers bekijken',
    'Actiepunten verdelen en opvolgdatum bepalen',
    'Kostprijzen, marges en prijswijzigingen controleren',
    'Gastfeedback en teamfeedback verzamelen'
  );
