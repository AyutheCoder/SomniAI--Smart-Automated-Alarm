import type { NextAuthOptions } from "next-auth";
import CredentialsProvider from "next-auth/providers/credentials";
import GoogleProvider from "next-auth/providers/google";
import bcrypt from "bcryptjs";
import { connectToDatabase } from "@/lib/mongoose";
import { User } from "@/models/User";
const googleId = process.env.GOOGLE_CLIENT_ID;
const googleSecret = process.env.GOOGLE_CLIENT_SECRET;
const providers: NextAuthOptions["providers"] = [
  CredentialsProvider({
    name: "Email & Password",
    credentials: {
      email: { label: "Email", type: "email" },
      password: { label: "Password", type: "password" },
    },
    async authorize(credentials) {
      const email = credentials?.email?.toLowerCase().trim();
      const password = credentials?.password;
      if (!email || !password)
        return null;
      await connectToDatabase();
      const user = await User.findOne({ email }).select("+passwordHash").lean<{
        _id: unknown;
        email: string;
        name?: string;
        image?: string;
        passwordHash?: string;
      }>();
      if (!user?.passwordHash)
        return null;
      const valid = await bcrypt.compare(password, user.passwordHash);
      if (!valid)
        return null;
      return {
        id: String(user._id),
        email: user.email,
        name: user.name ?? null,
        image: user.image ?? null,
      };
    },
  }),
];
if (googleId && googleSecret) {
  providers.push(GoogleProvider({
    clientId: googleId,
    clientSecret: googleSecret,
  }));
}
export const authOptions: NextAuthOptions = {
  providers,
  session: { strategy: "jwt" },
  pages: {
    signIn: "/sign-in",
  },
  secret: process.env.NEXTAUTH_SECRET,
  callbacks: {
    async jwt({ token, user, account }) {
      if (account?.provider === "google" && token.email) {
        await connectToDatabase();
        const existing = await User.findOne({ email: token.email.toLowerCase() });
        if (existing) {
          token.uid = String(existing._id);
        }
        else {
          const created = await User.create({
            email: token.email.toLowerCase(),
            name: token.name ?? undefined,
            image: token.picture ?? undefined,
            provider: "google",
          });
          token.uid = String(created._id);
        }
      }
      else if (user?.id) {
        token.uid = user.id;
      }
      return token;
    },
    async session({ session, token }) {
      if (session.user && token.uid) {
        session.user.id = token.uid as string;
      }
      return session;
    },
  },
};