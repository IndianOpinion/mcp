# Agents without MCP (OpenAPI)

Specification: https://spec.openapis.org/oas/v3.1.0

The REST API behind the MCP server is described in OpenAPI 3.1:

- Live: `https://indianopinion.org/agents/openapi.json`
- In this repository: [public/agents/openapi.json](../public/agents/openapi.json)
- Base URL: `https://indianopinion.org/wp-json/io/v1`

Each operation's `operationId` equals the MCP tool name, so the same instructions work either way.
Import the document into any framework or product that builds tools or actions from OpenAPI.

## Auth

- Public operations (`search_briefs`, `get_brief`, `signup_start`, `signup_verify`) need none.
- Account operations take `Authorization: Bearer ioa_...`. Get the token with
  `POST /agent/start` (`{"email": "..."}`, emails a 6-digit code) and then `POST /agent/verify`
  (`{"email": "...", "code": "123456"}`), or with `indianopinion login` in the CLI. In an actions
  builder, choose API key or bearer authentication and paste the token.

## Example

```sh
curl -s 'https://indianopinion.org/wp-json/io/v1/briefs?q=monsoon&limit=5'
curl -s -H "Authorization: Bearer $IO_TOKEN" 'https://indianopinion.org/wp-json/io/v1/agent/digest/latest'
```

Lists page with `next_cursor`: pass it back as `cursor`. A `429` carries `Retry-After`.
