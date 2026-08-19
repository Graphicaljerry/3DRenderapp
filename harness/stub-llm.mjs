// A stand-in OpenAI-compatible endpoint, so the clarify + improve paths can be driven
// end to end without a real key. Answers /v1/chat/completions with canned SSE.
import { createServer } from "node:http";

const REFINE = {
  improved:
    "A wall-mounted bracket for a 32 mm diameter broom handle, 4 mm walls, with two M4 countersunk screw holes 60 mm apart on the back plate, printed with the flat back down.",
  questions: [
    {
      id: "handle_dia",
      ask: "How thick is the handle it has to hold?",
      why: "Sets the inside diameter of the cradle.",
      options: [
        { label: "22 mm", value: "The handle is 22 mm across" },
        { label: "25 mm", value: "The handle is 25 mm across", recommended: true },
        { label: "32 mm", value: "The handle is 32 mm across" },
      ],
      allowText: true,
    },
    {
      id: "mount",
      ask: "How does it attach to the wall?",
      why: "Decides whether the back plate gets screw holes and how big.",
      options: [
        { label: "Two M4 screws", value: "Mount with two M4 screws 60 mm apart", recommended: true },
        { label: "Adhesive pad", value: "Mount with an adhesive pad — no screw holes" },
      ],
    },
  ],
};

let hits = 0;
/** Armed by GET /_hang, consumed by the next BUILD request. See the fixture below. */
let hangNext = false;
// What the last few requests actually carried, so a probe can assert on the PAYLOAD
// rather than on the UI's own count. GET /_stats returns it.
const seen = [];
const server = createServer((req, res) => {
  // Probes cursor into `seen` by index, so a run that starts against a part-full buffer
  // slices past its own requests and reports "nothing was sent" — a failure that looks
  // like the app's and moves with how many probes ran before it. Reset first, always.
  if (req.method === "GET" && req.url.startsWith("/_hang")) {
    hangNext = true;
    res.writeHead(200, { "access-control-allow-origin": "*", "content-type": "application/json" });
    return res.end("{}");
  }
  if (req.method === "GET" && req.url.startsWith("/_reset")) {
    seen.length = 0;
    hangNext = false;
    res.writeHead(200, { "access-control-allow-origin": "*", "content-type": "application/json" });
    return res.end("{}");
  }
  if (req.method === "GET" && req.url.startsWith("/_stats")) {
    res.writeHead(200, { "access-control-allow-origin": "*", "content-type": "application/json" });
    return res.end(JSON.stringify(seen));
  }
  const cors = {
    "access-control-allow-origin": "*",
    "access-control-allow-headers": "*",
    "access-control-allow-methods": "POST,OPTIONS",
  };
  if (req.method === "OPTIONS") { res.writeHead(204, cors); return res.end(); }
  let body = "";
  req.on("data", (c) => { body += c; });
  req.on("end", () => {
    hits++;
    try {
      const j = JSON.parse(body);
      const parts = (j.messages ?? []).flatMap((m) => (Array.isArray(m.content) ? m.content : []));
      const imgs = parts.filter((c) => c.type === "image_url" && typeof c.image_url?.url === "string");
      seen.push({
        bytes: body.length,
        images: imgs.length,
        // Rough decoded size per picture, and the mime each one declares.
        each: imgs.map((c) => {
          const m = /^data:([^;]+);base64,(.*)$/s.exec(c.image_url.url);
          return m ? { mime: m[1], bytes: Math.floor(m[2].length * 0.75) } : { mime: "url", bytes: 0 };
        }),
      });
      if (seen.length > 200) seen.shift();
    } catch { /* not JSON (probe noise) — nothing to record */ }
    const frame = (o) => `data: ${JSON.stringify(o)}\n\n`;
    res.writeHead(200, { ...cors, "content-type": "text/event-stream" });
    // A BUILD request (the replicad system prompt, not a clarify/utility JSON ask):
    // reply with a real, buildable program, then a final chunk carrying usage the way
    // OpenRouter's accounting does — exercises the cost meter's ACTUALS path.
    if (/replicad/i.test(body) && !/Reply with JSON only/.test(body)) {
      // Two fixtures, chosen by the words: probes calibrated against the thin plate
      // (magnet pockets, measure snapping) keep it, while anything that needs real
      // depth — pen-cut pins, typed dimensions — asks for a block/bracket.
      // "plate" alone matches the BUILD-PLATE talk in the system prompt, so key on the
      // exact phrase the plate-calibrated probes ask for.
      const thin = /small plate/i.test(body);
      // "oval cup": a shelled stadium cup — the pen holder's actual topology, for the
      // rim-extrude preview probe (annulus top face with tessellation seams).
      if (/oval cup/i.test(body)) {
        const code = "Here is the part.\n\n```js\nconst defaultParams = { width: 60, depth: 45, height: 80, wall: 2.5 };\nfunction main(replicad, params) {\n  const p = { ...defaultParams, ...params };\n  const { drawRoundedRectangle } = replicad;\n  const r = Math.min(p.width, p.depth) / 2 - 0.01;\n  const solid = drawRoundedRectangle(p.width, p.depth, r).sketchOnPlane(\"XY\").extrude(p.height);\n  return solid.shell(-p.wall, (f) => f.inPlane(\"XY\", p.height));\n}\n```";
        res.write(frame({ choices: [{ delta: { content: code } }] }));
        res.write(frame({ choices: [{ delta: {} }], usage: { prompt_tokens: 1234, completion_tokens: 321, cost: 0.00421 } }));
        res.write("data: [DONE]\n\n");
        res.end();
        console.log(`[stub] ${hits} BUILD oval-cup (${body.length}b)`);
        return;
      }
      // "threaded bolt": exercises makeThread through the WORKER's injected replicad
      // namespace, driven by a `turns` param so the Adjust slider re-cuts the turn count.
      if (/threaded bolt/i.test(body)) {
        const code = "Here is the part.\n\n```js\nconst defaultParams = { diameter: 10, turns: 8, length: 24, headHeight: 6 };\nfunction main(replicad, params) {\n  const p = { ...defaultParams, ...params };\n  const { makeThread, makeCylinder } = replicad;\n  const shaft = makeThread({ diameter: p.diameter, turns: p.turns, length: p.length });\n  const head = makeCylinder(p.diameter * 0.9, p.headHeight, [0, 0, -p.headHeight + 0.05]);\n  return head.fuse(shaft);\n}\n```";
        res.write(frame({ choices: [{ delta: { content: code } }] }));
        res.write(frame({ choices: [{ delta: {} }], usage: { prompt_tokens: 1234, completion_tokens: 321, cost: 0.00421 } }));
        res.write("data: [DONE]\n\n");
        res.end();
        console.log(`[stub] ${hits} BUILD threaded-bolt (${body.length}b)`);
        return;
      }
      // "rounded holder": Jerry's pen-holder shape — a real OCCT fillet whose radius
      // param can outgrow a shrinking width, for the Adjust-rescue probe.
      if (/rounded holder/i.test(body)) {
        const code = "Here is the part.\n\n```js\nconst defaultParams = { width: 87, depth: 60, height: 70, cornerRadius: 22.5 };\nfunction main(replicad, params) {\n  const p = { ...defaultParams, ...params };\n  const { draw } = replicad;\n  const s = draw([-p.width / 2, -p.depth / 2]).hLine(p.width).vLine(p.depth).hLine(-p.width).close();\n  return s.sketchOnPlane(\"XY\").extrude(p.height).fillet(p.cornerRadius, (e) => e.inDirection(\"Z\"));\n}\n```";
        res.write(frame({ choices: [{ delta: { content: code } }] }));
        res.write(frame({ choices: [{ delta: {} }], usage: { prompt_tokens: 1234, completion_tokens: 321, cost: 0.00421 } }));
        res.write("data: [DONE]\n\n");
        res.end();
        console.log(`[stub] ${hits} BUILD rounded-holder (${body.length}b)`);
        return;
      }
      // "WIDER" = the same part with one number moved, so a probe can see the change
      // strip compute a real before/after rather than a fresh build's size-only case.
      // "BADCODE" = a reply the kernel will refuse: a js block with no main(). Exercises
      // the retry-then-give-up path, which is where a real session lost its whole reply.
      if (/BADCODE/.test(body)) {
        const bad = "Here is the part.\n\n```js\nconst defaultParams = { width: 10 };\nconst shape = 42; // no main() at all\n```";
        res.write(frame({ choices: [{ delta: { content: bad } }] }));
        res.write(frame({ choices: [{ delta: {} }], usage: { prompt_tokens: 900, completion_tokens: 120, cost: 0.002 } }));
        res.write("data: [DONE]\n\n");
        res.end();
        console.log(`[stub] ${hits} BUILD bad-code (${body.length}b)`);
        return;
      }
      // "TRUNCATE" = a reply that ran out of room: half a program, an unclosed fence, and
      // finish_reason "length". It arrives as an ordinary 200 and reads like a finished
      // answer, which is exactly why the app has to be told. TRUNCATE_ALWAYS never
      // recovers; plain TRUNCATE answers properly once asked for a compact program, so a
      // probe can watch the recovery rather than only the failure.
      if (/TRUNCATE/.test(body)) {
        const askedAgain = /cut off before the program finished/.test(body);
        const always = /TRUNCATE_ALWAYS/.test(body);
        if (askedAgain && !always) {
          const code = "```js\nconst defaultParams = { width: 60, depth: 40, thickness: 24 };\nfunction main(replicad, params) {\n  const p = { ...defaultParams, ...params };\n  const { drawRoundedRectangle } = replicad;\n  return drawRoundedRectangle(p.width, p.depth, 3).sketchOnPlane(\"XY\").extrude(p.thickness);\n}\n```";
          res.write(frame({ choices: [{ delta: { content: code } }] }));
          res.write(frame({ choices: [{ delta: {}, finish_reason: "stop" }], usage: { prompt_tokens: 900, completion_tokens: 200, cost: 0.002 } }));
          res.write("data: [DONE]\n\n");
          res.end();
          console.log(`[stub] ${hits} BUILD truncate-recovered (${body.length}b)`);
          return;
        }
        // No closing fence, and main() stops mid-statement — what a real cut-off looks like.
        const half = "```js\nconst defaultParams = { width: 260, height: 220, depth: 110, wallThickness: 3 };\nfunction main(replicad, params) {\n  const p = { ...defaultParams, ...params };\n  const { drawRoundedRectangle } = replicad;\n  const shell = drawRoundedRectangle(p.width, p.depth, 4).sketchOnPlane(\"XY\").extrude(p.hei";
        res.write(frame({ choices: [{ delta: { content: half } }] }));
        res.write(frame({ choices: [{ delta: {}, finish_reason: "length" }], usage: { prompt_tokens: 3100, completion_tokens: 8192, cost: 0.031 } }));
        res.write("data: [DONE]\n\n");
        res.end();
        console.log(`[stub] ${hits} BUILD truncated (${body.length}b)`);
        return;
      }
      // "REASONING" = stream the model's own thinking before the code, the way the
      // reasoning models do (OpenRouter puts it on delta.reasoning). Written the way they
      // actually write it — a bold section title, a hash heading, a bullet list — because
      // the panel's job is to render that as formatting rather than print the markers.
      if (/REASONING/.test(body)) {
        // Chunked so the FIRST frame cuts a bold title in half — that is the state a
        // reader actually sees most of the time, and the one that used to print the
        // opening asterisks on screen while the model finished writing the words.
        const think = [
          "**Calculating Cabinet",
          " Geometry**\n\nI'm refining the precise dimensions and cutout placements",
          " for the speaker cabinet.\n\n## Driver spacing\n\n- Driver hole diameter: 70 mm\n- Knob hole spacing: 20 mm\n",
          "\nNext I'll define the angled vent slot before proceeding with chamfers and the split joint.",
        ];
        // Paced, not dumped: the live panel exists only while the stream is open, and a
        // fixture that writes every frame in one tick leaves nothing on screen to look at.
        const wait = (ms) => new Promise((r) => setTimeout(r, ms));
        void (async () => {
          for (const t of think) { res.write(frame({ choices: [{ delta: { reasoning: t } }] })); await wait(350); }
          const code = "Here is the part.\n\n```js\nconst defaultParams = { width: 60, depth: 40, thickness: 24 };\nfunction main(replicad, params) {\n  const p = { ...defaultParams, ...params };\n  const { drawRoundedRectangle } = replicad;\n  return drawRoundedRectangle(p.width, p.depth, 3).sketchOnPlane(\"XY\").extrude(p.thickness);\n}\n```";
          res.write(frame({ choices: [{ delta: { content: code } }] }));
          res.write(frame({ choices: [{ delta: {} }], usage: { prompt_tokens: 1200, completion_tokens: 300, cost: 0.004 } }));
          res.write("data: [DONE]\n\n");
          res.end();
          console.log(`[stub] ${hits} BUILD reasoning (${body.length}b)`);
        })();
        return;
      }
      const wider = /WIDER/.test(body);
      const dims = thin ? { w: wider ? 50 : 30, d: 20, t: 5 } : { w: wider ? 80 : 60, d: 40, t: 24 };
      const code = `Here is the part.\n\n\`\`\`js\nconst defaultParams = { width: ${dims.w}, depth: ${dims.d}, thickness: ${dims.t} };\nfunction main(replicad, params) {\n  const p = { width: ${dims.w}, depth: ${dims.d}, thickness: ${dims.t}, ...params };\n  const { drawRoundedRectangle } = replicad;\n  return drawRoundedRectangle(p.width, p.depth, 3).sketchOnPlane("XY").extrude(p.thickness);\n}\n\`\`\``;
      // Hang the stream open and never finish it, so a probe can press Stop against a
      // request that is genuinely in flight. The point of the fixture is the LAST line:
      // when the browser aborts, the socket closes and we record it — the only way to
      // tell a real abort from a client that merely ignored the answer. A stop button
      // that doesn't close the connection still pays for every token.
      //
      // Armed over HTTP (GET /_hang) and consumed once, NOT keyed off a word in the
      // prompt: the app sends the conversation with every request, so a keyword lives on
      // in the history and silently hung every LATER build in the same session too.
      if (hangNext) {
        hangNext = false;
        res.write(frame({ choices: [{ delta: { content: "Here is the part.\n\n```js\n" } }] }));
        const slowly = setInterval(() => res.write(frame({ choices: [{ delta: { content: "// still writing\n" } }] })), 400);
        // RES, not REQ. `req`'s close fires as soon as the request BODY has been read —
        // which for a POST is immediately — so listening there reported every request as
        // aborted the instant it arrived, and the probe read a stop that hadn't happened
        // yet. `res` closes when the client actually goes away.
        res.on("close", () => {
          clearInterval(slowly);
          if (!res.writableEnded) {
            seen.push({ bytes: 0, images: 0, each: [], abortedByClient: true });
            console.log(`[stub] ${hits} hung build aborted by client`);
          }
        });
        return;
      }
      // "SLOWBUILD" holds the reply for a beat so a probe can look at the WORKING
      // state — with the instant reply, mid-stream UI (the model tag on a running
      // request, the step timeline) is gone before Playwright can see it.
      const wait = /SLOWBUILD/.test(body) ? 2500 : 0;
      setTimeout(() => {
        res.write(frame({ choices: [{ delta: { content: code } }] }));
        res.write(frame({ choices: [{ delta: {} }], usage: { prompt_tokens: 1234, completion_tokens: 321, cost: 0.00421 } }));
        res.write("data: [DONE]\n\n");
        res.end();
        console.log(`[stub] ${hits} BUILD${wait ? " slow" : ""} (${body.length}b)`);
      }, wait);
      return;
    }
    // A HISTORY-MOVE request (the revert resolver's system prompt). Emulates what a real
    // model does: find the step whose summary matches the noun the user named, and apply
    // the "before X" rule (one step earlier). Keyed off the log the app actually sent, so
    // this exercises the app's own step→version mapping rather than a canned number.
    if (/asking to move the MODEL BACK/i.test(body)) {
      const j2 = JSON.parse(body);
      const said = (j2.messages ?? []).map((m) => (typeof m.content === "string" ? m.content : "")).join("\n");
      const logLines = [...said.matchAll(/^(\d+)\. (.+)$/gm)].map((m) => ({ n: Number(m[1]), text: m[2] }));
      const userLine = (said.split("The user says: ")[1] ?? "").trim();
      // Which noun are they pointing at? First log line mentioning it wins.
      const noun = ["screw", "hole", "chamfer", "magnet", "logo", "text"].find((w) => new RegExp(w, "i").test(userLine));
      const hit = noun ? logLines.find((l) => new RegExp(noun, "i").test(l.text)) : undefined;
      let step = null;
      if (hit) step = /\bbefore\b/i.test(userLine) ? hit.n - 1 : hit.n;
      else if (/\bundo\b|\bback one\b|\bstep back\b/i.test(userLine)) {
        const cur = logLines.find((l) => /ON SCREEN NOW/.test(l.text));
        if (cur) step = cur.n - 1;
      }
      const reply = step && step >= 1
        ? JSON.stringify({ action: "restore", step, say: `Rolled back to step ${step}.` })
        : JSON.stringify({ action: "none" });
      res.write(frame({ choices: [{ delta: { content: reply } }] }));
      res.write("data: [DONE]\n\n");
      res.end();
      console.log(`[stub] ${hits} HISTORY "${userLine}" -> ${reply}`);
      return;
    }
    // A PLAN request (plan mode's system prompt): reply with a plan JSON so the card
    // and its approve/skip paths can be driven without a real brain.
    if (/CAD planner/i.test(body)) {
      const payload = JSON.stringify({
        title: "Pipe wall bracket",
        summary: "A wall-mounted saddle bracket that clamps a 32 mm pipe.",
        size: { x: 60, y: 40, z: 24 },
        steps: [
          "60 x 40 x 12 mm back plate, 3 mm corner radius",
          "32.4 mm semicircular saddle, 20 mm deep",
          "Two M4 clearance holes 40 mm apart",
        ],
        assumptions: [
          "Wall thickness 4 mm throughout",
          "0.2 mm clearance per side on the pipe seat",
          "Prints back-plate-down, no supports",
        ],
        printNotes: ["Back plate on the bed", "3 perimeters for screw-hole strength"],
        parameters: [
          { name: "Wall thickness", value: 4 },
          { name: "Screw hole spacing", value: 40 },
        ],
      });
      res.write(frame({ choices: [{ delta: { content: payload } }] }));
      res.write("data: [DONE]\n\n");
      res.end();
      console.log(`[stub] ${hits} PLAN (${body.length}b)`);
      return;
    }
    // "SPECIFIC" in the request = the already-buildable case: no questions, so the app
    // must fall straight through to the build with no card at all.
    const specific = /SPECIFIC/.test(body);
    const payload = JSON.stringify(specific ? { ...REFINE, questions: [] } : REFINE);
    res.write(frame({ choices: [{ delta: { content: payload } }] }));
    res.write("data: [DONE]\n\n");
    res.end();
    console.log(`[stub] ${hits} ${req.method} ${req.url} (${body.length}b)`);
  });
});
const STUB_PORT = Number(process.env.STUB_PORT ?? 8899);
server.listen(STUB_PORT, () => console.log(`[stub] listening on ${STUB_PORT}`));
