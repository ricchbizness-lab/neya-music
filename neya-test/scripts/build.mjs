#!/usr/bin/env node
// Generates index.html from clips.config.json.
//
// Edit clips.config.json (visual clip(s), lyrics segments, sources), then
// re-run `npm run build:composition`. This script is the only thing that
// writes data-start/data-duration — never hand-edit those values in
// index.html, they'll be overwritten on the next build.
//
// `clips` (video track) and `lyrics` (caption track) are independent lists
// with their own timing — a single looping visual clip can carry many short
// lyric lines timed from a real transcript, or a multi-clip cut can pair
// one lyric per clip. Neither list drives the other.

import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const projectRoot = path.dirname(fileURLToPath(import.meta.url)) + "/..";
const configPath = path.join(projectRoot, "clips.config.json");
const outPath = path.join(projectRoot, "index.html");

const config = JSON.parse(readFileSync(configPath, "utf8"));
const { width, height, audio, clips, lyrics } = config;

if (!Array.isArray(clips) || clips.length === 0) {
  throw new Error("clips.config.json: `clips` must be a non-empty array");
}
if (!Array.isArray(lyrics)) {
  throw new Error("clips.config.json: `lyrics` must be an array (can be empty)");
}

// Video clip data-start is computed by cumulating each preceding clip's
// duration — never written by hand.
let cursor = 0;
const clipsWithTiming = clips.map((clip) => {
  const start = cursor;
  cursor += clip.duration;
  return { ...clip, start };
});
const clipsDuration = cursor;

// Root/composition duration: explicit `duration` in the config wins (e.g. to
// match an audio track exactly); otherwise fall back to the summed clip
// duration.
const totalDuration = config.duration ?? clipsDuration;

// A clip is an <img> when `type: "image"` is set in config (e.g. a static
// poster held for the whole song) — otherwise a <video>. Keeping a still
// image out of the video pipeline avoids per-frame seek/decode entirely,
// which is both unnecessary for a non-moving source and far more expensive
// at render time.
const videoBlocks = clipsWithTiming
  .map(({ src, start, duration, type }, i) => {
    if (type === "image") {
      return `      <img
        id="clip-${i + 1}"
        class="clip"
        src="${src}"
        data-start="${start}"
        data-duration="${duration}"
        data-track-index="0"
      />`;
    }
    return `      <video
        id="clip-${i + 1}"
        class="clip"
        src="${src}"
        data-start="${start}"
        data-duration="${duration}"
        data-track-index="0"
        muted
        playsinline
      ></video>`;
  })
  .join("\n");

// Lyric segments carry their own start/end (e.g. from a word-level
// transcript) — independent of how many video clips there are.
const lyricBlocks = lyrics
  .map(({ text, start, end }, i) => {
    const duration = Math.round((end - start) * 100) / 100;
    return `      <div
        id="lyric-${i + 1}"
        class="lyric clip"
        data-start="${start}"
        data-duration="${duration}"
        data-track-index="1"
        data-layout-allow-occlusion
      >
        <span>${escapeHtml(text)}</span>
      </div>`;
  })
  .join("\n");

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

const html = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=${width}, height=${height}" />
    <title>Neya — Music Video</title>
    <script src="vendor/gsap.min.js"></script>
    <style>
      * {
        margin: 0;
        padding: 0;
        box-sizing: border-box;
      }
      html,
      body {
        margin: 0;
        width: ${width}px;
        height: ${height}px;
        overflow: hidden;
        background: #000;
      }
      body {
        font-family: "Inter", "Helvetica Neue", Arial, sans-serif;
      }

      #root {
        position: relative;
        width: ${width}px;
        height: ${height}px;
        overflow: hidden;
      }

      /* Visual clips fill the frame edge-to-edge, direct hard cuts (no transition) */
      video.clip,
      img.clip {
        position: absolute;
        inset: 0;
        width: ${width}px;
        height: ${height}px;
        object-fit: cover;
        z-index: 1;
      }

      /* Lyric line overlay — bottom of screen, cyan bold with glow for legibility.
         Explicit z-index: the runtime's own video-visibility handling can stack
         the active video above later DOM siblings, so this can't rely on
         source order alone to stay on top. */
      .lyric {
        position: absolute;
        left: 0;
        right: 0;
        bottom: 220px;
        z-index: 10;
        display: flex;
        justify-content: center;
        padding: 0 64px;
        text-align: center;
        pointer-events: none;
      }
      .lyric span {
        font-weight: 800;
        font-size: 64px;
        line-height: 1.15;
        color: #249fc0;
        text-shadow:
          0 0 12px rgba(36, 159, 192, 0.85),
          0 0 28px rgba(36, 159, 192, 0.55),
          0 4px 10px rgba(0, 0, 0, 0.65);
        letter-spacing: 0.5px;
      }
    </style>
  </head>
  <body>
    <!--
      ============================================================
      GENERATED FILE — DO NOT HAND-EDIT CLIPS/LYRICS/TIMING BELOW
      ============================================================
      This file is generated by scripts/build.mjs from clips.config.json.
      To add/remove/retime clips or lyric lines, edit clips.config.json
      and run: npm run build:composition
      Hand edits to the clip/lyric blocks or their data-* attributes
      will be silently overwritten on the next build.
    -->
    <div
      id="root"
      data-composition-id="main"
      data-start="0"
      data-width="${width}"
      data-height="${height}"
      data-duration="${totalDuration}"
    >
${videoBlocks}

${lyricBlocks}

      <!--
        ============================================================
        AUDIO TRACK
        ============================================================
        Full song / mix, spans the whole composition (duration is
        computed from clips.config.json, currently ${totalDuration}s).
        Video elements stay muted; this <audio> element carries all
        the sound.
      -->
      <audio
        id="track-audio"
        src="${audio}"
        data-start="0"
        data-duration="${totalDuration}"
        data-track-index="10"
        data-volume="1"
      ></audio>
    </div>

    <script>
      // Generic fade in/out for every ".lyric" clip — reads timing straight
      // from the DOM (data-start/data-duration), so this block never needs
      // to change when clips.config.json changes. Fade length is clamped to
      // half the segment's own duration so a very short lyric line can't
      // produce a negative-length hold between fade-in and fade-out.
      window.__timelines = window.__timelines || {};
      const tl = gsap.timeline({ paused: true });

      const MAX_FADE = 0.3;
      document.querySelectorAll("#root > .lyric").forEach((el) => {
        const start = parseFloat(el.dataset.start);
        const duration = parseFloat(el.dataset.duration);
        const fade = Math.min(MAX_FADE, duration / 2);
        tl.fromTo(
          el,
          { opacity: 0, y: 20 },
          { opacity: 1, y: 0, duration: fade, ease: "power2.out" },
          start,
        );
        tl.to(el, { opacity: 0, duration: fade, ease: "power2.in" }, start + duration - fade);
      });

      window.__timelines["main"] = tl;
    </script>
  </body>
</html>
`;

writeFileSync(outPath, html);
console.log(
  `Generated index.html — ${clips.length} clip(s), ${lyrics.length} lyric line(s), ${totalDuration}s total`,
);
