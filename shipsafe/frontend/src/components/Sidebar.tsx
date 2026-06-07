import { NavLink, useNavigate } from 'react-router-dom';
import {
  LayoutDashboard,
  FolderOpen,
  Brain,
  Zap,
  Play,
  LogOut,
  ChevronRight,
  ShieldCheck,
} from 'lucide-react';
import { useAuth } from '../lib/AuthContext';

const navItems = [
  { path: '/', icon: LayoutDashboard, label: 'Dashboard', end: true },
  { path: '/projects', icon: FolderOpen, label: 'Projects', end: false },
];

const moduleItems = [
  { path: '/tcg', icon: Brain, label: 'Test Case Generator' },
  { path: '/api-testing', icon: Zap, label: 'API Testing' },
  { path: '/automation', icon: Play, label: 'Automation' },
];

export default function Sidebar() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();

  const handleLogout = () => {
    logout();
    navigate('/login');
  };

  return (
    <aside className="w-60 h-screen flex flex-col bg-surface-card border-r border-surface-border shrink-0">
      {/* Logo */}
      <div className="flex items-center gap-2.5 px-5 py-5 border-b border-surface-border">
        <div className="w-8 h-8 bg-indigo-600 rounded-lg flex items-center justify-center">
          <ShieldCheck className="w-4 h-4 text-white" />
        </div>
        <span className="text-white font-semibold text-sm tracking-wide">ShipSafe</span>
      </div>

      {/* Navigation */}
      <nav className="flex-1 px-3 py-4 space-y-0.5 overflow-y-auto">
        {navItems.map(({ path, icon: Icon, label, end }) => (
          <NavLink
            key={path}
            to={path}
            end={end}
            className={({ isActive }) =>
              `flex items-center gap-3 px-3 py-2 rounded-lg text-sm transition-colors group ${
                isActive
                  ? 'bg-indigo-600/15 text-indigo-300 font-medium'
                  : 'text-gray-400 hover:text-gray-200 hover:bg-surface-hover'
              }`
            }
          >
            {({ isActive }) => (
              <>
                <Icon className={`w-4 h-4 ${isActive ? 'text-indigo-400' : ''}`} />
                {label}
                {isActive && <ChevronRight className="w-3 h-3 ml-auto text-indigo-400/60" />}
              </>
            )}
          </NavLink>
        ))}

        <div className="pt-4 pb-1">
          <p className="px-3 text-xs font-semibold text-gray-600 uppercase tracking-widest">
            Modules
          </p>
        </div>

        {moduleItems.map(({ path, icon: Icon, label }) => (
          <NavLink
            key={path}
            to={path}
            className={({ isActive }) =>
              `flex items-center gap-3 px-3 py-2 rounded-lg text-sm transition-colors ${
                isActive
                  ? 'bg-indigo-600/15 text-indigo-300 font-medium'
                  : 'text-gray-400 hover:text-gray-200 hover:bg-surface-hover'
              }`
            }
          >
            {({ isActive }) => (
              <>
                <Icon className={`w-4 h-4 ${isActive ? 'text-indigo-400' : ''}`} />
                {label}
                {isActive && <ChevronRight className="w-3 h-3 ml-auto text-indigo-400/60" />}
              </>
            )}
          </NavLink>
        ))}
      </nav>

      {/* User */}
      <div className="px-3 py-3 border-t border-surface-border">
        <div className="flex items-center gap-2 px-2 py-2 rounded-lg">
          <div className="w-7 h-7 rounded-full bg-indigo-600/30 flex items-center justify-center text-xs font-medium text-indigo-300">
            {user?.email.charAt(0).toUpperCase()}
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-xs text-gray-400 truncate">{user?.email}</p>
          </div>
          <button
            onClick={handleLogout}
            className="text-gray-600 hover:text-red-400 transition-colors"
            title="Sign out"
          >
            <LogOut className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>
    </aside>
  );
}
