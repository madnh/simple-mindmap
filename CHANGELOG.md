# Changelog

All notable changes to this project are documented here. The project follows [Semantic Versioning](https://semver.org/);
the API, operations, events and error codes described in the README are the 1.x contract.

## 1.0.0

First release.

- `createMindmap(el, options)`: three views (both sides, tree to the right, outline), three modes (`view`, `select`,
  `edit`), floating search, layout and zoom tools, focus on a branch, cross links, collapse with hidden counts, node menu
  actions, `badge` callback, replaceable `strings` and `statuses`, CSS variables `--mm-*` with a dark palette.
- Data in and out: `setData`, atomic `apply`, `getData`, `getNode`, `getPath`, `find`, `getState`, `export` (`json`,
  `outline`, `mermaid`, `svg`).
- Events: interaction events only from user input; `invalid` and `error` for every caller.
- Pure functions for any JavaScript engine (`simple-mindmap/core`): `validate` with fixed error codes, `applyOps`,
  `toOutline`, `toMermaid`, `fromOutline`, `pathOf`.
- Browser-only functions that measure text: `layout`, `toSVG`.
- The 1.0 sample data set in `test/fixtures/v1/`: every 1.x release must accept it.
