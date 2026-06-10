import { logger } from "../logger";

/**
 * Pluggable transactional-email sender. Auth flows (OTP verification, OTP
 * sign-in, OTP password reset) send through this interface. The Phase-1 default
 * logs the payload via pino so the full flow works end-to-end without an email
 * account; a real provider (Resend/SMTP) is wired later behind the same
 * interface. Never log secrets other than the dev OTP itself.
 */
export interface AuthEmail {
  to: string;
  subject: string;
  /** Short human body; the OTP/code is also surfaced structurally for dev. */
  text: string;
  otp?: string;
}

export interface EmailSender {
  send(email: AuthEmail): Promise<void>;
}

/** Dev sender — logs the email (and OTP) instead of delivering it. */
export const logEmailSender: EmailSender = {
  async send(email) {
    logger.info(
      { email: email.to, subject: email.subject, otp: email.otp },
      "auth email (dev log transport — not actually delivered)",
    );
  },
};
