export interface RazorpayOrder {
  order_id: string;
  amount: number;
  currency: string;
  key_id: string;
}

export interface RazorpayCheckoutResponse {
  razorpay_order_id: string;
  razorpay_payment_id: string;
  razorpay_signature: string;
}

interface RazorpayCheckoutOptions {
  key: string;
  amount: number;
  currency: string;
  name: string;
  description: string;
  order_id: string;
  prefill?: {
    name?: string;
    email?: string;
    contact?: string;
  };
  notes?: Record<string, string>;
  theme?: {
    color?: string;
  };
  handler: (response: RazorpayCheckoutResponse) => void;
  modal?: {
    ondismiss?: () => void;
  };
}

declare global {
  interface Window {
    Razorpay?: new (options: RazorpayCheckoutOptions) => {
      open: () => void;
      on: (event: string, callback: (response: unknown) => void) => void;
    };
  }
}

let checkoutScriptPromise: Promise<void> | null = null;

export function loadRazorpayCheckout(): Promise<void> {
  if (window.Razorpay) return Promise.resolve();
  if (checkoutScriptPromise) return checkoutScriptPromise;

  checkoutScriptPromise = new Promise((resolve, reject) => {
    const existing = document.getElementById("razorpay-checkout-js") as HTMLScriptElement | null;
    if (existing) {
      existing.addEventListener("load", () => resolve(), { once: true });
      existing.addEventListener("error", () => reject(new Error("Could not load Razorpay Checkout")), { once: true });
      return;
    }

    const script = document.createElement("script");
    script.id = "razorpay-checkout-js";
    script.src = "https://checkout.razorpay.com/v1/checkout.js";
    script.async = true;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error("Could not load Razorpay Checkout"));
    document.body.appendChild(script);
  });

  return checkoutScriptPromise;
}

export async function openRazorpayCheckout(args: {
  order: RazorpayOrder;
  name: string;
  description: string;
  customerName?: string;
  customerEmail?: string;
  customerPhone?: string;
  notes?: Record<string, string>;
}): Promise<RazorpayCheckoutResponse> {
  await loadRazorpayCheckout();
  if (!window.Razorpay) throw new Error("Razorpay Checkout is unavailable");

  return new Promise((resolve, reject) => {
    const checkout = new window.Razorpay({
      key: args.order.key_id,
      amount: args.order.amount,
      currency: args.order.currency,
      name: args.name,
      description: args.description,
      order_id: args.order.order_id,
      prefill: {
        name: args.customerName,
        email: args.customerEmail,
        contact: args.customerPhone,
      },
      notes: args.notes,
      theme: { color: "#0f766e" },
      handler: resolve,
      modal: {
        ondismiss: () => reject(new Error("Payment window was closed.")),
      },
    });

    checkout.on("payment.failed", (response) => {
      const error = response && typeof response === "object" && "error" in response
        ? (response as { error?: { description?: string } }).error
        : undefined;
      reject(new Error(error?.description || "Payment failed. Please try again."));
    });
    checkout.open();
  });
}
