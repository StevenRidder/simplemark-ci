# SimpleMark website

The product and download site for SimpleMark. It follows the current product authority in
[`../docs/PRODUCT.md`](../docs/PRODUCT.md): the rendered document is the product, editing is
contextual, and agent or collaboration machinery does not lead the public story.

The download section intentionally remains in a visible pre-alpha state until signed native builds
exist. Do not replace it with a working-download claim without release evidence.

Run locally with `npm run dev`; validate with `npm run build` and
`node --test tests/rendered-html.test.mjs`.
