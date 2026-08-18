import prisma from '../prisma/client';

export type CompleteProfileInput = {
  nickname: string;
  region: string | null;
  birthDate: Date | null;
  gender: string | null;
  agreedTermsOfService: boolean;
  agreedPrivacyPolicy: boolean;
  agreedAge14: boolean;
  agreedMarketing: boolean;
};

export type UpdateProfileInput = {
  nickname: string;
  region: string;
  birthDate: Date;
  gender: string;
  affiliation: string | null;
};

export function isUniqueConstraintError(error: unknown) {
  return typeof error === 'object' && error !== null && 'code' in error
    && (error as { code: unknown }).code === 'P2002';
}

export async function completeUserProfile(userId: string, input: CompleteProfileInput) {
  return prisma.user.update({
    where: { id: userId },
    data: {
      ...input,
      agreedAt: new Date(),
      profileCompleted: true,
    },
    select: {
      id: true,
      email: true,
      nickname: true,
      region: true,
      birthDate: true,
      gender: true,
      profileCompleted: true,
    },
  });
}

export async function getUserProfile(userId: string) {
  return prisma.user.findUnique({
    where: { id: userId },
    select: {
      id: true,
      email: true,
      nickname: true,
      region: true,
      birthDate: true,
      gender: true,
      provider: true,
      profileCompleted: true,
      role: true,
      affiliation: true,
      agreedMarketing: true,
      createdAt: true,
    },
  });
}

export async function updateUserProfile(userId: string, input: UpdateProfileInput) {
  return prisma.user.update({
    where: { id: userId },
    data: input,
    select: { id: true, nickname: true, region: true, birthDate: true, gender: true, affiliation: true },
  });
}

export type UserRole = 'user' | 'lawyer';

export async function setUserRole(userId: string, role: UserRole) {
  return prisma.user.update({
    where: { id: userId },
    data: { role },
    select: { id: true, role: true },
  });
}
