# Legal drafts

> **Drafts for review. Nothing here is legal advice, and nothing is in effect.** The app doesn't link to these files yet.

- [privacy.md](privacy.md): privacy policy
- [terms.md](terms.md): terms of service
- [faq.md](faq.md): short FAQ

In the drafts, `[FILL IN: …]` needs your details or a decision, and `[LAWYER: …]` needs legal review.

## For you to fill in or decide

| Item | Where |
| --- | --- |
| Legal or business name and postal address | privacy, terms |
| Privacy and support email addresses | privacy, terms |
| Effective date | privacy, terms |
| **Minimum age** (18 suggested) | privacy, terms |
| **Refund policy** (14 days suggested) | terms, FAQ |
| Card-statement text ([decision 5](../spec/sync.md#18-decisions-needed)) | terms, FAQ |
| Seller's exact legal name, buyer terms and privacy policy links (Link, Stripe, Cloudflare). I couldn't load Link's terms page. | privacy, terms |
| How to ask Stripe or Link for deletion: confirm the page or address | privacy |
| Whether a lifetime supporter who deleted everything can get lifetime back | privacy |
| Host's request logs for page addresses (they include menu links) | privacy |
| Server log retention, D1 location and D1 recovery window | privacy |
| Google Analytics settings and retention | privacy |
| Price-change notice; notice and refunds if sync ends | terms |
| Minimum liability amount; state, county for governing law | terms |

## For a lawyer

| Topic | Why |
| --- | --- |
| Controller details and EU/UK representative | GDPR and UK GDPR may require them. |
| Lawful basis, special category data, transfers, processor agreements | Menus can reveal sex life or sexual orientation. |
| CCPA/CPRA, other US state laws, Washington My Health My Data Act | Notices may be required for sensitive information. |
| Cookie consent for Google Analytics | The app has no consent banner. |
| Legal requests and business transfer wording | Not covered yet. |
| Duties under Stripe Managed Payments | Which obligations to buyers stay with you. |
| EU/UK withdrawal right and auto-renewal laws | Consumer rights still apply when Link is the merchant of record. |
| Meaning of "lifetime" | It must be clear and enforceable. |
| Use of the name under the MIT licence | The licence covers code, not clearly the name. |
| Warranty disclaimer, liability cap, indemnity | Consumer law limits them. |
| Governing law, venue, arbitration | The draft has no arbitration clause. |
| Ending a paid account | Notice and refund terms are missing. |

## Check against the app before publishing

These were written from [the plan](../spec/sync.md) and the server code. The sync client, checkout and the move to the new address weren't built then. Confirm each of these in what actually ships:

- The labels **Show my sync code**, **Replace sync code**, **Turn off sync on this device**, **Manage subscription**, **Delete synced menus** and **Delete my account**.
- The lapse warning 30 days before deletion.
- The browser check before checkout ([SY-14](../spec/sync.md#3-adding-a-device-and-restoring)).
- The hand-off page on the old address has no analytics or payments ([HO-8](../spec/sync.md#12-hosting-domain-and-name)).
- Google Analytics on the new domain sends only the listed events, and `docs/analytics.md` lists the new ones.
- Managed Payments passed Stripe's eligibility review. If it didn't, every "Link" passage changes.
- The Customer Portal's cancel and plan-change settings match [the setup log](../spec/sync.md#19-setup-log) in live mode.
- Any storage or export features added since (the privacy policy speaks only of "a few small settings").

## Gaps found while writing

- **Menu links reach the web host.** The menu is in the `?encoded=` part of the address, so the host receives it when a link is opened. The [threat model](../spec/sync.md#10-privacy-and-threat-model) doesn't list this, and the Support page's "menus never leave your browser unless you choose to share them" is true only with that "unless". The privacy policy says it plainly.
- **Refunds and disputes:** full refunds and new disputes now make supporter accounts read-only without deleting menus. A won dispute restores status; partial refunds don't change it.
- **Deletion is now split:** deleting synced menus keeps supporter status and billing. Deleting the whole account cancels billing and ends lifetime status, with a warning.
