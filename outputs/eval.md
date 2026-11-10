# Evaluation report

Generated 2026-11-07 07:34

## 1. Provided sample (hand-worked expected verdicts)

- Verdicts correct: **24/24**
- Reconciliation: Member rows vs "Total Members" ✔ · Σ EE share vs "Total EPF Contribution" ✔ · Σ EPS vs "Total EPS Contribution" ✔ · Σ ER vs "Total EPF-EPS Contribution" ✔ · Σ IP contribution vs "Total IP Contribution" ✔ · Σ wages vs "Total Monthly Wages" ✔
- PF: MATCHED 9, NAME_MISMATCH 1, AMOUNT_MISMATCH 1, MISSING 1 · short ₹1610
- ESIC: MATCHED 8, NAME_MISMATCH 1, AMOUNT_MISMATCH 1, MISSING 2 · short ₹194

## 2.1 Synthetic scale set `synthetic` (1500 employees, answer key)

- Documents: PF ECR 34 pages / 1441 members · ESIC ECR 38 pages / 1404 IPs · wagesheet 1500 rows (.xlsx, numeric IDs, title rows)
- Run time: **617 ms**
- Verdicts correct: **3000/3000 (100.00%)**
- Missed genuine name mismatches: **0** · False name alarms ("crying wolf"): **0**
- ECR-only rows found: 41 (expected 41)
- Reconciliation: all checks passed (1441/1441, 2227466/2227466, 1557848/1557848, 669618/669618, 147185/147185, 19774653/19774653)

| Scenario | Correct |
|---|---|
| name_variant | 414/414 |
| clean | 1562/1562 |
| missing_both | 62/62 |
| amount_short_esic | 114/114 |
| missing_pf | 86/86 |
| amount_short_pf | 106/106 |
| name_mismatch_pf | 134/134 |
| name_mismatch_esic | 124/124 |
| missing_esic | 102/102 |
| long_name | 84/84 |
| rounding_1 | 132/132 |
| blank_uan | 22/22 |
| esic_not_applicable | 58/58 |

| Expected → Got | Count |
|---|---|
| MATCHED → MATCHED | 2565 |
| MISSING → MISSING | 167 |
| NAME_MISMATCH → NAME_MISMATCH | 129 |
| AMOUNT_MISMATCH → AMOUNT_MISMATCH | 110 |
| NOT_APPLICABLE → NOT_APPLICABLE | 29 |

## 2.2 Synthetic scale set `synthetic_large` (8000 employees, answer key)

- Documents: PF ECR 175 pages / 7652 members · ESIC ECR 197 pages / 7477 IPs · wagesheet 8000 rows (.xlsx, numeric IDs, title rows)
- Run time: **2927 ms**
- Verdicts correct: **16000/16000 (100.00%)**
- Missed genuine name mismatches: **0** · False name alarms ("crying wolf"): **0**
- ECR-only rows found: 245 (expected 245)
- Reconciliation: all checks passed (7652/7652, 11856193/11856193, 8288837/8288837, 3567356/3567356, 786274/786274, 105903047/105903047)

| Scenario | Correct |
|---|---|
| name_variant | 2056/2056 |
| name_mismatch_pf | 654/654 |
| amount_short_pf | 550/550 |
| missing_esic | 542/542 |
| clean | 8550/8550 |
| esic_not_applicable | 268/268 |
| long_name | 480/480 |
| rounding_1 | 586/586 |
| name_mismatch_esic | 588/588 |
| amount_short_esic | 700/700 |
| missing_pf | 460/460 |
| missing_both | 396/396 |
| blank_uan | 170/170 |

| Expected → Got | Count |
|---|---|
| MATCHED → MATCHED | 13638 |
| MISSING → MISSING | 982 |
| AMOUNT_MISMATCH → AMOUNT_MISMATCH | 625 |
| NAME_MISMATCH → NAME_MISMATCH | 621 |
| NOT_APPLICABLE → NOT_APPLICABLE | 134 |


## Notes

- The synthetic set imitates the sample layouts and injects variations I chose (listed per scenario). It proves scale and robustness, not coverage of every real-world variation.
