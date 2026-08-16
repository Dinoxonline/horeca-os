const STORAGE_KEY = "horecaOsActiveFacebookGroupRound";
const ALARM_NAME = "horecaOsNextFacebookGroup";

async function readRound() {
  return (await chrome.storage.local.get(STORAGE_KEY))[STORAGE_KEY] || null;
}

async function writeRound(round) {
  await chrome.storage.local.set({ [STORAGE_KEY]: round });
}

async function notify(round, extra = {}) {
  const payload = { campaignId: round.campaignId, completed: round.completed, failed: round.failed, total: round.groups.length, ...extra };
  if (round.horecaTabId) await chrome.tabs.sendMessage(round.horecaTabId, { type: "GROUP_ROUND_PROGRESS", payload }).catch(() => {});
}

async function openNext() {
  const round = await readRound();
  if (!round || round.status === "paused") return;
  const next = round.groups.find((group) => !round.completed.includes(String(group.id)) && !round.failed.some((item) => String(item.id) === String(group.id)));
  if (!next) {
    round.status = "complete";
    await writeRound(round);
    await notify(round, { status: "complete" });
    return;
  }
  const tab = await chrome.tabs.create({ url: round.eventUrl, active: true });
  round.activeTabId = tab.id;
  round.activeGroupId = String(next.id);
  round.status = "opening";
  await writeRound(round);
  await notify(round, { status: "opening", group: next });
}

async function scheduleNext(round) {
  const minimum = Math.max(0, Number(round.delayMin) || 0);
  const maximum = Math.max(minimum, Number(round.delayMax) || minimum);
  const delayMinutes = Math.floor(Math.random() * (maximum - minimum + 1)) + minimum;
  round.status = "waiting";
  round.nextAt = Date.now() + delayMinutes * 60_000;
  await writeRound(round);
  await chrome.alarms.create(ALARM_NAME, { when: round.nextAt });
  await notify(round, { status: "waiting", delayMinutes, nextAt: round.nextAt });
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type === "START_GROUP_ROUND") {
    const payload = message.payload || {};
    if (!payload.campaignId || !payload.actorName || !payload.eventUrl || !Array.isArray(payload.groups) || payload.groups.length === 0) {
      sendResponse({ ok: false, error: "De ronde bevat geen geldige groepen of afzender." });
      return;
    }
    const round = { ...payload, horecaTabId: sender.tab?.id, groups: payload.groups.slice(0, 10), completed: [], failed: [], status: "starting", createdAt: Date.now() };
    writeRound(round).then(openNext);
    sendResponse({ ok: true, total: round.groups.length });
    return;
  }
  if (message?.type === "FACEBOOK_GROUP_READY") {
    readRound().then((round) => {
      if (!round || sender.tab?.id !== round.activeTabId) return sendResponse({ ok: false });
      const group = round.groups.find((item) => String(item.id) === String(round.activeGroupId));
      sendResponse({ ok: true, task: { group, actorName: round.actorName, eventUrl: round.eventUrl } });
    });
    return true;
  }
  if (message?.type === "FACEBOOK_GROUP_RESULT") {
    readRound().then(async (round) => {
      if (!round || sender.tab?.id !== round.activeTabId) return;
      const result = message.payload || {};
      if (result.ok) round.completed = Array.from(new Set([...round.completed, String(round.activeGroupId)]));
      else round.failed.push({ id: String(round.activeGroupId), error: result.error || "Plaatsing niet bevestigd" });
      await notify(round, { status: result.ok ? "submitted" : "failed", groupId: round.activeGroupId, error: result.error });
      if (result.ok && sender.tab?.id) await chrome.tabs.remove(sender.tab.id).catch(() => {});
      round.activeTabId = null;
      round.activeGroupId = null;
      const remaining = round.groups.length - round.completed.length - round.failed.length;
      if (remaining > 0) await scheduleNext(round);
      else {
        round.status = "complete";
        await writeRound(round);
        await notify(round, { status: "complete" });
      }
    });
  }
});

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === ALARM_NAME) openNext();
});
