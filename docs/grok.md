# Grok (xAI)

Vendor documentation:
https://docs.x.ai/grok/connectors (Grok app) and
https://docs.x.ai/docs/guides/tools/remote-mcp-tools (xAI API)
(checked 17 October 2026)

## Grok app: custom connector

1. Open `grok.com/connectors`, choose **New Connector**, then **Custom**.
2. URL: `https://indianopinion.org/mcp` for the public tools, or
   `https://indianopinion.org/mcp/oauth` to sign in for account tools.
3. Complete the sign-in if Grok prompts for it (email, then the 6-digit code).

On Business and Enterprise plans an admin must provision the connector first. xAI's page does not say
which authentication methods custom connectors support, so the OAuth sign-in is not verified for the
Grok app; the public tools on `/mcp` need none.

## xAI API: remote MCP tool

Agents built on the xAI API (a "Grok bot") pass the server as a tool. `authorization` is sent as the
`Authorization` header:

```python
tools = [{
    "type": "mcp",
    "server_url": "https://indianopinion.org/mcp",
    "server_label": "indianopinion",
    "allowed_tools": ["search_briefs", "get_brief", "get_digest"],
    "authorization": "Bearer " + os.environ["IO_TOKEN"],  # omit for public tools only
}]
```

Check the vendor page for whether `authorization` takes the scheme prefix in your SDK version. Get a
token with the CLI (`indianopinion login`) or the `signup_start` and `signup_verify` tools.
