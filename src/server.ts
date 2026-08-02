import 'dotenv/config';
import app from './app';
import { loadManualCache } from './services/ai.service';
import { cleanupExpiredOAuthRecords, OAUTH_CLEANUP_INTERVAL_MS } from './services/oauth.service';

const PORT = process.env.PORT ?? 3000;

app.listen(PORT, async () => {
  console.log(`Server running on http://localhost:${PORT}`);
  await cleanupExpiredOAuthRecords();
  const oauthCleanupTimer = setInterval(() => {
    cleanupExpiredOAuthRecords().catch((error) => console.error('[OAuth cleanup failed]', error));
  }, OAUTH_CLEANUP_INTERVAL_MS);
  oauthCleanupTimer.unref();
  await loadManualCache();
  console.log('Manual cache loaded');
});
