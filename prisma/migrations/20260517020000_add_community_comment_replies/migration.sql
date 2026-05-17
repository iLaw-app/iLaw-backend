-- AlterTable
ALTER TABLE "CommunityComment" ADD COLUMN "parentId" INTEGER;

-- CreateIndex
CREATE INDEX "CommunityComment_postId_parentId_idx" ON "CommunityComment"("postId", "parentId");

-- AddForeignKey
ALTER TABLE "CommunityComment" ADD CONSTRAINT "CommunityComment_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "CommunityComment"("id") ON DELETE CASCADE ON UPDATE CASCADE;
