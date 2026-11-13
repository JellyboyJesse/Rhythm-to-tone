# Rhythm Into Tone: notes for Claude

A web instrument where a looped rhythm, sped up, becomes a tone whose timbre is the rhythm. Served by GitHub Pages straight from `main`, with no build step. Everything is in `index.html`, apart from the install files (`manifest.webmanifest`, `icon.svg`, `icon-*.png`) that let it be added to the Dock on a Mac or installed on a phone.

## What Jesse wants from it

- An **accurate representation of the maths, not a faked one**. The sound engine, the spectrum views and the Fourier circles must all come from the same loop data. Don't add crossfades, mode switches or drawings that only look right.
- The goal is a **fused timbre**. Phase-locked rings make one periodic tone. Detune is the honest way to split it, and when detune is on the spectrum greys out and says why.
- LFOs on everything. A sequencer that can be in its own window.
- It must work on an Android phone (about 390 px wide, no sideways scroll) and on an older Linux laptop with 4 GB of RAM, in both light and dark themes.

## How index.html is built

1. **Shared maths (top of the script).** These are run on the page *and* copied into the AudioWorklet with `Function.prototype.toString`, so they may only use each other and built-ins. If you add one the Engine needs, add it to the `WORKLET_SRC` list too.
   - **The functions:** `frac`, `clamp`, `rnd`, `lfoVal`, `lfoAmt`, `lockVal`, `newEff`, `effParams`, `euclidPattern`, `ringPos`, `ringDots`, `dotF`, `dotS`, `seqStep`, `applyMsg`.
   - **The `Engine` class.**

   Do not use `eval`/`new Function`: some hosts block it.
2. **`effParams(S, t, step, E)`** turns saved state into the values in force at time `t`. It works in three layers: base values, then sequencer locks for the current step, then LFOs. It fills `E` in place, so it creates no garbage on the audio thread. Keep it allocation-free.
3. **`Engine`.** One phase clock and four rings. Each hit starts a Gaussian-windowed sine grain at its exact sub-sample time. Grains run by recurrence, and each keeps the F and σ it started with. A ring's rotation offset (`off`) shifts its phase, and hits crossed by rotation alone are skipped. The engine counts loops for the sequencer's Loops clock. A soft limiter only acts above 0.8.
   **Per-dot settings.** Each ring has `dp` (pitch offset, semitones, ±24), `dl` (length offset, octaves, ±2) and `da` (level, 0–1), 16 slots each. A dot is numbered by its order in the unrotated pattern (`ringDots`), so its settings travel with it when the ring rotates. Offsets are relative to Click pitch and Click length, so LFOs and the sequencer still move every dot. The page's spectrum comes from `dotList`/`heardMag`/`heardEnv`, which sum each dot's own click spectrum (with its 3σ delay phase); the tests check the engine against them. A dot is edited by clicking it on the wheel (`#dotBox`). Each dot also has its own LFO on pitch (`pld` depth in semitones, `plr` rate, `pls` shape) and on length (`lld` in octaves, `llr`, `lls`). `dotPitch`/`dotLen` are the one place these are worked out, for the engine (at the moment a click starts) and for the page (`dotList(E,t)`). Each dot's LFO has its own start phase (`dotSeed`).
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

- The style is a lab-instrument sheet: pale ground, one blue accent, hairline rules, numbered panels (`01 Loop` …), small monospace caps labels over live readouts (`.stats`). Ring colours stay in the blue/ink/slate family. Keep it flat: no cards, shadows or gradients.
- Three columns from 1240 px (loop and speed, harmonics and circles, rings and click), two below that, one on a phone.
- Window preferences (theme Auto/Light/Dark, Notes on/off) live in `localStorage` under `rit-ui-v1`, separate from the patch. Notes hides every `.hint`; it is off by default.
- Keyboard: Space sound, P sequencer, 1–4 rings, ←/→ semitone (Shift = octave), N notes. Keys are ignored while typing in a field.
- Every number in a stats row must come from the same `E`/`C` data as the plot above it.

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

- A "self-similar" mode: each hit of a slow groove plays a grain that is the same pattern at pitch speed (the slow pattern convolved with the fast one).
- Morphing between two saved rhythms.
- Tapping hits directly on the wheel.
- Becoming a module in Jesse's Patchwork rack (repo `JellyboyJesse/Solf-ge`, see its `MODULES.md`). He chose to keep it as its own repo for now.
