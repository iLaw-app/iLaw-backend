-- CommunityPost: authorId nullable, cascade → set null
ALTER TABLE "CommunityPost" DROP CONSTRAINT "CommunityPost_authorId_fkey";
ALTER TABLE "CommunityPost" ALTER COLUMN "authorId" DROP NOT NULL;
ALTER TABLE "CommunityPost" ADD CONSTRAINT "CommunityPost_authorId_fkey"
  FOREIGN KEY ("authorId") REFERENCES "User"(id) ON DELETE SET NULL ON UPDATE CASCADE;

-- CommunityComment: authorId nullable, cascade → set null
ALTER TABLE "CommunityComment" DROP CONSTRAINT "CommunityComment_authorId_fkey";
ALTER TABLE "CommunityComment" ALTER COLUMN "authorId" DROP NOT NULL;
ALTER TABLE "CommunityComment" ADD CONSTRAINT "CommunityComment_authorId_fkey"
  FOREIGN KEY ("authorId") REFERENCES "User"(id) ON DELETE SET NULL ON UPDATE CASCADE;
