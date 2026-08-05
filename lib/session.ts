import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
export async function getUserId(): Promise<string | null> {
  const session = await getServerSession(authOptions);
  return session?.user?.id ?? null;
}