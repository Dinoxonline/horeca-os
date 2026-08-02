# Databasemodel

## Organisatie

- `workspaces`
- `workspace_members`
- `profiles`
- `businesses`

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

## Verkoop

- `sales_daily`
- `product_sales`

## Klantbeleving

- `reviews`

## Beveiliging

- `audit_log`
- `backup_snapshots`
- `security_checks`
- `owner_invites`

## Belangrijkste relaties

- iedere bedrijfseenheid hoort bij één workspace
- ieder product hoort bij één workspace en eventueel één leverancier
- ieder recept hoort bij één workspace en bevat meerdere recipe_items
- iedere recipe_item verwijst naar één product
- iedere verkoopregel hoort bij een workspace en eventueel een bedrijf
