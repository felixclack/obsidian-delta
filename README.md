# Obsidian Delta

A plugin for [Obsidian](https://obsidian.md) that brings Roam Research's Delta (Δ) functionality to your vault. Schedule blocks to resurface on future daily notes using spaced repetition.

## Features

- **Send to Tomorrow**: Quickly schedule any block to appear on tomorrow's daily note (Alt+Enter)
- **Custom Intervals**: Send blocks to any future date (1 day, 2 days, 1 week, 2 weeks, 1 month, or custom)
- **Spaced Repetition**: When you resurface a block, the interval multiplies (1→2→4→8 days)
- **Auto-insert**: Due items automatically appear at the top of your daily note
- **Block References**: Original context is preserved via Obsidian block references
- **Visual Indicators**: Overdue items are highlighted in red

## How It Works

Delta adds a tag to your blocks in this format:
```
* Review quarterly goals {{delta:2+2 2026-01-18}} ^abc123
```

- `delta:2+2` means the interval is 2 days with a 2x multiplier
- `2026-01-18` is when it will resurface
- `^abc123` is a block ID for referencing

When the date arrives, the block appears in your daily note with a link back to the source.

## Commands

| Command | Description |
|---------|-------------|
| Delta: Send block to tomorrow | Schedule current block for tomorrow |
| Delta: Send block to future date... | Choose a custom interval |
| Delta: Resurface this block again | Multiply the interval and reschedule |
| Delta: Mark as done | Remove the delta tag |
| Delta: Show items due today | Open modal with all due items |
| Delta: Insert due items here | Insert due items at cursor |

## Settings

- **Default interval**: Days until first resurface (default: 1)
- **Default multiplier**: How much to multiply each resurface (default: 2, so 1→2→4→8)
- **Daily notes folder**: Where your daily notes live (default: `journals`)
- **Daily note format**: Filename format (default: `YYYY_MM_DD`)
- **Auto-insert**: Automatically add due items when opening today's note

## Installation

### From Community Plugins

1. Open Obsidian Settings → Community plugins
2. Browse and search for "Delta"
3. Install and enable

### Manual Installation

1. Download `main.js`, `manifest.json`, and `styles.css` from the latest release
2. Create a folder: `<vault>/.obsidian/plugins/obsidian-delta/`
3. Copy the files into that folder
4. Reload Obsidian and enable the plugin

## Development

```bash
# Clone the repo
git clone https://github.com/felixclack/obsidian-delta.git
cd obsidian-delta

# Install dependencies
npm install

# Build for development (watches for changes)
npm run dev

# Build for production
npm run build
```

## Inspiration

This plugin is inspired by [Roam Research's Delta function](https://roamresearch.com/#/app/help/page/fGZLmWhKS), which implements spaced repetition directly in your notes.

## License

MIT
