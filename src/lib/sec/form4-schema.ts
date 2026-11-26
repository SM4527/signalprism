import { z } from "zod";

/** An element like `<x><value>..</value></x>`; may also be an empty element. */
const valueNode = z.union([z.literal(""), z.looseObject({ value: z.string().optional() })]).optional();

const tx = z.looseObject({
  securityTitle: valueNode,
  transactionDate: valueNode,
  transactionCoding: z.looseObject({ transactionCode: z.string() }),
  transactionAmounts: z
    .looseObject({
      transactionShares: valueNode,
      transactionPricePerShare: valueNode,
      transactionAcquiredDisposedCode: valueNode,
    })
    .optional(),
  postTransactionAmounts: z.looseObject({ sharesOwnedFollowingTransaction: valueNode }).optional(),
  ownershipNature: z
    .looseObject({ directOrIndirectOwnership: valueNode, natureOfOwnership: valueNode })
    .optional(),
});

/** A `nonDerivativeHolding` row: what is owned, with no transaction. */
const holding = z.looseObject({
  securityTitle: valueNode,
  postTransactionAmounts: z.looseObject({ sharesOwnedFollowingTransaction: valueNode }).optional(),
  ownershipNature: z
    .looseObject({ directOrIndirectOwnership: valueNode, natureOfOwnership: valueNode })
    .optional(),
});

/** Table II must never block Table I: every field is optional and a bad field is dropped. */
const soft = <T extends z.ZodType>(s: T) => s.optional().catch(undefined);
export const derivativeTx = z.looseObject({
  securityTitle: soft(valueNode),
  transactionDate: soft(valueNode),
  transactionCoding: soft(z.looseObject({ transactionCode: soft(z.string()) })),
  transactionAmounts: soft(
    z.looseObject({
      transactionShares: soft(valueNode),
      transactionPricePerShare: soft(valueNode),
      transactionAcquiredDisposedCode: soft(valueNode),
    }),
  ),
  postTransactionAmounts: soft(z.looseObject({ sharesOwnedFollowingTransaction: soft(valueNode) })),
  ownershipNature: soft(
    z.looseObject({ directOrIndirectOwnership: soft(valueNode), natureOfOwnership: soft(valueNode) }),
  ),
});

const owner = z.looseObject({
  reportingOwnerId: z.looseObject({
    rptOwnerCik: z.string().optional(),
    rptOwnerName: z.string(),
  }),
  reportingOwnerRelationship: z
    .looseObject({
      isDirector: z.string().optional(),
      isOfficer: z.string().optional(),
      isTenPercentOwner: z.string().optional(),
      officerTitle: z.string().optional(),
    })
    .optional(),
});

const nonDerivativeTable = z
  .union([
    z.literal(""),
    z.looseObject({
      nonDerivativeTransaction: z.array(tx).optional(),
      nonDerivativeHolding: z.array(holding).optional(),
    }),
  ])
  .optional();

export const form4Schema = z.looseObject({
  ownershipDocument: z.looseObject({
    documentType: z.enum(["4", "4/A"]),
    periodOfReport: z.string().optional(),
    dateOfOriginalSubmission: z.string().optional(),
    issuer: z.looseObject({
      issuerCik: z.string(),
      issuerName: z.string().optional(),
      issuerTradingSymbol: z.string().optional(),
    }),
    reportingOwner: z.array(owner).min(1),
    aff10b5One: z.string().optional(),
    nonDerivativeTable,
    derivativeTable: z.unknown().optional(),
    footnotes: z
      .union([
        z.literal(""),
        z.looseObject({
          footnote: z.array(z.looseObject({ "#text": z.string().optional(), "@_id": z.string() })),
        }),
      ])
      .optional(),
  }),
});

export type RawTx = z.infer<typeof derivativeTx>;
export type RawHolding = z.infer<typeof holding>;
export type RawForm4 = z.infer<typeof form4Schema>["ownershipDocument"];
