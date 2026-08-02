# Databasemodel

## Organisatie

- `workspaces`
- `workspace_members`
- `profiles`
- `businesses`
- `business_locations`
- `roles`
- `role_permissions`
- `user_role_assignments`

## Management

- `tasks`
- `decisions`
- `events`
- `integrations`

## Inkoop en keuken

- `suppliers`
- `products`
- `recipes`
- `recipe_items`
- `ingredients`
- `menu_items`

## Verkoop

- `sales_daily`
- `product_sales`

## Klantbeleving

- `reviews`
- `review_response_drafts`

## Social Intelligence

- `integration_accounts`
- `integration_sync_jobs`
- `integration_event_receipts`
- `social_content_items`
- `social_conversations`
- `social_messages`

## Beveiliging

- `audit_log`
- `backup_snapshots`
- `security_checks`
- `owner_invites`

## Belangrijkste relaties

- iedere bedrijfseenheid hoort bij één workspace
- iedere fysieke vestiging hoort bij één bedrijf en workspace
- iedere rol hoort bij één workspace
- roltoewijzingen kunnen workspacebreed of per bedrijf/vestiging gelden
- `workspace_members.role` blijft bestaan voor achterwaartse compatibiliteit
- ieder product hoort bij één workspace en eventueel één leverancier
- ieder recept hoort bij één workspace en bevat meerdere recipe_items
- iedere recipe_item verwijst naar één product
- iedere verkoopregel hoort bij een workspace en eventueel een bedrijf
- ieder extern account hoort bij een workspace en eventueel een bedrijf/vestiging
- ieder geïmporteerd providerobject heeft een unieke externe sleutel voor idempotentie
- reviewreacties vereisen menselijke goedkeuring voordat publicatie is toegestaan
