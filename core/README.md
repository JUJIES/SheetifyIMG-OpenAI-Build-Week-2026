# Core

This folder contains deterministic SheetifyIMG runtime logic.

Current production-facing boundaries:

- `contracts/` contains shared v0.2 constants and vocabulary.
- `artifactManager/` reads and writes `artifact-index.json`.
- `eventLog/` appends and reads `chat-events.jsonl`.
- `statusSnapshot/` owns `status-snapshot.json` shapes.
- `projectValidator/` distinguishes production v0.2 projects from legacy data.
- `briefManager/` creates and approves versioned lesson briefs.
- `contentMirrorManager/` creates and approves versioned content mirrors.
- `contentWarningManager/` stores versioned content warning state.
- `approvalManager/` enforces the explicit content approval gate.
- `runManager/` creates deterministic generation runs from approved state.
- `candidateManager/` registers generated or pending image candidates.
- `imageAssetManager/` stores generated image assets and sidecar metadata.
- `imageGenerationManager/` creates confirmed image candidates through OpenAI.
- `imageQcManager/` runs technical checks for candidate image files.
- `selectionManager/` records selected candidates and copies selected pages.
- `exportManager/` prepares export bundles from selected pages.
- `dotToDotManager/` creates deterministic ordered dot-pattern reference
  packages for later image-first worksheet generation.
- `seriesManager/` records worksheet membership in a series.
- `seriesExportManager/` prepares deterministic series bundle manifests.
- `workspaceManager/` builds the UI-facing workspace view model and copy context.
- `workspaceCommandManager/` routes explicit UI commands to deterministic managers.
- `aiConfig/` reads local AI runtime settings without exposing secrets.
- `openaiClient/` contains the minimal Responses API transport.
- `aiToolRegistry/` maps enabled workspace commands to safe AI tool suggestions.
- `aiChatManager/` uses OpenAI chat and stores chat events.
- `aiProposalManager/` creates structured AI proposals and adopts them only via
  explicit commands.
- `legacy/` maps old normalized fixture manifests into runtime-facing values.
- existing managers may read legacy projects, but new managers should target the
  v0.2 contracts first.

Legacy-only concepts such as `kind`, `normalized_from_fixture`, and
`normalizationWarnings` should not spread into new production managers.
