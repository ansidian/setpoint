// Shapes stored on the message record and read by the web app.
import {z} from 'zod';

/**
 * What a security email says happened, extracted at triage. The decisive fact goes on the row
 * ("New sign-in · MacBook Pro · Los Angeles"). `unfamiliar` marks a place or device the user doesn't
 * use ("(not a location you use)").
 */
export const securityFactsSchema = z.strictObject({
  what: z.string().min(1),
  device: z.string().min(1).optional(),
  location: z.string().min(1).optional(),
  app: z.string().min(1).optional(),
  unfamiliar: z.boolean().optional(),
});
export type SecurityFacts = z.infer<typeof securityFactsSchema>;

/** One address from an email's To, Cc or Reply-To: lowercased, with its display name when it had one. */
export interface Recipient {
  name: string | null;
  address: string;
}
