import { Router } from 'express';
import { authenticate, optionalAuthenticate } from '../middlewares/authenticate';
import {
  listPosts,
  getPost,
  createPost,
  updatePost,
  deletePost,
  toggleLike,
  toggleBookmark,
  votePoll,
  listComments,
  createComment,
  deleteComment,
} from '../controllers/community.controller';

const router = Router();

router.get('/', listPosts);
router.get('/:id', optionalAuthenticate, getPost);
router.post('/', authenticate, createPost);
router.put('/:id', authenticate, updatePost);
router.delete('/:id', authenticate, deletePost);
router.post('/:id/like', authenticate, toggleLike);
router.post('/:id/bookmark', authenticate, toggleBookmark);
router.post('/:id/vote', authenticate, votePoll);
router.get('/:id/comments', listComments);
router.post('/:id/comments', authenticate, createComment);
router.delete('/:id/comments/:commentId', authenticate, deleteComment);

export default router;
