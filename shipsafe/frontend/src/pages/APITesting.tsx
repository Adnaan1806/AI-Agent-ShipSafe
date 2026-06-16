import React, { useState, useRef, useEffect } from 'react';
import {
  Zap, Upload, FileJson, X, CheckCircle2, XCircle, AlertTriangle,
  ChevronDown, ChevronRight, Loader2, Download, RotateCcw, Play,
  Shield, Gauge, Bot, Globe, ChevronUp, Info, Cpu, Cloud,
} from 'lucide-react';

// ── Types ─────────────────────────────────────────────────────────────────

type Mode = 'standard' | 'openapi' | 'security' | 'autonomous';

interface RunResponse {
  sessionId: string;
  endpointCount: number;
  collectionName?: string;
  specName?: string;
}

interface AssertionResult {
  type: string;
  field?: string;
  passed: boolean;
  message: string;
}

interface TestResultItem {
  description: string;
  type?: string;
  status: 'passed' | 'failed' | 'error';
  actualStatus?: number;
  expectedStatus: number;
  durationMs: number;
  error?: string;
  severity?: string;
  category?: string;
  assertionResults?: AssertionResult[];
  assertionsPassed?: boolean;
  assertionSummary?: string;
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

interface Summary {
  total: number;
  passed: number;
  failed: number;
  errored: number;
}

interface Coverage {
  functional: number;
  negative: number;
  auth: number;
  schema: number;
  statusCodes: number;
  overall: number;
}

interface SecuritySummary {
  score: number;
  grade: string;
  total: number;
  vulnerabilities: number;
  breakdown: Record<string, number>;
}

interface RcaItem {
  description: string;
  rootCause: string;
  confidence: number;
  category: string;
  suggestedFix: string;
  investigationSteps?: string[];
}

interface PerformanceResult {
  endpoint: string;
  grade: string;
  score: number;
  metrics: {
    p50: number; p95: number; p99: number;
    avg: number; errorRate: number; throughputRps: number; totalRequests: number;
  };
  issues?: string[];
}

// ── Helpers ────────────────────────────────────────────────────────────────

const METHOD_COLORS: Record<string, string> = {
  GET: 'text-blue-400 bg-blue-500/10',
  POST: 'text-green-400 bg-green-500/10',
  PUT: 'text-amber-400 bg-amber-500/10',
  PATCH: 'text-orange-400 bg-orange-500/10',
  DELETE: 'text-red-400 bg-red-500/10',
};

function MethodBadge({ method }: { method: string }) {
  const cls = METHOD_COLORS[method] ?? 'text-gray-400 bg-gray-500/10';
  return <span className={`inline-block text-[10px] font-bold px-2 py-0.5 rounded font-mono ${cls}`}>{method}</span>;
}

function StatusIcon({ status }: { status: 'passed' | 'failed' | 'error' }) {
  if (status === 'passed') return <CheckCircle2 className="w-4 h-4 text-green-400 shrink-0" />;
  if (status === 'failed') return <XCircle className="w-4 h-4 text-red-400 shrink-0" />;
  return <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0" />;
}

function GradeChip({ grade, score }: { grade: string; score: number }) {
  const colors: Record<string, string> = {
    A: 'text-green-400 bg-green-500/10 border-green-500/20',
    B: 'text-blue-400 bg-blue-500/10 border-blue-500/20',
    C: 'text-amber-400 bg-amber-500/10 border-amber-500/20',
    D: 'text-orange-400 bg-orange-500/10 border-orange-500/20',
    F: 'text-red-400 bg-red-500/10 border-red-500/20',
  };
  const cls = colors[grade] ?? 'text-gray-400 bg-gray-500/10 border-gray-500/20';
  return (
    <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-sm font-bold border ${cls}`}>
      {grade} <span className="font-normal opacity-75">{score}/100</span>
    </span>
  );
}

const MODES: { id: Mode; label: string; desc: string; icon: React.ReactNode }[] = [
  { id: 'standard', label: 'Standard', desc: 'AI-generated tests with assertions', icon: <Zap className="w-4 h-4" /> },
  { id: 'openapi', label: 'OpenAPI', desc: 'From Swagger / OpenAPI spec URL or file', icon: <Globe className="w-4 h-4" /> },
  { id: 'security', label: 'Security', desc: 'Standard + OWASP security probes', icon: <Shield className="w-4 h-4" /> },
  { id: 'autonomous', label: 'Autonomous', desc: 'Full pipeline: tests + security + perf + RCA', icon: <Bot className="w-4 h-4" /> },
];

// ── Main component ─────────────────────────────────────────────────────────

type Provider = 'groq' | 'ollama';

const PROVIDERS: { id: Provider; label: string; sublabel: string; icon: React.ReactNode; note?: string }[] = [
  { id: 'groq', label: 'Groq', sublabel: 'llama-3.3-70b · cloud', icon: <Cloud className="w-4 h-4" /> },
  { id: 'ollama', label: 'Ollama', sublabel: 'local · unlimited · private', icon: <Cpu className="w-4 h-4" />, note: 'requires local setup' },
];

export default function APITesting() {
  const [mode, setMode] = useState<Mode>('standard');
  const [provider, setProvider] = useState<Provider>('groq');
  const [phase, setPhase] = useState<'upload' | 'running' | 'complete'>('upload');

  // Upload inputs
  const [collectionFile, setCollectionFile] = useState<File | null>(null);
  const [envFile, setEnvFile] = useState<File | null>(null);
  const [openApiUrl, setOpenApiUrl] = useState('');
  const [openApiFile, setOpenApiFile] = useState<File | null>(null);
  const [dragging, setDragging] = useState(false);

  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  // Run state
  const [sessionId, setSessionId] = useState('');
  const [collectionName, setCollectionName] = useState('');
  const [endpoints, setEndpoints] = useState<EndpointState[]>([]);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [expandedIdx, setExpandedIdx] = useState<number | null>(null);
  const [currentPhaseLabel, setCurrentPhaseLabel] = useState('');

  // Enhanced results
  const [coverage, setCoverage] = useState<Coverage | null>(null);
  const [securitySummary, setSecuritySummary] = useState<SecuritySummary | null>(null);
  const [rcaFindings, setRcaFindings] = useState<RcaItem[]>([]);
  const [performanceResults, setPerformanceResults] = useState<PerformanceResult[]>([]);
  const [driftCount, setDriftCount] = useState(0);

  const collectionInputRef = useRef<HTMLInputElement>(null);
  const envInputRef = useRef<HTMLInputElement>(null);
  const openApiFileRef = useRef<HTMLInputElement>(null);
  const sseRef = useRef<EventSource | null>(null);

  useEffect(() => () => { sseRef.current?.close(); }, []);

  function handleDrop(e: React.DragEvent) {
    e.preventDefault();
    setDragging(false);
    const file = e.dataTransfer.files[0];
    if (file?.name.endsWith('.json')) {
      if (mode === 'openapi') setOpenApiFile(file);
      else setCollectionFile(file);
    }
  }

  async function handleRun() {
    setError('');
    setSubmitting(true);

    const token = localStorage.getItem('shipsafe_token');
    const authHeader = token ? { Authorization: `Bearer ${token}` } : {};

    let url = '/api/api-testing/run';
    let body: FormData | undefined;

    if (mode === 'openapi') {
      if (!openApiUrl && !openApiFile) {
        setError('Provide an OpenAPI spec URL or file');
        setSubmitting(false);
        return;
      }
      url = '/api/api-testing/run-openapi';
      body = new FormData();
      if (openApiFile) body.append('spec', openApiFile);
      else body.append('url', openApiUrl);
      if (envFile) body.append('env', envFile);
      body.append('provider', provider);
    } else {
      if (!collectionFile) { setError('Collection file is required'); setSubmitting(false); return; }
      const endpoint = mode === 'autonomous' ? '/api/api-testing/autonomous' : '/api/api-testing/run';
      url = endpoint;
      body = new FormData();
      body.append('collection', collectionFile);
      if (envFile) body.append('env', envFile);
      body.append('provider', provider);
    }

    let data: RunResponse;
    try {
      const res = await fetch(url, { method: 'POST', headers: authHeader as HeadersInit, body });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Run failed');
      data = json;
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err));
      setSubmitting(false);
      return;
    }

    setSessionId(data.sessionId);
    setCollectionName(data.collectionName ?? data.specName ?? 'API Tests');
    setEndpoints([]);
    setSummary(null);
    setCoverage(null);
    setSecuritySummary(null);
    setRcaFindings([]);
    setPerformanceResults([]);
    setDriftCount(0);
    setCurrentPhaseLabel('');
    setExpandedIdx(null);
    setPhase('running');
    setSubmitting(false);

    const stream = new EventSource(`/api/api-testing/stream/${data.sessionId}?token=${token}`);
    sseRef.current = stream;
    stream.onmessage = (e) => {
      const event = JSON.parse(e.data) as { type: string; data: Record<string, unknown> };
      handleSseEvent(event.type, event.data);
    };
    stream.onerror = () => stream.close();

    // For security mode, also run security after standard tests complete
    if (mode === 'security') {
      stream.addEventListener('complete', () => {
        fetch(`/api/api-testing/sessions/${data.sessionId}/security`, {
          method: 'POST',
          headers: authHeader as HeadersInit,
        }).catch(() => {});
      }, { once: true });
    }
  }

  function handleSseEvent(type: string, data: Record<string, unknown>) {
    const safeMap = (prev: EndpointState[], fn: (ep: EndpointState) => EndpointState) =>
      prev.filter((ep): ep is EndpointState => ep != null).map(fn);

    switch (type) {
      case 'phase_change':
        setCurrentPhaseLabel(data.label as string ?? data.phase as string ?? '');
        break;

      case 'endpoint_start': {
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
          const idx = clean.findIndex(ep => ep.index === newEp.index);
          if (idx >= 0) { const next = [...clean]; next[idx] = newEp; return next; }
          return [...clean, newEp].sort((a, b) => a.index - b.index);
        });
        break;
      }

      case 'tests_generated':
        setEndpoints(prev => safeMap(prev, ep =>
          ep.index === data.index ? { ...ep, phase: 'executing', testCount: data.count as number } : ep
        ));
        break;

      case 'test_result': {
        const r: TestResultItem = {
          description: data.description as string,
          type: data.type as string,
          status: data.status as TestResultItem['status'],
          actualStatus: data.actualStatus as number,
          expectedStatus: data.expectedStatus as number,
          durationMs: data.durationMs as number,
          error: data.error as string | undefined,
          assertionResults: data.assertionResults as AssertionResult[] | undefined,
          assertionsPassed: data.assertionsPassed as boolean | undefined,
          assertionSummary: data.assertionSummary as string | undefined,
        };
        setEndpoints(prev => safeMap(prev, ep =>
          ep.index === data.endpointIndex ? { ...ep, results: [...ep.results, r] } : ep
        ));
        break;
      }

      case 'security_result': {
        const sr: TestResultItem = {
          description: data.description as string,
          type: 'security',
          status: data.status as TestResultItem['status'],
          actualStatus: data.actualStatus as number,
          expectedStatus: data.expectedStatus as number,
          durationMs: data.durationMs as number,
          error: data.error as string | undefined,
          severity: data.severity as string,
          category: data.category as string,
        };
        // Add to a synthetic "Security" endpoint group
        setEndpoints(prev => {
          const clean = prev.filter((ep): ep is EndpointState => ep != null);
          const secIdx = 9999;
          const existing = clean.find(ep => ep.index === secIdx);
          if (existing) {
            return clean.map(ep => ep.index === secIdx ? { ...ep, results: [...ep.results, sr] } : ep);
          }
          return [...clean, {
            index: secIdx, name: 'Security Tests', method: 'SEC', url: '', phase: 'executing' as const, testCount: 0, results: [sr],
          }];
        });
        break;
      }

      case 'security_done':
        setSecuritySummary(data.summary as SecuritySummary);
        setEndpoints(prev => prev.map(ep => ep.index === 9999 ? { ...ep, phase: 'done' } : ep));
        break;

      case 'endpoint_done':
        setEndpoints(prev => safeMap(prev, ep =>
          ep.index === data.index ? { ...ep, phase: 'done' } : ep
        ));
        break;

      case 'endpoint_error':
        setEndpoints(prev => safeMap(prev, ep =>
          ep.index === data.index ? { ...ep, phase: 'error', error: data.error as string } : ep
        ));
        break;

      case 'coverage':
        setCoverage(data.coverage as Coverage);
        break;

      case 'performance_result':
        setPerformanceResults(prev => [...prev, data as unknown as PerformanceResult]);
        break;

      case 'rca_batch':
        setRcaFindings((data.analyses as RcaItem[]) ?? []);
        break;

      case 'complete':
        setSummary({
          total: data.total as number,
          passed: data.passed as number,
          failed: data.failed as number,
          errored: data.errored as number,
        });
        if (data.coverage) setCoverage(data.coverage as Coverage);
        if (data.securitySummary) setSecuritySummary(data.securitySummary as SecuritySummary);
        if (data.driftCount) setDriftCount(data.driftCount as number);
        setPhase('complete');
        setCurrentPhaseLabel('');
        sseRef.current?.close();
        break;

      case 'error':
        setError(data.error as string);
        setPhase('complete');
        sseRef.current?.close();
        break;
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
    a.href = url; a.download = `shipsafe-report-${sessionId.slice(0, 8)}.html`; a.click();
    URL.revokeObjectURL(url);
  }

  function handleReset() {
    sseRef.current?.close();
    setPhase('upload');
    setProvider('groq');
    setCollectionFile(null);
    setOpenApiFile(null);
    setOpenApiUrl('');
    setEnvFile(null);
    setEndpoints([]);
    setSummary(null);
    setCoverage(null);
    setSecuritySummary(null);
    setRcaFindings([]);
    setPerformanceResults([]);
    setDriftCount(0);
    setError('');
    setSessionId('');
    setCurrentPhaseLabel('');
  }

  // ── Render ───────────────────────────────────────────────────────────────

  return (
    <div className="p-8 max-w-4xl mx-auto">
      {/* Header */}
      <div className="mb-6">
        <div className="flex items-center gap-3 mb-2">
          <div className="w-8 h-8 rounded-lg bg-amber-600/20 flex items-center justify-center">
            <Zap className="w-4 h-4 text-amber-400" />
          </div>
          <h1 className="text-2xl font-semibold text-white">API Testing</h1>
        </div>
        <p className="text-gray-500 text-sm">
          AI generates real payloads with assertions, validates schemas, runs security probes, and streams results live.
        </p>
      </div>

      {/* Upload phase */}
      {phase === 'upload' && (
        <div className="space-y-4">
          {/* Mode selector */}
          <div className="grid grid-cols-4 gap-2">
            {MODES.map(m => (
              <button
                key={m.id}
                onClick={() => setMode(m.id)}
                className={`card px-3 py-3 text-left transition-all ${
                  mode === m.id
                    ? 'border-amber-500/50 bg-amber-500/5'
                    : 'border-gray-700/50 hover:border-gray-600'
                }`}
              >
                <div className={`flex items-center gap-2 mb-1 ${mode === m.id ? 'text-amber-400' : 'text-gray-400'}`}>
                  {m.icon}
                  <span className="text-xs font-semibold">{m.label}</span>
                </div>
                <p className="text-[11px] text-gray-600 leading-tight">{m.desc}</p>
              </button>
            ))}
          </div>

          {/* Model selector */}
          <div>
            <p className="text-xs text-gray-500 mb-2">AI model</p>
            <div className="grid grid-cols-2 gap-2">
              {PROVIDERS.map(p => (
                <button
                  key={p.id}
                  onClick={() => setProvider(p.id)}
                  className={`card px-3 py-2.5 text-left transition-all ${
                    provider === p.id
                      ? 'border-amber-500/50 bg-amber-500/5'
                      : 'border-gray-700/50 hover:border-gray-600'
                  }`}
                >
                  <div className={`flex items-center gap-2 mb-0.5 ${provider === p.id ? 'text-amber-400' : 'text-gray-400'}`}>
                    {p.icon}
                    <span className="text-xs font-semibold">{p.label}</span>
                    {p.note && <span className="text-[10px] text-gray-600 ml-auto">{p.note}</span>}
                  </div>
                  <p className="text-[11px] text-gray-600">{p.sublabel}</p>
                </button>
              ))}
            </div>
          </div>

          {/* OpenAPI URL or file */}
          {mode === 'openapi' ? (
            <div className="space-y-2">
              <div className="card border border-gray-700/50 px-4 py-3">
                <label className="block text-xs text-gray-500 mb-1.5">Swagger / OpenAPI spec URL</label>
                <input
                  type="url"
                  className="w-full bg-transparent text-gray-200 text-sm outline-none placeholder-gray-600"
                  placeholder="https://api.example.com/openapi.json"
                  value={openApiUrl}
                  onChange={e => { setOpenApiUrl(e.target.value); setOpenApiFile(null); }}
                />
              </div>
              <div className="text-center text-xs text-gray-600">— or upload a JSON / YAML file —</div>
              <div
                className={`card border-2 border-dashed transition-colors cursor-pointer ${
                  dragging ? 'border-amber-500/60 bg-amber-500/5' : openApiFile ? 'border-amber-500/40' : 'border-gray-700 hover:border-gray-600'
                }`}
                onDragOver={e => { e.preventDefault(); setDragging(true); }}
                onDragLeave={() => setDragging(false)}
                onDrop={handleDrop}
                onClick={() => openApiFileRef.current?.click()}
              >
                <input ref={openApiFileRef} type="file" accept=".json,.yaml,.yml" className="hidden"
                  onChange={e => { if (e.target.files?.[0]) { setOpenApiFile(e.target.files[0]); setOpenApiUrl(''); } }} />
                <div className="p-6 text-center">
                  {openApiFile ? (
                    <div className="flex items-center justify-center gap-3">
                      <FileJson className="w-5 h-5 text-amber-400" />
                      <span className="text-white font-medium text-sm">{openApiFile.name}</span>
                      <button className="text-gray-500 hover:text-gray-300" onClick={e => { e.stopPropagation(); setOpenApiFile(null); }}>
                        <X className="w-4 h-4" />
                      </button>
                    </div>
                  ) : (
                    <>
                      <Upload className="w-8 h-8 text-gray-600 mx-auto mb-2" />
                      <p className="text-gray-400 text-sm">Drop OpenAPI spec here (.json, .yaml, .yml)</p>
                    </>
                  )}
                </div>
              </div>
            </div>
          ) : (
            /* Postman collection drop zone */
            <div
              className={`card border-2 border-dashed transition-colors cursor-pointer ${
                dragging ? 'border-amber-500/60 bg-amber-500/5' : collectionFile ? 'border-amber-500/40' : 'border-gray-700 hover:border-gray-600'
              }`}
              onDragOver={e => { e.preventDefault(); setDragging(true); }}
              onDragLeave={() => setDragging(false)}
              onDrop={handleDrop}
              onClick={() => collectionInputRef.current?.click()}
            >
              <input ref={collectionInputRef} type="file" accept=".json" className="hidden"
                onChange={e => { if (e.target.files?.[0]) setCollectionFile(e.target.files[0]); }} />
              <div className="p-8 text-center">
                {collectionFile ? (
                  <div className="flex items-center justify-center gap-3">
                    <FileJson className="w-6 h-6 text-amber-400" />
                    <span className="text-white font-medium">{collectionFile.name}</span>
                    <button className="text-gray-500 hover:text-gray-300" onClick={e => { e.stopPropagation(); setCollectionFile(null); }}>
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
          )}

          {/* Optional env file (all modes) */}
          <div
            className="card border border-gray-700/50 hover:border-gray-600 transition-colors cursor-pointer"
            onClick={() => envInputRef.current?.click()}
          >
            <input ref={envInputRef} type="file" accept=".json" className="hidden"
              onChange={e => { if (e.target.files?.[0]) setEnvFile(e.target.files[0]); }} />
            <div className="px-5 py-3 flex items-center gap-3">
              <FileJson className="w-4 h-4 text-gray-500" />
              {envFile ? (
                <div className="flex items-center gap-2 flex-1">
                  <span className="text-sm text-gray-300">{envFile.name}</span>
                  <button className="text-gray-500 hover:text-gray-300 ml-auto"
                    onClick={e => { e.stopPropagation(); setEnvFile(null); }}>
                    <X className="w-3.5 h-3.5" />
                  </button>
                </div>
              ) : (
                <span className="text-sm text-gray-500">Add environment file (optional) — resolves <code className="text-xs">{'{{variables}}'}</code></span>
              )}
            </div>
          </div>

          {error && <div className="card bg-red-500/10 border-red-500/20 px-4 py-3 text-red-400 text-sm">{error}</div>}

          <button
            className="btn-primary w-full flex items-center justify-center gap-2"
            disabled={submitting || (mode !== 'openapi' ? !collectionFile : (!openApiUrl && !openApiFile))}
            onClick={handleRun}
          >
            {submitting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Play className="w-4 h-4" />}
            {submitting ? 'Starting…' : `Run ${MODES.find(m2 => m2.id === mode)?.label} Tests`}
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
                {phase === 'running'
                  ? currentPhaseLabel || 'Running…'
                  : `Session ${sessionId.slice(0, 8)}`}
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

          {/* Summary cards */}
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

          {/* Coverage panel */}
          {coverage && <CoveragePanel coverage={coverage} />}

          {/* Security panel */}
          {securitySummary && <SecurityPanel summary={securitySummary} />}

          {/* Performance panel */}
          {performanceResults.length > 0 && <PerformancePanel results={performanceResults} />}

          {/* RCA panel */}
          {rcaFindings.length > 0 && <RcaPanel findings={rcaFindings} />}

          {/* Drift notice */}
          {driftCount > 0 && (
            <div className="card border-amber-500/30 bg-amber-500/5 px-4 py-3 flex items-center gap-3">
              <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0" />
              <span className="text-amber-300 text-sm">
                Contract drift detected in {driftCount} endpoint(s). Download report for details.
              </span>
            </div>
          )}

          {error && <div className="card bg-red-500/10 border-red-500/20 px-4 py-3 text-red-400 text-sm">{error}</div>}

          {/* Endpoint cards */}
          {endpoints.filter((ep): ep is EndpointState => ep != null).map(ep => {
            const isExpanded = expandedIdx === ep.index;
            const epPassed = ep.results.filter(r => r.status === 'passed').length;
            const isSec = ep.index === 9999;

            return (
              <div key={ep.index} className="card overflow-hidden">
                <button
                  className="w-full px-4 py-3 flex items-center gap-3 hover:bg-gray-800/30 transition-colors text-left"
                  onClick={() => setExpandedIdx(isExpanded ? null : ep.index)}
                >
                  {ep.phase === 'done' || ep.phase === 'error'
                    ? isExpanded ? <ChevronDown className="w-4 h-4 text-gray-500 shrink-0" /> : <ChevronRight className="w-4 h-4 text-gray-500 shrink-0" />
                    : <Loader2 className="w-4 h-4 text-amber-400 animate-spin shrink-0" />}

                  {isSec
                    ? <span className="inline-block text-[10px] font-bold px-2 py-0.5 rounded font-mono text-red-400 bg-red-500/10">SEC</span>
                    : <MethodBadge method={ep.method} />}

                  <span className="text-sm font-medium text-gray-200 truncate flex-1">{ep.name}</span>
                  {!isSec && <span className="text-xs text-gray-600 font-mono truncate max-w-[200px] hidden sm:block">{ep.url}</span>}

                  {ep.phase === 'generating' && <span className="text-xs text-amber-400/70 shrink-0">generating…</span>}
                  {ep.phase === 'executing' && (
                    <span className="text-xs text-blue-400/70 shrink-0">{ep.results.length}{ep.testCount ? `/${ep.testCount}` : ''}</span>
                  )}
                  {ep.phase === 'done' && ep.results.length > 0 && (
                    <span className={`text-xs shrink-0 font-medium ${epPassed === ep.results.length ? 'text-green-400' : epPassed === 0 ? 'text-red-400' : 'text-amber-400'}`}>
                      {epPassed}/{ep.results.length}
                    </span>
                  )}
                  {ep.phase === 'error' && <span className="text-xs text-red-400 shrink-0">error</span>}
                </button>

                {isExpanded && (
                  <div className="border-t border-gray-700/50">
                    {ep.phase === 'error' && (
                      <div className="px-4 py-3 text-red-400 text-sm bg-red-500/5">{ep.error}</div>
                    )}
                    {ep.results.map((r, j) => (
                      <TestResultRow key={j} result={r} />
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

// ── Sub-components ─────────────────────────────────────────────────────────

function TestResultRow({ result }: { result: TestResultItem }) {
  const [showAssertions, setShowAssertions] = useState(false);
  const hasAssertions = (result.assertionResults?.length ?? 0) > 0;

  const sevColor: Record<string, string> = { CRITICAL: 'text-red-400', HIGH: 'text-orange-400', MEDIUM: 'text-amber-400', LOW: 'text-gray-400' };

  return (
    <div className="px-4 py-2.5 border-b border-gray-700/30 last:border-0">
      <div className="flex items-start gap-3">
        <StatusIcon status={result.status} />
        <div className="flex-1 min-w-0">
          <p className="text-sm text-gray-300">{result.description}</p>
          {result.severity && (
            <span className={`text-[10px] font-bold uppercase mr-2 ${sevColor[result.severity] ?? 'text-gray-500'}`}>
              [{result.severity}] {result.category}
            </span>
          )}
          {result.error && <p className="text-xs text-red-400 mt-0.5">{result.error}</p>}

          {/* Assertion summary */}
          {hasAssertions && (
            <button
              className="flex items-center gap-1 mt-1 text-[11px] text-gray-500 hover:text-gray-400"
              onClick={() => setShowAssertions(v => !v)}
            >
              {showAssertions ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
              <span className={result.assertionsPassed ? 'text-green-500' : 'text-amber-400'}>
                {result.assertionSummary ?? `${result.assertionResults?.filter(a => a.passed).length}/${result.assertionResults?.length} assertions`}
              </span>
            </button>
          )}
          {showAssertions && (
            <div className="mt-1.5 space-y-0.5 ml-1">
              {result.assertionResults?.map((a, i) => (
                <div key={i} className={`text-[11px] flex items-start gap-1 ${a.passed ? 'text-green-500/80' : 'text-red-400'}`}>
                  <span className="shrink-0 mt-px">{a.passed ? '✓' : '✗'}</span>
                  <span>{a.message}</span>
                </div>
              ))}
            </div>
          )}
        </div>
        <div className="text-right shrink-0">
          <div className="text-xs text-gray-500 font-mono">{result.expectedStatus} → {result.actualStatus ?? '—'}</div>
          <div className="text-xs text-gray-600">{result.durationMs}ms</div>
        </div>
      </div>
    </div>
  );
}

function CoveragePanel({ coverage }: { coverage: Coverage }) {
  const dims = [
    { label: 'Overall', val: coverage.overall, color: coverageColor(coverage.overall) },
    { label: 'Functional', val: coverage.functional, color: '#60a5fa' },
    { label: 'Negative', val: coverage.negative, color: '#fbbf24' },
    { label: 'Auth', val: coverage.auth, color: '#a78bfa' },
    { label: 'Schema', val: coverage.schema, color: '#34d399' },
    { label: 'Status Codes', val: coverage.statusCodes, color: '#fb923c' },
  ];

  return (
    <div className="card overflow-hidden">
      <div className="px-4 py-3 border-b border-gray-700/50 flex items-center gap-2">
        <Info className="w-4 h-4 text-blue-400" />
        <span className="text-sm font-medium text-gray-200">Test Coverage</span>
        <span className="ml-auto text-xs font-bold" style={{ color: coverageColor(coverage.overall) }}>
          {coverage.overall}% overall
        </span>
      </div>
      <div className="px-4 py-3 grid grid-cols-6 gap-3">
        {dims.map(d => (
          <div key={d.label} className="text-center">
            <div className="text-lg font-bold" style={{ color: d.color }}>{d.val}%</div>
            <div className="text-[10px] text-gray-600 mt-0.5">{d.label}</div>
            <div className="mt-1.5 h-1 bg-gray-700/50 rounded-full overflow-hidden">
              <div className="h-full rounded-full" style={{ width: `${d.val}%`, background: d.color }} />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function SecurityPanel({ summary }: { summary: SecuritySummary }) {
  return (
    <div className="card overflow-hidden">
      <div className="px-4 py-3 border-b border-gray-700/50 flex items-center gap-2">
        <Shield className="w-4 h-4 text-red-400" />
        <span className="text-sm font-medium text-gray-200">Security Analysis</span>
        <span className="ml-auto"><GradeChip grade={summary.grade} score={summary.score} /></span>
      </div>
      <div className="px-4 py-3">
        <div className="text-xs text-gray-500 mb-2">{summary.total} tests · {summary.vulnerabilities} potential vulnerabilities</div>
        <div className="flex gap-2 flex-wrap">
          {Object.entries(summary.breakdown ?? {}).map(([sev, cnt]) =>
            cnt > 0 ? (
              <span key={sev} className={`text-xs font-semibold px-2 py-0.5 rounded-full ${severityChipClass(sev)}`}>
                {cnt} {sev}
              </span>
            ) : null
          )}
          {summary.vulnerabilities === 0 && (
            <span className="text-xs text-green-400 font-medium">No vulnerabilities detected</span>
          )}
        </div>
      </div>
    </div>
  );
}

function PerformancePanel({ results }: { results: PerformanceResult[] }) {
  return (
    <div className="card overflow-hidden">
      <div className="px-4 py-3 border-b border-gray-700/50 flex items-center gap-2">
        <Gauge className="w-4 h-4 text-purple-400" />
        <span className="text-sm font-medium text-gray-200">Performance</span>
      </div>
      {results.map((p, i) => (
        <div key={i} className="px-4 py-3 border-b border-gray-700/30 last:border-0">
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs text-gray-400 font-mono truncate">{p.endpoint}</span>
            <GradeChip grade={p.grade} score={p.score} />
          </div>
          <div className="grid grid-cols-4 gap-2">
            {[
              { label: 'p50', val: `${p.metrics.p50}ms` },
              { label: 'p95', val: `${p.metrics.p95}ms` },
              { label: 'p99', val: `${p.metrics.p99}ms` },
              { label: 'RPS', val: p.metrics.throughputRps },
            ].map(m => (
              <div key={m.label} className="text-center bg-gray-800/50 rounded py-1.5">
                <div className="text-sm font-bold text-blue-400">{m.val}</div>
                <div className="text-[10px] text-gray-600">{m.label}</div>
              </div>
            ))}
          </div>
          {p.issues?.map((iss, j) => (
            <div key={j} className="text-xs text-amber-400 mt-1.5 flex items-center gap-1">
              <AlertTriangle className="w-3 h-3 shrink-0" /> {iss}
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}

function RcaPanel({ findings }: { findings: RcaItem[] }) {
  const [expanded, setExpanded] = useState<number | null>(null);
  return (
    <div className="card overflow-hidden">
      <div className="px-4 py-3 border-b border-gray-700/50 flex items-center gap-2">
        <Bot className="w-4 h-4 text-orange-400" />
        <span className="text-sm font-medium text-gray-200">AI Root Cause Analysis</span>
        <span className="ml-auto text-xs text-gray-500">{findings.length} failure{findings.length !== 1 ? 's' : ''} analyzed</span>
      </div>
      {findings.map((r, i) => (
        <div key={i} className="px-4 py-3 border-b border-gray-700/30 last:border-0">
          <button className="w-full text-left" onClick={() => setExpanded(expanded === i ? null : i)}>
            <div className="flex items-start gap-2">
              <XCircle className="w-4 h-4 text-red-400 shrink-0 mt-0.5" />
              <div className="flex-1 min-w-0">
                <p className="text-sm text-gray-300 truncate">{r.description}</p>
                <p className="text-xs text-gray-500 mt-0.5 line-clamp-1">{r.rootCause}</p>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <span className="text-[10px] text-gray-600 uppercase font-mono">{r.category}</span>
                <span className="text-[10px] text-gray-600">{Math.round(r.confidence * 100)}%</span>
                {expanded === i ? <ChevronUp className="w-3.5 h-3.5 text-gray-500" /> : <ChevronDown className="w-3.5 h-3.5 text-gray-500" />}
              </div>
            </div>
          </button>
          {expanded === i && (
            <div className="mt-3 ml-6 space-y-2">
              <div>
                <div className="text-[10px] text-gray-600 uppercase mb-0.5">Suggested Fix</div>
                <p className="text-xs text-blue-400">{r.suggestedFix}</p>
              </div>
              {r.investigationSteps?.length ? (
                <div>
                  <div className="text-[10px] text-gray-600 uppercase mb-1">Investigation Steps</div>
                  <ol className="space-y-0.5">
                    {r.investigationSteps.map((s, j) => (
                      <li key={j} className="text-xs text-gray-400 flex gap-1.5">
                        <span className="text-gray-600 shrink-0">{j + 1}.</span>
                        {s}
                      </li>
                    ))}
                  </ol>
                </div>
              ) : null}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

function coverageColor(score: number) {
  if (score >= 80) return '#34d399';
  if (score >= 60) return '#60a5fa';
  if (score >= 40) return '#fbbf24';
  return '#f87171';
}

function severityChipClass(sev: string) {
  const m: Record<string, string> = {
    CRITICAL: 'bg-red-500/15 text-red-400',
    HIGH: 'bg-orange-500/15 text-orange-400',
    MEDIUM: 'bg-amber-500/15 text-amber-400',
    LOW: 'bg-green-500/15 text-green-400',
  };
  return m[sev] ?? 'bg-gray-500/15 text-gray-400';
}
