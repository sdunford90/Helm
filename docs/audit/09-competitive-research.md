# 09 — Competitive Research: Marina Management Software (Helm go-to-market)

*Prepared 2026-10-26. Sources are cited inline. Vendor-authored claims are marked as such. Where pricing isn't public, that's stated, and third-party estimates are labeled. Several review sites (Capterra, Software Advice, G2) returned HTTP 403 to direct fetches. Review sentiment below comes from search-indexed excerpts of those pages, so treat individual quotes as indicative only.*

---

## 0. Executive summary

- **The market has split into a well-funded modular leader, an enterprise roll-up, and a long tail of legacy or small vendors.**
  - **Dockwa** raised a PSG growth investment in June 2026. It reports ~4,000 marinas, 500k+ boaters, 100M+ nights booked, and a dynamic-pricing product (Telescope). It added Service/work orders in July 2026.
  - **Storable Marine** (Molo + Stellar rentals) wins multi-site enterprise operators: Suntex (72 marinas), Grove Point (30), and Hinckley (9).
  - **DockMaster** is the legacy full-service and boatyard ERP. Reviews consistently say its UI is dated. Aspire Software reportedly acquired it in March 2026.
  - The **long tail** includes Scribble (MarinaOffice/MARINAGO), Marina Master, Harba (EU), Pacsoft, SpeedyDock (dry stack), and a wave of low-priced newcomers (SlipBoss, SlipRight, DocksBase, Marina Match).
- **Table stakes in 2026:**
  - slip map and assignment
  - transient online booking
  - e-signed seasonal/annual contracts with autopay (card + ACH)
  - recurring invoicing
  - a boater portal
  - QuickBooks Online sync
  - POS and fuel
  - a mobile dock-walk app
  - basic reports
  - Most serious vendors now also have work orders. Dockwa's July 2026 launch closed its last big gap.
- **Helm's credible differentiators:**
  - Unified slips + rentals/boat-club + dry stack in one ledger. Only Storable does this, and it does it through two products that started as separate companies.
  - Native GL with deferred revenue. Competitors mostly "sync to QBO".
  - AI COI extraction. No competitor advertises it; Dockwa only "collects" insurance docs.
  - Offline dock walks. Storable only added an offline mobile mode in Dec 2024.
  - Dynamic pricing across both slips and rentals. Dockwa Telescope is transient-only as far as public docs show.
  - Transparent pricing. Most incumbents are quote-only.
- **Biggest launch gaps for Helm:**
  - service/work orders (boatyard)
  - metered utility billing (pedestal readings → invoices)
  - gate/access integration
  - transient distribution (Dockwa/Snag-A-Slip marketplace demand)
  - data migration tooling
  - surcharge/convenience-fee compliance by state
  - sales-tax handling for dockage
  - reliability and polish of the "partially built" modules (billing/proration and payments must be bulletproof before anything else)
- **Recommended pricing:**
  - A per-slip tier with a floor, roughly $3–6/slip/month with a $199–$299/month minimum.
  - Add-on bundles for Rentals and Service.
  - Embedded payments margin of 30–60 bps over interchange-plus, plus optional state-compliant surcharging.
  - No marketplace commission on the marina's own direct bookings.

---

## 1. Competitor profiles

### 1.1 Dockwa (Dockwa for Marinas, Network/Marketplace, Dockwa Pay, Telescope)

- **Company:** Founded 2015 in Newport, RI, as The Wanderlust Group, Inc. CEO is Mike Melillo.
  - Reports 4,000+ marinas (incl. 97% of the top 95 US harbors), 500k+ boaters (~200k transacting per year), 900k+ boats on record, and 100M+ nights booked. Its app has 30k+ App Store reviews at 4.9 stars ([Dockwa About](https://marinas.dockwa.com/about-us)).
  - **June 3, 2026:** PSG made a strategic growth investment (terms undisclosed) to build "the operating system for the $57B marina economy." The funds go to AI products and expansion into Canada and Europe ([Business Wire](https://www.businesswire.com/news/home/20260603108633/en/Dockwa-Secures-Strategic-Growth-Investment-from-PSG-to-Build-the-Operating-System-for-the-$57-Billion-Marina-Economy); [Trade Only Today](https://tradeonlytoday.com/industry-news/dockwa-lands-growth-investment/); [Marina Dock Age](https://www.marinadockage.com/psg-growth-equity-firm-invests-in-dockwa/)).
  - New data products: **Marine Graph** (a data layer built on 11 years of transactions) and **Marina-X** (benchmarking/underwriting for insurers and lenders).
- **Products and published pricing** (per month, billed annually, "starting at"; [Dockwa pricing](https://marinas.dockwa.com/marina-software-pricing)):

  | Module | Price | What it covers |
  |---|---|---|
  | Leads | $0 | profile, inquiries, reviews, Marinas.com visibility |
  | Transient | $169 | 24/7 booking, waitlist, smart slip assignment, insurance/registration collection |
  | Captains & Contracts | $180 | e-signed contracts, automated billing, custom payment schedules |
  | Spaces | $180 | interactive map, occupancy, Dockwalk app, **metered electric readings** |
  | POS | $249 | — |
  | Fuel Management | $199 | tank tracking, mobile pump checkout, **dockhand tipping** |
  | Dry Stack | $99 | app launch requests, launch dashboard |
  | Integrations | $84 | QBO, NetSuite, Sage, Xero |
  | Insights | $139 | traffic, revenue/occupancy forecasting |
  | **Telescope** | quote only | dynamic pricing |
  | Service | not on pricing page | work orders, launched July 2026 ([About](https://marinas.dockwa.com/about-us); [June 2026 Dispatch](https://blog.dockwa.com/marinas/dockwa-dispatch-june-2026)) |

  - Portfolio pricing is available for multi-site operators.
  - SlipRight estimates Contracts + Spaces + Transient at **$529/month** and up to ~$1,299/month with every module ([SlipRight cost guide](https://slipright.app/guides/what-marina-software-costs)). That's a competitor's estimate.
- **Network/marketplace:** Marinas can join the Network with no subscription and "pay only when they get a booking." The per-booking rate isn't published.
  - Boaters pay no booking fee. Dockwa dropped its ~5% boater fee in 2016 ([Dockwa blog](https://blog.dockwa.com/no-more-booking-fees-for-boaters-ever); [Marine Marketing Tools](https://marinemarketingtools.com/dockwa-drops-slip-reservation-booking-fee-to-attract-more-boaters/2979)).
  - Rate parity is required: marinas may not charge more through Dockwa ([pricing page](https://marinas.dockwa.com/marina-software-pricing)).
  - Dockwa+ is a paid boater membership.
- **Payments (Dockwa Pay):** Dock-side checkout via scan for fuel and the ship store.
  - Contracts can add a **credit-card convenience fee up to 4%**. It isn't available in CA, CT, MA, ME, NY, PR, or Canada ([Dockwa margins post](https://blog.dockwa.com/marinas/protect-marina-margins-before-season)).
  - ACH autopay with card-on-file backup ([payments guide](https://blog.dockwa.com/marinas/marina-payment-processing-in-2026-a-complete-guide)).
  - Processing rates aren't published.
- **Telescope:**
  - Rule-based dynamic pricing with occupancy triggers, floors, and guardrails, plus Insights integration.
  - Dockwa claims "the only dynamic pricing tool in the industry," 20%+ ADR growth, and 40%+ more confirmed footage. These are vendor claims.
  - Public docs don't say whether it covers seasonal or annual pricing ([Telescope](https://marinas.dockwa.com/marina-revenue-management)).
- **Discovery integrations:** Dockwa + ActiveCaptain (Garmin) review syndication ([partnership](https://laopinion.com/latinowire/dockwa-and-activecaptain-partner-to-combine-marina-reservations-and-reviews-for-boaters/)); Marinas.com (owned).
- **Strengths:**
  - Boater network demand (an unmatched moat)
  - Brand
  - Clean UX
  - Modular entry
  - Fresh capital
  - Data/AI narrative
- **Complaints:**
  - Perception of a "middleman" and that the platform is boater-centric: "does not work for the marinas from whom they receive their commission" ([G2](https://www.g2.com/products/dockwa-dockwa/reviews))
  - Report fields can't be customized ([Capterra](https://www.capterra.com/p/147452/Dockwa/reviews/))
  - A fee model that moved from revenue share to an added annual software fee ([Capterra listing excerpt](https://www.capterra.com/p/147452/Dockwa/))
  - Modular pricing stacks up fast
  - Weaker on inventory: no POs or barcoding, per competitor DockMaster ([DockMaster vs Dockwa](https://www.dockmaster.com/blog/dockmaster-vs-dockwa))
- **Ratings:** Capterra 4.9 (16 reviews); G2 4.3 (7).
- **Target:** Transient-heavy coastal marinas, municipal harbors, and NE/Mid-Atlantic. It's moving up-market and into service.

### 1.2 Storable Marine — Storable Molo (formerly Molo) + Storable Rentals (formerly Stellar)

- **Company:** Storable (self-storage software roll-up) acquired Molo, a Serbia-founded startup. Stellar (boat rental reservations) joined in Oct 2022, Storable's 12th acquisition ([Storable news](https://www.storable.com/news/stellar-joins-molo/)).
  - Rebranded Nov 21, 2025 as Storable Molo and Storable Rentals ([PR Newswire](https://www.prnewswire.com/news-releases/storable-unifies-marine-software-solutions-under-new-storable-marine-brand-302623208.html); [Yahoo Finance](https://finance.yahoo.com/news/storable-unifies-marine-software-solutions-143000232.html)).
- **Enterprise wins:**
  - Suntex: 72 owned marinas, Molo + Stellar suite, Dec 2024 ([getmolo.com](https://getmolo.com/?p=3310))
  - Grove Point Marinas: 30 marinas ([Business Wire Feb 2026](https://www.businesswire.com/news/home/20260202255495/en))
  - Hinckley Yachts: 9 service locations, Feb 2026 ([Le Lezard](https://www.lelezard.com/en/news-storable-marine-announces-hinckley-yachts-has-selected-storable-molo-to-power-nine-east-coast-22098920.html))
  - Dec 2024 enterprise release: multi-location permissions, NetSuite, a data lake, digital waivers, and **offline mobile mode** ([Boat Rental Management blog](https://boatrentalmanagement.com/blog/storable-marine-division-accelerates-enterprise-innovation-earns-industry-recognition/)).
- **Features:**
  - slips/moorings/storage with custom harbor maps
  - transient + long-term
  - multi-location
  - work orders (parts, labor, tech schedules)
  - POS
  - stored payments and autopay
  - online booking
  - rentals and boat clubs (waivers, membership, condition tracking)
  - 80+ reports
  - CRM
  - inventory
  - accounting integrations: QBO, Xero, NetSuite, Sage Intacct; also Slack and SpeedyDock
  - websites/digital marketing services ([Storable Marine](https://www.storablemarine.com/marina-management-software/); [rentals](https://www.storablemarine.com/boat-club-rental-software/))
  - Customer portal v-next (self-onboarding, autopay) and "automation for pricing and marketing" are described as rolling out.
- **Pricing:**
  - ~$299/month (up to 100 slips/200 dry spaces), or ~$249/month billed annually (review-site listings, e.g. [Capterra](https://www.capterra.com/p/141098/Molo/), [GetApp](https://www.getapp.com/industries-software/a/molo/)).
  - Payments: **0.35% over cost** plus unpublished "e-transaction fees" on online payments, and a fee for instant payouts ([SlipRight cost guide](https://slipright.app/guides/what-marina-software-costs), citing Storable). Quote required.
- **Strengths:**
  - enterprise multi-site
  - rentals + marina under one roof
  - Storable's payments/insurance playbook from self-storage
  - wide accounting integrations
  - unlimited users
- **Complaints** ([Capterra reviews](https://www.capterra.com/p/141098/Molo/reviews/); [Software Advice](https://www.softwareadvice.com/marine/molo-profile/); [Molo Manager app](https://apps.apple.com/us/app/molo-manager/id1495078350)):
  - opaque payment deposits ("you will never have a definitive deposit")
  - slow screens and reports
  - random glitches
  - credit notes and cancellations are awkward
  - no automated prorate-in/out for recurring reservations
  - NetSuite sync errors
  - mobile app lacks features or stability
  - support quality varies
- **Target:** Mid-to-large and multi-site groups (PE-backed roll-ups), yacht clubs, municipalities, and boatyards.

### 1.3 DockMaster (Aspire Software / Valsoft)

- **Company:**
  - 40+ years old; acquired by Valsoft in 2017 ([Valsoft](https://www.valsoftcorp.com/news/dockmaster-revitalizing-growth-in-the-marine-industry-software-sector)).
  - Bought Dockworks (small boatyards) in Sept 2023 ([DockMaster blog](https://www.dockmaster.com/blog/dockmaster-acquires-dockworks-marine-management-software)).
  - Reported acquired by Aspire Software in March 2026, per a single source ([Signalbase](https://www.trysignalbase.com/news/acquisitions/dockmaster-software-acquired-by-aspire-software-acquisition)). Aspire is Valsoft's sister operating group, so this may be an internal transfer. Unverified.
- **Features:**
  - service management (estimates, work orders, mobile time tracking, eSignatures)
  - inventory (POs, barcodes)
  - full financials (A/R, A/P, GL, bank reconciliation)
  - visual slip assignment and reservations
  - boat sales (leads, contracts, trade-ins, financing)
  - touchscreen POS for store and fuel
  - Desktop, Web, and Mobile apps
  - It now markets "AI-powered scheduling/estimates" ([DockMaster vs Dockwa](https://www.dockmaster.com/blog/dockmaster-vs-dockwa); [dockmaster.com](https://www.dockmaster.com/)).
- **Pricing:** Quote-based and per-feature. Directories list ~$165/feature/month ([GetApp](https://www.getapp.com/industries-software/a/dockmaster/pricing/)).
- **Strengths:**
  - deepest boatyard/service/dealer coverage
  - native accounting
  - stable
- **Complaints** ([Capterra](https://www.capterra.com/p/92549/DockMaster/reviews/); [TrustRadius](https://trustradius.com/products/dockmaster/reviews)):
  - "UI feels like Windows 95"
  - reporting tied to its own naming conventions
  - inflexible
  - support delays
  - Capterra 3.9 (18 reviews); G2 3.3
- **Target:** Full-service marinas, boatyards, and dealers. The installed base is a **prime migration target**.

### 1.4 Scribble Software — MarinaOffice (desktop) / MARINAGO Office (cloud)

- **Company:** Founded 1989, Mechanicsville, VA ([Software Advice](https://www.softwareadvice.com/marine/marinaoffice-profile/)). This is the "Dockside/Marina Office" in the brief.
- **Features:**
  - storage, billing, retail POS, **restaurant POS**, rentals
  - service work orders with a technician portal
  - LaunchOffice launch scheduling, haul, fuel
  - **native fuel-controller integration and mobile pay-at-pump**. A vendor testimonial claims +$100k from after-hours fuel sales ([MARINAGO fuel](https://marinago.com/store-fuel-detail.html)).
  - e-signature contracts, customer portal
  - QBO and Sage Intacct integration
  - email/text messaging
  - Snag-A-Slip online reservations partnership ([Waterway Guide](https://www.waterwayguide.com/knowledge-center/news-post/10282/scribble-software-announces-collaborative-solution-with-snag-a-slip-online-reservations); [Boating Industry](https://boatingindustry.com/news/2020/01/16/scribble-software-snag-a-slip-join-forces/))
- **Pricing:** Not published. A directory lists "starting at $2,500" per feature, probably a license fee.
- **Strengths:** Breadth for mixed-use properties (hospitality + marina), offered both desktop and cloud for low-connectivity sites, praised support.
- **Complaints:** slow QBO sync; price changes have to be made in QBO; POS SKU search ([Capterra CA](https://www.capterra.ca/reviews/98609/marinaoffice)). Most reviews are dated (2017).
- **Ratings:** 4.5 (20 reviews); G2 4.0 ([Guideflow](https://www.guideflow.com/blog/marina-management-software)).

### 1.5 Marina Master (IRM)

- **Features:**
  - slips/berths, online reservations, billing/invoicing
  - inventory, job scheduling
  - Square/Stripe/PayPal payments
  - fuel, rentals, haul-out, storage, customer portal
- **Pricing:** ~$100–150/month starting, depending on slips and modules ([Capterra UK](https://www.capterra.co.uk/software/110609/marina-master); [GetApp AU](https://www.getapp.com.au/software/113215/marina-master)).
- **Reviews:** Capterra 5.0 from only 9 reviews. Thin evidence.
- **Target:** Small to mid independent marinas. A low-price reference point.

### 1.6 Harba (HarbaMaster + HarbaApp, Denmark)

- **Pricing** (published, rare in this market; [Harba pricing](https://harba.co/pricing)):

  | Item | Price |
  |---|---|
  | Growth plan | €2,700/yr + €5/spot/yr |
  | Professional plan | €6,000/yr + €5/spot/yr (adds crane module, messaging/sales plus, auto invoices) |
  | Enterprise plan | custom, multi-marina |
  | Onboarding | €1,350 |
  | Integration setup | €400 |
  | Integrations subscription | €270/yr |

- **Features:**
  - CRM for berths, boaters, and boats
  - map/assignment, invoicing automation
  - boater booking and payments via the HarbaApp
  - insurance management
  - HarbaSense IoT occupancy sensors ([Harba booking guide](https://harba.co/marina-booking-software-guide))
  - "Dynamic pricing" appears only as marketing copy; no documented engine.
- **US presence:** Minimal. Self-reported "3 paying US marinas" ([outreach template](https://www.basetemplates.com/investor-email-templates/boating-industry-vc-email-outreach-template)). G2 5.0.
- **Relevance:** A per-spot pricing benchmark and a sensor/IoT idea. Not a US threat today.

### 1.7 Snag-A-Slip (transient marketplace)

- Boater-facing transient marketplace with an app. It charges the boater in full and remits to the marina net of **commission + card fees**. Payouts go through Stripe Connect ([marina T&Cs](https://www.snagaslip.com/marina-terms-conditions); [FAQ](https://www.snagaslip.com/frequently-asked-questions/)).
- Commission isn't public. A third-party figure says 10–15% ([MarinaPlan blog](https://marinaplan.com/blog/best-marina-reservation-software-for-2026)), unverified.
- Instant-book integrations exist with Molo and MARINAGO, where the PMS controls price and availability.
- Integrated into Waterway Guide ([Waterway Guide](https://www.waterwayguide.com/knowledge-center/news-post/6091/snag-a-slip-marina-reservation-integrated-in-waterway-guide)).
- **Relevance:** The most realistic **distribution partner** for Helm. It's a secondary marketplace that already integrates with PMSs and isn't building a competing back office.

### 1.8 Pacsoft (PacsoftNG)

- Australian vendor; English-only.
- Features: reservations, dock assignments, billing, finance/accounting, haul-out, leasing, rental pooling, maintenance ([GetApp](https://www.getapp.com/marine-software/a/pacsoftng)).
- Offered as cloud or on-prem; pricing is per feature. Few reviews.
- Low US relevance.

### 1.9 Swiftpad and Marinaware — unverified

- No credible product called **"Swiftpad"** was found. The closest match is **Swift Harbour**, a boater moorage booking app ([App Store](https://apps.apple.com/app/swift-harbour/id1237083416)).
- **MarinaWare** exists only as a thin G2 listing ([G2](https://www.g2.com/products/marinaware/reviews)). Guideflow says its site was unreachable and calls it a small-marina tool ([Guideflow](https://www.guideflow.com/blog/marina-management-software)).
- Treat both as negligible competitors unless the owner has specific intel.

### 1.10 Low-price and new entrants (the "modern SMB" flank Helm will be compared against)

| Vendor | Pricing | Notes |
|---|---|---|
| **SlipBoss** | free ≤30 slips; Pro $100/mo; Ultimate $250/mo | Stripe booking, auto billing, POS, CSV export to QBO, equipment rental |
| **SlipRight** | $5/slip/mo, $250 minimum | no payments markup; free migration ([SlipRight](https://slipright.app/guides/what-marina-software-costs)) |
| **Atlantis Marina** | $150/mo (≤40 spaces) to $900/mo (≤400) | +1% on boater payments on top of Stripe |
| **DocksBase** (EU) | €249–1,083/mo | — |
| **Marina Match** | free | "Dock Master AI assistant" plus an open marketplace ([marinamatch.org](https://www.marinamatch.org/blog-detail/top-marina-management-software)) |
| **SpeedyDock** | from ~$0.99/slip/mo | dry stack and boat club specialist; integrates with Molo ([Capterra](https://www.capterra.com/p/159746/SpeedyDock/); [SpeedyDock](https://speedydock.com/products/dry-stack)) |

Unless otherwise noted, details are from [Guideflow](https://www.guideflow.com/blog/marina-management-software).

**Implication:** The low end is getting commoditized at **$100–$300/month or ~$5/slip**. Helm can't win on price alone, and it can't price far above this band without visible extra value.

### 1.11 Boat rental and boat club platforms

- **Freedom Boat Club (Brunswick):** Proprietary tech. New member app launched July 2025 with real-time availability and reciprocal booking across clubs ([Brunswick PR](https://www.brunswick.com/news/press-releases/detail/923/freedom-boat-club-launches-new-mobile-app-marking-major)). Not for sale. It sets **consumer UX expectations** for club members.
- **Carefree Boat Club:** Franchise model. Licenses booking software and reciprocity to franchisees ([helpyouboat](https://helpyouboat.com/boat-clubs/freedom-vs-carefree), unverified).
- **Boatsetter + GetMyBoat** (merged Dec 2025):
  - Boatsetter takes 20–35% from owners (incl. insurance), or ~10% if the owner brings insurance.
  - GetMyBoat takes ~11.5% domestic, or ~1.5% for direct payment-only bookings ([Beancount guide](https://beancount.io/blog/2026/07/13/boat-rental-boatsetter-getmyboat-bookkeeping-guide); [yespress](https://yespress.io/getmyboat)). Secondary sources.
  - These are **demand channels** for rental fleets, not competitors to a marina PMS.
- **Storable Rentals (Stellar), Boat Rental Management, SpeedyDock Boat Club:** The direct rental-software competitors. A third-party comparison rates Stellar's dynamic pricing as "limited" ([Booking Central](https://www.bookingcentral.com/blog/best-boat-rental-software)).

### 1.12 Generic rental/activity booking platforms used by marinas

All figures are from third-party comparisons and are directional ([Peek pricing guide](https://exploroff.com/guide-resources/peek-pro-pricing); [Reservety](https://reservety.com/compare/fareharbor-alternatives.html); [Rezdy alternatives](https://hamzaliaqat.com/blog/rezdy-alternatives-2026); [automate.travel](https://automate.travel/booking-engine-pricing/)).

| Platform | Model | Price signal |
|---|---|---|
| FareHarbor (Booking Holdings) | no subscription; guest-paid booking fee | ~6% direct + 1.9% + $0.30 processing |
| Peek Pro | booking fee | ~6–8% + 2.3% + $0.30; Marketplace 20% |
| Checkfront | subscription | ~$99–295/mo, 0–3% |
| Rezdy | subscription | ~$49–249/mo, 0–3% |
| Bookeo | subscription | ~$15–40/mo, no commission |

**Takeaway:** Marinas running rentals today often bolt FareHarbor or Peek onto their marina PMS. That means two customer databases, two payment stacks, and manual reconciliation. **This is exactly the seam Helm's all-in-one rentals + slips closes.**

### 1.13 Adjacent analogs

- **Storable (self-storage):**
  - 30k+ facilities.
  - Monetizes through **embedded payments + tenant insurance/protection + marketplace (SpareFoot)** on top of the software subscription ([Storable payments](https://www.storable.com/products/payments/); [Storable platform](https://www.storable.com/products/)).
  - Expect it to replay the same play in marine: payments margin, boat/marina insurance, and lead marketplace.
- **Campspot (campgrounds):**
  - Guest-paid online booking fee (reported ~$2–3 or ~3%), so the operator pays $0 per reservation.
  - Marketplace ~10% on app bookings.
  - Dynamic pricing, "grid optimization," and a lock-site fee in its Growth package ([Guideflow campground](https://www.guideflow.com/blog/campground-management-software); [Reservety](https://reservety.com/guides/campground-rv-parks/campground-booking-software.html); [Keepr comparison](https://keeprstay.com/compare/pricing)). Competitor-sourced; verify.
  - Utility billing for seasonals is listed ([GetApp compare](https://www.getapp.co.uk/compare/107249/114759/rms-hotel/vs/campspot)).
- **RMS (RV parks/holiday parks):** Rate Manager with automated seasonal and demand pricing ([RV PRO](https://rv-pro.com/news/maine-campground-touts-operational-uplift-with-rms-system/)). Third-party revenue managers such as Pricepoint report ~+9% revenue ([HotelTechReport](https://hoteltechreport.com/success-stories/revenue-management/pricepoint/usa-camping-company)).
- **Lesson for Helm:**
  - Campgrounds proved that **guest-paid booking fees + dynamic pricing + seasonal/transient on one grid + metered utilities** is a winning package.
  - Marinas are 5–10 years behind on that curve.
  - "Lock-slip fee" (guaranteed specific slip) and "grid optimization" (auto-assign to minimize fragmentation by LOA/beam) map directly to marina operations.

### 1.14 Industry structure and consolidation

- **Blackstone Infrastructure bought Safe Harbor** (138 marinas) from Sun Communities for $5.65B. Closed April 30, 2025 ([Blackstone](https://www.blackstone.com/news/press/blackstone-infrastructure-completes-acquisition-of-safe-harbor/)).
- One source reports Safe Harbor agreeing to buy MarineMax (~$1.5B EV) in Aug 2026 ([itboat](https://itboat.com/en/articles/safe-harbor-buys-marinemax)). Unverified.
- Suntex is consolidating as well.
- **Implication:** The top of the market is being absorbed by PE groups with enterprise vendors (Storable). **Helm's beachhead is independents and small groups (2–10 sites).**
- **US marina count:** Estimates vary by definition. IBISWorld counts ~2,770–2,986 businesses (NAICS 71393); Statista/IBISWorld cited ~9,750 in 2022 ([IBISWorld](https://www.ibisworld.com/united-states/number-of-businesses/marinas/1654)).
  - Industry folklore says 10–12k marinas (including municipal and club facilities). This couldn't be verified.
  - Dockwa's 4,000 marinas suggests the addressable count of software-buying facilities is ~5–8k.

---

## 2. Feature matrix

**Legend:**
- ● strong/native
- ◐ partial/basic or via add-on
- ○ absent or not evidenced
- ? unknown

**TS** = table stakes (must have at launch). **D** = differentiator. **Helm (claimed)** reflects the codebase brief; much is partially built and needs verification by the engineering audits (docs/audit 01–08).

| Domain / Feature | TS/D | Dockwa | Storable Molo(+Rentals) | DockMaster | Scribble MARINAGO | Harba | Marina Master | **Helm (claimed)** |
|---|---|---|---|---|---|---|---|---|
| **Reservations / transient** |
| Online transient booking widget | TS | ● | ● | ◐ | ● | ● | ● | ● |
| Boater marketplace / network demand | D | ● (500k boaters) | ◐ (Snag-A-Slip) | ○ | ◐ (Snag-A-Slip) | ◐ (HarbaApp) | ○ | ○ |
| Waitlist (with deposits) | TS | ● | ◐ | ◐ | ? | ? | ? | ● (deposits = D) |
| Smart/auto slip assignment by LOA/beam | D | ● | ◐ | ◐ | ? | ◐ | ○ | ? (verify) |
| Dynamic pricing (slips) | D | ● Telescope (quote) | ◐ "rolling out" | ○ | ○ | ◐ marketing | ○ | ● pricing calendar/algorithmic |
| **Long-term contracts & renewals** |
| E-signed annual/seasonal contracts | TS | ● | ● | ● | ● | ● | ◐ | ● |
| Automated renewals / re-offer workflow | TS | ● | ◐ | ◐ | ◐ | ◐ | ○ | ● |
| Custom payment schedules / installments | TS | ● | ● | ● | ● | ◐ | ◐ | ◐ (verify) |
| Proration in/out | TS | ? | ○ (review complaint) | ● | ? | ? | ? | ● (D vs Molo) |
| Insurance/registration doc collection | TS | ● | ● | ◐ | ◐ | ● | ○ | ● |
| AI/OCR COI extraction + expiry tracking | D | ○ | ○ | ○ | ○ | ○ | ○ | ● |
| **Billing / payments** |
| Recurring invoicing + autopay | TS | ● | ● | ● | ● | ● | ● | ● |
| Card + ACH | TS | ● | ● | ● | ● | ● | ◐ (Stripe/Square) | ● Stripe |
| Card-present terminal | TS | ● | ● | ● | ● | ? | ◐ | ● Stripe Terminal |
| Convenience fee / surcharge (state-aware) | TS | ● (≤4%, state exclusions) | ? | ? | ? | ? | ? | ○ gap |
| AR aging / dunning | TS | ◐ | ● | ● | ● | ◐ | ◐ | ● AR aging; dunning ? |
| Metered utility billing (electric/water) | TS (seasonal/liveaboard) | ● (Spaces) | ◐ | ◐ | ◐ | ◐ (HarbaSense) | ? | ○ gap |
| **Accounting** |
| QBO sync | TS | ● ($84 add-on) | ● | n/a (native GL) | ● (slow per reviews) | ● | ? | ● |
| Xero / NetSuite / Sage Intacct | D (enterprise) | ● | ● | ○ | ◐ Sage | ◐ | ○ | ○ |
| Native GL, deferred revenue, CoA | D | ○ | ◐ GL export | ● | ○ | ○ | ○ | ● |
| **Rentals / boat club** |
| Boat rental booking + waivers | D (for marinas) | ○ | ● (Rentals) | ○ | ● | ○ | ● | ● |
| Membership/boat club (credits, reciprocity, booking windows) | D | ○ | ● | ○ | ◐ | ○ | ○ | ? (gap: club rules) |
| Rental dynamic pricing / promo codes | D | ○ | ◐ | ○ | ○ | ○ | ○ | ● |
| **Service / boatyard** |
| Work orders, estimates, tech time | TS (full-service) | ● (new Jul 2026) | ● | ● (deepest) | ● | ○ | ◐ | ○ **gap** |
| Parts inventory / POs | TS (full-service) | ○ | ● | ● | ● | ○ | ● | ● inventory/POs |
| Haul-out / crane / yard scheduling | D | ○ | ◐ | ● | ● | ● crane | ● | ○ gap |
| **Dry stack** |
| Launch requests (app), queue, logs | TS (dry-stack sites) | ● ($99) | ◐ (+SpeedyDock) | ● | ● LaunchOffice | ○ | ◐ | ● tickets (verify boater app) |
| Rack inventory/location map | TS (dry-stack) | ◐ | ● | ● | ● | ○ | ◐ | ? |
| **Fuel & POS** |
| Retail POS w/ inventory | TS | ● | ● | ● | ● (+restaurant) | ○ | ● | ● |
| Fuel dock (mobile checkout, tank levels) | TS (fuel sites) | ● (+tipping) | ◐ | ● | ● | ○ | ● | ● |
| Fuel controller / pay-at-pump integration | D | ○ | ◐ | ? | ● | ○ | ○ | ○ |
| **CRM / marketing** |
| Leads/inquiries + forms | TS | ● (free) | ● | ● (sales) | ◐ | ● | ○ | ● |
| Email/SMS announcements & automation | TS | ● | ● | ◐ | ● | ● | ◐ | ● |
| Reviews/reputation | D | ● (ActiveCaptain) | ○ | ○ | ○ | ○ | ○ | ○ |
| **Customer app / portal** |
| Boater self-service portal (pay, docs, boats) | TS | ● (app) | ● (v-next) | ● (Web) | ● | ● (app) | ● | ● |
| Native mobile boater app | D | ● | ◐ | ○ | ◐ | ● | ○ | ○ (PWA?) |
| Concierge/service requests | D | ◐ | ◐ | ○ | ○ | ○ | ○ | ● |
| **Operations** |
| Interactive dock map | TS | ● | ● | ● | ● | ● | ◐ | ● |
| Mobile dock walk | TS | ● | ● | ◐ | ◐ | ● | ○ | ● |
| Offline-capable dock walk | D | ? | ● (since Dec 2024) | ○ | ○ (desktop option) | ? | ○ | ● |
| Gate/access-control integration | D→TS (larger) | ○ | ? | ○ | ? | ◐ | ○ | ○ gap |
| Smart pedestals / IoT sensors | D | ◐ (meter readings) | ? | ○ | ○ | ● HarbaSense | ○ | ○ |
| **Reporting** |
| Standard ops/financial reports, rent roll, occupancy | TS | ◐ (not customizable) | ● (80+) | ● | ● | ◐ | ◐ | ● |
| Forecasting/benchmarks | D | ● Insights/Marina-X | ◐ data lake | ○ | ○ | ○ | ○ | ◐ BI API |
| **Platform** |
| Multi-location / portfolio dashboard | TS (groups) | ● portfolio | ● | ◐ | ◐ | ◐ Enterprise | ○ | ● |
| Public API / BI API | D | ? | ? | ○ | ○ | ◐ | ○ | ● BI API |
| Self-serve onboarding / transparent pricing | D | ◐ (prices public) | ○ | ○ | ○ | ● | ◐ | ● onboarding wizard |

**Table stakes Helm already claims (and must make solid):**
- dock map
- contracts + e-sign + renewals
- transient widget
- recurring billing/autopay, card/ACH/terminal
- QBO
- portal
- POS/fuel
- dock walk
- leads
- email/SMS
- reports
- multi-site

**Table stakes Helm lacks:**
- service work orders (for full-service yards)
- metered utility billing
- state-aware surcharge/convenience fees
- dunning
- haul-out scheduling
- data import tooling
- Xero/NetSuite (for groups)

---

## 3. Gap analysis

### 3.1 Must be solid at launch (table stakes; failures here churn customers)

1. **Billing correctness:** Proration, credits/refunds, partial payments, installment schedules, deposits, and contract amendments mid-term.
   - Molo is criticized for exactly this (no auto prorate; awkward credit notes).
   - Helm's native GL + deferred revenue means **billing errors become accounting errors**. Prioritize test coverage here above any new feature.
2. **Payments trust:**
   - Clear payouts with deposit reconciliation by batch. Molo's "you will never have a definitive deposit" complaint is a direct opening.
   - Instant payouts (optional), dispute handling, and ACH return handling.
   - **State-aware surcharging/convenience fees:**
     - Visa caps credit surcharges at 3% ([Stax](https://staxpayments.com/blog/credit-card-surcharge-guidance/)).
     - Debit can't be surcharged.
     - CT, ME, MA, and PR prohibit it; CA status is contested.
     - Dockwa also blocks NY and Canada ([Dockwa](https://blog.dockwa.com/marinas/protect-marina-margins-before-season); [CardFellow](https://www.cardfellow.com/blog/checkout-fees-charging-credit-card-fees-to-customers)).
   - Build a jurisdiction rule table + a disclosure UI + card-type (credit vs debit) detection via Stripe card funding. Offer a cash-discount/ACH-incentive alternative.
3. **Sales tax on dockage:**
   - Florida taxes dock/storage rentals at 6% + local surtax under s.212.03(6). The tax survived the Oct 2025 commercial-rent repeal ([FL DOR TIP 25A01-11](https://floridarevenue.com/taxes/tips/Documents/TIP_25A01-11.pdf); [Moffa](https://moffataxlaw.com/florida-sales-tax-on-parking-docking-tie-down-storage-tip-25a01-11/)).
   - High-and-dry storage may be non-taxable bailment, a gray area ([FL sales tax blog](https://www.floridasalestax.com/florida-tax-law-blog/2026/june/florida-sales-tax-on-boat-repairs-and-marine-ser/)).
   - Other states vary; SC has advisory opinions ([SC TAM 90-5](https://dor.sc.gov/resources-site/lawandpolicy/Advisory%20Opinions/TAM90-5.pdf)).
   - **Required:** per-product tax codes (transient vs annual vs dry stack vs utility vs fuel), multiple stacked rates (state + county surtax), tax-exempt customers, and tax liability reports. Optional: Avalara/Stripe Tax for retail.
4. **Metered utilities:** Pedestal meter readings captured on the dock walk (Helm already has offline dock walks, so this is a natural extension) → usage × rate → invoice line.
   - Dockwa bundles this in Spaces.
   - Seasonal and liveaboard marinas expect it.
5. **Migration tooling:**
   - CSV/XLSX importers for customers, boats, slips, contracts, balances, and autopay tokens.
   - Mapping templates for Molo, DockMaster, Dockwa, MarinaOffice, and spreadsheets.
   - Molo charges extra for map/data import ([SlipRight](https://slipright.app/guides/what-marina-software-costs)); SlipRight offers it free. Free white-glove migration is now expected at the SMB end.
   - **Card-token migration** (Stripe → Stripe account migration, or PAN data import from the prior processor through Stripe's import process) is the single biggest switching barrier for autopay customers. Productize it.
6. **Service/work orders (lite):** For full-service and boatyard marinas this is non-negotiable.
   - Dockwa added it in July 2026 because customers demanded it.
   - Ship v1: estimate → approval (e-sign) → work order → tech time + parts (from Helm inventory) → invoice.
   - Defer warranty and dealer features.
7. **Dunning and collections:** Automated reminders, late fees, autopay-failure retries, and lien/notice letters (vessel lien workflows vary by state).
8. **Reliability and security:** PCI SAQ-A scope (keep all PAN in Stripe Elements/Terminal), SOC 2 roadmap (enterprise groups will ask), role-based permissions, and audit logs.
9. **ADA/WCAG 2.1 AA** for the public booking widget and portal. DOJ's 2024 Title II rule requires it for **municipal marinas** (state and local government web content) on 2026–2027 deadlines. Municipal harbors are a big Dockwa segment, so this is a sales requirement there.

### 3.2 Differentiators Helm could own

| Differentiator | Why it's open | Evidence |
|---|---|---|
| **All-in-one slips + rentals + boat club + dry stack, one customer/one ledger** | Dockwa has no rentals. Storable has it through two acquired products. Most marinas bolt on FareHarbor or Peek (6–8% fees) | §1.2, §1.12 |
| **Dynamic pricing for both transient slips AND rentals**, incl. lock-slip fees and seasonal renewal-rate recommendations | Telescope is quote-only and transient-focused. Stellar's dynamic pricing rated "limited." Campgrounds prove ~9%+ uplift | [Telescope](https://marinas.dockwa.com/marina-revenue-management); [Booking Central](https://www.bookingcentral.com/blog/best-boat-rental-software); [Pricepoint](https://hoteltechreport.com/success-stories/revenue-management/pricepoint/usa-camping-company) |
| **AI COI extraction** (carrier, limits, named insured, expiry, additional-insured check) + auto-reminders | Nobody advertises it. Insurance compliance is a top manual task, and Dockwa's Marina-X is aimed at insurers | §1.1 |
| **Native accounting** (GL, deferred revenue for prepaid annual contracts, rent roll) with QBO as an *output* | Competitors "sync to QBO" and get slow-sync complaints. Annual prepayments need deferral (ASC 606) for audited and lender-financed marinas | [MarinaOffice reviews](https://www.capterra.ca/reviews/98609/marinaoffice) |
| **Offline-first dock walks** + meter readings + photo condition reports | Connectivity on docks is poor. Only Storable added offline mode | §1.2 |
| **Modern UX + transparent self-serve pricing + onboarding wizard** | DockMaster is "Windows 95," Molo is "slow/clunky," and most vendors are quote-only | §1.2, §1.3 |
| **Waitlist with deposits** (paid priority queue) | Monetizes the scarcity at full marinas. A deposit-backed queue is uncommon | — |
| **Portfolio dashboard + BI API for 2–20-site independents** | Below Storable's enterprise sales motion, above SMB tools | §1.14 |
| **Neutral on demand** (integrate with marketplaces instead of competing with the marina) | Dockwa's "middleman" perception and rate-parity rule. Helm can promise "your boaters, your data, no commission on direct bookings" | [G2](https://www.g2.com/products/dockwa-dockwa/reviews) |

### 3.3 Strategic risks

- **Dockwa's demand moat:** Transient-heavy marinas won't leave Dockwa's network. Mitigation: a "coexist" mode, i.e. a Dockwa/Snag-A-Slip channel integration (availability and price push, booking pull).
  - Dockwa has no public PMS channel API. A Snag-A-Slip integration is feasible, since it already integrates with Molo and MARINAGO. Pursue a partnership with Dockwa only if they open up.
  - Otherwise, position Helm for **seasonal/annual-heavy and rental-heavy marinas**, where marketplace demand matters less.
- **Storable** will bundle payments + insurance and compete on enterprise. Avoid head-on PE-group RFPs in year 1.
- **Price compression** from $100–250/month entrants. Helm must justify its premium with rentals, dynamic pricing, and accounting.
- **Breadth vs depth:** Helm's claimed scope is huge. Spreading thin is the main execution risk. Pick an ICP and make those workflows flawless.

---

## 4. Pricing & packaging recommendation

### 4.1 Evidence

| Vendor | Model | Price signal |
|---|---|---|
| Dockwa | per-module, annual | $169–249/module/mo; ~$529–1,300/mo stack; Telescope quote; ≤4% surcharge to boater |
| Storable Molo | size-based + payments margin | ~$299/mo ≤100 slips; 0.35% over cost + e-transaction fees |
| Harba | base + per-spot | €2,700–6,000/yr + €5/spot/yr + €1,350 onboarding |
| SlipRight | per slip | $5/slip/mo, $250 min, no payments markup |
| Atlantis | tiered by spaces + payments | $150–900/mo + 1% of payments |
| SlipBoss | freemium tiers | $0 / $100 / $250 |
| SpeedyDock | per slip | from ~$0.99/slip/mo |
| DockMaster | per feature quote | ~$165/feature/mo (directory) |
| Campspot (analog) | guest-paid booking fee | operator $0/reservation; ~10% marketplace |
| FareHarbor (analog) | guest-paid booking fee | ~6% + processing |

Embedded payments benchmarks: platforms under $50M GMV earn a median 0.46–0.60% net take rate; Stripe Connect Standard/referral earns less ([Apideck](https://www.apideck.com/blog/embedded-finance-vertical-saas); [Rainforest benchmarks](https://www.rainforestpay.com/benchmarks)).

**Sizing the payments prize:** A 150-slip marina at ~$4k average annual slip revenue processes ~$600k of dockage, plus rentals, fuel, and POS, so ~$1M+ GMV. At 50 bps that's ~$5k/year, comparable to the subscription itself. **Payments should be ~40–50% of Helm revenue at maturity**, mirroring Storable and Toast.

### 4.2 Recommendation

**Primary meter: per rentable unit (wet slip, mooring, dry rack, rental boat), with a platform floor.** It scales with the customer's revenue capacity, is easy to understand, and matches Harba, SlipRight, and SpeedyDock.

| Tier | Price (annual billing) | Includes |
|---|---|---|
| **Starter** | $4/unit/mo, min **$199/mo** | dock map, contracts + e-sign + renewals, billing/autopay, portal, transient widget, waitlist, leads, QBO, email |
| **Pro** (target tier) | $6/unit/mo, min **$399/mo** | + AI COI, offline dock walks + metering, SMS + automations, POS/fuel, inventory, dry stack, dynamic pricing (slips), AR/dunning, native GL + deferred revenue |
| **Portfolio** | $7/unit/mo or custom, min $1,500/mo | + multi-site dashboard, BI API, SSO, Xero/NetSuite, priority support, SLA |
| **Add-on: Rentals & Club** | +$149/mo per site + $10/rental boat/mo | rental booking widget, waivers, dynamic pricing, promo codes, membership rules |
| **Add-on: Service/Yard** (once built) | +$149/mo per site | work orders, estimates, tech time, haul-out scheduling |

- **Payments (Helm Pay on Stripe Connect):**
  - Default is **interchange-plus + 0.40–0.60%** for card. A blended published rate (e.g. 2.9% + 30¢) is the alternative; offer both.
  - ACH at 0.8% capped at $5–10. Large seasonal payments make ACH the margin protector for marinas.
  - Terminal hardware passed through at cost.
  - **State-aware surcharging tool** (credit only, ≤3%, blocked in prohibited states) and an ACH-incentive discount.
  - Transparent per-payout reconciliation reports. Make payments **optional but discounted**: e.g. 20% off subscription with Helm Pay, as Molo/Storable effectively require.
- **Online booking fee option (campground model):** Let marinas pass a $2–5 guest booking fee on transient and rental bookings. Helm keeps it, and the operator's software cost drops. Make it opt-in, and never charge commission on the marina's direct bookings. That's the key messaging contrast with marketplaces.
- **Onboarding:** Free self-serve. **Free standard migration** for Pro and above on annual plans (match SlipRight). Paid white-glove ($750–2,500) for DockMaster/MarinaOffice conversions with history and GL.
- **Avoid:**
  - pure per-module pricing (Dockwa's stacking is a complaint vector)
  - percentage-of-dockage revenue share (the marina owner hates it)
  - quote-only pricing (a self-serve SMB buyer bounces)

**Worked examples:**
- **100-slip** independent on Pro: ~$600/mo (~$7.2k/yr) vs Dockwa ~$529–900 and Molo ~$299 + payments.
- **60-slip + 12-boat rental** marina on Pro: $399 min (60 × $6 = $360, so the minimum applies) + Rentals $149 + $120 = ~$668/mo. That replaces Dockwa modules + FareHarbor (6% of rental revenue).
- **Pricing caveat:** Validate with 10–15 design partners. Price elasticity data is non-public.

---

## 5. Go-to-market insights

### 5.1 Ideal initial customer profile (ICP)

- **Primary ICP:**
  - Independent, owner-operated marina with **75–300 units** and **mixed revenue**: seasonal/annual slips + dry stack + **a rental fleet or boat club** + fuel/ship store.
  - Currently on spreadsheets/QuickBooks, Marina Master, MarinaOffice desktop, or DockMaster (pain: UI), or using Dockwa for transients + FareHarbor/Peek for rentals + QBO (pain: three systems).
- **Regions:**
  - **Florida & Gulf Coast** (dry stack heavy, year-round, rental-heavy, complex sales tax, where Helm can win on tax correctness)
  - **Great Lakes & inland lakes/reservoirs** (seasonal contracts, rentals/pontoons, less transient, so Dockwa's network matters less)
  - **Carolinas/Chesapeake** (mixed)
  - Avoid New England transient-harbor towns first; that's Dockwa's home turf.
- **Secondary:** Small groups of 2–10 marinas (portfolio dashboard, rent roll, native GL) not yet bought by Blackstone, Suntex, or Safe Harbor.
- **Later:** Municipal harbors (need ADA/WCAG, procurement, and often Dockwa coexistence) and full-service boatyards (after Service ships).

### 5.2 Sales channels

- **Trade shows and conferences:**
  - AMI Conference & Expo (Storable presented AI comms there in Feb 2026; [Business Wire](https://www.businesswire.com/news/home/20260202255495/en))
  - **Marina Dock Age Conference** (marina-ops audience)
  - **MOAA** (Marina Operators Association of America) annual meeting and policy events
  - **IBEX** (Tampa Oct 6–8, 2026; moving to December from 2027 per [NMMA](https://www.nmma.org/press/article/25524)). IBEX is builder-centric; lower priority.
  - Regional associations: Marine Industries Association of South Florida, MIASF; Michigan Boating Industries Association; Marine Trades Association of NJ, etc. Plus state marina associations and the Florida/Michigan Clean Marina programs.
- **Content/SEO:** "Molo alternative," "DockMaster alternative," "marina software pricing" (SlipRight and Guideflow are already ranking with comparison pages), plus a public pricing page. Sales-tax-on-dockage guides by state are a high-intent SEO wedge.
- **Partnerships:**
  - Snag-A-Slip (channel integration)
  - SpeedyDock (if not building the boater dry-stack app)
  - pedestal/metering vendors: Eaton (wireless remote metering on Lighthouse SS pedestals; [Eaton](https://www.eaton.com/us/en-us/catalog/temporary-power/lighthouse-ss-power-pedestal.html)), Marina Electrical Equipment, MarineSync, Smarter Technologies, and MHPS Triton, which have APIs/import ([Smarter Technologies](https://smartertechnologies.com/smart-utility-metering/marina-pedestal-metering-system/); [MarineSync](https://www.marinesync.com/marinas); [MHPS](https://mhpsolutions.co.uk/marina-pedestal-metering-systems/))
  - gate/access: Parking BOXX, Inugo, Tap2Open ([Parking BOXX](https://www.parkingboxx.com/marina); [Inugo](https://inugo.com/industries/marinas); [Tap2Open](https://about.tap2open.com/?p=4604))
  - marina insurance brokers (COI flow)
  - marine lenders
- **Motion:** Product-led trial + demo-assisted close (ACV ~$5–15k). Design-partner program of 10–15 marinas at a discounted founding price in exchange for case studies. Target the off-season (Oct–Feb) for switching: marinas won't migrate mid-season, and annual contracts renew Nov–Mar.

### 5.3 Switching costs and migration needs

- **Data to import:** customers, boats (LOA/beam/draft, registration, insurance), slips/racks with dimensions and map geometry, active contracts with terms and balances, open invoices/AR, deposits/waitlist positions, autopay methods, price lists, inventory/SKUs, GL opening balances.
- **Hard parts:**
  1. **Payment tokens:** Request a PAN export from the prior processor to Stripe. Feasible via Stripe's data-import process but slow (weeks), so start in the sales cycle.
  2. Dock map geometry: offer map-building as a service from an aerial image.
  3. Historical ledger: import summaries only and keep the legacy system read-only.
- **Source systems:** Molo (CSV exports; e-transaction contract terms), DockMaster (desktop DB exports and reports), Dockwa (contract/boater CSV exports; may keep Dockwa for transients), MarinaOffice (Access/SQL), spreadsheets/QBO customer lists.
- **Mitigate switching anxiety:** parallel-run month, autopay re-enrollment campaign tooling (portal invite + SMS), and free migration on annual plans.

### 5.4 Must-have integrations (prioritized)

1. **Stripe** (Connect, Terminal, ACH/Financial Connections, Tax optional): in place.
2. **QuickBooks Online:** in place. Ensure class/location mapping, deposit matching to payouts, and deferred revenue journal entries.
3. **Google:** Calendar, Business Profile booking link, GA4/Ads conversion tracking on widgets, Google Sign-In.
4. **Email/SMS:** native plus a **Mailchimp/Constant Contact** audience sync. Twilio 10DLC registration is required for SMS compliance (TCPA consent capture).
5. **Pedestal metering import** (CSV/API from MarineSync, Smarter Technologies, Eaton wireless metering). Phase 2: remote on/off.
6. **Gate/access control** (Parking BOXX, Inugo, Tap2Open): provision/revoke credentials from contract status (auto-revoke on non-payment is a killer feature).
7. **Transient marketplaces:** Snag-A-Slip first; Dockwa only if an API exists; Google Business booking link.
8. **Xero/NetSuite/Sage Intacct** for the Portfolio tier (Storable and Dockwa both offer these).
9. **E-sign:** native is fine; DocuSign optional.
10. **Rental demand channels:** Boatsetter/GetMyBoat calendar sync (iCal at minimum) to prevent double-booking.
11. **Zapier/webhooks + public API** to signal openness vs closed incumbents.

### 5.5 Compliance checklist

- **PCI DSS:** Stay in SAQ-A/SAQ-A-EP via Stripe Elements/Checkout/Terminal. Never store PAN. Do annual SAQ attestation, and inherit Stripe's PayFac compliance under Connect.
- **Surcharging:**
  - card-brand registration/notice
  - ≤3% cap (Visa)
  - credit-only
  - receipt disclosure
  - state blocks (CT, ME, MA, PR; verify CA, NY, CO, and others for caps/disclosure)
  - not on debit
  - Canada rules differ by province
- **Sales tax:** Per-jurisdiction rates on dockage (FL 6% + surtax; others vary), tax-exempt certificates, liveaboard/long-term edge cases, and fuel tax treatment (marine fuel excise differs). Provide tax reports; consider Avalara/Stripe Tax for retail.
- **ADA/WCAG 2.1 AA** for booking widget, portal, and emails. Mandatory for municipal customers under the DOJ Title II web rule.
- **Privacy/Messaging:** TCPA/10DLC for SMS, CAN-SPAM, CCPA/CPRA for CA boaters, and data processing agreements for groups.
- **Contracts/liens:** State vessel-lien and abandonment procedures, needed for notice templates; rental waivers and state boater-education requirements (e.g. FL livery rules for rentals: pre-rental instruction, livery permit).
- **SOC 2 Type I → II** by the time Helm sells to groups of more than 10 sites.

---

## 6. Prioritized action list (from this research)

1. Harden billing/proration/payments/payout reconciliation and the QBO deposit mapping. **P0**
2. Build sales tax engine basics (per-product tax codes, stacked rates, exemptions, reports) and state-aware surcharge/convenience fee. **P0**
3. Build migration importers (customers/boats/slips/contracts/balances) + a payment-token migration runbook. **P0**
4. Add metered utility readings to the offline dock walk → invoice lines. **P1**
5. Build Service/work orders v1 + haul-out scheduling. **P1** (required for full-service ICP)
6. Ship a public pricing page + self-serve trial and a design-partner program in the off-season. **P1**
7. Productize dynamic pricing (slips + rentals) with guardrails, lock-slip fee, and a revenue uplift report. **P1, flagship differentiator**
8. Integrations: Snag-A-Slip channel, Mailchimp, gate access (one vendor), metering CSV/API (one vendor), Xero. **P2**
9. Boat club membership rules (booking windows, credits, reciprocity). **P2**
10. WCAG audit of widgets/portal; SOC 2 readiness. **P2**

---

## 7. Known data gaps and uncertainty

- Not public, so verify through demos or mystery-shopping:
  - Dockwa per-booking Network fee and processing rates
  - Telescope price
  - Molo e-transaction fees
  - Snag-A-Slip commission
  - DockMaster and Scribble pricing
- The DockMaster → Aspire acquisition (Mar 2026) comes from one source.
- The MarineMax/Safe Harbor deal (Aug 2026) comes from one source.
- "Swiftpad" couldn't be identified; MarinaWare is barely documented.
- US marina count varies 2.8k–12k by definition.
- Review samples are small (9–20 reviews per vendor) and skew older. Several review pages blocked direct fetch, so quotes come from search excerpts.
