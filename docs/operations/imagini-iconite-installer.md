---
title: Imagini, iconițe și mărimea installer-ului
type: operation
created: 2026-11-14
updated: 2026-11-14
sources:
  - code: src/App.tsx
  - code: src/DSTimer.tsx
  - code: src/DSTimerOverlay.tsx
  - code: src/assets/crowsight-logo.webp
  - code: src-tauri/tauri.conf.json
  - code: src-tauri/icons/icon.ico
  - code: src/vite-env.d.ts
verified_at: 8cc1f51
---

# Imagini, iconițe și mărimea installer-ului

Unde stau imaginile aplicației, în ce format și cum se schimbă logo-ul fără să rămână
cel vechi în build-ul de release.

## Imaginile din UI (WebP)

- Logo-ul din title bar: `src/assets/crowsight-logo.webp` (144px, afișat la 36px),
  importat în `src/App.tsx:25` și folosit în `LogoMark` (`src/App.tsx:101`).
- Glyph-urile de perk: `src/assets/perk-timer/{bt,elusive}.webp`, albe pe transparent,
  folosite ca mască CSS ca să ia culoarea aleasă de user. URL-ul se construiește în
  `src/DSTimer.tsx:64` și, duplicat intenționat, în `src/DSTimerOverlay.tsx:28`.
- `src/vite-env.d.ts` aduce tipurile `vite/client`, ca TypeScript să accepte importul
  de `.webp`.

Vite inline-uiește ca base64 în JS fișierele sub 4 KB (logo-ul, `bt`) și dă un nume cu
hash celor mai mari (`elusive-<hash>.webp`). În ambele cazuri URL-ul se schimbă când se
schimbă conținutul.

> ⚠️ Nu pune logo-ul înapoi în `public/` și nu-l referi cu un path fix (ex.
> `/logo-transparent.png`). Fișierele din `public/` păstrează numele, așa că WebView2
> poate servi versiunea veche din cache după un update. Importă-l din `src/assets`.

> ⚠️ Extensia e hardcodată în `perkIconUrl` în **două** locuri (`src/DSTimer.tsx` și
> `src/DSTimerOverlay.tsx`). Dacă schimbi formatul sau adaugi un perk, modifică-le pe
> amândouă, altfel overlay-ul rămâne fără iconiță.

## Iconițele aplicației (exe, installer)

`src-tauri/icons/` conține `.ico`, `.icns` și `.png`, listate în
`src-tauri/tauri.conf.json` la `bundle.icon`. Acestea **nu** pot fi WebP: Windows și
Tauri cer exact formatele astea.

Se regenerează toate dintr-o singură imagine pătrată (PNG cu transparență, ideal
1024px+):

```
npx tauri icon <logo.png>
```

> ⚠️ Când schimbi logo-ul, schimbă-l în ambele locuri: `src/assets/crowsight-logo.webp`
> (UI) **și** iconițele regenerate cu `tauri icon` (exe, installer, taskbar). Commit-ul
> `8cc1f51` le-a făcut pe amândouă din aceeași sursă.

## Mărimea installer-ului și WebView2

Target-ul e doar NSIS (`src-tauri/tauri.conf.json:38`). Secțiunea `bundle.windows`
**nu** setează `webviewInstallMode`, deci Tauri folosește modul implicit
(`downloadBootstrapper`): descarcă WebView2 doar dacă lipsește.

> ⚠️ Nu reactiva `"webviewInstallMode": { "type": "offlineInstaller" }`. A fost adăugat
> în 1.3.2 pentru PC-uri Windows 10 fără WebView2 și a umflat installer-ul la ~200 MB
> (scos în `8cc1f51`). Dacă problema reapare, `{ "type": "embedBootstrapper" }` adaugă
> doar ~1.8 MB.

Release-ul se face cu `npm run release X.Y.Z` (`scripts/release.mjs`), care pune un tag
`vX.Y.Z`. Tag-ul pornește `.github/workflows/release.yml`, care construiește installer-ul
pe `windows-latest`.
