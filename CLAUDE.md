# Rhythm Into Tone: notes for Claude

A web instrument where a looped rhythm, sped up, becomes a tone whose timbre is the rhythm. Served by GitHub Pages straight from `main`, with no build step. Everything is in `index.html`.

## What Jesse wants from it

- An **accurate representation of the maths, not a faked one**. The sound engine, the spectrum views and the Fourier circles must all come from the same loop data. Don't add crossfades, mode switches or drawings that only look right.
- The goal is a **fused timbre**. Phase-locked rings make one periodic tone. Detune is the honest way to split it, and when detune is on the spectrum greys out and says why.
- LFOs on everything. A sequencer that can be in its own window.
- It must work on an Android phone (about 390 px wide, no sideways scroll) and on an older Linux laptop with 4 GB of RAM, in both light and dark themes.

## How index.html is built

1. **Shared maths (top of the script).** These are run on the page *and* copied into the AudioWorklet with `Function.prototype.toString`, so they may only use each other and built-ins. If you add one the Engine needs, add it to the `WORKLET_SRC` list too.
   - **The functions:** `frac`, `clamp`, `rnd`, `lfoVal`, `lfoAmt`, `lockVal`, `newEff`, `effParams`, `euclidPattern`, `ringPos`, `seqStep`, `applyMsg`.
   - **The `Engine` class.**

   Do not use `eval`/`new Function`: some hosts block it.
2. **`effParams(S, t, step, E)`** turns saved state into the values in force at time `t`. It works in three layers: base values, then sequencer locks for the current step, then LFOs. It fills `E` in place, so it creates no garbage on the audio thread. Keep it allocation-free.
3. **`Engine`.** One phase clock and four rings. Each hit starts a Gaussian-windowed sine grain at its exact sub-sample time. Grains run by recurrence, and each keeps the F and σ it started with. A ring's rotation offset (`off`) shifts its phase, and hits crossed by rotation alone are skipped. The engine counts loops for the sequencer's Loops clock. The output gain (volume x density) glides over about 4 ms so volume jumps never click, then a 3 ms look-ahead peak limiter (`limit`, ceiling 0.89) whose gain is exactly 1 below the ceiling, so the maths stays exact. Start and Stop fade the master `GainNode` over 40 ms. There is no DynamicsCompressor.
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

## Things that must not break

- **Saved state is a public API.** It is stored in `localStorage` under `rit-state-v1`. Never rename or remove keys in `base`, `rings`, `lfo` or `seq`. LFO and lane keys such as `speed`, `F`, `r0rot` are part of it too. Add new keys and give them fallbacks in `sanitizeState`/`sanitizeSeq`. If the shape has to change incompatibly, use a new storage key and migrate.
- Starting audio: create the `AudioContext` and call `resume()` inside the tap (iOS). Fall back to the ScriptProcessor engine when AudioWorklet is missing.
- Messages to the engine must be sent straight away, not on `requestAnimationFrame`, because the instrument tab may be in the background while the sequencer window is used.
- Colours only through the CSS tokens (`T[...]` in canvas code), never literals. The `[hidden]` rule must stay, because many hidden elements have their own `display`.

## The look

A worn plate from an old science textbook. The light theme is aged parchment with faded Prussian blue, ochre, vermilion and verdigris inks. The dark theme is a star atlas in night blue and gold. This is the Celestial Atlas Edition III look, in layers: the base tokens, then the `celestial-atlas` and `celestial-atlas-refinement` style blocks (presentation only), then `edition-iii-fixes`.

- Fonts: EB Garamond 12 (OFL), upright and italic, embedded as `AtlasSerif` so the app works offline. `--display`, `--body` and `--mono` all point to it; numbers use lining, tabular figures (`font-variant-numeric`). There is no Google Fonts link any more.
- Colour tokens live only in the three standard blocks at the top (`:root`, `prefers-color-scheme: dark` guarded by `:not([data-theme="light"])`, and `[data-theme="dark"]`). Don't add token blocks in later layers: that is what broke system dark mode once. Light-theme inks are chosen to reach 4.5:1 on `--sheet`, `--panel` and `--soft`.
- The theme switch (`#themeToggle`, `#themeToggleSeq`) stores `rit-theme` in localStorage. It is an action button naming the theme it switches to, so it has no `aria-pressed`.

- Extra tokens: `--sheet` (translucent plate), `--frame`/`--frame2` (double rules), `--brass*` (Start button and slider knobs), `--stain`/`--fox`/`--edge`/`--burn` (paper wear), `--grain` and `--star` (small data-URI SVGs, one per theme).
- Ornaments drawn with CSS `content` use the `"…" / ""` form so screen readers skip them.
- Paper wear is static CSS backgrounds plus one fixed edge shadow. Don't add live SVG filters or animated textures: they cost too much on the phone and the 4 GB laptop.
- Decoration is never interactive: the running head, the colophon and the corner stars are `aria-hidden` or backgrounds.
- Panels are plates I to VI in the same order on phone and laptop: loop, speed, rings, harmonics, circles, click and fusion.
- The dial around the wheel (`drawDial`) is a true phase scale (0, ¼, ½, ¾ of the loop, clockwise from the top, like the hits), not an ornament with made-up divisions.
- On touch screens (`pointer: coarse`) buttons, steppers, sliders and checkboxes get bigger targets. Desktop sizes are unchanged.
- Keep the standalone document head: charset, viewport with `viewport-fit=cover`, and the safe-area padding.

## Checking work before pushing

1. Syntax-check the script:
   ```
   node -e "const s=require('fs').readFileSync('index.html','utf8');new Function(s.split('<script>').find(x=>x.includes('WORKLET_SRC')).split('</script>')[0])"
   ```
2. Serve the repo (`python3 -m http.server 8765`) and run `node tests/check.cjs`. It must print `ALL CHECKS PASSED`.
3. Look at the screenshots in `tests/out/` for anything visual you changed.
4. Tell Jesse what was not checked by ear. Headless tests can't judge sound or levels.

## Ideas discussed but not built

- A "self-similar" mode: each hit of a slow groove plays a grain that is the same pattern at pitch speed (the slow pattern convolved with the fast one).
- Morphing between two saved rhythms.
- Tapping hits directly on the wheel.
- Becoming a module in Jesse's Patchwork rack (repo `JellyboyJesse/Solf-ge`, see its `MODULES.md`). He chose to keep it as its own repo for now.
