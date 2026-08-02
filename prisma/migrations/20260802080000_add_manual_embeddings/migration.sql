-- Enable pgvector (읽기 경로 포함: 과거 write-only로 제거된 전례를 반복하지 않도록
-- Phase 4에서 semanticSearch의 $queryRaw 조회와 함께 재도입).
CREATE EXTENSION IF NOT EXISTS "vector";

-- AlterTable: 임베딩 + 재임베딩 판정용 해시(모두 nullable → 기존 행 보존)
ALTER TABLE "ManualArticle" ADD COLUMN     "embedding" vector(1536),
ADD COLUMN     "embedInputHash" TEXT;

-- Cosine 거리용 HNSW 인덱스(성장 친화적, 재빌드 불필요). Prisma 스키마로는
-- 표현할 수 없으므로 이 마이그레이션에서 직접 생성한다.
CREATE INDEX "ManualArticle_embedding_hnsw_idx"
    ON "ManualArticle" USING hnsw ("embedding" vector_cosine_ops);
