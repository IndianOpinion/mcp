# ChatGPT (custom MCP server, developer mode)

Vendor documentation:
https://developers.openai.com/apps-sdk/deploy/connect-chatgpt and
https://developers.openai.com/apps-sdk/build/auth
(checked 17 October 2026)

ChatGPT connects to remote MCP servers with OAuth 2.1 or with no authentication. It cannot send a
static API key or bearer header, so use the OAuth endpoint for account tools.

## Add the server

1. Turn on developer mode for your account (or ask your workspace admin to allow it). OpenAI's pages
   describe where the toggle is for your plan; plan limits apply to what custom servers may do.
2. Go to `chatgpt.com/plugins`, choose **+**, then **Add custom MCP server**.
3. Name: `Indian Opinion`. Description: `Indian news briefs, digest and Breaking News`.
4. URL: `https://indianopinion.org/mcp/oauth`. Authentication: **OAuth**. Leave client id and secret
   empty; ChatGPT registers itself through the server's dynamic client registration.
5. **Create**. A page on indianopinion.org opens: enter your email, then the 6-digit code sent to it.

For the public tools only, use `https://indianopinion.org/mcp` with no authentication.

## Notes

- The menu names above are taken from OpenAI's developer documentation as of the date above; ChatGPT
  renames these screens often. If they differ, follow the vendor page; the URL and OAuth choice stay
  the same.
- Signing in with a new address switches on the daily digest and Breaking News (up to 5 a day).
  Ask ChatGPT to call `unsubscribe` with `all` to stop both, or use the link in any email. To close
  the account itself, ask for `close_account` (deactivation, not deletion).
- To disconnect fully, also revoke the `oauth ChatGPT` token on the account (`indianopinion token
  list`, then `indianopinion token revoke <id>`).

Agents built on the OpenAI API rather than ChatGPT can use the same URL as a remote MCP tool, or the
REST API through [OpenAPI](openapi.md).
