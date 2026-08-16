import type OpenAI from 'openai';
import prisma from '../prisma/client';
import { createNotification } from './notification.service';

// 2차 필터: OpenAI Moderation API로 문맥 기반 검열.
// 클린봇 방식 — 글은 일단 게시(visible)된 뒤 백그라운드에서 검열되어 flagged면 blind 처리된다.

let client: OpenAI | null = null;
async function openai(): Promise<OpenAI> {
  if (!client) {
    const { default: OpenAIClient } = await import('openai');
    client = new OpenAIClient({ apiKey: process.env[['OPENAI', 'API', 'KEY'].join('_')] });
  }
  return client;
}

// flagged 여부 반환. 키 미설정/오류/타임아웃 시 fail-open(false)으로 게시를 막지 않는다.
export async function isFlaggedByAI(text: string | null | undefined): Promise<boolean> {
  if (!text?.trim() || !process.env.OPENAI_API_KEY) return false;
  try {
    const result = await (await openai()).moderations.create({
      model: 'omni-moderation-latest',
      input: text,
    });
    return result.results[0]?.flagged ?? false;
  } catch {
    // 검열 실패가 서비스 장애가 되면 안 된다 — 게시는 유지.
    return false;
  }
}

type BlindTarget =
  | { kind: 'comment'; id: number; text: string; authorId: string | null }
  | { kind: 'post'; id: number; text: string; authorId: string | null };

const BLIND_NOTICE = {
  comment: { title: '댓글이 비공개 처리되었습니다', body: '작성하신 댓글에서 부적절한 표현이 감지되어 비공개 처리되었습니다.' },
  post: { title: '게시글이 비공개 처리되었습니다', body: '작성하신 게시글에서 부적절한 표현이 감지되어 비공개 처리되었습니다.' },
};

// 게시 후 백그라운드 검열. createComment/createPost에서 fire-and-forget으로 호출한다.
// visible 상태일 때만 hidden으로 전환하고, 전환에 성공하면 작성자에게 알림을 보낸다.
export async function moderateAndBlind(target: BlindTarget): Promise<void> {
  try {
    const flagged = await isFlaggedByAI(target.text);
    if (!flagged) return;

    const updated =
      target.kind === 'comment'
        ? await prisma.communityComment.updateMany({
            where: { id: target.id, status: 'visible' },
            data: { status: 'hidden' },
          })
        : await prisma.communityPost.updateMany({
            where: { id: target.id, status: 'visible' },
            data: { status: 'hidden' },
          });

    if (updated.count > 0 && target.authorId) {
      const notice = BLIND_NOTICE[target.kind];
      await createNotification(target.authorId, 'community_blinded', notice.title, notice.body, target.id);
    }
  } catch {
    // 백그라운드 작업 — 실패해도 요청 흐름에 영향 없음.
  }
}
