import 'dotenv/config';

// Fail-fast validation of environment configuration at process startup.
// - REQUIRED vars: the app cannot run safely without them → exit(1).
// - FEATURE groups: optional integrations → warn only, so the app still boots.
// Tuning vars (PORT, NODE_ENV, AI_* limits, OAUTH_LOCAL_REDIRECT_URI) have safe
// defaults or are dev-only and are intentionally not validated here.

const REQUIRED = [
  'DATABASE_URL',
  'JWT_ACCESS_SECRET',
  'JWT_REFRESH_SECRET',
  'OAUTH_STATE_SECRET',
] as const;

const FEATURE_GROUPS: { feature: string; vars: string[] }[] = [
  { feature: 'AI chat (OpenAI)', vars: ['OPENAI_API_KEY'] },
  { feature: 'Image upload (S3)', vars: ['AWS_REGION', 'AWS_ACCESS_KEY_ID', 'AWS_SECRET_ACCESS_KEY', 'AWS_S3_BUCKET'] },
  { feature: 'Kakao login', vars: ['KAKAO_CLIENT_ID', 'KAKAO_CLIENT_SECRET', 'KAKAO_CALLBACK_URL'] },
  { feature: 'Google login', vars: ['GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET', 'GOOGLE_CALLBACK_URL'] },
  { feature: 'Web OAuth redirect', vars: ['OAUTH_WEB_REDIRECT_URI'] },
];

export function validateEnv(): void {
  const missingRequired = REQUIRED.filter((key) => !process.env[key]);
  if (missingRequired.length > 0) {
    console.error(`[env] Missing required environment variables: ${missingRequired.join(', ')}`);
    process.exit(1);
  }

  for (const { feature, vars } of FEATURE_GROUPS) {
    const missing = vars.filter((key) => !process.env[key]);
    if (missing.length > 0) {
      console.warn(`[env] "${feature}" may not work — missing: ${missing.join(', ')}`);
    }
  }
}

validateEnv();
