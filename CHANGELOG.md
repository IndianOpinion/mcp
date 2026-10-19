# Changelog

All notable changes to the Indian Opinion MCP server (the Worker at https://indianopinion.org/mcp).
`VERSION` in `src/version.js` is the version in `serverInfo`, the server card and the health
document; it is bumped with every deployable change. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [0.2.0] - 2026-10-19

### Added

- `close_account` (tool 15): closes the account through `POST /agent/close` with `confirm: true`.
  Every token is revoked, every email stops and sign-in is disabled. It is deactivation, not deletion,
  and the answer says so with the retention statement (#3).
- An `outputSchema` per tool describing its `structuredContent` (#7).
- `wrangler` as a pinned devDependency and `engines` (Node 20 or newer), so `npm run dev` and
  `npm run check` work from a clean checkout (#5).
- `CHANGELOG.md`.

### Changed

- Capabilities advertise `listChanged: false` for tools, prompts and resources: the transport is
  stateless and cannot deliver list-changed notifications (#9).
- `resources/read` failures are JSON-RPC errors: malformed ids and dates and missing briefs or digests
  are "resource not found" (-32602), a missing token is -32001. A typo such as `brief/5010x77` no
  longer reads another article (#6).
- Tool error text reads "message (error: code, field: ...). Fix" with the space restored, and a 404
  hint that fits the tool (#8).
- Sign-up tools, instructions and the about resource say that verifying a new address switches on the
  daily digest and Breaking News, and that `unsubscribe` with `all` stops both (#10).
- `list_breaking` says when the API's window holds more events than one page.
- `VERSION` 0.2.0, so `serverInfo` and the server card identify this build (#11).

### Fixed

- `search_briefs`: following `next_cursor` never skips a brief at a page boundary, even when the
  origin answers more items than asked for.
- The CLI install line in the `/agents/cli/` index creates `~/bin` first.

## [0.1.0] - 2026-10-17

First deployed version: 14 tools, 5 prompts, 3 resources, discovery files and OAuth 2.1.
