-- CreateTable
CREATE TABLE "ManualCategory" (
    "id" SERIAL NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "order" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ManualCategory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ManualArticle" (
    "id" SERIAL NOT NULL,
    "categoryId" INTEGER NOT NULL,
    "question" TEXT NOT NULL,
    "summary" TEXT,
    "content" TEXT NOT NULL,
    "order" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ManualArticle_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Agency" (
    "id" SERIAL NOT NULL,
    "categoryId" INTEGER NOT NULL,
    "region" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "contact" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Agency_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ManualCategory_name_key" ON "ManualCategory"("name");

-- CreateIndex
CREATE UNIQUE INDEX "ManualCategory_slug_key" ON "ManualCategory"("slug");

-- CreateIndex
CREATE INDEX "Agency_categoryId_region_idx" ON "Agency"("categoryId", "region");

-- AddForeignKey
ALTER TABLE "ManualArticle" ADD CONSTRAINT "ManualArticle_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "ManualCategory"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Agency" ADD CONSTRAINT "Agency_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "ManualCategory"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
