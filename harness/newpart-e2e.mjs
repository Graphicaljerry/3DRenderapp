// A request typed at the front door starts a NEW part.
//
// The bug: the Launchpad's submit called send() directly. Nothing cleared the open
// project first — projectRef is only reset by startNew — so a brand-new request was
// appended to whatever was last worked on: its transcript, its version chain, its name.
// Two unrelated parts in one project, and the older one's history now carrying edits
// meant for something else.
//
// Two things have to hold at once, and asserting only the first would pass on a fix that
// throws away the user's work: the new ask must land in a NEW project, and the old
// project must still exist untouched.
//
// Written before the fix, and it took two goes. The first attempt — startNew() on submit
// plus the queuedAsk hand-off — stopped the append but left the second request never
// sending, because the queue effect refuses to run while an AI preview is `pending` and
// nothing had ever cleared one. That is a second bug in its own right, and the nastier
// of the two: a preview left on the old canvas silently swallowed the next request.
import { chromium } from "playwright";

const STUB = "http://localhost:8899";
await fetch(`${STUB}/_reset`);
const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium" });
const page = await browser.newPage({ viewport: { width: 1280, height: 950 } });
page.on("console", (m) => { if (m.type() === "error") console.error("[page]", m.text()); });
const fails = [];
const check = (name, ok, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"} ${name}${detail ? " — " + detail : ""}`);
  if (!ok) fails.push(name);
};

const projects = () => page.evaluate(() => new Promise((res) => {
  const open = indexedDB.open("moldable", 1);
  open.onsuccess = () => {
    const db = open.result;
    const req = db.transaction("projects", "readonly").objectStore("projects").getAll();
    req.onsuccess = () => res(req.result.map((p) => ({
      id: p.id, name: p.name,
      msgs: (p.chat ?? p.messages ?? []).filter((m) => m.role === "user").map((m) => m.text),
      versions: (p.versions ?? []).length,
    })));
    req.onerror = () => res([]);
  };
  open.onerror = () => res([]);
}));

await page.addInitScript(() => {
  localStorage.setItem("moldable_theme", "dark");
  localStorage.setItem("moldable_llm", JSON.stringify({ provider: "custom", model: "stub", baseUrl: "http://localhost:8899/v1" }));
  localStorage.setItem("moldable_signin_prompted", "1");
});
await page.goto(`http://localhost:${process.env.PORT ?? 5173}/`, { waitUntil: "domcontentloaded" });
await page.waitForSelector(".launch-composer textarea", { timeout: 60_000 });

const planOff = async (root) => {
  const chip = root.locator(".lo-trigger");
  if (!/no plan/i.test(await chip.innerText())) {
    await chip.click();
    await root.locator(".pmenu-item", { hasText: /plan first/i }).first().click();
    await root.keyboard.press("Escape");
  }
};

// --- part one, from the Launchpad ---
await planOff(page);
await page.locator(".launch-composer textarea").fill("A SPECIFIC bracket for the FIRST part");
await page.locator(".launch-composer .send").click();
await page.waitForFunction(() => /FIRST part/i.test(document.body.innerText), null, { timeout: 60_000 });
await page.waitForFunction(() => !document.querySelector(".bubble-open"), null, { timeout: 180_000 });
await page.waitForTimeout(2500); // let the project persist

const after1 = await projects();
check("the first ask created a project", after1.length === 1, `${after1.length} project(s)`);

// --- home, then a completely different ask ---
await page.locator(".brandbtn").click();
await page.waitForSelector(".launch-composer textarea", { timeout: 30_000 });
await planOff(page);
await page.locator(".launch-composer textarea").fill("A SPECIFIC round coaster, the SECOND part");
await page.locator(".launch-composer .send").click();
// Wait for the ask to APPEAR before waiting for it to finish: "no working bubble" is
// true the instant before one exists, so keying only on that races the send and reports
// an empty workspace as a missing project.
await page.waitForFunction(() => /SECOND part/i.test(document.body.innerText), null, { timeout: 60_000 });
await page.waitForFunction(() => !document.querySelector(".bubble-open"), null, { timeout: 180_000 });
await page.waitForTimeout(2500);

const after2 = await projects();
check("the second ask made its OWN project, not a second entry in the first",
  after2.length === 2, `${after2.length} project(s): ${after2.map((p) => p.name).join(" | ")}`);

// The transcript on screen must be the new part's alone — this is what the user sees.
const shown = await page.locator(".msg-row, .bubble").allInnerTexts().catch(() => []);
const joined = shown.join(" ");
check("the open transcript does not still carry the first part's request",
  !/FIRST part/i.test(joined), joined.slice(0, 120));
check("…and does carry the second", /SECOND part/i.test(joined), joined.slice(0, 120));

// The old project must survive — a "fix" that wiped it would pass the checks above.
const first = after2.find((p) => p.msgs.some((t) => /FIRST part/i.test(t)));
const second = after2.find((p) => p.msgs.some((t) => /SECOND part/i.test(t)));
check("the first project still exists with its own request", !!first, first ? first.name : "gone");
check("the second project exists separately", !!second && second.id !== first?.id,
  second ? `${second.name} (${second.id.slice(0, 8)})` : "missing");
check("neither project holds both requests",
  !!first && !!second && !first.msgs.some((t) => /SECOND/i.test(t)) && !second.msgs.some((t) => /FIRST/i.test(t)),
  `first=[${first?.msgs.join(",")}] second=[${second?.msgs.join(",")}]`);

console.log(fails.length ? `\n✗ FAILED: ${fails.join(", ")}` : "\n✓ all good");
await browser.close();
process.exit(fails.length ? 1 : 0);
