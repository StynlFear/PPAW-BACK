import prisma from "../config/db";

export async function getCredentialByEmail(email: string) {
  return prisma.authCredential.findUnique({
    where: { email },
    include: { user: true },
  });
}

export async function getUserProfileByEmail(email: string) {
  return prisma.userProfile.findFirst({
    where: { email },
  });
}

export async function createCredential(input: {
  userId: string;
  email: string;
  passwordHash: string;
}) {
  return prisma.authCredential.create({
    data: {
      userId: input.userId,
      email: input.email,
      passwordHash: input.passwordHash,
    },
  });
}
