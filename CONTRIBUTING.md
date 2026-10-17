# Contributing

Thank you for helping. Please read this before opening a pull request.

## How this repository relates to production

The server at `https://indianopinion.org/mcp` is deployed from a private repository, not from this
one. This repository is a public mirror of the Worker source, its tests, the OpenAPI document and the
discovery files, so anyone can read, run and improve them.

- Pull requests here are reviewed by the maintainers. An accepted change is applied to the private
  repository, tested there and deployed from there; the mirror is then refreshed, so your commit may
  land here as part of a mirror update rather than as a merge of your branch.
- Merging a pull request here does not change production.
- Deployment configuration (account ids, routes, secrets) stays private. `wrangler.example.toml`
  documents the bindings with placeholders.

## Making a change

1. Open an issue first for anything larger than a small fix, so we can agree on the approach.
2. Keep the Worker a thin adapter: a tool maps to REST calls with the caller's own credentials. Logic
   about content, accounts or limits belongs in the REST API, which is not in this repository.
3. Run `npm ci && npm test`. Add or update tests for any behaviour you change. Tests must not use the
   network.
4. If you change `src/discovery.js`, regenerate `discovery/server-card.json` and `discovery/agents.txt`
   (CI shows the command). If you change a tool, update `public/agents/openapi.json` so the
   `operationId` set still matches the tool names, and the tool table in `README.md`.
5. Never commit a token, a real email address, an account id or a `wrangler.toml`.
6. Client setup guides in `docs/` must cite the vendor's current documentation at the top. Do not add
   a recipe you have not checked against that documentation.

By contributing you agree that your contribution is licensed under the MIT licence of this repository.

## Security issues

Do not open a public issue. See [SECURITY.md](SECURITY.md).
