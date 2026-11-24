import { defineConfig } from '@playwright/test';

// The models the real suite runs on, as Claude Code aliases; Fable is left out on purpose.
export const REAL_MODELS = ['haiku', 'sonnet', 'opus'];

// "fake" (npm run e2e) never reaches Claude; "real-<model>" (npm run e2e:real) uses your Claude Code and spends usage.
export default defineConfig({
  testDir: 'e2e',
  timeout: 60_000,
  workers: 1,
  projects: [
    { name: 'fake', testIgnore: 'real.spec.ts' },
    ...REAL_MODELS.map((model) => ({ name: `real-${model}`, testMatch: 'real.spec.ts', metadata: { model } })),
  ],
});
