import { Router } from 'express';
import { listCategories, listArticles, getArticle, listAgencies } from '../controllers/manual.controller';

const router = Router();

/**
 * @swagger
 * /manual/categories:
 *   get:
 *     summary: 매뉴얼 카테고리 목록
 *     tags: [Manual]
 *     responses:
 *       200:
 *         description: 카테고리 목록
 *         content:
 *           application/json:
 *             schema:
 *               type: array
 *               items:
 *                 $ref: '#/components/schemas/ManualCategory'
 */
router.get('/categories', listCategories);

/**
 * @swagger
 * /manual/categories/{slug}/articles:
 *   get:
 *     summary: 카테고리별 아티클 목록
 *     tags: [Manual]
 *     parameters:
 *       - in: path
 *         name: slug
 *         required: true
 *         schema:
 *           type: string
 *         example: child-abuse
 *     responses:
 *       200:
 *         description: 아티클 목록 (본문 제외)
 *         content:
 *           application/json:
 *             schema:
 *               type: array
 *               items:
 *                 $ref: '#/components/schemas/ManualArticleSummary'
 *       404:
 *         description: 카테고리 없음
 */
router.get('/categories/:slug/articles', listArticles);

/**
 * @swagger
 * /manual/articles/{id}:
 *   get:
 *     summary: 아티클 상세 조회
 *     tags: [Manual]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: integer
 *         example: 1
 *     responses:
 *       200:
 *         description: 아티클 상세 (본문 포함)
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ManualArticleDetail'
 *       404:
 *         description: 아티클 없음
 */
router.get('/articles/:id', getArticle);

/**
 * @swagger
 * /manual/categories/{slug}/agencies:
 *   get:
 *     summary: 카테고리별 기관 연락망
 *     tags: [Manual]
 *     parameters:
 *       - in: path
 *         name: slug
 *         required: true
 *         schema:
 *           type: string
 *         example: child-abuse
 *       - in: query
 *         name: region
 *         schema:
 *           type: string
 *         example: 서울
 *         description: 지역 필터 (생략 시 전체)
 *     responses:
 *       200:
 *         description: 기관 목록
 *         content:
 *           application/json:
 *             schema:
 *               type: array
 *               items:
 *                 $ref: '#/components/schemas/Agency'
 */
router.get('/categories/:slug/agencies', listAgencies);

/**
 * @swagger
 * components:
 *   schemas:
 *     ManualCategory:
 *       type: object
 *       properties:
 *         id:
 *           type: integer
 *         name:
 *           type: string
 *           example: 아동학대
 *         slug:
 *           type: string
 *           example: child-abuse
 *         order:
 *           type: integer
 *     ManualArticleSummary:
 *       type: object
 *       properties:
 *         id:
 *           type: integer
 *         question:
 *           type: string
 *           example: 친권은 무엇이고 누가 친권자가 되나요?
 *         summary:
 *           type: string
 *           nullable: true
 *         order:
 *           type: integer
 *     ManualArticleDetail:
 *       type: object
 *       properties:
 *         id:
 *           type: integer
 *         question:
 *           type: string
 *         summary:
 *           type: string
 *           nullable: true
 *         content:
 *           type: string
 *           description: 마크다운 형식의 본문
 *         category:
 *           type: object
 *           properties:
 *             name:
 *               type: string
 *             slug:
 *               type: string
 *     Agency:
 *       type: object
 *       properties:
 *         id:
 *           type: integer
 *         region:
 *           type: string
 *           example: 서울
 *         name:
 *           type: string
 *           example: 금융감독원
 *         role:
 *           type: string
 *           example: 금융사기·불법대출 상담
 *         contact:
 *           type: string
 *           example: "1332"
 */

export default router;
