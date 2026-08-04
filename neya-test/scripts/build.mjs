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
//
// Image clips get an extra nested wrapper stack + two ghost <img> copies so
// the runtime script can layer several TikTok/CapCut-style accents without
// any of them fighting each other for control of the same transform — each
// effect gets its own element to animate:
//   .visual-wrap  (outermost) — glitch jitter target
//   .visual-beat  (nested)    — continuous beat-synced zoom-punch target
//   .visual-kb    (nested)    — Ken Burns zoom/pan target
const videoBlocks = clipsWithTiming
  .map(({ src, start, duration, type }, i) => {
    if (type === "image") {
      return `      <div id="clip-${i + 1}-wrap" class="visual-wrap">
        <div id="clip-${i + 1}-beat" class="visual-beat">
          <div id="clip-${i + 1}-kb" class="visual-kb">
            <img
              id="clip-${i + 1}"
              class="clip"
              src="${src}"
              data-start="${start}"
              data-duration="${duration}"
              data-track-index="0"
            />
            <img class="glitch-ghost glitch-ghost-r" src="${src}" aria-hidden="true" />
            <img class="glitch-ghost glitch-ghost-c" src="${src}" aria-hidden="true" />
          </div>
        </div>
      </div>
      <div id="clip-${i + 1}-glitch-overlay" class="glitch-overlay" aria-hidden="true"></div>
      <div id="clip-${i + 1}-glitch-flash" class="glitch-flash" aria-hidden="true"></div>`;
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

// Static film-grain texture (deterministic SVG feTurbulence, fixed seed —
// not Math.random) encoded as a data URI so it's a plain tiled background
// image at render time: zero animation cost, painted once like any other
// background. encodeURIComponent handles all the escaping (#, quotes, etc.)
// so nothing here needs hand-escaping.
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

      /* .visual-wrap = glitch jitter target, .visual-beat (nested) =
         continuous beat-zoom-punch target, .visual-kb (nested again) = Ken
         Burns target. Three separate elements so none of the three tweens
         ever fight another for control of the same node's transform. */
      .visual-wrap,
      .visual-beat,
      .visual-kb {
        position: absolute;
        inset: 0;
      }

      /* Chromatic-aberration ghosts for the glitch pulses: cheap color-tinted
         duplicates blended additively, not a true per-channel split (SVG
         feColorMatrix would isolate channels exactly, but that's meaningfully
         more expensive to composite across a multi-thousand-frame render —
         not worth it for a brief, low-opacity pulse). Hidden (opacity 0) by
         default; the runtime script flashes them on at each glitch beat. */
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

      /* Screen-locked VHS scanlines (deliberately NOT inside .visual-wrap /
         .visual-kb — a scanline overlay reads as a property of the screen,
         not the scene, so it shouldn't jitter or zoom with the image).
         Below the lyrics (z-index 10) so text stays crisp; hidden by default,
         flashed on briefly at each glitch beat. */
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

      /* Quick white flash, layered with the glitch pulses below for extra
         punch at accent beats. Above the scanlines, still below lyrics. */
      .glitch-flash {
        position: absolute;
        inset: 0;
        z-index: 4;
        opacity: 0;
        pointer-events: none;
        background: #ffffff;
        mix-blend-mode: overlay;
      }

      /* Permanent, static, subtle — a vignette and a film-grain texture.
         Both are CapCut/TikTok-edit staples and both are essentially free:
         no animation, no per-frame GSAP cost, just a background painted the
         same way every frame. */
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
         (never a real-time CSS animation) so it stays frame-accurate under
         render capture, which scrubs composition time rather than wall time. */
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
${videoBlocks}

      <div class="vignette-overlay" aria-hidden="true"></div>
      <div class="grain-overlay" aria-hidden="true"></div>
      <div id="bg-glow" class="bg-glow"></div>

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

      // Ken Burns — a single slow zoom/pan across the full duration of each
      // visual clip. One continuous drift (not a loop), per the brief.
      // Plain video clips are tweened directly; image clips wrap their real
      // content in .visual-kb (a purely structural, untimed element) so the
      // Ken Burns tween and the glitch jitter tween (below, on the parent
      // .visual-wrap) each get their own transform to own instead of
      // fighting over the same node's x/y.
      document.querySelectorAll("#root > video.clip").forEach((el) => {
        const start = parseFloat(el.dataset.start);
        const duration = parseFloat(el.dataset.duration);
        tl.fromTo(
          el,
          { scale: 1, x: 0, y: 0 },
          { scale: 1.14, x: -18, y: -14, duration, ease: "none" },
          start,
        );
      });
      document.querySelectorAll("#root .visual-wrap img.clip").forEach((imgEl) => {
        const kbTarget = imgEl.closest(".visual-kb");
        if (!kbTarget) return;
        const start = parseFloat(imgEl.dataset.start);
        const duration = parseFloat(imgEl.dataset.duration);
        tl.fromTo(
          kbTarget,
          { scale: 1, x: 0, y: 0 },
          { scale: 1.14, x: -18, y: -14, duration, ease: "none" },
          start,
        );
      });

      // Beat-synced "zoom punch" — the classic CapCut/TikTok edit rhythm
      // accent: a small continuous scale bounce on a fixed reference tempo,
      // running the whole song so the video never sits perfectly still even
      // between glitch/lyric beats. Same BEAT constant as the glow pulse
      // below, so the two read as one consistent rhythm rather than two
      // unrelated timers.
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

      // Cyberpunk "glitch" pulses on the background visual: a chromatic-
      // aberration ghost flicker, a scanline flash, and a tiny position
      // jitter — fired at hand-picked structural moments in the song
      // (chorus entries, the break, the outro line) rather than a fixed
      // interval, so each hit lands on a real accent instead of ticking
      // mechanically. Jitter offsets are hand-authored fixed values, not
      // Math.random(), to keep render output deterministic.
      const GLITCH_BEATS = [39.4, 95.26, 113.37, 127.45, 167.44];
      document.querySelectorAll("#root > .visual-wrap").forEach((wrapEl) => {
        const imgEl = wrapEl.querySelector("img.clip");
        const ghostR = wrapEl.querySelector(".glitch-ghost-r");
        const ghostC = wrapEl.querySelector(".glitch-ghost-c");
        const overlayEl = wrapEl.nextElementSibling;
        const flashEl = overlayEl?.nextElementSibling;
        if (
          !imgEl ||
          !ghostR ||
          !ghostC ||
          !overlayEl?.classList.contains("glitch-overlay") ||
          !flashEl?.classList.contains("glitch-flash")
        ) {
          return;
        }

        const start = parseFloat(imgEl.dataset.start);
        const duration = parseFloat(imgEl.dataset.duration);
        const JITTER = [
          [3, -2],
          [-4, 1],
          [2, 2],
          [-2, -3],
          [1, 0],
        ];

        for (const t of GLITCH_BEATS) {
          if (t < start || t > start + duration - 0.5) continue;
          tl.set([ghostR, ghostC], { opacity: 0, x: 0 }, t);
          tl.to(ghostR, { opacity: 0.75, x: -6, duration: 0.06 }, t);
          tl.to(ghostC, { opacity: 0.75, x: 6, duration: 0.06 }, t);
          tl.to([ghostR, ghostC], { opacity: 0, x: 0, duration: 0.12 }, t + 0.22);

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

      // Ambient glow pulse behind the lyrics, on the same fixed reference
      // tempo (~100 BPM, BEAT above) as the zoom punch — there's no audio
      // analysis, so this is a steady approximation rather than a true
      // beat-synced pulse.
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
