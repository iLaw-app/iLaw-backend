import { Request, Response } from 'express';
import { checkProfanityFields } from '../services/profanity';

const MAX_FIELDS = 10;
const MAX_FIELD_LENGTH = 20_000;

// POST /moderation/check { fields: { title: '...', content: '...' } }
// 프론트가 입력 중 디바운스로 호출해 어떤 표현이 걸리는지 미리 표시한다.
// 사전 로직은 서버 한 곳에만 두어 실제 등록 차단과 항상 같은 결과를 낸다.
export function checkText(req: Request, res: Response) {
  const body = req.body as { fields?: unknown } | undefined;
  const raw = body?.fields;
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    res.status(400).json({ message: '요청 내용을 확인해주세요.' });
    return;
  }
  const entries = Object.entries(raw as Record<string, unknown>);
  if (entries.length === 0 || entries.length > MAX_FIELDS) {
    res.status(400).json({ message: '요청 내용을 확인해주세요.' });
    return;
  }
  const fields: Record<string, string> = {};
  for (const [key, value] of entries) {
    if (value === undefined || value === null) continue;
    if (typeof value !== 'string' || value.length > MAX_FIELD_LENGTH) {
      res.status(400).json({ message: '요청 내용을 확인해주세요.' });
      return;
    }
    fields[key] = value;
  }
  const report = checkProfanityFields(fields);
  res.json({ blocked: report !== null, fields: report ?? {} });
}
