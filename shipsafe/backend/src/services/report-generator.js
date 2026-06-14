import { gradeCoverage } from './api-coverage.js';

// generateHtmlReport({ sessionId, collectionName, generatedAt, results,
//   coverage?, securitySummary?, performanceResults?, driftReports?, rcaFindings? })
export function generateHtmlReport({
  sessionId,
  collectionName,
  generatedAt,
  results,
  coverage = null,
  securitySummary = null,
  performanceResults = null,
  driftReports = null,
  rcaFindings = null,
}) {
  const total = results.length;
  const passed = results.filter(r => r.status === 'passed').length;
  const failed = results.filter(r => r.status === 'failed').length;
  const errored = results.filter(r => r.status === 'error').length;
  const passRate = total ? Math.round((passed / total) * 100) : 0;
  const rateColor = passRate >= 80 ? '#3fb950' : passRate >= 50 ? '#d29922' : '#f85149';

  // Group results by endpoint name
  const byEndpoint = new Map();
  for (const r of results) {
    const key = r.toolName || 'Unknown Endpoint';
    if (!byEndpoint.has(key)) byEndpoint.set(key, []);
    byEndpoint.get(key).push(r);
  }

  const coverageHtml = coverage ? buildCoverageSection(coverage) : '';
  const securityHtml = securitySummary ? buildSecuritySection(securitySummary) : '';
  const performanceHtml = performanceResults?.length ? buildPerformanceSection(performanceResults) : '';
  const driftHtml = driftReports?.length ? buildDriftSection(driftReports) : '';
  const rcaHtml = rcaFindings?.length ? buildRcaSection(rcaFindings) : '';
  const endpointSections = buildEndpointSections(byEndpoint, results);

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>ShipSafe — API Test Report</title>
<style>
  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; background: #0f1117; color: #c9d1d9; font-size: 14px; }
  .header { background: #161b22; border-bottom: 1px solid #30363d; padding: 20px 32px; display: flex; align-items: center; gap: 16px; }
  .header h1 { font-size: 20px; font-weight: 600; color: #e6edf3; }
  .header .subtitle { color: #8b949e; font-size: 13px; margin-top: 2px; }
  .logo { width: 36px; height: 36px; background: linear-gradient(135deg, #f97316, #ea580c); border-radius: 8px; display: flex; align-items: center; justify-content: center; font-weight: 700; font-size: 16px; color: white; }
  .container { max-width: 1200px; margin: 0 auto; padding: 32px; }
  .section-title { font-size: 15px; font-weight: 600; color: #e6edf3; margin-bottom: 14px; display: flex; align-items: center; gap-8px; }
  .section-title .dot { width: 6px; height: 6px; border-radius: 50%; display: inline-block; margin-right: 8px; }

  /* Summary cards */
  .summary { display: grid; grid-template-columns: repeat(5, 1fr); gap: 12px; margin-bottom: 28px; }
  .stat-card { background: #161b22; border: 1px solid #30363d; border-radius: 10px; padding: 16px; text-align: center; }
  .stat-card .val { font-size: 30px; font-weight: 700; line-height: 1; }
  .stat-card .lbl { font-size: 11px; color: #8b949e; margin-top: 5px; text-transform: uppercase; letter-spacing: 0.05em; }
  .val-total { color: #e6edf3; }
  .val-pass { color: #3fb950; }
  .val-fail { color: #f85149; }
  .val-err { color: #d29922; }

  /* Coverage */
  .coverage-grid { display: grid; grid-template-columns: repeat(6, 1fr); gap: 10px; margin-bottom: 28px; }
  .cov-card { background: #161b22; border: 1px solid #30363d; border-radius: 8px; padding: 14px 10px; text-align: center; }
  .cov-card .cov-val { font-size: 22px; font-weight: 700; }
  .cov-card .cov-lbl { font-size: 10px; color: #8b949e; margin-top: 4px; text-transform: uppercase; letter-spacing: 0.04em; }
  .cov-bar-wrap { height: 4px; background: #21262d; border-radius: 4px; margin-top: 8px; overflow: hidden; }
  .cov-bar { height: 100%; border-radius: 4px; transition: width 0.3s; }

  /* Security */
  .security-box { background: #161b22; border: 1px solid #30363d; border-radius: 10px; padding: 20px; margin-bottom: 28px; }
  .sec-header { display: flex; align-items: center; justify-content: space-between; margin-bottom: 16px; }
  .sec-grade { font-size: 36px; font-weight: 800; }
  .sec-score { font-size: 20px; font-weight: 600; }
  .vuln-list { display: flex; gap: 10px; flex-wrap: wrap; margin-top: 12px; }
  .vuln-chip { display: inline-flex; align-items: center; gap: 6px; padding: 4px 10px; border-radius: 20px; font-size: 12px; font-weight: 600; }
  .sev-CRITICAL { background: #3d1a1a; color: #f85149; }
  .sev-HIGH     { background: #2d1d0a; color: #f0883e; }
  .sev-MEDIUM   { background: #2d2208; color: #d29922; }
  .sev-LOW      { background: #1a2a1a; color: #3fb950; }

  /* Performance */
  .perf-box { background: #161b22; border: 1px solid #30363d; border-radius: 10px; padding: 20px; margin-bottom: 28px; }
  .perf-metrics { display: grid; grid-template-columns: repeat(4, 1fr); gap: 10px; }
  .perf-metric { background: #0d1117; border: 1px solid #21262d; border-radius: 8px; padding: 12px; text-align: center; }
  .perf-metric .pval { font-size: 20px; font-weight: 700; color: #58a6ff; }
  .perf-metric .plbl { font-size: 10px; color: #8b949e; margin-top: 4px; text-transform: uppercase; }

  /* Drift */
  .drift-box { background: #161b22; border: 1px solid #d29922; border-radius: 10px; padding: 20px; margin-bottom: 28px; }
  .drift-item { padding: 8px 12px; background: #1c1a0a; border-radius: 6px; margin-bottom: 6px; font-size: 12px; font-family: ui-monospace, 'SF Mono', monospace; }
  .drift-removed { color: #f85149; }
  .drift-added { color: #3fb950; }
  .drift-changed { color: #d29922; }

  /* RCA */
  .rca-box { background: #161b22; border: 1px solid #30363d; border-radius: 10px; padding: 20px; margin-bottom: 28px; }
  .rca-item { border: 1px solid #21262d; border-radius: 8px; padding: 14px; margin-bottom: 10px; }
  .rca-desc { font-weight: 600; color: #e6edf3; margin-bottom: 8px; }
  .rca-cause { color: #c9d1d9; font-size: 13px; margin-bottom: 6px; }
  .rca-fix { color: #58a6ff; font-size: 12px; }
  .rca-conf { font-size: 11px; color: #8b949e; float: right; }
  .rca-cat { display: inline-block; padding: 2px 8px; border-radius: 12px; font-size: 10px; font-weight: 600; text-transform: uppercase; background: #21262d; color: #8b949e; margin-left: 8px; }

  /* Endpoint sections */
  .endpoint-section { background: #161b22; border: 1px solid #30363d; border-radius: 10px; margin-bottom: 16px; overflow: hidden; }
  .endpoint-header { padding: 12px 18px; display: flex; align-items: center; justify-content: space-between; border-bottom: 1px solid #21262d; }
  .ep-name { font-weight: 600; color: #e6edf3; font-size: 13px; font-family: ui-monospace, 'SF Mono', monospace; }
  .badge { font-size: 11px; font-weight: 600; padding: 3px 10px; border-radius: 20px; }
  .badge-pass { background: #1b4332; color: #3fb950; }
  .badge-fail { background: #3d1a1a; color: #f85149; }
  .badge-partial { background: #2d2208; color: #d29922; }
  table { width: 100%; border-collapse: collapse; }
  th { padding: 9px 14px; text-align: left; font-size: 11px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.05em; color: #8b949e; border-bottom: 1px solid #21262d; background: #0d1117; }
  td { padding: 9px 14px; border-bottom: 1px solid #21262d; vertical-align: top; }
  tr:last-child td { border-bottom: none; }
  tr:hover td { background: #1c2128; }
  .td-name { color: #e6edf3; font-weight: 500; max-width: 260px; }
  .td-code { font-family: ui-monospace, monospace; font-size: 12px; white-space: nowrap; }
  .td-dur { color: #8b949e; font-size: 12px; white-space: nowrap; }
  .td-detail { max-width: 340px; }
  .status { display: inline-block; padding: 2px 8px; border-radius: 4px; font-size: 11px; font-weight: 600; text-transform: uppercase; }
  .status-pass { background: #1b4332; color: #3fb950; }
  .status-fail { background: #3d1a1a; color: #f85149; }
  .status-err  { background: #2d2208; color: #d29922; }
  .err-msg { color: #f85149; font-size: 12px; display: block; margin-bottom: 4px; }
  .assert-list { margin-top: 6px; }
  .assert-item { font-size: 11px; padding: 2px 0; }
  .assert-pass { color: #3fb950; }
  .assert-fail { color: #f85149; }
  details { margin-top: 4px; }
  details summary { cursor: pointer; font-size: 11px; color: #58a6ff; user-select: none; }
  details pre { margin-top: 5px; padding: 8px; background: #0d1117; border: 1px solid #21262d; border-radius: 6px; font-size: 11px; line-height: 1.5; overflow-x: auto; max-height: 180px; overflow-y: auto; white-space: pre-wrap; word-break: break-all; }
  .footer { text-align: center; padding: 32px; color: #484f58; font-size: 12px; }
</style>
</head>
<body>
<div class="header">
  <div class="logo">S</div>
  <div>
    <h1>ShipSafe — API Test Report</h1>
    <div class="subtitle">${esc(collectionName)} &nbsp;·&nbsp; ${esc(generatedAt)} &nbsp;·&nbsp; Session ${esc(sessionId)}</div>
  </div>
</div>
<div class="container">

  <!-- Summary -->
  <div class="summary">
    <div class="stat-card"><div class="val val-total">${total}</div><div class="lbl">Total Tests</div></div>
    <div class="stat-card"><div class="val val-pass">${passed}</div><div class="lbl">Passed</div></div>
    <div class="stat-card"><div class="val val-fail">${failed}</div><div class="lbl">Failed</div></div>
    <div class="stat-card"><div class="val val-err">${errored}</div><div class="lbl">Errors</div></div>
    <div class="stat-card"><div class="val" style="color:${rateColor}">${passRate}%</div><div class="lbl">Pass Rate</div></div>
  </div>

  ${coverageHtml}
  ${securityHtml}
  ${performanceHtml}
  ${driftHtml}
  ${rcaHtml}

  <!-- Endpoint Results -->
  <div class="section-title" style="margin-bottom:14px"><span class="dot" style="background:#58a6ff"></span>Test Results by Endpoint</div>
  ${endpointSections}

</div>
<div class="footer">Generated by <strong>ShipSafe</strong> &nbsp;·&nbsp; ${esc(generatedAt)}</div>
</body>
</html>`;
}

// ---- Section builders ----

function buildCoverageSection(cov) {
  const dims = [
    { label: 'Overall', val: cov.overall, color: gradeCoverage(cov.overall).color },
    { label: 'Functional', val: cov.functional, color: '#58a6ff' },
    { label: 'Negative', val: cov.negative, color: '#d29922' },
    { label: 'Auth', val: cov.auth, color: '#a371f7' },
    { label: 'Schema', val: cov.schema, color: '#3fb950' },
    { label: 'Status Codes', val: cov.statusCodes, color: '#f0883e' },
  ];

  const cards = dims.map(d => `
    <div class="cov-card">
      <div class="cov-val" style="color:${d.color}">${d.val}%</div>
      <div class="cov-lbl">${d.label}</div>
      <div class="cov-bar-wrap"><div class="cov-bar" style="width:${d.val}%;background:${d.color}"></div></div>
    </div>`).join('');

  const { grade, label, color } = gradeCoverage(cov.overall);
  return `
  <div class="section-title"><span class="dot" style="background:#58a6ff"></span>Test Coverage
    <span style="margin-left:10px;font-size:13px;color:${color};font-weight:700">${grade} — ${label}</span>
  </div>
  <div class="coverage-grid">${cards}</div>`;
}

function buildSecuritySection(sec) {
  const gradeColor = { A: '#3fb950', B: '#58a6ff', C: '#d29922', D: '#f0883e', F: '#f85149' };
  const color = gradeColor[sec.grade] ?? '#8b949e';
  const chips = Object.entries(sec.breakdown ?? {}).map(([sev, cnt]) =>
    cnt > 0 ? `<span class="vuln-chip sev-${sev}">${cnt} ${sev}</span>` : ''
  ).join('');

  return `
  <div class="section-title"><span class="dot" style="background:#f85149"></span>Security Analysis</div>
  <div class="security-box">
    <div class="sec-header">
      <div>
        <div style="color:#e6edf3;font-weight:600;margin-bottom:4px">Security Score</div>
        <div class="sec-score" style="color:${color}">${sec.score}/100 &nbsp; Grade ${sec.grade}</div>
        <div style="font-size:12px;color:#8b949e;margin-top:4px">${sec.total} tests run · ${sec.vulnerabilities} potential vulnerabilities found</div>
      </div>
      <div class="sec-grade" style="color:${color}">${sec.grade}</div>
    </div>
    ${chips ? `<div class="vuln-list">${chips}</div>` : '<div style="color:#3fb950;font-size:13px">No vulnerabilities detected.</div>'}
  </div>`;
}

function buildPerformanceSection(perfResults) {
  const rows = perfResults.map(p => {
    const m = p.metrics;
    const gradeColor = { A: '#3fb950', B: '#58a6ff', C: '#d29922', D: '#f0883e', F: '#f85149' };
    const color = gradeColor[p.grade] ?? '#8b949e';
    return `
    <div class="perf-box" style="margin-bottom:16px">
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:14px">
        <div>
          <div style="color:#e6edf3;font-weight:600">${esc(p.endpoint ?? 'Performance Test')}</div>
          <div style="font-size:12px;color:#8b949e;margin-top:2px">${m.totalRequests} requests · concurrency ${m.concurrency} · ${(m.errorRate * 100).toFixed(1)}% error rate</div>
        </div>
        <div style="font-size:28px;font-weight:800;color:${color}">${p.grade}</div>
      </div>
      <div class="perf-metrics">
        <div class="perf-metric"><div class="pval">${m.p50}ms</div><div class="plbl">p50</div></div>
        <div class="perf-metric"><div class="pval">${m.p95}ms</div><div class="plbl">p95</div></div>
        <div class="perf-metric"><div class="pval">${m.p99}ms</div><div class="plbl">p99</div></div>
        <div class="perf-metric"><div class="pval">${m.throughputRps}</div><div class="plbl">req/s</div></div>
      </div>
      ${p.issues?.length ? `<div style="margin-top:12px">${p.issues.map(i => `<div style="color:#d29922;font-size:12px;margin-top:4px">⚠ ${esc(i)}</div>`).join('')}</div>` : ''}
    </div>`;
  });

  return `
  <div class="section-title"><span class="dot" style="background:#a371f7"></span>Performance Testing</div>
  ${rows.join('')}`;
}

function buildDriftSection(driftReports) {
  const items = driftReports.map(dr => {
    const driftItems = (dr.drifts ?? []).map(d => {
      const cls = d.change === 'field_removed' ? 'drift-removed'
        : d.change === 'field_added' ? 'drift-added'
        : 'drift-changed';
      const icon = d.change === 'field_removed' ? '−' : d.change === 'field_added' ? '+' : '~';
      return `<div class="drift-item ${cls}">${icon} ${esc(d.path)} [${esc(d.change.replace('_', ' '))}${d.from ? ` ${d.from} → ${d.to}` : ''}]</div>`;
    }).join('');

    return `
    <div style="margin-bottom:16px">
      <div style="font-family:ui-monospace,monospace;font-size:12px;color:#e6edf3;margin-bottom:8px">${esc(dr.endpointKey)}</div>
      ${driftItems}
    </div>`;
  });

  return `
  <div class="section-title"><span class="dot" style="background:#d29922"></span>Contract Drift Detected
    <span style="font-size:12px;color:#d29922;margin-left:8px;font-weight:400">${driftReports.length} endpoint(s) changed since last run</span>
  </div>
  <div class="drift-box">${items.join('')}</div>`;
}

function buildRcaSection(rcaFindings) {
  const items = rcaFindings.map(r => `
    <div class="rca-item">
      <div class="rca-desc">
        ${esc(r.description)}
        <span class="rca-cat">${esc(r.category ?? 'unknown')}</span>
        <span class="rca-conf">${Math.round((r.confidence ?? 0) * 100)}% confidence</span>
      </div>
      <div class="rca-cause">${esc(r.rootCause)}</div>
      <div class="rca-fix">→ ${esc(r.suggestedFix)}</div>
      ${r.investigationSteps?.length ? `
      <details style="margin-top:8px">
        <summary>Investigation steps</summary>
        <ul style="padding-left:16px;margin-top:6px">
          ${r.investigationSteps.map(s => `<li style="font-size:12px;color:#8b949e;margin-top:4px">${esc(s)}</li>`).join('')}
        </ul>
      </details>` : ''}
    </div>`).join('');

  return `
  <div class="section-title"><span class="dot" style="background:#f0883e"></span>AI Root Cause Analysis
    <span style="font-size:12px;color:#8b949e;margin-left:8px;font-weight:400">${rcaFindings.length} failure(s) analyzed</span>
  </div>
  <div class="rca-box">${items}</div>`;
}

function buildEndpointSections(byEndpoint, allResults) {
  return [...byEndpoint.entries()].map(([ep, epResults]) => {
    const epPassed = epResults.filter(r => r.status === 'passed').length;
    const badgeCls = epPassed === epResults.length ? 'badge-pass' : epPassed === 0 ? 'badge-fail' : 'badge-partial';

    const rows = epResults.map(r => {
      const inputData = r.input ? JSON.stringify(r.input, null, 2) : '';
      const outputData = r.output ? JSON.stringify(r.output, null, 2) : '';
      const statusCls = r.status === 'passed' ? 'status-pass' : r.status === 'failed' ? 'status-fail' : 'status-err';
      const assertions = r.output?.assertionResults ?? [];
      const failedAssert = assertions.filter(a => !a.passed);
      const assertHtml = assertions.length ? `
        <details class="assert-list">
          <summary>${assertions.filter(a => a.passed).length}/${assertions.length} assertions passed</summary>
          ${assertions.map(a => `<div class="assert-item ${a.passed ? 'assert-pass' : 'assert-fail'}">${a.passed ? '✓' : '✗'} ${esc(a.message)}</div>`).join('')}
        </details>` : '';

      return `
        <tr>
          <td class="td-name">${esc(r.stepName)}</td>
          <td><span class="status ${statusCls}">${r.status}</span></td>
          <td class="td-code">${r.input?.expectedStatus ?? '—'} → ${r.output?.actualStatus ?? r.error ?? '—'}</td>
          <td class="td-dur">${r.durationMs}ms</td>
          <td class="td-detail">
            ${r.error ? `<span class="err-msg">${esc(r.error)}</span>` : ''}
            ${assertHtml}
            ${inputData ? `<details><summary>Request</summary><pre>${esc(inputData)}</pre></details>` : ''}
            ${outputData ? `<details><summary>Response</summary><pre>${esc(outputData)}</pre></details>` : ''}
          </td>
        </tr>`;
    }).join('');

    return `
      <div class="endpoint-section">
        <div class="endpoint-header">
          <span class="ep-name">${esc(ep)}</span>
          <span class="badge ${badgeCls}">${epPassed}/${epResults.length} passed</span>
        </div>
        <table>
          <thead><tr><th>Test</th><th>Status</th><th>HTTP</th><th>Duration</th><th>Detail</th></tr></thead>
          <tbody>${rows}</tbody>
        </table>
      </div>`;
  }).join('');
}

function esc(str) {
  return String(str ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
