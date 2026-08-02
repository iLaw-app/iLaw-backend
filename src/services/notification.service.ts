import prisma from '../prisma/client';

export async function createNotificationsForLawyers(type: string, title: string, body: string, refId?: number) {
  const lawyers = await prisma.user.findMany({
    where: { role: 'lawyer' },
    select: { id: true },
  });
  if (lawyers.length === 0) return;
  await prisma.notification.createMany({
    data: lawyers.map(l => ({ userId: l.id, type, title, body, refId })),
  });
}

export async function createNotification(userId: string, type: string, title: string, body: string, refId?: number) {
  await prisma.notification.create({
    data: { userId, type, title, body, refId },
  });
}

export async function getUserNotifications(userId: string) {
  return prisma.notification.findMany({
    where: { userId },
    orderBy: { createdAt: 'desc' },
    take: 50,
  });
}

export async function markAllRead(userId: string) {
  await prisma.notification.updateMany({
    where: { userId, read: false },
    data: { read: true },
  });
}

export async function getUnreadCount(userId: string) {
  return prisma.notification.count({ where: { userId, read: false } });
}
