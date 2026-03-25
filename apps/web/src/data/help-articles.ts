export interface HelpArticle {
  id: string;
  title: string;
  category: string;
  excerpt: string;
  content: string;
  relatedPages: string[];
}

export const HELP_CATEGORIES = [
  'Getting Started',
  'Billing & Payments',
  'Slip Management',
  'Boat Rentals',
  'POS',
  'Reports',
  'Admin & Settings',
  'Integrations',
];

export const HELP_ARTICLES: HelpArticle[] = [
  {
    id: '1', category: 'Getting Started', title: 'Setting Up Your Marina',
    excerpt: 'Learn how to configure your marina profile, branding, and initial settings.',
    content: 'Welcome to Helm! Start by navigating to Settings → Marina Profile to enter your marina name, address, and contact information. Next, configure your operating hours and timezone. Then head to Branding to upload your logo and set your brand colors — these will appear on your customer portal, invoices, and emails.\n\nOnce your profile is set, configure your chart of accounts under Settings → Billing. Helm seeds a marina-industry standard chart of accounts, but you can customize account names and add new accounts as needed.\n\nFinally, invite your team members under Settings → Team & Roles. Each team member gets a role that controls what they can access.',
    relatedPages: ['/settings', '/onboarding'],
  },
  {
    id: '2', category: 'Getting Started', title: 'Importing Existing Data',
    excerpt: 'How to migrate your data from Dockmaster, Molo, or spreadsheets.',
    content: 'Helm supports data migration from Dockmaster and Molo through our white-glove migration service. Contact our team to schedule a migration consultation.\n\nFor spreadsheet imports, prepare your data in CSV format with the following columns: customer name, email, phone, boat name, boat length, slip number, contract start date, contract end date, and monthly rate. Upload via Settings → Advanced → Data Import.\n\nDuring migration, we run a parallel period where both systems operate simultaneously. This ensures no data is lost and gives your team time to verify everything transferred correctly.',
    relatedPages: ['/settings'],
  },
  {
    id: '3', category: 'Billing & Payments', title: 'Understanding Invoice Generation',
    excerpt: 'How Helm automatically generates invoices based on contracts and meter readings.',
    content: 'Helm generates invoices automatically based on your slip contracts. On each billing cycle date, the system creates a draft invoice with the base slip rent, electricity charges (metered or flat fee), and any pending POS charges billed to the slip.\n\nThe billing engine runs nightly and processes all contracts where the next billing date has arrived. Invoices include: base rent calculated from the contract rate, electricity calculated from the latest meter reading (for metered slips), any amenity fees, and outstanding charge-to-slip POS transactions.\n\nAfter generation, invoices are finalized, PDF is generated, and if the customer has autopay enabled, Stripe charges their default payment method automatically.',
    relatedPages: ['/billing'],
  },
  {
    id: '4', category: 'Billing & Payments', title: 'Setting Up Autopay',
    excerpt: 'Enable automatic payment collection for your customers.',
    content: 'Autopay allows customers to have their invoices automatically charged to their saved payment method. Customers can enable autopay from the customer portal under Payment Methods.\n\nWhen autopay is enabled and an invoice is finalized, Helm automatically creates a Stripe charge. If the charge succeeds, the invoice is marked Paid and a receipt is emailed. If it fails, the invoice moves to Past Due and the retry schedule begins (day 3, 7, and 14).\n\nYou can view autopay status for any customer in their profile under the Billing tab.',
    relatedPages: ['/billing', '/customers'],
  },
  {
    id: '5', category: 'Billing & Payments', title: 'ACH Return Handling',
    excerpt: 'What happens when an ACH payment is returned and how to resolve it.',
    content: 'When an ACH payment is returned by the bank, Helm automatically processes the return based on the R-code. R01 (Insufficient Funds) triggers one automatic retry before blocking. R02, R03, R07, and R10 result in an immediate ACH block on the customer account.\n\nThe original payment is reversed with a GL entry, the invoice is reopened to Past Due status, and a configurable return fee is added. The customer receives an email and SMS notification with the reason (sanitized for clarity).\n\nStaff are alerted via the dashboard and daily digest email. All ACH returns sync to QuickBooks automatically.',
    relatedPages: ['/billing'],
  },
  {
    id: '6', category: 'Slip Management', title: 'Managing Slip Inventory',
    excerpt: 'Add, edit, and organize your slips with the dock map and list views.',
    content: 'Navigate to Slips to view your entire slip inventory. Use the List view for a detailed table or switch to the Dock Map view for a visual representation color-coded by status.\n\nTo add a new slip, click "Add Slip" and enter the slip number, dock, dimensions (length, width, depth), power configuration, and electricity mode (metered or flat rate). Each slip gets a unique QR code that can be printed for dock placards.\n\nSlip statuses include: Vacant (available for assignment), Occupied (active contract), Maintenance (temporarily unavailable), and Reserved (pending contract). The compliance dot on the dock map shows the occupant\'s compliance score.',
    relatedPages: ['/slips'],
  },
  {
    id: '7', category: 'Slip Management', title: 'Creating Contracts',
    excerpt: 'How to create and manage slip lease contracts.',
    content: 'To create a contract, navigate to Contracts → New Contract. Select the customer, slip, boat, and enter the contract terms: start date, end date, billing cycle (monthly/quarterly/annual), and rate.\n\nContracts support auto-renewal — when enabled, the system automatically generates a renewal contract before expiration. You can configure rate increases as a percentage, fixed dollar amount, or custom override.\n\nFor early termination, configure the penalty as a fixed amount or formula (e.g., remaining months × rate). The system handles deferred revenue washout and GL entries automatically.',
    relatedPages: ['/contracts'],
  },
  {
    id: '8', category: 'Slip Management', title: 'Bulk Renewal Process',
    excerpt: 'Renew multiple contracts at once with the bulk renewal engine.',
    content: 'The bulk renewal engine lets you renew multiple contracts simultaneously. Go to Contracts → Bulk Renewal to create a batch.\n\nFilter contracts by expiry date range, dock, slip type, or billing cycle. Choose your rate increase method: no change, fixed percentage (e.g., +5%), fixed dollar increase, or custom per-contract overrides.\n\nBefore committing, review the preview report showing contract count, current vs. new rates, and total revenue impact. A manager must approve the batch before it executes. Once approved, renewal contracts are generated and sent for e-signature in a single batch.',
    relatedPages: ['/contracts'],
  },
  {
    id: '9', category: 'Boat Rentals', title: 'Setting Up Rental Products',
    excerpt: 'Configure your rental fleet with pricing, availability, and policies.',
    content: 'Go to Rentals → Products to add your rental fleet. For each product, set: name, type (pontoon, jet ski, kayak, etc.), capacity, hourly/half-day/daily rates, price floor and ceiling, and cancellation policy.\n\nEach product can have multiple pricing rules that fire in a waterfall: base rate → calendar override → seasonal → peak day → demand surge → lead time → multi-day discount → floor/ceiling. The pricing calendar shows which rule drives the price on any given day.\n\nDon\'t forget to configure a damage waiver fee and/or security deposit for each product.',
    relatedPages: ['/rentals'],
  },
  {
    id: '10', category: 'Boat Rentals', title: 'Dynamic Pricing Rules',
    excerpt: 'Configure seasonal, demand-based, and promotional pricing.',
    content: 'Helm\'s dynamic pricing engine evaluates rules in priority order. Create rules under Rentals → Pricing Rules:\n\n1. Seasonal ranges (e.g., summer +25%)\n2. Peak day multipliers (weekends, holidays)\n3. Demand surge tiers based on fleet availability\n4. Lead time discounts (book 14+ days ahead)\n5. Multi-day discounts\n\nThe algorithmic layer analyzes historical booking patterns and suggests price adjustments. After 90 days of data, it surfaces suggestions that you can approve, ignore, or modify.\n\nUse the Price Simulation tool to test rule changes before going live.',
    relatedPages: ['/rentals'],
  },
  {
    id: '11', category: 'POS', title: 'Processing a Sale',
    excerpt: 'How to ring up items and accept payment at the point of sale.',
    content: 'Open POS → New Sale to start a transaction. Search or browse the product grid to add items to the cart. Adjust quantities with the +/- buttons.\n\nWhen ready, choose a payment method: Card (via Stripe Terminal), Cash (enter amount tendered for change calculation), ACH, or Charge to Slip (bills to the customer\'s next invoice).\n\nFor card payments, the customer taps or inserts on the WisePOS E terminal. The terminal supports offline mode — transactions are queued locally and processed when connectivity returns.',
    relatedPages: ['/pos'],
  },
  {
    id: '12', category: 'POS', title: 'Shift Management',
    excerpt: 'Open and close shifts, reconcile cash, and track tips.',
    content: 'Start each day by opening a shift: enter your name and opening float amount. During the shift, all transactions are attributed to you.\n\nAt shift end, click "Close Shift" to reconcile. Count your cash drawer and enter the total. The system compares expected vs. actual cash and flags any discrepancy. Tips are tallied per shift — you can view tip totals by employee in the Reports section.\n\nThe daily close report summarizes all transactions, payment methods, tips, and any discrepancies.',
    relatedPages: ['/pos'],
  },
  {
    id: '13', category: 'Reports', title: 'Running Reports',
    excerpt: 'Generate financial, operational, and customer reports.',
    content: 'Navigate to Reports to access the full report library. Reports are organized into four categories: Financial, Operations, Customer, and Rentals & POS.\n\nClick "Generate" on any report card to open the generation modal. Select your date range, output format (PDF, CSV, or XLSX), and any additional filters (dock, customer segment, etc.).\n\nGenerated reports appear in the Recent Reports tab with download links. You can also schedule reports to run automatically on a daily, weekly, or monthly basis.',
    relatedPages: ['/reports'],
  },
  {
    id: '14', category: 'Admin & Settings', title: 'User Roles and Permissions',
    excerpt: 'Manage team access with role-based permissions.',
    content: 'Helm uses role-based access control with six roles: Marina Owner (full access), Marina Manager (operations + financial summaries), Dock Staff (dock walks, check-in/out), POS Cashier (POS terminal only), Accounting (financial reports and GL), and Portal User (customer self-service).\n\nManage team members under Settings → Team & Roles. Invite new members by email — they\'ll receive a magic link to set up their account. You can change roles or disable accounts at any time.\n\nAdmin and Accounting roles require two-factor authentication (TOTP).',
    relatedPages: ['/settings'],
  },
  {
    id: '15', category: 'Integrations', title: 'Connecting Stripe',
    excerpt: 'Set up Stripe Connect to accept payments and process payouts.',
    content: 'Go to Settings → Integrations → Stripe Connect and click "Connect Stripe." You\'ll be redirected to Stripe to authorize Helm as a platform.\n\nOnce connected, Helm can process card and ACH payments on your behalf. Funds settle directly to your bank account. Helm takes a small platform fee on each Stripe-processed transaction (ACH rate is lower than card rate).\n\nYour Stripe connected account handles disputes directly — Helm helps you submit evidence through the chargeback management interface, but the dispute lands on your account, not Helm\'s.',
    relatedPages: ['/settings'],
  },
];
