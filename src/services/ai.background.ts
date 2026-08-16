import { logger, type StructuredLogger } from '../middlewares/logging';
import { safeAiErrorFields } from './ai.logging';

export interface AiBackgroundContext {
  event: string;
  requestId: string;
  userId: string;
  conversationId?: string;
  diagnosisStatus?: string;
}

export interface AiDeferredTask {
  start: () => Promise<unknown>;
  context: AiBackgroundContext;
}

export function observeAiBackgroundTask(
  start: () => Promise<unknown>,
  context: AiBackgroundContext,
  output: Pick<StructuredLogger, 'error'> = logger,
): void {
  void Promise.resolve()
    .then(start)
    .catch((error: unknown) => {
      output.error({ ...context, ...safeAiErrorFields(error, 'background_task_failure') });
    });
}
