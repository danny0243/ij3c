# IJ3C — International Journal of Computer, Consumer and Control

Static site for https://ij3c.ncut.tw, served by a Cloudflare Worker (`ij3c`) using Workers Assets.

## Structure

- `index.html`, `assets/`, `images/`, `file/` — homepage and shared assets
- `volume/*.html` — one page per published issue
- `volume/paperfile/<vol>/*.pdf` — cover page, contents, and paper PDFs for each issue
- `downloads/` — author templates and forms

## Deploying

```
npx wrangler deploy
```

`wrangler.toml` points the deploy at the `ij3c` Worker; `.assetsignore` keeps `.git` and other non-site files out of the upload.
