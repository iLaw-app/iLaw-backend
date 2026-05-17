-- CreateTable
CREATE TABLE "CommunityCommentLike" (
    "userId" TEXT NOT NULL,
    "commentId" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CommunityCommentLike_userId_commentId_key" UNIQUE ("userId", "commentId")
);

-- CreateIndex
CREATE INDEX "CommunityCommentLike_commentId_idx" ON "CommunityCommentLike"("commentId");

-- AddForeignKey
ALTER TABLE "CommunityCommentLike" ADD CONSTRAINT "CommunityCommentLike_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CommunityCommentLike" ADD CONSTRAINT "CommunityCommentLike_commentId_fkey" FOREIGN KEY ("commentId") REFERENCES "CommunityComment"("id") ON DELETE CASCADE ON UPDATE CASCADE;
