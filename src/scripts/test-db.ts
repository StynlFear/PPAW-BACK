import prisma from "../config/db";

async function main() {
  await prisma.$connect();
  console.log("Supabase Connection Successful");
  await prisma.$disconnect();
}

main().catch(async (err) => {
  console.error("Supabase Connection Failed");
  console.error(err);
  try {
    await prisma.$disconnect();
  } catch {
    // ignore
  }
  process.exit(1);
});
