export const templates = {
  article: {
    'main.tex': String.raw`\documentclass[11pt,a4paper]{article}
\usepackage[utf8]{inputenc}
\usepackage[T1]{fontenc}
\usepackage[ngerman]{babel}
\usepackage{amsmath,amssymb}
\usepackage{geometry}
\usepackage{xcolor}
\usepackage{hyperref}
\geometry{margin=2.7cm}
\definecolor{forest}{HTML}{147D64}
\hypersetup{colorlinks=true,linkcolor=forest,urlcolor=forest}

\title{Ein guter Gedanke\\[6pt]\large beginnt mit einer leeren Seite}
\author{Dein Name}
\date{\today}

\begin{document}
\maketitle

\begin{abstract}
Willkommen im SchriftenMinisterium, deinem eigenen Arbeitsplatz
für schriftliche Dokumentation.
Hier werden aus Ideen klar gesetzte Dokumente. Dieses Projekt
enthält alles, was du für den Anfang brauchst.
\end{abstract}

\section{Einleitung}
Schreibe links deinen Text und klicke auf \textbf{Kompilieren}.
Rechts erscheint dein fertiges PDF. Deine Änderungen werden
automatisch lokal gespeichert.

\section{Eine kleine Entdeckung}
Ein guter Satz macht auch komplexe Zusammenhänge lesbar. Zum Beispiel
die berühmte Identität von Euler:
\begin{equation}
  e^{i\pi} + 1 = 0.
\end{equation}
Oder die Summe der ersten natürlichen Zahlen:
\begin{equation}
  \sum_{k=1}^{n} k = \frac{n(n+1)}{2}.
\end{equation}

\input{sections/ausblick}

\end{document}
`,
    'sections/ausblick.tex': String.raw`\section{Was als Nächstes kommt}
Ein Dokument wächst mit seinen Ideen. Lege weitere Dateien an,
lade Abbildungen hoch oder verbinde dein Projekt mit GitHub.

\begin{itemize}
  \item Struktur: Kapitel in eigene Dateien aufteilen.
  \item Literatur: Quellen in einer \texttt{.bib}-Datei sammeln.
  \item Versionen: Änderungen mit Git nachvollziehen.
\end{itemize}

\bigskip
\noindent\textcolor{forest}{\textbf{Viel Raum für deine Ideen.}}
`,
    'references.bib': '% Trage hier deine Literaturquellen ein.\n'
  },
  blank: { 'main.tex': '\\documentclass{article}\n\\usepackage[utf8]{inputenc}\n\\usepackage[T1]{fontenc}\n\n\\title{Mein Dokument}\n\\author{Dein Name}\n\\date{\\today}\n\n\\begin{document}\n\\maketitle\n\n\\section{Einleitung}\nHier beginnt dein Text.\n\n\\end{document}\n' }
};
export const gitignore = '# Temporäre Dateien der PDF-Erzeugung\n*.aux\n*.log\n*.out\n*.toc\n*.synctex.gz\n*.fls\n*.fdb_latexmk\n';
