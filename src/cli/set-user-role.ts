import 'dotenv/config';
import prisma from '../prisma/client';

type UserRole = 'user' | 'lawyer';
type RoleUser = { id: string; nickname: string | null; role: string };

type RolePrismaClient = {
  user: {
    findUnique(args: {
      where: { id: string };
      select: { id: true; nickname: true; role: true };
    }): Promise<RoleUser | null>;
    update(args: {
      where: { id: string };
      data: { role: UserRole };
      select: { id: true; nickname: true; role: true };
    }): Promise<RoleUser>;
  };
};

type Logger = {
  log(message: string): void;
  error(message: string): void;
};

const USER_SELECT = { id: true, nickname: true, role: true } as const;
const USAGE = 'Usage: npm run user:set-role -- <userId> <user|lawyer>';

function formatUser(prefix: 'Before' | 'After', user: RoleUser) {
  return `${prefix}: ${user.id} (${user.nickname ?? '-'}) role=${user.role}`;
}

export async function runSetUserRoleCli(
  args: string[],
  client: RolePrismaClient = prisma,
  logger: Logger = console,
): Promise<number> {
  const [userId, requestedRole] = args;

  if (args.length !== 2 || !userId || !requestedRole) {
    logger.error(USAGE);
    return 1;
  }
  if (requestedRole !== 'user' && requestedRole !== 'lawyer') {
    logger.error('Role must be either user or lawyer.');
    return 1;
  }

  try {
    const before = await client.user.findUnique({
      where: { id: userId },
      select: USER_SELECT,
    });
    if (!before) {
      logger.error(`User not found: ${userId}`);
      return 1;
    }

    logger.log(formatUser('Before', before));
    const after = await client.user.update({
      where: { id: userId },
      data: { role: requestedRole },
      select: USER_SELECT,
    });
    logger.log(formatUser('After', after));
    return 0;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logger.error(`Failed to change user role: ${message}`);
    return 1;
  }
}

if (require.main === module) {
  runSetUserRoleCli(process.argv.slice(2))
    .then((exitCode) => {
      process.exitCode = exitCode;
    })
    .finally(() => prisma.$disconnect());
}
