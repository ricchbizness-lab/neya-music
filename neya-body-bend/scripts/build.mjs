#!/usr/bin/env node
// Generates index.html from clips.config.json.
//
// Edit clips.config.json (visual clip(s), lyrics segments, sources), then
// re-run `node scripts/build.mjs`. This script is the only thing that
// writes data-start/data-duration — never hand-edit those values in
// index.html, they'll be overwritten on the next build.
//
// This is the "with effects" variant of the shared Neya build script
// (recovered from neya-test's git history, commit 9f9fa33, before the
// effects were stripped for that project) — Ken Burns, vignette, grain,
// ambient glow, and glitch pulses at hand-picked structural beats.
// Extended here so the wrapper structure (and therefore every effect
// except the chromatic-aberration ghosts) also applies to `type: "video"`
// clips, not just `type: "image"` — this project's background is a
// pre-looped video, not a static poster.

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

let cursor = 0;
const clipsWithTiming = clips.map((clip) => {
  const start = cursor;
  cursor += clip.duration;
  return { ...clip, start };
});
const clipsDuration = cursor;

const totalDuration = config.duration ?? clipsDuration;

// Both `type: "image"` and `type: "video"` clips get the same wrapper
// stack so every effect (Ken Burns, beat zoom-punch, glitch jitter/scanline
// /flash) can target a dedicated element instead of fighting another tween
// for the same node's transform:
//   .visual-wrap  (outermost) — glitch jitter target
//   .visual-beat  (nested)    — continuous beat-synced zoom-punch target
//   .visual-kb    (nested)    — Ken Burns zoom/pan target
// Chromatic-aberration ghost duplicates are image-only — duplicating a
// playing <video> for a ghost layer would mean decoding it twice per frame,
// not worth it for a brief low-opacity pulse (video already carries its
// own motion, unlike a static poster).
const videoBlocks = clipsWithTiming
  .map(({ src, start, duration, type }, i) => {
    const inner =
      type === "image"
        ? `            <img
              id="clip-${i + 1}"
              class="clip"
              src="${src}"
              data-start="${start}"
              data-duration="${duration}"
              data-track-index="0"
            />
            <img class="glitch-ghost glitch-ghost-r" src="${src}" aria-hidden="true" />
            <img class="glitch-ghost glitch-ghost-c" src="${src}" aria-hidden="true" />`
        : `            <video
              id="clip-${i + 1}"
              class="clip"
              src="${src}"
              data-start="${start}"
              data-duration="${duration}"
              data-track-index="0"
              muted
              playsinline
            ></video>`;
    return `      <div id="clip-${i + 1}-wrap" class="visual-wrap">
        <div id="clip-${i + 1}-beat" class="visual-beat">
          <div id="clip-${i + 1}-kb" class="visual-kb">
${inner}
          </div>
        </div>
      </div>
      <div id="clip-${i + 1}-glitch-overlay" class="glitch-overlay" aria-hidden="true"></div>
      <div id="clip-${i + 1}-glitch-flash" class="glitch-flash" aria-hidden="true"></div>`;
  })
  .join("\n");

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

// Deterministic SVG feTurbulence grain, fixed seed — not Math.random — so
// render output stays reproducible. Encoded as a data URI: a plain tiled
// background image at render time, zero per-frame animation cost.
const grainSvg =
  `<svg xmlns='http://www.w3.org/2000/svg' width='200' height='200'>` +
  `<filter id='n'><feTurbulence type='fractalNoise' baseFrequency='0.85' numOctaves='2' seed='7' stitchTiles='stitch'/>` +
  `<feColorMatrix type='saturate' values='0'/></filter>` +
  `<rect width='100%' height='100%' filter='url(#n)'/></svg>`;
const grainDataUri = `data:image/svg+xml,${encodeURIComponent(grainSvg)}`;

const html = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=${width}, height=${height}" />
    <title>Neya — Body Bend</title>
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

      video.clip,
      img.clip {
        position: absolute;
        inset: 0;
        width: ${width}px;
        height: ${height}px;
        object-fit: cover;
        z-index: 1;
      }

      .visual-wrap,
      .visual-beat,
      .visual-kb {
        position: absolute;
        inset: 0;
      }

      img.glitch-ghost {
        position: absolute;
        inset: 0;
        width: ${width}px;
        height: ${height}px;
        object-fit: cover;
        z-index: 1;
        opacity: 0;
        mix-blend-mode: screen;
        pointer-events: none;
      }
      img.glitch-ghost-r {
        filter: sepia(1) saturate(8) hue-rotate(-58deg) brightness(1.1);
      }
      img.glitch-ghost-c {
        filter: sepia(1) saturate(8) hue-rotate(148deg) brightness(1.1);
      }

      /* Screen-locked VHS scanlines — not inside .visual-wrap/.visual-kb, a
         scanline overlay reads as a property of the screen, not the scene.
         Below the lyrics (z-index 10); hidden by default, flashed on
         briefly at each glitch beat. */
      .glitch-overlay {
        position: absolute;
        inset: 0;
        z-index: 3;
        opacity: 0;
        pointer-events: none;
        background: repeating-linear-gradient(
          to bottom,
          rgba(255, 255, 255, 0.4) 0px,
          rgba(255, 255, 255, 0.4) 1px,
          rgba(0, 0, 0, 0) 1px,
          rgba(0, 0, 0, 0) 3px
        );
        mix-blend-mode: overlay;
      }

      .glitch-flash {
        position: absolute;
        inset: 0;
        z-index: 4;
        opacity: 0;
        pointer-events: none;
        background: #ffffff;
        mix-blend-mode: overlay;
      }

      /* Permanent, static, subtle — essentially free: no animation, no
         per-frame GSAP cost, painted the same way every frame. */
      .vignette-overlay {
        position: absolute;
        inset: 0;
        z-index: 2;
        pointer-events: none;
        background: radial-gradient(
          ellipse at 50% 45%,
          rgba(0, 0, 0, 0) 45%,
          rgba(0, 0, 0, 0.55) 100%
        );
      }
      .grain-overlay {
        position: absolute;
        inset: 0;
        z-index: 2;
        pointer-events: none;
        opacity: 0.05;
        mix-blend-mode: overlay;
        background-image: url("${grainDataUri}");
        background-size: 200px 200px;
      }

      /* Ambient glow behind the lyrics — pulses on the paused GSAP timeline
         (never real-time CSS @keyframes) so it stays frame-accurate under
         render capture, which scrubs composition time, not wall time. */
      .bg-glow {
        position: absolute;
        inset: 0;
        z-index: 2;
        background: radial-gradient(
          circle at 50% 52%,
          rgba(36, 159, 192, 0.55) 0%,
          rgba(36, 159, 192, 0) 60%
        );
        opacity: 0.12;
        pointer-events: none;
      }

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
      Generated by scripts/build.mjs from clips.config.json.
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

      <div class="vignette-overlay" aria-hidden="true"></div>
      <div class="grain-overlay" aria-hidden="true"></div>
      <div id="bg-glow" class="bg-glow"></div>

${lyricBlocks}

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
      window.__timelines = window.__timelines || {};
      const tl = gsap.timeline({ paused: true });

      const totalDuration = parseFloat(document.getElementById("root").dataset.duration);

      // Ken Burns — one slow continuous zoom/pan across each visual clip's
      // full duration, applied to .visual-kb (works the same for an <img>
      // or a <video> inside it).
      document.querySelectorAll("#root .visual-kb").forEach((kbTarget) => {
        const mediaEl = kbTarget.querySelector(".clip");
        if (!mediaEl) return;
        const start = parseFloat(mediaEl.dataset.start);
        const duration = parseFloat(mediaEl.dataset.duration);
        tl.fromTo(
          kbTarget,
          { scale: 1, x: 0, y: 0 },
          { scale: 1.14, x: -18, y: -14, duration, ease: "none" },
          start,
        );
      });

      // Beat-synced "zoom punch" — small continuous scale bounce on a fixed
      // reference tempo, running the whole song.
      const BEAT = 0.6;
      document.querySelectorAll("#root > .visual-wrap > .visual-beat").forEach((beatEl) => {
        tl.to(
          beatEl,
          {
            scale: 1.018,
            duration: BEAT,
            repeat: Math.max(0, Math.floor(totalDuration / BEAT) - 1),
            yoyo: true,
            ease: "sine.inOut",
          },
          0,
        );
      });

      // Glitch pulses at hand-picked structural moments (chorus entries,
      // breaks) rather than a fixed interval. Jitter offsets are
      // hand-authored fixed values, not Math.random(), to keep render
      // output deterministic. GLITCH_BEATS must be filled in per-song to
      // match its actual structure once lyric timing is known.
      const GLITCH_BEATS = ${JSON.stringify(config.glitchBeats ?? [])};
      document.querySelectorAll("#root > .visual-wrap").forEach((wrapEl) => {
        const mediaEl = wrapEl.querySelector(".clip");
        const ghostR = wrapEl.querySelector(".glitch-ghost-r");
        const ghostC = wrapEl.querySelector(".glitch-ghost-c");
        const overlayEl = wrapEl.nextElementSibling;
        const flashEl = overlayEl?.nextElementSibling;
        if (
          !mediaEl ||
          !overlayEl?.classList.contains("glitch-overlay") ||
          !flashEl?.classList.contains("glitch-flash")
        ) {
          return;
        }

        const start = parseFloat(mediaEl.dataset.start);
        const duration = parseFloat(mediaEl.dataset.duration);
        const JITTER = [
          [3, -2],
          [-4, 1],
          [2, 2],
          [-2, -3],
          [1, 0],
        ];

        for (const t of GLITCH_BEATS) {
          if (t < start || t > start + duration - 0.5) continue;

          if (ghostR && ghostC) {
            tl.set([ghostR, ghostC], { opacity: 0, x: 0 }, t);
            tl.to(ghostR, { opacity: 0.75, x: -6, duration: 0.06 }, t);
            tl.to(ghostC, { opacity: 0.75, x: 6, duration: 0.06 }, t);
            tl.to([ghostR, ghostC], { opacity: 0, x: 0, duration: 0.12 }, t + 0.22);
          }

          tl.fromTo(
            overlayEl,
            { opacity: 0 },
            { opacity: 0.5, duration: 0.05, yoyo: true, repeat: 3 },
            t,
          );
          tl.fromTo(
            flashEl,
            { opacity: 0 },
            { opacity: 0.6, duration: 0.045, yoyo: true, repeat: 1, ease: "power1.out" },
            t,
          );

          let cursor = t;
          JITTER.forEach(([dx, dy]) => {
            tl.to(wrapEl, { x: dx, y: dy, duration: 0.035, ease: "none" }, cursor);
            cursor += 0.035;
          });
          tl.to(wrapEl, { x: 0, y: 0, duration: 0.04, ease: "none" }, cursor);
        }
      });

      // Ambient glow pulse behind the lyrics, same fixed reference tempo as
      // the zoom punch.
      const glowEl = document.getElementById("bg-glow");
      if (glowEl) {
        tl.to(
          glowEl,
          {
            opacity: 0.35,
            duration: BEAT,
            repeat: Math.max(0, Math.floor(totalDuration / BEAT) - 1),
            yoyo: true,
            ease: "sine.inOut",
          },
          0,
        );
      }

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
  `Generated index.html — ${clips.length} clip(s), ${lyrics.length} lyric line(s), ${totalDuration}s total, ${(config.glitchBeats ?? []).length} glitch beat(s)`,
);
