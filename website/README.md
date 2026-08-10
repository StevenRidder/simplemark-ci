# SimpleMark website

The product and download site for SimpleMark. It follows the current product authority in
[`../docs/PRODUCT.md`](../docs/PRODUCT.md): the rendered document is the product, editing is
contextual, and agent or collaboration machinery does not lead the public story.

Until a notarized DMG is on GitHub Releases, the site must not claim a working macOS download.
Star / Releases CTAs are fine; enabling “Download for macOS” requires RELEASE-TRUST evidence.

Run locally with `npm run dev`; validate with `npm run build` and
`node --test tests/rendered-html.test.mjs`.
