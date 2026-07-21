# Third-party notices

SheetifyIMG includes the following redistributed third-party assets. Their
licenses apply to those components only and do not define the license of the
SheetifyIMG project itself.

## Lucide icons

Files under `public/icons/lucide/` are derived from the Lucide icon project.

ISC License

Copyright (c) 2026 Lucide Icons and Contributors

Permission to use, copy, modify, and/or distribute this software for any
purpose with or without fee is hereby granted, provided that the above
copyright notice and this permission notice appear in all copies.

THE SOFTWARE IS PROVIDED "AS IS" AND THE AUTHOR DISCLAIMS ALL WARRANTIES WITH
REGARD TO THIS SOFTWARE INCLUDING ALL IMPLIED WARRANTIES OF MERCHANTABILITY
AND FITNESS. IN NO EVENT SHALL THE AUTHOR BE LIABLE FOR ANY SPECIAL, DIRECT,
INDIRECT, OR CONSEQUENTIAL DAMAGES OR ANY DAMAGES WHATSOEVER RESULTING FROM
LOSS OF USE, DATA OR PROFITS, WHETHER IN AN ACTION OF CONTRACT, NEGLIGENCE OR
OTHER TORTIOUS ACTION, ARISING OUT OF OR IN CONNECTION WITH THE USE OR
PERFORMANCE OF THIS SOFTWARE.

Some Lucide icons are derived from Feather and are distributed under the MIT
License:

Copyright (c) 2013-present Cole Bemis

Permission is hereby granted, free of charge, to any person obtaining a copy of
this software and associated documentation files (the "Software"), to deal in
the Software without restriction, including without limitation the rights to
use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of
the Software, and to permit persons to whom the Software is furnished to do so,
subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.

Source and current license: <https://github.com/lucide-icons/lucide>

## Circle Flags

The German and British language flags under `public/icons/flags/` are adapted
from Circle Flags. The included `public/icons/flags/NOTICE.md` carries its MIT
license and copyright notice.

Source: <https://github.com/HatScripts/circle-flags>

## SimpleBar

The vendored SimpleBar browser files under `public/vendor/simplebar/` retain the
project's MIT license in `public/vendor/simplebar/LICENSE`.

Source: <https://github.com/Grsmto/simplebar>

## Demo and onboarding pipeline dependencies

The separately installed tool under `tools/devpost-video/` declares, but does
not vendor, the following npm dependencies. Their own licenses and terms apply.

### Remotion

The code-driven video timeline uses Remotion `4.0.490`, including
`@remotion/cli`, `@remotion/captions` and `@remotion/transitions`. Remotion is
distributed under its own license and is not relicensed by SheetifyIMG's MIT
License. The project was developed and rendered by an individual under the
free-license eligibility described by Remotion. Reusers must check the current
terms for their own use.

License and current terms: <https://www.remotion.dev/license>

### React

The Remotion compositions use React and React DOM `18.3.1`, distributed under
the MIT License.

Source and license: <https://github.com/facebook/react>

### Playwright

The deterministic browser-capture layer uses Playwright through
`@playwright/test`, distributed under the Apache License 2.0.

Source and license: <https://github.com/microsoft/playwright>

## External media and narration services

ElevenLabs was used as an external narration provider during production. Its
SDK, API key and generated audio are not redistributed in this repository.
Raw recordings, music, sound-effect binaries and final rendered videos are also
excluded; publication of those outputs requires a separate rights review.

