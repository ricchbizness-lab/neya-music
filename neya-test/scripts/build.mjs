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
// transcript) — independent of how many video clips there are. Each word is
// its own <span class="word"> so the runtime script can stagger a
// karaoke-style highlight across the line's hold time.
const lyricBlocks = lyrics
  .map(({ text, start, end }, i) => {
    const duration = Math.round((end - start) * 100) / 100;
    const words = escapeHtml(text)
      .split(/\s+/)
      .filter(Boolean)
      .map((word) => `<span class="word">${word}</span>`)
      .join(" ");
    return `      <div
        id="lyric-${i + 1}"
        class="lyric clip"
        data-start="${start}"
        data-duration="${duration}"
        data-track-index="1"
        data-layout-allow-occlusion
      >
        <span>${words}</span>
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

      /* Blurred, zoomed backdrop — same "floating card" treatment as the
         YouTube cover art (scripts/cover.html): a static, always-on blurred
         copy of the poster behind the inset foreground clip. Static on
         purpose — a live blurred video duplicate would double per-frame
         render cost for a background effect nobody looks at directly. */
      #clip-bg {
        position: absolute;
        inset: -60px;
        background-image: url("assets/hf_20260526_225013_a148f707-f95f-4231-9952-368d1e40e359.png");
        background-size: cover;
        background-position: 50% 30%;
        filter: blur(45px) brightness(0.55) saturate(1.3);
        transform: scale(1.15);
        z-index: 0;
      }

      /* Visual clips sit inset over the blurred backdrop, direct hard cuts
         (no transition) between clips themselves. */
      video.clip,
      img.clip {
        position: absolute;
        top: 50%;
        left: 50%;
        transform: translate(-50%, -50%);
        width: 92%;
        height: 94%;
        object-fit: cover;
        border-radius: 28px;
        box-shadow: 0 20px 90px rgba(0, 0, 0, 0.6);
        z-index: 1;
      }

      /* Lyric line overlay — vertically + horizontally centered so it never
         collides with the NEYA wordmark baked into the bottom of the poster.
         Explicit z-index: the runtime's own video-visibility handling can stack
         the active video above later DOM siblings, so this can't rely on
         source order alone to stay on top. */
      .lyric {
        position: absolute;
        inset: 0;
        z-index: 10;
        display: flex;
        align-items: center;
        justify-content: center;
        padding: 0 64px;
        text-align: center;
        pointer-events: none;
      }
      .lyric span {
        font-family: "Poppins", "Inter", sans-serif;
        font-weight: 800;
        font-size: 84px;
        line-height: 1.15;
        color: #ffffff;
        -webkit-text-stroke: 2px #ffffff;
        text-shadow:
          0 0 14px rgba(36, 159, 192, 0.95),
          0 0 30px rgba(36, 159, 192, 0.8),
          0 0 55px rgba(36, 159, 192, 0.5);
        letter-spacing: 0.5px;
      }
      /* Karaoke words start dim; the runtime script tweens each one's color
         to full white as its share of the line's hold time arrives. The
         cyan glow itself lives on the constant text-shadow above (outside
         the stroke), not on the animated fill color. */
      .lyric .word {
        color: rgba(255, 255, 255, 0.4);
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
      <div id="clip-bg"></div>

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
      // Everything below lives on one paused GSAP timeline that the renderer
      // scrubs frame-by-frame. Nothing here may use a real-time CSS
      // @keyframes animation — those run on wall-clock time and would
      // desync from render capture, which advances by composition time,
      // not real time.
      window.__timelines = window.__timelines || {};
      const tl = gsap.timeline({ paused: true });

      const totalDuration = parseFloat(document.getElementById("root").dataset.duration);

      // Lyric lines: scale/rotate/fade in and out (fade length clamped to
      // half the segment's own duration so a very short line can't produce a
      // negative-length hold), plus a word-by-word karaoke highlight spread
      // evenly across the hold time — there's no word-level timing in the
      // transcript, so this approximates sync rather than tracking exact
      // syllable timing.
      const FADE = 0.35;
      document.querySelectorAll("#root > .lyric").forEach((el) => {
        const start = parseFloat(el.dataset.start);
        const duration = parseFloat(el.dataset.duration);
        const fade = Math.min(FADE, duration / 2);

        tl.fromTo(
          el,
          { opacity: 0, scale: 0.82, rotation: -4, y: 26 },
          { opacity: 1, scale: 1, rotation: 0, y: 0, duration: fade, ease: "back.out(1.7)" },
          start,
        );
        tl.to(
          el,
          { opacity: 0, scale: 1.08, rotation: 3, duration: fade, ease: "power2.in" },
          start + duration - fade,
        );

        const words = el.querySelectorAll(".word");
        if (words.length) {
          const holdStart = start + fade;
          const holdEnd = start + duration - fade;
          const hold = Math.max(holdEnd - holdStart, 0.05);
          const step = hold / words.length;
          tl.fromTo(
            words,
            { color: "rgba(255,255,255,0.4)" },
            { color: "#ffffff", duration: Math.min(0.25, step), stagger: step, ease: "none" },
            holdStart,
          );
        }
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
