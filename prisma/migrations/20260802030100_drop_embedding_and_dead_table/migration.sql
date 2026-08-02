-- Destructive cleanup (review before deploy):
--  1. Drop the unused write-only pgvector "embedding" columns (no read path exists).
--  2. Drop the dead CommunityCommentAuthorLabel table (unreferenced in code).
--  3. Make QnAAnswer.post cascade on delete (removes the manual two-step delete).

-- DropTable: CommunityCommentAuthorLabel (dead, no code references)
ALTER TABLE "CommunityCommentAuthorLabel" DROP CONSTRAINT "CommunityCommentAuthorLabel_postId_fkey";
ALTER TABLE "CommunityCommentAuthorLabel" DROP CONSTRAINT "CommunityCommentAuthorLabel_userId_fkey";
DROP TABLE "CommunityCommentAuthorLabel";

-- Drop unused embedding columns (index on the column is dropped automatically with it)
ALTER TABLE "ManualArticle" DROP COLUMN "embedding";
ALTER TABLE "QnAPost" DROP COLUMN "embedding";

-- QnAAnswer.post -> onDelete: Cascade
ALTER TABLE "QnAAnswer" DROP CONSTRAINT "QnAAnswer_postId_fkey";
ALTER TABLE "QnAAnswer" ADD CONSTRAINT "QnAAnswer_postId_fkey" FOREIGN KEY ("postId") REFERENCES "QnAPost"("id") ON DELETE CASCADE ON UPDATE CASCADE;
