import { PrismaClient } from '@prisma/client';
import { printScriptMode, resolveScriptMode } from './script-safety';

// 커뮤니티 검열/신고 데모 데이터.
// - 임금체불 게시글 1개
// - 정상 댓글 + 욕설 블라인드(hidden) 댓글 + 신고 3회 자동삭제(deleted) 댓글 + 답글
// - 블라인드/삭제 댓글 작성자에게 가는 알림(Notification)까지 함께 생성
// 멱등: 같은 데모 게시글을 지우고 새로 만든다.

const prisma = new PrismaClient();

const POST_TITLE = '3개월째 월급 안 주는 사장, 어떻게 대응하죠?';
const POST_CONTENT =
  '편의점 알바인데 사장이 이런저런 핑계로 3개월째 월급을 미룹니다. ' +
  '노동청에 신고하면 오히려 불이익이 있을까요? 어떻게 대응해야 할지 조언 부탁드려요.';

// 데모 계정: provider/providerId는 @@unique 이므로 upsert 키로 사용한다.
const DEMO_USERS = [
  { key: 'author', nickname: 'demo-임금체불-글쓴이' },
  { key: 'a', nickname: 'demo-댓글러-A' },
  { key: 'b', nickname: 'demo-댓글러-B' },
  { key: 'c', nickname: 'demo-댓글러-C' },
] as const;

// 라벨(익명N)은 댓글 createdAt 등장 순서로 매겨지므로 시간을 고정해 결정적으로 만든다.
const BASE = new Date('2026-08-02T09:00:00.000Z');
const at = (offsetMinutes: number) => new Date(BASE.getTime() + offsetMinutes * 60_000);

async function main() {
  const mode = resolveScriptMode(process.argv.slice(2));
  printScriptMode(mode);

  console.log('커뮤니티 검열/신고 데모를 준비합니다:');
  console.log(`  게시글: "${POST_TITLE}"`);
  console.log('  댓글: 익명1(정상) / 익명2(욕설→hidden) / 익명3(정상) / 익명1(답글) / 익명2(신고3회→deleted)');
  console.log('  + 블라인드/삭제 알림 2건, 삭제 댓글 신고 3건');
  if (!mode.apply) return;

  const users = new Map<string, string>();
  for (const u of DEMO_USERS) {
    const user = await prisma.user.upsert({
      where: { provider_providerId: { provider: 'demo', providerId: `demo-${u.key}` } },
      update: { nickname: u.nickname },
      create: {
        provider: 'demo',
        providerId: `demo-${u.key}`,
        nickname: u.nickname,
        role: 'user',
        profileCompleted: true,
      },
      select: { id: true },
    });
    users.set(u.key, user.id);
  }
  const authorId = users.get('author')!;
  const uA = users.get('a')!;
  const uB = users.get('b')!;
  const uC = users.get('c')!;

  await prisma.$transaction(async (tx) => {
    // 멱등: 기존 데모 게시글 제거(cascade로 댓글·신고·좋아요 정리)
    await tx.communityPost.deleteMany({ where: { authorId, title: POST_TITLE } });

    const post = await tx.communityPost.create({
      data: {
        authorId,
        title: POST_TITLE,
        content: POST_CONTENT,
        imageUrls: [],
        status: 'visible',
        createdAt: BASE,
        updatedAt: BASE,
      },
      select: { id: true },
    });

    // 1) 정상 댓글 (익명1)
    await tx.communityComment.create({
      data: {
        postId: post.id, authorId: uA, content: '고용노동부 1350 상담부터 받아보세요. 진정 넣으면 대부분 해결됩니다.',
        status: 'visible', createdAt: at(1),
      },
    });

    // 2) 욕설 댓글 → 2차 검열로 블라인드된 상태(hidden). 원문은 보존, API가 마스킹.
    const blinded = await tx.communityComment.create({
      data: {
        postId: post.id, authorId: uB, content: '이런 ㅅㅂ 사장 새끼는 진짜 상종을 못하겠네요',
        status: 'hidden', createdAt: at(2),
      },
      select: { id: true },
    });

    // 3) 정상 댓글 (익명3)
    const sympathy = await tx.communityComment.create({
      data: {
        postId: post.id, authorId: uC, content: '저도 비슷한 경험 있어요. 근로계약서랑 카톡 기록 꼭 챙기세요.',
        status: 'visible', createdAt: at(3),
      },
      select: { id: true },
    });

    // 4) 3번 댓글에 대한 답글 (익명1) — 삭제/블라인드가 스레드를 끊지 않는지 확인용
    await tx.communityComment.create({
      data: {
        postId: post.id, authorId: uA, parentId: sympathy.id, content: '맞아요, 증거 확보가 제일 중요하더라고요.',
        status: 'visible', createdAt: at(4),
      },
    });

    // 5) 신고 3회 누적으로 자동 삭제된 댓글(removed). 서로 다른 3명의 신고 이력을 함께 남긴다.
    const removed = await tx.communityComment.create({
      data: {
        postId: post.id, authorId: uB, content: '느금마 같은 소리 하고 앉아있네 ㅋㅋ',
        status: 'removed', createdAt: at(5),
      },
      select: { id: true },
    });
    await tx.communityCommentReport.createMany({
      data: [
        { commentId: removed.id, reporterId: authorId, reason: '욕설/비하' },
        { commentId: removed.id, reporterId: uA, reason: '욕설/비하' },
        { commentId: removed.id, reporterId: uC, reason: '욕설/비하' },
      ],
    });

    // 작성자 알림: 블라인드 + 삭제
    await tx.notification.createMany({
      data: [
        {
          userId: uB, type: 'community_blinded', refId: blinded.id,
          title: '댓글이 비공개 처리되었습니다',
          body: '작성하신 댓글에서 부적절한 표현이 감지되어 비공개 처리되었습니다.',
        },
        {
          userId: uB, type: 'community_removed', refId: removed.id,
          title: '댓글이 삭제되었습니다',
          body: '신고가 누적되어 작성하신 댓글이 삭제되었습니다.',
        },
      ],
    });

    console.log(`생성 완료: postId=${post.id}, 블라인드 commentId=${blinded.id}, 삭제 commentId=${removed.id}`);
  }, { timeout: 120_000, maxWait: 20_000 });

  console.log('Done!');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
