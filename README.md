# AI DBA Platform — Build Day vertical slice

An AI DBA agent that **observes, assesses, analyzes, recommends, asks for approval, executes, verifies and audits**,
on a real PostgreSQL 17 lab. It is not a chatbot: the LLM reasons over deterministic evidence, and its output can
only select a closed-catalog action. Every other step is code: policy, approval, execution, verification and audit.

```
Collectors (RO identity) → Rules → Findings + Evidence → Health score (explainable)
      → LLM analysis (redacted facts, closed JSON schema, groundedness checks)
      → Action catalog (typed, deterministic SQL) → Policy engine → Human approval (fingerprint + TTL)
      → Kill switch + change lock + revalidation (TOCTOU) → Executor (EXEC identity, timeouts)
      → Verification (baseline vs after) → Hash-chained append-only audit → Alerts (outbox)
```

## Run it

Requirements: Node ≥ 22.18. PostgreSQL 17 binaries: the scripts use `C:\Program Files\PostgreSQL\17\bin`
read-only, or whatever `PG_BIN` points to. The existing installation and its data directory are never touched.

```powershell
npm install
npm run lab:init        # first time only: isolated cluster in ./lab/pgdata on 127.0.0.1:55432, seed, workload
npm start               # http://127.0.0.1:8787
```

Optional, to enable the AI analysis: add `ANTHROPIC_API_KEY=...` to `.env` (git-ignored), then restart.
Without a key the platform works and says clearly that no AI analysis was generated.
Model routing and prices are in `config/models.json`. `ANALYSIS_LANGUAGE=Spanish` switches the language of the analysis.

Reset between demos: stop the server, then `npm run demo:reset` and `npm start`.

## Demo script (≈6 min)

1. **Overview → Connect in READ ONLY mode.** Both identities are verified *on the server*:
   - `dba_agent_ro`: read-only transactions, no DML/DDL, `pg_monitor`;
   - `dba_agent_exec`: only `MAINTAIN` (PostgreSQL 17), cannot read data or run ALTER.
2. **Run DBA assessment.** 14 collectors, about 3 s. Health 87 · WARNING with coverage 7/8; Replication is shown
   as NOT CONFIGURED, not "healthy". Backups coverage is partial and says why.
3. **Findings & Analysis.** Open *Row misestimate 150,000x*: the evidence shows the real `EXPLAIN ANALYZE` plan
   (estimated 1 row, actual 150,000). Then open *Stale statistics* and *Autovacuum disabled*.
4. **Run AI analysis.** The model correlates the three findings (autovacuum off → stale stats → bad plan) and picks
   `analyze_table(public, orders)`. Point out: cited evidence ids, the "grounded" badge, tokens/cost.
5. **Create change plan.** Change #N appears with ACTION / WHY / EVIDENCE / RISK / DURATION / RESOURCE IMPACT /
   COMMAND / ROLLBACK (honest: none for statistics) / PRECONDITIONS / POLICY. Note that `set_table_autovacuum`
   is **BLOCKED**: MEDIUM risk at autonomy RECOMMEND, and the exec identity does not own the table.
6. **Approve** as DBA Lead. Switching to *IT Manager* or *DBA On-call* shows that they cannot approve.
7. *(Optional, TOCTOU)*: run `npm run lab:tamper` in a terminal, then **Execute** → *"Preconditions changed.
   Approval expired."*. To recover: `npm run demo:reset`.
8. **Execute.** Timeline: lock → revalidate → policy re-check → baseline → `ANALYZE` → after → verify.
   Before/after: latency measured live (before varied 610–1,320 ms across runs depending on machine load; after ~230–265 ms),
   so quote the numbers on screen, not fixed ones. Misestimate 150,000x → ~2x, the plan changes from
   nested loop to hash join, and `pg_stats` for `status` now includes `pending`.
9. **Business report (PDF).** In the verified change, *Download PDF report*: a Spanish, manager-friendly PDF with
   MEDIDO (measured), DERIVADO (arithmetic on measured values) and SUPUESTO (business inputs typed by a person,
   printed with their name) numbers kept apart. Without business inputs, no money figure is produced.
10. **Audit → Verify hash chain.** Every step is reconstructed, with actor, evidence, fingerprints and command.
10. **EMERGENCY STOP.** Blocks every execution, and can cancel pending changes.

## What is real and what is not (Build Day)

| Real | Not built yet |
|---|---|
| PostgreSQL 17 adapter, 14 collectors, 14 rules | SQL Server / Oracle / MySQL adapters (the `EngineAdapter` interface is ready) |
| Permission validation against the server | Real login/SSO (simulated identities with enforced roles) |
| Closed catalog: `analyze_table` (LOW), `set_table_autovacuum` (MEDIUM) | Modify / Schedule change, maintenance windows |
| Policy matrix autonomy × risk, kill switch, change lock, TOCTOU | Per-target kill switch, two-person approval for CRITICAL |
| Measured before/after verification | Remote OS agents (host metrics are local-host only) |
| Hash-chained append-only audit | SMTP delivery (alerts go to `outbox/*.eml` + UI) |
| LLM analysis with redaction and groundedness checks | Evaluation dataset / scoring harness |

## Layout

```
src/core        store (SQLite), audit chain, types, utils
src/adapters    EngineAdapter + postgres/{connection, collectors, rules, probes, actions, permissions}
src/infra       InfrastructureAdapter (local host)
src/assessment  engine + explainable score
src/agent       LLM provider (model-agnostic), redaction, analyst + validation
src/actions     catalog, policy, change management / executor
src/notify      Notifier (console, outbox)
public/         UI (vanilla HTML/CSS/JS)
site/           static showcase deployed to Vercel (intro, screenshots); the platform itself runs locally
lab/ scripts/   isolated lab cluster, seed SQL, e2e test, screenshots
config/         probes (DBA-registered queries), models, identities
```

Tests: `npm run test:e2e` (full flow) and `node scripts/e2e.ts --tamper` (TOCTOU path) against a running server
and a freshly reset lab.
