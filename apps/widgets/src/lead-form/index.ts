import React from "react";
import ReactDOM from "react-dom/client";
import LeadFormWidget from "./LeadFormWidget";

/**
 * Auto-mount the Helm Lead Form widget on every element with the
 * `data-helm-lead-form` attribute.
 *
 * Usage (on the marina's website):
 * ```html
 * <div
 *   data-helm-lead-form
 *   data-helm-tenant-id="marina_123"
 *   data-helm-form-id="form_abc"
 *   data-helm-form-type="slip-inquiry"
 *   data-helm-primary-color="#00bcd4"
 * ></div>
 * <script src="https://cdn.helm.com/widgets/lead-form.es.js" defer></script>
 * ```
 */
function mountAll() {
  const targets = document.querySelectorAll<HTMLElement>(
    "[data-helm-lead-form]"
  );

  targets.forEach((el) => {
    // Avoid double-mounting
    if (el.dataset.helmMounted === "true") return;
    el.dataset.helmMounted = "true";

    const tenantId = el.dataset.helmTenantId ?? "";
    const formId = el.dataset.helmFormId ?? "";
    const formType = (el.dataset.helmFormType ?? "general") as
      | "slip-inquiry"
      | "rental-inquiry"
      | "waitlist"
      | "general";
    const primaryColor = el.dataset.helmPrimaryColor;

    const root = ReactDOM.createRoot(el);
    root.render(
      React.createElement(LeadFormWidget, {
        tenantId,
        formId,
        formType,
        primaryColor,
        hostElement: el,
      })
    );
  });
}

// Mount immediately if DOM is ready, otherwise wait
if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", mountAll);
} else {
  mountAll();
}

export { LeadFormWidget };
export default mountAll;
