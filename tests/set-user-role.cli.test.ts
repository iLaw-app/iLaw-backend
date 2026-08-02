import { beforeEach, describe, expect, it, vi } from 'vitest';
import { runSetUserRoleCli } from '../src/cli/set-user-role';

const prismaMock = {
  user: {
    findUnique: vi.fn(),
    update: vi.fn(),
  },
};

const logger = {
  log: vi.fn(),
  error: vi.fn(),
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe('user:set-role CLI', () => {
  it('정상 role 변경 시 DB를 변경하고 변경 전후 정보를 출력한다', async () => {
    prismaMock.user.findUnique.mockResolvedValue({ id: 'user-1', nickname: 'tester', role: 'user' });
    prismaMock.user.update.mockResolvedValue({ id: 'user-1', nickname: 'tester', role: 'lawyer' });

    const exitCode = await runSetUserRoleCli(
      ['user-1', 'lawyer'],
      prismaMock,
      logger,
    );

    expect(exitCode).toBe(0);
    expect(prismaMock.user.update).toHaveBeenCalledWith({
      where: { id: 'user-1' },
      data: { role: 'lawyer' },
      select: { id: true, nickname: true, role: true },
    });
    expect(logger.log).toHaveBeenNthCalledWith(1, 'Before: user-1 (tester) role=user');
    expect(logger.log).toHaveBeenNthCalledWith(2, 'After: user-1 (tester) role=lawyer');
  });

  it('인자가 누락되면 실패한다', async () => {
    const exitCode = await runSetUserRoleCli([], prismaMock, logger);

    expect(exitCode).toBe(1);
    expect(logger.error).toHaveBeenCalledWith('Usage: npm run user:set-role -- <userId> <user|lawyer>');
    expect(prismaMock.user.findUnique).not.toHaveBeenCalled();
  });

  it('허용되지 않은 role이면 실패한다', async () => {
    const exitCode = await runSetUserRoleCli(['user-1', 'admin'], prismaMock, logger);

    expect(exitCode).toBe(1);
    expect(logger.error).toHaveBeenCalledWith('Role must be either user or lawyer.');
    expect(prismaMock.user.findUnique).not.toHaveBeenCalled();
  });

  it('사용자가 존재하지 않으면 실패한다', async () => {
    prismaMock.user.findUnique.mockResolvedValue(null);

    const exitCode = await runSetUserRoleCli(['missing-user', 'lawyer'], prismaMock, logger);

    expect(exitCode).toBe(1);
    expect(logger.error).toHaveBeenCalledWith('User not found: missing-user');
    expect(prismaMock.user.update).not.toHaveBeenCalled();
  });
});
