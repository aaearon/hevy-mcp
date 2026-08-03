---
"hevy-mcp": major
---

Remove the npm registry update check, so the server contacts no host but the
Hevy API.

Previously the Node package scheduled a background `GET
https://registry.npmjs.org/hevy-mcp` once per process start (cached for 24
hours) to print a stderr notice when a newer release was available. The request
was unauthenticated and carried no identifier, but it was on by default with no
way to disable it. It is now gone entirely: `scheduleUpdateCheck`,
`checkForUpdate`, and the whole `version-check` module have been deleted, along
with the now-unused `semver` dependency of the published package.

Together with the telemetry removal, `api.hevyapp.com` is now the only host the
shipped server ever contacts.

**Breaking changes**

- No update notifications are printed. Check for new releases yourself (for
  example with `npm outdated -g hevy-mcp`).
- `XDG_CACHE_HOME` no longer affects `hevy-mcp`; nothing is written to
  `~/.cache/hevy-mcp/update-check.json` anymore. Any existing cache file is
  orphaned and can be deleted.
- `semver` is no longer a dependency of the `hevy-mcp` package.

`tests/unit/no-runtime-telemetry.test.ts` now scans every `packages/*/src` tree
(not just `packages/node/src`) and asserts that no npm-registry URL or update
check is reintroduced.
