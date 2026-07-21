# Automated Demo & Onboarding Pipeline

This isolated tool turns reviewed SheetifyIMG journeys into repeatable product
demos and onboarding videos. It is part of the Closed Beta's onboarding and
release infrastructure, while remaining outside the worksheet-generation
runtime.

```text
reviewed tutorial scenario
-> deterministic Playwright capture
-> replaceable narration segments
-> code-driven Remotion timeline
-> preview and final render
-> human privacy, accuracy and audio review
-> tutorial video consumed by the SheetifyIMG Guides UI
```

The visible video is an output. The reusable Build Week work is the system
behind it: stable browser journeys, explicit capture profiles, reusable
desktop/mobile footage, replaceable German and English narration, inspectable
timeline code and repeatable delivery checks.

## Product boundary

- SheetifyIMG remains the teacher-facing product and worksheet generator.
- This directory is a separately installed product-support tool.
- The application consumes approved tutorial URLs through its existing
  tutorial manager and Guides interface.
- The tool does not run inside the production request path and does not add
  Remotion dependencies to the main application package.
- Generated videos never change worksheet or project state.

That boundary is intentional: onboarding production is integrated with the
product lifecycle without making video rendering a requirement for teachers.

## Public, provider-free verification

From the repository root:

```bash
npm --prefix tools/devpost-video ci
npm --prefix tools/devpost-video run check
npm --prefix tools/devpost-video run compositions
npm --prefix tools/devpost-video run render:smoke
```

`render:smoke` creates `tools/devpost-video/out/pipeline-smoke.mp4` entirely
from generated cards. It needs no OpenAI key, ElevenLabs key, Beta Pass,
recording or private media. This verifies that the published timeline source
can be installed, typechecked and rendered without rebuilding the real
submission footage.

The other compositions are included as inspectable production source. They
expect locally staged, reviewed media under `public/media/`, which is ignored
by Git. They are not required for the provider-free verification path.

## Reproducible UI capture

The root repository contains the corresponding Playwright capture layer:

- `scripts/capture-paid-devpost-demo.js` records a real isolated app journey;
- `scripts/capture-existing-paid-demo.js` records a provider-free replay of a
  previously prepared disposable runtime;
- `scripts/capture-voice-input-demo.js` records the voice-input journey;
- `scripts/demo-capture-pointer.js` provides stable cursor and click guidance;
- `scripts/demo-capture-voice.js` provides the capture-side voice contract;
- `scripts/verify-english-capture-ui.js` checks the English capture surface.

The accepted English Build Week capture profile is stored in
`config/capture-profiles.json` with a synthetic earthquake scenario. The real
paid capture command is deliberately not part of the default verification
path because it makes GPT-5.6 and `gpt-image-2` calls and may incur API cost.

## Why Remotion

- React code is the editable timeline source of truth.
- Timing, crops, callouts, captions and transitions remain inspectable.
- The same source can render another language or updated UI capture.
- Preview renders do not require repeating an expensive model-backed journey.

The project pins Remotion `4.0.490`, React `18.3.1` and TypeScript `5.9.3`.
Remotion is used under its own license; it is not relicensed by this
repository's MIT License. See the repository-level third-party notices and the
current Remotion licensing terms before reuse.

## Narration and media boundary

Narration is represented as replaceable segments. ElevenLabs was used for the
reviewed AI voice workflow, but its API key, generated audio and local secret
enrollment remain outside this repository. A human voice or another authorized
provider can replace the audio without changing the UI capture.

The repository intentionally excludes:

- API keys, Beta Passes and production credentials;
- raw paid-run traces and live workspace state;
- staged screenshots, recordings and narration audio;
- music and sound-effect binaries;
- rendered previews and final videos;
- machine-specific paths and host configuration.

Only synthetic or explicitly reviewed capture material belongs in the public
pipeline. Publication still requires human review for privacy, factual
accuracy, captions, audio and third-party rights.

## Build Week provenance

The original private source path was introduced and iterated during the Build
Week submission period. The principal canonical commits that changed the
capture or video-production path are:

| Date (CEST) | Canonical commit | Milestone |
|---|---|---|
| 2026-07-16 | `325442a4771e2d25d1a4302996dddd917bc79676` | Build Week video workspace and first reproducible pipeline checkpoint |
| 2026-07-17 | `bec33381cdf511707e42712cf08e49ed0496786d` | Mobile beta capture and presentation consistency |
| 2026-07-18 | `a5526771c4db5bb3cb4ac67a05dd07a411b94fc5` | Chat-first journey and reusable production flow |
| 2026-07-21 | `b73ac5654f57e5dbde5fcaf0460a16d254ae24c3` | Clean English paid Devpost capture profile and locale verification |

The public `SOURCE_PROVENANCE.json` receipt identifies the exact canonical
source commit from which these files were exported. The tool is not a
separately developed Judge-only implementation.

Evidence limit: this pipeline is Beta onboarding and release infrastructure,
not a core worksheet-generation feature, and a successful render does not by
itself prove onboarding effectiveness.
