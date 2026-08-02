-- Add missing indexes on foreign-key columns that are filtered/ordered in queries.
-- Additive only: no data or behavior change.

-- CreateIndex
CREATE INDEX "QnAPost_authorId_idx" ON "QnAPost"("authorId");

-- CreateIndex
CREATE INDEX "QnAAnswer_lawyerId_idx" ON "QnAAnswer"("lawyerId");

-- CreateIndex
CREATE INDEX "Notification_userId_idx" ON "Notification"("userId");

-- CreateIndex
CREATE INDEX "CommunityPost_authorId_idx" ON "CommunityPost"("authorId");

-- CreateIndex
CREATE INDEX "CommunityLike_postId_idx" ON "CommunityLike"("postId");

-- CreateIndex
CREATE INDEX "CommunityBookmark_postId_idx" ON "CommunityBookmark"("postId");

-- CreateIndex
CREATE INDEX "AiChatHistory_userId_idx" ON "AiChatHistory"("userId");
