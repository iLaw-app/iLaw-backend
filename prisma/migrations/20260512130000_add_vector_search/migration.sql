CREATE EXTENSION IF NOT EXISTS vector;

ALTER TABLE "ManualArticle" ADD COLUMN IF NOT EXISTS embedding vector(1536);
ALTER TABLE "QnAPost" ADD COLUMN IF NOT EXISTS embedding vector(1536);

CREATE INDEX IF NOT EXISTS manual_article_embedding_idx ON "ManualArticle" USING ivfflat (embedding vector_cosine_ops) WITH (lists = 10);
CREATE INDEX IF NOT EXISTS qna_post_embedding_idx ON "QnAPost" USING ivfflat (embedding vector_cosine_ops) WITH (lists = 10);
