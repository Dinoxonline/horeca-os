const sleep = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));
const clean = (value) => String(value || "")
  .toLocaleLowerCase("nl-NL")
  .replace(/[“”"']/g, "")
  .replace(/\s+/g, " ")
  .trim();

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

function label(element) {
  const nestedLabels = element?.querySelectorAll
    ? [...element.querySelectorAll('[aria-label],[title],[alt]')]
      .flatMap((node) => [
        node.getAttribute("aria-label"),
        node.getAttribute("title"),
        node.getAttribute("alt"),
      ])
    : [];
  return clean([
    element?.getAttribute?.("aria-label"),
    element?.getAttribute?.("placeholder"),
    element?.getAttribute?.("title"),
    element?.getAttribute?.("data-tooltip-content"),
    ...nestedLabels,
    element?.textContent,
  ].filter(Boolean).join(" "));
}

function clickables(root = document) {
  return [...root.querySelectorAll('button,[role="button"],[role="option"],a')].filter(isVisible);
}

function findClickable(pattern, root = document) {
  return clickables(root).find((element) => pattern.test(label(element)));
}

function enabledButton(root, pattern) {
  return clickables(root).find((element) => (
    pattern.test(label(element))
    && element.getAttribute("aria-disabled") !== "true"
    && !element.disabled
  ));
}

function showNotice(message, error = false) {
  document.getElementById("horeca-os-facebook-notice")?.remove();
  const notice = document.createElement("div");
  notice.id = "horeca-os-facebook-notice";
  notice.textContent = message;
  Object.assign(notice.style, {
    position: "fixed", zIndex: "2147483647", left: "50%", bottom: "24px",
    transform: "translateX(-50%)", maxWidth: "760px", padding: "14px 18px",
    border: `3px solid ${error ? "#b42318" : "#16869a"}`, borderRadius: "12px",
    background: "#fff", color: error ? "#7a271a" : "#073657",
    font: "700 16px Arial, sans-serif", boxShadow: "0 8px 30px rgba(0,0,0,.28)", textAlign: "center",
  });
  document.body.appendChild(notice);
}

function waitForApproval() {
  return new Promise((resolve) => {
    showNotice("Het Facebook-evenement staat klaar. Controleer de groep en druk op Enter om te plaatsen.");
    const approve = (event) => {
      if (event.key !== "Enter" || event.shiftKey || event.ctrlKey || event.altKey || event.metaKey) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      window.removeEventListener("keydown", approve, true);
      document.getElementById("horeca-os-facebook-notice")?.remove();
      resolve();
    };
    window.addEventListener("keydown", approve, true);
  });
}

async function fillInput(control, value) {
  const text = String(value || "").trim();
  control.scrollIntoView({ block: "center" });
  control.click();
  control.focus();
  const prototype = control instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  const setter = Object.getOwnPropertyDescriptor(prototype, "value")?.set;
  if (setter) setter.call(control, text);
  else control.value = text;
  control.dispatchEvent(new InputEvent("input", { bubbles: true, composed: true, inputType: "insertText", data: text }));
  control.dispatchEvent(new Event("change", { bubbles: true, composed: true }));
  await sleep(800);
}

function groupNameMatches(element, groupName) {
  const expected = clean(groupName);
  const actual = label(element);
  return Boolean(expected && (actual === expected || actual.startsWith(`${expected} `) || actual.includes(expected)));
}

async function chooseGroup(task, composer) {
  const addGroups = await waitFor(() => findClickable(/(groepen toevoegen|add groups)/i, composer), 4000);
  if (addGroups) addGroups.click();

  const chooser = addGroups
    ? await waitFor(() => activeDialog(), 15000)
    : composer;
  if (!chooser) throw new Error("Facebook opende de lijst met groepen niet.");

  const search = await waitFor(() => [...chooser.querySelectorAll('input,textarea')].find((element) => (
    isVisible(element) && /(zoeken|search|groep|group)/i.test(label(element))
  )), 10000);
  if (search) await fillInput(search, task.group?.name || "");

  const choice = await waitFor(() => clickables(chooser)
    .filter((element) => (
      groupNameMatches(element, task.group?.name)
      && !/(groepen toevoegen|add groups)/i.test(label(element))
    ))
    .sort((left, right) => label(left).length - label(right).length)[0], 15000);
  if (!choice) throw new Error(`Facebook kon ${task.group?.name || "de gekozen groep"} niet selecteren.`);
  choice.click();
  await sleep(900);

  const done = enabledButton(activeDialog() || document, /^(gereed|done|opslaan|save)$/i);
  if (done) {
    done.click();
    await sleep(700);
  }

  return await waitFor(() => {
    const current = activeDialog();
    return current && enabledButton(current, /^(plaatsen|post)$/i) ? current : null;
  }, 15000) || activeDialog();
}

async function openEventShare(task) {
  if (!/facebook\.com\/events\//i.test(location.href)) {
    throw new Error("Het gekoppelde Facebook-evenement kon niet worden geopend.");
  }

  const share = await waitFor(() => findClickable(/(^|\s)(delen|deel|share)(\s|$)/i), 20000);
  if (!share) throw new Error("Facebook toont de knop Delen niet bij dit evenement.");
  share.click();

  let composer = await waitFor(() => {
    const dialog = activeDialog();
    if (!dialog) return null;
    const hasPost = Boolean(enabledButton(dialog, /^(plaatsen|post)$/i));
    const hasGroupControl = Boolean(findClickable(/(groepen toevoegen|add groups)/i, dialog));
    return hasPost || hasGroupControl ? dialog : null;
  }, 12000);

  if (!composer) {
    const shareToGroup = await waitFor(() => findClickable(
      /^(delen (in|met) een groep|share (to|with) a group)$/i,
    ), 8000);
    if (!shareToGroup) throw new Error("Facebook opende het venster om het evenement te delen niet.");
    shareToGroup.click();
    composer = await waitFor(() => activeDialog(), 12000);
  }
  if (!composer) throw new Error("Facebook opende het deelvenster niet.");

  composer = await chooseGroup(task, composer) || activeDialog() || composer;
  const post = await waitFor(() => enabledButton(composer, /^(plaatsen|post)$/i), 15000);
  if (!post) throw new Error("Facebook heeft de knop Plaatsen niet beschikbaar gemaakt.");

  await waitForApproval();
  post.click();
  await sleep(2200);
}

chrome.runtime.sendMessage({ type: "FACEBOOK_GROUP_READY" }, async (response) => {
  if (!response?.ok || !response.task) return;
  try {
    await sleep(1200);
    await openEventShare(response.task);
    chrome.runtime.sendMessage({ type: "FACEBOOK_GROUP_RESULT", payload: { ok: true } });
  } catch (error) {
    showNotice(`Niet geplaatst: ${error.message}`, true);
    chrome.runtime.sendMessage({ type: "FACEBOOK_GROUP_RESULT", payload: { ok: false, error: error.message } });
  }
});
