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
- `imageGenerationManager/` orchestrates confirmed Entwurf generation: approval
  gate, run reuse, provider dispatch, registration, and QC.
- `imageGenerationManager/promptBuilder.js` owns deterministic page prompt
  building from approved concept state and the adopted internal ImageSpec.
- `imageGenerationManager/referenceImages.js` normalizes and bounds in-project
  reference images before a provider can use them.
- `imageGenerationManager/providerAssets.js` isolates OpenAI and Codex image
  provider calls plus generated asset sidecar metadata.
- `imageQcManager/` runs technical checks for candidate image files.
- `dotToDotManager/` creates deterministic ordered dot-pattern reference
  packages for later image-first worksheet generation.
- `workspaceManager/` builds the UI-facing workspace view model and copy context.
- `workspaceCommandManager/` validates explicit UI commands and dispatches them to
  deterministic handlers.
- `workspaceCommandHandlers/` contains the grouped command execution logic for
  concept, image-prep, candidate, and worksheet commands.
- `workspaceCommandDrafts/` builds deterministic fallback drafts for explicit
  workspace draft commands.
- `workflowState/` is the 0.1 workflow kernel: it derives workflow facts,
  default UI/chat action suggestions, and guarded command validity.
- `workflowPolicy/` is a compatibility export for the 0.1 workflow kernel.
- `chatIntentSignals/` contains shared deterministic text signals used by chat
  intent classification and command resolution.
- `chatIntentInterpreter/` classifies teacher chat messages into one guarded
  workflow intent decision before any command is considered.
- `chatCommandResolver/` maps safe workflow intents or explicit confirmations to
  executable commands or confirmation offers.
- `aiConfig/` reads local AI runtime settings without exposing secrets.
- `openaiClient/` contains the minimal Responses API transport.
- `aiToolRegistry/` maps enabled workspace commands to safe AI tool suggestions.
- `aiChatManager/` orchestrates chat events, local guarded responses, command
  execution, and OpenAI chat responses through small vertical modules.
- `aiProposalManager/` creates structured AI proposals and adopts them only via
  explicit commands.
- `legacy/` maps old normalized fixture manifests into runtime-facing values.
- existing managers may read legacy projects, but new managers should target the
  v0.2 contracts first.

Retired POC helpers such as the old selected-page workflow, project-local export
workflow, and legacy routing policy live under `legacy-retired/core/`. They are
not part of the MVP production path. The current path stores approved image
drafts through `worksheetLibraryManager/`.

Legacy-only concepts such as `kind`, `normalized_from_fixture`, and
`normalizationWarnings` should not spread into new production managers.
