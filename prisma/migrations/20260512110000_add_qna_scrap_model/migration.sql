-- CreateTable: QnAScrap
CREATE TABLE "QnAScrap" (
    "id" SERIAL NOT NULL,
    "userId" TEXT NOT NULL,
    "postId" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "QnAScrap_pkey" PRIMARY KEY ("id")
);

-- CreateIndex: QnAScrap unique constraint
CREATE UNIQUE INDEX "QnAScrap_userId_postId_key" ON "QnAScrap"("userId", "postId");

-- AddForeignKey: QnAScrap.userId -> User.id
ALTER TABLE "QnAScrap" ADD CONSTRAINT "QnAScrap_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey: QnAScrap.postId -> QnAPost.id
ALTER TABLE "QnAScrap" ADD CONSTRAINT "QnAScrap_postId_fkey" FOREIGN KEY ("postId") REFERENCES "QnAPost"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
