export function generateHtmlReport({ sessionId, collectionName, generatedAt, results }) {
  const total = results.length;
  const passed = results.filter(r => r.status === 'passed').length;
  const failed = results.filter(r => r.status === 'failed').length;
  const errored = results.filter(r => r.status === 'error').length;
  const passRate = total ? Math.round((passed / total) * 100) : 0;

  // Group results by endpoint (toolName)
  const byEndpoint = new Map();
  for (const r of results) {
    const key = r.toolName || 'Unknown Endpoint';
    if (!byEndpoint.has(key)) byEndpoint.set(key, []);
    byEndpoint.get(key).push(r);
  }

  const endpointSections = [...byEndpoint.entries()].map(([ep, epResults]) => {
    const epPassed = epResults.filter(r => r.status === 'passed').length;
    const epBadgeClass = epPassed === epResults.length ? 'badge-pass' : epPassed === 0 ? 'badge-fail' : 'badge-partial';

    const rows = epResults.map(r => {
      const inputData = r.input ? JSON.stringify(r.input, null, 2) : '';
      const outputData = r.output ? JSON.stringify(r.output, null, 2) : '';
      const statusClass = r.status === 'passed' ? 'status-pass' : r.status === 'failed' ? 'status-fail' : 'status-err';
      const inputId = `in-${r.id}`;
      const outputId = `out-${r.id}`;

      return `
        <tr>
          <td class="td-name">${esc(r.stepName)}</td>
          <td><span class="status ${statusClass}">${r.status}</span></td>
          <td class="td-code">${r.input?.expectedStatus ?? '—'} → ${r.output?.actualStatus ?? r.error ?? '—'}</td>
          <td class="td-dur">${r.durationMs}ms</td>
          <td class="td-detail">
            ${r.error ? `<span class="err-msg">${esc(r.error)}</span>` : ''}
            ${inputData ? `<details><summary>Request</summary><pre>${esc(inputData)}</pre></details>` : ''}
            ${outputData ? `<details><summary>Response</summary><pre>${esc(outputData)}</pre></details>` : ''}
          </td>
        </tr>`;
    }).join('');

    return `
      <div class="endpoint-section">
        <div class="endpoint-header">
          <span class="ep-name">${esc(ep)}</span>
          <span class="badge ${epBadgeClass}">${epPassed}/${epResults.length} passed</span>
        </div>
        <table>
          <thead>
            <tr><th>Test</th><th>Status</th><th>HTTP Status</th><th>Duration</th><th>Detail</th></tr>
          </thead>
          <tbody>${rows}</tbody>
        </table>
      </div>`;
  }).join('');

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>ShipSafe — API Test Report</title>
<style>
  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; background: #0f1117; color: #c9d1d9; font-size: 14px; }
  a { color: #58a6ff; }
  .header { background: #161b22; border-bottom: 1px solid #30363d; padding: 20px 32px; display: flex; align-items: center; gap: 16px; }
  .header h1 { font-size: 20px; font-weight: 600; color: #e6edf3; }
  .header .subtitle { color: #8b949e; font-size: 13px; margin-top: 2px; }
  .logo { width: 36px; height: 36px; background: linear-gradient(135deg, #f97316, #ea580c); border-radius: 8px; display: flex; align-items: center; justify-content: center; font-weight: 700; font-size: 16px; color: white; }
  .container { max-width: 1100px; margin: 0 auto; padding: 32px; }
  .summary { display: grid; grid-template-columns: repeat(5, 1fr); gap: 16px; margin-bottom: 32px; }
  .stat-card { background: #161b22; border: 1px solid #30363d; border-radius: 10px; padding: 18px; text-align: center; }
  .stat-card .val { font-size: 32px; font-weight: 700; line-height: 1; }
  .stat-card .lbl { font-size: 12px; color: #8b949e; margin-top: 6px; text-transform: uppercase; letter-spacing: 0.05em; }
  .val-total { color: #e6edf3; }
  .val-pass { color: #3fb950; }
  .val-fail { color: #f85149; }
  .val-err { color: #d29922; }
  .val-rate { color: ${passRate >= 80 ? '#3fb950' : passRate >= 50 ? '#d29922' : '#f85149'}; }
  .endpoint-section { background: #161b22; border: 1px solid #30363d; border-radius: 10px; margin-bottom: 20px; overflow: hidden; }
  .endpoint-header { padding: 14px 20px; display: flex; align-items: center; justify-content: space-between; border-bottom: 1px solid #21262d; }
  .ep-name { font-weight: 600; color: #e6edf3; font-size: 13px; font-family: ui-monospace, 'SF Mono', monospace; }
  .badge { font-size: 11px; font-weight: 600; padding: 3px 10px; border-radius: 20px; }
  .badge-pass { background: #1b4332; color: #3fb950; }
  .badge-fail { background: #3d1a1a; color: #f85149; }
  .badge-partial { background: #2d2208; color: #d29922; }
  table { width: 100%; border-collapse: collapse; }
  th { padding: 10px 16px; text-align: left; font-size: 11px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.05em; color: #8b949e; border-bottom: 1px solid #21262d; background: #0d1117; }
  td { padding: 10px 16px; border-bottom: 1px solid #21262d; vertical-align: top; }
  tr:last-child td { border-bottom: none; }
  tr:hover td { background: #1c2128; }
  .td-name { color: #e6edf3; font-weight: 500; max-width: 280px; }
  .td-code { font-family: ui-monospace, 'SF Mono', monospace; font-size: 12px; white-space: nowrap; }
  .td-dur { color: #8b949e; font-size: 12px; white-space: nowrap; }
  .td-detail { max-width: 360px; }
  .status { display: inline-block; padding: 2px 8px; border-radius: 4px; font-size: 11px; font-weight: 600; text-transform: uppercase; }
  .status-pass { background: #1b4332; color: #3fb950; }
  .status-fail { background: #3d1a1a; color: #f85149; }
  .status-err { background: #2d2208; color: #d29922; }
  .err-msg { color: #f85149; font-size: 12px; display: block; margin-bottom: 4px; }
  details { margin-top: 4px; }
  details summary { cursor: pointer; font-size: 11px; color: #58a6ff; user-select: none; }
  details pre { margin-top: 6px; padding: 10px; background: #0d1117; border: 1px solid #21262d; border-radius: 6px; font-size: 11px; line-height: 1.5; overflow-x: auto; max-height: 200px; overflow-y: auto; white-space: pre-wrap; word-break: break-all; }
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
  <div class="summary">
    <div class="stat-card"><div class="val val-total">${total}</div><div class="lbl">Total Tests</div></div>
    <div class="stat-card"><div class="val val-pass">${passed}</div><div class="lbl">Passed</div></div>
    <div class="stat-card"><div class="val val-fail">${failed}</div><div class="lbl">Failed</div></div>
    <div class="stat-card"><div class="val val-err">${errored}</div><div class="lbl">Errors</div></div>
    <div class="stat-card"><div class="val val-rate">${passRate}%</div><div class="lbl">Pass Rate</div></div>
  </div>
  ${endpointSections}
</div>
<div class="footer">Generated by <strong>ShipSafe</strong> &nbsp;·&nbsp; ${esc(generatedAt)}</div>
</body>
</html>`;
}

function esc(str) {
  return String(str ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
