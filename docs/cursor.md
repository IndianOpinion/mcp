# Cursor

Vendor documentation: https://cursor.com/docs/context/mcp (checked 17 October 2026)

Add the server to `~/.cursor/mcp.json` (all projects) or `.cursor/mcp.json` (one project).

## Public tools

```json
{
  "mcpServers": {
    "indianopinion": { "url": "https://indianopinion.org/mcp" }
  }
}
```

## Account tools with a bearer token

Keep the token in the environment (see [claude-code.md](claude-code.md) or the CLI's `login` for how
to get one) and reference it:

```json
{
  "mcpServers": {
    "indianopinion": {
      "url": "https://indianopinion.org/mcp",
      "headers": { "Authorization": "Bearer ${env:IO_TOKEN}" }
    }
  }
}
```

## Account tools with OAuth

Cursor handles OAuth with dynamic client registration without extra configuration:

```json
{
  "mcpServers": {
    "indianopinion": { "url": "https://indianopinion.org/mcp/oauth" }
  }
}
```

Cursor shows a sign-in prompt for the server in its MCP settings; sign in with your email and the code.
