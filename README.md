# chrome-amazon-prime-video-shuffle

Chrome extension that reroutes Amazon Prime Video TV playback through random episode selection.

## Current behavior

- On a TV show title page, picks a random season and then a random episode.
- Navigates to the selected episode with autoplay intent.
- In player view, manual **Next Episode** interactions are intercepted and routed back to title-page randomization.
- End-of-episode next-up UI is intercepted to reroute to randomization instead of sequential playback.

## Files

- `manifest.json`
- `background.js`
- `selectSeason.js`
- `watchInterception.js`
- `logo.png`

## Load unpacked

1. Open `chrome://extensions`.
2. Enable **Developer mode**.
3. Click **Load unpacked**.
4. Select this folder.

## Notes

- Built for Amazon Prime Video web UI and selectors that may change over time.
- Uses MV3 service worker background script.
