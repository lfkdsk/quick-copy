# Bundled fonts

Self-hosted rather than loaded from a font CDN: no third-party request in
front of first paint, and the page looks the same on a network that
cannot reach `fonts.gstatic.com`.

| File | Family | Used for |
| --- | --- | --- |
| `newsreader-latin.woff2` | [Newsreader](https://github.com/productiontype/Newsreader) | wordmark, headlines |
| `newsreader-latin-italic.woff2` | Newsreader Italic | accents in headlines |
| `jetbrains-mono-latin.woff2` | [JetBrains Mono](https://github.com/JetBrains/JetBrainsMono) | note bodies, labels, metadata |

Latin subsets only — CJK falls through to the system faces named in the
font stacks in `src/styles.css`, so nothing here needs to grow when the
content is Chinese.

Both families are licensed under the SIL Open Font License 1.1; see
`OFL.txt`. The subsets were produced by Google Fonts and are
redistributed unmodified.
