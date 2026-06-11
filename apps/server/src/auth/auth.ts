import { randomUUID } from "node:crypto";
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { bearer, emailOTP, jwt, organization } from "better-auth/plugins";
import { and, asc, eq, gt, sql } from "drizzle-orm";
import { db } from "../db/client";
import * as schema from "@conductor/db/schema";
import { env } from "../env";
import { logEmailSender, type EmailSender } from "./email";

/**
 * Better Auth instance — email+password, email-OTP verification, OTP password
 * reset, Google OAuth, organizations, and JWT (bearer) auth. Sessions still
 * exist server-side (Better Auth is session-rooted) but clients authenticate
 * with a bearer JWT verified statelessly (see auth/verify.ts). Active org id is
 * embedded in the JWT payload.
 */
const googleEnabled = Boolean(env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET);

/**
 * The org a fresh session should open in:
 * 1. the user's oldest membership, when one exists;
 * 2. otherwise a pending, unexpired invitation addressed to the user's email
 *    is auto-accepted (the same member-insert + status flip Better Auth's
 *    acceptInvitation performs) — an invited user logs straight into the org
 *    that invited them, never through /create-org;
 * 3. otherwise null — only genuinely org-less users see the create-org page.
 */
async function defaultSessionOrg(userId: string): Promise<string | null> {
  const membership = await db
    .select({ organizationId: schema.member.organizationId })
    .from(schema.member)
    .where(eq(schema.member.userId, userId))
    .orderBy(asc(schema.member.createdAt))
    .limit(1);
  if (membership[0]) return membership[0].organizationId;

  const users = await db
    .select({ email: schema.user.email })
    .from(schema.user)
    .where(eq(schema.user.id, userId))
    .limit(1);
  const email = users[0]?.email;
  if (!email) return null;

  const invites = await db
    .select({
      id: schema.invitation.id,
      organizationId: schema.invitation.organizationId,
      role: schema.invitation.role,
    })
    .from(schema.invitation)
    .where(
      and(
        eq(sql`lower(${schema.invitation.email})`, email.toLowerCase()),
        eq(schema.invitation.status, "pending"),
        gt(schema.invitation.expiresAt, new Date()),
      ),
    )
    .orderBy(asc(schema.invitation.createdAt))
    .limit(1);
  const invite = invites[0];
  if (!invite) return null;

  await db.insert(schema.member).values({
    id: randomUUID(),
    organizationId: invite.organizationId,
    userId,
    role: invite.role ?? "member",
    createdAt: new Date(),
  });
  await db
    .update(schema.invitation)
    .set({ status: "accepted" })
    .where(eq(schema.invitation.id, invite.id));
  return invite.organizationId;
}

export function createAuth(emailSender: EmailSender = logEmailSender) {
  return betterAuth({
    secret: env.BETTER_AUTH_SECRET,
    baseURL: env.BETTER_AUTH_URL,
    trustedOrigins: [env.WEB_ORIGIN],
    database: drizzleAdapter(db, { provider: "pg", schema }),
    databaseHooks: {
      session: {
        create: {
          // A fresh login starts with no active org, which used to bounce
          // every returning user to /create-org. Default it (see
          // defaultSessionOrg); a resolution failure must never block login —
          // the user just lands on /create-org as before.
          before: async (session) => {
            const activeOrganizationId = await defaultSessionOrg(session.userId).catch(
              () => null,
            );
            return { data: { ...session, activeOrganizationId } };
          },
        },
      },
    },
    emailAndPassword: {
      enabled: true,
      requireEmailVerification: false,
    },
    socialProviders: googleEnabled
      ? {
          google: {
            clientId: env.GOOGLE_CLIENT_ID as string,
            clientSecret: env.GOOGLE_CLIENT_SECRET as string,
          },
        }
      : undefined,
    plugins: [
      organization({
        // Invitation delivery (Unit 27): the accept link is the canonical
        // /accept-invitation/<id> page; dev transport logs it, a real provider
        // later slots in behind the same EmailSender interface.
        async sendInvitationEmail(data) {
          const acceptUrl = `${env.WEB_ORIGIN}/accept-invitation/${data.id}`;
          await emailSender.send({
            to: data.email,
            subject: `You're invited to ${data.organization.name} on Conductor`,
            text: `${data.inviter.user.name || data.inviter.user.email} invited you to the ${data.organization.name} organization. Accept: ${acceptUrl}`,
          });
        },
      }),
      emailOTP({
        otpLength: 6,
        expiresIn: 300,
        async sendVerificationOTP({ email, otp, type }) {
          const subjects: Record<string, string> = {
            "sign-in": "Your Conductor sign-in code",
            "email-verification": "Verify your Conductor email",
            "forget-password": "Reset your Conductor password",
            "change-email": "Confirm your new Conductor email",
          };
          await emailSender.send({
            to: email,
            subject: subjects[type] ?? "Your Conductor code",
            text: `Your ${type} code is ${otp}. It expires in 5 minutes.`,
            otp,
          });
        },
      }),
      jwt({
        jwt: {
          expirationTime: "15m",
          definePayload: ({ user, session }) => ({
            id: user.id,
            email: user.email,
            activeOrganizationId: session.activeOrganizationId ?? null,
          }),
        },
      }),
      bearer(),
    ],
  });
}

export type Auth = ReturnType<typeof createAuth>;

/** The process-wide auth instance (dev log email sender by default). */
export const auth = createAuth();
