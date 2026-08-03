# Native workspace and menu contract

Behavioral acceptance for both left panes is defined by
[`SIDEBAR-PARITY-TEST-PLAN.md`](SIDEBAR-PARITY-TEST-PLAN.md). The reference is Bear's useful state
transitions, not screenshot similarity, and native filesystem evidence is required before a
browser-fixture behavior is called complete.

**Status:** approved interaction direction, 2026-08-03
**Applies to:** `SHELL-1`, `APP-2`, and `SHELL-2`

SimpleMark should feel as calm and obvious as Bear without copying Bear's assets or turning a web
toolbar into imitation native chrome. The document remains the reason to open the app. Navigation
and commands appear where macOS users expect them, and browser and native clients dispatch the same
application intents.

## The window

```text
native macOS menubar
┌──────────────┬──────────────────────┬──────────────────────────────────┐
│ Library      │ Notes                │ Document                         │
│              │                      │                                  │
│ Open Notes   │ title · preview      │ rendered, directly editable      │
│ Untagged     │ modified time · pin  │ Markdown                          │
│ Todo         │                      │                                  │
│ Today        │                      │ contextual styles bar when asked │
│ Pinned       │                      │                                  │
│ Trash        │                      │                                  │
│              │                      │                                  │
│ Folders      │                      │                                  │
└──────────────┴──────────────────────┴──────────────────────────────────┘
```

- The native shell supplies the real window controls and menubar. The web surface never paints
  traffic lights or a pretend system menu.
- The three panes collapse through shared View commands to notes + editor or editor only.
- There is no permanent agent, activity, chat, or inspector rail.
- The titlebar contains only window/document state and rare global actions. Formatting does not
  occupy a second permanent row.

## Library pane

The left pane is deliberately small. It contains rebuildable views over the Markdown folder, not a
second note store:

```text
Open Notes · Untagged · Todo · Today · Pinned · Trash
Folders
  project-notes
  research
  [+ Add Folder]
```

Opening a native note adds only that file to Open Notes. It never silently adopts siblings from a
broad directory such as Downloads. **Add Folder** is the explicit boundary: it adopts the direct
Markdown children as a named collection, and several collections can remain in the library so the
person can switch the middle pane between them. Open Notes contains only files explicitly opened
through Finder or the file picker; clicking it exits folder mode immediately. New Note writes into the active folder. Untagged, Todo,
Today, Trash, recursive folder watching, and sync stay visibly disabled until their own acceptance
slices land. The dark sidebar is a stable visual anchor; it must not compete with the document.

## Notes pane

The middle pane follows the restraint observed directly in Bear. Its normal header has exactly
three things:

```text
[Open Notes ▾]                                 [Search] [New Note]
```

Search expands in place and replaces that header until dismissed. New Note is one click. The title
menu carries less-frequent list configuration:

```text
24 notes
Sorting: modification date · creation date later · title
Preview: small · medium · large · hide attachments later
Export…
Open Notes · Untagged · Todo · Today · Pinned · Trash
```

Each note row contains title, a restrained preview, modified time, and a quiet pin. Pinned notes sort
first in modification order. Pin is always visible for pinned notes and otherwise appears on
hover/focus. Selection uses a neutral surface change rather than a loud accent stripe.

The shared shell owns layout, selection intent, in-place filtering, pin intent, density, and pane
visibility. It does not scan folders or write Markdown. The browser demonstrates this contract
with an explicitly labelled in-memory catalog; the native workspace adapter supplies the real
non-recursive local catalog and collision-safe note creation.

## Native menus

The Tauri client builds real macOS menus from the shared application command registry. Menu clicks,
keyboard shortcuts, the contextual styles bar, and future MCP operations must converge on the same
commands. Tauri is transport and presentation, never a parallel editor.

### File

New Note; New Note in New Window later; Open Folder; Open File; Import/Export; Print when real.

### View

Quick Open later; editor only; notes + editor; library + notes + editor; sorting and preview size;
table of contents/backlinks when implemented; Toggle Styles Bar; Actual Size.

### Format

Only portable Markdown operations appear: headings, emphasis, link, todo/lists, quote, code,
divider, table, attachment link, and structural block movement. Cursor-specific actions stay
visible but disabled when they cannot apply. Tables and rendered technical blocks must expose Move
Block Up, Move Block Down, and Delete Block through the same command path used by keyboard and drag.

### Note

Pin to Top; Open in New Window later; Make Read-Only later; Duplicate; Move to Folder later; Copy
Link; Show in Finder; Move to Trash. Unsupported commands remain absent until their portable source
and application operation exist.

The application, Window, and Help menus use macOS/Tauri predefined items wherever possible.

## Styles bar

Native and browser start with the compact styles bar visible to match the approved interactive
wireframe. View can hide or restore it; the native menubar remains the complete keyboard-accessible
command surface. The bar sits in a quiet dock at the bottom of the document and never wraps into a
ribbon:

```text
Headers · Todo · Lists · Bold · Italic · Highlight · Link · Tables · Image/File · More
```

The approved interactive wireframe fixes the desktop geometry: the dock is centred in the document
pane, 18px above its lower edge, with a 5px inset, 2px gaps, an 11px corner radius, and ten 31×29px
icon controls. Names remain available through tooltips and accessibility labels; persistent text
labels do not widen the dock. That is the reset position, not a cage: drag the quiet material around
the controls to place the dock anywhere inside the document pane. The position is remembered per
client, stays out of Markdown, and double-clicking the material restores bottom-centre. Scrolling
keeps the active block above the dock so tables and rendered blocks remain directly manipulable.

The native window uses macOS's real overlay title bar. Empty pane headers start a native window drag
(with Tauri's drag-region marker as a fallback), and a double-click zooms the window. Tauri 2 gates
both commands separately from `core:default`, so the native capability explicitly grants
`core:window:allow-start-dragging` and `core:window:allow-toggle-maximize`; removing either permission
must fail the native-capability test instead of silently leaving dead chrome. The real 14px
traffic-light inset is `(18, 31)` in the 58px header, visually centring the controls on the header;
SimpleMark never draws replacement circles.

## Module boundary

```text
browser toolbar ─┐
styles bar ──────┼─> application command registry ─> DocumentSession/editor use case
macOS menubar ───┘

browser demo catalog ─┐
native folder adapter ├─> workspace/catalog application ports ─> shared three-pane shell
future hosted client ─┘
```

- `src/application/` owns command identity and use cases.
- `src/app/ui/` renders the shared panes and reports intent.
- `src/app/browser.ts` supplies the labelled demo catalog until a browser folder port is selected.
- `src/app/tauri.ts` composes native ports and installs native menus.
- `src-tauri/` owns native filesystem/window/menu transport only.

## Delivery order

1. **SHELL-1:** shared Bear-quality workspace using the safe demo catalog.
2. **APP-2:** native Tauri window, filesystem commands, and genuine macOS menu bridge using the
   shared shell and command registry.
3. **SHELL-2:** real-folder catalog and stable path identity first; then rebuildable indexing,
   folder watching, Trash, and external-change/conflict states as independent tested slices.

The browser note list remains a labelled fixture. The native list is accepted only with temporary
real-file and installed-app evidence; the detailed matrix lives in the sidebar parity plan.

## Acceptance

1. Search is absent until requested, expands in the notes header, receives focus, filters instantly,
   and returns to the normal header without moving the document.
2. New Note is one click in the notes pane and opens the created note.
3. Open Notes and Pinned views, modification/title sorting, and small/medium/large previews work in
   the shared shell.
4. Library, note list, and document collapse to three/two/one-pane layouts without losing editor
   state.
5. Browser and native clients render the same shared panes; native adds no fake in-window menubar or
   traffic lights.
6. macOS File/View/Format/Note items dispatch through the shared command registry and advertise
   disabled state honestly.
7. The document remains readable at every supported width; controls never wrap into a second row.
8. Playwright proves keyboard names, focus, search, new note, selection, pinning, density, and pane
   collapse. APP-2 separately proves native build and menu dispatch.
