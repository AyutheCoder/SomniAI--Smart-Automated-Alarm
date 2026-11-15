import type { NextAuthOptions } from "next-auth";
import CredentialsProvider from "next-auth/providers/credentials";
import GoogleProvider from "next-auth/providers/google";
import bcrypt from "bcryptjs";
import { accountKey, hit, POLICIES } from "@/lib/rateLimit";
import { GOOGLE_REFUSED_PATH, googleVerdict } from "@/lib/googleSignIn";
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
      // Per account, from any address (7.1): password guessing spread over many
      // addresses. Keyed by a hash, so the counts don't hold e-mail addresses.
      const verdict = await hit(POLICIES.signInAccount, accountKey(email));
      if (!verdict.ok)
        throw new Error("Too many sign-in attempts for this account. Try again in a few minutes.");
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
    // Google joins an account only with an address Google verified, and never one
    // made with a password (lib/googleSignIn.ts: account pre-hijacking, 7.1).
    async signIn({ account, profile }) {
      if (account?.provider !== "google") {
        return true;
      }
      const email = profile?.email?.toLowerCase().trim();
      if (!email) {
        return GOOGLE_REFUSED_PATH.unverified;
      }
      await connectToDatabase();
      const existing = await User.findOne({ email }).select("+passwordHash").lean<{ passwordHash?: string }>();
      const verdict = googleVerdict(profile as { email_verified?: unknown }, existing);
      return verdict === "ok" ? true : GOOGLE_REFUSED_PATH[verdict];
    },
    async jwt({ token, user, account }) {
      if (account?.provider === "google" && token.email) {
        await connectToDatabase();
        const existing = await User.findOne({ email: token.email.toLowerCase() }).select("+passwordHash");
        if (existing?.passwordHash) {
          // signIn refuses this first; never reached, and never joined if it were.
          throw new Error("Google sign-in can't join an account with a password.");
        }
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