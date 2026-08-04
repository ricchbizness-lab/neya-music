---
name: neya-lyric-video
description: Use this agent to build a Neya lyric video (HyperFrames project) from a new song. Trigger it whenever the user gives a new audio file plus a cover/poster image and asks for a lyric video, TikTok/Shorts edit, or "the Neya video process." Follows the exact recipe validated on "On My Wave" — transcription, lyric config, build, full lint/validate/inspect/render checks, and a strict no-push-without-approval gate.
tools: "*"
---

# Neya lyric video — standing recipe

This is the process validated end-to-end on the "On My Wave" track. Given a
new **audio file** + a new **poster/cover image**, reproduce this pipeline
rather than re-deriving it from scratch. Ask the user only for what's
genuinely new (audio, image, song title) — everything else below is settled.

## 0. Inputs you need from the user

- The audio file (mp3/wav).
- The poster/cover image (portrait, ideally already close to 9:16 — a
  1080x1920-ish crop is easiest, but any portrait works since it gets
  `object-fit: cover`).
- The song title (for the lyric-video composition name and the cover art).
- If they have one: an existing SRT/plain-text lyric transcript. If not, do
  step 1 yourself.

## 1. Transcription

Transcribe the full audio, including intro ad-libs and any "Mmm/Watch
this"-style non-lyric vocalizations — **don't start at the first "real"
line**. A gap of dead air at the start (or anywhere mid-song) with no caption
is a defect, not a stylistic choice; on "On My Wave" we shipped with the
first ~19.5s uncaptioned and had to go back and patch it in from the fuller
transcript. Capture the *entire* vocal timeline up front.

Use `faster-whisper` for a word/segment-level transcript with timestamps:

```bash
pip install faster-whisper --quiet
python3 -c "
from faster_whisper import WhisperModel
model = WhisperModel('medium', device='cpu', compute_type='int8')
segments, _ = model.transcribe('path/to/audio.mp3', word_timestamps=True)
for s in segments:
    print(f'{s.start:.3f} --> {s.end:.3f}  {s.text.strip()}')
"
```

If the user supplies their own SRT/TXT (as happened for "On My Wave" — a
human-corrected transcript beats raw ASR), prefer that over re-transcribing,
but still cross-check it covers 0s through the true end of vocals.

**Sanity-check the words against a lyrics sheet if the user has one, or by
ear.** ASR reliably mangles proper nouns — on this project it kept mishearing
"Neya" as "nay yeah" / "near". Fix these before they propagate into 70+ lyric
lines.

## 2. Break the transcript into lyric lines + build `clips.config.json`

- One caption per natural line/phrase (not one per ASR segment if the ASR
  over-splits — merge short fragments, split overly long ones).
- Non-overlapping `start`/`end` per line (validate this programmatically —
  see the check snippet in step 4).
- `clips.config.json` is the single source of truth:
  ```json
  {
    "width": 1080,
    "height": 1920,
    "duration": <exact audio duration>,
    "audio": "assets/<file>.mp3",
    "clips": [
      { "src": "assets/<poster>.png", "type": "image", "duration": <same as composition duration> }
    ],
    "lyrics": [ { "text": "...", "start": 0.0, "end": 0.8 }, ... ]
  }
  ```
- Optionally append one contextual emoji per line (after the text). If doing
  this, **propose the keyword→emoji mapping to the user for approval before
  writing it into the file** — don't just apply a guessed mapping.

## 3. THE TECHNICAL TRAP — static image, never a fake looping video

If the visual is a single still poster held for the whole song, encode it as
an **`<img>` clip** (`"type": "image"` in `clips.config.json`), never as an
`.mp4` "video" that's just the same static frame looped via ffmpeg.

Why this matters: a fake-looping video forces the renderer to seek/decode
video frames 5000+ times per render even though nothing moves — on this
project that was the direct cause of repeated render failures (`Target
closed`, `ERR_ABORTED`, protocol timeouts) that cost the most debugging time
of the whole build. Root cause, confirmed via the compiler's own warning:
sparse keyframes in the fake-loop video broke frame-accurate seeking. Re-
encoding with a denser GOP helped but didn't fully fix it — switching to a
plain `<img>` eliminated the failure class entirely and also cut render time
and output size dramatically.

`scripts/build.mjs` already branches on `type: "image"` vs a real video clip
— reuse that, don't reintroduce a looping-video workaround.

## 4. Build + validate (every time, before showing anything)

```bash
node scripts/build.mjs        # regenerates index.html from clips.config.json — never hand-edit index.html
npx hyperframes lint
npx hyperframes validate      # (or `check` on newer CLI versions — validate/inspect are being merged into it)
npx hyperframes inspect --samples 30
```

All three must be clean (0 errors; the "file too large" / "track too dense"
info warnings are expected and fine to ignore — they're just nudges to split
into sub-compositions, not required here).

Quick non-overlap sanity check for the lyrics array before even building:

```bash
node -e '
const c = JSON.parse(require("fs").readFileSync("clips.config.json","utf8"));
let prevEnd = 0, bad = 0;
c.lyrics.forEach((l,i) => {
  if (l.start < prevEnd - 0.001) { console.log("OVERLAP", i, l.text); bad++; }
  if (l.end <= l.start) { console.log("BAD DURATION", i, l.text); bad++; }
  prevEnd = l.end;
});
console.log("lyrics:", c.lyrics.length, "issues:", bad);
'
```

Take a `hyperframes snapshot` at a handful of representative timestamps
(intro, a couple of mid-song lines, a chorus) and eyeball it before
rendering — much cheaper than discovering a layout bug after a 20+ minute
render.

## 5. Visual style — keep identical every time

**Text (always exactly this):**
- Centered both horizontally *and* vertically in the frame (`.lyric { inset:
  0; display:flex; align-items:center; justify-content:center; }`) — never
  bottom-anchored. This was a deliberate fix: bottom-anchored captions
  collided with the wordmark baked into the bottom of the poster.
- Font: Poppins ExtraBold (800), ~84px. Poppins specifically because it's on
  HyperFrames' auto-resolved font list — fonts outside that list need a live
  Google Fonts fetch during render, which reintroduces non-determinism/
  render risk. Don't swap in a different display font without checking it's
  auto-resolved (`hyperframes lint` will flag `font_family_without_font_face`
  if not).
- Fill: white, with a clean `-webkit-text-stroke: 2px #ffffff` (a crisp
  stroke, not a blurred shadow) plus a diffuse cyan glow **outside** the
  stroke via layered `text-shadow` in `#249fc0`.
- Entrance/exit: scale + slight rotation (`back.out(1.7)` in / `power2.in`
  out), not a plain fade.
- Karaoke word highlight: each line's words wrapped in `<span class="word">`,
  staggered from dim (`rgba(255,255,255,0.4)`) to full white across the
  line's hold time. There's no true word-level timing, so this is spread
  evenly — an approximation, not exact sync.

**Background photo — default to fully static.** On "On My Wave" we tried
Ken Burns + vignette + grain + a continuous beat-synced zoom-punch, plus a
glitch/white-flash pulse at 4-5 hand-picked structural beats (chorus/break
entries) instead of a fixed interval. All of it was cut in the end — on
review it read as a recurring, distracting "light effect" on the photo
rather than a punchy accent, and the plain static image simply worked
better against this particular artwork. Treat the static image as the
default; only add motion back in if the user asks for it *and* confirms
after seeing a test snapshot/render that it's landing well on the new
artwork. If you do re-add it, the toggle for CapCut-style effects should
run entirely on the paused GSAP timeline (never CSS `@keyframes` — those run
on wall-clock time and desync from render capture). Chromatic-aberration
ghosts should be cheap color-tinted duplicate `<img>`s blended with
`mix-blend-mode: screen`, not true SVG `feColorMatrix` channel splitting —
the latter is meaningfully more expensive across a multi-thousand-frame
render for a barely-perceptible difference on a brief pulse.

## 6. Render

```bash
npx hyperframes render -o renders/<name>.mp4 -w 1 \
  --protocol-timeout 300000 --player-ready-timeout 90000 --browser-timeout 180
```

Notes from experience on this environment:
- Renders are slow (30-40+ min for a ~3min song) and occasionally fail with
  transient errors (`FFmpeg cannot start` at startup, or a mid-render
  `Protocol error: Target closed`) that are usually **not real problems** —
  just retry once. Give it a large `timeout` budget (`timeout 1800 ...` /
  `timeout 3000 ...`) since the internal render can legitimately take
  30+ minutes; a timeout that's too tight will kill a render that was about
  to succeed.
- `-w 1` (single worker) has been more reliable in this environment than
  auto/multi-worker, which has triggered request-abort failures under load.
- After rendering, the file is very likely well over any chat upload limit
  (~30MB). Re-encode for delivery, don't re-render:
  ```bash
  ffmpeg -y -i renders/<name>.mp4 -c:v libx264 -crf 24 -preset slow \
    -c:a aac -b:a 128k renders/<name>-compressed.mp4
  ```
  Adjust CRF up (26-28) if still over the limit. Keep the original
  full-quality file on disk too in case the user wants it later.

## 7. Cover / thumbnail image (if requested)

A separate deliverable, not part of the timed composition. Build it as a
standalone HTML file (`scripts/cover.html`) reusing the exact lyric text
style above, screenshot it with headless Chromium at the target resolution
(1280x720 for a standard YouTube thumbnail). Embed the Poppins woff2 files
locally (copy from `~/.cache/hyperframes/fonts/poppins/`) rather than
depending on a live Google Fonts fetch in the raw Chromium screenshot step —
that fetch fails silently in this sandbox (proxy/CA issues) and produces a
fallback-font thumbnail that looks wrong.

Confirmed layout for "keep it simple": the full, uncropped poster image
centered in frame with a blurred, zoomed copy of the *same* image filling
the pillarbox sides (the same treatment YouTube uses when a vertical video
plays in a wide player) — not a cropped/zoomed photo, not a split panel with
a separate color background. Title text centered over the visible photo,
same font/stroke/glow recipe as the lyric captions. Keep the blur itself
**neutral** — no added brightness/saturation grading, no drop-shadow halo
around the foreground image; those read as an extra "effect" the same way
the background glow did on the video.

## 8. Before showing the user anything

- [ ] `lint` / `validate` / `inspect` all clean.
- [ ] At least one snapshot batch reviewed (intro, mid-song, a chorus) before
      committing to a full render.
- [ ] A **full MP4 render** generated and sent as an attachment — never just
      snapshots when the ask is "show me the video." Re-encode for size if
      needed (step 6); don't substitute a lower-effort deliverable.
- [ ] Never `git push` without the user explicitly confirming they're happy
      with what they were shown. Commits are fine to make along the way
      (small, descriptive, one per logical change); push is a separate,
      explicit go-ahead every time — a "looks good" about the video is not
      automatically a "push it" unless they say so.
