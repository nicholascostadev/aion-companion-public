# README images

These images show the current application with its built-in browser demo data,
not a live character or a measured game session. The application logo remains in
[`frontend/public/app-icon-128.png`](../../frontend/public/app-icon-128.png).

| File            | View              |
| --------------- | ----------------- |
| `workspace.png` | Home              |
| `combat.png`    | Live              |
| `pets.png`      | Pets → Collection |

The captures were made from `093e6bc` at a 1440-pixel browser width using
`http://localhost:1435/?mock`. T3's full-resolution renderer exported the actual
browser DOM with the application's CSS, Instrument Sans fonts and original local
artwork. Animations were frozen; the Pets export omitted content below the
viewport. The existing demo fixtures were used unchanged; no new artwork or
interface was fabricated for these captures.

To refresh them, run the browser preview described in
[Development](../DEVELOPMENT.md), select the same views and retain the demo-data
caption in the main README. Check that text and artwork are sharp at full size.
Keep screenshots free of credentials, real account information and development
error messages. Artwork attribution is in [Game artwork](../GAME_ARTWORK.md).
