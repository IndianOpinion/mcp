# OpenClaw

Vendor documentation: https://docs.openclaw.ai/tools/mcp (checked 17 October 2026)

## Public tools

```sh
openclaw mcp add indianopinion --url https://indianopinion.org/mcp --transport streamable-http
openclaw mcp doctor indianopinion --probe
```

To limit the tools the agent sees, add `--include 'search_briefs,get_brief'`.

## Account tools with OAuth

Add the OAuth endpoint and set the server's auth to OAuth in its config
(`mcp.servers.indianopinion`):

```json
{
  "url": "https://indianopinion.org/mcp/oauth",
  "transport": "streamable-http",
  "auth": "oauth"
}
```

Then run `openclaw mcp login indianopinion` (or **Sign in** under **Settings**, **MCP**) and enter your
email and the code.

## Account tools with a bearer token

OpenClaw supports custom headers through its scoped config editor and secret store; its documentation
does not show the exact header syntax, so follow the vendor page and set
`Authorization: Bearer <token>` on `https://indianopinion.org/mcp`, with the token kept as a secret.
