CREATE TABLE "OAuthTransaction" (
    "nonceHash" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "target" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OAuthTransaction_pkey" PRIMARY KEY ("nonceHash")
);

CREATE TABLE "OAuthLoginCode" (
    "id" TEXT NOT NULL,
    "codeHash" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "usedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OAuthLoginCode_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "OAuthTransaction_expiresAt_idx" ON "OAuthTransaction"("expiresAt");
CREATE UNIQUE INDEX "OAuthLoginCode_codeHash_key" ON "OAuthLoginCode"("codeHash");
CREATE INDEX "OAuthLoginCode_userId_idx" ON "OAuthLoginCode"("userId");
CREATE INDEX "OAuthLoginCode_expiresAt_idx" ON "OAuthLoginCode"("expiresAt");

ALTER TABLE "OAuthLoginCode" ADD CONSTRAINT "OAuthLoginCode_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
