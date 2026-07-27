# Vendored fonts — provenance

Written because LEG-16 had just deleted 3.8 MB of vendored earth imagery whose origin and licence
nobody had recorded, and one file of which turned out to be a captured HTTP 404 committed as an image.
This file is the habit that prevents a repeat.

## roboto-latin-variable.woff2

- **Family:** Roboto
- **Licence:** Apache License 2.0 — full text in `LICENSE-Roboto.txt` (11,357 bytes, fetched from
  `raw.githubusercontent.com/googlefonts/roboto/main/LICENSE` and checked for the Apache header before
  being accepted; the first URL tried returned a 14-byte "404: Not Found" body, which was discarded
  rather than committed).
- **Obtained:** 2026-07-27 from `fonts.gstatic.com`, via the stylesheet
  `https://fonts.googleapis.com/css2?family=Roboto:wght@400;600;700&display=swap` requested with a
  desktop Chrome user agent, taking the `unicode-range: U+0000-00FF…` (latin) face.
- **Upstream URL at the time:**
  `https://fonts.gstatic.com/s/roboto/v51/KFO7CnqEu92Fr1ME7kSn66aGLdTylUAMa3yUBHMdazQ.woff2`
- **Why one file for three weights:** upstream returns the *same* woff2 URL for 400, 600 and 700, so a
  single 37,520-byte file serves all three. `roboto.css` therefore reproduces Google's own three
  `@font-face` blocks verbatim, changing only the `url()`, so rendering cannot drift from what shipped
  before.

## Not vendored: Playfair Display

Deliberately dropped rather than self-hosted. It was fetched from Google on every page load and used by
nothing: declared in `tailwind.config.js` as the `display` family, referenced by no component, and absent
from every built CSS file.
