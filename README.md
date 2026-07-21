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
- **Personal project note and timeline:** https://about.sheetify.app
- **Sanitized Closed Beta evidence:** supplied with the private Devpost judge material
- **Submission tag:** `openai-build-week-2026-final` (created only at the final freeze)

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

### What changed during Build Week

| Workstream | Substantial Build Week work |
|---|---|
| Planning V2 | Consolidated conversational planning, unified concept creation, bounded revision deltas, rollback support and controlled measurement |
| Closed-beta access | Pass-scoped workspaces, persistent sessions, device pairing, scoped files and draft-page credits |
| Beta operations | Private invitations, top-ups, pause/revoke/delete controls, support and recovery paths |
| Feedback and consent | Per-device consent, voluntary contextual feedback and a private review queue |
| Reliability | Duplicate-command protection, generation-job recovery, artifact binding checks and regression coverage |
| Judge and language path | English entry, bilingual interface handling, onboarding and end-to-end judge-path validation |
| Hosted operation | Commit-pinned releases, external runtime state, health checks and deployment preflight |
| Evidence and release preparation | Build Week documentation, test records, sanitized beta metrics and a filtered judge-facing repository mirror |

The meaningful transition was not “prototype to first generated page.” It was **personal tool to a hosted workflow that other people could enter, use, revisit and evaluate**.

A beta changed the standard: another person had to be able to use the application without me standing beside them. Every point of confusion now counted.

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
- judge setup, Build Week boundary and publication-scope documentation;
- selected reproducible tests.

The following categories are intentionally excluded:

- secrets, sessions and runtime state;
- user and Closed Beta data;
- generated worksheets and paid model outputs;
- internal worklogs and temporary evidence;
- raw media-production assets;
- legacy experiments and large proof-of-concept fixtures;
- host-specific private deployment configuration.

The judge mirror is not a separate implementation and is not developed independently. Every mirror version is derived from an identified upstream release commit and checked against the canonical source using file hashes.

Because filtering rewrites Git history, mirror commit hashes can differ from their private upstream equivalents. Retained commits preserve their original author metadata, timestamps, messages and relative order. Commits that only changed excluded files may not appear in the mirror history.

See:

- [`SOURCE_PROVENANCE.md`](SOURCE_PROVENANCE.md) for the exact canonical source release and export-policy receipt;
- [`SOURCE_PROVENANCE.json`](SOURCE_PROVENANCE.json) for SHA-256 hashes of every exported runtime and overlay file;
- [`PUBLICATION_SCOPE.md`](PUBLICATION_SCOPE.md) for the fixed inclusion and exclusion rules.

At the final submission freeze, the canonical source and judge mirror will both receive the immutable Git tag `openai-build-week-2026-final`.

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
- **Testing:** smoke, browser/UX, real-API and hosted-journey checks

### Repository map

```text
core/                  application logic, state managers and model orchestration
server/                local development and production server entry points
public/                browser UI and static assets
scripts/               audits, smoke tests and release tooling
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
- Immutable submission tag at final freeze: `openai-build-week-2026-final`

### External submission material

- English onboarding walkthrough: https://youtu.be/zbgVeGDTo7o
- Sanitized Closed Beta evidence: supplied with the private Devpost judge material
- Personal project note and timeline: https://about.sheetify.app

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
Immutable submission tag at final freeze: openai-build-week-2026-final
Hosted release identifier: exact source commit reported by /health and the release receipt
```

SheetifyIMG was not built from scratch during Build Week.

The event turned an existing personal classroom workflow into a hosted Closed Beta with access control, persistent state, external testing, contextual feedback, release checks and a reproducible judge path.

GPT-5.6 did not make the project build itself. It made a project like this buildable for me. It still required a great deal of work, judgment and persistence—but I no longer have to wait for someone else to release exactly the classroom tool I need.
