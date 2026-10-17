# Any MCP client

Specification: https://modelcontextprotocol.io/specification

| Setting | Value |
|---|---|
| Transport | Streamable HTTP (stateless; `POST` only, `GET` is `405`) |
| URL, public tools or bearer token | `https://indianopinion.org/mcp` |
| URL, OAuth 2.1 | `https://indianopinion.org/mcp/oauth` |
| Protocol versions | 2026-07-28, and the 2025 initialize handshake for older clients |
| Server card | `https://indianopinion.org/.well-known/mcp/server-card.json` |

## Choose an auth mode

1. **None.** `search_briefs`, `get_brief`, `signup_start` and `signup_verify` work without
   credentials.
2. **Bearer token.** Call `signup_start` with an email, then `signup_verify` with the email and the
   6-digit code; it returns `ioa_...`, shown once. Send `Authorization: Bearer ioa_...` on every
   request to `/mcp`. The CLI does the same with `indianopinion login start` and `login verify`.
3. **OAuth 2.1.** Point the client at `/mcp/oauth`. Without a token it answers `401` with
   `WWW-Authenticate: Bearer resource_metadata="https://indianopinion.org/.well-known/oauth-protected-resource/mcp/oauth"`.
   Authorization server metadata is at
   `https://indianopinion.org/.well-known/oauth-authorization-server`. Supported: dynamic client
   registration (RFC 7591) for public clients (`none`) and confidential clients
   (`client_secret_basic`, `client_secret_post`); authorization code with PKCE `S256` (required);
   `resource` indicator; refresh tokens that rotate on use (access 1 hour, refresh 30 days);
   revocation (RFC 7009). Redirect URIs must be https, localhost or a private-use scheme. Scopes:
   `news:read account:read account:write`.

## Clients that only speak stdio

Use the CLI as a bridge:

```json
{ "mcpServers": { "indianopinion": { "command": "npx", "args": ["--yes", "indianopinion", "mcp"] } } }
```

It forwards each message to `https://indianopinion.org/mcp` with the token stored by
`indianopinion login`, and stores the token when `signup_verify` succeeds.

## Check the connection

```sh
curl -s -X POST https://indianopinion.org/mcp \
  -H 'Content-Type: application/json' -H 'Accept: application/json, text/event-stream' \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'
```

Rate limits and the tool list are in the [README](../README.md).
