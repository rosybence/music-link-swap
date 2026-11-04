# Music Link Swap

Android app: tap a Spotify link and it plays in YouTube Music; share a song from YouTube Music and WhatsApp opens with the Spotify link (or a YouTube link if it isn't on Spotify).

- `logic/convert.js` is the matching script. The app downloads it on every run, so editing it changes behaviour without reinstalling.
- `app/` is the Android app. Pushing changes there builds a new release automatically; the app offers it as an update.

Install: download `MusicLinkSwap.apk` from the latest release.
