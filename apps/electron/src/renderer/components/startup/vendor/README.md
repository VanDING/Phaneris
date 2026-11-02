# Letter Glitch provenance

- Author: David Haz, React Bits, copyright 2026.
- Source: https://github.com/DavidHDev/react-bits/blob/main/src/content/Backgrounds/LetterGlitch/LetterGlitch.jsx
- Upstream source SHA-256 reviewed on 2026-10-30: `a66384312f55c03b5482e8ffc509cb9e122260f8d80bff6db5bba049fe244c92`.
- License: **MIT + Commons Clause**, retained in `apps/electron/resources/licenses/react-bits-LICENSE.md` and packaged with the app. This source is not Apache-2.0.
- Adaptations: `paused` and `onFrame` props for a static reduced-motion frame and redraws without resetting the canvas. Paused frames refresh uniforms without advancing simulation time.
- Loading adaptation (2026-11-02): `loading` / `loadingColor` pin LOADING to seven cells of the same atlas. Odd grid dimensions keep it centered. Only its opacity breathes (3.2 s, 0.30–0.64); readiness fades it out without resetting the field. Reduced motion and paused redraws clear it immediately on readiness.
- Product palette, fallback, actual-readiness gate and logo choreography live in `SplashScreen.tsx` and `startup.css`, outside this component. No new runtime dependency or network asset is required.
