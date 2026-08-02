---
"@hevy-mcp/core": patch
---

Fix `create-routine` and `update-routine` against the live Hevy API.

- Omit `rep_range` entirely when a set has no range. The API rejects an explicit
  `rep_range: null` with "rep_range must be of type object" despite the OpenAPI
  spec marking the field nullable, which previously made every reps-only set and
  every warmup set fail on create.
- Unwrap the routine mutation response. `POST /v1/routines` and
  `PUT /v1/routines/:routineId` respond with `{ routine: [Routine] }` rather than
  the bare `Routine` the generated types declare, so both tools previously
  returned an empty object instead of the created/updated routine.
