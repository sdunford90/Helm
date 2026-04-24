-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "TenantStatus" AS ENUM ('ACTIVE', 'GRACE_PERIOD', 'LOCKED');

-- CreateEnum
CREATE TYPE "UserRole" AS ENUM ('PLATFORM_ADMIN', 'MARINA_OWNER', 'MARINA_MANAGER', 'DOCK_STAFF', 'POS_CASHIER', 'ACCOUNTING', 'PORTAL_USER');

-- CreateEnum
CREATE TYPE "LeadStage" AS ENUM ('NEW', 'CONTACTED', 'QUALIFIED', 'PROPOSAL_SENT', 'WON', 'LOST');

-- CreateEnum
CREATE TYPE "WaitlistStatus" AS ENUM ('WAITING', 'NOTIFIED', 'HOLD', 'ACCEPTED', 'EXPIRED', 'REMOVED');

-- CreateEnum
CREATE TYPE "CustomerStatus" AS ENUM ('ACTIVE', 'INACTIVE', 'WAITLIST', 'COLLECTIONS_HOLD', 'SEASONAL');

-- CreateEnum
CREATE TYPE "SlipStatus" AS ENUM ('VACANT', 'OCCUPIED', 'MAINTENANCE', 'RESERVED');

-- CreateEnum
CREATE TYPE "ElectricityMode" AS ENUM ('FLAT_FEE', 'METERED');

-- CreateEnum
CREATE TYPE "ContractStatus" AS ENUM ('DRAFT', 'ACTIVE', 'EXPIRING', 'EXPIRED', 'TERMINATED', 'RENEWED');

-- CreateEnum
CREATE TYPE "BillingCycle" AS ENUM ('MONTHLY', 'QUARTERLY', 'SEMI_ANNUAL', 'ANNUAL');

-- CreateEnum
CREATE TYPE "InvoiceStatus" AS ENUM ('DRAFT', 'ISSUED', 'PAID', 'PAST_DUE', 'VOID', 'COLLECTIONS');

-- CreateEnum
CREATE TYPE "PaymentMethod" AS ENUM ('CARD', 'ACH', 'CASH', 'CHARGE_TO_SLIP', 'GIFT_CARD');

-- CreateEnum
CREATE TYPE "PaymentStatus" AS ENUM ('PENDING', 'COMPLETED', 'FAILED', 'REFUNDED', 'PARTIALLY_REFUNDED');

-- CreateEnum
CREATE TYPE "TerminationType" AS ENUM ('FIXED', 'FORMULA');

-- CreateEnum
CREATE TYPE "DeferredEntryStatus" AS ENUM ('PENDING', 'RECOGNIZED');

-- CreateEnum
CREATE TYPE "DepositStatus" AS ENUM ('HELD', 'RELEASED', 'APPLIED', 'REFUNDED');

-- CreateEnum
CREATE TYPE "GLAccountType" AS ENUM ('ASSET', 'LIABILITY', 'EQUITY', 'REVENUE', 'EXPENSE');

-- CreateEnum
CREATE TYPE "ReservationStatus" AS ENUM ('PENDING', 'CONFIRMED', 'CHECKED_IN', 'CHECKED_OUT', 'CANCELLED', 'NO_SHOW');

-- CreateEnum
CREATE TYPE "PricingRuleType" AS ENUM ('SEASONAL', 'PEAK_DAY', 'LEAD_TIME', 'MULTI_DAY');

-- CreateEnum
CREATE TYPE "SuggestionStatus" AS ENUM ('PENDING', 'APPROVED', 'IGNORED');

-- CreateEnum
CREATE TYPE "AutomationEventType" AS ENUM ('ABANDONED_CART_1', 'ABANDONED_CART_2', 'ABANDONED_CART_3', 'POST_BOOKING_CONFIRM', 'PRE_ARRIVAL', 'CHECK_IN_REMINDER', 'POST_RENTAL_THANKS', 'NPS_SURVEY', 'GOOGLE_REVIEW_PROMPT', 'RE_ENGAGEMENT');

-- CreateEnum
CREATE TYPE "TransientStatus" AS ENUM ('BOOKED', 'CHECKED_IN', 'CHECKED_OUT', 'CANCELLED', 'OVERSTAY');

-- CreateEnum
CREATE TYPE "RampTicketType" AS ENUM ('SINGLE_LAUNCH', 'DAILY_PASS', 'SEASONAL_PASS');

-- CreateEnum
CREATE TYPE "ConciergeStatus" AS ENUM ('SUBMITTED', 'QUOTED', 'APPROVED', 'SCHEDULED', 'IN_PROGRESS', 'COMPLETED', 'INVOICED');

-- CreateEnum
CREATE TYPE "ShiftStatus" AS ENUM ('OPEN', 'CLOSED', 'RECONCILED');

-- CreateEnum
CREATE TYPE "DockWalkStatus" AS ENUM ('IN_PROGRESS', 'COMPLETED');

-- CreateEnum
CREATE TYPE "DockWalkItemStatus" AS ENUM ('OK', 'VIOLATION', 'NEEDS_ATTENTION');

-- CreateEnum
CREATE TYPE "InsuranceStatus" AS ENUM ('PENDING_REVIEW', 'APPROVED', 'EXPIRED', 'REJECTED');

-- CreateEnum
CREATE TYPE "AnnouncementChannel" AS ENUM ('EMAIL', 'SMS', 'BOTH');

-- CreateEnum
CREATE TYPE "DeliveryStatus" AS ENUM ('PENDING', 'SENT', 'DELIVERED', 'FAILED', 'OPENED');

-- CreateEnum
CREATE TYPE "ApiKeyScope" AS ENUM ('TENANT', 'PORTFOLIO');

-- CreateEnum
CREATE TYPE "CollectionResolution" AS ENUM ('PAID_IN_FULL', 'SETTLED', 'WRITTEN_OFF');

-- CreateEnum
CREATE TYPE "ChargebackStatus" AS ENUM ('OPEN', 'EVIDENCE_SUBMITTED', 'WON', 'LOST');

-- CreateTable
CREATE TABLE "tenants" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "subdomain" TEXT NOT NULL,
    "customDomain" TEXT,
    "brandingJson" JSONB,
    "invoiceTemplateJson" JSONB,
    "stripeAccountId" TEXT,
    "stripeCustomerId" TEXT,
    "stripeSubscriptionId" TEXT,
    "applicationFeePctBps" INTEGER NOT NULL DEFAULT 0,
    "applicationFeeFixedCents" INTEGER NOT NULL DEFAULT 0,
    "qboRealmId" TEXT,
    "timezone" TEXT NOT NULL DEFAULT 'America/New_York',
    "fiscalYearEnd" TEXT NOT NULL DEFAULT '12/31',
    "saasTierId" TEXT,
    "status" "TenantStatus" NOT NULL DEFAULT 'ACTIVE',
    "gracePeriodStartedAt" TIMESTAMP(3),
    "lockedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "tenants_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "locations" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "address" TEXT,
    "city" TEXT,
    "state" TEXT,
    "zip" TEXT,
    "phone" TEXT,
    "timezone" TEXT NOT NULL DEFAULT 'America/New_York',
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "locations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "saas_tiers" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "monthlyFeeCents" INTEGER NOT NULL,
    "perLocationFeeCents" INTEGER NOT NULL,
    "achFeeRate" DOUBLE PRECISION NOT NULL,
    "cardFeeRate" DOUBLE PRECISION NOT NULL,
    "storageLimitGb" INTEGER NOT NULL,
    "stripePriceId" TEXT,

    CONSTRAINT "saas_tiers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "users" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "role" "UserRole" NOT NULL,
    "firstName" TEXT NOT NULL,
    "lastName" TEXT NOT NULL,
    "clerkUserId" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "lead_forms" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "locationId" TEXT,
    "formType" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "fieldsJson" JSONB NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "embedKey" TEXT NOT NULL,

    CONSTRAINT "lead_forms_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "leads" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "locationId" TEXT,
    "stage" "LeadStage" NOT NULL DEFAULT 'NEW',
    "sourceFormId" TEXT,
    "sourceUrl" TEXT,
    "utmSource" TEXT,
    "utmMedium" TEXT,
    "referralCode" TEXT,
    "firstName" TEXT NOT NULL,
    "lastName" TEXT NOT NULL,
    "email" TEXT,
    "phone" TEXT,
    "boatLength" DOUBLE PRECISION,
    "slipType" TEXT,
    "notes" TEXT,
    "assignedTo" TEXT,
    "lostReason" TEXT,
    "convertedAt" TIMESTAMP(3),
    "customerId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "leads_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "referral_partners" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "contactEmail" TEXT,
    "type" TEXT NOT NULL,
    "leadsCount" INTEGER NOT NULL DEFAULT 0,
    "conversionsCount" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "referral_partners_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "waitlist_entries" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "locationId" TEXT,
    "customerId" TEXT,
    "leadId" TEXT,
    "slipType" TEXT,
    "boatLength" DOUBLE PRECISION,
    "desiredDate" TIMESTAMP(3),
    "queuePosition" INTEGER NOT NULL,
    "status" "WaitlistStatus" NOT NULL DEFAULT 'WAITING',
    "notifiedAt" TIMESTAMP(3),
    "holdExpiresAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "waitlist_entries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "customers" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "firstName" TEXT NOT NULL,
    "lastName" TEXT NOT NULL,
    "company" TEXT,
    "email" TEXT,
    "phone" TEXT,
    "addressJson" JSONB,
    "dob" TIMESTAMP(3),
    "dlNumber" TEXT,
    "dlState" TEXT,
    "dlExpiry" TIMESTAMP(3),
    "dlPhotoUrl" TEXT,
    "emergencyContactJson" JSONB,
    "status" "CustomerStatus" NOT NULL DEFAULT 'ACTIVE',
    "taxExempt" BOOLEAN NOT NULL DEFAULT false,
    "exemptionCertUrl" TEXT,
    "exemptionExpiry" TIMESTAMP(3),
    "achBlocked" BOOLEAN NOT NULL DEFAULT false,
    "stripeCustomerId" TEXT,
    "qboCustomerId" TEXT,
    "leadSource" TEXT,
    "convertedFromLeadId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "customers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "boats" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "name" TEXT,
    "registrationNumber" TEXT,
    "registrationState" TEXT,
    "registrationExpiry" TIMESTAMP(3),
    "hin" TEXT,
    "make" TEXT,
    "model" TEXT,
    "year" INTEGER,
    "lengthFt" DOUBLE PRECISION NOT NULL,
    "beamFt" DOUBLE PRECISION,
    "draftFt" DOUBLE PRECISION,
    "fuelType" TEXT,
    "engineCount" INTEGER,
    "engineHp" INTEGER,

    CONSTRAINT "boats_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "vessel_safety_records" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "boatId" TEXT NOT NULL,
    "inspectionDate" TIMESTAMP(3) NOT NULL,
    "inspectorId" TEXT,
    "passFail" TEXT,
    "notes" TEXT,
    "fireExtCount" INTEGER,
    "fireExtExpiry" TIMESTAMP(3),
    "lifeJacketCount" INTEGER,
    "flareExpiry" TIMESTAMP(3),
    "hasHorn" BOOLEAN,
    "hasThrowable" BOOLEAN,
    "nextDueDate" TIMESTAMP(3),

    CONSTRAINT "vessel_safety_records_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "slips" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "dockId" TEXT,
    "slipNumber" TEXT NOT NULL,
    "lengthFt" DOUBLE PRECISION NOT NULL,
    "beamFt" DOUBLE PRECISION,
    "depthFt" DOUBLE PRECISION,
    "slipType" TEXT,
    "shorePower" TEXT,
    "status" "SlipStatus" NOT NULL DEFAULT 'VACANT',
    "transientCapable" BOOLEAN NOT NULL DEFAULT false,
    "electricityMode" "ElectricityMode" NOT NULL DEFAULT 'FLAT_FEE',
    "flatFeeCents" INTEGER,
    "kwhRateCents" INTEGER,
    "qrCodeUrl" TEXT,

    CONSTRAINT "slips_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "slip_contracts" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "slipId" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "boatId" TEXT,
    "startDate" TIMESTAMP(3) NOT NULL,
    "endDate" TIMESTAMP(3),
    "billingCycle" "BillingCycle" NOT NULL DEFAULT 'MONTHLY',
    "billingAnchor" INTEGER,
    "rateCents" INTEGER NOT NULL,
    "electricityMode" "ElectricityMode",
    "autoRenew" BOOLEAN NOT NULL DEFAULT false,
    "status" "ContractStatus" NOT NULL DEFAULT 'DRAFT',
    "securityDepositCents" INTEGER,
    "earlyTerminationType" "TerminationType",
    "earlyTerminationValue" DOUBLE PRECISION,
    "qboItemId" TEXT,
    "renewalBatchId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "slip_contracts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "renewal_batches" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "createdBy" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "rateIncreaseType" TEXT,
    "rateIncreaseValue" DOUBLE PRECISION,
    "contractCount" INTEGER NOT NULL,
    "revenueDeltaCents" INTEGER,
    "approvedBy" TEXT,
    "approvedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "renewal_batches_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "meter_readings" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "slipId" TEXT NOT NULL,
    "readingDate" TIMESTAMP(3) NOT NULL,
    "previousKwh" DOUBLE PRECISION NOT NULL,
    "currentKwh" DOUBLE PRECISION NOT NULL,
    "consumedKwh" DOUBLE PRECISION NOT NULL,
    "rateCents" INTEGER NOT NULL,
    "amountCents" INTEGER NOT NULL,
    "isEstimated" BOOLEAN NOT NULL DEFAULT false,
    "staffId" TEXT,

    CONSTRAINT "meter_readings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "invoices" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "invoiceNumber" TEXT NOT NULL,
    "issuedDate" TIMESTAMP(3) NOT NULL,
    "dueDate" TIMESTAMP(3) NOT NULL,
    "status" "InvoiceStatus" NOT NULL DEFAULT 'DRAFT',
    "subtotalCents" INTEGER NOT NULL,
    "taxCents" INTEGER NOT NULL DEFAULT 0,
    "totalCents" INTEGER NOT NULL,
    "balanceCents" INTEGER NOT NULL,
    "pdfUrl" TEXT,
    "qboInvoiceId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "invoices_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "invoice_line_items" (
    "id" TEXT NOT NULL,
    "invoiceId" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "quantity" DOUBLE PRECISION NOT NULL DEFAULT 1,
    "unitPriceCents" INTEGER NOT NULL,
    "discountCents" INTEGER NOT NULL DEFAULT 0,
    "taxRate" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "taxCents" INTEGER NOT NULL DEFAULT 0,
    "extendedCents" INTEGER NOT NULL,
    "glAccountId" TEXT,
    "isDeferred" BOOLEAN NOT NULL DEFAULT false,
    "sourceType" TEXT,
    "sourceId" TEXT,

    CONSTRAINT "invoice_line_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payments" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "invoiceId" TEXT,
    "amountCents" INTEGER NOT NULL,
    "method" "PaymentMethod" NOT NULL,
    "stripePaymentId" TEXT,
    "postedDate" TIMESTAMP(3) NOT NULL,
    "status" "PaymentStatus" NOT NULL DEFAULT 'PENDING',
    "qboPaymentId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "payments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "processed_webhooks" (
    "id" TEXT NOT NULL,
    "stripeEventId" TEXT NOT NULL,
    "processedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "status" TEXT NOT NULL,
    "tenantId" TEXT,

    CONSTRAINT "processed_webhooks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ach_returns" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "paymentId" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "rCode" TEXT NOT NULL,
    "returnedAt" TIMESTAMP(3) NOT NULL,
    "reversalEntryId" TEXT,
    "returnFeeCents" INTEGER,
    "customerNotifiedAt" TIMESTAMP(3),
    "achBlockedSet" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "ach_returns_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "chargebacks" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "stripeDisputeId" TEXT NOT NULL,
    "amountCents" INTEGER NOT NULL,
    "status" "ChargebackStatus" NOT NULL DEFAULT 'OPEN',
    "evidenceSubmittedAt" TIMESTAMP(3),
    "outcome" TEXT,
    "creditIssuedCents" INTEGER,
    "platformFeeCents" INTEGER,

    CONSTRAINT "chargebacks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "collections_accounts" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "assignedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "assignedBy" TEXT NOT NULL,
    "agencyName" TEXT,
    "balanceAtHandoffCents" INTEGER NOT NULL,
    "status" TEXT NOT NULL,
    "recoveredCents" INTEGER NOT NULL DEFAULT 0,
    "resolvedAt" TIMESTAMP(3),
    "resolutionType" "CollectionResolution",

    CONSTRAINT "collections_accounts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "deferred_schedules" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "invoiceLineItemId" TEXT NOT NULL,
    "totalCents" INTEGER NOT NULL,
    "recognizedCents" INTEGER NOT NULL DEFAULT 0,
    "startDate" TIMESTAMP(3) NOT NULL,
    "endDate" TIMESTAMP(3) NOT NULL,
    "status" TEXT NOT NULL,

    CONSTRAINT "deferred_schedules_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "deferred_entries" (
    "id" TEXT NOT NULL,
    "scheduleId" TEXT NOT NULL,
    "recognitionDate" TIMESTAMP(3) NOT NULL,
    "amountCents" INTEGER NOT NULL,
    "glEntryId" TEXT,
    "status" "DeferredEntryStatus" NOT NULL DEFAULT 'PENDING',

    CONSTRAINT "deferred_entries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "security_deposits" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "contractId" TEXT,
    "amountCents" INTEGER NOT NULL,
    "stripeChargeId" TEXT,
    "status" "DepositStatus" NOT NULL DEFAULT 'HELD',
    "releasedAt" TIMESTAMP(3),
    "appliedToInvoiceId" TEXT,
    "qboLiabilityEntryId" TEXT,

    CONSTRAINT "security_deposits_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "gl_accounts" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "accountNumber" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" "GLAccountType" NOT NULL,
    "subType" TEXT,
    "qboAccountId" TEXT,
    "isDeferredRevenue" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "gl_accounts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "gl_entries" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "journalId" TEXT,
    "accountId" TEXT NOT NULL,
    "debitCents" INTEGER NOT NULL DEFAULT 0,
    "creditCents" INTEGER NOT NULL DEFAULT 0,
    "description" TEXT,
    "postedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "sourceType" TEXT,
    "sourceId" TEXT,

    CONSTRAINT "gl_entries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_logs" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "userId" TEXT,
    "userName" TEXT,
    "recordType" TEXT NOT NULL,
    "recordId" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "changedFieldsJson" JSONB,
    "ipAddress" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cancellation_policies" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "locationId" TEXT,
    "name" TEXT NOT NULL,
    "isWeatherPolicy" BOOLEAN NOT NULL DEFAULT false,
    "rulesJson" JSONB NOT NULL,

    CONSTRAINT "cancellation_policies_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "rental_products" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "locationId" TEXT,
    "boatId" TEXT,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "durationType" TEXT,
    "basePriceCents" INTEGER NOT NULL,
    "floorPriceCents" INTEGER,
    "ceilingPriceCents" INTEGER,
    "damageWaiverCents" INTEGER,
    "depositCents" INTEGER,
    "cancellationPolicyId" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "rental_products_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pricing_rules" (
    "id" TEXT NOT NULL,
    "rentalProductId" TEXT NOT NULL,
    "ruleType" "PricingRuleType" NOT NULL,
    "value" DOUBLE PRECISION NOT NULL,
    "startDate" TIMESTAMP(3),
    "endDate" TIMESTAMP(3),
    "daysJson" JSONB,
    "priority" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "pricing_rules_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pricing_calendar_overrides" (
    "id" TEXT NOT NULL,
    "rentalProductId" TEXT NOT NULL,
    "overrideDate" TIMESTAMP(3) NOT NULL,
    "priceCents" INTEGER NOT NULL,
    "createdBy" TEXT,
    "note" TEXT,

    CONSTRAINT "pricing_calendar_overrides_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "demand_surge_tiers" (
    "id" TEXT NOT NULL,
    "rentalProductId" TEXT NOT NULL,
    "availabilityThresholdPct" DOUBLE PRECISION NOT NULL,
    "multiplier" DOUBLE PRECISION NOT NULL,
    "priority" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "demand_surge_tiers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "algorithmic_suggestions" (
    "id" TEXT NOT NULL,
    "rentalProductId" TEXT NOT NULL,
    "suggestedDate" TIMESTAMP(3) NOT NULL,
    "rulePriceCents" INTEGER NOT NULL,
    "suggestedPriceCents" INTEGER NOT NULL,
    "reason" TEXT,
    "status" "SuggestionStatus" NOT NULL DEFAULT 'PENDING',
    "reviewedBy" TEXT,
    "reviewedAt" TIMESTAMP(3),

    CONSTRAINT "algorithmic_suggestions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "reservations" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "rentalProductId" TEXT NOT NULL,
    "startDt" TIMESTAMP(3) NOT NULL,
    "endDt" TIMESTAMP(3) NOT NULL,
    "totalCents" INTEGER NOT NULL,
    "waiverSelected" BOOLEAN NOT NULL DEFAULT false,
    "depositAuthId" TEXT,
    "status" "ReservationStatus" NOT NULL DEFAULT 'PENDING',
    "cancellationReason" TEXT,
    "refundCents" INTEGER,
    "stripePaymentIntentId" TEXT,
    "priceLockExpiresAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "reservations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "rental_automation_events" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "reservationId" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "eventType" "AutomationEventType" NOT NULL,
    "scheduledAt" TIMESTAMP(3) NOT NULL,
    "sentAt" TIMESTAMP(3),
    "status" TEXT NOT NULL,

    CONSTRAINT "rental_automation_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "nps_surveys" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "reservationId" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "score" INTEGER,
    "comment" TEXT,
    "sentAt" TIMESTAMP(3),
    "respondedAt" TIMESTAMP(3),
    "googlePromptSentAt" TIMESTAMP(3),

    CONSTRAINT "nps_surveys_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "promo_codes" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "discountType" TEXT NOT NULL,
    "discountValue" DOUBLE PRECISION NOT NULL,
    "usageLimit" INTEGER,
    "usedCount" INTEGER NOT NULL DEFAULT 0,
    "validFrom" TIMESTAMP(3),
    "validTo" TIMESTAMP(3),
    "active" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "promo_codes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "transient_bookings" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "slipId" TEXT NOT NULL,
    "guestName" TEXT NOT NULL,
    "guestEmail" TEXT,
    "guestPhone" TEXT,
    "boatName" TEXT,
    "boatLength" DOUBLE PRECISION,
    "checkIn" TIMESTAMP(3) NOT NULL,
    "checkOut" TIMESTAMP(3),
    "rateCents" INTEGER NOT NULL,
    "totalCents" INTEGER NOT NULL,
    "stripePaymentId" TEXT,
    "status" "TransientStatus" NOT NULL DEFAULT 'BOOKED',
    "customerId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "transient_bookings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ramp_tickets" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "locationId" TEXT,
    "customerId" TEXT,
    "guestName" TEXT,
    "licensePlate" TEXT,
    "boatRegistration" TEXT,
    "ticketType" "RampTicketType" NOT NULL,
    "amountCents" INTEGER NOT NULL,
    "paymentMethod" TEXT,
    "stripePaymentId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ramp_tickets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "concierge_requests" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "boatId" TEXT,
    "serviceType" TEXT NOT NULL,
    "preferredDate" TIMESTAMP(3),
    "notes" TEXT,
    "urgency" TEXT,
    "status" "ConciergeStatus" NOT NULL DEFAULT 'SUBMITTED',
    "assignedTo" TEXT,
    "vendorId" TEXT,
    "quoteCents" INTEGER,
    "approvedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "invoiceId" TEXT,

    CONSTRAINT "concierge_requests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "concierge_vendors" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "specialty" TEXT,
    "phone" TEXT,
    "email" TEXT,
    "notes" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "concierge_vendors_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pos_transactions" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "cashierId" TEXT,
    "shiftId" TEXT,
    "subtotalCents" INTEGER NOT NULL,
    "taxCents" INTEGER NOT NULL DEFAULT 0,
    "tipCents" INTEGER NOT NULL DEFAULT 0,
    "totalCents" INTEGER NOT NULL,
    "offlineQueued" BOOLEAN NOT NULL DEFAULT false,
    "syncedAt" TIMESTAMP(3),
    "status" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "pos_transactions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pos_line_items" (
    "id" TEXT NOT NULL,
    "transactionId" TEXT NOT NULL,
    "productId" TEXT,
    "quantity" INTEGER NOT NULL DEFAULT 1,
    "unitPriceCents" INTEGER NOT NULL,
    "discountCents" INTEGER NOT NULL DEFAULT 0,
    "taxCents" INTEGER NOT NULL DEFAULT 0,
    "extendedCents" INTEGER NOT NULL,

    CONSTRAINT "pos_line_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "shifts" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "locationId" TEXT,
    "cashierId" TEXT NOT NULL,
    "openedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "closedAt" TIMESTAMP(3),
    "openingFloatCents" INTEGER NOT NULL,
    "closingCashCents" INTEGER,
    "tipTotalCents" INTEGER NOT NULL DEFAULT 0,
    "status" "ShiftStatus" NOT NULL DEFAULT 'OPEN',

    CONSTRAINT "shifts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "products" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "sku" TEXT,
    "barcode" TEXT,
    "departmentId" TEXT,
    "costCents" INTEGER,
    "priceCents" INTEGER NOT NULL,
    "taxClass" TEXT,
    "trackInventory" BOOLEAN NOT NULL DEFAULT false,
    "reorderQty" INTEGER,

    CONSTRAINT "products_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "inventory" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "locationId" TEXT,
    "qtyOnHand" INTEGER NOT NULL DEFAULT 0,
    "qtyOnOrder" INTEGER NOT NULL DEFAULT 0,
    "lastCountDate" TIMESTAMP(3),

    CONSTRAINT "inventory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "purchase_orders" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "vendorId" TEXT,
    "status" TEXT NOT NULL,
    "expectedDate" TIMESTAMP(3),
    "totalCents" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "purchase_orders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "dock_walks" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "inspectorId" TEXT NOT NULL,
    "dockId" TEXT,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),
    "status" "DockWalkStatus" NOT NULL DEFAULT 'IN_PROGRESS',

    CONSTRAINT "dock_walks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "dock_walk_items" (
    "id" TEXT NOT NULL,
    "dockWalkId" TEXT NOT NULL,
    "slipId" TEXT,
    "status" "DockWalkItemStatus" NOT NULL DEFAULT 'OK',
    "notes" TEXT,
    "violationType" TEXT,
    "photoUrls" JSONB,
    "feeCents" INTEGER,
    "notifiedAt" TIMESTAMP(3),

    CONSTRAINT "dock_walk_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pump_outs" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "slipId" TEXT NOT NULL,
    "staffId" TEXT,
    "eventDate" TIMESTAMP(3) NOT NULL,
    "gallons" DOUBLE PRECISION NOT NULL,
    "feeCents" INTEGER,
    "invoiceLineId" TEXT,

    CONSTRAINT "pump_outs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "insurance_records" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "boatId" TEXT,
    "documentUrl" TEXT,
    "insurer" TEXT,
    "policyNumber" TEXT,
    "startDate" TIMESTAMP(3),
    "expiryDate" TIMESTAMP(3),
    "coverageJson" JSONB,
    "extractionConfidence" TEXT,
    "status" "InsuranceStatus" NOT NULL DEFAULT 'PENDING_REVIEW',

    CONSTRAINT "insurance_records_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "announcements" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "audienceFilter" JSONB,
    "channels" "AnnouncementChannel" NOT NULL DEFAULT 'EMAIL',
    "isEmergency" BOOLEAN NOT NULL DEFAULT false,
    "scheduledAt" TIMESTAMP(3),
    "sentAt" TIMESTAMP(3),
    "staffId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "announcements_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "announcement_deliveries" (
    "id" TEXT NOT NULL,
    "announcementId" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "channel" TEXT NOT NULL,
    "status" "DeliveryStatus" NOT NULL DEFAULT 'PENDING',
    "openedAt" TIMESTAMP(3),

    CONSTRAINT "announcement_deliveries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "communication_preferences" (
    "id" TEXT NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "customer_id" TEXT NOT NULL,
    "channel" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "opted_in" BOOLEAN NOT NULL DEFAULT true,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "communication_preferences_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "api_keys" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "keyHash" TEXT NOT NULL,
    "scope" "ApiKeyScope" NOT NULL,
    "createdBy" TEXT,
    "lastUsedAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),

    CONSTRAINT "api_keys_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "tenants_subdomain_key" ON "tenants"("subdomain");

-- CreateIndex
CREATE INDEX "locations_tenantId_idx" ON "locations"("tenantId");

-- CreateIndex
CREATE INDEX "users_tenantId_idx" ON "users"("tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "lead_forms_embedKey_key" ON "lead_forms"("embedKey");

-- CreateIndex
CREATE INDEX "lead_forms_tenantId_idx" ON "lead_forms"("tenantId");

-- CreateIndex
CREATE INDEX "leads_tenantId_idx" ON "leads"("tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "referral_partners_code_key" ON "referral_partners"("code");

-- CreateIndex
CREATE INDEX "referral_partners_tenantId_idx" ON "referral_partners"("tenantId");

-- CreateIndex
CREATE INDEX "waitlist_entries_tenantId_idx" ON "waitlist_entries"("tenantId");

-- CreateIndex
CREATE INDEX "customers_tenantId_idx" ON "customers"("tenantId");

-- CreateIndex
CREATE INDEX "boats_tenantId_idx" ON "boats"("tenantId");

-- CreateIndex
CREATE INDEX "vessel_safety_records_tenantId_idx" ON "vessel_safety_records"("tenantId");

-- CreateIndex
CREATE INDEX "slips_tenantId_idx" ON "slips"("tenantId");

-- CreateIndex
CREATE INDEX "slip_contracts_tenantId_idx" ON "slip_contracts"("tenantId");

-- CreateIndex
CREATE INDEX "renewal_batches_tenantId_idx" ON "renewal_batches"("tenantId");

-- CreateIndex
CREATE INDEX "meter_readings_tenantId_idx" ON "meter_readings"("tenantId");

-- CreateIndex
CREATE INDEX "invoices_tenantId_idx" ON "invoices"("tenantId");

-- CreateIndex
CREATE INDEX "payments_tenantId_idx" ON "payments"("tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "processed_webhooks_stripeEventId_key" ON "processed_webhooks"("stripeEventId");

-- CreateIndex
CREATE INDEX "ach_returns_tenantId_idx" ON "ach_returns"("tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "chargebacks_stripeDisputeId_key" ON "chargebacks"("stripeDisputeId");

-- CreateIndex
CREATE INDEX "chargebacks_tenantId_idx" ON "chargebacks"("tenantId");

-- CreateIndex
CREATE INDEX "collections_accounts_tenantId_idx" ON "collections_accounts"("tenantId");

-- CreateIndex
CREATE INDEX "deferred_schedules_tenantId_idx" ON "deferred_schedules"("tenantId");

-- CreateIndex
CREATE INDEX "security_deposits_tenantId_idx" ON "security_deposits"("tenantId");

-- CreateIndex
CREATE INDEX "gl_accounts_tenantId_idx" ON "gl_accounts"("tenantId");

-- CreateIndex
CREATE INDEX "gl_entries_tenantId_idx" ON "gl_entries"("tenantId");

-- CreateIndex
CREATE INDEX "audit_logs_tenantId_idx" ON "audit_logs"("tenantId");

-- CreateIndex
CREATE INDEX "audit_logs_recordType_recordId_idx" ON "audit_logs"("recordType", "recordId");

-- CreateIndex
CREATE INDEX "cancellation_policies_tenantId_idx" ON "cancellation_policies"("tenantId");

-- CreateIndex
CREATE INDEX "rental_products_tenantId_idx" ON "rental_products"("tenantId");

-- CreateIndex
CREATE INDEX "reservations_tenantId_idx" ON "reservations"("tenantId");

-- CreateIndex
CREATE INDEX "rental_automation_events_tenantId_idx" ON "rental_automation_events"("tenantId");

-- CreateIndex
CREATE INDEX "nps_surveys_tenantId_idx" ON "nps_surveys"("tenantId");

-- CreateIndex
CREATE INDEX "promo_codes_tenantId_idx" ON "promo_codes"("tenantId");

-- CreateIndex
CREATE INDEX "transient_bookings_tenantId_idx" ON "transient_bookings"("tenantId");

-- CreateIndex
CREATE INDEX "ramp_tickets_tenantId_idx" ON "ramp_tickets"("tenantId");

-- CreateIndex
CREATE INDEX "concierge_requests_tenantId_idx" ON "concierge_requests"("tenantId");

-- CreateIndex
CREATE INDEX "concierge_vendors_tenantId_idx" ON "concierge_vendors"("tenantId");

-- CreateIndex
CREATE INDEX "pos_transactions_tenantId_idx" ON "pos_transactions"("tenantId");

-- CreateIndex
CREATE INDEX "shifts_tenantId_idx" ON "shifts"("tenantId");

-- CreateIndex
CREATE INDEX "products_tenantId_idx" ON "products"("tenantId");

-- CreateIndex
CREATE INDEX "inventory_tenantId_idx" ON "inventory"("tenantId");

-- CreateIndex
CREATE INDEX "purchase_orders_tenantId_idx" ON "purchase_orders"("tenantId");

-- CreateIndex
CREATE INDEX "dock_walks_tenantId_idx" ON "dock_walks"("tenantId");

-- CreateIndex
CREATE INDEX "pump_outs_tenantId_idx" ON "pump_outs"("tenantId");

-- CreateIndex
CREATE INDEX "insurance_records_tenantId_idx" ON "insurance_records"("tenantId");

-- CreateIndex
CREATE INDEX "announcements_tenantId_idx" ON "announcements"("tenantId");

-- CreateIndex
CREATE INDEX "communication_preferences_tenant_id_idx" ON "communication_preferences"("tenant_id");

-- CreateIndex
CREATE INDEX "communication_preferences_customer_id_idx" ON "communication_preferences"("customer_id");

-- CreateIndex
CREATE UNIQUE INDEX "communication_preferences_customer_id_channel_category_key" ON "communication_preferences"("customer_id", "channel", "category");

-- CreateIndex
CREATE INDEX "api_keys_tenantId_idx" ON "api_keys"("tenantId");

-- AddForeignKey
ALTER TABLE "tenants" ADD CONSTRAINT "tenants_saasTierId_fkey" FOREIGN KEY ("saasTierId") REFERENCES "saas_tiers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "locations" ADD CONSTRAINT "locations_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "users" ADD CONSTRAINT "users_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "leads" ADD CONSTRAINT "leads_sourceFormId_fkey" FOREIGN KEY ("sourceFormId") REFERENCES "lead_forms"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "waitlist_entries" ADD CONSTRAINT "waitlist_entries_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "customers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "waitlist_entries" ADD CONSTRAINT "waitlist_entries_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "leads"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "boats" ADD CONSTRAINT "boats_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "customers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vessel_safety_records" ADD CONSTRAINT "vessel_safety_records_boatId_fkey" FOREIGN KEY ("boatId") REFERENCES "boats"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "slip_contracts" ADD CONSTRAINT "slip_contracts_slipId_fkey" FOREIGN KEY ("slipId") REFERENCES "slips"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "slip_contracts" ADD CONSTRAINT "slip_contracts_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "customers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "slip_contracts" ADD CONSTRAINT "slip_contracts_boatId_fkey" FOREIGN KEY ("boatId") REFERENCES "boats"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "slip_contracts" ADD CONSTRAINT "slip_contracts_renewalBatchId_fkey" FOREIGN KEY ("renewalBatchId") REFERENCES "renewal_batches"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "meter_readings" ADD CONSTRAINT "meter_readings_slipId_fkey" FOREIGN KEY ("slipId") REFERENCES "slips"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "customers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoice_line_items" ADD CONSTRAINT "invoice_line_items_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "invoices"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoice_line_items" ADD CONSTRAINT "invoice_line_items_glAccountId_fkey" FOREIGN KEY ("glAccountId") REFERENCES "gl_accounts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "customers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "invoices"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ach_returns" ADD CONSTRAINT "ach_returns_paymentId_fkey" FOREIGN KEY ("paymentId") REFERENCES "payments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ach_returns" ADD CONSTRAINT "ach_returns_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "customers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "chargebacks" ADD CONSTRAINT "chargebacks_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "customers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "collections_accounts" ADD CONSTRAINT "collections_accounts_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "customers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "deferred_schedules" ADD CONSTRAINT "deferred_schedules_invoiceLineItemId_fkey" FOREIGN KEY ("invoiceLineItemId") REFERENCES "invoice_line_items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "deferred_entries" ADD CONSTRAINT "deferred_entries_scheduleId_fkey" FOREIGN KEY ("scheduleId") REFERENCES "deferred_schedules"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "security_deposits" ADD CONSTRAINT "security_deposits_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "customers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "security_deposits" ADD CONSTRAINT "security_deposits_contractId_fkey" FOREIGN KEY ("contractId") REFERENCES "slip_contracts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "gl_entries" ADD CONSTRAINT "gl_entries_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "gl_accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rental_products" ADD CONSTRAINT "rental_products_cancellationPolicyId_fkey" FOREIGN KEY ("cancellationPolicyId") REFERENCES "cancellation_policies"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pricing_rules" ADD CONSTRAINT "pricing_rules_rentalProductId_fkey" FOREIGN KEY ("rentalProductId") REFERENCES "rental_products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pricing_calendar_overrides" ADD CONSTRAINT "pricing_calendar_overrides_rentalProductId_fkey" FOREIGN KEY ("rentalProductId") REFERENCES "rental_products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "demand_surge_tiers" ADD CONSTRAINT "demand_surge_tiers_rentalProductId_fkey" FOREIGN KEY ("rentalProductId") REFERENCES "rental_products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "algorithmic_suggestions" ADD CONSTRAINT "algorithmic_suggestions_rentalProductId_fkey" FOREIGN KEY ("rentalProductId") REFERENCES "rental_products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reservations" ADD CONSTRAINT "reservations_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "customers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reservations" ADD CONSTRAINT "reservations_rentalProductId_fkey" FOREIGN KEY ("rentalProductId") REFERENCES "rental_products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rental_automation_events" ADD CONSTRAINT "rental_automation_events_reservationId_fkey" FOREIGN KEY ("reservationId") REFERENCES "reservations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "nps_surveys" ADD CONSTRAINT "nps_surveys_reservationId_fkey" FOREIGN KEY ("reservationId") REFERENCES "reservations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "nps_surveys" ADD CONSTRAINT "nps_surveys_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "customers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transient_bookings" ADD CONSTRAINT "transient_bookings_slipId_fkey" FOREIGN KEY ("slipId") REFERENCES "slips"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transient_bookings" ADD CONSTRAINT "transient_bookings_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "customers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ramp_tickets" ADD CONSTRAINT "ramp_tickets_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "customers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "concierge_requests" ADD CONSTRAINT "concierge_requests_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "customers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "concierge_requests" ADD CONSTRAINT "concierge_requests_vendorId_fkey" FOREIGN KEY ("vendorId") REFERENCES "concierge_vendors"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pos_transactions" ADD CONSTRAINT "pos_transactions_shiftId_fkey" FOREIGN KEY ("shiftId") REFERENCES "shifts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pos_line_items" ADD CONSTRAINT "pos_line_items_transactionId_fkey" FOREIGN KEY ("transactionId") REFERENCES "pos_transactions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pos_line_items" ADD CONSTRAINT "pos_line_items_productId_fkey" FOREIGN KEY ("productId") REFERENCES "products"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory" ADD CONSTRAINT "inventory_productId_fkey" FOREIGN KEY ("productId") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "dock_walk_items" ADD CONSTRAINT "dock_walk_items_dockWalkId_fkey" FOREIGN KEY ("dockWalkId") REFERENCES "dock_walks"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "dock_walk_items" ADD CONSTRAINT "dock_walk_items_slipId_fkey" FOREIGN KEY ("slipId") REFERENCES "slips"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pump_outs" ADD CONSTRAINT "pump_outs_slipId_fkey" FOREIGN KEY ("slipId") REFERENCES "slips"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "insurance_records" ADD CONSTRAINT "insurance_records_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "customers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "insurance_records" ADD CONSTRAINT "insurance_records_boatId_fkey" FOREIGN KEY ("boatId") REFERENCES "boats"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "announcement_deliveries" ADD CONSTRAINT "announcement_deliveries_announcementId_fkey" FOREIGN KEY ("announcementId") REFERENCES "announcements"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "announcement_deliveries" ADD CONSTRAINT "announcement_deliveries_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "customers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "communication_preferences" ADD CONSTRAINT "communication_preferences_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

