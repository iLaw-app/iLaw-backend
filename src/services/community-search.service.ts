import prisma from '../prisma/client';
import { expandQuery } from './synonyms';
import { scoreAndRank } from './search.util';
import { ANONYMOUS_POST_AUTHOR } from './community-shared';

export async function searchCommunityPosts(query: string, debug = false) {
  const terms = await expandQuery(query);

  const posts = await prisma.communityPost.findMany({
    where: {
      status: 'visible',
      OR: terms.flatMap((term) => [
        { title: { contains: term } },
        { content: { contains: term } },
      ]),
    },
    select: {
      id: true,
      title: true,
      content: true,
      createdAt: true,
      _count: {
        select: {
          likes: true,
          comments: { where: { status: { not: 'deleted' } } },
          bookmarks: true,
        },
      },
    },
    take: 100,
  });

  const ranked = scoreAndRank(
    posts,
    terms,
    (p) => [[p.title, 2], [p.content ?? '', 1.5]],
    { phrase: query },
  );

  const results = ranked
    .map(({ score, _count, ...rest }) =>
      debug
        ? { ...rest, nickname: ANONYMOUS_POST_AUTHOR, likes: _count.likes, bookmarks: _count.bookmarks, comments: _count.comments, score }
        : { ...rest, nickname: ANONYMOUS_POST_AUTHOR, likes: _count.likes, bookmarks: _count.bookmarks, comments: _count.comments },
    );

  return { results, expandedTerms: terms };
}