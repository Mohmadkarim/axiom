# Axiom (Stage 1)

An infinite-canvas vector drawing app for iPad and Apple Pencil, modelled on Concepts. It is the foundation for a STEM study app; see `PLAN.md` for the research, the full spec, the roadmap and the reusable build prompt.

## Try it on your iPad

**Option A, quickest:** open the private claude.ai link from the chat on your iPad while signed in to claude.ai. Drawings are saved in that iPad's browser. The claude.ai frame limits two things there:
- **Export:** there's no direct download. Exports appear as a preview instead, and you can press and hold an image to save it to Photos.
- **Full screen:** the app can't take over the whole screen inside the frame.

**Option B, full-screen app on your Home Screen (same Wi-Fi):**
1. On the Mac, run `python3 -m http.server 8765 --bind 0.0.0.0 --directory dist` in this folder.
2. On the iPad, open Safari and go to `http://<your-Mac's-IP>:8765`. In Terminal, `ipconfig getifaddr en0` shows the IP.
3. Tap Share, then **Add to Home Screen**. Axiom then opens full screen like a native app.

Some university and office Wi-Fi networks block devices from reaching each other. If the page won't load, use a phone hotspot or option C.

**Option C, best (works offline, anywhere):** host `dist/` on any HTTPS static host, such as GitHub Pages, Netlify Drop or Cloudflare Pages. Then use Add to Home Screen. With HTTPS the service worker caches the app, so it works offline.

## Build

```
node build.mjs
```

The sources are in `src/` and contain no dependencies. The build inlines everything into `dist/index.html` (the installable PWA) and `dist/artifact.html` (the claude.ai page).

## Gestures
- **Pencil:** draws.
- **Two fingers:** pan, zoom and rotate.
- **Two-finger tap:** undo.
- **Three-finger tap:** redo.
- **Draw and hold:** turns the stroke into a clean shape.
- **Hold the Pencil still:** starts a lasso.
- **Tool slots:** tap the active slot for the brush menu.
- **Size, Opacity and Smoothing:** tap for a slider, or drag to adjust.
- **Help (?)** in the app lists everything.
