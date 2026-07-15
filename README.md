# PaperFolio for Kobo

Sync your Kobo highlights into Obsidian — one clean note per book, sorted by true reading order, grouped by chapter, with your own handwritten notes protected.

> Desktop-only (`isDesktopOnly`). Works over USB today; optional LAN wireless sync lets your Kobo push highlights with one tap.

## Features

- **One note per book** — highlights become a single clean `.md` with frontmatter.
- **True reading order** — sorted by in-book position (not by highlight time, which would scatter highlights you added later).
- **Real chapter names** — chapter headings come from the Kobo table of contents, not internal filenames. Store books without a TOC entry fall back to the book's EPUB `toc.ncx` over USB.
- **Your notes are safe** — generated content lives inside a sentinel block; re-syncing only rewrites that block, so any summary you write outside it is never touched.
- **Incremental & de-duplicated** — re-syncing only counts what changed.
- **Index MOC** — an auto-generated index lists every book by highlight count.
- **Read-only** — the Kobo database is read into memory only; your device is never modified.
- **Bilingual** — interface and notes in English or Traditional Chinese (follows Obsidian's language by default).

## Usage (USB)

1. Connect your Kobo over USB and let it mount.
2. Click the PaperFolio ribbon icon, or run the command **Sync Kobo highlights to Obsidian**.
3. Highlights are written to the output folder set in the plugin settings (default `PaperFolio/`).

If your Kobo mounts at a non-default path, set the full path to `KoboReader.sqlite` in the plugin settings.

## Wireless sync over LAN (optional)

While Obsidian is open, the plugin can listen on a port so a Kobo on the same Wi-Fi pushes its highlights with one tap — no cable.

1. In settings, enable **Wireless receiver (LAN)**. On first enable, macOS may ask to allow incoming connections — click Allow.
2. The settings page shows your sync address (e.g. `http://192.168.1.108:8321/sync`) and a key.
3. On the Kobo side, a one-tap NickelMenu button runs a small script that `curl`s `KoboReader.sqlite` to that address with the key. See `kobo/INSTALL.md`.

The receiver binds `0.0.0.0` so a device on your LAN can reach it, and is protected by a shared key (`X-PaperFolio-Token` header). It only accepts a SQLite database and only writes to your chosen output folder.

## Settings

- Language (Auto / English / Traditional Chinese)
- Kobo database path (empty = default mount path)
- Output folder
- Import threshold (books with fewer highlights are skipped)
- Highlight style: Callout / Blockquote / Bullet list
- Group by chapter, show date, color as tag, filename format
- Import dogears (off by default; dogears record position only)
- Wireless receiver: enable, port, key, sync address

## Development

```bash
npm install
npm run dev     # watch mode, outputs main.js
npm run build   # type-check + bundle
```

Copy `main.js`, `manifest.json`, and `styles.css` into your vault's `.obsidian/plugins/paperfolio-kobo/`, then reload Obsidian.

## License

MIT. SQLite parsing uses [sql.js](https://github.com/sql-js/sql.js) (MIT); EPUB unzip uses [fflate](https://github.com/101arrowz/fflate) (MIT).
