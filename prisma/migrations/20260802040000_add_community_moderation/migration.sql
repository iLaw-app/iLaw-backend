-- Community moderation: soft-delete status on posts/comments + report tables.
-- status defaults to 'visible', so existing rows are unaffected.

-- AlterTable
ALTER TABLE "CommunityPost" ADD COLUMN "status" TEXT NOT NULL DEFAULT 'visible';

-- AlterTable
ALTER TABLE "CommunityComment" ADD COLUMN "status" TEXT NOT NULL DEFAULT 'visible';

-- CreateTable
CREATE TABLE "CommunityPostReport" (
    "id" SERIAL NOT NULL,
    "postId" INTEGER NOT NULL,
    "reporterId" TEXT NOT NULL,
    "reason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CommunityPostReport_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CommunityCommentReport" (
    "id" SERIAL NOT NULL,
    "commentId" INTEGER NOT NULL,
    "reporterId" TEXT NOT NULL,
    "reason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CommunityCommentReport_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "CommunityPostReport_postId_reporterId_key" ON "CommunityPostReport"("postId", "reporterId");

-- CreateIndex
CREATE INDEX "CommunityPostReport_postId_idx" ON "CommunityPostReport"("postId");

-- CreateIndex
CREATE INDEX "CommunityPostReport_reporterId_idx" ON "CommunityPostReport"("reporterId");

-- CreateIndex
CREATE UNIQUE INDEX "CommunityCommentReport_commentId_reporterId_key" ON "CommunityCommentReport"("commentId", "reporterId");

-- CreateIndex
CREATE INDEX "CommunityCommentReport_commentId_idx" ON "CommunityCommentReport"("commentId");

-- CreateIndex
CREATE INDEX "CommunityCommentReport_reporterId_idx" ON "CommunityCommentReport"("reporterId");

-- AddForeignKey
ALTER TABLE "CommunityPostReport" ADD CONSTRAINT "CommunityPostReport_postId_fkey" FOREIGN KEY ("postId") REFERENCES "CommunityPost"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CommunityPostReport" ADD CONSTRAINT "CommunityPostReport_reporterId_fkey" FOREIGN KEY ("reporterId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CommunityCommentReport" ADD CONSTRAINT "CommunityCommentReport_commentId_fkey" FOREIGN KEY ("commentId") REFERENCES "CommunityComment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CommunityCommentReport" ADD CONSTRAINT "CommunityCommentReport_reporterId_fkey" FOREIGN KEY ("reporterId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
