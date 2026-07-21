# OpenAI Build Week 2026 boundary

## Before July 13, 2026

- Sheetify already had a deterministic worksheet-rendering approach.
- SheetifyIMG emerged as a separate image-first proof of concept while testing
  a new pipeline.
- The early prototype demonstrated the core generation idea before it had the
  complete hosted Beta experience.

## During Build Week

The submission period became the forcing function for a Beta push that was
already personally important: make the product available to real colleagues
after the summer break, rather than leave it as another private experiment.

The relevant work includes:

- migration to the Beelink and integration into a stable self-hosted service;
- Closed Beta access passes, isolated workspaces and credit limits;
- the English judge entry path and localization fixes;
- the Beta-ready overhaul of the existing teacher-in-the-loop flow, including
  the interactive Worksheet Concept, explicit reference/revision logic and a
  chat-first responsive interface;
- mobile and desktop UI refinement, accessibility and reliability work;
- admin, feedback and operational safeguards needed for real testers;
- provider-free smoke tests plus targeted real OpenAI end-to-end checks;
- an automated Playwright capture and onboarding-video pipeline;
- deployment, documentation, provenance and judge-access preparation.

The hosted product necessarily demonstrates one coherent experience, including
the core image-first idea that existed before the event. The submission does
not claim that pre-existing work was created during Build Week. Instead, the
commit history and source provenance show the implementation chronology, while
the timeline and Devpost materials identify the Beta work completed during the
eligible period.

The canonical capability-by-capability inventory is maintained in the
`Commit-backed Build Week work directory` inside `README.md`. This file records
the temporal boundary only, avoiding a second detailed list that could drift.

## Evidence model

- Git commits provide dated implementation evidence.
- `SOURCE_PROVENANCE.json` maps each generated mirror revision to the exact
  canonical source commit.
- The hosted Judge Beta Passes provide isolated real-product access.
- Devpost screenshots, the demo video and the separate Beta Evidence Pack show
  real workflows and results without publishing tester credentials or data.

