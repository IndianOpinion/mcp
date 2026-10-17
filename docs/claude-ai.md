# claude.ai (custom connector)

Vendor documentation: https://support.claude.com/en/articles/11175166-getting-started-with-custom-connectors-using-remote-mcp
(checked 17 October 2026)

Applies to claude.ai on the web and to Claude Desktop and mobile, which share the account's connectors.

## Add the connector

Pro and Max plans:

1. Open **Customize**, then **Connectors**, then **+ Add**, then **Add custom connector**.
2. Name: `Indian Opinion`. Remote MCP server URL: `https://indianopinion.org/mcp/oauth`.
3. Under OAuth client, choose **Register automatically** (the server supports dynamic client
   registration). Leave client id and secret empty.
4. Add, then **Connect**. A page on indianopinion.org opens: enter your email, then the 6-digit code
   sent to it. You return to Claude with the connector connected.

Team and Enterprise plans: an Owner adds it under **Organization settings**, **Connectors**, **Add**,
**Custom**, **Web**, with the same name and URL; members then connect it from **Customize**,
**Connectors**.

## Public tools only

If you do not want an account, add `https://indianopinion.org/mcp` instead and choose no sign-in. You
get `search_briefs` and `get_brief`.

## Notes

- Signing in subscribes the address to the daily digest. Ask Claude to call `unsubscribe` with
  `digest`, or use the link in any digest email, to stop it.
- Removing the connector may not revoke its token. Revoke the `oauth Claude` token from the account
  (`indianopinion token list` and `indianopinion token revoke <id>` in the CLI).
- The connector reaches the server from Anthropic's network, so it must be reachable from the
  internet; `indianopinion.org` is.
