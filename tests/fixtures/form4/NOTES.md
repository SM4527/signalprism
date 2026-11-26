# Form 4 fixtures

Real public filings, one line per file, then synthetic files (`synthetic_*.xml`: real structure, made-up issuers, people and CIKs).

- `AMZN_form4.xml` - many S lines under 10b5-1 (box ticked), with an M exercise and a derivative table.
- `BRK_ownership.xml` - G gift; ticker `BRK.A`; booleans spelled `true/false`.
- `Cat_tm2629746-1_4seq1.xml` - single open-market P purchase with a footnote.
- `Dow_wk-form4_1793220102.xml` - D disposition with footnotes.
- `Exxon_form4.xml` - F tax withholding plus A award; direct and indirect ownership.
- `Googl_ownership.xml` - many G gifts across direct and indirect holdings, ten footnotes.
- `GS_ownership.xml` - P purchase in common stock of a BDC (GSBD); booleans spelled `true/false`.
- `JNJ_wk-form4_1794606870.xml` - M exercise and S sale, with a derivative table.
- `JPMC_doc4.xml` - G gifts, direct and indirect.
- `Meta_ownership.xml` - S sales under 10b5-1 (box ticked), direct and indirect.
- `MSFT_wk-form4_1795563957.xml` - F tax withholding by an officer with a truncated title.
- `NRG_doc4.xml` - A award, indirect ownership.
- `PG_form4.xml` - S sale, direct and indirect.
- `SPG_form4-10012026_071044.xml` - P purchase with a footnote.
- `VZ_wk-form4_1795621978.xml` - S sale under 10b5-1 (box ticked), indirect.

## Synthetic

- `synthetic_ceo_multi_p.xml` - CEO, three P lines (Mon, Mon, Wed) in one bucket; weighted-average price footnote on the last.
- `synthetic_p_mixed_codes.xml` - CFO, same-day Table I M, P, A and F in one bucket; Table II M must not move the baseline.
- `synthetic_new_position.xml` - CFO first buy, owned after equals shares bought; Class A Common Shares.
- `synthetic_joint_filers.xml` - two 10% owners on one filing, indirect, same line.
- `synthetic_indirect_natures.xml` - P in direct, By Family Trust and By Spouse buckets.
- `synthetic_no_price.xml` - P line with an empty price.
- `synthetic_p_10b5_box.xml` - P with the 10b5-1 box ticked.
- `synthetic_p_10b5_footnote.xml` - box unticked, footnote mentions a 10b5-1 plan.
- `synthetic_amendment_4a.xml` - document type 4/A.
- `synthetic_ticker_none.xml` - issuer ticker `NONE`.
- `synthetic_non_common.xml` - P of Series A Preferred Stock.
- `synthetic_holiday_week.xml` - CEO P on Wed 2026-11-25, Thanksgiving week.
- `synthetic_conversion_no_p.xml` - C conversion in both tables, no P.
- `synthetic_malformed.xml` - truncated XML.
- `synthetic_missing_issuer.xml` - valid XML without an issuer element.
- `synthetic_cluster_director.xml` - ACME director P on 2026-11-16; joins the ACME CEO and CFO buys as a third insider in one cluster.
- `synthetic_amendment_original.xml` - the Form 4 that `synthetic_amendment_4a.xml` amends (300 shares, 4/A has 400).
- `synthetic_late_ceo.xml` - CEO P of $160K; filed with a manifest lag of more than two business days.
- `synthetic_holdings_elsewhere.xml` - director P of 2,500 in an indirect bucket (9,000 after) with `nonDerivativeHolding` rows: 24,032 direct, the same indirect bucket again (not double counted) and a different security (ignored).
- `synthetic_new_entity_holdings.xml` - CFO P of 1,000 through a new entity (1,000 after) while 5,000 are held directly: not a new position.
- `synthetic_table2_no_coding.xml` - CEO P in Table I plus a `derivativeTransaction` without `transactionCoding`; the filing must parse with a warning.
