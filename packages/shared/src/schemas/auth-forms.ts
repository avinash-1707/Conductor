import { z } from "zod";

/**
 * Auth form contracts for the web client's /auth page. Client-side shape
 * validation only — credential checking stays with Better Auth on the
 * server. Kept in shared so the rules live in one place if the server ever
 * needs to mirror them.
 */

export const loginFormSchema = z.object({
  email: z.email("Enter a valid email address."),
  password: z.string().min(1, "Enter your password."),
});

export type LoginFormValues = z.infer<typeof loginFormSchema>;

export const signupFormSchema = z
  .object({
    name: z.string().trim().min(1, "Enter your name."),
    email: z.email("Enter a valid email address."),
    password: z.string().min(8, "At least 8 characters."),
    confirmPassword: z.string().min(1, "Repeat your password."),
    agree: z.boolean().refine((v) => v, {
      message: "You need to accept the privacy policy.",
    }),
  })
  .refine((values) => values.password === values.confirmPassword, {
    message: "Passwords do not match.",
    path: ["confirmPassword"],
  });

export type SignupFormValues = z.infer<typeof signupFormSchema>;
