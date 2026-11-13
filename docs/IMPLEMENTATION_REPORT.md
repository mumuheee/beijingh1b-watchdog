# Implementation and security review

## Result and scope

Reviewed upstream `yalewinters/visa-slot-watcher` at `4754d0077e69b0df7546ce4314ef12cbedcec084` (v0.14.1). Baseline: 138 offline tests pass. Local branch: `safe-beijing-h1b`. GitHub fork creation was attempted using the authenticated CLI and rejected with HTTP 403, “Resource not accessible by integration.” No remote fork, push, or PR was created. This is a local derivative delivered as source, a patch, and a Git bundle.

The user subsequently requested retaining the original project and automatic booking, then explicitly selected **finish mock automatic booking first because no authorized API/provider is available**. Complete upstream source and history are retained as separate artifacts. The safe executable is a deliberately smaller Node CLI, not an extension preserving every upstream runtime feature. This report does not claim full feature parity. Real monitoring and real booking remain disabled/unimplemented. No login, CAPTCHA, protected endpoint, booking action, or real notification was exercised.

The Cloud Environment runtime and Vibe Code Security Reviewer skills guided environment setup, authorization, data flow, secret handling, and remediation checks. This is a scoped source review, not a penetration test or a claim of an issue-free application.

## Upstream architecture and trust boundaries

Manifest V3 Chrome extension. A MAIN-world script wraps fetch/XHR; an isolated-world bridge forwards page messages to a service worker. The worker classifies responses, heuristically extracts dates, maintains local state, schedules tab-based automated checks and sends desktop/ntfy notifications. UI pages edit settings, credentials and logs. A content script fills login/security answers, drives navigation, chooses consulate/applicant and optionally submits a booking.

Permissions: storage, notifications, tabs, alarms. Host grants cover all usvisascheduling subdomains, the specific atlasauth.b2clogin.com login tenant and ntfy.sh. Multiple content scripts run in all frames; the MAIN-world hook shares a DOM-visible nonce. Thus site content is an untrusted input source, not an authenticated availability provider.

Flow: login/password/security answers → chrome.storage.local → login content script → identity-provider forms; portal response → MAIN world → window message bridge → worker → heuristic parser → match/dedup → local state/logs and desktop/ntfy. The parser/diagnostic boundary can propagate arbitrary response string values into structural previews. ntfy receives appointment dates/location and the topic routing identifier.

Package manifest has no runtime or development dependency declarations and no install scripts; baseline tests use Node built-ins. There is no lockfile or vendored third-party JavaScript. This limits dependency risk but does not attest the browser/Node runtime or upstream provenance. LICENSE is CC BY-NC 4.0, not a permissive commercial software license; preserved with attribution. A heuristic static scan of tracked upstream source for common hard-coded token/key forms found no matches; that is not proof that every possible secret is absent, nor a scan of users' browser profiles. No credential validity probes were performed.

## Confirmed findings

Evidence paths below are relative to the original commit; inspect them using `git show 4754d0:<path>` in the bundle checkout. Severity is based on this project's use, not assumed remote compromise.

| Finding | Severity / confidence | Evidence and preconditions | Impact | Remediation / verification |
|---|---|---|---|---|
| Plaintext account password and security answers | High / confirmed | `src/lib/storage.js` getCreds/setCreds; `src/ui/options.js`; local access to Chrome profile, backups or malicious extension context required | Reusable account/recovery secrets exposed to profile readers | Safe tree has no portal credential fields or storage/API. Notification credentials use macOS Keychain or process env. Migration requires clearing/uninstalling existing extension; uninstallation cannot erase historical backups. |
| Irreversible automatic booking path | High / confirmed | `src/quickcheck-content.js` autoBook around line 1081 and dispatch around 1154; opt-in setting required | Real booking/rescheduling without per-action confirmation | Removed executable browser automation. Added explicit mock-only booking with single persisted simulation; tests cover scope, failure, inferred dates, opt-in and restarts. |
| Unattended protected-site access without provider authorization gate | High / confirmed | `src/background.js`, `src/quickcheck-content.js`; autoCheck opted in | Login/navigation, challenge reload and queue/rate-limit rerun behavior can operate outside approved provider terms | No availability network transport or portal permission in safe tree. Scheduler accepts only explicitly authorized local-file provider, rechecks expiry each cycle. Permission record is user attestation, not verified external authorization. |
| Heuristic inference promoted to availability | Medium / confirmed | `src/lib/parse.js`: bare date arrays and date fields default available=true/inferred=true; `src/lib/match.js` filters only available and date | False alerts from unrelated/inferred data | Strict versioned normalized schema; inferred distinct and never alerts/books. Unknown JSON/HTML/malformed/failed responses are errors. |
| Missing Beijing/H-1B identity enforcement in matching | Medium / confirmed | `src/lib/match.js` filterMatches; upstream test explicitly accepts every post | Other posts/visa categories may match dates, regardless of dropdown preference | Exact Beijing/H-1B snapshot scope; fail entire mismatched snapshot. Account having only one consulate does not prove visa category or response scope. |
| Seen-set suppresses reappearance | Medium / confirmed | `src/lib/match.js` diffNew retains all future seen dates even when absent | A useful newly reopened slot may not alert again | Track current confirmed presence and successful delivery. Complete absence or explicit unavailability resets delivery; reappearance tests. Failed/partial/inferred responses do not falsely reset. |
| Timestamp truncation and host-local “today” | Medium / confirmed | `src/lib/parse.js` ISO prefix capture; `src/lib/match.js` todayISO uses host offset | Incorrect date around Beijing midnight/year boundary | Strict calendar validation, explicit timezone timestamps, Asia/Shanghai normalization. Inclusive Dec 7/Jan 8 and Dec 31/Jan 1 tests in two host timezones. |
| Diagnostic value leakage risk | Medium / confirmed code path; exposure depends on payload | `src/lib/parse.js` describeShape emits leaf values; `src/background.js` lastShape persists output and activity UI displays diagnostics | Arbitrary response strings can include personal/session data, despite comments promising structural-only diagnostics | No raw response/error/body/URL logging in safe runtime; fixed error codes and allowlisted dates. Tests use secret sentinels to verify output does not reflect bodies/transport exceptions. |
| Page-visible nonce is not an authenticity boundary | Medium / confirmed design limitation; page compromise required | `src/capture-content.js` plants nonce on documentElement; `src/capture-main.js` reads it and posts messages | Same-origin injected script can spoof messages; not proof of server-confirmed availability | Removed page bridge. Trusted local provider writer is explicit trust boundary; source file must be protected by OS permissions and supplied by an authorized adapter. |
| Public ntfy topic and best-effort delivery | Low–Medium / confirmed | `src/background.js` notifyPhone publishes to ntfy.sh using topic and swallows failures; seen state is saved before notifyMatches | Topic disclosure exposes alerts; delivery failure may suppress later retry | Token-authenticated ntfy publishing plus random topic; private subscription recommended. Successful delivery tracked only after acknowledged send. Telegram JSON ok checked. Redirects denied; 10s timeout; notification errors sanitized. |

## Parser replacement and state semantics

The new parser intentionally does **not** guess undocumented Aura/custom-actions schemas. It validates the normalized contract in fixtures. `available` means an explicit provider assertion, not independent verification of an appointment or reservation. External provider adapters must supply the Beijing/H-1B identity, full intended coverage and truthful observedAt/complete values. A single-month response must be partial, or combined by the authorized adapter into one complete two-month snapshot.

A complete, successful, non-inferred snapshot establishes which dates disappeared. Partial snapshots update explicit available/unavailable entries. Inference and failures preserve previous knowledge but cannot generate new alerts or booking actions. Stale (>35 min), excessively future (>5 min), malformed, contradictory, unrecognized and out-of-order input is rejected. Bare date arrays and string booleans are rejected. Date-only values are local appointment days; offset timestamps are converted to Beijing day rather than sliced.

## Implemented safe paths

`src/core.js`: fixed policy, strict calendar/date handling, normalized parser, current-presence/delivery transitions, authorization checks. `src/runtime.js`: bounded no-symlink local file reads, 0600 state, atomic rename, exclusive lock, persistent minimum 30-minute interval. Failed attempts consume cadence. `src/notify.js`: Telegram/ntfy transport, minimal messages, no redirects or exception details. `src/cli.js`: offline demos, on-demand checks, gated scheduler, Keychain lookup and explicit simulated push test. `src/booking.js`: mock-only earliest confirmed target selection, one persisted simulation, no real booking transport. `scripts/install-launch-agent.py`: macOS launchd installer gated before any installation.

The 30-minute schedule has a nominal ceiling of 48 availability reads per continuously awake day; failures/rest/OS delays can reduce delivery. No catch-up burst. mock cannot activate daemon/launchd scheduling. Real-file provider scheduling is possible only after actual permission is obtained and entered. This delivery has no enabled scheduler or authorized provider. Notification test is a distinct explicit operation, never automatically sent for fixtures.

## Verification and limitations

Final suite: **67 tests, 67 pass, 0 fail**, also passed with `TZ=America/Los_Angeles` and `TZ=Asia/Shanghai`. Upstream baseline: 138/138. New tests replace tests for removed browser automation, so the counts do not imply equivalent extension feature coverage. No npm dependency installation was needed. Executed deterministic availability demo and booking demo; Python installer syntax compiled successfully. Notification HTTP calls were injected test doubles; no actual push was sent. No live provider/booking API, browser automation, macOS Keychain call or launchd service was exercised on this Linux executor. Test logs are delivered separately.

Important residual limits: local files and authorization records are trusted user-controlled data; config validation cannot create real permission or verify provider truthfulness. A process kill can leave a stale lock requiring careful manual recovery. Filesystem state and push transport cannot commit atomically, so rare crash-time duplicate pushes are possible. Full schedule guarantees require an awake machine and working service. Mock booking does not model specific times/seats, fees, appointment IDs, reschedule limits, CAPTCHA, race conditions or actual reservation success. Existing Chrome secrets/backups must be cleaned separately. No real automatic booking is implemented; when real availability is eventually enabled, official-site confirmation/booking remains manual until a separate authorized booking integration is implemented and reviewed.

## Original source preservation and fork recovery

`upstream-original.zip` preserves all 40 original tracked files, including original UI and automation code; use it for reference, not as the safe installation. `beijing-h1b.git.bundle` preserves original and modified commits and local branches. `changes.patch` applies the safe transformation to the exact upstream commit. To recover source/history locally:

```bash
git clone beijing-h1b.git.bundle visa-slot-watcher
cd visa-slot-watcher
git switch safe-beijing-h1b
# Read-only upstream view in another worktree:
git worktree add --detach ../upstream-reference 4754d0077e69b0df7546ce4314ef12cbedcec084
```

To create a remote fork later, sign into GitHub with an account/integration allowed to create forks, fork the upstream repository, add your fork as a new remote, and push `safe-beijing-h1b`. Do not push this branch to upstream origin. Current 403 is a GitHub integration permission restriction, not a failure of the local implementation.

## Subsequent delivery to user-created repository

The user supplied `https://github.com/mumuheee/beijingh1b-watchdog` for publication after the original fork request was denied. This independent repository is the publication destination. The earlier fork restriction and lack of live-provider authorization remain unchanged. Original source, history bundle, patch and logs are included under `artifacts/`; the current README and design document provide the updated handoff.
