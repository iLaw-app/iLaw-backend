-- QnAPost: author FK에 CASCADE 추가
ALTER TABLE "QnAPost" DROP CONSTRAINT "QnAPost_authorId_fkey";
ALTER TABLE "QnAPost" ADD CONSTRAINT "QnAPost_authorId_fkey"
  FOREIGN KEY ("authorId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- QnAAnswer: lawyer FK에 CASCADE 추가
ALTER TABLE "QnAAnswer" DROP CONSTRAINT "QnAAnswer_lawyerId_fkey";
ALTER TABLE "QnAAnswer" ADD CONSTRAINT "QnAAnswer_lawyerId_fkey"
  FOREIGN KEY ("lawyerId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- QnAScrap: user FK에 CASCADE 추가
ALTER TABLE "QnAScrap" DROP CONSTRAINT "QnAScrap_userId_fkey";
ALTER TABLE "QnAScrap" ADD CONSTRAINT "QnAScrap_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- QnAScrap: post FK에 CASCADE 추가
ALTER TABLE "QnAScrap" DROP CONSTRAINT "QnAScrap_postId_fkey";
ALTER TABLE "QnAScrap" ADD CONSTRAINT "QnAScrap_postId_fkey"
  FOREIGN KEY ("postId") REFERENCES "QnAPost"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ArticleScrap: user FK에 CASCADE 추가
ALTER TABLE "ArticleScrap" DROP CONSTRAINT "ArticleScrap_userId_fkey";
ALTER TABLE "ArticleScrap" ADD CONSTRAINT "ArticleScrap_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ArticleScrap: article FK에 CASCADE 추가
ALTER TABLE "ArticleScrap" DROP CONSTRAINT "ArticleScrap_articleId_fkey";
ALTER TABLE "ArticleScrap" ADD CONSTRAINT "ArticleScrap_articleId_fkey"
  FOREIGN KEY ("articleId") REFERENCES "ManualArticle"("id") ON DELETE CASCADE ON UPDATE CASCADE;
