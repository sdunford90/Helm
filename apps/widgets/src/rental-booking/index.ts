import React from "react";
import ReactDOM from "react-dom/client";
import RentalBookingWidget from "./RentalBookingWidget";

/**
 * Auto-mount the Helm Rental Booking widget on every element with the
 * `data-helm-rental-booking` attribute.
 *
 * Usage:
 * ```html
 * <div
 *   data-helm-rental-booking
 *   data-helm-tenant-id="marina_123"
 *   data-helm-primary-color="#00bcd4"
 * ></div>
 * <script src="https://cdn.helm.com/widgets/rental-booking.es.js" defer></script>
 * ```
 */
function mountAll() {
  const targets = document.querySelectorAll<HTMLElement>(
    "[data-helm-rental-booking]"
  );

  targets.forEach((el) => {
    if (el.dataset.helmMounted === "true") return;
    el.dataset.helmMounted = "true";

    const tenantId = el.dataset.helmTenantId ?? "";
    const primaryColor = el.dataset.helmPrimaryColor;

    const root = ReactDOM.createRoot(el);
    root.render(
      React.createElement(RentalBookingWidget, {
        tenantId,
        primaryColor,
        hostElement: el,
      })
    );
  });
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", mountAll);
} else {
  mountAll();
}

export { RentalBookingWidget };
export default mountAll;
