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

const table = (name: string) =>
  z.union([z.literal(""), z.looseObject({ [name]: z.array(tx).optional() })]).optional();

export const form4Schema = z.looseObject({
  ownershipDocument: z.looseObject({
    documentType: z.enum(["4", "4/A"]),
    periodOfReport: z.string().optional(),
    issuer: z.looseObject({
      issuerCik: z.string(),
      issuerName: z.string().optional(),
      issuerTradingSymbol: z.string().optional(),
    }),
    reportingOwner: z.array(owner).min(1),
    aff10b5One: z.string().optional(),
    nonDerivativeTable: table("nonDerivativeTransaction"),
    derivativeTable: table("derivativeTransaction"),
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

export type RawTx = z.infer<typeof tx>;
export type RawForm4 = z.infer<typeof form4Schema>["ownershipDocument"];
