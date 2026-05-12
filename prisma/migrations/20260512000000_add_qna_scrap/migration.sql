-- AlterTable: Add role to User
ALTER TABLE "User" ADD COLUMN "role" TEXT NOT NULL DEFAULT 'user';

-- CreateTable: QnAPost
CREATE TABLE "QnAPost" (
    "id" SERIAL NOT NULL,
    "authorId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "QnAPost_pkey" PRIMARY KEY ("id")
);

-- CreateTable: QnAAnswer
CREATE TABLE "QnAAnswer" (
    "id" SERIAL NOT NULL,
    "postId" INTEGER NOT NULL,
    "lawyerId" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "QnAAnswer_pkey" PRIMARY KEY ("id")
);

-- CreateTable: ArticleScrap
CREATE TABLE "ArticleScrap" (
    "id" SERIAL NOT NULL,
    "userId" TEXT NOT NULL,
    "articleId" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ArticleScrap_pkey" PRIMARY KEY ("id")
);

-- CreateIndex: QnAAnswer.postId unique
CREATE UNIQUE INDEX "QnAAnswer_postId_key" ON "QnAAnswer"("postId");

-- CreateIndex: ArticleScrap unique constraint
CREATE UNIQUE INDEX "ArticleScrap_userId_articleId_key" ON "ArticleScrap"("userId", "articleId");

-- AddForeignKey: QnAPost.authorId -> User.id
ALTER TABLE "QnAPost" ADD CONSTRAINT "QnAPost_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey: QnAAnswer.postId -> QnAPost.id
ALTER TABLE "QnAAnswer" ADD CONSTRAINT "QnAAnswer_postId_fkey" FOREIGN KEY ("postId") REFERENCES "QnAPost"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey: QnAAnswer.lawyerId -> User.id
ALTER TABLE "QnAAnswer" ADD CONSTRAINT "QnAAnswer_lawyerId_fkey" FOREIGN KEY ("lawyerId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey: ArticleScrap.userId -> User.id
ALTER TABLE "ArticleScrap" ADD CONSTRAINT "ArticleScrap_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey: ArticleScrap.articleId -> ManualArticle.id
ALTER TABLE "ArticleScrap" ADD CONSTRAINT "ArticleScrap_articleId_fkey" FOREIGN KEY ("articleId") REFERENCES "ManualArticle"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
