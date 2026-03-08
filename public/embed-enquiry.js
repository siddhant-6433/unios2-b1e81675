/**
 * NIMT UniOs — Enquiry Form Embed Script
 * 
 * Usage (paste into Webflow custom code or any HTML page):
 * 
 *   <div id="nimt-enquiry-form"></div>
 *   <script src="https://unios2.lovable.app/embed-enquiry.js"></script>
 * 
 * Options (data attributes on the container div):
 *   data-height="700"  — iframe height in px (default: 750)
 *   data-width="100%"  — iframe width (default: 100%)
 */
(function () {
  var FORM_URL = window.location.origin + "/enquiry?embed=true";

  // Allow overriding the base URL for production
  var script = document.currentScript;
  if (script && script.src) {
    try {
      var scriptUrl = new URL(script.src);
      FORM_URL = scriptUrl.origin + "/enquiry?embed=true";
    } catch (e) {}
  }

  var container =
    document.getElementById("nimt-enquiry-form") ||
    (script && script.parentElement);

  if (!container) {
    console.warn("[NIMT Enquiry] No container found. Add <div id=\"nimt-enquiry-form\"></div> before the script.");
    return;
  }

  var height = container.getAttribute("data-height") || "750";
  var width = container.getAttribute("data-width") || "100%";

  var iframe = document.createElement("iframe");
  iframe.src = FORM_URL;
  iframe.style.width = width;
  iframe.style.height = height + "px";
  iframe.style.border = "none";
  iframe.style.borderRadius = "12px";
  iframe.style.overflow = "hidden";
  iframe.setAttribute("loading", "lazy");
  iframe.setAttribute("allow", "clipboard-write");
  iframe.setAttribute("title", "NIMT Admission Enquiry Form");

  container.appendChild(iframe);

  // Auto-resize: listen for height messages from the form
  window.addEventListener("message", function (event) {
    if (event.data && event.data.type === "nimt-enquiry-resize") {
      iframe.style.height = event.data.height + "px";
    }
  });
})();
