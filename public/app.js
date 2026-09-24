// AI DBA Platform UI. Vanilla JS. Every interpolated value is HTML-escaped by the `h` tag:
// database content (object names, query text) is untrusted and must never become markup.
// Localization: t() for UI strings, te() for enumerations, tx() for server-generated text (see i18n.js).
import { LANG, setLang, locale, t, te, tx, tConfidence } from './i18n.js';

const $ = (s) => document.querySelector(s);
class Raw { constructor(s) { this.s = s; } }
const raw = (s) => new Raw(s);
const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const h = (strings, ...vals) => raw(strings.reduce((out, s, i) => out + s + (i < vals.length ? fmt(vals[i]) : ''), ''));
const fmt = (v) => (v instanceof Raw ? v.s : Array.isArray(v) ? v.map(fmt).join('') : esc(v));
const json = (v) => JSON.stringify(v, null, 2);
const n = (v) => (typeof v === 'number' ? v.toLocaleString(locale()) : v);
const ago = (iso) => (iso ? new Date(iso).toLocaleTimeString(locale()) : '-');
const analysisLanguage = () => (LANG === 'es' ? 'Spanish' : 'English');

const S = { state: null, tab: (location.hash.slice(1) || 'overview'), selFinding: null, selChange: null, audit: [], auditVerify: null, busy: null, identities: [] };

function actor() { return $('#actor').value; }
async function api(method, path, body) {
  const r = await fetch(path, { method, headers: { 'content-type': 'application/json', 'x-actor': actor() }, body: body ? JSON.stringify(body) : undefined });
  const data = await r.json();
  if (!r.ok) throw new Error(data.error || `HTTP ${r.status}`);
  return data;
}
function toast(msg, ms = 4200) { const el = $('#toast'); el.textContent = msg; el.classList.remove('hidden'); clearTimeout(el._h); el._h = setTimeout(() => el.classList.add('hidden'), ms); }
async function run(label, fn) {
  S.busy = label; render();
  try { await fn(); } catch (e) { toast(`✕ ${tx(e.message)}`, 7000); }
  S.busy = null; await refresh();
}
async function refresh() {
  S.state = await api('GET', '/api/state');
  // Full assessment (raw evidence) is fetched once per assessment id.
  if (S.state.assessment && S.full?.id !== S.state.assessment.id) S.full = await api('GET', `/api/assessments/${S.state.assessment.id}`);
  if (S.tab === 'audit') { S.audit = await api('GET', '/api/audit?limit=300'); }
  render();
}

// ---------- chrome ----------
function renderStatic() {
  document.querySelectorAll('[data-i18n]').forEach((el) => { el.textContent = t(el.dataset.i18n); });
  const current = actor();
  $('#actor').innerHTML = S.identities.map((i) => `<option value="${esc(i.id)}">${esc(LANG === 'es' ? te(i.id) : i.name)} (${esc(i.roles.map((r) => te(r)).join(', '))})</option>`).join('');
  if (current) $('#actor').value = current;
  $('#lang').value = LANG;
}

function renderChrome() {
  const st = S.state;
  const llm = $('#llmBadge');
  llm.className = 'chip ' + (st.llm.available ? 'ok' : 'warn');
  llm.textContent = st.llm.available ? t('llm.on') : t('llm.off');
  const ab = $('#autonomyBadge');
  ab.className = 'chip accent';
  ab.textContent = st.target ? t('autonomy', { level: st.target.autonomy_level, name: te(st.target.autonomy_name) }) : t('noTarget');
  const ks = st.killSwitch;
  $('#killBtn').textContent = ks.engaged ? t('kill.release') : t('kill.engage');
  $('#killBtn').className = 'btn ' + (ks.engaged ? 'ok' : 'danger');
  const b = $('#killBanner');
  b.classList.toggle('hidden', !ks.engaged);
  if (ks.engaged) b.textContent = t('kill.banner', { by: ks.by, at: ago(ks.at), reason: ks.reason || '' });
  for (const btn of document.querySelectorAll('#tabs button')) btn.classList.toggle('active', btn.dataset.tab === S.tab);
  renderFlow();
}

function renderFlow() {
  const st = S.state;
  const tg = st.target, a = st.assessment, an = st.analysis;
  const changes = st.changes.filter((c) => c.status !== 'BLOCKED');
  const last = changes[0];
  const has = (s) => last && s.includes(last.status);
  const verified = last?.verification;
  const steps = [
    ['flow.connect', !!tg],
    ['flow.validate', tg?.permission_report?.ro?.verdict === 'OK'],
    ['flow.assess', !!a],
    ['flow.analyze', !!an],
    ['flow.plan', !!last],
    ['flow.approval', has(['APPROVED', 'EXECUTING', 'COMPLETED', 'DEGRADED', 'FAILED']) || (last?.status === 'EXPIRED' && last.decided_by)],
    ['flow.execute', has(['COMPLETED', 'DEGRADED']), has(['EXPIRED', 'FAILED'])],
    ['flow.verify', !!verified, last?.status === 'DEGRADED'],
    ['flow.audit', st.auditCount > 0],
  ];
  let currentSet = false;
  $('#flow').innerHTML = steps.map(([key, done, fail], idx) => {
    let cls = done ? 'done' : '';
    if (fail) cls = 'fail';
    else if (!done && !currentSet) { cls = 'current'; currentSet = true; }
    return `<div class="step ${cls}">${done && !fail ? '✓' : fail ? '✕' : idx + 1} · ${esc(t(key))}</div>`;
  }).join('');
}

// ---------- views ----------
const statusChip = (s) => h`<span class="chip ${s === 'HEALTHY' ? 'ok' : s === 'WARNING' ? 'warn' : s === 'CRITICAL' ? 'crit' : ''}">${te(s)}</span>`;
const sevChip = (s) => h`<span class="chip sev-${s}">${te(s)}</span>`;
const changeChip = (s) => h`<span class="chip ${['COMPLETED'].includes(s) ? 'ok' : ['PENDING_APPROVAL', 'APPROVED', 'EXECUTING'].includes(s) ? 'accent' : ['BLOCKED', 'EXPIRED', 'REJECTED', 'CANCELLED'].includes(s) ? 'warn' : 'crit'}">${te(s)}</span>`;
const busyBtn = (key, cls, onclick, disabled = false) => h`<button class="btn ${cls}" data-action="${onclick}" ${raw(disabled || S.busy ? 'disabled' : '')}>${S.busy === key ? raw('<span class="spinner"></span> ') : ''}${t(key)}</button>`;

function viewConnect() {
  const tg = S.state.target;
  if (!tg) {
    const ora = S.connectEngine === 'oracle';
    return h`<div class="panel"><h2>${t('connect.title')}</h2>
      <div class="kv">
        <div>${t('connect.engine')}</div><div><select id="engine"><option value="postgresql" ${raw(ora ? '' : 'selected')}>${t('connect.pgAvail')}</option><option value="oracle" ${raw(ora ? 'selected' : '')}>${t('connect.oraAvail')}</option><option disabled>${t('connect.planned', { engine: 'Microsoft SQL Server' })}</option><option disabled>${t('connect.planned', { engine: 'MySQL' })}</option></select></div>
        <div>${t('connect.name')}</div><div><input id="tname" value="${ora ? t('connect.defaultNameOra') : t('connect.defaultName')}" /></div>
        <div>${t('connect.endpoint')}</div><div class="mono">${ora ? 'ORA_LAB_HOST:ORA_LAB_PORT / ORA_LAB_SERVICE (.env)' : '127.0.0.1:55432 / shopdb'}</div>
        <div>${t('connect.ro')}</div><div class="mono">${ora ? 'AIDBA_RO' : 'dba_agent_ro'} · ${t('connect.secret')}: ${ora ? 'env:ORA_AGENT_RO_PASSWORD' : 'env:DBA_AGENT_RO_PASSWORD'}</div>
        <div>${t('connect.exec')}</div><div class="mono">${ora ? 'AIDBA_EXEC (EXECUTE on AIDBA_SHOP.DBA_MAINT only)' : 'dba_agent_exec'} · ${t('connect.secret')}: ${ora ? 'env:ORA_AGENT_EXEC_PASSWORD' : 'env:DBA_AGENT_EXEC_PASSWORD'}</div>
        <div>${t('connect.autonomy')}</div><div>${t('connect.autonomyVal')}</div>
      </div>
      <p class="small muted">${t('connect.secretsNote')}</p>
      <div class="btn-row">${busyBtn('connect.btn', 'primary', 'connect')}</div></div>`;
  }
  const pr = tg.permission_report;
  if (!pr) return h`<div class="panel"><h2>${t('validate.title')}</h2><p>${t('validate.text')}</p><div class="btn-row">${busyBtn('validate.btn', 'primary', 'validate')}</div></div>`;
  return h`<div class="panel"><h2>${t('instance')} · ${tx(tg.name)} <span class="muted small">${tg.engine} ${tg.server_version} · ${tg.host}:${tg.port}/${tg.database} · ${t('validatedAt', { at: ago(tg.validated_at) })}</span></h2>
    <div class="grid g2">${[pr.ro, pr.exec].map((r) => h`<div>
      <h3>${r.identity === 'ro' ? t('ident.ro') : t('ident.exec')} · <span class="mono">${r.user}</span> ${r.verdict === 'OK' ? h`<span class="chip ok">${t('verified')}</span>` : h`<span class="chip crit">${t('refused')}</span>`}</h3>
      ${r.checks.map((c) => h`<div class="check"><span class="mark ${c.ok ? 'ok' : 'no'}">${c.ok ? '✓' : '✕'}</span><span>${tx(c.description)} <span class="muted mono">${JSON.stringify(c.observed)}</span></span></div>`)}
      <div class="small muted" style="margin-top:6px">${t('capabilities')}: <span class="mono">${r.capabilities.map(tx).join(' · ')}</span></div></div>`)}</div></div>`;
}

function dimClass(d) { if (d.status !== 'SCORED') return 'unk'; return d.score >= 80 ? 'ok' : d.score >= 50 ? 'warn' : 'crit'; }

function viewOverview() {
  const st = S.state, a = st.assessment;
  const parts = [viewConnect()];
  if (st.target?.permission_report?.ro?.verdict === 'OK') {
    parts.push(h`<div class="panel"><h2>${t('assess.title')}</h2>
      <p class="muted small">${t('assess.text')}</p>
      <div class="btn-row">${busyBtn(a ? 'assess.rerun' : 'assess.run', 'primary', 'assess')}</div></div>`);
  }
  if (a) {
    const s = a.score;
    parts.push(h`<div class="panel"><h2>${t('health.title')} <span class="muted small">${t('health.at', { at: ago(a.finished_at) })}</span></h2>
      <div class="score"><div class="big ${s.status === 'HEALTHY' ? 'is-ok' : s.status === 'WARNING' ? 'is-warn' : s.status === 'CRITICAL' ? 'is-crit' : ''}">${s.overall ?? '—'}<span class="of">/100</span></div><div>${statusChip(s.status)}<div class="small muted" style="margin-top:6px">${t('health.coverage', { scored: s.coverage.scored, total: s.coverage.total })}${s.coverage.unknown.length ? ' · ' + te('UNKNOWN') + ': ' + s.coverage.unknown.map(te).join(', ') : ''}${s.coverage.notConfigured.length ? ' · ' + te('NOT_CONFIGURED') + ': ' + s.coverage.notConfigured.map(te).join(', ') : ''}</div></div></div>
      <details style="margin:8px 0"><summary>${t('health.how')}</summary><p class="small mono">${tx(s.formula)}</p></details>
      <div class="grid g4">${s.dimensions.map((d) => h`<div class="dim ${dimClass(d)}"><div class="name">${te(d.dimension)}</div>
        <div class="val">${d.status === 'SCORED' ? d.score : te(d.status)}</div>
        ${d.penalties.map((pp) => h`<div class="small">${sevChip(pp.severity)} −${pp.penalty} ${tx(pp.title)}</div>`)}
        ${d.status === 'SCORED' && !d.penalties.length ? h`<div class="small muted">${t('health.noRule')}</div>` : ''}
        ${d.coverageNote ? h`<div class="small muted" style="margin-top:4px">${tx(d.coverageNote)}</div>` : ''}</div>`)}</div></div>`);
    const pending = st.changes.filter((c) => ['PENDING_APPROVAL', 'APPROVED'].includes(c.status));
    parts.push(h`<div class="grid g2">
      <div class="panel"><h2>${t('findings.title', { n: a.findings.length })}</h2>${a.findings.map((f) => h`<div class="check">${sevChip(f.severity)}<span>${tx(f.title)}</span></div>`)}
        <div class="btn-row"><button class="btn" data-tab-go="findings">${t('findings.open')}</button></div></div>
      <div class="panel"><h2>${t('pending.title', { n: pending.length })}</h2>${pending.length ? pending.map((c) => h`<div class="check">${changeChip(c.status)}<span>#${c.number} ${c.plan.command}</span></div>`) : h`<p class="muted">${t('none')}</p>`}
        <h2 style="margin-top:14px">${t('alerts.title')}</h2>${st.notifications.length ? st.notifications.slice(0, 5).map((x) => h`<div class="check">${sevChip(x.severity)}<span>${tx(x.subject)} <span class="muted small">${ago(x.ts)} · ${tx(x.delivery)}</span></span></div>`) : h`<p class="muted">${t('alerts.none')}</p>`}</div></div>`);
  }
  return parts;
}

function evidenceById(id) { return S.full?.evidence.find((e) => e.id === id); }

function viewFindings() {
  const a = S.state.assessment, an = S.state.analysis?.output;
  if (!a) return h`<div class="panel"><p>${t('needAssessment')}</p></div>`;
  const f = a.findings.find((x) => x.id === S.selFinding) ?? a.findings[0];
  if (f) S.selFinding = f.id;
  const item = an?.analyses.find((x) => x.finding_id === f?.id);
  const genLang = an?.language ?? 'English';
  const mismatch = an && an.mode === 'LLM' && genLang !== analysisLanguage();
  const aiHeader = !an
    ? h`<div class="panel"><h2>${t('ai.title')}</h2><p class="muted small">${t('ai.text')}</p><div class="btn-row">${busyBtn('ai.run', 'primary', 'analyze')}</div></div>`
    : h`<div class="panel"><h2>${t('ai.header')} <span class="chip ${an.mode === 'LLM' ? 'ok' : 'warn'}">${an.mode === 'LLM' ? 'LLM · ' + (S.state.analysis.model ?? '') : t('ai.ruleBased')}</span> ${S.state.analysis.grounded ? h`<span class="chip ok">${t('ai.grounded')}</span>` : h`<span class="chip crit">${t('ai.issues')}</span>`}</h2>
        ${an.fallback_reason ? h`<div class="callout warn">${tx(an.fallback_reason)}</div>` : ''}
        ${mismatch ? h`<div class="callout warn">${t('ai.langMismatch', { lang: t('lang.' + genLang) })} ${busyBtn('ai.regen', '', 'analyze')}</div>` : ''}
        <div class="kv"><div>${t('ai.summary')}</div><div>${tx(an.executive_summary)}</div><div>${t('ai.rootCause')}</div><div>${tx(an.root_cause_hypothesis)}</div>
        ${an.mode === 'LLM' ? h`<div>${t('ai.cost')}</div><div class="mono">${t('ai.costVal', { inp: S.state.analysis.input_tokens, out: S.state.analysis.output_tokens, ms: S.state.analysis.latency_ms, usd: Number(S.state.analysis.cost_usd ?? 0).toFixed(4) })}</div>` : ''}</div>
        <div class="btn-row">${busyBtn('ai.rerun', '', 'analyze')}</div></div>`;
  return [aiHeader, h`<div class="split">
    <div class="list">${a.findings.map((x) => h`<div class="item ${x.id === f?.id ? 'sel' : ''}" data-finding="${x.id}">${sevChip(x.severity)} <span class="chip">${te(x.dimension)}</span><div class="t">${tx(x.title)}</div><div class="small muted mono">${x.rule_id}</div></div>`)}</div>
    <div>${f ? viewFindingChain(f, item) : ''}</div></div>`];
}

function viewFindingChain(f, item) {
  const existing = S.state.changes.find((c) => c.finding_id === f.id && !['REJECTED', 'CANCELLED', 'EXPIRED'].includes(c.status));
  const act = item?.proposed_action;
  const cand = f.candidate_actions;
  return h`<div class="chain">
    <div class="link"><div class="label">${t('chain.finding', { rule: f.rule_id })}</div><div><b>${tx(f.title)}</b> ${sevChip(f.severity)}</div><p>${tx(f.detail)}</p></div>
    <div class="link"><div class="label">${t('chain.evidence')}</div>
      <table><tbody>${Object.entries(f.facts).filter(([k]) => k !== 'plan').map(([k, v]) => h`<tr><th>${k}</th><td class="mono">${typeof v === 'object' ? JSON.stringify(v) : n(v)}</td></tr>`)}</tbody></table>
      ${f.facts.plan ? h`<h3>${t('chain.plan')}</h3><pre>${f.facts.plan.join('\n')}</pre>` : ''}
      <details><summary>${t('chain.raw', { n: f.evidence_ids.length })}</summary>${f.evidence_ids.map((id) => { const e = evidenceById(id); return e ? h`<div class="small muted" style="margin-top:6px">${id} · ${t('chain.source')}: <span class="mono">${e.source}</span></div><pre>${json(e.data)}</pre>` : h`<div class="small mono">${id}</div>`; })}</details></div>
    <div class="link"><div class="label">${t('chain.analysis')}</div>
      ${!item ? h`<p class="muted">${t('chain.notAnalyzed')}</p>` : h`<div class="kv"><div>${t('chain.what')}</div><div>${tx(item.what)}</div><div>${t('chain.why')}</div><div>${tx(item.why)}</div><div>${t('chain.impact')}</div><div>${tx(item.impact)}</div><div>${t('chain.recommendation')}</div><div>${tx(item.recommendation)}</div><div>${t('chain.confidence')}</div><div>${tConfidence(item.confidence)}</div><div>${t('chain.cited')}</div><div class="mono small">${item.evidence_cited.join(', ')}</div></div>
        ${item.validation.issues.length ? h`<div class="callout crit small">${item.validation.issues.map(tx).join(' · ')}</div>` : ''}
        ${item.validation.ungrounded_numbers.length ? h`<div class="callout warn small">${t('chain.ungrounded', { nums: item.validation.ungrounded_numbers.join(', ') })}</div>` : ''}`}</div>
    <div class="link"><div class="label">${t('chain.action')}</div>
      ${act ? h`<div class="mono"><b>${act.action_id}</b>(${JSON.stringify(act.params)})</div><p class="small">${tx(act.justification)}</p>` : cand.length ? h`<p class="muted">${t('chain.candidates')} <span class="mono">${cand.map((c) => c.actionId + JSON.stringify(c.params)).join(', ')}</span>${item ? t('chain.notSelected') : ''}</p>` : h`<p class="muted">${t('chain.noAction')}</p>`}
      ${act ? (existing ? h`<div class="btn-row"><button class="btn" data-change="${existing.id}">${t('chain.openChange', { n: existing.number, status: te(existing.status) })}</button></div>` : h`<div class="btn-row">${busyBtn('chain.create', 'primary', 'propose')}</div>`) : ''}</div>
  </div>`;
}

function viewChanges() {
  const list = S.state.changes;
  if (!list.length) return h`<div class="panel"><p>${t('changes.none')}</p></div>`;
  const c = list.find((x) => x.id === S.selChange) ?? list[0];
  S.selChange = c.id;
  return h`<div class="split">
    <div class="list">${list.map((x) => h`<div class="item ${x.id === c.id ? 'sel' : ''}" data-change="${x.id}">${changeChip(x.status)} ${sevChip(x.risk)}<div class="t">#${x.number} ${x.action_id}</div><div class="small mono muted">${x.plan.command}</div></div>`)}</div>
    <div>${viewChange(c)}</div></div>`;
}

function viewChange(c) {
  const est = c.plan.estimate || {};
  const pre = c.preconditions?.checks || [];
  const canDecide = c.status === 'PENDING_APPROVAL';
  const canExec = c.status === 'APPROVED';
  const exp = c.expires_at ? Math.round((Date.parse(c.expires_at) - Date.now()) / 60000) : null;
  const decidedKey = c.status === 'REJECTED' ? 'change.rejectedBy' : c.status === 'CANCELLED' ? 'change.cancelledBy' : 'change.approvedBy';
  const policyChip = c.policy.decision === 'DENIED' ? h`<span class="chip crit">${te('DENIED')}</span>` : c.policy.decision === 'AUTO' ? h`<span class="chip ok">${te('AUTO')}</span>` : h`<span class="chip accent">${te('REQUIRES_APPROVAL')}</span>`;
  const [lvl, ...autoName] = String(c.policy.autonomy).split(' ');
  return [h`<div class="panel"><h2>${t('change.title', { n: c.number, action: tx(c.plan.action) })} ${changeChip(c.status)}</h2>
    ${c.refused || c.error ? h`<div class="callout crit"><b>${tx(c.error)}</b></div>` : ''}
    <div class="kv">
      <div>${t('change.action')}</div><div class="mono">${c.action_id}(${JSON.stringify(c.params)})</div>
      <div>${t('change.target')}</div><div>${tx(c.plan.target)}</div>
      <div>${t('change.why')}</div><div>${tx(c.rationale) || '—'}</div>
      <div>${t('change.evidence')}</div><div class="small mono">finding ${c.finding_id} · assessment ${c.assessment_id} · analysis ${c.analysis_id}</div>
      <div>${t('change.benefit')}</div><div>${t('change.benefitVal')}</div>
      <div>${t('change.risk')}</div><div>${sevChip(c.risk)} ${c.plan.reversible ? t('change.reversible') : t('change.irreversible')}</div>
      <div>${t('change.duration')}</div><div>${tx(est.expected_duration) || '—'} <span class="muted small">${tx(est.method)}</span></div>
      <div>${t('change.resources')}</div><div>${est.pages_to_read_upper_bound != null ? t('change.resourcesVal', { pages: n(est.pages_to_read_upper_bound), relpages: n(est.relpages), rows: n(est.sample_rows), target: est.default_statistics_target, mod: String(est.data_modified) }) : '—'}<div class="small muted">${tx(c.plan.lock_impact)}</div></div>
      <div>${t('change.command')}</div><div><pre>${c.plan.command}</pre><span class="small muted">${t('change.commandNote')} <span class="mono">${c.plan.identity}</span> · statement_timeout ${c.plan.timeouts.statement_timeout_ms} ms · lock_timeout ${c.plan.timeouts.lock_timeout_ms} ms</span></div>
      <div>${t('change.rollback')}</div><div>${tx(c.plan.rollback)}</div>
      <div>${t('change.preconditions')}</div><div>${pre.map((x) => h`<div class="check"><span class="mark ${x.ok ? 'ok' : 'no'}">${x.ok ? '✓' : '✕'}</span><span>${tx(x.description)} <span class="muted mono small">${JSON.stringify(x.observed)}</span></span></div>`)}
        <div class="small muted">${t('change.fingerprint')} <span class="mono">${String(c.fingerprint).slice(0, 16)}…</span></div></div>
      <div>${t('change.validation')}</div><div>${tx(c.plan.validation)}</div>
      <div>${t('change.policy')}</div><div>${policyChip} <span class="small muted">${t('change.autonomy', { a: `${lvl} ${te(autoName.join('_'))}` })}</span>${c.policy.reasons.map((r) => h`<div class="small">• ${tx(r)}</div>`)}</div>
      <div>${t('change.approval')}</div><div>${c.decided_by ? h`${t(decidedKey)} <b>${c.decided_by}</b> ${t('change.at', { at: ago(c.decided_at) })}${c.decision_note ? ' — “' + c.decision_note + '”' : ''}${exp != null && c.status === 'APPROVED' ? t('change.expiresIn', { m: exp }) : ''}` : c.status === 'BLOCKED' ? t('change.blockedNote') : h`${t('change.required')} <span class="mono">${c.requested_by}</span>`}</div>
    </div>
    <div class="btn-row">
      ${busyBtn('btn.approve', 'ok', 'approve', !canDecide)}
      ${busyBtn('btn.reject', '', 'reject', !canDecide)}
      ${busyBtn('btn.evidence', '', 'evidence', !canDecide)}
      <button class="btn" disabled title="${t('notInScope')}">${t('btn.modify')}</button>
      <button class="btn" disabled title="${t('notInScope')}">${t('btn.schedule')}</button>
      ${busyBtn('btn.execute', 'primary', 'execute', !canExec)}
      ${busyBtn('btn.cancel', '', 'cancel', !['PENDING_APPROVAL', 'APPROVED'].includes(c.status))}
    </div></div>`,
    c.result?.steps ? h`<div class="panel"><h2>${t('timeline.title')}</h2>${c.result.steps.map((s) => h`<div class="check"><span class="mark ${s.ok ? 'ok' : 'no'}">${s.ok ? '✓' : '✕'}</span><span><b>${te(s.step)}</b> <span class="muted small">${ago(s.at)}</span>
      ${s.step === 'revalidate_preconditions' || s.step === 'PRECONDITIONS_CHANGED' ? h`<details><summary>${t('timeline.states')}</summary><pre>${json(s.detail)}</pre></details>` : s.step === 'executed' ? h`<div class="small mono">${s.detail.command} · ${s.detail.identity} · ${t('timeline.server')}: ${s.detail.server_tag} · ${s.detail.duration_ms} ms</div>` : ''}</span></div>`)}</div>` : '',
    c.verification ? viewVerification(c) : ''];
}

function viewVerification(c) {
  const v = c.verification, b = c.baseline, a = c.after;
  const pb = b.probes[0], pa = a.probes[0];
  const max = Math.max(pb?.medianMs ?? 0, pa?.medianMs ?? 0, 1);
  const cls = v.outcome === 'IMPROVED' ? 'ok' : v.outcome === 'DEGRADED' ? 'crit' : 'warn';
  // Only categorical columns (small n_distinct) whose set of common values changed; new values are highlighted.
  const vals = (s) => (s ? s.replace(/^\{|\}$/g, '').split(',') : []);
  const statsRows = (b.columnStats ?? []).map((cb) => ({ b: cb, a: (a.columnStats ?? []).find((x) => x.attname === cb.attname) }))
    .filter((r) => r.a && Number(r.a.n_distinct) > 0 && Number(r.a.n_distinct) <= 50 && r.b.most_common_vals !== r.a.most_common_vals)
    .map((r) => ({ ...r, added: vals(r.a.most_common_vals).filter((x) => !vals(r.b.most_common_vals).includes(x)) }));
  return h`<div class="panel"><h2>${t('verif.title')} <span class="chip ${cls}">${te(v.outcome)}</span></h2>
    <div class="callout ${cls}">${tx(v.summary)}</div>
    ${pb && pa ? h`<div class="panel" style="background:var(--panel-2)"><h3 style="margin-top:0">${t('report.title')}</h3>
      <p class="small muted">${t('report.text')}</p>
      <div class="btn-row" style="align-items:center">
        <label class="small">${t('report.runs')} <input id="rpRuns" type="number" min="0" step="1" placeholder="${t('report.optional')}" style="width:110px" /></label>
        <label class="small">${t('report.cost')} <input id="rpCost" type="number" min="0" step="0.01" placeholder="${t('report.optional')}" style="width:110px" /></label>
        ${busyBtn('report.download', 'primary', 'report')}
        <a class="btn" href="/report.html?change=${c.id}" target="_blank" rel="noopener" style="text-decoration:none">${t('report.printable')}</a>
      </div></div>` : ''}
    ${pb && pa ? h`<h3>${t('verif.probe', { name: pb.name, n: pb.runsMs.length })}</h3>
      <div class="bars">
        <div class="bar"><span>${t('verif.before')}</span><div class="track"><div class="fill" style="width:${(pb.medianMs / max) * 100}%"></div></div><span class="mono">${n(pb.medianMs)} ms</span></div>
        <div class="bar"><span>${t('verif.after')}</span><div class="track"><div class="fill after" style="width:${(pa.medianMs / max) * 100}%"></div></div><span class="mono">${n(pa.medianMs)} ms</span></div>
      </div>
      <div class="small muted">${t('verif.runs', { b: pb.runsMs.map(n).join(' / '), a: pa.runsMs.map(n).join(' / '), slo: n(pb.sloMs) })}</div>
      <div class="grid g2" style="margin-top:8px"><div><h3>${t('verif.planBefore')}</h3><pre>${pb.planShape.join('\n')}</pre></div><div><h3>${t('verif.planAfter')}</h3><pre>${pa.planShape.join('\n')}</pre></div></div>` : h`<p class="muted">${t('verif.noProbe')}</p>`}
    <h3>${t('verif.checks')}</h3><table><thead><tr><th></th><th>${t('verif.check')}</th><th>${t('verif.before')}</th><th>${t('verif.after')}</th></tr></thead><tbody>${v.checks.map((x) => h`<tr><td><span class="mark ${x.ok ? 'ok' : 'no'}">${x.ok ? '✓' : '✕'}</span></td><td>${tx(x.description)}</td><td class="mono">${n(x.before)}</td><td class="mono">${n(x.after)}</td></tr>`)}</tbody></table>
    ${statsRows.length ? h`<h3>${t('verif.stats')}</h3><table><thead><tr><th>${t('verif.column')}</th><th>${t('verif.before')}</th><th>${t('verif.after')}</th></tr></thead><tbody>${statsRows.map((r) => h`<tr><td class="mono">${r.b.attname}</td><td class="mono">${r.b.most_common_vals ?? '∅'} ${r.b.most_common_freqs ?? ''}</td><td class="mono">${r.a.most_common_vals ?? '∅'} ${r.a.most_common_freqs ?? ''} ${r.added.map((x) => h`<span class="chip ok">${t('verif.new', { v: x })}</span> `)}</td></tr>`)}</tbody></table>` : ''}
  </div>`;
}

function viewAssessment() {
  const full = S.full;
  if (!full) return h`<div class="panel"><p>${t('needAssessment')}</p></div>`;
  return [h`<div class="panel"><h2>${t('col.title')} <span class="muted small">${t('col.sub', { user: S.state.target.ro_user })}</span></h2>
    <table><thead><tr><th>${t('col.collector')}</th><th>${t('col.status')}</th><th>${t('col.duration')}</th><th>${t('col.dimensions')}</th><th>${t('col.evidence')}</th></tr></thead><tbody>
    ${full.collector_runs.map((r) => h`<tr><td class="mono">${r.collector}</td><td><span class="chip ${r.status === 'ok' ? 'ok' : r.status === 'skipped' ? '' : 'crit'}">${te(r.status)}</span> ${r.error ? h`<span class="small muted">${tx(r.error)}</span>` : ''}</td><td class="num">${r.ms} ms</td><td class="small">${r.dimensions.map(te).join(', ')}</td><td class="small mono">${r.evidenceIds.join(', ')}</td></tr>`)}</tbody></table></div>`,
    h`<div class="panel"><h2>${t('col.raw', { n: full.evidence.length })}</h2>${full.evidence.map((e) => h`<details><summary>${e.collector} · ${e.id} · <span class="mono">${e.source}</span></summary><pre>${json(e.data)}</pre></details>`)}</div>`];
}

function viewAudit() {
  const v = S.auditVerify;
  return h`<div class="panel"><h2>${t('audit.title')} <span class="muted small">${t('audit.sub')}</span></h2>
    <div class="btn-row">${busyBtn('audit.verify', '', 'verifyAudit')} ${v ? (v.valid ? h`<span class="chip ok">${t('audit.valid', { n: v.events })}</span>` : h`<span class="chip crit">${t('audit.broken', { at: v.brokenAt, reason: v.reason })}</span>`) : ''}</div>
    <table style="margin-top:10px"><thead><tr><th>#</th><th>${t('audit.when')}</th><th>${t('audit.actor')}</th><th>${t('audit.event')}</th><th>${t('audit.change')}</th><th>${t('audit.hash')}</th></tr></thead><tbody>
    ${S.audit.map((e) => h`<tr><td class="num">${e.seq}</td><td class="small">${new Date(e.ts).toLocaleString(locale())}</td><td class="mono small">${e.actor}</td><td><details><summary>${e.event_type}</summary><pre>${json(e.payload)}</pre></details></td><td class="mono small">${e.change_id ?? ''}</td><td class="mono small" title="prev ${e.prev_hash}">${String(e.hash).slice(0, 12)}…</td></tr>`)}</tbody></table></div>`;
}

function render() {
  if (!S.state) return;
  renderChrome();
  const views = { overview: viewOverview, findings: viewFindings, changes: viewChanges, assessment: viewAssessment, audit: viewAudit };
  const out = views[S.tab]();
  $('#main').innerHTML = fmt(out);
}

// ---------- actions ----------
const actions = {
  connect: () => run('connect.btn', async () => {
    const tg = await api('POST', '/api/targets', { name: $('#tname').value, engine: $('#engine').value });
    await api('POST', `/api/targets/${tg.id}/validate`);
    toast(t('toast.connected'));
  }),
  validate: () => run('validate.btn', async () => { await api('POST', `/api/targets/${S.state.target.id}/validate`); }),
  assess: () => run(S.state.assessment ? 'assess.rerun' : 'assess.run', async () => {
    const a = await api('POST', `/api/targets/${S.state.target.id}/assessments`);
    toast(t('toast.assessed', { n: a.findings.length, score: a.score.overall, status: te(a.score.status) }));
  }),
  analyze: () => run(S.state.analysis ? 'ai.rerun' : 'ai.run', async () => {
    const r = await api('POST', `/api/assessments/${S.state.assessment.id}/analysis`, { language: analysisLanguage() });
    toast(r.mode === 'LLM' ? t('toast.aiDone', { model: r.meta.model, ms: n(r.meta.latencyMs) }) : t('toast.aiOff'));
  }),
  propose: () => run('chain.create', async () => {
    const c = await api('POST', `/api/analyses/${S.state.analysis.id}/proposals`, { findingId: S.selFinding });
    S.selChange = c.id; S.tab = 'changes';
    toast(t('toast.change', { n: c.number, status: te(c.status) }));
  }),
  approve: () => run('btn.approve', async () => { await api('POST', `/api/changes/${S.selChange}/approve`, { note: prompt(t('prompt.approve')) ?? '' }); toast(t('toast.approved')); }),
  reject: () => run('btn.reject', async () => { await api('POST', `/api/changes/${S.selChange}/reject`, { note: prompt(t('prompt.reject')) ?? '' }); }),
  evidence: () => run('btn.evidence', async () => { await api('POST', `/api/changes/${S.selChange}/evidence`, { note: t('evidence.note') }); toast(t('toast.evidence')); }),
  cancel: () => run('btn.cancel', async () => { await api('POST', `/api/changes/${S.selChange}/cancel`, {}); }),
  execute: () => run('btn.execute', async () => {
    const r = await api('POST', `/api/changes/${S.selChange}/execute`);
    toast(r.refused ? `✕ ${tx(r.refused)}` : t('toast.exec', { status: te(r.status), outcome: te(r.verification?.outcome ?? '') }), 7000);
  }),
  report: () => run('report.download', async () => {
    const body = { runsPerDay: $('#rpRuns').value || null, costPerUserHourUsd: $('#rpCost').value || null };
    const r = await fetch(`/api/changes/${S.selChange}/report`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-actor': actor() }, body: JSON.stringify(body) });
    if (!r.ok) throw new Error((await r.json()).error || `HTTP ${r.status}`);
    const blob = await r.blob();
    const name = /filename="([^"]+)"/.exec(r.headers.get('content-disposition') || '')?.[1] || 'AI-DBA-report.pdf';
    const a = Object.assign(document.createElement('a'), { href: URL.createObjectURL(blob), download: name });
    document.body.append(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 10_000);
    toast(t('report.done', { name }));
  }),
  verifyAudit: () => run('audit.verify', async () => { S.auditVerify = await api('GET', '/api/audit/verify'); }),
};

document.addEventListener('click', (e) => {
  const el = e.target.closest('[data-action],[data-finding],[data-change],[data-tab],[data-tab-go]');
  if (!el) return;
  if (el.dataset.action) return actions[el.dataset.action]?.();
  if (el.dataset.finding) { S.selFinding = el.dataset.finding; return render(); }
  if (el.dataset.change) { S.selChange = el.dataset.change; S.tab = 'changes'; return render(); }
  const tab = el.dataset.tab || el.dataset.tabGo;
  if (tab) { S.tab = tab; history.replaceState(null, '', '#' + tab); refresh(); }
});

$('#killBtn').addEventListener('click', () => run('kill', async () => {
  const engaged = !S.state.killSwitch.engaged;
  const reason = engaged ? prompt(t('kill.prompt'), t('kill.default')) : t('kill.released');
  if (engaged && reason === null) return;
  await api('POST', '/api/kill-switch', { engaged, reason, cancelPending: engaged && confirm(t('kill.cancelPending')) });
}));

$('#lang').addEventListener('change', (e) => { setLang(e.target.value); renderStatic(); render(); });
// Engine selector in the registration form re-renders the endpoint / identity rows for that engine.
document.addEventListener('change', (e) => { if (e.target.id === 'engine') { S.connectEngine = e.target.value; render(); } });

(async function init() {
  setLang(LANG);
  S.identities = await (await fetch('/api/identities')).json();
  renderStatic();
  $('#actor').addEventListener('change', render);
  await refresh();
})();
