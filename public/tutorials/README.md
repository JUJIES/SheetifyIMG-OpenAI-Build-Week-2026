# Tutorial videos

Upload the finished intro video to YouTube as **public** or **unlisted** and
leave embedding enabled. Unlisted is the recommended beta setting: the video
does not appear in normal search results, but anyone with the link can watch it.

For the beta release, paste the reviewed video's full YouTube link into the
empty `youtubeUrl` field in `core/tutorialManager/index.js`. That is the only
source change needed before shipping.

The service can optionally override that repository fallback at runtime with:

```txt
SHEETIFYIMG_TUTORIAL_FIRST_WORKSHEET_URL=https://youtu.be/VIDEO_ID
```

Common `youtube.com/watch`, `youtu.be`, `shorts`, `live` and embed links are
accepted; no media deployment is required. Empty or invalid runtime overrides
fall back to the reviewed repository link.

The app exposes only the validated video ID to authenticated devices. It opens
the intro modal once after beta consent, but it does not contact YouTube until
the teacher explicitly clicks `Video starten`. Playback then uses the
privacy-enhanced `youtube-nocookie.com` player.

Keep future tutorial metadata in `core/tutorialManager` and add their runtime
source variables through `server/runtime-config.js`.
