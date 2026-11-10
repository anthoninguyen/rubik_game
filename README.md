# CubeRush 3×3

A 3×3 speed-cube puzzle that runs in the browser, built with AI assistance for the AI-Native Startup Design course (Game and Business assignment).

## How to play

- **Mouse / touch:** drag a sticker to turn its layer; drag empty space to rotate the whole cube.
- **Keyboard (speedcuber layout):** `I`/`K` = R/R′, `J`/`F` = U/U′, `H`/`G` = F/F′, `D`/`E` = L/L′, `S`/`L` = D/D′, `W`/`O` = B/B′, `;`/`A` = y/y′, `T`/`B` = x/x′, `P`/`Q` = z/z′. Press `?` in the game for the full map. A notation layout (`R`, `Shift+R` = R′) is available in Settings.
- `Space` scrambles, `Esc` resets, `Backspace` undoes.
- The timer starts on your first turn after a scramble and stops when the cube is solved. Best time, Ao5 and Ao12 are saved in your browser.

## Tech

Static site: `index.html`, `style.css`, `main.js`, and [three.js](https://threejs.org/) 0.160 loaded from the jsDelivr CDN. No build step.
