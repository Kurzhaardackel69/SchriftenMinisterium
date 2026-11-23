# Enthaltene Fremdkomponenten

## Mozilla PDF.js / pdfjs-dist 6.5.438

- Projekt: https://github.com/mozilla/pdf.js
- Offizielles Paket: https://www.npmjs.com/package/pdfjs-dist/v/6.5.438
- Copyright: Mozilla Foundation und weitere im Quellcode genannte Mitwirkende.
- Lizenz: Apache License 2.0; vollständiger Text unter `public/vendor/pdfjs/LICENSE`.
- Unveränderte Distributionsdateien: `pdf.mjs`, `pdf.worker.mjs`, CMaps, Standardschriften und WASM-Ressourcen unter `public/vendor/pdfjs/`.
- Enthaltene Ressourcen haben zusätzliche Lizenz- und Copyright-Hinweise in ihren jeweiligen Unterordnern. Diese Dateien sind Bestandteil des Projekts und müssen bei Weitergabe erhalten bleiben.
- Bezugsquelle und Integritätsprüfung sind in `scripts/vendor-pdfjs.mjs` festgehalten.

PDF.js rendert die PDF-Dateien lokal im Browser. Es werden keine Dateien an Mozilla oder einen PDF-Dienst übertragen. Die SchriftenMinisterium-MIT-Lizenz gilt nicht für diese Fremdkomponenten.

## Desktop-Laufzeit

Die Windows-Desktop-Ausgabe enthält Electron 45.4.1 (MIT-Lizenz) einschließlich Chromium und Node.js. Die vom offiziellen Electron-Paket mitgelieferten Dateien LICENSE und LICENSES.chromium.html bleiben im installierten Programmverzeichnis erhalten. Quellen und Informationen: https://github.com/electron/electron/tree/v45.4.1 und https://www.electronjs.org/.

## Standard-PDF-Compiler

Die Desktop-Ausgabe enthält die unveränderte offizielle Windows-x64-Programmdatei von Tectonic 0.17.0. Lizenz, Herkunft und SHA-256-Prüfsumme liegen unter resources/runtime/TECTONIC-LICENSE.txt und resources/runtime/README.txt. Quellen: https://github.com/tectonic-typesetting/tectonic/releases/tag/tectonic%400.17.0. Die Bezugsquelle und Integritätsprüfung sind in scripts/prepare-desktop.mjs festgehalten.

Git sowie zusätzlich installierte vollständige TeX-Distributionen und ihre Werkzeuge werden nicht mitgeliefert und behalten ihre eigenen Lizenzen.
