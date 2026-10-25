# Staging Brief look

## Palette: sage

Chosen by the owner on 25 Oct 2026 from four rendered options (linen, sage, harbour, walnut). The colours live in one
file, `public/theme.css`. Every screen reads its names; no other file sets a colour. The only copy outside that file is
the page's `theme-color` meta in `public/index.html`, which repeats the paper colour because a meta tag cannot read a
CSS name.

| Name | Colour | Used for |
| --- | --- | --- |
| ink | #22382e | Body text and headings |
| muted | #52665b | Second lines, notes, labels |
| paper | #f0f1e8 | Page background |
| surface | #fbfcf7 | Cards and panels |
| line | #cbd4c8 | Borders and rules |
| accent | #456b54 | The main button, the chosen lens, focus |
| keep, keep ink | #e5eee7, #28553a | Keep verdict |
| swap, swap ink | #f4ecd9, #745817 | Swap verdict |
| cut, cut ink | #f3e3e1, #813e38 | Cut verdict |
| unknown, unknown ink | #eeeeec, #424440 | No score |
| shadow | #00000008 | Soft card shadow |

Contrast, measured with the WCAG formula: ink on paper 11.03, muted on paper 5.41, white on accent 6.03, keep 7.23,
swap 5.66, cut 6.30. Every pair is at or above 4.5.

## Type

Fraunces for headings, DM Sans for everything else, both from Google Fonts.

## Spacing

Every button is at least 44 px tall with 8 px of padding, sits 16 px or more from the screen edge and 12 px or more
from its neighbours. `tools/phones.mjs` measures this at 15 widths from 320 to 1280 px and names any button that fails.
