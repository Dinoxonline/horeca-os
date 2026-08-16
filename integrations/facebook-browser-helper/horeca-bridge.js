const PAGE_SOURCE = "horeca-os";
const HELPER_SOURCE = "horeca-os-facebook-helper";

window.postMessage({ source: HELPER_SOURCE, type: "READY" }, window.location.origin);

window.addEventListener("message", (event) => {
  if (event.source !== window || event.origin !== window.location.origin) return;
  if (event.data?.source === PAGE_SOURCE && event.data?.type === "HELPER_PING") {
    window.postMessage({ source: HELPER_SOURCE, type: "READY" }, window.location.origin);
    return;
  }
  if (event.data?.source !== PAGE_SOURCE || event.data?.type !== "START_GROUP_ROUND") return;
  chrome.runtime.sendMessage({ type: "START_GROUP_ROUND", payload: event.data.payload }, (response) => {
    window.postMessage({ source: HELPER_SOURCE, type: "START_RESULT", payload: response || { ok: false, error: chrome.runtime.lastError?.message } }, window.location.origin);
  });
});

chrome.runtime.onMessage.addListener((message) => {
  if (message?.type !== "GROUP_ROUND_PROGRESS") return;
  window.postMessage({ source: HELPER_SOURCE, type: "GROUP_ROUND_PROGRESS", payload: message.payload }, window.location.origin);
});
