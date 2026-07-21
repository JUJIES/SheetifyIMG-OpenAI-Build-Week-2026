# SheetifyIMG

**An image-first worksheet generator that keeps the teacher in the loop.**

This repository is the reproducible judge mirror for the SheetifyIMG submission
to OpenAI Build Week 2026. The primary judging path is the hosted Closed Beta;
the URL and four isolated Judge Beta Passes are provided in Devpost's private
judge-access field. This repository is the inspectable and locally runnable
fallback.

## What SheetifyIMG does

SheetifyIMG turns a teacher's brief, source material and references into a
reviewable worksheet concept. It then translates the approved content into an
internal image specification and a controlled generation prompt. The image
model creates the complete worksheet as one visual composition. The teacher
reviews, revises, compares and deliberately saves the result.

```text
Teaching input
  -> worksheet concept
  -> internal image specification
  -> controlled image prompt
  -> complete visual generation
  -> teacher review and revision
  -> saved worksheet
```

The goal is not to replace the teacher's decisions with bulk content. AI does
the production work while the teacher retains control over subject matter,
wording, didactics and the accepted result.

## Fastest way to evaluate

1. Use the hosted Closed Beta and a Judge Beta Pass from the private Devpost
   field. This is the recommended path and matches the real tester experience.
2. Use this repository only when you want to inspect the implementation or run
   an independent local fallback.

No pass codes, tester projects, generated worksheets, production configuration
or secrets are stored in this mirror.

## Local setup

Prerequisites:

- Node.js `20.19.x` (the validated version is `20.19.5`)
- npm `10.8.x`
- an OpenAI API key for real planning and image-generation calls

```bash
git clone https://github.com/JUJIES/SheetifyIMG-OpenAI-Build-Week-2026.git
cd SheetifyIMG-OpenAI-Build-Week-2026
npm ci
```

Copy `.env.example` to `.env.local`, then replace the placeholder in the new
file with your own key:

```text
OPENAI_API_KEY=your-key-here
```

Do not commit `.env.local`. The file is ignored by Git. Calls made from a local
clone use the configured OpenAI account and may incur API charges.

Validate and start the local fallback:

```bash
npm run build
npm run test:judge
npm start
```

Then open [http://127.0.0.1:4173/?lang=en](http://127.0.0.1:4173/?lang=en).
Local development mode intentionally starts without the hosted pass system and
stores any local project data only inside the clone. Stop the server with
`Ctrl+C`.

For the optional browser-level smoke test:

```bash
npx playwright install chromium
npm run test:judge:browser
```

## Build Week boundary

SheetifyIMG did not begin as a blank repository on July 13. Before Build Week,
an image-first proof of concept had already emerged from experiments alongside
the earlier deterministic Sheetify renderer. The Build Week work was the push
from a personal prototype toward a real, hosted Closed Beta: Beelink hosting,
access passes, isolated workspaces, the English judge path, product and mobile
UI refinement, reliability work, feedback surfaces, test coverage, and an
automated demo/onboarding capture pipeline.

That distinction is documented in [BUILD_WEEK.md](BUILD_WEEK.md). Every mirror
revision is tied to one exact private source commit in
[SOURCE_PROVENANCE.md](SOURCE_PROVENANCE.md). The filtered history preserves the
relevant implementation chronology, while private operations and tester data
remain outside this repository.

## Role of OpenAI and Codex

- GPT-5.6 through the Responses API powers the conversational planning and
  structured worksheet-concept workflow.
- `gpt-image-2` renders the complete worksheet composition from approved
  content and the internally assembled image prompt.
- GPT-5.6 and Codex supported implementation, architecture, localization,
  testing, failure analysis, documentation and the reproducible
  Playwright-based demo workflow during Build Week.
- The teacher remains responsible for the teaching goal, source material,
  content decisions, revisions and final acceptance.

## Repository status

This is a generated review mirror, not a second development repository. Product
changes are made in the private canonical repository, tested and deployed, and
only then exported here through a fixed allowlist. See
[PUBLICATION_SCOPE.md](PUBLICATION_SCOPE.md) for the exact boundary.

