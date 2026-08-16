const { chromium } = require("playwright");
const path = require("path");

(async () => {
  const browser = await chromium.launch({
    headless: true,
    executablePath: "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
  });
  const page = await browser.newPage();
  await page.route("https://www.facebook.com/events/2978214435854478", async (route) => {
    await route.fulfill({
      contentType: "text/html",
      body: `<!doctype html><html><body>
        <button id="share" role="button">Delen</button>
        <script>
          window.chrome = { runtime: { sendMessage(message, callback) {
            if (message.type === "FACEBOOK_GROUP_READY") callback({ ok: true, task: {
              eventUrl: "https://www.facebook.com/events/2978214435854478",
              group: { id: "1", name: "KARAOKE EVENTS" }
            }});
            if (message.type === "FACEBOOK_GROUP_RESULT") window.helperResult = message.payload;
          }}};
          document.getElementById("share").onclick = () => {
            const composer = document.createElement("div");
            composer.id = "composer";
            composer.setAttribute("role", "dialog");
            composer.innerHTML = '<div id="event-card">Karaoke avond bij Caribbean Corner</div><button id="add-groups" role="button">+ Groepen toevoegen</button>';
            document.body.appendChild(composer);
            document.getElementById("add-groups").onclick = () => {
              const chooser = document.createElement("div");
              chooser.id = "chooser";
              chooser.setAttribute("role", "dialog");
              chooser.innerHTML = '<input placeholder="Groep zoeken"><button id="target" role="option">KARAOKE EVENTS</button>';
              document.body.appendChild(chooser);
              document.getElementById("target").onclick = () => {
                chooser.remove();
                composer.insertAdjacentHTML("beforeend", '<span id="selected">KARAOKE EVENTS</span><button id="post" role="button">Plaatsen</button>');
                document.getElementById("post").onclick = () => { window.posted = true; };
              };
            };
          };
        </script>
      </body></html>`,
    });
  });
  await page.goto("https://www.facebook.com/events/2978214435854478");
  await page.addScriptTag({ path: path.join(__dirname, "facebook-group.js") });
  await page.waitForSelector("#horeca-os-facebook-notice");
  await page.keyboard.press("Enter");
  await page.waitForTimeout(3500);
  const result = await page.evaluate(() => ({
    posted: window.posted,
    result: window.helperResult,
    selected: document.getElementById("selected")?.textContent,
    card: document.getElementById("event-card")?.textContent,
  }));
  if (!result.posted || !result.result?.ok || result.selected !== "KARAOKE EVENTS" || !result.card) {
    throw new Error(`Onverwacht testresultaat: ${JSON.stringify(result)}`);
  }
  console.log(JSON.stringify(result));
  await browser.close();
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
