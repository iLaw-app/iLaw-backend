import 'dotenv/config';
import { Prisma } from '@prisma/client';
import prisma from '../src/prisma/client';
import { getEmbedding } from '../src/services/embedding.service';

async function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

async function main() {
  const articles = await prisma.manualArticle.findMany({
    select: { id: true, question: true, summary: true },
  });

  console.log(`총 ${articles.length}개 아티클 임베딩 시작`);

  for (let i = 0; i < articles.length; i++) {
    const a = articles[i];
    const text = `${a.question} ${a.summary ?? ''}`.trim();

    try {
      const embedding = await getEmbedding(text);
      const vectorStr = `[${embedding.join(',')}]`;
      await prisma.$executeRaw(
        Prisma.sql`UPDATE "ManualArticle" SET embedding = ${vectorStr}::vector WHERE id = ${a.id}`
      );
      console.log(`[${i + 1}/${articles.length}] id=${a.id} 완료`);
    } catch (e) {
      console.error(`[${i + 1}/${articles.length}] id=${a.id} 실패:`, e);
    }

    // API rate limit 방지 (50ms 간격)
    if (i < articles.length - 1) await sleep(50);
  }

  console.log('임베딩 완료');
  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
