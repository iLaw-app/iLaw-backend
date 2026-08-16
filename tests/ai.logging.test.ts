import { afterEach, describe, expect, it } from 'vitest';
import { safeAiErrorFields } from '../src/services/ai.logging';

const originalNodeEnv = process.env.NODE_ENV;

afterEach(() => {
  process.env.NODE_ENV = originalNodeEnv;
});

describe('AI structured error logging', () => {
  it('production에서는 원본 message/stack/SQL/request text를 남기지 않는다', () => {
    process.env.NODE_ENV = 'production';
    const error = Object.assign(new Error('SELECT * FROM users WHERE request = secret-text'), {
      code: 'P2010',
    });

    const fields = safeAiErrorFields(error, 'persistence');
    const serialized = JSON.stringify(fields);

    expect(fields).toEqual({
      errorName: 'Error',
      errorCode: 'P2010',
      errorCategory: 'persistence',
    });
    expect(serialized).not.toContain('SELECT');
    expect(serialized).not.toContain('secret-text');
    expect(serialized).not.toContain('stack');
    expect(serialized).not.toContain('message');
  });

  it('development에서만 줄바꿈을 제거하고 길이를 제한한 detail을 제공한다', () => {
    process.env.NODE_ENV = 'development';
    const error = new Error(`first line\n${'x'.repeat(500)}`);

    const fields = safeAiErrorFields(error, 'retrieval');

    expect(fields.errorDetail).toBeTypeOf('string');
    expect(String(fields.errorDetail)).not.toContain('\n');
    expect(String(fields.errorDetail).length).toBeLessThanOrEqual(200);
    expect(fields).not.toHaveProperty('stack');
  });
});
