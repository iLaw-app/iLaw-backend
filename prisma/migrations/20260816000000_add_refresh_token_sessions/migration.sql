-- Existing refresh tokens were stored as plaintext and have no jti/family metadata.
-- Dropping the column intentionally invalidates all pre-deployment refresh tokens;
-- clients must authenticate again. This avoids retaining or attempting to migrate secrets.
ALTER TABLE "User" DROP COLUMN "refreshToken";

CREATE TABLE "RefreshTokenSession" (
    "tokenHash" TEXT NOT NULL,
    "jti" TEXT NOT NULL,
    "familyId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "revokedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "RefreshTokenSession_pkey" PRIMARY KEY ("tokenHash")
);

CREATE UNIQUE INDEX "RefreshTokenSession_jti_key" ON "RefreshTokenSession"("jti");
CREATE INDEX "RefreshTokenSession_userId_idx" ON "RefreshTokenSession"("userId");
CREATE INDEX "RefreshTokenSession_familyId_idx" ON "RefreshTokenSession"("familyId");
CREATE INDEX "RefreshTokenSession_expiresAt_idx" ON "RefreshTokenSession"("expiresAt");

ALTER TABLE "RefreshTokenSession"
ADD CONSTRAINT "RefreshTokenSession_userId_fkey"
FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
