import { Play } from 'lucide-react';

export default function Automation() {
  return (
    <div className="p-8 max-w-3xl mx-auto">
      <div className="mb-8">
        <div className="flex items-center gap-3 mb-2">
          <div className="w-8 h-8 rounded-lg bg-emerald-600/20 flex items-center justify-center">
            <Play className="w-4 h-4 text-emerald-400" />
          </div>
          <h1 className="text-2xl font-semibold text-white">UI Automation</h1>
        </div>
        <p className="text-gray-500 text-sm">
          Write test steps in plain English. AI operates a real Chromium browser via Playwright MCP —
          reads the actual DOM, never guesses selectors, verifies each step independently.
        </p>
      </div>

      <div className="card border-dashed border-emerald-500/20 bg-gradient-to-br from-emerald-600/5 to-transparent text-center py-14">
        <Play className="w-12 h-12 text-emerald-500/30 mx-auto mb-4" />
        <p className="text-gray-400 font-medium mb-1">Phase 4 — the core value</p>
        <p className="text-gray-600 text-sm max-w-sm mx-auto">
          Playwright + MCP agent loop. AI calls <span className="font-mono text-gray-500">browser_snapshot()</span>,
          reads the DOM, then <span className="font-mono text-gray-500">browser_click()</span> — results
          streamed live via SSE.
        </p>
      </div>

      <div className="mt-6 grid grid-cols-2 gap-3">
        {[
          { title: 'Real DOM, no guessing', desc: 'AI snapshots before every action' },
          { title: 'Self-healing selectors', desc: 'Re-snapshots and retries on failure' },
          { title: 'Per-step screenshots', desc: 'Screenshot captured after every action' },
          { title: 'Live SSE streaming', desc: 'Watch steps pass or fail in real time' },
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
