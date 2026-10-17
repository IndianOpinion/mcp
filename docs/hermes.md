# Hermes Agent (Nous Research)

Vendor documentation: https://hermes-agent.nousresearch.com/docs/user-guide/features/mcp
(checked 17 October 2026)

Add the server under `mcp_servers` in `~/.hermes/config.yaml`.

## Public tools

```yaml
mcp_servers:
  indianopinion:
    url: "https://indianopinion.org/mcp"
```

## Account tools with a bearer token

```yaml
mcp_servers:
  indianopinion:
    url: "https://indianopinion.org/mcp"
    headers:
      Authorization: "Bearer ${IO_TOKEN}"
```

`${IO_TOKEN}` is read from the environment when the server connects. Get a token with the CLI
(`indianopinion login`) or the `signup_start` and `signup_verify` tools.

## Account tools with OAuth

```yaml
mcp_servers:
  indianopinion:
    url: "https://indianopinion.org/mcp/oauth"
    auth: oauth
```

Hermes discovers the authorization server, registers itself and runs PKCE; sign in with your email and
the code. Tokens are stored under `~/.hermes/mcp-tokens/`.
