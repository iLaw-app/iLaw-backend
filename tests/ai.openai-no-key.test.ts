import { spawnSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';

describe('AI OpenAI SDK lazy import', () => {
  it('API key가 없으면 AI 모듈 import만으로 openai 패키지를 로드하지 않는다', () => {
    const env: NodeJS.ProcessEnv = { ...process.env, DOTENV_CONFIG_PATH: '/dev/null' };
    delete env.OPENAI_API_KEY;
    const script = `
      const Module = require('node:module');
      const originalLoad = Module._load;
      Module._load = function(request, parent, isMain) {
        if (request === 'openai') throw new Error('openai eagerly loaded');
        return originalLoad.call(this, request, parent, isMain);
      };
      require('./src/services/ai.service');
      require('./src/services/ai.embeddings');
      require('./src/services/moderation.service');
    `;

    const result = spawnSync(
      process.execPath,
      ['-r', 'ts-node/register', '-e', script],
      { cwd: process.cwd(), env, encoding: 'utf8' },
    );

    expect(result.status, result.stderr).toBe(0);
  });
});
