# Security policy

## Reporting a vulnerability

Email **hello@indianopinion.org** with "Security" in the subject. Please include:

- what is affected (an endpoint such as `https://indianopinion.org/mcp`, an OAuth endpoint, a file in
  this repository, or the `indianopinion` npm package),
- steps to reproduce, and
- the impact you expect.

Please do not open a public issue or pull request for a vulnerability, and do not access, change or
delete data that is not yours while testing. Use your own agent account; no testing that degrades the
service for others (load tests, spam to sign-in codes).

We aim to acknowledge a report within three working days and to keep you informed until it is fixed.
We are happy to credit reporters who want it once a fix is deployed.

## Scope

In scope: the MCP server and its OAuth authorization server at `indianopinion.org`, the source in this
repository, and the CLI at https://github.com/IndianOpinion/cli.

## Supported versions

Only the version deployed at `https://indianopinion.org/mcp` (see `version` in
`/.well-known/mcp/server-card.json`) and the latest release of the CLI receive fixes.
