// Business report. Three kinds of numbers, always labelled:
//   MEDIDO     - measured on the database (EXPLAIN ANALYZE of the registered probe, before and after)
//   DERIVADO   - arithmetic on measured values only (e.g. executions per hour per connection)
//   SUPUESTO   - business inputs typed by a person (runs per day, cost per user-hour); never invented here
const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const num = (v) => (typeof v !== 'number' ? v : nf(v, Number.isInteger(v) ? 0 : 1));
const nf = (v, d = 0) => Number(v).toLocaleString('es-CO', { minimumFractionDigits: d, maximumFractionDigits: d });
const dt = (iso) => (iso ? new Date(iso).toLocaleString('es-CO', { dateStyle: 'medium', timeStyle: 'short' }) : '—');
const dur = (ms) => (ms < 1000 ? `${nf(ms, ms < 10 ? 1 : 0)} ms` : ms < 60_000 ? `${nf(ms / 1000, 1)} s` : ms < 3_600_000 ? `${nf(ms / 60_000, 1)} min` : `${nf(ms / 3_600_000, 1)} h`);
const TAG = { m: '<span class="tag m">MEDIDO</span>', d: '<span class="tag d">DERIVADO</span>', a: '<span class="tag a">SUPUESTO</span>' };

const q = new URLSearchParams(location.search);
const changeId = q.get('change');
const runsPerDay = q.get('runsPerDay') ? Number(q.get('runsPerDay')) : null;
const costPerHour = q.get('costPerUserHourUsd') ? Number(q.get('costPerUserHourUsd')) : null;
const by = q.get('by') || '—';
if (q.get('by')) document.getElementById('toolbar').style.display = 'none';

function bars(before, after, slo) {
  const max = Math.max(before, after, slo || 0) * 1.12;
  const W = 520, x0 = 90, w = (v) => ((W - x0 - 90) * v) / max;
  const sloX = slo ? x0 + w(slo) : null;
  return `<svg viewBox="0 0 ${W} 120" width="100%" role="img" aria-label="Tiempo antes y después">
    <text x="0" y="36" font-size="13" font-weight="600" fill="#16181d">Antes</text>
    <rect x="${x0}" y="20" width="${w(before)}" height="26" rx="4" fill="#b3261e"/>
    <text x="${x0 + w(before) + 8}" y="38" font-size="13" font-weight="700" fill="#b3261e">${esc(dur(before))}</text>
    <text x="0" y="86" font-size="13" font-weight="600" fill="#16181d">Después</text>
    <rect x="${x0}" y="70" width="${w(after)}" height="26" rx="4" fill="#1d7f4e"/>
    <text x="${x0 + w(after) + 8}" y="88" font-size="13" font-weight="700" fill="#1d7f4e">${esc(dur(after))}</text>
    ${sloX ? `<line x1="${sloX}" y1="10" x2="${sloX}" y2="106" stroke="#2f5bd3" stroke-dasharray="4 3" stroke-width="1.5"/><text x="${sloX + 4}" y="116" font-size="10" fill="#2f5bd3">objetivo ${esc(dur(slo))}</text>` : ''}
  </svg>`;
}

function capacityChart(perHourBefore, perHourAfter) {
  const max = Math.max(perHourBefore, perHourAfter) * 1.15;
  const H = 150, base = 125, bw = 90, h = (v) => ((base - 20) * v) / max;
  return `<svg viewBox="0 0 330 ${H}" width="100%" role="img" aria-label="Capacidad por hora">
    <rect x="40" y="${base - h(perHourBefore)}" width="${bw}" height="${h(perHourBefore)}" rx="4" fill="#b3261e"/>
    <text x="${40 + bw / 2}" y="${base - h(perHourBefore) - 6}" text-anchor="middle" font-size="13" font-weight="700" fill="#b3261e">${esc(nf(perHourBefore))}</text>
    <text x="${40 + bw / 2}" y="${base + 16}" text-anchor="middle" font-size="12" fill="#16181d">Antes</text>
    <rect x="190" y="${base - h(perHourAfter)}" width="${bw}" height="${h(perHourAfter)}" rx="4" fill="#1d7f4e"/>
    <text x="${190 + bw / 2}" y="${base - h(perHourAfter) - 6}" text-anchor="middle" font-size="13" font-weight="700" fill="#1d7f4e">${esc(nf(perHourAfter))}</text>
    <text x="${190 + bw / 2}" y="${base + 16}" text-anchor="middle" font-size="12" fill="#16181d">Después</text>
    <line x1="20" y1="${base}" x2="310" y2="${base}" stroke="#dde1e7"/>
  </svg>`;
}

function render(d) {
  const p = d.probes[0];
  if (!p) return `<p class="err">Este cambio no tiene una consulta registrada con medición antes/después. No hay datos medidos para un informe de negocio.</p>`;
  const b = p.before.medianMs, a = p.after.medianMs;
  const speed = b / a, less = (1 - a / b) * 100;
  const perHourB = 3_600_000 / b, perHourA = 3_600_000 / a;
  const thousandB = 1000 * b, thousandA = 1000 * a;
  const sloB = b <= p.sloMs, sloA = a <= p.sloMs;
  const outcome = d.change.verification.outcome;
  const hasRuns = runsPerDay != null && runsPerDay > 0;
  const hasCost = hasRuns && costPerHour != null && costPerHour > 0;
  const waitB = hasRuns ? (runsPerDay * b) / 3_600_000 : 0, waitA = hasRuns ? (runsPerDay * a) / 3_600_000 : 0;
  const savedH = waitB - waitA;
  const step = (type) => d.audit.find((e) => e.type === type);

  return `
  <header class="top"><div><div class="brand">AI DBA PLATFORM · INFORME DE CAMBIO #${esc(d.change.number)}</div>
    <h1>El reporte «${esc(p.name)}» ahora es ${esc(nf(speed, 1))} veces más rápido</h1></div>
    <div class="small muted" style="text-align:right">${esc(d.target.name)}<br>${esc(d.target.engine)} ${esc(d.target.version)} · ${esc(d.target.database)}<br>Generado ${esc(dt(d.generatedAt))}</div></header>

  <p class="lead">Un reporte que usa el negocio estaba respondiendo lento. El sistema detectó la causa con evidencia, propuso una corrección segura,
  un DBA la aprobó, se aplicó y luego se <b>midió</b> el resultado en la base de datos real.</p>

  <div class="hero">
    <div class="kpi bad"><div class="l">Antes ${TAG.m}</div><div class="v">${esc(dur(b))}</div><div class="small muted">por ejecución (mediana de ${p.before.runsMs.length} corridas)</div></div>
    <div class="kpi good"><div class="l">Después ${TAG.m}</div><div class="v">${esc(dur(a))}</div><div class="small muted">por ejecución (mediana de ${p.after.runsMs.length} corridas)</div></div>
    <div class="kpi good"><div class="l">Mejora ${TAG.d}</div><div class="v">${esc(nf(speed, 1))}×</div><div class="small muted">${esc(nf(less, 0))}% menos tiempo de espera</div></div>
  </div>

  <h2>Tiempo de respuesta del reporte</h2>
  ${bars(b, a, p.sloMs)}
  <div class="box ${sloA ? 'ok' : 'warn'}">Objetivo de servicio definido por el equipo DBA: <b>${esc(dur(p.sloMs))}</b>.
    Antes: <b>${sloB ? 'cumplía' : 'NO cumplía'}</b>. Después: <b>${sloA ? 'cumple' : 'todavía no cumple'}</b>.</div>

  <h2>Qué significa en la práctica</h2>
  <div class="two"><div>
    <h3>Capacidad: reportes por hora por conexión ${TAG.d}</h3>
    ${capacityChart(perHourB, perHourA)}
    <p class="small">Con el mismo servidor, una conexión puede generar este reporte unas <b>${esc(nf(perHourA))}</b> veces por hora, frente a
    <b>${esc(nf(perHourB))}</b> antes. Es un techo teórico (3.600.000 ms ÷ tiempo por ejecución) que no incluye contención con otras cargas.</p>
  </div><div>
    <h3>Ejemplo: 1.000 ejecuciones del reporte ${TAG.d}</h3>
    <table><tbody>
      <tr><th>Espera acumulada antes</th><td class="n">${esc(dur(thousandB))}</td></tr>
      <tr><th>Espera acumulada después</th><td class="n">${esc(dur(thousandA))}</td></tr>
      <tr><th>Tiempo liberado</th><td class="n"><b>${esc(dur(thousandB - thousandA))}</b></td></tr>
    </tbody></table>
    <p class="small muted">Cálculo directo sobre los tiempos medidos. Cada usuario que abre el reporte espera ${esc(dur(b - a))} menos.</p>
  </div></div>

  <section class="keep"><h2>Impacto económico</h2>
  ${hasRuns ? `
    <table><thead><tr><th>Concepto</th><th>Tipo</th><th class="n">Valor</th></tr></thead><tbody>
      <tr><td>Ejecuciones del reporte por día</td><td>${TAG.a}</td><td class="n">${esc(nf(runsPerDay))}</td></tr>
      ${hasCost ? `<tr><td>Costo de una hora de espera de un usuario</td><td>${TAG.a}</td><td class="n">USD ${esc(nf(costPerHour, 2))}</td></tr>` : ''}
      <tr><td>Horas de espera por día · antes → después</td><td>${TAG.d}</td><td class="n">${esc(nf(waitB, 2))} h → ${esc(nf(waitA, 2))} h</td></tr>
      <tr><td>Horas de espera eliminadas por mes (30 días)</td><td>${TAG.d}</td><td class="n"><b>${esc(nf(savedH * 30, 1))} h</b></td></tr>
      ${hasCost ? `<tr><td>Valor del tiempo recuperado por mes (30 días)</td><td>${TAG.d}</td><td class="n"><b>USD ${esc(nf(savedH * 30 * costPerHour, 2))}</b></td></tr>` : ''}
    </tbody></table>
    <p class="small muted">Los valores marcados SUPUESTO fueron ingresados por <b>${esc(by)}</b> al generar este informe; no son mediciones del sistema.
    Los valores DERIVADO combinan esos supuestos con los tiempos medidos.${hasCost ? '' : ' No se indicó costo por hora, por eso no se calcula valor en dinero.'}</p>`
  : `<div class="box info">No se calculó impacto en dinero: faltan los supuestos del negocio (ejecuciones por día y costo por hora de espera).
    El sistema no inventa estas cifras; se pueden indicar al generar el informe.</div>`}</section>

  <section class="keep"><h2>Cómo se hizo: el recorrido completo</h2>
  <div class="timeline">
    <div><b>1 · Detectado</b>${esc(step('ASSESSMENT_COMPLETED') ? dt(step('ASSESSMENT_COMPLETED').ts) : 'Assessment automático')}<br><span class="muted">Revisión automática en solo lectura</span></div>
    <div><b>2 · Analizado</b>${esc(d.analysis?.mode === 'LLM' ? 'IA (' + (d.analysis.model || 'Claude') + ')' : 'Reglas')}<br><span class="muted">Causa explicada con evidencia</span></div>
    <div><b>3 · Aprobado</b>${esc(d.change.approvedBy || '—')}<br><span class="muted">${esc(dt(d.change.approvedAt))}</span></div>
    <div><b>4 · Ejecutado</b>${esc(dt(d.change.executedAt))}<br><span class="muted">Identidad con permisos mínimos</span></div>
    <div><b>5 · Verificado</b>${esc(outcome === 'IMPROVED' ? 'Mejora confirmada' : outcome)}<br><span class="muted">Medido antes y después</span></div>
  </div>

  ${d.analysis?.rootCause ? `<div class="box info"><b>Causa raíz según el análisis${d.analysis.mode === 'LLM' ? ' de la IA' : ''}:</b> ${esc(d.analysis.rootCause)}</div>` : ''}
  ${d.change.actionId === 'publish_pending_stats' ? `<p><b>Cómo se validó antes de tocar producción:</b> en Oracle las estadísticas nuevas se calcularon primero como «pendientes»,
  invisibles para la aplicación. El sistema probó la consulta crítica con ellas en una sesión aislada y solo después de comprobar la mejora
  se pidió aprobación para publicarlas. Si algo saliera mal, Oracle permite restaurar las estadísticas anteriores (rollback real).</p>` : ''}
  ${['analyze_table', 'publish_pending_stats'].includes(d.change.actionId) ? `<p><b>En palabras simples:</b> la base de datos decide cómo buscar la información usando un «resumen» estadístico de cada tabla.
  Después de muchos cambios en los datos, ese resumen quedó desactualizado y la base de datos calculó mal cuántas filas iba a encontrar, por eso eligió un camino lento.
  Actualizar el resumen le permitió elegir el camino correcto. Su estimación pasó de equivocarse
  <b>${esc(nf(p.before.worstMisestimate))} veces</b> a <b>${esc(nf(p.after.worstMisestimate, 1))} veces</b> ${TAG.m}.</p>` : ''}

  </section>
  <h3>Control y seguridad</h3>
  <table><tbody>
    <tr><th>Acción aplicada</th><td>${esc(d.change.action)}</td></tr>
    <tr><th>Riesgo</th><td>${esc(d.change.risk)} · no modifica datos del negocio · ${esc(d.change.reversible ? 'reversible' : 'no reversible, no destructiva')}</td></tr>
    <tr><th>Quién decidió</th><td>La IA propuso (${esc(d.change.requestedBy)}); un humano aprobó (${esc(d.change.approvedBy || '—')}). La IA no escribe ni ejecuta comandos por su cuenta.</td></tr>
    <tr><th>Antes de ejecutar</th><td>Se volvieron a validar las condiciones: si algo hubiera cambiado desde la aprobación, el sistema se habría negado a ejecutar.</td></tr>
    <tr><th>Trazabilidad</th><td>${esc(d.audit.length)} eventos de auditoría para este cambio; cadena de integridad ${d.auditChain.valid ? '<b>válida</b>' : '<b style="color:#b3261e">ALTERADA</b>'} (${esc(d.auditChain.events)} eventos totales verificados).</td></tr>
  </tbody></table>

  <div class="break"></div>
  <h2>Anexo técnico (para el equipo de TI)</h2>
  <table><tbody>
    ${d.finding ? `<tr><th>Hallazgo (regla determinista)</th><td>${esc(d.finding.title)} · ${esc(d.finding.detail)}</td></tr>` : ''}
    <tr><th>Comando ejecutado</th><td><pre>${esc(d.change.command)}</pre></td></tr>
    <tr><th>Identidad</th><td>${esc(d.change.identity)} · ${esc(d.change.lockImpact)}</td></tr>
    <tr><th>Corridas antes (ms)</th><td>${esc(p.before.runsMs.join(' / '))}</td></tr>
    <tr><th>Corridas después (ms)</th><td>${esc(p.after.runsMs.join(' / '))}</td></tr>
    <tr><th>Rollback</th><td>${esc(d.change.rollback)}</td></tr>
  </tbody></table>
  <h3>Verificaciones posteriores al cambio</h3>
  <table><thead><tr><th>Verificación</th><th>Antes</th><th>Después</th><th>OK</th></tr></thead><tbody>
    ${d.change.verification.checks.map((c) => `<tr><td>${esc(c.description)}</td><td class="n">${esc(num(c.before))}</td><td class="n">${esc(num(c.after))}</td><td>${c.ok ? '✓' : '✕'}</td></tr>`).join('')}
  </tbody></table>
  <div class="two"><div><h3>Plan antes</h3><pre>${esc(p.before.plan.join('\n'))}</pre></div><div><h3>Plan después</h3><pre>${esc(p.after.plan.join('\n'))}</pre></div></div>
  <h3>Eventos de auditoría</h3>
  <table><thead><tr><th>#</th><th>Fecha</th><th>Actor</th><th>Evento</th><th>Hash</th></tr></thead><tbody>
    ${d.audit.map((e) => `<tr><td class="n">${esc(e.seq)}</td><td>${esc(dt(e.ts))}</td><td>${esc(e.actor)}</td><td>${esc(e.type)}</td><td style="font-family:Consolas,monospace;font-size:8pt">${esc(String(e.hash).slice(0, 16))}…</td></tr>`).join('')}
  </tbody></table>

  <footer>Cifras MEDIDO: ejecución real de la consulta registrada (EXPLAIN ANALYZE, transacción de solo lectura) antes y después del cambio, en ${esc(d.target.name)}.
  Los tiempos pueden variar entre corridas según la carga del servidor. DERIVADO: aritmética sobre valores medidos y, cuando aplica, sobre supuestos.
  SUPUESTO: datos del negocio ingresados por una persona. Informe generado por AI DBA Platform · cambio ${esc(d.change.id)}.</footer>`;
}

(async () => {
  const root = document.getElementById('root');
  try {
    if (!changeId) throw new Error('Falta el parámetro change');
    const r = await fetch(`/api/changes/${encodeURIComponent(changeId)}/report-data`);
    const d = await r.json();
    if (!r.ok) throw new Error(d.error || `HTTP ${r.status}`);
    root.innerHTML = render(d);
  } catch (e) {
    root.innerHTML = `<p class="err">${esc(e.message)}</p>`;
  }
})();
