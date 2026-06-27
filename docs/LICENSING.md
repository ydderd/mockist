# Licensing (Elastic License 2.0)

mockist is published under the [Elastic License 2.0](../LICENSE) (`Elastic-2.0` in
`package.json`). This document explains what that means for adopters and how it relates
to the product roadmap.

## What ELv2 is

Elastic License 2.0 is a **source-available** license. It is **not** OSI-approved open
source. npm accepts the SPDX identifier `Elastic-2.0`; the package will **not** show the
green OSI badge on npm (that badge is reserved for OSI-approved licenses).

ELv2 is in the same family as BSL 1.1, SSPL, and Commons Clause: permissive for most
uses, with explicit restrictions aimed at preventing hyperscalers (or anyone else) from
offering the product as a competing managed service without a commercial agreement.

## What you CAN do

- Use mockist in your own applications and tests (including commercial software)
- Copy, modify, and redistribute mockist (including forks), subject to the limitations
- Ship mockist as a dependency inside your SaaS product when mockist is **not** the
  product you are selling to customers

For mockist's intended use — a **local dev/CI test harness** installed via npm — ELv2
generally imposes no practical restriction beyond keeping license notices intact.

## What you CANNOT do (the three limitations)

1. **Hosted/managed service** — You may not provide mockist (or a substantial subset of
   its functionality) to third parties as a hosted or managed service. This is the
   primary commercial moat: it reserves the right to run mockist-as-a-service (M3 in the
   backlog: upload cassettes, team dashboards, cross-model diffing) to the licensor.

2. **License-key circumvention** — You may not disable or bypass license-key functionality.
   mockist **does not currently ship license keys**; this clause is standard ELv2 boilerplate
   and is inert until/unless a paid tier adds key-gated features.

3. **Notice removal** — You may not strip copyright or license notices from the software.

## How this maps to mockist's roadmap

| Tier | Model | License fit |
|------|-------|-------------|
| Local npm package (PLG rung 1–3) | Free install, in-repo tests, CI replay | ELv2 allows; adoption-friendly |
| Hosted platform (M3) | Upload cassettes, audit trail, team gates | ELv2 **blocks competitors** from offering the same hosted product |

If the hosted platform is the long-term revenue path, ELv2 is a deliberate choice — not
an accident. It is the same strategy Elastic, MongoDB (SSPL), and HashiCorp (BSL) used
when open-core / managed-service competition became a business risk.

## Comparison with common npm licenses

| License | OSI approved | Commercial use | SaaS use of library | Competing hosted service |
|---------|--------------|----------------|---------------------|--------------------------|
| MIT | Yes | Yes | Yes | Yes |
| Apache-2.0 | Yes | Yes | Yes | Yes |
| Elastic-2.0 | No | Yes | Yes (as dependency) | **No** (if service = mockist features) |
| BSL 1.1 | No | Yes after change date | Yes (as dependency) | **No** (similar restriction) |
| SSPL | No | Restricted | **Must open-source entire stack** if offering as service | Effectively no |

## Adoption implications

**Pros of ELv2 for mockist:**

- Protects future M3 hosted revenue without a separate "enterprise edition" fork
- Still allows unrestricted local/CI use — the primary npm adoption path
- SPDX-valid; npm publish works; license file ships in tarball

**Cons / friction:**

- Corporate legal teams often flag non-OSI licenses automatically
- Cannot call mockist "open source" (use "source-available" instead)
- Rare in npm dev tooling (~MIT/Apache dominate); may surprise consumers who don't read LICENSE
- Forks can exist but cannot legally operate a mockist-clone hosted platform

## Alternatives if adoption friction is too high

| Option | Tradeoff |
|--------|----------|
| **MIT / Apache-2.0** | Maximum adoption; no license-based moat for hosted M3 — need contractual or technical gating instead |
| **Dual license** (ELv2 + commercial) | Common pattern: free for most uses, paid license for hosted vendors; more legal overhead |
| **BSL 1.1** | Similar to ELv2 with a timed conversion to open source (e.g. Apache after 4 years) |
| **AGPL-3.0** | Strong copyleft for network use; forces SaaS providers to open-source modifications — different lever, often **more** scary to enterprises than ELv2 |

## Recommendation

**Keep ELv2 if** the business plan includes a hosted mockist platform and you want
license-based protection without building a separate proprietary core.

**Switch to MIT or Apache-2.0 if** maximum npm adoption is the priority and M3 will be
monetized through accounts/billing rather than license enforcement.

Either way, the README license section should stay prominent — npm users often assume MIT.

See also: [Elastic's ELv2 FAQ](https://www.elastic.co/licensing/elastic-license),
[SPDX Elastic-2.0](https://spdx.org/licenses/Elastic-2.0.html).
