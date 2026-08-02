CREATE TABLE "AiDailyUsage" (
    "userId" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "requestCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AiDailyUsage_pkey" PRIMARY KEY ("userId", "date")
);

CREATE INDEX "AiDailyUsage_date_idx" ON "AiDailyUsage"("date");

ALTER TABLE "AiDailyUsage" ADD CONSTRAINT "AiDailyUsage_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
