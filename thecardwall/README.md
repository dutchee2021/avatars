# THECARDWALL.COM — The Card Wall

The public slab viewer for StonkBrokers and The Interns, built with the MOX UI
(Space Grotesk, MOX bars, controls, menu, share sheet, toast and loader) and
the 3D slab from `../slab`. It will live at `https://moxapp.io/thecardwall/`;
see [DEPLOY.md](DEPLOY.md) for Cloudflare.

## What it does

- **Slab**: the PSA-style slab turns slowly on its own; drag to rotate, pinch or
  scroll to zoom. The label reads `2026 CLUTCH MARKETS / $STONKBROKER (or
  $STONKBROKER INTERNS) / ROBINHOOD` and `#ID / MINTED / 10 / ERC-6551`.
- **Card front**: the STONKCARDS frame (`assets/card-template-front.png`) over
  the token's onchain art, centred and bottom-aligned to the frame's black
  outline, with the token number on the top-left ribbon in #ff6f00.
- **Card back**: `assets/card-back.png`, the same for every card (placeholder
  until the final design arrives).
- **Top bar**: the MOX logo, `THECARDWALL.COM` over `STONKBROKER #4354` /
  `INTERN #ID`, the cart (OpenSea item page for the selected token) and
  CLAW MACHINE (`https://thecardwall.com/alley`).
- **Token bar**: download (1:1 MP4 loop), token ID field (default #4354, the
  mascot), dice (random minted token), AR.
- **Collection bar**: `STONKBROKERS` / `THE INTERNS`; the label and the chevron
  both open the compact menu.
- **MP4**: 1080 x 1080, 30 fps, 180 frames = one full turn on black, so the clip
  loops seamlessly. Encoded on the device (WebCodecs H.264 into MP4; VP9/AV1
  in MP4 where a browser has no H.264 encoder; MediaRecorder on Safari < 17.4).
  Phones get the share sheet (Save Video), desktops a download.
- **AR**: iPhone/iPad Safari opens AR Quick Look (ARKit) with a USDZ built on the
  device; Android Chrome opens a WebXR session (ARCore); desktops show a QR code
  that opens the same token on a phone. In AR the slab lies flat, face up, at
  real size (80 x 135.5 x 6 mm), on the detected table or floor.
- **Links**: `?collection=interns&token=123` (or `#interns-123`) opens a token;
  add `&ar=1` (or `-ar`) to highlight the AR button after a QR handoff.

## Run it locally

```sh
# from the repository root
python3 -m http.server 8000
# open http://localhost:8000/thecardwall/
```

Without the Worker, the page reads token art straight from the Robinhood Chain
RPC; if that is blocked it shows a placeholder (StonkBroker #4354 always has its
art bundled). To run through the Worker logic, see `worker/scripts`.

## Files

| Path | Purpose |
| --- | --- |
| `index.html`, `app.css` | Page and MOX styling |
| `js/app.js` | UI wiring: bars, menu, token input, dice, share sheet, AR button |
| `js/config.js` | Collections, contracts, ID ranges, label copy, links |
| `js/scene.js` | three.js viewer, MP4 render session, flat AR model |
| `js/card.js` | Card front compositor (frame, art, ribbon number) |
| `js/label.js` | Slab label drawing |
| `js/token-art.js` | `tokenURI()` reader and SVG / image decoding |
| `js/export-mp4.js` | MP4 loop encoder |
| `js/ar.js` | Platform detection, Quick Look, WebXR, QR code |
| `assets/` | Slab model, card frame and back, MOX logo and loader art, fonts |
| `vendor/` | three.js r170, mp4-muxer 5.2.2, model-viewer 4.2.0 (Android AR only), qrcode 1.5.1 — with their licenses |
| `worker/` | Cloudflare Worker, build and test scripts |

## Assumptions to confirm

- Token ranges: StonkBrokers #1–#4444, The Interns #1–#8888 (`js/config.js`).
- The Interns use the same STONKCARDS frame (with the `$STONKBROKER clock in`
  nameplate) until an Interns frame is supplied.
- The ribbon number uses Libre Franklin Black (OFL) fitted to the supplied
  sample until a web-licensed Franklin Gothic Heavy file is added.
- The MOX logo sits at the top left, as on every MOX page.
