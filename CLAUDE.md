# Rhythm Into Tone: notes for Claude

A web instrument where a looped rhythm, sped up, becomes a tone whose timbre is the rhythm. Served by GitHub Pages straight from `main`, with no build step. Everything is in `index.html`, apart from the install files (`manifest.webmanifest`, `icon.svg`, `icon-*.png`) that let it be added to the Dock on a Mac or installed on a phone.

## What Jesse wants from it

- An **accurate representation of the maths, not a faked one**. The sound engine, the wheel and the Fourier circles must all come from the same loop data. Don't add crossfades, mode switches or drawings that only look right. The spectrum panel was dropped (Jesse found it added little); the Scope shows the measured output instead.
- The goal is a **fused timbre**. Phase-locked rings make one periodic tone. Detune is the honest way to split it.
- LFOs on everything. A sequencer that can be in its own window.
- His main machine is a MacBook Pro (Retina, 15-inch, Late 2013, 16 GB) on macOS Big Sur. Chrome stopped updating there at version 138 and Safari has no Add to Dock, so build for Chrome 138 and current Firefox. It must also work on an Android phone (about 390 px wide, no sideways scroll), in both light and dark themes. The older 4 GB Linux laptop was the earlier target; he has not said whether it still matters.

## How index.html is built

1. **Shared maths (top of the script).** These are run on the page *and* copied into the AudioWorklet with `Function.prototype.toString`, so they may only use each other and built-ins. If you add one the Engine needs, add it to the `WORKLET_SRC` list too.
   - **The functions:** `frac`, `clamp`, `rnd`, `lfoVal`, `lfoAmt`, `lockVal`, `newEff`, `effParams`, `euclidPattern`, `ringPos`, `ringDots`, `dotF`, `dotS`, `dotWheel`, `dotSliceA`, `dotSliceN`, `dotTurn`, `dotSeed`, `dotPitch`, `dotLen`, `seqStep`, `applyMsg`.
   - **The `Engine` class.**

   Do not use `eval`/`new Function`: some hosts block it.
2. **`effParams(S, t, step, E)`** turns saved state into the values in force at time `t`. It works in three layers: base values, then sequencer locks for the current step, then LFOs. It fills `E` in place, so it creates no garbage on the audio thread. Keep it allocation-free.
3. **`Engine`.** One phase clock and four rings. Each hit starts a Gaussian-windowed sine grain at its exact sub-sample time. Grains run by recurrence, and each keeps the F and σ it started with. A ring's rotation offset (`off`) shifts its phase, and hits crossed by rotation alone are skipped. The engine counts loops for the sequencer's Loops clock. A soft limiter only acts above 0.8.
   **Per-dot settings.** Each ring has `dp` (pitch offset, semitones, ±24), `dl` (length offset, octaves, ±2) and `da` (level, 0–1), 16 slots each. A dot is numbered by its order in the unrotated pattern (`ringDots`), so its settings travel with it when the ring rotates. Offsets are relative to Click pitch and Click length, so LFOs and the sequencer still move every dot. `dotList`/`heardMag` give the exact click spectrum (each dot's own click spectrum with its 3σ delay phase, summed). No panel draws it any more, but the tests check the engine against it, and the circles use `dotList`. A dot is edited by clicking it on the wheel (`#dotBox`). Each dot also has its own LFO on pitch (`pld` depth in semitones, `plr` rate, `pls` shape) and on length (`lld` in octaves, `llr`, `lls`). `dotPitch`/`dotLen` are the one place these are worked out, for the engine (at the moment a click starts) and for the page (`dotList(E,t)`). Each dot's LFO has its own start phase (`dotSeed`).
   **Wheels inside dots.** Every dot has a kind, `dk`: `'click'` plays one click, `'wheel'` plays the wheel kept in `kids[d]` (`{rings:[4 rings]}`, each ring shaped like a top ring, so its dots can hold wheels again). `dt` is the inner wheel's one turn, as a fraction of the turn of the wheel it sits in (1/64–1). Wheels nest three levels below the top (`dotWheel(r,d,depth)`). More kinds (a sample, a bare impulse) are meant to be added to `dk` later. When a playhead crosses a dot, `Engine.fire` sets down the inner wheel's dots at their exact times in a queue of pending dots (no allocation) and each fires the same way when due. A turn is one-shot, keeps the length it started with, and may overlap the next dot. Level multiplies and pitch and length add up on the way down. Inner rings are plain saved values: the ring LFOs and sequencer lanes act on the top wheel only (dot LFOs work at every level). `dotList` expands the same tree, so the circles stay exact; the tests check the engine against it three levels deep.
   **Samples and impulses.** `dk` can also be `'sample'` or `'impulse'`. A sample dot plays a slice of the recording in slot `ds[d]` (0–7): it starts at `dss[d]` and lasts `dsn[d]` (both 0–1 of the recording) times 2^Length, with raised-cosine edges of 5 ms or half the slice (`Engine.slice`, up to 128 slices at once, linear interpolation). Pitch is playback speed; Click pitch and Click length do not apply. An impulse dot writes one band-limited spike (a windowed sinc, 8 samples late, `Engine.spike`). Recordings are mono `Float32Array`s kept in IndexedDB (`rit-samples-v1`), never in the patch; the page holds them in `samples[]` and sends each to the engine with a `smp` message (`applyMsg`). `dotSliceA`/`dotSliceN` are the one place the slice is worked out. Click overlap compensation (`comp`) applies to clicks only.
   **Which wheel is on screen.** `view` is a path of dots from the top; `VR()` is that wheel's rings. The ring controls, presets and dot editor edit `VR()`. `#path` shows the path and leads back up. `viewClock` works out the open wheel's playhead from the top clock, so it only moves while that wheel is actually playing.
4. **Page side.** Constants, `LFOSPEC`, `state` with `sanitizeState`/`sanitizeSeq`, and the message `bus`. The bus uses BroadcastChannel and also does direct `postMessage` to a popup or opener, de-duplicated by message id.
5. **`mountSequencer(host, opts)`.** The sequencer view, used in its own window (`#sequencer`) or docked in the instrument.
6. **`initInstrument()`.** The instrument view, audio start, visual mirror, drawing and readouts.
7. **Route.** `#sequencer` shows only the sequencer. Anything else shows the instrument.

Bus messages (keep them small and JSON-serialisable):

| type | direction | contents |
|---|---|---|
| `hello` | sequencer → instrument | ask for the current sequence and status |
| `seq` | sequencer → instrument | the whole sequence (`playing` is ignored) plus `origin` |
| `seq-sync` | instrument → sequencers | the sequence as now in force, with the `origin` that caused it |
| `transport` | sequencer → instrument | `play: true/false` |
| `status` | instrument → sequencers | `running`, `playing`, `step` (about every 40 ms, and every 700 ms as a heartbeat) |

## Look and desktop use

- The style is a lab-instrument sheet: pale ground, one blue accent for the interface, hairline rules, numbered panels (`01 Loop` … `08 Sequencer`), small monospace caps labels over live readouts (`.stats`). The four rings have bold colours of their own (blue, red, amber, green), which Jesse asked for. Dot shapes show the kind: circle click, hollow circle wheel, square sample, spike impulse. Keep it flat: no cards, shadows or gradients.
- Three columns from 1240 px (loop and speed; scope, circles and samples; rings and click), two below that, one on a phone.
- Window preferences (theme Auto/Light/Dark, Notes on/off) live in `localStorage` under `rit-ui-v1`, separate from the patch. Notes hides every `.hint`; it is off by default.
- Keyboard: Space sound, P sequencer, 1–4 rings, ←/→ semitone (Shift = octave), N notes. Keys are ignored while typing in a field.
- Every number in a stats row must come from the same data as the plot above it. The Scope reads the signal back from an `AnalyserNode` after the limiter, so it is measured, not calculated.

## Things that must not break

- **Saved state is a public API.** It is stored in `localStorage` under `rit-state-v1`. Never rename or remove keys in `base`, `rings`, `lfo` or `seq`. LFO and lane keys such as `speed`, `F`, `r0rot` are part of it too. Add new keys and give them fallbacks in `sanitizeState`/`sanitizeSeq`. If the shape has to change incompatibly, use a new storage key and migrate.
- Starting audio: create the `AudioContext` and call `resume()` inside the tap (iOS). Fall back to the ScriptProcessor engine when AudioWorklet is missing.
- Messages to the engine must be sent straight away, not on `requestAnimationFrame`, because the instrument tab may be in the background while the sequencer window is used.
- Colours only through the CSS tokens (`T[...]` in canvas code), never literals. The `[hidden]` rule must stay, because many hidden elements have their own `display`.
- Keep the standalone document head: charset, viewport with `viewport-fit=cover`, and the safe-area padding.

## Checking work before pushing

1. Syntax-check the script:
   ```
   node -e "const s=require('fs').readFileSync('index.html','utf8');new Function(s.split('<script>')[1].split('</script>')[0])"
   ```
2. Serve the repo (`python3 -m http.server 8765`) and run `node tests/check.cjs`. It must print `ALL CHECKS PASSED`.
3. Look at the screenshots in `tests/out/` for anything visual you changed.
4. Tell Jesse what was not checked by ear. Headless tests can't judge sound or levels.

## Ideas discussed but not built

- Wheels all the way down as the basis of a DAW (a top wheel whose dots are sections, then patterns, notes and clicks). Wheels inside dots are built, three levels below the top. Not built: a Solo button for the open wheel, and ring LFOs and sequencer lanes for inner wheels.
- Agreed with Jesse as next steps: tabs in the dot editor (it is getting long), copy and paste of a wheel between dots (and linked copies), patch slots with an export file and undo, recording the output to WAV, a map of the whole wheel tree, a Fit button for Turn. For samples: a Start LFO, recording from the microphone, stereo.
- Morphing between two saved rhythms.
- Tapping hits directly on the wheel.
- Becoming a module in Jesse's Patchwork rack (repo `JellyboyJesse/Solf-ge`, see its `MODULES.md`). He chose to keep it as its own repo for now.
