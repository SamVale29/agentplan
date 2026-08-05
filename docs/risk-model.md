# Risk model

Risk is a deterministic score from 0 to 100. It is a decision aid and explanation, not a claim of perfect impact prediction.

## Baselines

| Action family | Baseline |
| --- | ---: |
| Read-only filesystem, database, Git, cloud or identity | 8 |
| Filesystem/Git/cloud write | 30 |
| Network request | 28 |
| Shell execution | 42 |
| Filesystem move | 45 |
| Database write | 62 |
| Communication send | 70 |
| Financial refund | 72 |
| Database schema / resource delete | 78–80 |
| Git push | 82 |
| Identity modification | 88 |
| Financial charge | 95 |

## Additive factors

- `+18` when the operation is not reversible.
- `+18` for credentials or sensitive input signals.
- `+25` for sensitive paths such as `.env` or `secrets`.
- `+22` for a production target.
- `+35` for destructive shell patterns.
- `+15` for shell composition/redirection and `+12` for download commands.
- `+35` for private network targets, `+18` for unknown external hosts and `+25` for invalid URLs.
- `+8` for three or more declared effects.
- `+12` for more than 100 affected records and `+15` for a financial amount above 100.
- Optional configured weights from `risk.weights`.

The score is capped at 100. Default thresholds are low through 24, medium through 49, high through 74 and critical above 74. Configure thresholds only with a written security rationale; raising thresholds reduces approval friction but increases authorization risk.

## What the model does not do

It does not predict future tool calls, prove that a command is safe, understand arbitrary business impact or replace a sandbox, DLP, IAM system or provider safety controls. High-quality reasons and policy results are more important than a precise-looking number.
