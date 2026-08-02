# Incidentrespons

## Bij vermoeden van ongeoorloofde toegang

1. blokkeer het betreffende gebruikersaccount
2. roteer betrokken API-sleutels
3. controleer Supabase Auth Logs
4. controleer audit_log
5. controleer Vercel runtime logs
6. bepaal welke gegevens zijn bekeken of gewijzigd
7. herstel gegevens uit een betrouwbare back-up
8. documenteer oorzaak, impact en maatregelen

## Bij verkeerd verwijderde data

1. stop verdere wijzigingen
2. bepaal laatste correcte snapshot
3. herstel eerst in een testomgeving
4. controleer relaties en totalen
5. herstel pas daarna productie
