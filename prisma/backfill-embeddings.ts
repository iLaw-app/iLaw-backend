import 'dotenv/config';
import prisma from '../src/prisma/client';
import { resolveScriptMode } from './script-safety';
import {
  buildEmbedInput,
  embedInputHash,
  embedText,
  toVectorLiteral,
} from '../src/services/ai.embeddings';

// 매뉴얼 임베딩 backfill (재실행 안전/idempotent).
//
// 입력 텍스트(제목+요약+본문) 해시가 저장된 embedInputHash와 다른 행만 (재)임베딩한다.
// notion-migrate가 deleteMany+createMany로 id를 churn시키므로, id가 아니라 "같은 행 +
// 해시"로 최신성을 판정한다. 콘텐츠 재적재 후 이 스크립트를 다시 돌리면 바뀐 행만 갱신된다.
//
// 사용: npm run ai:embed                      (dry-run)
//       npm run ai:embed -- --apply --target=local

const BATCH_SIZE = 50;

async function main() {
  const mode = resolveScriptMode(process.argv.slice(2));

  const rows = await prisma.manualArticle.findMany({
    select: { id: true, question: true, summary: true, content: true, embedInputHash: true },
  });

  const pending = rows
    .map((r) => {
      const input = buildEmbedInput(r.question, r.summary, r.content);
      return { id: r.id, input, hash: embedInputHash(input), current: r.embedInputHash };
    })
    .filter((r) => r.hash !== r.current);

  console.log(`[embed] ${pending.length}/${rows.length} manuals need (re)embedding (target=${mode.target}, db=${mode.databaseLabel})`);

  if (!mode.apply) {
    console.log('[embed] dry-run. Pass --apply to write embeddings.');
    return;
  }

  let done = 0;
  for (let i = 0; i < pending.length; i += BATCH_SIZE) {
    const batch = pending.slice(i, i + BATCH_SIZE);
    for (const item of batch) {
      const vector = await embedText(item.input);
      await prisma.$executeRaw`
        UPDATE "ManualArticle"
        SET "embedding" = ${toVectorLiteral(vector)}::vector,
            "embedInputHash" = ${item.hash}
        WHERE "id" = ${item.id}
      `;
      done += 1;
    }
    console.log(`[embed] ${done}/${pending.length} done`);
  }

  console.log('[embed] complete.');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
