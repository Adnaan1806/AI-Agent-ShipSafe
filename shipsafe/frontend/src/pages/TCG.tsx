import React, { useState, useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  Brain, Sparkles, ChevronDown, ChevronUp, Pencil, Trash2,
  Check, X, Download, Copy, CheckCheck, AlertTriangle, Loader2, Plus,
} from 'lucide-react';
import { api } from '../lib/api';
import { TestCase } from '../lib/types';

type Phase = 'input' | 'generating' | 'review' | 'loading';

interface LocalCase extends TestCase {
  _editing?: boolean;
}

interface GenerateResponse {
  suite: { id: string; name: string; status: string };
  scenarios: string[];
  impactedAreas: string[];
  cases?: TestCase[];
}

type SuiteResponse = { suite: { id: string; name: string; status: string; cases: TestCase[] } };

const TYPE_COLORS: Record<string, string> = {
  functional: 'bg-blue-500/15 text-blue-300 border-blue-500/20',
  negative:   'bg-red-500/15 text-red-300 border-red-500/20',
  edge:       'bg-yellow-500/15 text-yellow-300 border-yellow-500/20',
  security:   'bg-orange-500/15 text-orange-300 border-orange-500/20',
  ux:         'bg-purple-500/15 text-purple-300 border-purple-500/20',
};

const PRIORITY_COLORS: Record<string, string> = {
  P1: 'bg-red-500/20 text-red-300 border-red-500/25',
  P2: 'bg-amber-500/20 text-amber-300 border-amber-500/25',
  P3: 'bg-gray-500/15 text-gray-400 border-gray-500/20',
};

export default function TCG() {
  const [searchParams, setSearchParams] = useSearchParams();
  const [phase, setPhase] = useState<Phase>('input');
  const [requirementText, setRequirementText] = useState('');
  const [suiteName, setSuiteName] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    const suiteParam = searchParams.get('suite');
    if (!suiteParam) return;
    setPhase('loading');
    api.get<SuiteResponse>(`/api/tcg/suites/${suiteParam}`)
      .then(({ suite }) => {
        setSuiteId(suite.id);
        setSuiteNameSaved(suite.name);
        setSuiteStatus(suite.status as 'draft' | 'active');
        setScenarios([]);
        setImpactedAreas([]);
        setCases(suite.cases as LocalCase[]);
        setPhase('review');
        setSearchParams({}, { replace: true });
      })
      .catch(() => { setPhase('input'); setError('Suite not found'); });
  }, []);

  const [suiteId, setSuiteId] = useState('');
  const [suiteNameSaved, setSuiteNameSaved] = useState('');
  const [suiteStatus, setSuiteStatus] = useState<'draft' | 'active'>('draft');
  const [scenarios, setScenarios] = useState<string[]>([]);
  const [impactedAreas, setImpactedAreas] = useState<string[]>([]);
  const [cases, setCases] = useState<LocalCase[]>([]);

  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState<Partial<LocalCase>>({});
  const [activating, setActivating] = useState(false);
  const [copied, setCopied] = useState(false);
  const [showScenarios, setShowScenarios] = useState(true);

  async function handleGenerate(e: React.FormEvent) {
    e.preventDefault();
    if (!requirementText.trim()) return;
    setError('');
    setPhase('generating');

    try {
      const data = await api.post<GenerateResponse>('/api/tcg/generate', {
        requirementText: requirementText.trim(),
        suiteName: suiteName.trim() || undefined,
      });

      // fetch the full suite with cases (generate returns suite without cases inline)
      const { suite: full } = await api.get<SuiteResponse>(`/api/tcg/suites/${data.suite.id}`);

      setSuiteId(full.id);
      setSuiteNameSaved(full.name);
      setSuiteStatus(full.status as 'draft' | 'active');
      setScenarios(data.scenarios);
      setImpactedAreas(data.impactedAreas);
      setCases(full.cases as LocalCase[]);
      setExpandedIds(new Set());
      setEditingId(null);
      setPhase('review');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Generation failed');
      setPhase('input');
    }
  }

  function startEdit(tc: LocalCase) {
    setEditingId(tc.id);
    setExpandedIds(prev => new Set([...prev, tc.id]));
    setEditDraft({
      title: tc.title,
      type: tc.type,
      priority: tc.priority,
      preconditions: tc.preconditions,
      steps: [...tc.steps],
      expectedResult: tc.expectedResult,
    });
  }

  function cancelEdit() {
    setEditingId(null);
    setEditDraft({});
  }

  async function saveEdit(id: string) {
    try {
      await api.patch(`/api/tcg/cases/${id}`, editDraft);
      setCases(prev => prev.map(c => c.id === id ? { ...c, ...editDraft } : c));
      setEditingId(null);
      setEditDraft({});
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Save failed');
    }
  }

  async function addCase() {
    try {
      const { case: created } = await api.post<{ case: TestCase }>(`/api/tcg/suites/${suiteId}/cases`, {
        title: 'Untitled test case',
        type: 'functional',
        priority: 'P2',
        steps: ['Step 1: '],
      });
      const newCase = { ...created } as LocalCase;
      setCases(prev => [...prev, newCase]);
      setExpandedIds(prev => new Set([...prev, created.id]));
      setEditingId(created.id);
      setEditDraft({
        title: created.title,
        type: created.type,
        priority: created.priority,
        preconditions: '',
        steps: ['Step 1: '],
        expectedResult: '',
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to add case');
    }
  }

  async function deleteCase(id: string) {
    try {
      await api.delete(`/api/tcg/cases/${id}`);
      setCases(prev => prev.filter(c => c.id !== id));
      setExpandedIds(prev => { const next = new Set(prev); next.delete(id); return next; });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Delete failed');
    }
  }

  async function handleActivate() {
    setActivating(true);
    try {
      await api.post(`/api/tcg/suites/${suiteId}/activate`, {});
      setSuiteStatus('active');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Activate failed');
    } finally {
      setActivating(false);
    }
  }

  async function handleExport() {
    const token = localStorage.getItem('shipsafe_token');
    const res = await fetch(`/api/tcg/suites/${suiteId}/export`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) return setError('Export failed');
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${suiteNameSaved.replace(/[^a-z0-9]/gi, '_')}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }

  function handleCopy() {
    const text = cases.map((c, i) => [
      `TC-${String(i + 1).padStart(2, '0')}: ${c.title}`,
      `Type: ${c.type}  Priority: ${c.priority}`,
      c.preconditions ? `Preconditions: ${c.preconditions}` : '',
      'Steps:',
      ...c.steps.map(s => `  ${s}`),
      `Expected: ${c.expectedResult}`,
      '',
    ].filter(Boolean).join('\n')).join('\n---\n');
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }

  function updateDraftStep(idx: number, val: string) {
    const steps = [...(editDraft.steps || [])];
    steps[idx] = val;
    setEditDraft(d => ({ ...d, steps }));
  }

  function addDraftStep() {
    setEditDraft(d => ({ ...d, steps: [...(d.steps || []), `Step ${(d.steps?.length || 0) + 1}: ` ] }));
  }

  function removeDraftStep(idx: number) {
    const steps = (editDraft.steps || []).filter((_, i) => i !== idx);
    setEditDraft(d => ({ ...d, steps }));
  }

  // ---- Input phase ----
  if (phase === 'input') {
    return (
      <div className="p-8 max-w-3xl mx-auto">
        <div className="mb-8">
          <div className="flex items-center gap-3 mb-2">
            <div className="w-8 h-8 rounded-lg bg-violet-600/20 flex items-center justify-center">
              <Brain className="w-4 h-4 text-violet-400" />
            </div>
            <h1 className="text-2xl font-semibold text-white">Test Case Generator</h1>
          </div>
          <p className="text-gray-500 text-sm">
            Paste a requirement or acceptance criteria. AI brainstorms all scenarios and generates
            structured test cases with steps, priority, and expected results.
          </p>
        </div>

        <form onSubmit={handleGenerate} className="space-y-4">
          <div>
            <label className="label">Requirement / acceptance criteria</label>
            <textarea
              className="input min-h-[180px] resize-y font-mono text-xs leading-relaxed"
              placeholder={`As a user, I want to reset my password via email so that I can regain access to my account.\n\nAcceptance criteria:\n- Email field validates format\n- Reset link expires in 1 hour\n- Old password still works until link is clicked\n- Success page shown after reset`}
              value={requirementText}
              onChange={e => setRequirementText(e.target.value)}
              required
              autoFocus
            />
          </div>

          <div>
            <label className="label">Suite name <span className="text-gray-600">(optional — AI will suggest one)</span></label>
            <input
              className="input"
              placeholder="e.g. Password Reset — QA Suite"
              value={suiteName}
              onChange={e => setSuiteName(e.target.value)}
            />
          </div>

          {error && (
            <div className="flex items-center gap-2 text-red-400 text-sm bg-red-500/10 border border-red-500/20 rounded-lg px-3 py-2">
              <AlertTriangle className="w-4 h-4 shrink-0" />
              {error}
            </div>
          )}

          <button type="submit" className="btn-primary w-full justify-center py-2.5">
            <Sparkles className="w-4 h-4" />
            Generate test cases
          </button>
        </form>

        <div className="mt-8 grid grid-cols-2 gap-3">
          {[
            { title: 'All scenario types', desc: 'Functional, negative, edge, security, UX' },
            { title: 'Impact analysis', desc: 'Flags features at regression risk' },
            { title: 'Concrete test data', desc: 'Real values, not placeholders' },
            { title: 'Editable output', desc: 'Edit, add, remove cases before saving' },
          ].map(({ title, desc }) => (
            <div key={title} className="card bg-surface p-4">
              <p className="text-sm font-medium text-gray-300 mb-1">{title}</p>
              <p className="text-xs text-gray-600">{desc}</p>
            </div>
          ))}
        </div>
      </div>
    );
  }

  // ---- Loading / Generating phase ----
  if (phase === 'loading') {
    return (
      <div className="p-8 max-w-3xl mx-auto flex flex-col items-center justify-center min-h-[400px] gap-4">
        <Loader2 className="w-6 h-6 text-violet-400 animate-spin" />
        <p className="text-gray-500 text-sm">Loading suite…</p>
      </div>
    );
  }

  if (phase === 'generating') {
    return (
      <div className="p-8 max-w-3xl mx-auto flex flex-col items-center justify-center min-h-[400px] gap-4">
        <div className="w-12 h-12 rounded-2xl bg-violet-600/20 flex items-center justify-center">
          <Loader2 className="w-6 h-6 text-violet-400 animate-spin" />
        </div>
        <p className="text-white font-medium">AI is brainstorming…</p>
        <p className="text-gray-500 text-sm text-center max-w-xs">
          Analysing your requirement, identifying all scenarios, and generating structured test cases.
        </p>
      </div>
    );
  }

  // ---- Review phase ----
  const activeCases = cases.filter(c => c.status === 'active');

  return (
    <div className="p-8 max-w-4xl mx-auto">
      {/* Header */}
      <div className="flex items-start justify-between mb-6">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <h1 className="text-xl font-semibold text-white">{suiteNameSaved}</h1>
            <span className={`px-2 py-0.5 text-xs rounded-full border font-medium ${
              suiteStatus === 'active'
                ? 'bg-green-500/15 text-green-300 border-green-500/25'
                : 'bg-gray-500/15 text-gray-400 border-gray-500/20'
            }`}>
              {suiteStatus}
            </span>
          </div>
          <p className="text-gray-500 text-sm">{activeCases.length} test cases</p>
        </div>

        <div className="flex items-center gap-2">
          <button onClick={handleCopy} className="btn-secondary text-xs">
            {copied ? <CheckCheck className="w-3.5 h-3.5 text-green-400" /> : <Copy className="w-3.5 h-3.5" />}
            {copied ? 'Copied' : 'Copy'}
          </button>
          <button onClick={handleExport} className="btn-secondary text-xs">
            <Download className="w-3.5 h-3.5" />
            Export JSON
          </button>
          {suiteStatus === 'draft' && (
            <button onClick={handleActivate} disabled={activating} className="btn-primary text-xs">
              {activating ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5" />}
              Activate suite
            </button>
          )}
          <button
            onClick={() => { setPhase('input'); setError(''); }}
            className="btn-secondary text-xs"
          >
            New requirement
          </button>
        </div>
      </div>

      {error && (
        <div className="flex items-center gap-2 text-red-400 text-sm bg-red-500/10 border border-red-500/20 rounded-lg px-3 py-2 mb-4">
          <AlertTriangle className="w-4 h-4 shrink-0" />
          {error}
        </div>
      )}

      {/* Brainstorm summary */}
      {(scenarios.length > 0 || impactedAreas.length > 0) && (
        <div className="card mb-6 border-violet-500/20 bg-violet-600/5">
          <button
            className="flex items-center justify-between w-full text-left"
            onClick={() => setShowScenarios(s => !s)}
          >
            <div className="flex items-center gap-2">
              <Brain className="w-4 h-4 text-violet-400" />
              <span className="text-sm font-medium text-gray-300">AI brainstorm</span>
              <span className="text-xs text-gray-600">{scenarios.length} scenarios identified</span>
            </div>
            {showScenarios ? <ChevronUp className="w-4 h-4 text-gray-500" /> : <ChevronDown className="w-4 h-4 text-gray-500" />}
          </button>

          {showScenarios && (
            <div className="mt-4 space-y-3">
              {scenarios.length > 0 && (
                <div>
                  <p className="text-xs text-gray-500 mb-2 uppercase tracking-wider">Scenarios</p>
                  <div className="flex flex-wrap gap-2">
                    {scenarios.map(s => (
                      <span key={s} className="px-2.5 py-1 rounded-full bg-surface border border-white/5 text-xs text-gray-400">{s}</span>
                    ))}
                  </div>
                </div>
              )}
              {impactedAreas.length > 0 && (
                <div>
                  <p className="text-xs text-gray-500 mb-2 uppercase tracking-wider">Regression risk</p>
                  <div className="flex flex-wrap gap-2">
                    {impactedAreas.map(a => (
                      <span key={a} className="px-2.5 py-1 rounded-full bg-amber-500/10 border border-amber-500/20 text-xs text-amber-400">{a}</span>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* Test case list */}
      {activeCases.length > 0 && (
        <div className="flex items-center justify-end gap-2 mb-2">
          <button
            onClick={() => setExpandedIds(new Set(activeCases.map(c => c.id)))}
            className="btn-secondary text-xs"
          >
            <ChevronDown className="w-3.5 h-3.5" />
            Expand all
          </button>
          <button
            onClick={() => setExpandedIds(new Set())}
            className="btn-secondary text-xs"
          >
            <ChevronUp className="w-3.5 h-3.5" />
            Collapse all
          </button>
        </div>
      )}
      <div className="space-y-3">
        {activeCases.map((tc, idx) => {
          const isExpanded = expandedIds.has(tc.id);
          const isEditing = editingId === tc.id;

          return (
            <div key={tc.id} className={`card transition-all ${isExpanded ? 'border-white/10' : 'border-white/5'}`}>
              {/* Case header */}
              <div className="flex items-start gap-3">
                <span className="text-xs text-gray-600 font-mono mt-0.5 shrink-0 w-10">
                  TC-{String(idx + 1).padStart(2, '0')}
                </span>

                <button
                  className="flex-1 text-left"
                  onClick={() => setExpandedIds(prev => { const next = new Set(prev); isExpanded ? next.delete(tc.id) : next.add(tc.id); return next; })}
                >
                  {isEditing ? (
                    <input
                      className="input text-sm py-1"
                      value={editDraft.title || ''}
                      onChange={e => setEditDraft(d => ({ ...d, title: e.target.value }))}
                      onClick={e => e.stopPropagation()}
                      autoFocus
                    />
                  ) : (
                    <p className="text-sm font-medium text-white leading-snug">{tc.title}</p>
                  )}
                </button>

                <div className="flex items-center gap-2 shrink-0">
                  <span className={`px-2 py-0.5 rounded-full border text-xs font-medium ${TYPE_COLORS[tc.type] || TYPE_COLORS.functional}`}>
                    {tc.type}
                  </span>
                  <span className={`px-2 py-0.5 rounded-full border text-xs font-medium ${PRIORITY_COLORS[tc.priority] || PRIORITY_COLORS.P2}`}>
                    {tc.priority}
                  </span>

                  {!isEditing && (
                    <>
                      <button
                        onClick={e => { e.stopPropagation(); startEdit(tc); }}
                        className="text-gray-600 hover:text-gray-300 transition-colors p-1"
                        title="Edit"
                      >
                        <Pencil className="w-3.5 h-3.5" />
                      </button>
                      <button
                        onClick={e => { e.stopPropagation(); deleteCase(tc.id); }}
                        className="text-gray-600 hover:text-red-400 transition-colors p-1"
                        title="Delete"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </>
                  )}
                </div>
              </div>

              {/* Expanded body */}
              {isExpanded && (
                <div className="mt-4 ml-13 space-y-4" style={{ marginLeft: '52px' }}>
                  {isEditing ? (
                    <>
                      <div className="grid grid-cols-2 gap-3">
                        <div>
                          <label className="label">Type</label>
                          <select
                            className="input text-sm"
                            value={editDraft.type || tc.type}
                            onChange={e => setEditDraft(d => ({ ...d, type: e.target.value as TestCase['type'] }))}
                          >
                            {['functional', 'negative', 'edge', 'security', 'ux'].map(t => (
                              <option key={t} value={t}>{t}</option>
                            ))}
                          </select>
                        </div>
                        <div>
                          <label className="label">Priority</label>
                          <select
                            className="input text-sm"
                            value={editDraft.priority || tc.priority}
                            onChange={e => setEditDraft(d => ({ ...d, priority: e.target.value as TestCase['priority'] }))}
                          >
                            {['P1', 'P2', 'P3'].map(p => (
                              <option key={p} value={p}>{p}</option>
                            ))}
                          </select>
                        </div>
                      </div>

                      <div>
                        <label className="label">Preconditions</label>
                        <input
                          className="input text-sm"
                          value={editDraft.preconditions || ''}
                          onChange={e => setEditDraft(d => ({ ...d, preconditions: e.target.value }))}
                          placeholder="e.g. User is logged in"
                        />
                      </div>

                      <div>
                        <label className="label">Steps</label>
                        <div className="space-y-2">
                          {(editDraft.steps || []).map((step, i) => (
                            <div key={i} className="flex items-center gap-2">
                              <span className="text-xs text-gray-600 w-5 text-right shrink-0">{i + 1}.</span>
                              <input
                                className="input text-sm flex-1 py-1.5"
                                value={step}
                                onChange={e => updateDraftStep(i, e.target.value)}
                              />
                              <button
                                onClick={() => removeDraftStep(i)}
                                className="text-gray-600 hover:text-red-400 transition-colors shrink-0"
                              >
                                <X className="w-3.5 h-3.5" />
                              </button>
                            </div>
                          ))}
                          <button
                            onClick={addDraftStep}
                            className="text-xs text-violet-400 hover:text-violet-300 transition-colors"
                          >
                            + Add step
                          </button>
                        </div>
                      </div>

                      <div>
                        <label className="label">Expected result</label>
                        <textarea
                          className="input text-sm resize-none"
                          rows={2}
                          value={editDraft.expectedResult || ''}
                          onChange={e => setEditDraft(d => ({ ...d, expectedResult: e.target.value }))}
                        />
                      </div>

                      <div className="flex items-center gap-2 pt-1">
                        <button onClick={() => saveEdit(tc.id)} className="btn-primary text-xs py-1.5">
                          <Check className="w-3.5 h-3.5" />
                          Save changes
                        </button>
                        <button onClick={cancelEdit} className="btn-secondary text-xs py-1.5">
                          <X className="w-3.5 h-3.5" />
                          Cancel
                        </button>
                      </div>
                    </>
                  ) : (
                    <>
                      {tc.preconditions && (
                        <div>
                          <p className="text-xs text-gray-500 mb-1 uppercase tracking-wider">Preconditions</p>
                          <p className="text-sm text-gray-400">{tc.preconditions}</p>
                        </div>
                      )}

                      <div>
                        <p className="text-xs text-gray-500 mb-2 uppercase tracking-wider">Steps</p>
                        <ol className="space-y-1.5">
                          {tc.steps.map((step, i) => (
                            <li key={i} className="flex items-start gap-2 text-sm text-gray-300">
                              <span className="text-gray-600 shrink-0 w-5 text-right mt-px">{i + 1}.</span>
                              <span>{step.replace(/^Step \d+:\s*/i, '')}</span>
                            </li>
                          ))}
                        </ol>
                      </div>

                      <div>
                        <p className="text-xs text-gray-500 mb-1 uppercase tracking-wider">Expected result</p>
                        <p className="text-sm text-gray-300">{tc.expectedResult}</p>
                      </div>

                      {tc.testData && Object.keys(tc.testData).length > 0 && (
                        <div>
                          <p className="text-xs text-gray-500 mb-2 uppercase tracking-wider">Test data</p>
                          <div className="flex flex-wrap gap-2">
                            {Object.entries(tc.testData).map(([k, v]) => (
                              <span key={k} className="px-2.5 py-1 rounded-lg bg-surface border border-white/5 text-xs font-mono">
                                <span className="text-gray-500">{k}:</span>{' '}
                                <span className="text-gray-300">{String(v)}</span>
                              </span>
                            ))}
                          </div>
                        </div>
                      )}
                    </>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {activeCases.length === 0 && (
        <div className="card text-center py-10 text-gray-600">
          All test cases deleted.{' '}
          <button onClick={() => setPhase('input')} className="text-violet-400 hover:text-violet-300">Start over</button>
        </div>
      )}

      <button
        onClick={addCase}
        className="mt-3 w-full flex items-center justify-center gap-2 py-3 rounded-lg border border-dashed border-white/10 text-gray-600 hover:text-gray-400 hover:border-white/20 transition-all text-sm"
      >
        <Plus className="w-4 h-4" />
        Add test case
      </button>
    </div>
  );
}
