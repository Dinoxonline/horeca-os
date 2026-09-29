// Account monetary fields are minor units. Only EUR is supported by this editor.
// Missing values must never become zero, and "balance" is not available ad credit.
function euros(value, currency) {
  if (currency !== "EUR" || value === null || value === undefined || value === "" || typeof value === "boolean") return null;
  const number = Number(value);
  return Number.isSafeInteger(number) && number >= 0 ? number / 100 : null;
}

export function normalizeMetaAccountBudget(account, payment = {}, accountId, now = new Date()) {
  const currency = typeof account.currency === "string" ? account.currency : null;
  const limit = euros(account.spend_cap, currency);
  const spent = euros(account.amount_spent, currency);
  const hasLimit = limit === null ? null : limit > 0;
  const prepaid = typeof account.is_prepay_account === "boolean" ? account.is_prepay_account : null;
  // Never expose funding-source IDs, bank/card numbers, addresses or tax IDs.
  const display = typeof payment.funding_source_details?.display_string === "string"
    ? payment.funding_source_details.display_string.replace(/[\w.+-]+@[\w.-]+/g, "•••").replace(/(?:\d[ -]?){5,}/g, "••••").slice(0, 120) : null;
  const id = String(accountId || "").replace(/^act_/, "");
  return {
    accountId: id, name: typeof account.name === "string" ? account.name : null,
    currency, status: account.account_status == null ? null : Number(account.account_status),
    timezone: typeof account.timezone_name === "string" ? account.timezone_name : null,
    hasLimit, limit, spent, remaining: hasLimit && spent !== null ? Math.max(0, limit - spent) : null,
    prepaid, outstanding: prepaid === false ? euros(account.balance, currency) : null,
    paymentMethod: display || null, billingName: typeof payment.business_name === "string" ? payment.business_name.slice(0, 160) : null,
    checkedAt: now.toISOString(),
    billingUrl: /^\d+$/.test(id) ? "https://www.facebook.com/ads/manager/billing/?act=" + id : null,
  };
}
