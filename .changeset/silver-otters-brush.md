---
"@hevy-mcp/hevy-client": minor
---

Introduce `@hevy-mcp/hevy-client` as a standalone workspace package: a
runtime-neutral Hevy API client built on native `fetch`, together with the Kubb
generated types and Zod schemas. It replaces the client that previously lived in
the flat `src/generated` tree and is safe to use from both Node.js and
Cloudflare Workers. Only the `@hevy-mcp/hevy-client/types` and
`@hevy-mcp/hevy-client/schemas` barrels are public API; the generated API
functions and `.kubb` internals are private.

The package is private and bundled into the published `hevy-mcp` package.
