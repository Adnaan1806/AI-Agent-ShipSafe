import React, { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import {
  ArrowLeft, FileText, Layers, PlayCircle, Loader2,
  Brain, ArrowRight, CheckCircle2, Clock, Trash2,
} from 'lucide-react';
import { api } from '../lib/api';
import { Project, TestSuite } from '../lib/types';

type Tab = 'requirements' | 'suites' | 'runs';

export default function ProjectDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [project, setProject] = useState<Project | null>(null);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<Tab>('suites');

  const [suites, setSuites] = useState<TestSuite[]>([]);
  const [suitesLoading, setSuitesLoading] = useState(false);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  useEffect(() => {
    if (!id) return;
    api.get<{ project: Project }>(`/api/projects/${id}`)
      .then(({ project }) => setProject(project))
      .catch(() => navigate('/projects'))
      .finally(() => setLoading(false));
  }, [id, navigate]);

  useEffect(() => {
    if (tab !== 'suites' || !id) return;
    setSuitesLoading(true);
    api.get<{ suites: TestSuite[] }>(`/api/tcg/suites?projectId=${id}`)
      .then(({ suites }) => setSuites(suites))
      .finally(() => setSuitesLoading(false));
  }, [tab, id]);

  async function deleteSuite(suiteId: string) {
    setDeletingId(suiteId);
    try {
      await api.delete(`/api/tcg/suites/${suiteId}`);
      setSuites(prev => prev.filter(s => s.id !== suiteId));
      if (project) setProject({ ...project, _count: project._count ? { ...project._count, suites: project._count.suites - 1 } : undefined });
    } finally {
      setDeletingId(null);
      setConfirmDeleteId(null);
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full">
        <Loader2 className="w-5 h-5 text-indigo-400 animate-spin" />
      </div>
    );
  }

  if (!project) return null;

  const tabs: { key: Tab; icon: React.ElementType; label: string }[] = [
    { key: 'suites', icon: Layers, label: 'Test Suites' },
    { key: 'requirements', icon: FileText, label: 'Requirements' },
    { key: 'runs', icon: PlayCircle, label: 'Runs' },
  ];

  return (
    <div className="p-8 max-w-5xl mx-auto">
      <button
        onClick={() => navigate('/projects')}
        className="flex items-center gap-1.5 text-gray-500 hover:text-gray-300 text-sm mb-5 transition-colors"
      >
        <ArrowLeft className="w-4 h-4" />
        Projects
      </button>

      <div className="mb-6">
        <h1 className="text-2xl font-semibold text-white">{project.name}</h1>
        {project.description && (
          <p className="text-gray-500 text-sm mt-1">{project.description}</p>
        )}
      </div>

      <div className="flex gap-1 border-b border-surface-border mb-6">
        {tabs.map(({ key, icon: Icon, label }) => (
          <button
            key={key}
            onClick={() => setTab(key)}
            className={`flex items-center gap-2 px-4 py-2.5 text-sm font-medium border-b-2 -mb-px transition-colors ${
              tab === key
                ? 'border-indigo-500 text-indigo-300'
                : 'border-transparent text-gray-500 hover:text-gray-300'
            }`}
          >
            <Icon className="w-3.5 h-3.5" />
            {label}
            {key === 'suites' && project._count && (
              <span className="text-xs bg-surface border border-white/5 rounded-full px-1.5 py-px text-gray-500">
                {project._count.suites}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* Suites tab */}
      {tab === 'suites' && (
        <div>
          <div className="flex items-center justify-between mb-4">
            <p className="text-sm text-gray-500">
              AI-generated test suites for this project
            </p>
            <button
              onClick={() => navigate('/tcg')}
              className="btn-primary text-xs"
            >
              <Brain className="w-3.5 h-3.5" />
              Generate new suite
            </button>
          </div>

          {suitesLoading ? (
            <div className="flex items-center justify-center py-16">
              <Loader2 className="w-5 h-5 text-indigo-400 animate-spin" />
            </div>
          ) : suites.length === 0 ? (
            <div className="text-center py-16">
              <Layers className="w-10 h-10 text-gray-700 mx-auto mb-3" />
              <p className="text-gray-500 text-sm font-medium">No test suites yet</p>
              <p className="text-gray-600 text-xs mt-1 mb-4">
                Generate one from a requirement in the TCG module
              </p>
              <button onClick={() => navigate('/tcg')} className="btn-secondary text-xs mx-auto">
                <Brain className="w-3.5 h-3.5" />
                Go to Test Case Generator
              </button>
            </div>
          ) : (
            <div className="space-y-3">
              {suites.map(suite => (
                <button
                  key={suite.id}
                  onClick={() => navigate(`/tcg?suite=${suite.id}`)}
                  className="card w-full text-left flex items-center gap-4 hover:border-violet-500/30 transition-all group"
                >
                  <div className="w-9 h-9 rounded-lg bg-violet-600/15 flex items-center justify-center shrink-0">
                    <Layers className="w-4 h-4 text-violet-400" />
                  </div>

                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <p className="text-sm font-medium text-white truncate">{suite.name}</p>
                      <span className={`px-2 py-0.5 text-xs rounded-full border font-medium shrink-0 ${
                        suite.status === 'active'
                          ? 'bg-green-500/15 text-green-300 border-green-500/25'
                          : 'bg-gray-500/15 text-gray-400 border-gray-500/20'
                      }`}>
                        {suite.status}
                      </span>
                    </div>
                    <div className="flex items-center gap-3 text-xs text-gray-600">
                      <span className="flex items-center gap-1">
                        {suite.status === 'active'
                          ? <CheckCircle2 className="w-3 h-3 text-green-500" />
                          : <Clock className="w-3 h-3" />}
                        {suite._count?.cases ?? 0} cases
                      </span>
                      <span>v{suite.version}</span>
                      <span>{new Date(suite.createdAt).toLocaleDateString()}</span>
                    </div>
                  </div>

                  <div className="flex items-center gap-2 shrink-0" onClick={e => e.stopPropagation()}>
                    {confirmDeleteId === suite.id ? (
                      <>
                        <span className="text-xs text-gray-400">Delete suite?</span>
                        <button
                          onClick={() => deleteSuite(suite.id)}
                          disabled={deletingId === suite.id}
                          className="px-2.5 py-1 rounded text-xs font-medium bg-red-500/20 text-red-400 hover:bg-red-500/30 transition-colors disabled:opacity-50"
                        >
                          {deletingId === suite.id ? <Loader2 className="w-3 h-3 animate-spin" /> : 'Delete'}
                        </button>
                        <button
                          onClick={() => setConfirmDeleteId(null)}
                          className="px-2.5 py-1 rounded text-xs font-medium bg-surface text-gray-400 hover:text-gray-200 transition-colors"
                        >
                          Cancel
                        </button>
                      </>
                    ) : (
                      <>
                        <button
                          onClick={() => setConfirmDeleteId(suite.id)}
                          className="p-1.5 rounded text-gray-600 hover:text-red-400 hover:bg-red-500/10 transition-colors"
                          title="Delete suite"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                        <ArrowRight className="w-4 h-4 text-gray-600 group-hover:text-violet-400 transition-colors" />
                      </>
                    )}
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Requirements tab — Phase 3 */}
      {tab === 'requirements' && (
        <div className="text-center py-16">
          <FileText className="w-10 h-10 text-gray-700 mx-auto mb-3" />
          <p className="text-gray-500 text-sm font-medium">Requirements</p>
          <p className="text-gray-600 text-xs mt-1">
            Coming in Phase 3 — link requirements to suites and track coverage
          </p>
        </div>
      )}

      {/* Runs tab — Phase 3 */}
      {tab === 'runs' && (
        <div className="text-center py-16">
          <PlayCircle className="w-10 h-10 text-gray-700 mx-auto mb-3" />
          <p className="text-gray-500 text-sm font-medium">Test Runs</p>
          <p className="text-gray-600 text-xs mt-1">
            Coming in Phase 3 — automation and API test run history
          </p>
        </div>
      )}
    </div>
  );
}
