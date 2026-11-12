# Fonts

Committed on purpose. These two files used to be fetched from
`fonts.googleapis.com` **at build time** by `next/font/google`, which made every
production build depend on Google answering a request from whatever machine was
building. It does not always answer:

```
src/app/layout.js
An error occurred in `next/font`.
TypeError: Cannot read properties of null (reading '1')
    at .../@next/font/dist/google/loader.js:122:78
```

That failure took out the first `v0.5.183` npm publish and the `v0.5.185` Docker
build — a release blocked twice by a network call that has nothing to do with the
code being released. `next/font/local` reads these files from disk instead.

Nothing changes for the browser. `next/font/google` already self-hosted the same
woff2 into `.next/static/media`, so the bytes a visitor downloads are identical;
only the moment of acquisition moved from build time to commit time.

## What these are

Both are the **latin subset, variable** woff2 — the exact files Google's CSS API
serves for the declarations `layout.js` used to request:

| File | Family | Axis | Size | Source |
|---|---|---|---|---|
| `Inter-latin-variable.woff2` | Inter v20 | `wght 100..900` | 48 KB | `fonts.gstatic.com/s/inter/v20/UcC73FwrK3iLTeHuS_nVMrMxCp50SjIa1ZL7W0Q5nw.woff2` |
| `SpaceGrotesk-latin-variable.woff2` | Space Grotesk v22 | `wght 300..700` | 22 KB | `fonts.gstatic.com/s/spacegrotesk/v22/V8mDoQDjQSkFtoMM3T6r8E7mPbF4C_k3HqU.woff2` |

Retrieved from the URLs in
`https://fonts.googleapis.com/css2?family=Inter:wght@100..900&display=swap` and
`...?family=Space+Grotesk:wght@300..700&display=swap`, taking the `latin` block
only. A variable file covers the whole range, so the 500/600/700 that the
wordmark asks for all come from the one Space Grotesk file.

## Licence

Both families are licensed under the **SIL Open Font License 1.1**, which permits
redistribution of the font files, including bundled in an application.

- Inter — © The Inter Project Authors (<https://github.com/rsms/inter>)
- Space Grotesk — © The Space Grotesk Project Authors
  (<https://github.com/floriankarsten/space-grotesk>)

Full licence text: <https://openfontlicense.org/>

## Updating

Re-fetch from the CSS API rather than editing these by hand, take the `latin`
block, and keep the weight ranges in `layout.js` in step with the file's axis —
a range wider than the font actually has makes the browser synthesise weights.
`tests/unit/fonts-are-self-hosted.test.js` fails if `next/font/google` comes back.
