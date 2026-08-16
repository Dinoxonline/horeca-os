const sleep = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));
const clean = (value) => String(value || "").toLocaleLowerCase("nl-NL").replace(/\s+/g, " ").trim();

function findClickable(pattern) {
  return [...document.querySelectorAll('div[role="button"],button,[role="button"]')].find((element) => pattern.test(clean(element.textContent)) && element.offsetParent !== null);
}

function isVisible(element) {
  if (!element || element.getClientRects().length === 0) return false;
  const style = window.getComputedStyle(element);
  return style.visibility !== "hidden" && style.display !== "none" && Number(style.opacity || 1) > 0;
}

function visibleDialog() {
  return [...document.querySelectorAll('div[role="dialog"]')].filter(isVisible).at(-1) || null;
}

function visibleEditor(dialog) {
  const selectors = [
    '[data-lexical-editor="true"][contenteditable="true"]',
    '[contenteditable="true"][role="textbox"]',
    '[contenteditable="true"][aria-label]',
    'div[contenteditable="true"]',
  ];
  return selectors.flatMap((selector) => [...dialog.querySelectorAll(selector)]).find(isVisible) || null;
}

function actorIsVisible(actorName) {
  const expected = clean(actorName);
  return [...document.querySelectorAll("img[alt],[aria-label]")].some((element) => clean(element.getAttribute("alt") || element.getAttribute("aria-label")).includes(expected));
}

async function waitFor(getter, timeout = 15000) {
  const started = Date.now();
  while (Date.now() - started < timeout) {
    const value = getter();
    if (value) return value;
    await sleep(350);
  }
  return null;
}

function waitForApproval() {
  return new Promise((resolve) => {
    const notice = document.createElement("div");
    notice.id = "horeca-os-facebook-approval";
    notice.textContent = "Horeca OS heeft het bericht voorbereid. Controleer het en druk op Enter om te plaatsen.";
    Object.assign(notice.style, { position: "fixed", zIndex: "2147483647", left: "50%", bottom: "24px", transform: "translateX(-50%)", maxWidth: "680px", padding: "14px 18px", border: "3px solid #16869a", borderRadius: "12px", background: "#fff", color: "#073657", font: "700 16px Arial, sans-serif", boxShadow: "0 8px 30px rgba(0,0,0,.28)", textAlign: "center" });
    document.body.appendChild(notice);
    const approve = (event) => {
      if (event.key !== "Enter" || event.shiftKey || event.ctrlKey || event.altKey || event.metaKey) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      window.removeEventListener("keydown", approve, true);
      notice.remove();
      resolve();
    };
    window.addEventListener("keydown", approve, true);
  });
}

function showNotice(message, error = false) {
  document.getElementById("horeca-os-facebook-notice")?.remove();
  const notice = document.createElement("div");
  notice.id = "horeca-os-facebook-notice";
  notice.textContent = message;
  Object.assign(notice.style, {
    position: "fixed",
    zIndex: "2147483647",
    left: "50%",
    bottom: "24px",
    transform: "translateX(-50%)",
    maxWidth: "760px",
    padding: "14px 18px",
    border: `3px solid ${error ? "#b42318" : "#16869a"}`,
    borderRadius: "12px",
    background: "#fff",
    color: error ? "#7a271a" : "#073657",
    font: "700 16px Arial, sans-serif",
    boxShadow: "0 8px 30px rgba(0,0,0,.28)",
    textAlign: "center",
  });
  document.body.appendChild(notice);
}

function editorContains(editor, message) {
  const expected = clean(message).slice(0, 40);
  return Boolean(expected && clean(editor.innerText || editor.textContent).includes(expected));
}

async function fillEditor(editor, message) {
  if (!String(message || "").trim()) throw new Error("Horeca OS heeft geen berichttekst meegestuurd.");
  editor.scrollIntoView({ block: "center" });
  editor.click();
  editor.focus();

  const selection = window.getSelection();
  const range = document.createRange();
  range.selectNodeContents(editor);
  range.collapse(false);
  selection.removeAllRanges();
  selection.addRange(range);

  document.execCommand("insertText", false, message);
  editor.dispatchEvent(new InputEvent("input", { bubbles: true, composed: true, inputType: "insertText", data: message }));
  await sleep(500);
  if (editorContains(editor, message)) return;

  const clipboardData = new DataTransfer();
  clipboardData.setData("text/plain", message);
  editor.dispatchEvent(new ClipboardEvent("paste", { bubbles: true, cancelable: true, composed: true, clipboardData }));
  await sleep(500);
  if (editorContains(editor, message)) return;

  editor.replaceChildren(document.createTextNode(message));
  editor.dispatchEvent(new InputEvent("beforeinput", { bubbles: true, composed: true, inputType: "insertText", data: message }));
  editor.dispatchEvent(new InputEvent("input", { bubbles: true, composed: true, inputType: "insertText", data: message }));
  editor.dispatchEvent(new Event("change", { bubbles: true, composed: true }));
  await sleep(700);
  if (!editorContains(editor, message)) throw new Error("Facebook weigerde de berichttekst automatisch in te vullen.");
}

async function attachImage(imageUrl, dialog) {
  if (!imageUrl) return;
  const input = dialog.querySelector('input[type="file"]');
  if (!input) return;
  const response = await fetch(imageUrl);
  const blob = await response.blob();
  const file = new File([blob], "horeca-os-campagne.jpg", { type: blob.type || "image/jpeg" });
  const transfer = new DataTransfer();
  transfer.items.add(file);
  input.files = transfer.files;
  input.dispatchEvent(new Event("change", { bubbles: true }));
  await sleep(1200);
}

async function run(task) {
  await sleep(1200);
  if (!actorIsVisible(task.actorName)) throw new Error(`Facebook toont ${task.actorName} niet als actieve afzender. De ronde is voor deze groep gestopt.`);
  const composer = await waitFor(() => findClickable(/^(schrijf iets|write something|maak een openbaar bericht|create a public post)/i));
  if (!composer) throw new Error("Het Facebook-berichtvenster kon niet worden geopend. Controleer het lidmaatschap en de groepsregels.");
  composer.click();
  showNotice("Facebook-bericht geopend. Horeca OS vult nu de tekst in.");
  const dialog = await waitFor(visibleDialog);
  if (!dialog) throw new Error("Facebook opende geen berichtvenster.");
  const editor = await waitFor(() => visibleEditor(dialog));
  if (!editor) throw new Error("Het tekstveld van Facebook kon niet worden gevonden.");
  await fillEditor(editor, task.message || "");
  showNotice("Tekst ingevuld. Horeca OS voegt nu de afbeelding toe.");
  await attachImage(task.imageUrl, dialog);
  const postButton = await waitFor(() => [...dialog.querySelectorAll('div[role="button"],button')].find((element) => /^(plaatsen|post)$/i.test(clean(element.textContent)) && element.getAttribute("aria-disabled") !== "true" && !element.disabled));
  if (!postButton) throw new Error("De Facebook-knop Plaatsen is niet beschikbaar. Controleer verplichte velden of groepsregels.");
  showNotice("Bericht is ingevuld. Controleer het en druk op Enter om te plaatsen.");
  await waitForApproval();
  postButton.click();
  await sleep(2200);
}

chrome.runtime.sendMessage({ type: "FACEBOOK_GROUP_READY" }, async (response) => {
  if (!response?.ok || !response.task) return;
  try {
    await run(response.task);
    chrome.runtime.sendMessage({ type: "FACEBOOK_GROUP_RESULT", payload: { ok: true } });
  } catch (error) {
    showNotice(`Niet ingevuld: ${error.message}`, true);
    chrome.runtime.sendMessage({ type: "FACEBOOK_GROUP_RESULT", payload: { ok: false, error: error.message } });
  }
});
