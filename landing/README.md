# Marko landing page

A static, single-page landing site for Marko. No build step — just plain HTML, CSS, and an icon.

## Local preview

Any static server works. From this folder:

```bash
python3 -m http.server 5000
# or
npx serve .
```

Then open http://localhost:5000.

## Deploy to Vercel

The simplest path:

```bash
cd landing
npx vercel deploy --prod
```

Vercel auto-detects this as a static site (no framework). The included `vercel.json` only sets a long cache header for `icon.png` and `style.css` — there's no build configuration needed.

If you'd rather link the GitHub repo to a Vercel project from the dashboard, set the project's **Root Directory** to `landing`. The framework preset is **Other** and the output directory is the project root.

## Files

- `index.html` — single page with hero, mock window, features, shortcuts, footer
- `style.css` — typography, layout, light/dark theme via `prefers-color-scheme`
- `icon.png` — Marko app icon (copy of `../build/icon.png`)
- `vercel.json` — caching headers + clean URLs

## Update the download link

The download buttons currently point to
`https://github.com/jinghanx/marko/releases/latest`. Once you publish a release
with the `.dmg` attached, that URL renders the latest release's assets list.

If you'd prefer direct `.dmg` links, change the `href` in `index.html`:

```html
<a class="btn btn-primary"
   href="https://github.com/jinghanx/marko/releases/download/v0.1.0/Marko-0.1.0-arm64.dmg">
  Download for Apple Silicon
</a>
```
