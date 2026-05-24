-- QnAPost: authorId nullable, cascade → set null
ALTER TABLE "QnAPost" DROP CONSTRAINT "QnAPost_authorId_fkey";
ALTER TABLE "QnAPost" ALTER COLUMN "authorId" DROP NOT NULL;
ALTER TABLE "QnAPost" ADD CONSTRAINT "QnAPost_authorId_fkey"
  FOREIGN KEY ("authorId") REFERENCES "User"(id) ON DELETE SET NULL ON UPDATE CASCADE;

-- QnAAnswer: lawyerId nullable, cascade → set null
ALTER TABLE "QnAAnswer" DROP CONSTRAINT "QnAAnswer_lawyerId_fkey";
ALTER TABLE "QnAAnswer" ALTER COLUMN "lawyerId" DROP NOT NULL;
ALTER TABLE "QnAAnswer" ADD CONSTRAINT "QnAAnswer_lawyerId_fkey"
  FOREIGN KEY ("lawyerId") REFERENCES "User"(id) ON DELETE SET NULL ON UPDATE CASCADE;
