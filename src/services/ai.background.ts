import { logger, type StructuredLogger } from '../middlewares/logging';

export interface AiBackgroundContext {
  event: string;
  requestId: string;
  userId: string;
  conversationId?: string;
  diagnosisStatus?: string;
}

function errorFields(error: unknown): Record<string, unknown> {
  if (error instanceof Error) {
    return { error: error.message, stack: error.stack };
  }
  return { error: String(error) };
}

export function observeAiBackgroundTask(
  task: Promise<unknown>,
  context: AiBackgroundContext,
  output: Pick<StructuredLogger, 'error'> = logger,
): void {
  void task.catch((error: unknown) => {
    output.error({ ...context, ...errorFields(error) });
  });
}
