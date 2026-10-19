# Indian Opinion MCP server

The Indian Opinion MCP server gives AI agents and assistants Indian news briefs synthesised from many
outlets, with corroboration counts and how each outlet framed the story, plus the daily digest, topic
alerts and Breaking News for agent accounts.

| Endpoint | For |
|---|---|
| `https://indianopinion.org/mcp` | Any MCP client over Streamable HTTP. Public tools need no sign-in; account tools take `Authorization: Bearer ioa_...` |
| `https://indianopinion.org/mcp/oauth` | Clients that sign in with OAuth 2.1 (claude.ai, ChatGPT and others): the same server, with OAuth required |

This repository is the source of that server: a Cloudflare Worker that is a thin adapter over the
Indian Opinion REST agent API (`https://indianopinion.org/wp-json/io/v1`). Every tool is one REST call
made with the caller's own credentials; there is no business logic or data store here beyond the OAuth
state. It also holds the [OpenAPI 3.1 document](public/agents/openapi.json), the
[agents.txt](discovery/agents.txt) and the [MCP server card](discovery/server-card.json) the Worker
serves, and [setup guides for each client](docs/).

The command-line client and stdio bridge is [IndianOpinion/cli](https://github.com/IndianOpinion/cli).
Until its first npm publish, install it from GitHub: `npm i -g github:IndianOpinion/cli` (or the site
copy, `npm i -g https://indianopinion.org/agents/cli/latest.tgz`).

## Connect

| Client | Guide | Method |
|---|---|---|
| claude.ai, Claude Desktop and mobile | [docs/claude-ai.md](docs/claude-ai.md) | Custom connector, OAuth |
| ChatGPT | [docs/chatgpt.md](docs/chatgpt.md) | Custom MCP server (developer mode), OAuth |
| Claude Code | [docs/claude-code.md](docs/claude-code.md) | `claude mcp add --transport http` |
| Cursor | [docs/cursor.md](docs/cursor.md) | `mcp.json` with `url` |
| Grok | [docs/grok.md](docs/grok.md) | Custom connector in the app; remote MCP tool in the xAI API |
| OpenClaw | [docs/openclaw.md](docs/openclaw.md) | `openclaw mcp add` |
| Hermes Agent | [docs/hermes.md](docs/hermes.md) | `mcp_servers` in `config.yaml` |
| Meta Muse | [docs/meta-muse.md](docs/meta-muse.md) | Not verified |
| Instinct | [docs/instinct.md](docs/instinct.md) | Not verified |
| Any other MCP client | [docs/generic-mcp.md](docs/generic-mcp.md) | Streamable HTTP URL |
| Agents without MCP | [docs/openapi.md](docs/openapi.md) | OpenAPI 3.1 over REST |

## Tools

Fifteen tools. Lists default to 10 items and cap at 25. Every tool sets a title, all four
annotation hints (read-only, destructive, idempotent, open-world) and an `outputSchema` that describes
its `structuredContent`. The server is stateless, so it advertises `listChanged: false`.

| Tool | Auth | What it does |
|---|---|---|
| `search_briefs` | public | Search published briefs by text, category and date, with cursor paging |
| `get_brief` | public | One brief by id or article URL: summary, sources, corroboration and framing |
| `signup_start` | public | Email a 6-digit sign-in code to an address |
| `signup_verify` | public | Exchange the email and code for an account token (`ioa_...`) |
| `get_account` | account | The signed-in account: masked email, preferences, topics followed, recent Breaking News sends |
| `update_preferences` | account | Change digest format and hour, and Breaking News settings |
| `list_topics` | account | Topics the account follows |
| `follow_topic` | account | Follow a topic, with an alert tier |
| `unfollow_topic` | account | Stop following a topic |
| `get_digest` | account | The latest daily digest, or the one for a date |
| `list_breaking` | account | Recent Breaking News candidates and their scores |
| `get_breaking_event` | account | One Breaking News event in full |
| `unsubscribe` | account | Stop the digest, Breaking News, topic alerts or all emails |
| `create_browser_link` | account | A one-time, 10-minute link that signs a browser in to the account page |
| `close_account` | account | Close the account: tokens revoked, every email stopped, sign-in disabled (deactivation, not deletion) |

Prompts: `morning_briefing`, `explain_framing_gap`, `watch_topic`, `tune_breaking`, `brief_my_human`.
Resources: `indianopinion://about`, `indianopinion://brief/{id}`, `indianopinion://digest/{date}`.

The OpenAPI `operationId` of each REST operation equals the MCP tool name.

## Public tools and account tools

- **No sign-in.** `search_briefs`, `get_brief`, `signup_start` and `signup_verify` work on
  `https://indianopinion.org/mcp` with no credentials.
- **Bearer token.** For account tools, sign up with `signup_start` and `signup_verify` (or
  `indianopinion login` in the CLI) and send the returned token as `Authorization: Bearer ioa_...`.
  Clients that can set a header use this on `/mcp`.
- **OAuth 2.1.** Clients that only accept OAuth or no auth (claude.ai, ChatGPT) use
  `https://indianopinion.org/mcp/oauth`. A request without a token gets `401` with
  `WWW-Authenticate: Bearer resource_metadata="https://indianopinion.org/.well-known/oauth-protected-resource/mcp/oauth"`.
  The server supports dynamic client registration (RFC 7591), the authorization code flow with PKCE
  `S256`, rotating refresh tokens and revocation (RFC 7009). Sign-in is the same email code; the
  connector then appears as a token labelled `oauth <client name>` on the account, where it can be
  revoked.

Verifying a new email address switches on the daily digest and Breaking News (at most 5 a day under
the default rule); `unsubscribe` with `all` stops both. `close_account` closes the account (with
`confirm: true`): every token is revoked, every email stops and the address can no longer sign in. It is
deactivation, not deletion: the account record is kept, deactivated, under the retention terms of
https://indianopinion.org/privacy-policy/, and erasure or reopening is by email to
hello@indianopinion.org. Tokens are never logged; each tool call logs only the tool name, the public
token id, the outcome and the latency.

`resources/read` failures are JSON-RPC errors: a malformed id or date, or a missing brief or digest, is
"resource not found" (-32602, as the 2026-07-28 spec requires); a missing token on
`indianopinion://digest/{date}` is -32001.

## Rate limits

| Scope | Limit |
|---|---|
| Requests to `/mcp` and `/mcp/oauth`, per IP | 120 a minute |
| `search_briefs`, per IP | 20 a minute |
| Account tool calls, per token | 60 a minute |
| `/oauth/authorize` and `/oauth/register`, per IP | 30 a minute |
| `/oauth/token` and `/oauth/revoke`, per IP | 60 a minute |
| Sign-in codes (set by the API) | 3 an hour per address, 5 an hour per IP |
| Request body | 16 KB (larger is `413`) |

A limited call returns a tool error with `retry_after` in seconds. The REST API's own limits are
authoritative; the Worker's limits sit in front of them.

## Endpoints the Worker serves

| Path | What |
|---|---|
| `/mcp` | MCP over Streamable HTTP, stateless; the 2026-07-28 revision and the 2025 initialize handshake. `GET` is `405` |
| `/mcp/oauth` | The same server with OAuth required |
| `/.well-known/mcp/server-card.json` (also `/.well-known/mcp-server-card`, `/.well-known/mcp.json`) | MCP server card (draft, SEP-2127) |
| `/agents.txt` | agents.txt (community draft) |
| `/agents/openapi.json` | OpenAPI 3.1 of the REST API |
| `/agents/cli/`, `/agents/skill/SKILL.md` | CLI downloads and the Agent Skills file |
| `/.well-known/oauth-protected-resource[/mcp/oauth]` | RFC 9728 protected resource metadata |
| `/.well-known/oauth-authorization-server` | RFC 8414 authorization server metadata |
| `/oauth/register`, `/oauth/authorize`, `/oauth/token`, `/oauth/revoke` | OAuth 2.1 authorization server |

## Develop

Node 20 or newer (`engines` in package.json). `wrangler` is a pinned devDependency, so `npm run dev`
and `npm run check` need nothing else.

```sh
npm ci
npm test                              # Worker module in Node against a local REST stub; no network
```

To serve the CLI files under `/agents/cli/` as well, clone
[IndianOpinion/cli](https://github.com/IndianOpinion/cli) next to this checkout as `../cli` (or set
`IO_CLI_DIR`) and run `npm run build:cli`; the tests then also check those files.

To run the Worker on your own Cloudflare account, copy `wrangler.example.toml` to `wrangler.toml`,
fill in your account id and KV namespace id, and use `npm run dev`. `discovery/` holds the
agents.txt and server card exactly as `src/discovery.js` renders them (`npm run discovery` rewrites
them); the test suite fails if they drift.

| File | Role |
|---|---|
| `src/index.js` | Routing, guards, rate limits, MCP handler |
| `src/tools.js`, `src/prompts.js`, `src/resources.js` | MCP tools, prompts and resources |
| `src/client.js` | REST client |
| `src/auth.js` | The only reader of credentials (bearer and OAuth) |
| `src/oauth.js` | OAuth 2.1 authorization server |
| `src/discovery.js` | Server card, agents.txt, CLI index |
| `src/render.js` | Text rendering of briefs and digests |
| `test/` | Node test suites and the REST stub |
| `CHANGELOG.md` | One entry per `VERSION` |

## Contributing and security

See [CONTRIBUTING.md](CONTRIBUTING.md) and [SECURITY.md](SECURITY.md). Report vulnerabilities to
hello@indianopinion.org, not in public issues.

## Licence

[MIT](LICENSE). Indian Opinion content returned by the API is not covered by this licence; see
https://indianopinion.org/agents/ for its terms of use.
