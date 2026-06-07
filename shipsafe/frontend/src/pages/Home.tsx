import { useNavigate } from 'react-router-dom';
import { Brain, Zap, Play, ArrowRight, FolderOpen } from 'lucide-react';
import { useAuth } from '../lib/AuthContext';

const modules = [
  {
    path: '/tcg',
    icon: Brain,
    label: 'Test Case Generator',
    description:
      'Paste a requirement or acceptance criteria. AI brainstorms all scenarios — positive, negative, edge cases — and generates structured test cases with steps.',
    color: 'from-violet-600/20 to-violet-600/5',
    iconBg: 'bg-violet-600/20',
    iconColor: 'text-violet-400',
    phase: 'Phase 2',
  },
  {
    path: '/api-testing',
    icon: Zap,
    label: 'API Testing',
    description:
      'Upload a Postman collection or OpenAPI spec. AI generates real payloads, runs all tests concurrently, and produces a detailed report.',
    color: 'from-amber-600/20 to-amber-600/5',
    iconBg: 'bg-amber-600/20',
    iconColor: 'text-amber-400',
    phase: 'Phase 3',
  },
  {
    path: '/automation',
    icon: Play,
    label: 'UI Automation',
    description:
      "Write test steps in plain English. The AI operates a real browser using Playwright — reads the actual DOM, clicks, fills, and verifies each step independently.",
    color: 'from-emerald-600/20 to-emerald-600/5',
    iconBg: 'bg-emerald-600/20',
    iconColor: 'text-emerald-400',
    phase: 'Phase 4',
  },
];

export default function Home() {
  const { user } = useAuth();
  const navigate = useNavigate();

  return (
    <div className="p-8 max-w-5xl mx-auto">
      {/* Header */}
      <div className="mb-10">
        <h1 className="text-2xl font-semibold text-white mb-1">
          Welcome back, {user?.email.split('@')[0]}
        </h1>
        <p className="text-gray-500 text-sm">
          AI-powered QA — from requirements to shipped product.
        </p>
      </div>

      {/* Quick start */}
      <div className="mb-10">
        <h2 className="text-xs font-semibold text-gray-500 uppercase tracking-widest mb-4">
          Modules
        </h2>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {modules.map(({ path, icon: Icon, label, description, color, iconBg, iconColor, phase }) => (
            <button
              key={path}
              onClick={() => navigate(path)}
              className={`text-left card bg-gradient-to-br ${color} hover:border-indigo-500/40 transition-all group`}
            >
              <div className={`w-9 h-9 rounded-lg ${iconBg} flex items-center justify-center mb-4`}>
                <Icon className={`w-4 h-4 ${iconColor}`} />
              </div>
              <div className="flex items-start justify-between mb-2">
                <h3 className="text-sm font-semibold text-white">{label}</h3>
                <ArrowRight className="w-3.5 h-3.5 text-gray-600 group-hover:text-gray-400 transition-colors mt-0.5" />
              </div>
              <p className="text-xs text-gray-500 leading-relaxed mb-3">{description}</p>
              <span className="text-xs text-gray-600">{phase}</span>
            </button>
          ))}
        </div>
      </div>

      {/* Projects shortcut */}
      <div>
        <h2 className="text-xs font-semibold text-gray-500 uppercase tracking-widest mb-4">
          Projects
        </h2>
        <button
          onClick={() => navigate('/projects')}
          className="card w-full text-left flex items-center gap-4 hover:border-indigo-500/40 transition-all group"
        >
          <div className="w-9 h-9 rounded-lg bg-indigo-600/20 flex items-center justify-center">
            <FolderOpen className="w-4 h-4 text-indigo-400" />
          </div>
          <div className="flex-1">
            <p className="text-sm font-medium text-white">Manage projects</p>
            <p className="text-xs text-gray-500 mt-0.5">
              Link requirements, test suites, and runs under a single project
            </p>
          </div>
          <ArrowRight className="w-4 h-4 text-gray-600 group-hover:text-gray-400 transition-colors" />
        </button>
      </div>
    </div>
  );
}
