(function () {
  "use strict";

  var ENDPOINT =
    window.NIMT_TRACK_URL ||
    "https://deylhigsisuexszsmypq.supabase.co/functions/v1/track-engagement";
  var ANON_KEY =
    "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImRleWxoaWdzaXN1ZXhzenNteXBxIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NDE0MjA5NDYsImV4cCI6MjA1Njk5Njk0Nn0.mACHO2cTER4TDIhjoWRDmkTvKmB7Tn-J8aQ1MaEBpPM";

  // --- Session ID ---
  var SESSION_KEY = "nimt_session_id";
  function sessionId() {
    var id = sessionStorage.getItem(SESSION_KEY);
    if (!id) {
      id =
        Math.random().toString(36).slice(2) +
        Date.now().toString(36);
      sessionStorage.setItem(SESSION_KEY, id);
    }
    return id;
  }

  // --- Phone from chat widget ---
  function phone() {
    try {
      return localStorage.getItem("nimt_lead_phone") || null;
    } catch (e) {
      return null;
    }
  }

  // --- Send event ---
  function send(event, meta) {
    try {
      var payload = JSON.stringify({
        event_type: event,
        session_id: sessionId(),
        phone: phone(),
        page_url: location.href,
        referrer: document.referrer || null,
        metadata: meta || {},
      });

      var headers = {
        "Content-Type": "application/json",
        apikey: ANON_KEY,
      };

      if (navigator.sendBeacon) {
        var blob = new Blob([payload], { type: "application/json" });
        // sendBeacon doesn't support custom headers, fall back to fetch
        // when we need the apikey header
        fetch(ENDPOINT, {
          method: "POST",
          headers: headers,
          body: payload,
          keepalive: true,
        }).catch(function () {});
      } else {
        var xhr = new XMLHttpRequest();
        xhr.open("POST", ENDPOINT, true);
        xhr.setRequestHeader("Content-Type", "application/json");
        xhr.setRequestHeader("apikey", ANON_KEY);
        xhr.send(payload);
      }
    } catch (e) {
      // fire-and-forget
    }
  }

  // --- Debounced page_view ---
  var lastPageView = "";
  function trackPageView() {
    var key = location.href;
    if (key === lastPageView) return;
    lastPageView = key;
    send("page_view", { title: document.title });
  }

  // --- Element interaction tracking ---
  function isWhatsAppLink(el) {
    if (!el || !el.href) return false;
    return /wa\.me|api\.whatsapp\.com/.test(el.href);
  }

  function isApplyLink(el) {
    if (!el || !el.href) return false;
    return /apply\.nimt\.ac\.in/.test(el.href);
  }

  function closest(el, selector) {
    while (el && el !== document) {
      if (el.matches && el.matches(selector)) return el;
      el = el.parentElement;
    }
    return null;
  }

  function closestAnchor(el) {
    return closest(el, "a[href]");
  }

  // Common chat widget selectors
  var CHAT_SELECTORS = [
    "[data-track='chat-open']",
    ".chat-widget-button",
    ".chat-launcher",
    "#chat-widget-toggle",
    ".open-chat",
  ].join(",");

  function handleClick(e) {
    try {
      var el = e.target;
      var track = closest(el, "[data-track]");

      if (track) {
        var val = track.getAttribute("data-track");
        if (val === "chat-open") return send("chat_open");
        if (val === "navya-click") return send("navya_click");
        if (val === "whatsapp-click") return send("whatsapp_click");
        if (val === "apply-click") return send("apply_click");
        if (val === "form-start") return send("form_start");
      }

      // Chat widget detection
      if (closest(el, CHAT_SELECTORS)) {
        return send("chat_open");
      }

      // Link-based detection
      var anchor = closestAnchor(el) || (el.tagName === "A" ? el : null);
      if (anchor) {
        if (isWhatsAppLink(anchor))
          return send("whatsapp_click", { href: anchor.href });
        if (isApplyLink(anchor))
          return send("apply_click", { href: anchor.href });
      }
    } catch (e) {
      // silent
    }
  }

  // --- Auto-identify from form submissions ---
  function handleFormSubmit(e) {
    try {
      var form = e.target;
      if (!form || form.tagName !== "FORM") return;
      // Look for phone/mobile input fields
      var inputs = form.querySelectorAll(
        "input[name*='phone'], input[name*='mobile'], input[name*='tel'], input[type='tel']"
      );
      for (var i = 0; i < inputs.length; i++) {
        var val = (inputs[i].value || "").trim();
        if (val && val.replace(/\D/g, "").length >= 10) {
          localStorage.setItem("nimt_lead_phone", val);
          send("form_start", { identify: true });
          break;
        }
      }
    } catch (e) {
      // silent
    }
  }

  // --- Init ---
  document.addEventListener("click", handleClick, true);
  document.addEventListener("submit", handleFormSubmit, true);
  trackPageView();

  // SPA navigation support
  var origPush = history.pushState;
  var origReplace = history.replaceState;
  history.pushState = function () {
    origPush.apply(this, arguments);
    trackPageView();
  };
  history.replaceState = function () {
    origReplace.apply(this, arguments);
    trackPageView();
  };
  window.addEventListener("popstate", trackPageView);

  // --- Public API ---
  window.nimtTrack = function (eventType, metadata) {
    try {
      send(eventType, metadata);
    } catch (e) {
      // silent
    }
  };

  // Identify a visitor by phone — links all prior anonymous page views to the lead.
  // Call this after the chat widget collects the phone number:
  //   window.nimtIdentify("9876543210")
  window.nimtIdentify = function (rawPhone) {
    try {
      if (!rawPhone) return;
      var cleaned = rawPhone.replace(/\D/g, "");
      if (cleaned.length < 10) return;
      localStorage.setItem(SESSION_KEY + "_phone", rawPhone);
      localStorage.setItem("nimt_lead_phone", rawPhone);
      // Send an identify event so the server can backfill this session
      send("page_view", { identify: true });
    } catch (e) {
      // silent
    }
  };
})();
