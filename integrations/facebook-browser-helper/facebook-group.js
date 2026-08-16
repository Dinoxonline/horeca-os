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

function activeDialog() {
  const dialogs = [...document.querySelectorAll('div[role="dialog"]')].filter(isVisible);
  return dialogs[dialogs.length - 1] || null;
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
    notice.textContent = "Horeca OS heeft het Facebook-evenement voor deze groep klaargezet. Controleer de groep en druk op Enter om te delen.";
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

function controlLabel(element) {
  return clean(`${element.getAttribute("aria-label") || ""} ${element.getAttribute("placeholder") || ""} ${element.textContent || ""}`);
}

async function fillControl(control, value) {
  const text = String(value || "").trim();
  if (!text) throw new Error("De Facebookgroep heeft geen naam.");
  control.scrollIntoView({ block: "center" });
  control.click();
  control.focus();

  if (control instanceof HTMLInputElement || control instanceof HTMLTextAreaElement) {
    const prototype = control instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    const setter = Object.getOwnPropertyDescriptor(prototype, "value")?.set;
    if (setter) setter.call(control, text);
    else control.value = text;
    control.dispatchEvent(new InputEvent("input", { bubbles: true, composed: true, inputType: "insertText", data: text }));
    control.dispatchEvent(new Event("change", { bubbles: true, composed: true }));
  } else {
    await fillEditor(control, text);
  }
  await sleep(700);
}

function enabledButton(root, pattern) {
  return [...root.querySelectorAll('div[role="button"],button,[role="button"]')].find((element) => (
    pattern.test(clean(element.textContent))
    && element.getAttribute("aria-disabled") !== "true"
    && !element.disabled
    && isVisible(element)
  ));
}

function destinationMatches(root, groupName) {
  const expected = clean(groupName);
  if (!root || !expected) return false;
  const labels = [
    root.innerText,
    root.textContent,
    ...[...root.querySelectorAll("[aria-label],[title]")].flatMap((element) => [
      element.getAttribute("aria-label"),
      element.getAttribute("title"),
    ]),
  ];
  return labels.some((label) => clean(label).includes(expected));
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

function eventIdentifier(url) {
  return String(url || "").match(/\/events\/(\d+)/i)?.[1] || "";
}

async function prepareFromGroupPage(task) {
  if (!/facebook\.com\/groups\//i.test(location.href)) return false;
  if (!destinationMatches(document, task.group?.name)) {
    throw new Error(`De geopende Facebookgroep is niet ${task.group?.name || "de verwachte groep"}. Er is niets geplaatst.`);
  }

  const composerButton = await waitFor(() => findClickable(/^(schrijf iets|write something|maak een openbaar bericht|create a public post)[.…]*$/i), 20000);
  if (!composerButton) throw new Error("De knop om in deze Facebookgroep een bericht te maken kon niet worden gevonden.");
  composerButton.click();

  const composer = await waitFor(() => activeDialog(), 15000);
  if (!composer) throw new Error("Het berichtvenster van deze Facebookgroep kon niet worden geopend.");
  if (!destinationMatches(document, task.group?.name)) {
    throw new Error(`Facebook toont niet de bedoelde groep ${task.group?.name || ""}. Er is niets geplaatst.`);
  }
  if (task.actorName && !destinationMatches(composer, task.actorName)) {
    throw new Error(`Facebook staat niet op de bedrijfsafzender ${task.actorName}. Er is niets geplaatst.`);
  }

  const editor = await waitFor(() => [...composer.querySelectorAll('[contenteditable="true"],[role="textbox"],textarea')].find(isVisible), 15000);
  if (!editor) throw new Error("Het tekstveld van Facebook kon niet worden gevonden.");
  await fillEditor(editor, task.eventUrl);

  const expectedEventId = eventIdentifier(task.eventUrl);
  if (expectedEventId) {
    const preview = await waitFor(() => [...composer.querySelectorAll('a[href*="/events/"]')].find((link) => String(link.href).includes(expectedEventId)), 15000);
    if (!preview) throw new Error("Facebook heeft van de evenementlink geen evenementkaart gemaakt. Er is niets geplaatst.");
  }

  const postButton = await waitFor(() => enabledButton(composer, /^(plaatsen|post)$/i), 15000);
  if (!postButton) throw new Error("De knop Plaatsen is niet beschikbaar.");
  showNotice(`Facebook-evenement staat klaar voor ${task.group?.name}. Controleer de kaart en druk op Enter om te plaatsen.`);
  await waitForApproval();
  postButton.click();
  await sleep(2200);
  return true;
}

async function run(task) {
  await sleep(1200);
  if (await prepareFromGroupPage(task)) return;
  const shareButton = await waitFor(() => findClickable(/^(delen|share)$/i), 20000);
  if (!shareButton) throw new Error("De knop Delen van het Facebook-evenement kon niet worden gevonden.");
  shareButton.click();
  showNotice("Facebook-evenement geopend. Horeca OS controleert het deelvenster.");

  // Facebook opent voor sommige groepen meteen de volledige evenementkaart met
  // een actieve Plaatsen-knop. In die weergave bestaat de extra menu-optie
  // 'Delen in een groep' niet en is de gekozen groep al de bestemming.
  // Facebook rendert de onderste Plaatsen-knop niet altijd binnen het element
  // met role="dialog". Zoek daarom in het hele zichtbare document, maar accepteer
  // uitsluitend de exacte, ingeschakelde Plaatsen/Post-knop.
  const directPostButton = await waitFor(() => enabledButton(document, /^(plaatsen|post)$/i), 10000);
  const directDialog = activeDialog();
  if (directPostButton && destinationMatches(directDialog || document, task.group?.name)) {
    showNotice(`Facebook-evenement staat klaar voor ${task.group?.name}. Controleer de kaart en druk op Enter om te plaatsen.`);
    await waitForApproval();
    directPostButton.click();
    await sleep(2200);
    return;
  }

  if (directPostButton) {
    throw new Error(`Facebook toont nog de vorige groep. Er is niets geplaatst; verwacht werd ${task.group?.name || "de volgende groep"}.`);
  }

  const shareToGroup = await waitFor(() => findClickable(/^(delen in een groep|share to a group)$/i), 15000);
  if (!shareToGroup) throw new Error("De optie Delen in een groep kon niet worden gevonden.");
  shareToGroup.click();

  const chooser = await waitFor(() => activeDialog(), 15000);
  if (!chooser) throw new Error("Het Facebookvenster voor delen in een groep kon niet worden gevonden.");
  const groupSearch = await waitFor(() => [...chooser.querySelectorAll('input,textarea,[contenteditable],[role="textbox"]')].find((element) => (
    isVisible(element) && /(groep|group|zoeken|search)/.test(controlLabel(element))
  )), 15000);
  if (!groupSearch) throw new Error("Het zoekveld voor Facebookgroepen kon niet worden gevonden.");
  await fillControl(groupSearch, task.group?.name || "");

  const groupChoice = await waitFor(() => [...chooser.querySelectorAll('div[role="button"],button,[role="option"]')].find((element) => {
    const name = clean(task.group?.name);
    return name && clean(element.textContent).includes(name) && isVisible(element);
  }), 15000);
  if (!groupChoice) throw new Error(`De groep ${task.group?.name || ""} kon niet in de keuzelijst worden gevonden.`);
  groupChoice.click();

  const confirmationDialog = await waitFor(() => activeDialog(), 15000);
  const postButton = await waitFor(() => confirmationDialog && enabledButton(confirmationDialog, /^(plaatsen|post|delen|share)$/i), 15000);
  if (!postButton) throw new Error("De knop om het Facebook-evenement in deze groep te delen is niet beschikbaar.");
  showNotice(`Facebook-evenement staat klaar voor ${task.group?.name}. Controleer dit en druk op Enter om te plaatsen.`);
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
