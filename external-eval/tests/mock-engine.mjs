import { readFile } from 'node:fs/promises';

let attemptMap = new Map();
let lastBehaviorPath = null;

export async function createEngine({ productCommit, isolatedDatabase, dynamicPort }) {
  const p = process.env.MOCK_ENGINE_BEHAVIOR_PATH;
  if (p !== lastBehaviorPath) {
    attemptMap = new Map();
    lastBehaviorPath = p;
  }
  const behavior = p ? JSON.parse(await readFile(p, 'utf8')) : {};
  return {
    ingest: async () => {},
    query: async ({ question, questionDate }) => {
      const attempt = (attemptMap.get(question) || 0) + 1;
      attemptMap.set(question, attempt);
      const actions = behavior[question] || behavior['default'];
      if (actions) {
        const idx = Math.min(attempt - 1, actions.length - 1);
        const action = actions[idx];
        if (action.error) throw new Error(action.error);
        return {
          answer: action.answer || 'mock-answer',
          diagnostics: {
            runtime_attestation: {
              product_commit: productCommit,
              build_sha256: 'af487d47018e3005c82684fd2c576524e12fbbb51dee2a64719fba0e255c2668',
              port: 0,
              isolated_database: true,
            },
          },
        };
      }
      return { answer: 'mock-answer', diagnostics: {} };
    },
    stop: async () => {},
  };
}
