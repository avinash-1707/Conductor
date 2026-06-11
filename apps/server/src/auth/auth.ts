import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { bearer, emailOTP, jwt, organization } from "better-auth/plugins";
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

export function createAuth(emailSender: EmailSender = logEmailSender) {
  return betterAuth({
    secret: env.BETTER_AUTH_SECRET,
    baseURL: env.BETTER_AUTH_URL,
    trustedOrigins: [env.WEB_ORIGIN],
    database: drizzleAdapter(db, { provider: "pg", schema }),
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
