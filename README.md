# simple-mindmap

A small mindmap and outline view for the browser. You pass JSON, update it with operations, and listen to events.
Pure ES modules, **zero runtime dependencies**, no URL of its own (no network access unless you give a status an image
URL), no `innerHTML`, system fonts only, colours through CSS variables, and every visible string can be replaced.

- Three views: **both sides** (the root in the middle), **tree to the right**, and **outline** (nested rows).
- Three modes: `view` (read only), `select` (select, open, menu actions), `edit` (emits `intent`; you decide and call `apply`).
- The data stays yours: the component never edits your data by itself.
- One validation function used by every entry point, with fixed error codes you can translate.
- Static SVG export, Markdown outline and Mermaid export, and Markdown outline import.

## Quick start

```html
<div id="map" style="height: 480px"></div>
<script type="module">
  import { createMindmap } from "./simple-mindmap/src/mindmap.js";

  const mm = createMindmap(document.getElementById("map"), {
    data: {
      mindmap: 1,
      title: "Release plan",
      root: { id: "root", title: "Release 1.0", children: [
        { id: "lib", title: "Library", status: "decided" },
        { id: "docs", title: "Docs", status: "pending" },
      ] },
    },
    mode: "select",
  });
  mm.on("select", ({ id }) => console.log("selected", mm.getNode(id)));
</script>
```

Code that has no DOM (a server, a worker, a CLI) imports the pure part:

```js
import { validate, applyOps, toOutline, toMermaid, fromOutline, pathOf } from "simple-mindmap/core";
```

## Data format

```json
{
  "mindmap": 1,
  "title": "Notification architecture",
  "layout": "both",
  "root": {
    "id": "root", "title": "Notifications", "note": "Short Markdown...",
    "children": [
      { "id": "pane", "title": "Pane notifications", "status": "decided", "children": [] },
      { "id": "plugin", "title": "Plugin notifications", "tone": "amber", "collapsed": true }
    ]
  },
  "links": [ { "from": "plugin", "to": "pane", "type": "relates", "label": "shared profile" } ]
}
```

| Field | Rule |
|---|---|
| `mindmap` | format version; absent means 1; anything else is `bad_version` |
| `title` | optional map title, one line, at most 200 graphemes |
| `layout` | the view to open with: `both` (default), `right` or `outline` |
| `root` | required; a node |
| node `title` | required, one line, 1 to 200 graphemes (control characters are removed) |
| node `id` | optional; `^[A-Za-z0-9_-]{1,64}$` with at least one letter; unique. A node without `id` is addressed by its position path (`"1.2.3"`; the root is `"0"`) |
| node `note` | optional Markdown, at most 16 KiB, kept verbatim. **The component never draws notes**: draw them yourself, in your own sandbox |
| node `status` | one of the configured statuses (default: `open`, `pending`, `decided`, `parked`, `blocked`, `superseded`) |
| node `tone` | `green`, `amber`, `red`, `blue`, `purple` or `grey`; a colour dot when there is no status (ignored, with a warning, when `status` is set) |
| node `collapsed` | `true` to open the node collapsed |
| node `meta` | any object up to 4 KiB; never read by the library, handed back to your `badge` callback |
| node `children` | array of nodes |
| `links[]` | `from`, `to` (explicit node `id`s, not the same node; a position number such as `"2"` is refused with `bad_link`, because positions shift when nodes are added), `type` (`relates` default, `blocks`, `supersedes`), optional `label` (at most 60 graphemes) |

Limits: 2 000 nodes, depth 16 (the root is level 1). Position numbers such as `3.2` are computed from the tree; they are
not a field of the data.

### Statuses

| Key | Default label | Symbol |
|---|---|---|
| `open` | Open | hollow ring |
| `pending` | Pending | half-filled amber ring |
| `decided` | Decided | green check |
| `parked` | Parked | grey double bar |
| `blocked` | Blocked | red crossed ring |
| `superseded` | Superseded | grey dash, title struck through and faded |

### Status icons

A status entry is `{label, color?, strike?, render?, image?, icon?, path?, shape?, symbol?}`. The map, the outline and the
SVG export draw the **highest level present**:

| Level | Field | Map and outline | SVG export |
|---|---|---|---|
| 1 | `render: (statusKey, status) => Element` | your element, called **once per status per draw** and copied per node; an SVG element is appended as is, any other element is wrapped in `<foreignObject>` (map) or a `<span>` (outline) | never called: the next level |
| 2 | `image: url` | `<image>` (map) / `<img>` (outline), 12 x 12 | embedded only for a `data:` URL; any other URL: the next level |
| 3 | `icon: {viewBox?, nodes, stroke?}` | a nested 12 x 12 `<svg>` | the same |
| 3 | `path: "M..."` | sugar for `icon: {viewBox: "0 0 12 12", nodes: [["path", {d}]]}`, filled with the colour | the same |
| 4 | `shape` | one of the six built-in symbols (`open`, `pending`, `decided`, `parked`, `blocked`, `superseded`) | the same |
| 5 | `symbol` | a short text symbol | the same |
| 6 | (none) | a dot | the same |

- `color` is a token (`green`, `amber`, `red`, `blue`, `purple`, `grey`, or any `--mm-*` colour name) or any CSS colour.
  `export("svg")` resolves a raw colour in the page (computed `rgb()`), so a `var(--brand)` works; the pure `toSVG` cannot
  resolve `var()` and draws it grey. The file never contains `var(`.
- `strike: true` strikes the title through and fades it (the default `superseded` has it); `shape: "superseded"` implies it.
- **Your entry decides the icon.** Each key is merged with the default of the same key, but an entry that sets any icon
  field (`render`, `image`, `icon`, `path`, `shape`, `symbol`) drops every inherited one: `decided: {symbol: "*"}` draws `*`,
  not the built-in check. `label`, `color` and `strike` still inherit.
- `icon.nodes` is the Lucide `IconNode` format: `[[tag, attrs, children?], ...]`. Tags: `path`, `circle`, `ellipse`, `line`,
  `rect`, `polyline`, `polygon`, `g` (nested `g` too). Attributes: `d`, `cx`, `cy`, `r`, `x`, `y`, `width`, `height`, `rx`, `ry`,
  `x1`, `y1`, `x2`, `y2`, `points`, and `fill` only as `currentColor` (the status colour) or `none`. Every other tag or
  attribute (`href`, `on*`, `style`, `transform`, `url(...)`) is dropped. More than 64 nodes, a `d` longer than 8 KiB, or a
  bad `viewBox` (default `0 0 24 24`): the next level draws. `stroke: true` gives the Lucide look: no fill, stroke in the
  status colour, width 2, round caps and joins.
- `image` accepts `data:image/(png|jpeg|gif|webp|svg+xml)`, `https:`, `http:`, `blob:` and relative URLs; anything else
  (`javascript:`, `file:`, ...) is ignored. The browser fetches an `image` URL because you chose it; under a CSP it needs
  `img-src` for that origin (`data:` for data URLs).
- A `render` that throws or returns something other than an Element: the next level draws and the component emits one
  `error {message, status}` per status per draw.
- `statusIcon(statusKey, statuses?, theme?)` (from `simple-mindmap`) returns the same icon as a standalone 12 x 12 `<svg>`
  string with the export rules, for your own legend or filter chips. `statuses` as you pass them to `createMindmap`.

Lucide (or any icon set in the same format) plugs in directly:

```js
import { Check, Hourglass, createElement } from "lucide";
createMindmap(el, { data, statuses: {
  decided: { label: "Done", color: "green", icon: { nodes: Check, stroke: true } },
  pending: { label: "Waiting", color: "amber", render: () => createElement(Hourglass, { width: 12, height: 12 }) },
} });
```

## API

```js
import { createMindmap } from "simple-mindmap";
const mm = createMindmap(el, {
  data,                      // JSON as above
  view: "both",              // "both" | "right" | "outline"
  mode: "view",              // "view" | "select" | "edit"
  state: null,               // a saved getState(): {selected, collapsed, focus, view, viewport, search, filter, filterOnly}; state.view wins over `view`
  collapseDepth: null,       // collapse every node at this depth (root = 0) when there is no `state`
  actions: [],               // menu items of a node: [{id, label, icon?, when?(node) -> bool}]; icon: a short text symbol or an icon object ({viewBox?, nodes, stroke?}, as for statuses)
  strings: {},               // every visible text (see "Strings")
  statuses: {},              // {key: {label, color?, strike?, render?, image?, icon?, path?, shape?, symbol?}}; replaces the default six when given (see "Status icons")
  badge: null,               // (node) -> {symbol, label} | null; a small extra mark you decide; called on every draw
  search: true, tools: true, // the floating search box and the tools; turn off when you draw your own
  limits: null,              // tighter limits: {nodes, depth, title, label, note, meta}
  theme: null,               // "light" | "dark" to force a palette, or {mode?, tokens: {bg: "#...", ...}}; default follows prefers-color-scheme
  filter: null,              // null or a list of statuses: nodes whose status is not listed are dimmed (never hidden)
  filterOnly: false,         // outline only: with a filter, hide branches that contain no matching node
});
```

| Method | Result |
|---|---|
| `mm.setData(json)` | replaces the whole tree, keeping selection, collapsed nodes and viewport by id where they still exist. Bad data: the drawn tree stays, returns `{ok: false, errors}` and emits `invalid` |
| `mm.apply(ops)` | applies a batch atomically (see Operations). Any error: nothing changes, returns `{ok: false, errors, index}` and emits `invalid`. It never throws: a payload JSON cannot hold (a BigInt, a cycle) is `bad_op` / `bad_meta` at `ops[i]` |
| `mm.select(id)` `mm.reveal(id)` `mm.focus(id \| null)` `mm.collapse(id)` `mm.expand(id)` `mm.setView(kind)` `mm.fit()` | change the view; return `false` for an unknown id |
| `mm.focusSearch()` | puts the cursor in the search box of the open view (what Cmd/Ctrl+F does inside the component), for a host shortcut. `false` when there is no data or `search: false` |
| `mm.setFilter(list \| null)` | dims every node whose status is not in `list` (a node without status never matches); returns `{ok: true}`, or `{ok: false, errors}` with `bad_status` for an unknown status (nothing changes) |
| `mm.setFilterOnly(bool)` | outline: hide branches without a match while a filter is set; returns `{ok: true}` |
| `mm.setTheme("light" \| "dark" \| null \| {mode?, tokens})` | replaces the theme set so far (see "Theming"); no redraw, no event; returns `false` for a value it does not accept |
| `mm.setStatusStyle(key, {label?, color?, strike?, icon?, path?, image?, render?, symbol?, shape?})` | restyles an existing status and redraws, keeping viewport, collapse and selection; an icon field replaces the current icon, `null` clears a field; no event. Returns `{ok: true}`, or `{ok: false, errors}` with `bad_status` for an unknown key (the set of keys is fixed at creation) |
| `mm.search(q)` `mm.next()` `mm.prev()` | `{hits: [ids], index}`; matches titles (case and accent insensitive) and position numbers, never internal ids |
| `mm.getData()` | a deep copy of the current data (no view state), or `null` before any valid data |
| `mm.getNode(id)` | `{id, path, parent, children: [ids], node: {id, title, note?, status?, tone?, collapsed?, meta?}}` (a copy) or `null` |
| `mm.getPath(id)` | `"3.2"` (root: `""`) or `null` |
| `mm.find(q)` | ids that match, same rule as the search box |
| `mm.getState()` | `{selected, collapsed, focus, view, viewport: {x, y, k}, search, filter, filterOnly}` |
| `mm.export(fmt)` | `"json"`, `"outline"` (Markdown), `"mermaid"`, `"svg"` (the current view, measured by this page, concrete colours); `null` before valid data |
| `mm.errors` / `mm.warnings` | the last validation result (copies); `warnings` also lists ignored theme tokens (`theme.tokens.<name>`) |
| `mm.on(event, fn)` | returns a function that removes the listener |
| `mm.destroy()` | removes the component and every listener |

Pure functions (`simple-mindmap/core`, no DOM): `validate(json, {limits, statuses})`, `applyOps(json, ops, {limits, statuses})`
(`{ok: true, data, view, warnings}` or `{ok: false, errors, index}`; the input is never changed), `toOutline(json)`,
`toMermaid(json)`, `fromOutline(markdown, {rootTitle})`, `pathOf(json, id)`.
In an outline, note lines follow Markdown backslash escaping: `toOutline` puts a `\` in front of a note line that looks
like a bullet or already starts with `\`, and `fromOutline` reads `\-` as `-` and `\\` as `\` at the start of a note line.

Functions that measure text (browser only, also exported from `simple-mindmap`): `layout(data, {view, collapsed, focus,
measure, badge})` and `toSVG(json, {view, theme, measure, collapsed, focus, statuses, strings, badge, links, selected, filter})`.
`measure(text, kind)` returns a width in pixels for `kind` = `"root"`, `"node"`, `"num"` or `"small"`.

### Operations

| `op` | Fields | Effect |
|---|---|---|
| `add` | `parent`, `node {id?, title, status?, tone?, note?, meta?, children?}`, `after?` or `first?` | adds a node (with its subtree); appended by default |
| `edit` | `id`, `title?`, `note?`, `tone?` | changes text; `null` removes `note` / `tone` |
| `status` | `id`, `to` | sets the status (`null` removes it); a status replaces the tone |
| `move` | `id`, `parent`, `after?` or `first?` | moves a node; never into itself or its descendants (`move_into_self`); the root cannot move |
| `remove` | `id`, `recursive?` | removes a node; a node with children needs `recursive: true`; links to removed nodes are removed too |
| `link` / `unlink` | `from`, `to`, `type`, `label?` | adds or updates / removes a cross link (`unlink` without `type` removes every type) |
| `meta` | `id`, `meta {...}` | shallow-merges into `meta` (`null` removes a key); `badge(node)` is called again |
| `collapse` / `expand` / `select` / `focus` | `id` | view only; the data does not change |

Ops run in order on a copy; the result is validated as a whole after the last op; a failure anywhere returns the error
with the index of the failing op (or `null` when the final check failed) and nothing changes.

### Modes and events

| Mode | The user can | Events |
|---|---|---|
| `view` | pan, zoom, collapse / expand, search, change layout | `viewport {x, y, k}`, `toggle {id, collapsed}`, `view {kind}`, `search {q, hits}` |
| `select` | + select, open (Enter or double click), node menu | + `select {id}`, `open {id}`, `action {action, id}` |
| `edit` | + drag to move, rename in place (F2), add child (Tab), add sibling, delete (Delete) | + `intent {op, ...}` in exactly the shape of `apply` |

- In `edit` mode the component **only emits `intent`**. Check it, store it, then call `mm.apply([intent])`.
- **Interaction events** (`select`, `open`, `action`, `toggle`, `view`, `viewport`, `search`, `intent`) come only from user
  input, never from your calls to `apply`, `setData`, `select` and the other methods.
  A user click on a node emits `select` even when it was already selected. When the user collapses a branch that holds
  the selection, the selection moves to that branch: `toggle` is followed by `select {id}` of the new selection.
- **State events** (`invalid {errors, source, index?}`, `error {message, status?}`) are emitted for your calls too. Events raised while
  `createMindmap` runs are delivered right after it returns, so a listener added on the next line receives them.
- Enter in the search box goes to the next match (Shift+Enter: previous) and never emits `open`.
- Events carry ids, never DOM nodes or data copies; call `getNode(id)` when you need the data.
- Decide on the return value of `setData` / `apply`, not on `invalid` (listening to `invalid` and calling `setData` again
  can loop).

Keyboard (when the component has focus): arrows move the selection, Enter opens, Space collapses / expands,
Cmd/Ctrl+F focuses the search box, Escape closes the menu; in `edit` mode F2, Tab and Delete as above.
Mouse: drag the background to pan, wheel to scroll, Cmd/Ctrl + wheel (or pinch) to zoom.

### Validation and bad data

`validate(json, {limits, statuses})` returns `{ok, errors, warnings, data}`. Every error is
`{path, code, message, id?, title?, limit?}`: `path` is the JSON path (`root.children[2].id`); build your own sentence
from `code` and its fields rather than parsing the English `message`. `data` is the normalised copy (NFC; control
characters removed from one-line text; notes kept verbatim; `mindmap` set to 1).

Fixed error codes (contract of 1.x; you can translate them):

| Code | When |
|---|---|
| `not_object` | not JSON / not an object; a node, link or `children` of the wrong type |
| `bad_version` | `mindmap` is not 1 |
| `missing_root` | no `root` |
| `missing_title` | a node without a title (or the title is empty after cleaning) |
| `bad_id` | id does not match the pattern |
| `dup_id` | the same id twice |
| `too_many_nodes` | more than `limits.nodes` |
| `too_deep` | deeper than `limits.depth` |
| `bad_status` | status not among the configured statuses |
| `bad_tone` | unknown tone |
| `bad_layout` | unknown layout |
| `bad_link` | link end is not a node, or unknown type |
| `self_link` | a link from a node to itself |
| `bad_meta` | meta is not an object, or too large |
| `text_too_long` | title, label or note over its limit (or not a string) |
| `no_such_node` | (apply) an op names a node that does not exist |
| `move_into_self` | (apply) move into itself or a descendant |
| `bad_op` | (apply) unknown or malformed op, moving or removing the root, removing a node with children without `recursive` |

Warnings never block: `unknown_key`, `tone_ignored`, `bad_value`.

Within 1.x validation only ever gets looser. The 1.0 sample data set in `test/fixtures/v1/` must stay valid in every
1.x release; a stricter rule needs a new package name.

| When | Behaviour |
|---|---|
| `createMindmap` with bad data | draws no tree, shows the error as text (`strings.invalid` + `strings.errorLine(firstError)`), emits `invalid {source: "init"}`; `mm.errors` holds the list; a later valid `setData` draws normally |
| `setData` with bad data | keeps the current picture, emits `invalid {source: "setData"}`, returns `{ok: false, errors}` |
| `apply` with a bad batch | atomic: nothing changes, emits `invalid {source: "apply", index}`, returns `{ok: false, errors, index}` |
| a drawing failure (for example text measuring throws) | caught; error text `strings.renderFailed` and `strings.renderFailedDetail` (`{message}`); emits `error {message}` |
| before any valid data | `getData()` and `getNode()` return `null`, `find()` returns `[]`, `export()` returns `null` |

## Views

- Selecting a node draws a ring around it; the selection survives a view change.
- Nodes with children have a collapse button; a collapsed node shows `+5` (tooltip "5 hidden children").
- The search box floats at the top left of the map, and is the first row of the outline. Matches are highlighted in
  place; the branch of the current match opens and scrolls into view.
- Tools: layout (both sides / tree to the right / outline) and "All links" at the top right; zoom out, zoom in, fit and
  "focus this branch" at the bottom right. A focused branch is drawn as the root, with a path back at the bottom left.
- Cross links: `blocks` red with an arrow, `supersedes` grey with an arrow, `relates` thin dashed. By default only `blocks`
  and the links of the selected node are drawn; "All links" shows the rest. A link end inside a collapsed branch stops at
  the nearest visible ancestor (hollow dot).
- Status filter (`filter` / `setFilter`): non-matching nodes fade but keep their place, so the shape of the tree stays;
  in the outline `filterOnly` hides branches with no match. The filter chips are yours to draw; the filter is a host
  call and emits no event.
- More than 80 nodes: the map opens collapsed to depth 2, the outline to depth 3 (unless `state` or `collapseDepth`).
- Each node shows its status symbol (or tone dot), its position number (`3.2`, monospace, muted) and its title (clipped
  at 48 graphemes with `...` on the map, full in the tooltip and in the outline). Internal ids are never shown.
- Branches carry the colour of their first-level branch; the status colour belongs to the symbol only.

## Theming

The component injects its CSS once per document as `<style id="simple-mindmap-css">` (the same text as
`src/mindmap.css`), first in `<head>`, so your stylesheets come after it. The public knobs are the `--mm-*` variables;
set them on `.simple-mindmap` or on any ancestor (for example your app's own theme class), in light and dark alike:

`--mm-bg`, `--mm-text`, `--mm-muted`, `--mm-node-bg`, `--mm-node-border`, `--mm-root-bg`, `--mm-root-text`, `--mm-select`,
`--mm-hit`, `--mm-hit-current`, `--mm-chip-bg`, `--mm-green`, `--mm-amber`, `--mm-red`, `--mm-blue`, `--mm-purple`,
`--mm-grey`, `--mm-link-blocks`, `--mm-link-supersedes`, `--mm-link-relates`, `--mm-edge-0` ... `--mm-edge-7`,
`--mm-font`, `--mm-mono` (28 colour tokens plus 2 font variables).

A dark palette applies under `prefers-color-scheme: dark` unless `data-theme="light"`; `theme: "dark"` forces it.
A `--mm-*` value you set always wins over both palettes. The defaults live in private `--mmd-*` variables, which are
internal and not part of the 1.x API.

- At runtime: `mm.setTheme("dark")`, `mm.setTheme("light")`, `mm.setTheme(null)` (follow the OS). Setting or removing
  `data-theme` on the component element by hand works the same way. Nothing is redrawn: every colour is a CSS variable.
- Without writing CSS: `theme: {mode: "light", tokens: {bg: "#fbf7ef", "node-bg": "#fffdf8", "edge-0": "#b5651d"}}` sets
  `--mm-<token>` on the component (token names as above without `--mm-`, plus `font` and `mono`); `mm.setTheme` takes the same
  object and replaces the tokens set before. Unknown names are ignored and listed in `mm.warnings`.
- `export("svg")` reads the computed values, so the file follows the live theme (palette, tokens, your CSS) with concrete
  colours and opens anywhere.
- The palettes are exported as `THEME` and `DARK_THEME`: `toSVG(json, {theme: DARK_THEME})` is a dark file without a page.

## Strings

Every visible text comes from `strings` (English defaults). A value is a string with `{placeholders}` or a function.

`invalid`, `renderFailed`, `renderFailedDetail` (`{message}`), `errorLine(error)`, `search`, `searchLabel`, `matches` (`{index}`, `{total}`), `noMatches`,
`prevMatch`, `nextMatch`, `views`, `viewBoth`, `viewRight`, `viewOutline`, `allLinks`, `zoomIn`, `zoomOut`, `fit`,
`focusBranch`, `focusPath`, `more`, `expand`, `collapse`, `rename`, `addChild`, `addSibling`, `remove`, `newIdea`,
`hidden` (`{n}`), `linkBlocks`, `linkSupersedes`, `linkRelates`. Status labels come from `statuses`.

## Security notes

- Titles, labels, badges and error messages are set with `textContent` / SVG `<text>`; nothing is parsed as HTML.
- Notes are never drawn by the component (they are untrusted Markdown; draw them in your own sandbox).
- No URL of its own, no `eval`, no external fonts. The only fetch the browser makes for the component is a status `image`
  URL you chose (CSP `img-src`). The only inline style is the injected `<style>` element plus CSSOM style properties, so a
  CSP needs `style-src 'unsafe-inline'` (or a hash of the stylesheet).
- Status icons are whitelisted SVG geometry (see "Status icons"); `render` elements are yours and are never exported.

## Demo

Browsers refuse ES module imports from `file://` pages, so the demo is served by a tiny local server (Node 22+, no
dependencies, listens on 127.0.0.1 only):

```sh
npm ci                       # the demo loads lucide from node_modules (status icon panel)
node demo/serve.mjs          # or: npm run demo
# open http://127.0.0.1:8765/demo/
```

## Development

There are no runtime dependencies. One devDependency, pinned exactly, is used by the tests and the demo only (the
library never imports it); install it first:

| devDependency | Version | Licence | Source |
|---|---|---|---|
| lucide | 1.76.0 | ISC | https://github.com/lucide-icons/lucide |

```sh
npm ci                   # installs lucide from package-lock.json; the Lucide tests FAIL (not skip) without it
npm test                 # node --test test/unit/  (model, ops, layout with a fake measure, svg, export, validate, repo rules)
npm run test:browser     # headless Chrome through the DevTools protocol, real mouse and keyboard input
npm run test:all         # both
npm run measure          # layout time and overlap count for 400 and 2 000 nodes
npm run mutate           # mutation checks (see below)
npm run sync-css         # copy src/mindmap.css into the CSS constant of src/mindmap.js after editing the CSS
```

Browser tests need Chrome or Chromium; set `CHROME=/path/to/chrome` if it is not found. Without a browser they are
reported as skipped, not passed.

### Mutation checks

Every important check has a documented mutation in `test/tools/mutations.mjs`: a small change to the source that must
turn a named test red. `npm run mutate` copies the repository to a temporary directory, applies each mutation there
(the working tree is never touched), runs the suite and reports, per mutation, whether the expected test failed.
It exits non-zero when a mutation survives or no longer applies.

```sh
npm run mutate                          # all mutations (unit and browser; several minutes)
npm run mutate -- --suite unit          # only the node suite
npm run mutate -- --only M01,M20        # selected mutations
```

When you change the code a mutation targets, update its `find` text so it still applies.

### Versioning

Semantic versioning. The API above, the operation shapes, the events and the error codes are the 1.x contract.
Incompatible changes ship under a new package name, not a new major of this one.

## License

MIT, see [LICENSE](LICENSE).
