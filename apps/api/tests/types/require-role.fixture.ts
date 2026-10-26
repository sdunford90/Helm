// Compile-time fixture (checked by tests/middleware/auth.test.ts via tsc).
// If requireRole ever accepts plain strings again, the @ts-expect-error lines
// become unused and tsc fails with TS2578.
import { requireRole, MANAGER_ROLES, FINANCE_ROLES } from "../../src/middleware/auth.js";

requireRole("MARINA_OWNER", "MARINA_MANAGER", "ACCOUNTING", "PLATFORM_ADMIN");
requireRole(...MANAGER_ROLES);
requireRole(...FINANCE_ROLES);

// @ts-expect-error lowercase "admin" is not a UserRole
requireRole("admin");
// @ts-expect-error lowercase "manager" is not a UserRole
requireRole("MARINA_OWNER", "manager");
// @ts-expect-error lowercase "accounting" is not a UserRole
requireRole("accounting");
