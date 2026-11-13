# Rhythm Into Tone

Build a loop as a rhythm, then speed it up until it fuses into a single tone. The pattern you built becomes that tone's timbre. The harmonic bars and the Fourier circles on screen are calculated from the same loop you hear, so the pictures show the maths behind the sound rather than an illustration of it.

**Live site:** https://jellyboyjesse.github.io/Rhythm-to-tone/ (once GitHub Pages is turned on, see below)

It is one HTML file with no build step and no libraries. It runs in a desktop or phone browser.

## Using it

Press **Start sound** in the bar at the top. Everything else works without sound too.

- **The loop.** Up to four rings. Each ring spreads its hits as evenly as possible over its steps, which makes a Euclidean rhythm (3 hits in 8 steps is the tresillo, 5 in 8 the cinquillo). A ring with the same number of steps and hits is a plain pulse, so rings of 2 and 3 make a 2-against-3 polyrhythm. The presets are starting points.
- **Speed.** One dial covers about one loop every four seconds up to 1,000 loops a second.
  - Below about 10 hits a second you hear separate hits.
  - Between 10 and 20 is the blur zone, where the hits run together but have no pitch yet.
  - Above about 20 loops a second the loop fuses into one pitch at the loop rate.
  
  **Sweep** glides from half a loop a second up to 220 Hz. **Snap to notes** rounds the speed to semitones once it is a pitch.
- **Harmonics.**
  - *Rhythm DFT* shows how strongly the pattern repeats 1, 2, 3… times per loop. Once the loop is a pitch, bar n is the strength of harmonic n.
  - *Heard spectrum* shows what reaches the speaker: those harmonics multiplied by the click's own spectrum (the dashed curve).
- **The loop as circles.** Circle n spins n times per loop. Its size and starting angle come from the pattern's nth Fourier coefficient. Chained together, the circles draw the pattern.
- **Click and fusion.**
  - Click pitch sets a formant, which stays fixed in Hz while the loop pitch moves, like a vowel. Click length sets how long each click lasts.
  - Detune gives each ring a slightly different speed. The loop then stops repeating exactly and the tone splits into separate beating voices.
  - Shared vibrato moves every ring together, which helps the ear hear one sound.
- **LFOs.** Every control has an **LFO** tag. Tap it to open its drawer. There are six shapes (sine, triangle, saw, square, random steps, smooth drift), with a rate from about one cycle a minute to 20 Hz and a depth. **Scatter** puts four random LFOs on; **Clear all** removes them. **Calm visuals** stops the flashing playheads at speed.
- **Sequencer.** Open it with **Open in new window**, or with **Show here** to see it on the same page.
  - The top row rests or plays each step. The row below it makes a step glide into the next.
  - Four lanes each lock one control to a value on chosen steps: speed or pitch, click pitch or length, detune, vibrato, volume, or any ring's steps, hits, rotate or level. Drag across the steps to draw values. Steps left empty use the front-panel setting, and LFOs still move on top.
  - Two clocks:
    - **Tempo**: BPM, step length and swing.
    - **Loops**: one step every so many loops, so in the rhythm range the sequence changes with each bar.
  - The examples are *Melody*, *Pulse to pitch* (a step-by-step climb from rhythm into tone) and *Bar changes*.

Your patch and sequence are saved in your browser and come back next time. **Reset patch** (tap twice) restores the defaults.

## The maths

Loop one bar of the rhythm and you have a periodic signal, so it has a Fourier series. Its spectrum splits into two parts:

**harmonic n = (the rhythm's DFT at n) × (the click's spectrum at n × loop rate)**

- The rhythm sets which harmonics are present and how strong each is. This part moves with the pitch.
- The click sets a spectral envelope, a formant fixed in Hz. This is the principle of FOF and pulsar synthesis.

For stacked pulse layers this becomes number theory. A layer that hits r times per loop feeds only harmonics that are multiples of r. So rings of 1, 2, 3 and 4 give harmonic strengths of 1, 3, 4, 7, 1, 6, 1, 7…: strong where a harmonic number has many divisors, weak at primes. A 2-against-3 polyrhythm at audio speed has no fundamental at all, yet you still hear its pitch at the loop rate.

How the sound is made:

- **One engine at every speed.** There is no switch between rhythm and pitch. Every hit starts a short, smooth click (a Gaussian-windowed sine) at its exact time, down to a fraction of a sample. Overlapping clicks simply add together. Because of that, the output is the Fourier series above at any speed. The tests check this against the formula.
- **Clicks keep their settings.** Each click keeps the pitch and length it had when it started, as in pulsar synthesis. LFOs on the click therefore change it hit by hit.
- **Sequencer and LFOs run inside the sound engine.** Their timing is exact even when the page is in the background.
- **Fallback engine.** On browsers without AudioWorklet, the same engine runs through an older audio API.

Further reading:

- Jason Yust, *Steve Reich's Signature Rhythm, and an Introduction to Rhythmic Qualities* ([PDF](https://people.bu.edu/jyust/reich_final.pdf))
- Jason Yust, review of Emmanuel Amiot's *Music Through Fourier Space* ([Music Theory Online](https://mtosmt.org/issues/mto.17.23.3/mto.17.23.3.yust.html))
- Andrew Milne et al., *XronoMorph* ([NIME 2016](https://nime.org/proc/nime2016_milne/))
- Curtis Roads, pulsar synthesis, and the New Pulsar Generator ([nuPG](https://www.ctm-festival.de/festival-2021/programme/practice/a2a-transmission/workshop-6-marcin-pietruszewski))
- Xavier Rodet, FOF synthesis ([Csound FOF](https://csound.com/manual/fof2.html))

## Turning on GitHub Pages

GitHub Pages needs the repository to be **public** on a free account (Settings → General → Danger Zone → Change visibility). Then: Settings → Pages → Source: **Deploy from a branch** → Branch: `main`, folder `/ (root)` → Save. The site appears at the address above within a minute or two.

## Running it locally

Open `index.html` in a browser. The sequencer's separate window needs the page served over http:

```
python3 -m http.server 8765
```

Then open http://localhost:8765.

## Checking it

`tests/check.cjs` runs the whole thing in headless Chromium with Playwright and fails if anything is off. With a local server running (as above):

```
node tests/check.cjs
```

The checks cover:

- the engine's harmonics against the formula
- sequencer timing and rests
- every LFO at once at four speeds
- the instrument and sequencer staying in sync across tabs and on one page
- reset and saved settings
- the fallback engine
- no sideways scroll at phone width in light and dark

Screenshots go to `tests/out/`. The tests can't judge how it sounds, so listen too.

## Files

```
index.html        the whole app: page, styles, sound engine, sequencer
tests/check.cjs   headless browser checks (needs Playwright)
README.md         this file
CLAUDE.md         working notes for Claude
```

## Per-dot pitch, length and level

Click a dot on the wheel to give that one hit its own pitch (in semitones from the Click pitch), length (as a multiple of the Click length) and level. A dot with its own pitch or length gets a thin outline, and a dot at level 0 is drawn hollow and stays silent. The settings follow the dot when its ring rotates. The Heard spectrum adds up every dot's own click spectrum, so it still shows exactly what is played.

## Using it as a Mac app

Open the page in Safari and choose File → Add to Dock, or in Chrome use the install button in the address bar. It then runs in its own window with its own Dock icon. Keyboard: Space starts and stops the sound, P plays the sequencer, 1–4 switch rings, ← and → move the speed by a semitone (with Shift, an octave), N shows the notes.
