import React, { useState, useRef, useEffect } from 'react';
import {
  Zap, Upload, FileJson, X, CheckCircle2, XCircle, AlertTriangle,
  ChevronDown, ChevronRight, Loader2, Download, RotateCcw, Play,
} from 'lucide-react';

// ---- Types ----

interface RunResponse {
  sessionId: string;
  endpointCount: number;
  collectionName: string;
}

interface EndpointState {
  index: number;
  name: string;
  method: string;
  url: string;
  phase: 'running' | 'generating' | 'executing' | 'done' | 'error';
  testCount: number;
  results: TestResultItem[];
  error?: string;
}

interface TestResultItem {
  description: string;
  type?: string;
  status: 'passed' | 'failed' | 'error';
  actualStatus?: number;
  expectedStatus: number;
  durationMs: number;
  error?: string;
}

interface Summary {
  total: number;
  passed: number;
  failed: number;
  errored: number;
}

// ---- Helpers ----

const METHOD_COLORS: Record<string, string> = {
  GET: 'text-blue-400 bg-blue-500/10',
  POST: 'text-green-400 bg-green-500/10',
  PUT: 'text-amber-400 bg-amber-500/10',
  PATCH: 'text-orange-400 bg-orange-500/10',
  DELETE: 'text-red-400 bg-red-500/10',
};

function MethodBadge({ method }: { method: string }) {
  const cls = METHOD_COLORS[method] ?? 'text-gray-400 bg-gray-500/10';
  return (
    <span className={`inline-block text-[10px] font-bold px-2 py-0.5 rounded font-mono ${cls}`}>
      {method}
    </span>
  );
}

function StatusIcon({ status }: { status: 'passed' | 'failed' | 'error' }) {
  if (status === 'passed') return <CheckCircle2 className="w-4 h-4 text-green-400 shrink-0" />;
  if (status === 'failed') return <XCircle className="w-4 h-4 text-red-400 shrink-0" />;
  return <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0" />;
}

// ---- Main component ----

export default function APITesting() {
  const [phase, setPhase] = useState<'upload' | 'running' | 'complete'>('upload');
  const [collectionFile, setCollectionFile] = useState<File | null>(null);
  const [envFile, setEnvFile] = useState<File | null>(null);
  const [dragging, setDragging] = useState(false);
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const [sessionId, setSessionId] = useState('');
  const [collectionName, setCollectionName] = useState('');
  const [endpoints, setEndpoints] = useState<EndpointState[]>([]);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [expandedIdx, setExpandedIdx] = useState<number | null>(null);

  const collectionInputRef = useRef<HTMLInputElement>(null);
  const envInputRef = useRef<HTMLInputElement>(null);
  const sseRef = useRef<EventSource | null>(null);

  // Close SSE on unmount
  useEffect(() => () => { sseRef.current?.close(); }, []);

  function handleDrop(e: React.DragEvent) {
    e.preventDefault();
    setDragging(false);
    const file = e.dataTransfer.files[0];
    if (file && file.name.endsWith('.json')) setCollectionFile(file);
  }

  async function handleRun() {
    if (!collectionFile) return;
    setError('');
    setSubmitting(true);

    const formData = new FormData();
    formData.append('collection', collectionFile);
    if (envFile) formData.append('env', envFile);

    const token = localStorage.getItem('shipsafe_token');
    let data: RunResponse;
    try {
      const res = await fetch('/api/api-testing/run', {
        method: 'POST',
        headers: token ? { Authorization: `Bearer ${token}` } : {},
        body: formData,
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Run failed');
      data = json;
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err));
      setSubmitting(false);
      return;
    }

    setSessionId(data.sessionId);
    setCollectionName(data.collectionName);
    setEndpoints([]);
    setSummary(null);
    setExpandedIdx(null);
    setPhase('running');
    setSubmitting(false);

    // Subscribe to SSE stream
    const stream = new EventSource(`/api/api-testing/stream/${data.sessionId}?token=${token}`);
    sseRef.current = stream;

    stream.onmessage = (e) => {
      const event = JSON.parse(e.data) as { type: string; data: Record<string, unknown> };
      handleSseEvent(event.type, event.data);
    };

    stream.onerror = () => {
      stream.close();
    };
  }

  function handleSseEvent(type: string, data: Record<string, unknown>) {
    // Safe updater — strips any undefined holes from the sparse array before mapping
    const safeMap = (
      prev: EndpointState[],
      fn: (ep: EndpointState) => EndpointState
    ) => prev.filter((ep): ep is EndpointState => ep != null).map(fn);

    if (type === 'endpoint_start') {
      const newEp: EndpointState = {
        index: data.index as number,
        name: data.name as string,
        method: data.method as string,
        url: data.url as string,
        phase: 'generating',
        testCount: 0,
        results: [],
      };
      setEndpoints(prev => {
        const clean = prev.filter((ep): ep is EndpointState => ep != null);
        const existing = clean.findIndex(ep => ep.index === newEp.index);
        if (existing >= 0) {
          const next = [...clean];
          next[existing] = newEp;
          return next;
        }
        return [...clean, newEp].sort((a, b) => a.index - b.index);
      });
    }

    if (type === 'tests_generated') {
      setEndpoints(prev => safeMap(prev, ep =>
        ep.index === data.index
          ? { ...ep, phase: 'executing', testCount: data.count as number }
          : ep
      ));
    }

    if (type === 'test_result') {
      const result: TestResultItem = {
        description: data.description as string,
        type: data.type as string,
        status: data.status as TestResultItem['status'],
        actualStatus: data.actualStatus as number,
        expectedStatus: data.expectedStatus as number,
        durationMs: data.durationMs as number,
        error: data.error as string | undefined,
      };
      setEndpoints(prev => safeMap(prev, ep =>
        ep.index === data.endpointIndex
          ? { ...ep, results: [...ep.results, result] }
          : ep
      ));
    }

    if (type === 'endpoint_done') {
      setEndpoints(prev => safeMap(prev, ep =>
        ep.index === data.index ? { ...ep, phase: 'done' } : ep
      ));
    }

    if (type === 'endpoint_error') {
      setEndpoints(prev => safeMap(prev, ep =>
        ep.index === data.index
          ? { ...ep, phase: 'error', error: data.error as string }
          : ep
      ));
    }

    if (type === 'complete') {
      setSummary({
        total: data.total as number,
        passed: data.passed as number,
        failed: data.failed as number,
        errored: data.errored as number,
      });
      setPhase('complete');
      sseRef.current?.close();
    }

    if (type === 'error') {
      setError(data.error as string);
      setPhase('complete');
      sseRef.current?.close();
    }
  }

  async function handleDownloadReport() {
    const token = localStorage.getItem('shipsafe_token');
    const res = await fetch(`/api/api-testing/sessions/${sessionId}/report`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
    });
    const html = await res.text();
    const blob = new Blob([html], { type: 'text/html' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `shipsafe-report-${sessionId.slice(0, 8)}.html`;
    a.click();
    URL.revokeObjectURL(url);
  }

  function handleReset() {
    sseRef.current?.close();
    setPhase('upload');
    setCollectionFile(null);
    setEnvFile(null);
    setEndpoints([]);
    setSummary(null);
    setError('');
    setSessionId('');
  }

  // ---- Render ----

  return (
    <div className="p-8 max-w-4xl mx-auto">
      {/* Header */}
      <div className="mb-8">
        <div className="flex items-center gap-3 mb-2">
          <div className="w-8 h-8 rounded-lg bg-amber-600/20 flex items-center justify-center">
            <Zap className="w-4 h-4 text-amber-400" />
          </div>
          <h1 className="text-2xl font-semibold text-white">API Testing</h1>
        </div>
        <p className="text-gray-500 text-sm">
          Upload a Postman collection. AI generates real payloads, runs tests concurrently, and streams results live.
        </p>
      </div>

      {/* Upload phase */}
      {phase === 'upload' && (
        <div className="space-y-4">
          {/* Collection drop zone */}
          <div
            className={`card border-2 border-dashed transition-colors cursor-pointer ${
              dragging ? 'border-amber-500/60 bg-amber-500/5' : 'border-gray-700 hover:border-gray-600'
            } ${collectionFile ? 'border-amber-500/40' : ''}`}
            onDragOver={e => { e.preventDefault(); setDragging(true); }}
            onDragLeave={() => setDragging(false)}
            onDrop={handleDrop}
            onClick={() => collectionInputRef.current?.click()}
          >
            <input
              ref={collectionInputRef}
              type="file"
              accept=".json"
              className="hidden"
              onChange={e => { if (e.target.files?.[0]) setCollectionFile(e.target.files[0]); }}
            />
            <div className="p-8 text-center">
              {collectionFile ? (
                <div className="flex items-center justify-center gap-3">
                  <FileJson className="w-6 h-6 text-amber-400" />
                  <span className="text-white font-medium">{collectionFile.name}</span>
                  <button
                    className="text-gray-500 hover:text-gray-300"
                    onClick={e => { e.stopPropagation(); setCollectionFile(null); }}
                  >
                    <X className="w-4 h-4" />
                  </button>
                </div>
              ) : (
                <>
                  <Upload className="w-10 h-10 text-gray-600 mx-auto mb-3" />
                  <p className="text-gray-400 font-medium">Drop Postman collection here</p>
                  <p className="text-gray-600 text-sm mt-1">or click to browse — .json only</p>
                </>
              )}
            </div>
          </div>

          {/* Optional env file */}
          <div
            className="card border border-gray-700/50 hover:border-gray-600 transition-colors cursor-pointer"
            onClick={() => envInputRef.current?.click()}
          >
            <input
              ref={envInputRef}
              type="file"
              accept=".json"
              className="hidden"
              onChange={e => { if (e.target.files?.[0]) setEnvFile(e.target.files[0]); }}
            />
            <div className="px-5 py-3 flex items-center gap-3">
              <FileJson className="w-4 h-4 text-gray-500" />
              {envFile ? (
                <div className="flex items-center gap-2 flex-1">
                  <span className="text-sm text-gray-300">{envFile.name}</span>
                  <button
                    className="text-gray-500 hover:text-gray-300 ml-auto"
                    onClick={e => { e.stopPropagation(); setEnvFile(null); }}
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                </div>
              ) : (
                <span className="text-sm text-gray-500">Add environment file (optional) — resolves <code className="text-xs">{'{{variables}}'}</code></span>
              )}
            </div>
          </div>

          {error && (
            <div className="card bg-red-500/10 border-red-500/20 px-4 py-3 text-red-400 text-sm">
              {error}
            </div>
          )}

          <button
            className="btn-primary w-full flex items-center justify-center gap-2"
            disabled={!collectionFile || submitting}
            onClick={handleRun}
          >
            {submitting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Play className="w-4 h-4" />}
            {submitting ? 'Queuing…' : 'Run Tests'}
          </button>
        </div>
      )}

      {/* Running / Complete phase */}
      {(phase === 'running' || phase === 'complete') && (
        <div className="space-y-4">
          {/* Header row */}
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-white font-semibold">{collectionName}</h2>
              <p className="text-gray-500 text-xs mt-0.5">
                {phase === 'running' ? 'Running…' : `Session ${sessionId.slice(0, 8)}`}
              </p>
            </div>
            {phase === 'complete' && (
              <div className="flex gap-2">
                <button className="btn-secondary flex items-center gap-2 text-sm" onClick={handleReset}>
                  <RotateCcw className="w-3.5 h-3.5" /> Run again
                </button>
                {summary && (
                  <button className="btn-primary flex items-center gap-2 text-sm" onClick={handleDownloadReport}>
                    <Download className="w-3.5 h-3.5" /> Download report
                  </button>
                )}
              </div>
            )}
          </div>

          {/* Summary bar */}
          {summary && (
            <div className="grid grid-cols-4 gap-3">
              {[
                { label: 'Total', value: summary.total, cls: 'text-gray-200' },
                { label: 'Passed', value: summary.passed, cls: 'text-green-400' },
                { label: 'Failed', value: summary.failed, cls: 'text-red-400' },
                { label: 'Errors', value: summary.errored, cls: 'text-amber-400' },
              ].map(({ label, value, cls }) => (
                <div key={label} className="card bg-surface px-4 py-3 text-center">
                  <div className={`text-2xl font-bold ${cls}`}>{value}</div>
                  <div className="text-xs text-gray-500 mt-0.5">{label}</div>
                </div>
              ))}
            </div>
          )}

          {error && (
            <div className="card bg-red-500/10 border-red-500/20 px-4 py-3 text-red-400 text-sm">
              {error}
            </div>
          )}

          {/* Endpoint cards */}
          {(endpoints.filter((ep): ep is EndpointState => ep != null)).map((ep) => {
            const isExpanded = expandedIdx === ep.index;
            const epPassed = ep.results.filter(r => r.status === 'passed').length;
            const hasResults = ep.results.length > 0;

            return (
              <div key={ep.index} className="card overflow-hidden">
                <button
                  className="w-full px-4 py-3 flex items-center gap-3 hover:bg-gray-800/30 transition-colors text-left"
                  onClick={() => setExpandedIdx(isExpanded ? null : ep.index)}
                >
                  {ep.phase === 'done' || ep.phase === 'error' ? (
                    isExpanded ? <ChevronDown className="w-4 h-4 text-gray-500 shrink-0" /> : <ChevronRight className="w-4 h-4 text-gray-500 shrink-0" />
                  ) : (
                    <Loader2 className="w-4 h-4 text-amber-400 animate-spin shrink-0" />
                  )}

                  <MethodBadge method={ep.method} />

                  <span className="text-sm font-medium text-gray-200 truncate flex-1">{ep.name}</span>
                  <span className="text-xs text-gray-600 font-mono truncate max-w-[200px] hidden sm:block">{ep.url}</span>

                  {ep.phase === 'generating' && (
                    <span className="text-xs text-amber-400/70 shrink-0">generating…</span>
                  )}
                  {ep.phase === 'executing' && (
                    <span className="text-xs text-blue-400/70 shrink-0">
                      {ep.results.length}/{ep.testCount}
                    </span>
                  )}
                  {ep.phase === 'done' && hasResults && (
                    <span className={`text-xs shrink-0 font-medium ${epPassed === ep.results.length ? 'text-green-400' : epPassed === 0 ? 'text-red-400' : 'text-amber-400'}`}>
                      {epPassed}/{ep.results.length}
                    </span>
                  )}
                  {ep.phase === 'error' && (
                    <span className="text-xs text-red-400 shrink-0">error</span>
                  )}
                </button>

                {isExpanded && (
                  <div className="border-t border-gray-700/50">
                    {ep.phase === 'error' && (
                      <div className="px-4 py-3 text-red-400 text-sm bg-red-500/5">{ep.error}</div>
                    )}
                    {ep.results.map((r, j) => (
                      <div key={j} className="px-4 py-2.5 border-b border-gray-700/30 last:border-0 flex items-start gap-3">
                        <StatusIcon status={r.status} />
                        <div className="flex-1 min-w-0">
                          <p className="text-sm text-gray-300">{r.description}</p>
                          {r.error && <p className="text-xs text-red-400 mt-0.5">{r.error}</p>}
                        </div>
                        <div className="text-right shrink-0">
                          <div className="text-xs text-gray-500 font-mono">
                            {r.expectedStatus} → {r.actualStatus ?? '—'}
                          </div>
                          <div className="text-xs text-gray-600">{r.durationMs}ms</div>
                        </div>
                      </div>
                    ))}
                    {(ep.phase === 'executing' || ep.phase === 'generating') && ep.results.length === 0 && (
                      <div className="px-4 py-3 text-gray-600 text-sm flex items-center gap-2">
                        <Loader2 className="w-3.5 h-3.5 animate-spin" />
                        {ep.phase === 'generating' ? 'Generating test cases…' : 'Running tests…'}
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}

          {phase === 'running' && endpoints.length === 0 && (
            <div className="card px-4 py-8 text-center">
              <Loader2 className="w-6 h-6 text-amber-400 animate-spin mx-auto mb-3" />
              <p className="text-gray-500 text-sm">Connecting…</p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
