import prisma from './database';

/** Serialize first-admin creation across requests and backend processes. */
export async function createInitialAdmin(passwordHash: string, mustChangePassword: boolean) {
  return prisma.$transaction(async (tx) => {
    // Lock before reading: count-then-create otherwise permits concurrent setup
    // requests to create multiple admins. Keep password hashing outside this lock.
    await tx.$executeRaw`LOCK TABLE "User" IN EXCLUSIVE MODE`;
    if (await tx.user.count() > 0) return null;
    return tx.user.create({
      data: { passwordHash, mustChangePassword },
      select: { id: true },
    });
  });
}
