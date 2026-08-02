import 'dotenv/config';
import app from './app';
import { loadManualCache } from './services/ai.service';

const PORT = process.env.PORT ?? 3000;

app.listen(PORT, async () => {
  console.log(`Server running on http://localhost:${PORT}`);
  await loadManualCache();
  console.log('Manual cache loaded');
});
