import { Router } from 'express';
import { authenticate, optionalAuthenticate } from '../middlewares/authenticate';
import {
  searchPosts,
  listPosts,
  getPost,
  createPost,
  updatePost,
  deletePost,
  toggleLike,
  toggleBookmark,
  getMyBookmarks,
  getMyPosts,
  votePoll,
  listComments,
  createComment,
  deleteComment,
  toggleCommentLike,
  reportPost,
  reportComment,
} from '../controllers/community.controller';

const router = Router();

router.get('/search', searchPosts);
router.get('/my-bookmarks', authenticate, getMyBookmarks);
router.get('/my-posts', authenticate, getMyPosts);
router.get('/', listPosts);
router.get('/:id', optionalAuthenticate, getPost);
router.post('/', authenticate, createPost);
router.put('/:id', authenticate, updatePost);
router.delete('/:id', authenticate, deletePost);
router.post('/:id/like', authenticate, toggleLike);
router.post('/:id/bookmark', authenticate, toggleBookmark);
router.post('/:id/vote', authenticate, votePoll);
router.post('/:id/report', authenticate, reportPost);
router.get('/:id/comments', optionalAuthenticate, listComments);
router.post('/:id/comments', authenticate, createComment);
router.post('/:id/comments/:commentId/like', authenticate, toggleCommentLike);
router.post('/:id/comments/:commentId/report', authenticate, reportComment);
router.delete('/:id/comments/:commentId', authenticate, deleteComment);

export default router;
