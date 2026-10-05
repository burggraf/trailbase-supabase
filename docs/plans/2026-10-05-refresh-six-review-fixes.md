# Refresh review batch: all six findings, no lifecycle expansion

Read BLOCK verdict and all six findings, inspect current auth/install/clear/request and real test flows. Prior immutable acf controls remain historical; passing happy paths do not approve these races. Parent owns real runs. Actual Node22 process/report fields required.

Pre-code test matrix:
1. LoginB invocation before C refresh (same generation), then B commit before C200/C401: capture authoritative state/commit version plus generation, including same-ID/different-session; guard before/inside serialized install, after awaits and terminal clear. B memory/disk/no removal, old waiting expired data zero dispatch. Also terminal-invalidated baseline during held write must not be restored by compensation.
2. Delivered refresh401 text rejection/hold must not delay/erase terminal status. Supervisor approved fixed actual401, owned abort and nonawaited cancellation with handled rejection; no body read or hostile transport resource guarantee. Joined getSession/data error/cleanup resolves without releasing text; newer baseline protected.
3. Required own alg/sub/iat/exp in login, hydration, refresh; temporary prototype descriptors restored finally; corrupt tokens cannot alter prior good state/disk or authorize waiting requests, privacy intact.
4. Refresh success exactly200; valid201/202 failure observable with untouched C/no waiting data. Signup/login status policy unchanged.
5. Separate expired data/getSession initiates renewal without manual flight; assert one renewal/one original request/persisted new credential. Unit must fail if expiry trigger removed; genuine backend denial (80s observed grace budget) real vector also retains independent manual join.
6. Real row cleanup tracks acquired owner/ID separately from storage and token under test. Fresh genuine ordinary same-owner login, exact owned delete+absence verification; no key-absent shortcut. Inject post-expiry failure, delete/reject storage, preserve original+cleanup failures and prove row absence. Fixture teardown is not row-cleanup evidence.

No new deps/server/default fixture/repin, no relaxed security assertions. Exact-source RED/GREEN units/types/build; authored short3sec real cases pending parent runs. Full lifecycle/G1/G7/defaults/auth app/release/signoff remain incomplete.
