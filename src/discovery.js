// Discovery documents served by this Worker. The server card follows the
// draft MCP server card (SEP-2127, not yet a standard; three well-known paths
// because the drafts have not converged), and agents.txt the community draft
// (agents-txt.com v1.0). Both are marked draft.

import { VERSION, MCP_URL, DOCS, SITE, PROTOCOL_VERSIONS } from './version.js';

export const SERVER_CARD_PATHS = ['/.well-known/mcp/server-card.json', '/.well-known/mcp-server-card', '/.well-known/mcp.json'];

export function serverCard() {
  return {
    _status: 'draft: MCP server card per SEP-2127 (not yet a standard); shape may change',
    name: 'indianopinion',
    title: 'Indian Opinion',
    version: VERSION,
    description: 'Indian news briefs synthesised from many outlets, with corroboration counts and how each outlet framed the story; the daily digest, topic alerts and Breaking News for agent accounts.',
    websiteUrl: SITE + '/',
    documentation: DOCS,
    icons: [{ src: SITE + '/favicon.ico', mimeType: 'image/x-icon' }],
    remotes: [{ type: 'streamable-http', url: MCP_URL, supportedProtocolVersions: PROTOCOL_VERSIONS.slice(0, 2) }],
    authentication: {
      public: ['search_briefs', 'get_brief', 'signup_start', 'signup_verify'],
      account: 'Authorization: Bearer ioa_... from signup_verify (POST /wp-json/io/v1/agent/verify), or OAuth 2.1 at ' + MCP_URL + '/oauth (authorization code with PKCE S256, dynamic client registration, the same email-code sign-in).',
      oauth: { resource: MCP_URL + '/oauth', protected_resource_metadata: SITE + '/.well-known/oauth-protected-resource/mcp/oauth', authorization_server: SITE + '/.well-known/oauth-authorization-server' },
    },
    openapi: SITE + '/agents/openapi.json',
    cli: SITE + '/agents/cli/',
    contact: 'hello@indianopinion.org',
  };
}

export function agentsTxt() {
  return `# agents.txt for indianopinion.org
# Draft format (agents-txt.com, community draft v1.0); details live in each linked document.
# Guide for agents: ${DOCS}  (Markdown twin: ${SITE}/agents.md)
# REST API, OpenAPI 3.1: ${SITE}/agents/openapi.json
# CLI and io.sh: ${SITE}/agents/cli/
# MCP server card (draft): ${SITE}/.well-known/mcp/server-card.json
# MCP with OAuth sign-in (ChatGPT and claude.ai connectors): ${MCP_URL}/oauth
# Sign up with an email and the code sent to it; the verified address gets the daily digest.
MCP: ${MCP_URL}
Skills: ${SITE}/agents/skill/SKILL.md
`;
}

export function cliIndex(latest) {
  return `Indian Opinion CLI (${latest.version})

Node 20 or newer, no dependencies:
  npm i -g ${SITE}/agents/cli/latest.tgz
  npx --yes ${SITE}/agents/cli/indianopinion-${latest.version}.tgz --help

bash + curl only:
  curl -fsSL ${SITE}/agents/cli/io.sh -o ~/bin/io && chmod +x ~/bin/io

Files:
  latest.tgz                      the newest tarball (same bytes as the versioned file)
  indianopinion-${latest.version}.tgz
  latest.json                     {version, url, sha256}
  SHA256SUMS
  io.sh
  SKILL.md                        also at ${SITE}/agents/skill/SKILL.md

Guide: ${DOCS}
`;
}
