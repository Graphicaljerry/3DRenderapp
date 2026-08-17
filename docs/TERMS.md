# Moldable — Terms of Service

**Effective date:** [[EFFECTIVE DATE]]
**Provided by:** [[LEGAL ENTITY NAME]] ("we", "us")
**Contact:** [[CONTACT EMAIL]]
**The app:** [[APP URL]]

By using Moldable you agree to these terms. If you don't agree, don't use it.

---

## 1. What Moldable is

Moldable is a browser-based tool for designing 3D-printable parts. You describe what
you want, an AI writes CAD code, and the app runs that code on a real CAD kernel and
shows you the result. You can then edit it, check it for printability, and export it
as STL, 3MF, STEP or OBJ. There is also a mode that generates sculpted meshes through
third-party AI engines, and a desktop build of the same app.

**Moldable is a tool, not a service that designs things for you.** The app itself does
no thinking — it hands your words to an AI company you have chosen and turns their
answer into geometry. We are not an engineering firm, a design bureau, or a
certification body, and nothing the app produces is professional engineering advice.

Moldable is free to use. We charge you nothing.

---

## 2. Bring your own key — you pay your own provider

Moldable has no built-in AI. To make anything, you paste in an API key from a provider
you have signed up with yourself: Anthropic, Google, OpenAI, Groq, OpenRouter, Hugging
Face, fal, Tripo, Meshy, Replicate, a local Ollama install, or any compatible endpoint
you choose. (There is also an on-device brain that needs no key and no internet, and
a free template gallery and worked example that use no AI at all.)

This means:

- **Every charge is between you and that provider.** We take no payment, hold no card
  details, take no commission and see no invoice. Their prices, their rate limits,
  their free tiers, their billing disputes.
- **You are responsible for what you spend.** The app shows price estimates before
  paid mesh generations and keeps a local running total, but those are estimates from
  a price list, not a bill. Your provider's dashboard is the only authoritative
  figure. Set spend limits on your keys if you want a hard ceiling.
- **You must follow your provider's terms.** Using Moldable does not exempt you from
  the acceptable-use policy of whichever AI company you routed the request to.
- **Keep your keys safe.** Anyone who can use your browser can use your keys. Use
  keys with spend limits, and rotate them if a device is lost or compromised. We are
  not responsible for charges run up on a key that leaked from your device.

Some providers cannot be called directly from a browser, so those requests are
forwarded through a relay we run. What that means for your data is set out in the
Privacy Policy. Anthropic, Hugging Face, Ollama and the on-device brain are never
relayed.

---

## 3. Your account (optional)

You can use Moldable without an account. If you create one, you are responsible for
keeping your credentials secure and for everything done through it. Tell us at
[[CONTACT EMAIL]] if you think it has been compromised.

Signing out removes that device's copy of your library after uploading it to your
account — that behaviour is deliberate and is explained in the app before it happens.

You may close your account at any time by emailing [[CONTACT EMAIL]].

---

## 4. Acceptable use

Use Moldable for designing and printing things. Don't use it to:

- design anything illegal where you are, including firearms, firearm components or
  parts intended to defeat safety or regulatory controls;
- infringe someone else's copyright, trademark, patent or design rights — including
  uploading reference photos of a design you have no right to copy;
- upload other people's personal photographs or private material without their
  agreement;
- deliberately attack, overload or reverse-engineer the app, our relay, or any
  provider's API;
- resell or repackage access to our relay, or route traffic through it that has
  nothing to do with using Moldable;
- get around a provider's rate limits, or use a key you are not entitled to use;
- design counterfeit goods, or parts intended to disable safety mechanisms on
  machinery or vehicles.

You are responsible for what you design, what you print, and what you do with it.

---

## 5. ⚠️ No warranty — and specifically, about the CAD

**Read this section even if you skip the others.**

Moldable is provided **"as is" and "as available", with no warranty of any kind**,
express or implied — including any implied warranty of merchantability, fitness for a
particular purpose, accuracy, or non-infringement.

More specifically, and more importantly:

**AI-generated CAD is regularly, confidently wrong.**

- **Dimensions may be incorrect.** A model can look right on screen and be several
  millimetres out. The AI writes code from a text description; nothing in the loop
  measures the real world.
- **Web-researched measurements may be wrong.** When the app looks up a real product's
  dimensions, it is reading web pages. Web pages are wrong all the time, and the AI
  may misread even a correct one. Never assume a researched figure is a spec.
- **Wall thickness, clearances and fits may be unsuitable** for your printer, your
  filament, or your slicer settings. Fit calibration helps; it does not guarantee.
- **Printability checks are heuristics.** Bed-fit and watertightness are computed
  exactly for the mesh on screen. Overhang percentages and wall-thickness warnings are
  best-effort estimates and will miss things.
- **Strength is never analysed.** Moldable performs no stress analysis, no load
  calculation, no fatigue modelling and no material simulation. It has no idea whether
  your part will hold.
- **Generated code is code.** The AI's CAD code runs in a sandboxed worker with a
  timeout, but you should treat it the way you'd treat any code you didn't write.

**Therefore: verify anything that matters before you rely on it.**

Measure the printed part. Check every critical dimension against the real object.
Test-print before committing to an expensive print or a batch.

**Do not use Moldable to design, and do not print and rely on, any part that is
load-bearing or safety-critical without independent verification by someone
qualified.** That includes, without limitation:

- anything holding a person's weight, or mounted overhead where it could fall on one
- climbing, diving, PPE, safety or rescue equipment
- vehicle, aircraft, drone, marine or bicycle components
- medical, dental, prosthetic or implantable devices
- anything carrying mains electricity, gas, or pressure
- child-care equipment, toys for small children, or anything a child will chew
- lifting, rigging or load-transmitting parts
- structural or building components
- food-contact parts (FDM prints are porous and hard to clean regardless of the design)

You alone decide whether a design is safe to print and use, and you alone bear the
consequences of that decision.

We also do not warrant that the app will be available, uninterrupted, error-free, or
compatible with your browser or hardware, that exports will open correctly in any
particular slicer or CAD package, or that any third-party AI provider will be
available, accurate, affordable or continue to exist.

---

## 6. Who owns what

**You own your designs.** The descriptions you type, the photos you upload, the CAD
code produced from them, the 3D models, and the exported files are yours. We claim no
ownership, no licence, no right to use them, and no right to train anything on them.
We do not even receive them unless you turn on account sync, and when you do, they are
encrypted before upload and stored only to give them back to you.

Two honest caveats that are not about us:

1. **Your AI provider has its own terms.** Ownership and licensing of AI output, and
   whether your inputs may be used for training, are governed by the agreement between
   you and Anthropic / Google / OpenAI / fal / Tripo / Meshy / Replicate / whoever you
   used. Read theirs. Ours cannot override it.
2. **Copyright is yours to respect.** Uploading a photo of someone else's product and
   generating a copy of it does not make the copy yours to sell. Whether an
   AI-generated model attracts copyright at all varies by country and is unsettled.

**We own the app.** Moldable's own code, name, interface and documentation remain ours
and our licensors'. Using the app gives you a personal, revocable, non-exclusive,
non-transferable licence to use it for its intended purpose. It does not give you
rights in the app itself. Third-party components in the app (replicad, OpenCascade,
three.js, Manifold and others) remain under their own open-source licences.

---

## 7. Third-party services

Moldable depends on services we do not run: AI providers, mesh-generation engines,
GitHub Pages for hosting, and Supabase for the optional account. We do not control
them, do not guarantee them, and are not responsible for them.

Any of them can change its API, raise its prices, restrict its free tier, degrade, or
shut down — and when that happens, part of Moldable will stop working until we adapt.
Your relationship with each provider is directly with them. Their terms and privacy
policies apply to your use of them.

---

## 8. Limitation of liability

To the fullest extent the law allows:

**We are not liable for any indirect, incidental, special, consequential, exemplary or
punitive damages**, or for lost profits, lost revenue, lost data, lost designs, wasted
filament, wasted print time, damaged printers, business interruption, or the cost of
substitute services — however caused, and even if we were told such damage was
possible.

**We are specifically not liable for:**

- parts that fail, break, don't fit, or don't perform as expected
- injury, death or property damage arising from a printed part
- incorrect dimensions or measurements produced by the AI or by web research
- charges you incur with any AI or mesh provider, including runaway or unexpected ones
- API keys exposed from your own device, or the consequences
- loss or corruption of designs, chat history or version history
- anything an AI provider does, fails to do, or stops doing

**Our total aggregate liability to you for all claims is limited to the greater of
(a) the total amount you have paid us, which is zero, and (b) [[LIABILITY CAP AMOUNT,
e.g. GBP 100]].**

Nothing in these terms limits liability that cannot lawfully be limited — including
liability for death or personal injury caused by our negligence, or for fraud or
fraudulent misrepresentation. If you are a consumer, you keep all statutory rights
that cannot be excluded, and nothing here affects them.

---

## 9. Indemnity

If someone brings a claim against us because of what you designed, printed, uploaded
or distributed using Moldable, or because you broke these terms or someone else's
rights, you agree to cover our reasonable costs and losses in dealing with it. This
does not apply to consumers where local law says it cannot.

---

## 10. Changes to the service and to these terms

Moldable is under active development. Features may be added, changed or removed;
providers may be added or dropped; the app may break temporarily. We do not promise to
keep any particular feature, provider or export format.

We may update these terms. Material changes will be reflected in the effective date at
the top and noted in the app's release notes. Continuing to use the app after a change
means you accept the updated terms. If you don't, stop using it and, if you have an
account, ask us to close it.

**Back up your work.** Use the app's export and encrypted-backup features. Your data
lives in your browser, and browsers lose data — a cleared cache, a reinstall, a
profile reset. We cannot recover anything for you.

---

## 11. Termination

You can stop using Moldable at any time. Delete your projects, clear the site's data,
and email us to close any account.

We may suspend or terminate your access, with or without notice, if you break these
terms, abuse our relay, or use the app in a way that puts us or other users at risk.
We may also stop offering Moldable, or any part of it, at any time.

Sections 5 (no warranty), 6 (ownership), 8 (liability), 9 (indemnity) and 12
(governing law) survive termination.

---

## 12. Governing law and disputes

These terms are governed by the laws of **[[GOVERNING JURISDICTION]]**, and the courts
of **[[GOVERNING JURISDICTION]]** have exclusive jurisdiction over any dispute.

If you are a consumer resident elsewhere, this does not deprive you of the protection
of the mandatory consumer laws of your own country, or of your right to bring
proceedings there.

Before starting formal proceedings, please email [[CONTACT EMAIL]] — most things can
be sorted out that way.

---

## 13. Odds and ends

- **Whole agreement.** These terms and the Privacy Policy are the entire agreement
  between us about Moldable.
- **Severability.** If a court finds part of these terms unenforceable, the rest still
  stands.
- **No waiver.** If we don't enforce something immediately, we haven't given up the
  right to enforce it later.
- **Assignment.** You may not transfer your rights under these terms. We may transfer
  ours to a successor of the project or business.
- **No third-party rights.** Nobody other than you and us can enforce these terms.

---

## 14. Contact

**[[CONTACT EMAIL]]** — [[LEGAL ENTITY NAME]], [[POSTAL ADDRESS]].
