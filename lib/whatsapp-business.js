export function whatsappConfiguration(env, origin) {
  const required = ["META_APP_ID", "META_APP_SECRET", "META_TOKEN_ENCRYPTION_KEY", "WHATSAPP_CONFIG_ID", "WHATSAPP_VERIFY_TOKEN"];
  const missing = required.filter(name => !env[name]);
  return {
    ready: missing.length === 0, missing,
    webhookUrl: `${origin}/api/integrations/whatsapp/webhook`,
    embeddedSignup: {
      ready: missing.length === 0, missing,
      appId: env.META_APP_ID || null, configId: env.WHATSAPP_CONFIG_ID || null,
      featureType: "whatsapp_business_app_onboarding", sessionInfoVersion: "3",
    },
  };
}

export function canManageWhatsapp(assignments, businessId = null) {
  return (assignments || []).some(assignment => {
    if (assignment.location_id || (assignment.business_id && assignment.business_id !== businessId)) return false;
    const permissions = assignment.role?.role_key === "custom"
      ? assignment.assignment_permissions?.map(entry => entry.permission) || []
      : assignment.role?.role_permissions?.map(entry => entry.permission) || [];
    return assignment.role?.role_key === "owner" || permissions.includes("social:manage");
  });
}

export function parseWhatsappSignupEvent(event) {
  if (!["https://www.facebook.com", "https://web.facebook.com"].includes(event.origin)) return null;
  let payload;
  try { payload = typeof event.data === "string" ? JSON.parse(event.data) : event.data; } catch { return null; }
  if (payload?.type !== "WA_EMBEDDED_SIGNUP") return null;
  if (["CANCEL", "ERROR"].includes(payload.event)) return { cancelled: true };
  // Never silently accept migration/new-number onboarding in the coexistence flow.
  if (payload.event !== "FINISH_WHATSAPP_BUSINESS_APP_ONBOARDING") return null;
  const wabaId = String(payload.data?.waba_id || "");
  const phoneNumberId = String(payload.data?.phone_number_id || "");
  if (!/^\d+$/.test(wabaId) || (phoneNumberId && !/^\d+$/.test(phoneNumberId))) return null;
  return { wabaId, phoneNumberId };
}

export function whatsappReplyWindow(publishedAt, now = Date.now()) {
  const timestamp = new Date(publishedAt || "").getTime();
  return Number.isFinite(timestamp) && timestamp <= now && now - timestamp < 24 * 60 * 60 * 1000;
}
