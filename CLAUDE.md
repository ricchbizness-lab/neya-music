# Neya Music — Repo Notes

## HyperFrames render performance (validated on this sandbox)

Tested on `neya-close-up` (94.76s composition, 19 clips, 21 karaoke caption
lines, 1080x1920 @ 30fps = 2843 frames). Findings below are empirical, not
theoretical — re-verify if the render environment changes (more CPU, a real
GPU, Docker available).

### `--workers` > 1 is BROKEN in this sandbox — do not use

Both `--workers=4` and `--workers=2` were tested and **both fail outright**
(not just slower): every worker times out (`Runtime.callFunctionOn timed
out`) and every media asset fails to load (`net::ERR_ABORTED`) against the
render's local asset server. Root cause: this sandbox has 4 vCPUs and no
GPU (`/dev/dri` absent, Chrome falls back to SwiftShader software
rendering) — spawning multiple full headless Chrome processes saturates it
completely instead of parallelizing. The tool's own error message suggests
`--docker` as the fix; not available here.

**Do not pass `--workers` at all — let it default (resolves to 1 in this
environment).** This is the only configuration that has completed
successfully (3/3 renders of the same composition).

### Standard two-tier render workflow

1. **Draft render** — for verifying caption sync/timing only, before
   committing to a full render:
   ```
   npx hyperframes render --fps=15 --quality=draft -o renders/draft.mp4
   ```
   Half the frames of a 30fps render → real, verified time reduction
   (frame count scales capture time roughly linearly). Do **not** try to
   reduce `--resolution` for this — the flag only accepts fixed presets
   (`landscape`, `portrait`, `landscape-4k`, etc.) that must be an integer
   *upscale* multiple of the composition's native size; arbitrary downscale
   (e.g. 540x960) is rejected by the CLI.

2. **Final render** — only once the draft is approved:
   ```
   npx hyperframes render
   ```
   Default fps (30), default quality (standard), native resolution
   (1080x1920). Expect **~90-100 minutes** for a ~95s / 21-caption-line
   composition in this sandbox — this is the reliable baseline, not a bug
   to keep chasing.

### If render speed genuinely needs to come down

The bottleneck is CPU-bound software compositing (SwiftShader), not
something fixable via CLI flags in this environment. The only lever with
real leverage is **rendering on a machine with a real GPU** (e.g. locally
on a PC with a dedicated graphics card, passing `--browser-gpu`) — not
available in this sandbox. Don't re-attempt `--workers` here without
re-testing; if the sandbox's CPU/GPU allocation changes, re-verify before
trusting it again.
