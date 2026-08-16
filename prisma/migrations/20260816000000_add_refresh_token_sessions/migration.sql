-- Expand phase only: the legacy "User"."refreshToken" column remains so instances
-- running commit 2976061 can continue its existing refresh-token CRUD during rollout.
-- New code writes only to "RefreshTokenSession"; a later contract migration may drop
-- the legacy column after all old instances have been drained.
-- allow-destructive: Adding the FK briefly takes SHARE ROW EXCLUSIVE locks on the new table and referenced "User" table. SET LOCAL lock_timeout limits the wait to 5s; any timeout/error rolls back this explicit transaction (table, indexes, and FK), after which deploy can retry during lower write traffic while legacy User.refreshToken remains usable.

BEGIN;
SET LOCAL lock_timeout = '5s';

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

COMMIT;
