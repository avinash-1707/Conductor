import { z } from "zod";

/** Single Zod-validated input object (code-standards Temporal). */
export const greetInputSchema = z.object({
  name: z.string().min(1),
});
export type GreetInput = z.infer<typeof greetInputSchema>;

export const greetOutputSchema = z.object({
  greeting: z.string().min(1),
});
export type GreetOutput = z.infer<typeof greetOutputSchema>;

/**
 * Trivial, pure, idempotent activity (architecture invariant 2): running it
 * twice with the same input yields the same output and has no side effects.
 */
export async function greet(input: GreetInput): Promise<GreetOutput> {
  const { name } = greetInputSchema.parse(input);
  return { greeting: `Hello, ${name}! Conductor worker is alive.` };
}
