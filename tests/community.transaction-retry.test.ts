import { describe, expect, it, vi } from 'vitest';
import { Prisma } from '@prisma/client';
import { runCommunitySerializableTransaction } from '../src/services/community-transaction';

function prismaError(code: string) {
  return new Prisma.PrismaClientKnownRequestError(code, {
    code,
    clientVersion: 'test',
  });
}

describe('community Serializable transaction retry', () => {
  it('P2034 뒤에는 backoff 후 transaction을 재시도한다', async () => {
    const conflict = prismaError('P2034');
    const transaction = vi.fn().mockRejectedValueOnce(conflict).mockResolvedValueOnce('ok');
    const sleep = vi.fn().mockResolvedValue(undefined);

    await expect(
      runCommunitySerializableTransaction(transaction, async () => 'unused', {
        sleep,
        baseDelayMs: 4,
        maxAttempts: 3,
      }),
    ).resolves.toBe('ok');

    expect(transaction).toHaveBeenCalledTimes(2);
    expect(sleep).toHaveBeenCalledWith(4);
  });

  it('P2034가 아닌 오류는 backoff나 재시도 없이 즉시 전파한다', async () => {
    const error = prismaError('P2025');
    const transaction = vi.fn().mockRejectedValue(error);
    const sleep = vi.fn().mockResolvedValue(undefined);

    await expect(
      runCommunitySerializableTransaction(transaction, async () => 'unused', {
        sleep,
        maxAttempts: 3,
      }),
    ).rejects.toBe(error);

    expect(transaction).toHaveBeenCalledOnce();
    expect(sleep).not.toHaveBeenCalled();
  });

  it('P2034 재시도 소진 시 마지막 오류를 명시적으로 전파한다', async () => {
    const conflict = prismaError('P2034');
    const transaction = vi.fn().mockRejectedValue(conflict);
    const sleep = vi.fn().mockResolvedValue(undefined);

    await expect(
      runCommunitySerializableTransaction(transaction, async () => 'unused', {
        sleep,
        baseDelayMs: 2,
        maxAttempts: 3,
      }),
    ).rejects.toBe(conflict);

    expect(transaction).toHaveBeenCalledTimes(3);
    expect(sleep.mock.calls).toEqual([[2], [4]]);
  });
});
