# TrackLine

Local telemetry comparison for Assetto Corsa Competizione. TrackLine discovers `.ld` logs under `Documents/Assetto Corsa Competizione/MoTeC`, reads MoTeC LD channels locally, and stores the preferred reference, imported paths, and best sector times in Electron's local application data.

## Run

Install Node.js 20 or newer, then run:

```powershell
npm.cmd install
npm.cmd run dev
```

Build a Windows installer with `npm.cmd run dist`. Use **Import** to select `.ld` logs outside the default directory. Matching `.ldx` sidecars are detected and basic XML vehicle, venue, and driver tags are used when available.

## Live coaching HUD

While ACC is running, TrackLine reads its shared memory (pedals, lap position, car coordinates, car and track) and compares it with the **fastest library lap for the same car and track**. The **LIVE** button in the header shows connection status, the reference lap in use, and settings.

- **HUD**: a transparent, click-through, always-on-top overlay with throttle and brake bars (you vs reference tick) and an HSI-style line indicator: a look-ahead ribbon of the reference line plus a deviation needle showing how far to move left or right in metres.
- **Hotkeys**: `Ctrl+Alt+H` shows or hides the HUD; `Ctrl+Alt+E` toggles edit mode to drag it and resize it with the corner grip. The layout is saved.
- **Display mode**: the overlay needs ACC in **Borderless** or **Windowed** mode; it cannot draw over exclusive fullscreen. Switch HUD mode to *Normal window* to show it on a second monitor instead.
- **Reference markers**: disable *Show coaching reference markers* in the LIVE panel to hide the reference pedal ticks, ghost arcs, and look-ahead warning arcs while keeping your own input display.
- **Look-ahead warnings and voice**: about 0.25 s before a braking or throttle zone (adjustable in the LIVE panel) a flashing arc appears outside the matching half-circle, sized to the % to apply. Separately, a female voice (Piper "amy") gives short, event-based callouts, never raw percentages: "Brake hard!" / "Brake." shortly before a braking zone, "Back on throttle." before corner exit, "Brake now!" if you miss the braking point, and "Release the brake." if you hold the brake after the reference lets go. It stays silent when you are already doing the right thing. Callouts pass through a single-slot scheduler with a 1–2 s cooldown (LIVE panel) that drops stale and duplicate cues; urgent ones bypass the cooldown. Clips live in `src/voice`; regenerate them with `node scripts/render-voice.cjs` (needs the Piper binary and voice model in `Assets/voice`). Voice and volume are in the LIVE panel.
- **Line calibration**: reference positions come from the MoTeC log and live positions from ACC, so TrackLine fits the two coordinate frames during your first full lap on a track (the HUD shows progress) and remembers the result. Pedal bars work immediately. If left/right looks inverted, enable *Swap left/right guidance* in the LIVE panel.
- **Pre-flight track briefing**: choose Monza, Spa-Francorchamps, or Nürburgring GP from **PRE-FLIGHT** to explore the bundled track map, geometry-grouped corner sequence, and an illustrative outside-in-out line with approach, turn-in, apex, and exit markers. Turn direction and rough corner character are inferred from the map geometry. These are not surveyed racing lines, braking distances, or trackside board positions; use the in-game view to confirm sight lines, grip, and conditions.
- **Post-session setup quiz**: after at least one minute of driving or a completed lap, TrackLine asks what the driver noticed when ACC returns to the menu or closes. It picks a setup for that car (preferring the same track), applies one small change for entry understeer, entry oversteer, or braking stability, then saves a new native ACC JSON beside that car's setups. The original is never overwritten. The balanced answer saves an unchanged baseline copy. If there is no template setup for the car, import one when prompted. These are conservative test variants, not telemetry diagnoses; test one change at a time and keep whichever setup feels better.
- **Tyre feedback**: the LIVE panel reads live pressures and core temperatures and can import an ACC setup JSON from `Documents/Assetto Corsa Competizione/Setups`. After several stable laps, it compares live dry pressure against a 26–27.2 psi hot range and suggests a small next-run starting-pressure change. ACC setup pressure values are car-specific encoded values, so TrackLine displays them as native values rather than guessing their PSI conversion. Confirm weather and the car's current target; core temperatures are not tread-surface readings and cannot guide camber.

## Telemetry notes

The bundled reader decodes numeric MoTeC LD channels, including embedded car, venue, date, distance, speed, timing, pedal, and GPS/world-position channels when present. Channel names vary between logger profiles. Logs without position channels still show their circuit outline and pedal traces. Logs without both distance and usable speed/time channels cannot produce accurate sector timing.

Sector boundaries are approximated at equal thirds of lap distance in v1. Personal bests are retained per detected or overridden car and track. The optimal time sums each best sector and is theoretical; telemetry is not stitched into a synthetic lap.

No accounts or remote services are used. Lap files stay in their original locations; user preferences are stored locally. The interface uses installed fonts and makes no external requests.

## ACC setup references

- [The Ultimate ACC Car Setup Guide](https://coachdaveacademy.com/tutorials/the-ultimate-acc-car-setup-guide/) — dry/wet hot-pressure targets and the effects of brake bias and anti-roll bars on balance.
- [How to Set the Correct Tyre Pressures in ACC](https://coachdaveacademy.com/tutorials/how-to-set-the-correct-tyre-pressures-in-acc/) — assess pressures after several laps and adjust starting pressures to reach the running target.
- [Race Element ACC setup model](https://github.com/RiddleTime/Race-Element/blob/63795df188ad4e7c7b319751d0765c423fca066e/Race_Element.Data.ACC/SetupParser/SetupJson.cs) and [pressure converter](https://github.com/RiddleTime/Race-Element/blob/63795df188ad4e7c7b319751d0765c423fca066e/Race_Element.Data.ACC/SetupParser/SetupConverter.cs#L203-L208) — community implementation references for the native JSON structure and car-specific pressure scaling. They are not official Kunos specifications.
