CREATE TABLE "AiChatHistory" (
    "id" SERIAL NOT NULL,
    "userId" TEXT NOT NULL,
    "question" TEXT NOT NULL,
    "situationSummary" TEXT NOT NULL,
    "legalAdvice" TEXT NOT NULL,
    "suggestions" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AiChatHistory_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "AiChatHistory" ADD CONSTRAINT "AiChatHistory_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
