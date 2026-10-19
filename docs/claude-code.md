# Claude Code

Vendor documentation: https://code.claude.com/docs/en/mcp (checked 17 October 2026)

## Public tools

```sh
claude mcp add --transport http indianopinion https://indianopinion.org/mcp
```

## Account tools with a bearer token

Get a token once (the CLI stores it, or use the `signup_start` and `signup_verify` tools).
The CLI is not on the npm registry yet, so install it from GitHub first (Node 20 or newer):

```sh
npm i -g github:IndianOpinion/cli     # or: npm i -g https://indianopinion.org/agents/cli/latest.tgz
```

```sh
indianopinion login start --email you@example.com
indianopinion login verify --email you@example.com --code 123456
export IO_TOKEN="$(cat ~/.config/indianopinion/token)"
```

Verifying a new address switches on the daily digest and Breaking News (up to 5 a day);
`indianopinion unsubscribe --what all --yes` stops both.

Then add the server with the header:

```sh
claude mcp add --transport http indianopinion https://indianopinion.org/mcp \
  --header "Authorization: Bearer $IO_TOKEN"
```

`-s user` makes it available in every project; `-s project` writes `.mcp.json` for the repository, in
which case do not commit the token (keep it in an environment variable).

## Account tools with OAuth

```sh
claude mcp add --transport http indianopinion https://indianopinion.org/mcp/oauth
```

Then run `/mcp` in Claude Code (or `claude mcp login indianopinion`) and sign in with your email and
the code. Do not combine this with `--header`: when an `Authorization` header is set, Claude Code does
not fall back to OAuth.

## Skill

`indianopinion skill install` (after the install above) adds the Indian Opinion Agent Skill, which tells Claude when and
how to use these tools.
