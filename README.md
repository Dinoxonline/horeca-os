# Horeca OS — Next.js App

Werkende Next.js-broncode voor de Horeca OS-productieapp.

## Installatie

```bash
npm install
cp .env.example .env.local
npm run dev
```

## Vereiste environment variables

```text
NEXT_PUBLIC_SUPABASE_URL
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
```

Plaats deze waarden niet in GitHub. Voeg ze toe in Vercel onder:

`Project Settings → Environment Variables`

## Productie

De app is bedoeld om vanuit GitHub automatisch naar Vercel te deployen.

## Beveiliging

- geen openbaar registratieformulier
- Supabase RLS blijft leidend
- publishable key mag in de frontend worden gebruikt
- service-role key mag nooit in deze repository of browsercode komen
