# Pixel Cutscene

Make short pixel-art cutscenes in the browser and export them as pixel-perfect video (MP4, WebM or GIF).

1. **Scene**: describe what happens. An AI model drafts the timeline, or you write it yourself.
2. **Cast**: bring your own sprite folders, or generate characters with PixelLab.
3. **Tweak**: move bars on the timeline, add effects, sounds and music.
4. **Export**: render frame by frame at the size you pick.

Click **Open the sample** on the home screen to see a finished scene.

## Keys and privacy

Everything runs in your browser. Projects are saved in this browser's storage, and **Download project** gives you a .zip copy (project.json plus every image and sound).
API keys (AI provider, PixelLab, ElevenLabs) are optional. You add them in Settings, they are kept only in this browser's local storage, and they go only to the provider they belong to. Any call that costs money asks you first.
Browser storage is shared by every page on the same origin (here `lexingel.github.io`), so use keys with a spending limit and clear them in Settings when you are done. If you run the tool yourself (below), your keys stay on your own origin.

## Run it locally

```bash
npm ci
npm run dev
```

`npm test` runs the unit tests, `npm run e2e` the browser tests and `npm run build` makes `dist/`. The export tests read the video back with a recent ffmpeg: on your PATH, or set `FFMPEG` to its full path.

## Licences

- Effects: [pixelfx](https://github.com/patch-gg/pixelfx), MIT. See `vendor/pixelfx/LICENSE`.
- Music library: 12 CC0 tracks from OpenGameArt. Titles, artists and links are in `public/music/manifest.json`.
- The sample project uses pixelfx stock characters, a background drawn in code, and a CC0 track.
