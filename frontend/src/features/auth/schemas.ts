import { z } from 'zod';

/**
 * Client-side form rules, mirroring the API's.
 *
 * These are a **copy for fast feedback**, not the authority. The API enforces
 * every one of them again in `app/schemas/auth.py` and
 * `app/services/auth_service.py`, and its 422 field errors are mapped back
 * onto these inputs — so a rule that drifts shows up as a server error on a
 * field the form thought was fine, rather than as a hole.
 *
 * The bounds come from `app/security/passwords.py` and the domain rule from
 * `auth_service.normalise_email`.
 */

/** From `MIN_PASSWORD_LENGTH` in `app/security/passwords.py`. */
export const MIN_PASSWORD_LENGTH = 12;

/** From `MAX_PASSWORD_LENGTH` in `app/security/passwords.py`. */
export const MAX_PASSWORD_LENGTH = 128;

/** The only domain that may self-register. Compared for exact equality. */
export const ALLOWED_EMAIL_DOMAIN = 'acme.inc';

/** Longest full name the API accepts. */
const MAX_FULL_NAME_LENGTH = 120;

const passwordField = z
  .string()
  .min(MIN_PASSWORD_LENGTH, `Use at least ${MIN_PASSWORD_LENGTH} characters.`)
  .max(MAX_PASSWORD_LENGTH, `Use at most ${MAX_PASSWORD_LENGTH} characters.`);

/**
 * An `@acme.inc` address.
 *
 * Split on the **last** `@` and compare the domain for equality, exactly as
 * `normalise_email` does — that is what rejects `sub.acme.inc`,
 * `acme.inc.evil.com` and `victim@acme.inc@attacker.com` alike.
 */
const acmeEmailField = z
  .string()
  .trim()
  .min(1, 'Enter your email address.')
  .transform((value) => value.toLowerCase())
  .refine((value) => domainOf(value) === ALLOWED_EMAIL_DOMAIN, {
    message: `Use your @${ALLOWED_EMAIL_DOMAIN} address.`,
  })
  .refine((value) => isPlausibleLocalPart(value), {
    message: 'Enter a valid email address.',
  });

export const loginSchema = z.object({
  email: z.string().trim().min(1, 'Enter your email address.'),
  password: z.string().min(1, 'Enter your password.'),
});

export const registerSchema = z
  .object({
    full_name: z
      .string()
      .trim()
      .min(1, 'Enter your name.')
      .max(MAX_FULL_NAME_LENGTH, `Use at most ${MAX_FULL_NAME_LENGTH} characters.`),
    email: acmeEmailField,
    password: passwordField,
    confirm_password: z.string(),
  })
  .refine((values) => values.password === values.confirm_password, {
    message: 'The two passwords do not match.',
    path: ['confirm_password'],
  });

export const changePasswordSchema = z
  .object({
    current_password: z.string().min(1, 'Enter your current password.'),
    new_password: passwordField,
    confirm_password: z.string(),
  })
  .refine((values) => values.new_password === values.confirm_password, {
    message: 'The two passwords do not match.',
    path: ['confirm_password'],
  })
  .refine((values) => values.new_password !== values.current_password, {
    // The API refuses this too, with PASSWORD_UNCHANGED.
    message: 'Choose a password you have not used before.',
    path: ['new_password'],
  });

export type LoginValues = z.infer<typeof loginSchema>;
export type RegisterValues = z.infer<typeof registerSchema>;
export type ChangePasswordValues = z.infer<typeof changePasswordSchema>;

/** Everything after the final `@`, or an empty string when there is none. */
function domainOf(email: string): string {
  const index = email.lastIndexOf('@');
  return index === -1 ? '' : email.slice(index + 1);
}

/** Check the part before the final `@` looks like an address, not a trap. */
function isPlausibleLocalPart(email: string): boolean {
  const localPart = email.slice(0, email.lastIndexOf('@'));
  return localPart.length > 0 && localPart.length <= 64 && !localPart.includes('@');
}
