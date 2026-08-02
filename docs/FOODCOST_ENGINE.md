# Foodcost Engine & Recepturen

Sprint 3 extends the existing purchasing and recipe tables without replacing or deleting data.

## Cost chain

`supplier -> product -> ingredient -> recipe item -> recipe -> menu item`

- A supplier, product, recipe, ingredient and menu item is scoped to a workspace and optionally a business/location.
- A product stores the purchase package, content quantity, purchase price and currency.
- An ingredient normalizes one purchased product to a recipe base unit and usable yield.
- A recipe item is the costed quantity of a product/ingredient in a recipe, including waste.
- A menu item links a sellable price and VAT rate to one recipe.

## Costing rules

The database stores cost inputs, not cached totals. Application queries calculate current costs from the latest product purchase price so price changes cannot leave stale recipe totals behind.

```text
usable units per product = units_per_product * (yield_percentage / 100)
ingredient unit cost     = purchase_price / usable units per product
recipe line cost         = quantity * ingredient unit cost / (1 - waste_percentage / 100)
recipe cost              = sum(recipe line cost)
foodcost percentage      = recipe cost / menu selling price * 100
```

Unit conversion is intentionally explicit. Sprint 3 does not infer conversions, import invoices, call suppliers or connect to a POS.

## Authorization and audit

- `foodcost:read`: owner, manager, kitchen manager and accountant.
- `foodcost:manage`: owner, manager and kitchen manager.
- RLS uses the existing workspace/business/location-aware permission helper.
- All managed Sprint 3 entities are covered by the existing or newly added audit triggers.

