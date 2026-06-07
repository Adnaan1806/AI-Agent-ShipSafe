export interface User {
  id: string;
  email: string;
  apiKey: string;
}

export interface Project {
  id: string;
  name: string;
  description?: string;
  createdAt: string;
  updatedAt: string;
  _count?: {
    requirements: number;
    suites: number;
    runs: number;
  };
}

export interface Requirement {
  id: string;
  projectId: string;
  title: string;
  content: string;
  createdAt: string;
}

export interface TestSuite {
  id: string;
  projectId: string;
  requirementId?: string;
  name: string;
  version: number;
  status: 'draft' | 'active';
  source: 'ai' | 'manual';
  createdAt: string;
  updatedAt: string;
  _count?: { cases: number };
}

export interface TestCase {
  id: string;
  suiteId: string;
  title: string;
  type: 'functional' | 'negative' | 'edge' | 'security' | 'ux';
  priority: 'P1' | 'P2' | 'P3';
  preconditions?: string;
  steps: string[];
  expectedResult: string;
  testData?: Record<string, unknown>;
  status: 'active' | 'deleted';
  order: number;
}

export interface TestRun {
  id: string;
  projectId?: string;
  type: 'automation' | 'api' | 'full';
  status: 'queued' | 'running' | 'completed' | 'failed';
  triggeredBy: 'manual' | 'webhook' | 'schedule';
  branch?: string;
  commitSha?: string;
  createdAt: string;
  completedAt?: string;
}

export interface TestSession {
  id: string;
  type: 'api' | 'automation' | 'tcg';
  status: 'queued' | 'running' | 'completed' | 'failed';
  input: Record<string, unknown>;
  targetUrl?: string;
  createdAt: string;
  completedAt?: string;
}

export interface StepResult {
  toolName: string;
  input: Record<string, unknown>;
  success: boolean;
  output?: unknown;
  error?: string;
  screenshotData?: string;
}
