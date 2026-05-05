-- AlterTable
ALTER TABLE "User" ADD COLUMN     "agreedAge14" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "agreedAt" TIMESTAMP(3),
ADD COLUMN     "agreedMarketing" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "agreedPrivacyPolicy" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "agreedTermsOfService" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "birthYear" INTEGER,
ADD COLUMN     "gender" TEXT,
ADD COLUMN     "profileCompleted" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "region" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "User_nickname_key" ON "User"("nickname");
