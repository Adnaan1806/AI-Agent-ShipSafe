import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Plus, FolderOpen, Loader2, X, ArrowRight } from 'lucide-react';
import { api } from '../lib/api';
import { Project } from '../lib/types';

export default function Projects() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);
  const [showNew, setShowNew] = useState(false);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState('');
  const navigate = useNavigate();

  useEffect(() => {
    api.get<{ projects: Project[] }>('/api/projects')
      .then(({ projects }) => setProjects(projects))
      .finally(() => setLoading(false));
  }, []);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setCreating(true);
    try {
      const { project } = await api.post<{ project: Project }>('/api/projects', { name, description });
      setProjects((p) => [project, ...p]);
      setShowNew(false);
      setName('');
      setDescription('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create project');
    } finally {
      setCreating(false);
    }
  };

  return (
    <div className="p-8 max-w-4xl mx-auto">
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-2xl font-semibold text-white">Projects</h1>
          <p className="text-gray-500 text-sm mt-0.5">Organise requirements, suites, and runs</p>
        </div>
        <button onClick={() => setShowNew(true)} className="btn-primary">
          <Plus className="w-4 h-4" />
          New project
        </button>
      </div>

      {/* New project form */}
      {showNew && (
        <div className="card mb-6 border-indigo-500/30">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-sm font-semibold text-white">New project</h2>
            <button onClick={() => { setShowNew(false); setError(''); }} className="text-gray-500 hover:text-gray-300">
              <X className="w-4 h-4" />
            </button>
          </div>
          <form onSubmit={handleCreate} className="space-y-3">
            <div>
              <label className="label">Project name</label>
              <input
                className="input"
                placeholder="e.g. Checkout flow QA"
                value={name}
                onChange={(e) => setName(e.target.value)}
                required
                autoFocus
              />
            </div>
            <div>
              <label className="label">Description (optional)</label>
              <input
                className="input"
                placeholder="What are you testing?"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
              />
            </div>
            {error && (
              <p className="text-red-400 text-xs">{error}</p>
            )}
            <div className="flex gap-2 pt-1">
              <button type="submit" className="btn-primary" disabled={creating}>
                {creating ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : null}
                {creating ? 'Creating…' : 'Create project'}
              </button>
              <button type="button" className="btn-secondary" onClick={() => { setShowNew(false); setError(''); }}>
                Cancel
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Projects list */}
      {loading ? (
        <div className="flex items-center justify-center py-20">
          <Loader2 className="w-5 h-5 text-indigo-400 animate-spin" />
        </div>
      ) : projects.length === 0 ? (
        <div className="text-center py-20">
          <FolderOpen className="w-10 h-10 text-gray-700 mx-auto mb-3" />
          <p className="text-gray-500 text-sm">No projects yet</p>
          <p className="text-gray-600 text-xs mt-1">Create one to get started</p>
        </div>
      ) : (
        <div className="grid gap-3">
          {projects.map((p) => (
            <button
              key={p.id}
              onClick={() => navigate(`/projects/${p.id}`)}
              className="card text-left flex items-center gap-4 hover:border-indigo-500/40 transition-all group"
            >
              <div className="w-9 h-9 rounded-lg bg-indigo-600/15 flex items-center justify-center shrink-0">
                <FolderOpen className="w-4 h-4 text-indigo-400" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-white truncate">{p.name}</p>
                {p.description && (
                  <p className="text-xs text-gray-500 truncate mt-0.5">{p.description}</p>
                )}
                {p._count && (
                  <div className="flex gap-3 mt-1.5">
                    <span className="text-xs text-gray-600">{p._count.requirements} requirements</span>
                    <span className="text-xs text-gray-600">{p._count.suites} suites</span>
                    <span className="text-xs text-gray-600">{p._count.runs} runs</span>
                  </div>
                )}
              </div>
              <ArrowRight className="w-4 h-4 text-gray-600 group-hover:text-gray-400 transition-colors shrink-0" />
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
