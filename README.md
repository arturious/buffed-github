# <img src="media/logo.svg" alt="" height="56" align="absmiddle">&nbsp;&nbsp;Buffed GitHub

Buffs for GitHub: small improvements to its interface.

## Features

| Feature | What it does |
|---|---|
| Inline folders | Click a folder in a repo's file table to expand it in place, with a chevron, last commit and date for each item.<br><br><img src="media/inline-folders.gif" alt="Expanding folders in place in a repo's file table" width="640"> |
| Quick file preview | Option-click (Alt-click) a file in that table — including a file inside a folder expanded in place — to read it in a dialog on the same page. |
| Black theme | Pure black backgrounds and flatter borders in GitHub's dark mode. Light mode is left alone. |

Each feature can be switched off on its own in the extension's settings.

## Quick file preview

In a repository file table, hold **Option** (Alt) and click a file, for example a `.ts` link. A dialog opens over the page with the file's source. The source scrolls inside the dialog, and tokens use GitHub's own syntax colors, so light mode, dark mode, and the black theme all apply.

Close it with **Close**, **Escape**, or a click on the dimmed area around the dialog. The table underneath is left as it was: folders you expanded stay expanded, and the page does not jump.

A click without Option still opens the file. Command-click, Ctrl-click, Shift-click, middle-click, and Option combined with those keys keep the browser's usual behavior.

Very large files, files GitHub does not include in the page, and files that are not text (including images) show a short message instead of source. **Open** leaves the preview and goes to the normal file page. The preview never edits the file, and it does not run what it downloaded.

Turn just this off without affecting inline folders or the black theme. In Zen or Firefox, open Add-ons, select Buffed GitHub, and open Preferences (Options on some systems). Uncheck **Quick file preview**. The change applies the next time a GitHub page loads.
