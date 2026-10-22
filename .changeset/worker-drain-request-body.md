---
"@hevy-mcp/worker": patch
---

Consume a clone of the request body before validating the key, so early error
responses (502, 415) are no longer turned into a 500 "fetch failed" by workerd.
Upstream did this implicitly through its feedback-call sniffing, which this
fork removed. Also adds coverage tests for the failure-event projection and
the `http+oauth` endpoints.
