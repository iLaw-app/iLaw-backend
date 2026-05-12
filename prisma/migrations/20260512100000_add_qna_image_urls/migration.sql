-- AlterTable: Add imageUrls to QnAPost
ALTER TABLE "QnAPost" ADD COLUMN "imageUrls" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];
