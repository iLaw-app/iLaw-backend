export type ScriptTarget = 'local' | 'production';

export type ScriptMode = {
  apply: boolean;
  target: ScriptTarget;
  databaseLabel: string;
};

const PRODUCTION_CONFIRMATION = 'ilaw';

function readOption(args: string[], name: string) {
  const prefix = `--${name}=`;
  return args.find((arg) => arg.startsWith(prefix))?.slice(prefix.length);
}

function databaseLabel(databaseUrl: string) {
  try {
    const url = new URL(databaseUrl);
    return `${url.hostname}/${url.pathname.replace(/^\//, '') || '(default)'}`;
  } catch {
    throw new Error('DATABASE_URL is not a valid PostgreSQL URL.');
  }
}

function isLoopbackDatabase(databaseUrl: string) {
  const url = new URL(databaseUrl);
  return url.hostname === 'localhost'
    || url.hostname === '127.0.0.1'
    || url.hostname === '[::1]';
}

export function resolveScriptMode(
  args: string[],
  env: NodeJS.ProcessEnv = process.env,
): ScriptMode {
  const apply = args.includes('--apply');
  const targetValue = readOption(args, 'target') ?? 'local';
  if (targetValue !== 'local' && targetValue !== 'production') {
    throw new Error('--target must be either local or production.');
  }

  if (!apply) {
    return { apply: false, target: targetValue, databaseLabel: '(not connected)' };
  }

  const databaseUrl = env.DATABASE_URL;
  if (!databaseUrl) throw new Error('DATABASE_URL is required when --apply is used.');

  const productionDatabase = env.NODE_ENV === 'production' || !isLoopbackDatabase(databaseUrl);
  if (productionDatabase && targetValue !== 'production') {
    throw new Error('The database looks like production. Use --target=production explicitly.');
  }
  if (!productionDatabase && targetValue === 'production') {
    throw new Error('Refusing production mode because DATABASE_URL does not look like production.');
  }
  if (productionDatabase && readOption(args, 'confirm-production') !== PRODUCTION_CONFIRMATION) {
    throw new Error(`Production writes require --confirm-production=${PRODUCTION_CONFIRMATION}.`);
  }

  return {
    apply: true,
    target: targetValue,
    databaseLabel: databaseLabel(databaseUrl),
  };
}

export function printScriptMode(mode: ScriptMode, log: (message: string) => void = console.log) {
  if (!mode.apply) {
    log('DRY RUN: no database or external storage changes will be made.');
    log('Run again with --apply after reviewing the input summary.');
    return;
  }
  log(`APPLY: target=${mode.target}, database=${mode.databaseLabel}`);
}
