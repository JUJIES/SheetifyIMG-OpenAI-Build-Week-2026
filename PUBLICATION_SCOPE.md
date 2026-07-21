# Judge mirror publication scope

This repository is generated from the private canonical SheetifyIMG repository.
It is not edited as an independent product fork.

## Included

- the runtime product core;
- the browser UI and required static assets;
- prompts and rules used by the product;
- the local development and production server implementation;
- the locked npm dependency graph;
- a small, provider-free judge verification suite;
- judge setup, Build Week boundary and provenance documents;
- the project-level MIT License and third-party notices.

## Deliberately excluded

- local and hosted runtime state;
- Beta Pass codes, sessions, feedback and tester workspaces;
- generated worksheets, screenshots, recordings and paid-run traces;
- private deployment profiles, tunnels, admin operations and machine paths;
- experimental fixture corpora and retired prototypes;
- internal planning notes and unpublished Devpost drafts;
- environment files, credentials and API keys.

## One-source-of-truth contract

1. Product changes happen only in the private canonical repository.
2. A candidate is tested and deployed through the SheetifyIMG Beta release
   workflow.
3. Only the exact successfully deployed commit may be exported.
4. The exporter uses a fixed allowlist, scans the resulting tree and history,
   verifies hashes, installs dependencies, builds and runs the judge tests.
5. Mirror updates are fast-forward-only. The tool never force-pushes or rewrites
   an already published mirror branch.
6. At submission freeze, the final source and mirror commits receive the same
   submission tag and automatic syncing is disabled.

`SOURCE_PROVENANCE.json` is the machine-readable receipt for the current export.
Git SHAs differ because private-only paths are omitted and publication metadata
is added; the file hashes prove which runtime files came from the named source
commit.

## Visibility and licensing

The mirror was created as a private review repository and audited before
publication. It is published under the MIT License stored at the repository
root. Third-party notices remain governed by their respective licenses and are
summarized in `THIRD_PARTY_NOTICES.md`.

