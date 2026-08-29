import { CustodianCategory } from "@prisma/client";
import { z } from "zod";

export const custodianInputSchema = z.object({
  id: z.string().trim().min(1).optional(),
  name: z.string().trim().min(1).max(120),
  category: z.enum(CustodianCategory),
  description: z.string().trim().max(500).nullable().optional(),
});

export const accountCustodianInputSchema = z.object({
  accountId: z.string().trim().min(1),
  custodianId: z.string().trim().min(1).nullable(),
});
