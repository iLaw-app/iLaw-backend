-- CreateTable
CREATE TABLE "CommunityCommentAuthorLabel" (
    "postId" INTEGER NOT NULL,
    "userId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CommunityCommentAuthorLabel_pkey" PRIMARY KEY ("postId","userId")
);

-- CreateIndex
CREATE INDEX "CommunityCommentAuthorLabel_postId_idx" ON "CommunityCommentAuthorLabel"("postId");

-- AddForeignKey
ALTER TABLE "CommunityCommentAuthorLabel" ADD CONSTRAINT "CommunityCommentAuthorLabel_postId_fkey" FOREIGN KEY ("postId") REFERENCES "CommunityPost"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CommunityCommentAuthorLabel" ADD CONSTRAINT "CommunityCommentAuthorLabel_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Backfill: 기존 댓글 작성자 매핑 소급 적용 (첫 댓글 시각 기준)
INSERT INTO "CommunityCommentAuthorLabel" ("postId", "userId", "createdAt")
SELECT "postId", "authorId", MIN("createdAt")
FROM "CommunityComment"
GROUP BY "postId", "authorId"
ON CONFLICT DO NOTHING;
