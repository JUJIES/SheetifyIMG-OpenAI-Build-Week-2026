# SheetifyIMG

**Image-first worksheets. Teacher-controlled.**

SheetifyIMG is a teacher-controlled worksheet generator for turning an initial teaching idea or source material into a structured concept and then into complete visual worksheet drafts.

I teach English at a small special education school in Germany. My starting point was not a generic wish to “add AI” to worksheets. It was a familiar classroom problem: I often know what I want a lesson to do, but end up choosing the least-wrong existing material—and then the worksheet starts shaping the lesson instead of the other way around.

SheetifyIMG is my attempt to reverse that relationship. The teacher stays responsible for content, sequence, difficulty and classroom fit. The system takes over planning support, layout production and visual iteration.

> **Capability alone is not a workflow.**
> Teachers need interfaces, guardrails, didactic checkpoints and enough control to understand and take ownership of the result.

SheetifyIMG is submitted to the **Education track of OpenAI Build Week 2026**.

During Build Week, I did not start from an empty repository. A functional personal prototype already existed. The submitted work was the next, less visible step: turning that prototype into a hosted, pass-based Closed Beta that another person could enter, use, revisit and evaluate without me standing beside them.

## Links

- **Hosted Closed Beta:** https://sheetify.jujies.app/?lang=en
- **English onboarding walkthrough:** https://youtu.be/zbgVeGDTo7o
- **Personal project note and timeline:** https://aboutsheetify.jujies.app
- **Sanitized Closed Beta evidence:** supplied with the private Devpost judge material
- **Frozen application release tag:** `openai-build-week-2026-final`
- **Complete judge repository:** current `main`, including the audited video-tool publication supplement

---

## Evaluate SheetifyIMG

There are two ways to evaluate the submission.

### Option 1 — Hosted Closed Beta (recommended)

The hosted beta is the fastest and most representative path. It includes the access, persistence, credit and feedback layers that were part of the Build Week beta push.

**Open:** https://sheetify.jujies.app/?lang=en

Judge Beta Pass credentials are supplied separately in the private Devpost testing instructions. They are intentionally not stored in this repository.

Each Judge Beta Pass provides:

- an isolated, empty workspace;
- 25 draft-page credits;
- an English entry path;
- access to the same hosted beta environment used for external testing;
- no installation or personal API key requirement.

A suggested evaluation path is:

1. Create a project from a teaching idea or source material.
2. Discuss the lesson and let SheetifyIMG propose a worksheet concept.
3. Inspect or revise the concept before visual generation.
4. Explicitly approve the concept.
5. Generate one or more complete worksheet drafts.
6. Compare or revise the drafts.
7. Save the preferred result as a worksheet PDF.

The worksheet language can be chosen independently from the interface language.

### Suggested sample task

No external dataset is required. A simple reproducible task is:

> Create a Grade 5 worksheet about the water cycle. Include a clear visual explanation, a short reading section and three age-appropriate comprehension tasks.

A judge can also use a different topic, paste source text or add an image reference.

### Option 2 — Run locally from the release mirror

The complete local evaluation path is included in this repository and can be run with a judge-supplied OpenAI API key. See [Run locally](#run-locally) for the exact commands.

This repository is a filtered judge-facing release mirror rather than the private canonical development repository. See [Repository provenance](#repository-provenance) before comparing commit hashes.

---

## How SheetifyIMG works

```text
Teaching idea or source material
        ↓
GPT-5.6 Luna: conversation and structured planning
        ↓
GPT-5.6 Sol: complete worksheet concept
        ↓
Teacher review and explicit approval
        ↓
Internal ImageSpec and controlled image prompt
        ↓
gpt-image-2: complete worksheet-page rendering
        ↓
Review, visual revision and comparison
        ↓
Saved worksheet snapshot and PDF
```

### 1. Start with the lesson, not the layout

A teacher begins with an idea, requirements or reference material. SheetifyIMG keeps this conversational rather than turning the process into a long configuration form.

### 2. Make the plan inspectable

GPT-5.6 Luna interprets the conversation as a structured planning turn. GPT-5.6 Sol then creates the visible worksheet concept: its content, tasks, wording, sequence and instructional frame.

The concept is not hidden model state. It is the point where the teacher can still question the difficulty, replace a task, change the sequence or remove something that does not fit the class.

### 3. Require explicit approval

Image generation does not begin merely because a model proposes it. The teacher must explicitly approve the concept before a paid visual generation run is authorized.

### 4. Render the complete page Image-First

After approval, the application derives an internal ImageSpec and builds a controlled image request. `gpt-image-2` renders the complete worksheet page, including its text and visual composition.

### 5. Inspect, revise and save

The teacher can request concept changes, create visual alternatives, compare drafts and save a preferred result. Active projects remain separate from worksheets that have been deliberately stored for classroom use.

> A worksheet can look finished and still be pedagogically empty. I want the model to take over layout and production work—not the lesson or the teacher’s creative control.

---

## How GPT-5.6 powers SheetifyIMG

GPT-5.6 is part of the submitted application at runtime, not only a model used while developing it.

SheetifyIMG uses two purpose-specific GPT-5.6 configurations:

| Layer or task | Application responsibility | Model or system |
|---|---|---|
| Conversation understanding and planning | Produces a structured planning turn containing intent, readiness, response goal and proposed next action | `gpt-5.6-luna` |
| Complete worksheet concept | Creates the visible worksheet content, task structure and concept frame | `gpt-5.6-sol` |
| Targeted concept revision | Returns a bounded structured delta that application code validates and applies to a new concept version | `gpt-5.6-sol` |
| ImageSpec and helper work | Supports structured visual planning, warnings and low-risk narration | `gpt-5.6-luna` |
| Worksheet rendering | Renders the complete approved visual page | `gpt-image-2` |
| Optional voice transcription | Converts recorded teacher input into text before normal planning | `gpt-4o-mini-transcribe` |
| Authorization, approval, credits, state, storage and PDF creation | Controls whether an action is allowed and persists the resulting artifacts | Deterministic Node.js application code |

Luna and Sol are configured model IDs and application roles. They do not autonomously choose their own models or control application state. The application router selects the role; both use OpenAI’s Responses API.

This boundary is deliberate:

- GPT-5.6 handles semantic interpretation and structured proposals.
- `gpt-image-2` handles visual worksheet production.
- deterministic code retains authority over state changes, paid actions, approval, persistence and access.

A model can propose what should happen next. It cannot mutate the project merely because it proposed it.

---

## From personal MVP to Closed Beta

SheetifyIMG existed before OpenAI Build Week.

Before the event, the personal prototype already supported:

- projects and source material;
- structured worksheet concepts;
- model routing;
- Image-First worksheet generation;
- draft review;
- worksheet storage and PDF creation;
- the core Luna/Sol role split.

The conservative private-upstream baseline is:

```text
Canonical upstream commit: cfd4a4f4cc40f55b03621161c702771a4dda855c
Date: 14 July 2026, 10:57 CEST
Tag: sheetifyimg-pre-planning-v2-2026-07-14
```

This baseline was created after the official Submission Period had already begun. Everything it contains is therefore treated as pre-existing rather than claimed as Build Week work.

### Commit-backed Build Week work directory

This is a capability index rather than a chronological changelog. It separates
product work, Beta infrastructure, verification and submission evidence so the
Build Week contribution can be inspected without treating every small release
commit as a separate feature.

The linked hashes are commits in this filtered public mirror. Where useful, the
corresponding canonical private-upstream commit is shown as `source:`. Hashes
differ because private-only paths are omitted; `SOURCE_PROVENANCE.json` records
the exact source revision behind the published application tree.

| Area | Build Week contribution at a glance |
|---|---|
| Core product and UI | Planning V2, the interactive Worksheet Concept, explicit reference and revision logic, and a chat-first responsive workflow |
| Closed Beta | Sheetify Pass workspaces, sessions and pairing, draft-page credits, administration, invitations, recovery, consent and feedback |
| Hosting and quality | Beelink cutover, commit-pinned releases, external runtime state, health checks, reliability fixes and automated end-to-end verification |
| Onboarding and evidence | English judge path, Tutorial Center, automated demo/onboarding production, external Beta evidence and the reproducible judge mirror |

<details open>
<summary><strong>Core product and UI work</strong></summary>

#### Planning V2 architecture

**What changed:** a consolidated Planning Turn, unified worksheet-concept
generation, compact structured revision deltas, content-free observability and
an explicit Legacy rollback path. A controlled real-API A/B harness measured
the resulting call, token and text-model cost changes without presenting them
as a general quality verdict.

**Why it mattered:** the Beta needed a less fragmented planning path while
retaining explicit teacher approval and compatibility with existing projects.

**Evidence:** [`9010dc3a`](https://github.com/JUJIES/SheetifyIMG-OpenAI-Build-Week-2026/commit/9010dc3a)
(`source: 897be78`), [`3c3aaa2a`](https://github.com/JUJIES/SheetifyIMG-OpenAI-Build-Week-2026/commit/3c3aaa2a)
(`source: 414a822`), [`45fc5a4b`](https://github.com/JUJIES/SheetifyIMG-OpenAI-Build-Week-2026/commit/45fc5a4b)
(`source: 11cfb12`), [`699ff4cc`](https://github.com/JUJIES/SheetifyIMG-OpenAI-Build-Week-2026/commit/699ff4cc)
(`source: a8c18a9`). The first Planning V2 implementation was committed on
14 July 2026 at 12:54 CEST, directly after the conservative pre-existing
baseline.

#### Interactive Worksheet Concept

**What changed:** the existing structured concept became one consistent,
inspectable desktop and mobile surface for page structure, task progression,
visible content, images and layout intent. Concept elements can be opened and
used as explicit revision targets without introducing a second concept model.

**Why it mattered:** teachers can inspect what the system intends to render and
change a specific part before authorizing a paid image run.

**Evidence:** [`b72edb65`](https://github.com/JUJIES/SheetifyIMG-OpenAI-Build-Week-2026/commit/b72edb65)
(`source: efa8df2`), [`c4d08c88`](https://github.com/JUJIES/SheetifyIMG-OpenAI-Build-Week-2026/commit/c4d08c88)
(`source: 023770f`), [`5fff3c1a`](https://github.com/JUJIES/SheetifyIMG-OpenAI-Build-Week-2026/commit/5fff3c1a)
(`source: ec35501`), [`97ea11fa`](https://github.com/JUJIES/SheetifyIMG-OpenAI-Build-Week-2026/commit/97ea11fa)
(`source: 21463a5`).

#### Reference UI and targeted revision logic

**What changed:** the generation surface now distinguishes a new draft from
the current concept, a targeted revision of a selected draft, an optional
visual template and an image that should appear as worksheet material. For a
targeted revision, the selected draft is carried as the explicit visual basis,
validated by the server and described to the image model with preservation
instructions. A missing or unreadable basis fails closed instead of silently
becoming an unrelated generation.

The same work simplified the confirmation UI, added a compact template popover,
made concept images individually inspectable and moved mobile reference
selection into a bounded bottom sheet.

**Why it mattered:** in a probabilistic Image-First workflow, “revise this
draft” must not mean the same thing as “create another draft.” The teacher must
see and control what the next generation is based on.

**Evidence:** [`2f4663c1`](https://github.com/JUJIES/SheetifyIMG-OpenAI-Build-Week-2026/commit/2f4663c1)
(`source: 202ffaa`), [`305a7166`](https://github.com/JUJIES/SheetifyIMG-OpenAI-Build-Week-2026/commit/305a7166)
(`source: 478d222`), [`4403d32b`](https://github.com/JUJIES/SheetifyIMG-OpenAI-Build-Week-2026/commit/4403d32b)
(`source: 7733896`), [`24ed97a1`](https://github.com/JUJIES/SheetifyIMG-OpenAI-Build-Week-2026/commit/24ed97a1)
(`source: 13b824b`). The final two commits changed 15 files with 615 additions
and 103 deletions, then 13 files with 877 additions and 348 deletions.

#### Chat-first, mobile and project workflow overhaul

**What changed:** new projects open directly into the conversation; the
creation path no longer depends on a large prefilled form. Mobile project
entry, the composer, settings sheets, the concept sheet and reference controls
were reworked. Supporting changes added contextual folder creation, compact
completed-draft cards and multiline chat input.

**Why it mattered:** the hosted Beta had to work without a live explanation on
both desktop and phone, while keeping the lesson conversation as the primary
entry point.

**Evidence:** [`e0bd4a3f`](https://github.com/JUJIES/SheetifyIMG-OpenAI-Build-Week-2026/commit/e0bd4a3f)
(`source: e5c8897`), [`77180af1`](https://github.com/JUJIES/SheetifyIMG-OpenAI-Build-Week-2026/commit/77180af1)
(`source: a552677`), [`f86f410a`](https://github.com/JUJIES/SheetifyIMG-OpenAI-Build-Week-2026/commit/f86f410a)
(`source: 77afdd7`), [`530a5c83`](https://github.com/JUJIES/SheetifyIMG-OpenAI-Build-Week-2026/commit/530a5c83)
(`source: 1a01a9b`), [`91cc87f0`](https://github.com/JUJIES/SheetifyIMG-OpenAI-Build-Week-2026/commit/91cc87f0)
(`source: 7be7a1b`).

</details>

<details>
<summary><strong>Closed Beta access and operations</strong></summary>

#### Sheetify Pass access and workspace isolation

**What changed:** pass-scoped projects, worksheets and files; persistent
device-specific sessions; short-lived device pairing; manual pass entry; and
individual device disconnect. Pass, session, pairing and recovery secrets are
stored as digests rather than plaintext.

**Why it mattered:** invited testers needed separate, revisitable workspaces
without adding a full personal-account system to a small Closed Beta.

**Evidence:** [`f3e3ba8e`](https://github.com/JUJIES/SheetifyIMG-OpenAI-Build-Week-2026/commit/f3e3ba8e)
(`source: 7612305`), [`bc5b9441`](https://github.com/JUJIES/SheetifyIMG-OpenAI-Build-Week-2026/commit/bc5b9441)
(`source: e8028a9`), [`3e29847d`](https://github.com/JUJIES/SheetifyIMG-OpenAI-Build-Week-2026/commit/3e29847d)
(`source: 835e623`), [`327d00e4`](https://github.com/JUJIES/SheetifyIMG-OpenAI-Build-Week-2026/commit/327d00e4)
(`source: d4b995e`).

#### Draft credits and Beta administration

**What changed:** draft-page credits use one append-only ledger for grants,
generation reservations, successful settlement and automatic refund of unused
or failed pages. The private admin can create and manage passes and top-up
cards, pause or reactivate access, rotate credentials and explicitly delete a
workspace and its linked Beta records.

**Why it mattered:** real image runs have cost and lifecycle consequences that
the personal prototype did not need to expose or operate for other people.

**Evidence:** [`40eb0b91`](https://github.com/JUJIES/SheetifyIMG-OpenAI-Build-Week-2026/commit/40eb0b91)
(`source: 916394b`), [`bfcc2e82`](https://github.com/JUJIES/SheetifyIMG-OpenAI-Build-Week-2026/commit/bfcc2e82)
(`source: d2cd0bb`), [`67b2ff31`](https://github.com/JUJIES/SheetifyIMG-OpenAI-Build-Week-2026/commit/67b2ff31)
(`source: 5b2b76b`), [`e91bd765`](https://github.com/JUJIES/SheetifyIMG-OpenAI-Build-Week-2026/commit/e91bd765)
(`source: f5f0273`).

#### Invitations, email and recovery

**What changed:** localized pass cards, server-side Resend delivery, a stable
support address and admin-reviewed single-use recovery links with a manual
fallback.

**Why it mattered:** a tester had to be able to receive access, understand it
and recover a workspace without exposing credentials in Git or requiring the
owner to edit product state manually.

**Evidence:** [`5f9199cc`](https://github.com/JUJIES/SheetifyIMG-OpenAI-Build-Week-2026/commit/5f9199cc)
(`source: 5d5f81d`), [`ff5a5ea8`](https://github.com/JUJIES/SheetifyIMG-OpenAI-Build-Week-2026/commit/ff5a5ea8)
(`source: 17b70f7`), [`147e8d75`](https://github.com/JUJIES/SheetifyIMG-OpenAI-Build-Week-2026/commit/147e8d75)
(`source: 886f3be`).

#### Consent and contextual feedback

**What changed:** required Beta consent is recorded per device session;
voluntary feedback can carry the current project context into a private admin
review queue; and later UI passes reduced prompting, kept the feedback control
reachable and fixed cross-project context leakage.

**Why it mattered:** the Beta needed an honest feedback loop without adding a
general analytics platform or pretending that an invitation email was a user
identity.

**Evidence:** [`c2832d50`](https://github.com/JUJIES/SheetifyIMG-OpenAI-Build-Week-2026/commit/c2832d50)
(`source: 5a3638d`), [`3148bb98`](https://github.com/JUJIES/SheetifyIMG-OpenAI-Build-Week-2026/commit/3148bb98)
(`source: e313e18`), [`62e6b8b5`](https://github.com/JUJIES/SheetifyIMG-OpenAI-Build-Week-2026/commit/62e6b8b5)
(`source: 2dec7cc`).

</details>

<details>
<summary><strong>Hosting, reliability and automated verification</strong></summary>

#### Hosted Beta cutover and Beelink operations

**What changed:** SheetifyIMG moved from a personal development environment to
a persistent, commit-pinned Windows service with a separately stored runtime,
external secrets, read-only health checks, a fixed Cloudflare named tunnel and
documented rollback releases. The application and tunnel have independent
service identities; the existing Beelink Control Center observes SheetifyIMG as
a status-only workload rather than becoming its process parent.

**Why it mattered:** this cutover was the operational beginning of the Beta. It
made the application continuously reachable at `sheetify.jujies.app` and able
to survive normal application or tunnel restarts without the development
checkout becoming the production source of truth.

**Evidence:** [`aa237925`](https://github.com/JUJIES/SheetifyIMG-OpenAI-Build-Week-2026/commit/aa237925)
(`source: d1f6af9`), [`3d908ce2`](https://github.com/JUJIES/SheetifyIMG-OpenAI-Build-Week-2026/commit/3d908ce2)
(`source: e07d777`), [`71e082ad`](https://github.com/JUJIES/SheetifyIMG-OpenAI-Build-Week-2026/commit/71e082ad)
(`source: ed0c57e`), plus Control Center source commit `3e55b6b`. The migrated
service, automatic app and tunnel services, local/public health endpoints and
independent restart behavior were verified on 15 July 2026. A full host reboot
and the formal external encrypted backup/restore proof are not claimed as
completed migration gates.

#### Workflow reliability and output correctness

**What changed:** duplicate workspace-command protection, exact binding of E2E
reviews to generated artifacts, generation-job recovery checks, retries for
transient Windows state writes, correct separation of task and page counts,
stable task numbering across pages and repaired referenced-revision routing.

**Why it mattered:** these are failure modes that become visible only when the
application is repeatedly used, refreshed and operated by people other than
its author.

**Evidence:** [`23a597dd`](https://github.com/JUJIES/SheetifyIMG-OpenAI-Build-Week-2026/commit/23a597dd)
(`source: df4d71d`), [`2f42159e`](https://github.com/JUJIES/SheetifyIMG-OpenAI-Build-Week-2026/commit/2f42159e)
(`source: 97eca33`), [`2e982fda`](https://github.com/JUJIES/SheetifyIMG-OpenAI-Build-Week-2026/commit/2e982fda)
(`source: 9e4d265`), [`d702a7a8`](https://github.com/JUJIES/SheetifyIMG-OpenAI-Build-Week-2026/commit/d702a7a8)
(`source: a70965a`).

#### Automated Beta and end-to-end verification

**What changed:** provider-free release and regression suites were expanded
with focused contracts for access, credits, localization, references,
tutorials, hosting and the judge path. Targeted real-provider runners cover the
full Beta journey, Planning V2 comparisons and paid image canaries. Repeatable
live runners also exercised the private admin and two-device pairing flows
without committing their credentials or runtime data.

**Why it mattered:** the Beta release process needed evidence for the complete
journey, not only isolated model calls. These tests exposed page-count parsing,
browser timing and incorrect review-to-artifact association before the final
judge release.

**Evidence:** [`61c9fb2b`](https://github.com/JUJIES/SheetifyIMG-OpenAI-Build-Week-2026/commit/61c9fb2b)
(`source: b20dcf2`), canonical source commits `110d71a`, `6ac6906`, `9dc1a69`
and `e2de83c`, plus the provider-free judge commands documented below.

</details>

<details>
<summary><strong>Onboarding, external validation and submission evidence</strong></summary>

#### English judge path

**What changed:** English entry and interface handling, localized new-project
conversation defaults, an English tutorial source, stable English labels and a
reproducible paid English capture profile. Worksheet language remains
independent from interface language, and existing project conversations are not
silently rewritten.

**Why it mattered:** judges and English-speaking testers needed a coherent path
through the same hosted Beta rather than a separate demonstration build.

**Evidence:** [`f13995e3`](https://github.com/JUJIES/SheetifyIMG-OpenAI-Build-Week-2026/commit/f13995e3)
(`source: e97df50`), [`4a5a132b`](https://github.com/JUJIES/SheetifyIMG-OpenAI-Build-Week-2026/commit/4a5a132b)
(`source: 545771c`), [`869ee8dd`](https://github.com/JUJIES/SheetifyIMG-OpenAI-Build-Week-2026/commit/869ee8dd)
(`source: be5549a`), [`56239156`](https://github.com/JUJIES/SheetifyIMG-OpenAI-Build-Week-2026/commit/56239156)
(`source: b73ac56`).

#### Tutorial Center and automated demo/onboarding pipeline

**What changed:** an in-app Tutorial Center with locale-specific validated
video sources, privacy-conscious loading and device-specific progress. Behind
the visible guide is a reusable production pipeline combining deterministic
Playwright capture, controlled pointer guidance, code-driven Remotion timelines,
segmented replaceable narration, timing validation and provider-free smoke
rendering.

**Why it mattered:** invited teachers and judges had to understand an unfamiliar
Image-First workflow without a live explanation. The video is the visible
output; the reusable and updateable pipeline is the engineering contribution.

**Evidence:** [`ad6fef06`](https://github.com/JUJIES/SheetifyIMG-OpenAI-Build-Week-2026/commit/ad6fef06)
(`source: ce38a48`), [`5a195078`](https://github.com/JUJIES/SheetifyIMG-OpenAI-Build-Week-2026/commit/5a195078)
(`source: 3887eae`), [`193411a0`](https://github.com/JUJIES/SheetifyIMG-OpenAI-Build-Week-2026/commit/193411a0)
(`source: b9b19fc`), [`68c307ea`](https://github.com/JUJIES/SheetifyIMG-OpenAI-Build-Week-2026/commit/68c307ea)
(`source supplement: e9eb655`). The pipeline is product-support infrastructure,
not part of worksheet generation.

#### External Closed Beta validation

Six individual passes were shared during an approximately 55.5-hour Closed
Beta. Four consented participants became active. The sanitized persisted state
records 9 projects, 8 reaching generation, 31 generation jobs, 28 successful
drafts, 36 generated pages, 16 saved worksheet PDFs and 21 contextual feedback
entries from three participants. These figures demonstrate an external product
loop; they are not presented as adoption or learning-effectiveness claims.

The detailed, sanitized Beta Evidence Pack is supplied privately through
Devpost so tester credentials, messages and workspaces do not need to be
published in this repository.

#### Reproducible judge mirror and public project note

**What changed:** a fixed allowlist exports the deployed application from the
private canonical repository, audits the resulting tree and history, verifies
file hashes, installs dependencies and runs the provider-free judge suite. The
public mirror is licensed under MIT and carries machine-readable source
provenance. A separate public personal note and timeline explains the project
history and Build Week boundary visually.

**Why it mattered:** judges can inspect and run the relevant source without
publishing pass credentials, tester state, private deployment profiles or
unrelated experimental material.

**Evidence:** application mirror [`33f0908c`](https://github.com/JUJIES/SheetifyIMG-OpenAI-Build-Week-2026/commit/33f0908c)
(`source: 2a90c04`), pipeline supplement [`68c307ea`](https://github.com/JUJIES/SheetifyIMG-OpenAI-Build-Week-2026/commit/68c307ea)
(`source: e9eb655`), and the public note at
[about.sheetify.app](https://about.sheetify.app).

</details>

The meaningful transition was not “prototype to first generated page.” It was **personal tool to a hosted workflow that other people could enter, use, revisit and evaluate**.

A beta changed the standard: another person had to be able to use the application without me standing beside them. Every point of confusion now counted.

### Automated Demo & Onboarding Pipeline

The beta push created a second problem: testers and judges needed to understand
an unfamiliar Image-First workflow without a live explanation from me. During
Build Week, Codex therefore helped me build a reusable production tool around
the real application:

```text
reviewed tutorial scenario
-> deterministic Playwright browser capture
-> replaceable German or English narration
-> inspectable Remotion timeline
-> preview, render and human review
-> video published through the SheetifyIMG Guides experience
```

The pipeline is product-support infrastructure, not part of worksheet
generation. Keeping it isolated means teachers never need the video tool to
run SheetifyIMG, while onboarding footage can still be regenerated when the
interface changes. The accepted workflow supports real and provider-free
capture paths, stable pointer guidance, mobile and desktop framing, segmented
voice replacement and a generated smoke composition that judges can render
without an API key or private media.

The source and exact provider-free verification commands are under
[`tools/devpost-video/`](tools/devpost-video/). Raw captures, narration audio,
credentials, music and final video files remain outside Git.

---

## How I collaborated with Codex

During Build Week, I used Codex as the primary engineering environment across repository analysis, architectural planning, implementation, testing, debugging, deployment preparation and release cleanup.

My role was to define the classroom problem, set product and quality boundaries, compare approaches, inspect real outputs and decide what was ready for another person to use.

The process was a loop, not a hand-off:

```text
define the problem
→ compare options
→ build
→ inspect
→ test
→ revise
```

### Example 1 — Planning V2

I questioned why worksheet planning required so many model calls.

Codex mapped the existing call path, implemented a consolidated planning flow and created a real API A/B harness. The first targeted-revision design was actually more expensive than the legacy path because it reused an oversized full-concept prompt. The result was not hidden or rationalized away: the cause was traced, a compact structured delta contract was introduced and the corrected flow was measured again.

Across a controlled four-scenario, text-only workload:

- model calls fell from **27 to 14**;
- total tokens fell from **99,359 to 71,224**;
- estimated text-model cost fell from **$0.477141 to $0.378179**.

This comparison did not include image-generation cost. The complete raw report was not retained, and independent human blind quality review remains open. It is therefore reported as a bounded engineering measurement, not a general quality or cost claim.

### Example 2 — Testing the complete beta journey

I did not want an isolated model-endpoint test. I asked Codex to test the full product journey:

```text
invitation
→ pass activation
→ project
→ concept
→ approval
→ generation
→ credits
→ review
→ second device
→ email and recovery
```

That journey exposed problems involving page-count interpretation, browser timing and review evidence being attached to the wrong generated artifact. Those findings became concrete fixes and regression checks.

### Example 3 — The invisible work of becoming a beta

Long Codex runs went into persistent state, pass isolation, recovery paths, private administration, release checks and repository cleanup—parts users should not have to notice when they work properly.

That work changed my understanding of the project. Moving from a visible prototype to a beta another person can actually use can require more work than building the visible prototype itself.

Git records the resulting technical changes, but it cannot prove a line-by-line human/Codex authorship percentage. I do not claim one.

> **Codex expanded what I could build; it did not decide what the product should become.**

> **A very honest note about Git**
>
> Git is still, quite honestly, a book with seven seals to me. I can understand
> a straightforward commit. Add several branches, worktrees, mirrors and
> release tags, and my internal map quickly folds itself into a paper airplane.
>
> I therefore delegated most of the Git mechanics to Codex: inspecting working
> trees, isolating tasks, keeping unrelated changes out of commits, pushing
> branches, preparing releases and tracing which commit was actually deployed.
> I repeatedly prompted it to report the current state, intended scope,
> completed checks, exact release commit and available rollback before moving
> forward.
>
> This does not mean that I became a Git expert during Build Week. It means that,
> with careful prompting, automated checks and a lot of verification questions,
> I was able to build a process around a skill gap that would otherwise have
> stopped me completely. Without that help, I would probably still be lost
> somewhere between branch three and my first merge conflict.

The required primary `/feedback` Session ID is supplied privately through the Devpost submission rather than published in this repository.

---

## Key decisions I made

### Keep the teacher in the loop

I retained an explicit concept-approval step before paid image generation. A visually polished page is not automatically a suitable worksheet.

### Separate model semantics from application authority

GPT-5.6 interprets requests and proposes structured actions. Deterministic application code decides whether an action is authorized and whether the required approval and state conditions have been met.

### Choose Image-First without pretending it is risk-free

The earlier deterministic HTML/PDF renderer offered stronger text and layout guarantees, but its consistency became a visual limitation. GPT Image 2 produced more varied, visually integrated pages.

That did not prove that Image-First was universally better. It changed the technical question from “Can the model produce a good-looking page?” to “Can the system preserve an approved concept and support useful revision despite probabilistic rendering?”

### Use workspace passes instead of personal accounts

For a small invited beta, another signup and password flow would have created unnecessary friction. A SheetifyIMG Pass identifies a revocable workspace rather than a personal profile.

This is a deliberate bearer-credential trade-off, not a claim of complete identity security.

### Separate active projects from saved worksheets

Planning state and classroom-ready material have different lifecycles. Projects contain inputs, conversations, concepts and drafts; saved worksheets are immutable materials a teacher has deliberately selected for use.

### Keep one product for testers and judges

The English judge path is not a separate application fork. Interface locale belongs to the device, invitation locale belongs to the pass and worksheet language remains independent.

---

## Closed Beta during Build Week

The invited Closed Beta ran for approximately **55.5 hours**, from 18 July 2026 at around 15:30 to 20 July 2026 at around 23:00 Berlin time.

Six individual Beta Passes were shared. Four consented participants became active in anonymized, pass-scoped workspaces.

Four projects explored a water-cycle assignment family, although their prompts were not identical. Five additional project records explored other topics or variants. All four participants used text input; one also used an image reference; none used voice input.

### Persisted usage evidence

| Measure | Result |
|---|---:|
| Consented active participants | 4 |
| Persisted projects | 9 |
| Projects reaching generation | 8 |
| Generation jobs | 31 |
| Settled / refunded jobs | 28 / 3 |
| Successful candidate drafts | 28 |
| Generated pages | 36 |
| Approved concept versions | 15 |
| Visual-only follow-up candidates | 13 |
| Saved worksheet PDFs | 16 |
| Pages in saved PDFs | 21 |
| Contextual feedback entries | 21 from 3 participants |

### What the beta demonstrated

The beta showed that people beyond the builder could:

- activate access and enter an isolated workspace;
- plan a worksheet;
- inspect and approve a concept;
- generate complete visual pages;
- request alternatives or revisions;
- save worksheet PDFs;
- return to their work;
- submit contextual feedback.

It did **not** establish educational effectiveness, representative satisfaction, broad adoption or comparative superiority.

### What the beta exposed

Positive feedback focused on visual quality, perceived classroom usefulness and the ability to create variants.

The clearest product risk was semantic fidelity. Because `gpt-image-2` renders the complete page, including its text, a technically valid image can still misspell, omit or alter something that was correct in the approved concept. At least one reviewed variant passed technical artifact checks while omitting part of an approved instruction.

The beta also surfaced friction around onboarding, progress visibility, cancellation and reference-image state.

Feedback was concentrated heavily in one participant, and there is no maintained one-to-one feedback-to-commit map. This README therefore describes observed themes without claiming that a particular comment directly caused a particular code change.

The sanitized evidence pack contains the methodology, metrics, selected artifacts and evidence limits. It is supplied separately with the private Devpost judge material rather than stored in this source repository.

---

## Repository provenance

This repository is the filtered, public judge-facing release mirror of SheetifyIMG. Its source code is available under the MIT License.

Development, testing and production deployment take place in a private canonical repository. That repository also contains internal worklogs, private beta evidence, generated outputs, runtime data and host-specific operational material that are not required to run or evaluate the submitted product.

For publication, the verified product source is exported through a fixed allowlist. The mirror includes the complete local evaluation path:

- the application and browser interface;
- the local Node.js server;
- model prompts and routing configuration;
- deterministic workflow and authorization rules;
- the isolated automated demo and onboarding pipeline;
- judge setup, Build Week boundary and publication-scope documentation;
- selected reproducible tests.

The following categories are intentionally excluded:

- secrets, sessions and runtime state;
- user and Closed Beta data;
- generated worksheets and paid model outputs;
- internal worklogs and temporary evidence;
- raw recordings, narration audio, staged media and rendered video outputs;
- legacy experiments and large proof-of-concept fixtures;
- host-specific private deployment configuration.

The judge mirror is not a separate implementation and is not developed independently. Every mirror version is derived from an identified upstream release commit and checked against the canonical source using file hashes.

Because filtering rewrites Git history, mirror commit hashes can differ from their private upstream equivalents. Retained commits preserve their original author metadata, timestamps, messages and relative order. Commits that only changed excluded files may not appear in the mirror history.

See:

- [`SOURCE_PROVENANCE.md`](SOURCE_PROVENANCE.md) for the exact canonical source release and export-policy receipt;
- [`SOURCE_PROVENANCE.json`](SOURCE_PROVENANCE.json) for SHA-256 hashes of every exported runtime and overlay file;
- [`PUBLICATION_SCOPE.md`](PUBLICATION_SCOPE.md) for the fixed inclusion and exclusion rules.

The immutable `openai-build-week-2026-final` tag identifies the application
release that was deployed and frozen. The current `main` branch is the complete
judge-facing repository; it additionally includes the audited demo-pipeline
source exported from that same canonical source commit. No application runtime
file changed in this publication-only supplement.

---

## Run locally

### Requirements

- Git
- Node.js `20.19.x`
- npm `10.8.x`
- a modern browser
- an OpenAI API key with access to the required models

### Installation

Clone the judge release mirror:

```bash
git clone https://github.com/JUJIES/SheetifyIMG-OpenAI-Build-Week-2026.git
cd SheetifyIMG-OpenAI-Build-Week-2026
npm ci
```

Create `.env.local` in the repository root:

```env
OPENAI_API_KEY=your_openai_api_key

# Explicit pins for the submitted configuration:
SHEETIFYIMG_AI_MODE=openai
SHEETIFYIMG_TEXT_MODEL=gpt-5.6-luna
SHEETIFYIMG_REASONING_MODEL=gpt-5.6-sol
SHEETIFYIMG_IMAGE_MODEL=gpt-image-2
SHEETIFYIMG_PLANNING_FLOW=v2
SHEETIFYIMG_IMAGE_PROVIDER=openai
SHEETIFYIMG_IMAGE_PRESET=standard
```

Only `OPENAI_API_KEY` is required for normal local model use; the submitted model and workflow values shown above are application defaults. They are listed explicitly to make the judge configuration visible and reproducible.

Validate the release source and start the development server:

```bash
npm run build
npm run test:judge
npm start
```

Open:

```text
http://127.0.0.1:4173/?lang=en
```

The local development path does not require:

- a Beta Pass;
- the hosted email service;
- Cloudflare Tunnel;
- owner authentication;
- production credentials;
- the private administration environment.

Local data is written to Git-ignored paths:

```text
projects/       local project artifacts and generated candidates
worksheets/     locally saved worksheet snapshots and PDFs
.sheetifyimg/   local state and logs
```

> **API cost notice:** Conversations, concept creation, revisions, transcription and worksheet rendering can make real OpenAI API calls and may incur charges on the supplied API key.

> **Security:** Never commit `.env.local`, an API key, Judge Pass credentials or production secrets.

### Local sample task

After opening the app, create a project and enter:

> Create a Grade 5 worksheet about the water cycle. Include a clear visual explanation, a short reading section and three age-appropriate comprehension tasks.

Review the proposed concept, change one task, approve it, generate a draft and save the preferred result as a worksheet PDF.

---

## Verification and tests

### Provider-free judge checks

These commands validate the release source and judge path without making paid model calls:

```bash
npm run build
npm run test:judge
```

`npm run build` is a release-source validator rather than a conventional frontend bundle step. It checks required files and JavaScript syntax.

For the optional browser-level check:

```bash
npx playwright install chromium
npm run test:judge:browser
```

These verification commands are provider-free. Product conversations, concept creation, revisions, transcription and worksheet rendering can make live OpenAI API calls once the locally configured server is used with an API key.

### Provider-free demo-pipeline check

The published onboarding tool has a separate dependency boundary. It can be
installed, typechecked and rendered without an OpenAI or ElevenLabs key:

```bash
npm run test:video-tool
```

The command produces a generated smoke video at
`tools/devpost-video/out/pipeline-smoke.mp4`. Production compositions that use
real UI footage remain inspectable, but require separately staged, reviewed
media and are not part of this verification path.

The hosted beta remains the recommended evaluation route because it represents the complete submitted experience and has already been configured for judge access.

---

## Technical architecture

SheetifyIMG is a browser application served by a Node.js server. It uses file-based, versioned product artifacts rather than requiring a separate database for the local evaluation path.

### Main boundaries

- **Browser UI:** project creation, conversation, concept review, generation, comparison and worksheet archive
- **Development server:** local API and static application delivery
- **Production server:** hosted runtime with explicit owner-auth and beta-access gates
- **Model router:** deterministic selection of GPT-5.6 and image-model roles
- **Project artifacts:** inputs, conversation events, concept versions, runs and candidates
- **Worksheet archive:** saved worksheet snapshots and PDFs
- **Runtime state:** sessions, pass state, logs and operational metadata
- **Demo and onboarding tool:** deterministic UI capture, replaceable narration contracts and code-driven video timelines
- **Testing:** smoke, browser/UX, real-API and hosted-journey checks

### Repository map

```text
core/                  application logic, state managers and model orchestration
server/                local development and production server entry points
public/                browser UI and static assets
scripts/               audits, smoke tests and release tooling
tools/devpost-video/    isolated automated demo and onboarding pipeline
prompts/               versioned model instructions
rules/                 deterministic workflow and authorization rules
SOURCE_PROVENANCE.md    canonical source and publication receipt
SOURCE_PROVENANCE.json  machine-readable source and file-hash receipt
PUBLICATION_SCOPE.md    fixed judge-mirror allowlist and exclusions
BUILD_WEEK.md           pre-existing-product and Build Week boundary
```

Runtime-created `projects/`, `worksheets/` and `.sheetifyimg/` directories are excluded from the release mirror.

---

## Privacy and security boundaries

- No student data or personal profile is required to evaluate the core workflow.
- Judge and tester credentials are not stored in this repository.
- Local `.env` files, project data, generated worksheets and runtime state are ignored by Git.
- Closed Beta evidence is sanitized before publication.
- Names, email addresses, pass codes, tokens and private conversation content are excluded from the public evidence pack.
- Hosted production secrets and user state remain outside the immutable application release.
- Beta Passes are revocable bearer credentials. Their isolation has been tested, but the system has not undergone an independent penetration test.
- Content supplied for model-assisted planning or generation is sent to the configured OpenAI services. Teachers remain responsible for deciding what material is appropriate to submit.

---

## Known limitations

### Semantic and textual fidelity

`gpt-image-2` renders the complete worksheet, including its text. This provides much of the visual coherence of the Image-First approach, but it also creates its clearest reliability gap: the final image can misspell, omit or change text that was correct in the approved concept.

Technical artifact checks do not yet guarantee semantic equivalence. An OCR- or vision-based comparison between approved content and rendered pages is an important next step.

### Small and non-representative beta

The Closed Beta involved four active participants from a small invited circle. It is evidence of a functioning external product loop, not evidence of broad demand or educational effectiveness.

### Probabilistic iteration

Image-First production is less deterministic than an HTML/PDF renderer. Some worksheets require another generation or a targeted revision.

### API cost

The hosted Closed Beta currently absorbs model usage costs. Broader availability would require a sustainable access and billing model.

### Evolving model boundaries

SheetifyIMG is built around the current strengths and limits of GPT-5.6 and GPT Image 2. Better models may simplify, replace or reshape parts of the pipeline. The project is an experiment around a real classroom workflow, not a claim that this exact model configuration is its final form.

---

## Evidence and further reading

### Submission and provenance

- [`SOURCE_PROVENANCE.md`](SOURCE_PROVENANCE.md)
- [`SOURCE_PROVENANCE.json`](SOURCE_PROVENANCE.json)
- [`PUBLICATION_SCOPE.md`](PUBLICATION_SCOPE.md)
- [`BUILD_WEEK.md`](BUILD_WEEK.md)
- [`THIRD_PARTY_NOTICES.md`](THIRD_PARTY_NOTICES.md)
- Frozen application release tag: `openai-build-week-2026-final`
- Complete judge-facing submission source: current `main`

### External submission material

- English onboarding walkthrough: https://youtu.be/zbgVeGDTo7o
- Sanitized Closed Beta evidence: supplied with the private Devpost judge material
- Personal project note and timeline: https://aboutsheetify.jujies.app

The personal note contains the longer classroom background and the history of the move from a deterministic renderer to the current Image-First approach. This README keeps that story brief and focuses on evaluation, implementation, Build Week provenance and evidence.

---

## License and third-party services

The SheetifyIMG source code in this judge mirror is licensed under the [MIT License](LICENSE). Redistributed third-party components retain their own licenses; see [`THIRD_PARTY_NOTICES.md`](THIRD_PARTY_NOTICES.md).

SheetifyIMG uses the OpenAI API for GPT-5.6 planning, GPT Image 2 rendering and optional voice transcription. The hosted beta can also use Resend for transactional email. JavaScript dependencies and their versions are recorded in `package.json` and `package-lock.json`.

---

## Final submission record

```text
Track: Education
Private upstream baseline: cfd4a4f4cc40f55b03621161c702771a4dda855c
Current source and mirror receipt: SOURCE_PROVENANCE.json
Frozen application release tag: openai-build-week-2026-final
Complete judge-facing submission source: current main
Hosted release identifier: exact source commit reported by /health and the release receipt
```

SheetifyIMG was not built from scratch during Build Week.

The event turned an existing personal classroom workflow into a hosted Closed Beta with access control, persistent state, external testing, contextual feedback, release checks and a reproducible judge path.

GPT-5.6 did not make the project build itself. It made a project like this buildable for me. It still required a great deal of work, judgment and persistence—but I no longer have to wait for someone else to release exactly the classroom tool I need.
