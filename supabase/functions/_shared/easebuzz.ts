// Shared EaseBuzz read-API helpers (single-txn retrieve + success test).
// Extracted from easebuzz-payment so the reconcile cron reuses the exact,
// hard-won retrieve logic (host fallback, `msg` vs `data`, non-JSON handling)
// instead of drifting a second copy.

export async function sha512(message: string): Promise<string> {
  const msgBuffer = new TextEncoder().encode(message);
  const hashBuffer = await crypto.subtle.digest("SHA-512", msgBuffer);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");
}

export function easebuzzAmount(txn: any): number {
  return Number(txn?.amount ?? txn?.total_debit_amount ?? txn?.net_debit_amount ?? 0);
}

/** Retrieve hosts for the given env (single-txn retrieve is served by dashboard.*). */
export function easebuzzRetrieveHosts(env: string): string[] {
  return env === "test"
    ? ["https://testdashboard.easebuzz.in", "https://testpay.easebuzz.in"]
    : ["https://dashboard.easebuzz.in", "https://pay.easebuzz.in"];
}

/**
 * Single-transaction lookup: POST /transaction/v2/retrieve, hash SHA512(key|txnid|salt).
 *
 * Which host serves this differs between EaseBuzz plans — `pay.easebuzz.in`
 * has been returning an HTML page, which blows up as "Unexpected token '<'".
 * Try each host and take the first that answers with JSON.
 */
export async function easebuzzRetrieveTxn(
  txnid: string,
  cfg: { merchantKey: string; merchantSalt: string; hosts: string[] },
): Promise<{ txn: any | null; error?: string; nonJson?: string; raw?: any }> {
  const hash = await sha512(`${cfg.merchantKey}|${txnid}|${cfg.merchantSalt}`);
  let lastNonJson: string | undefined;
  let lastError: string | undefined;
  for (const host of cfg.hosts) {
    let raw = "";
    try {
      const res = await fetch(`${host}/transaction/v2/retrieve`, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ key: cfg.merchantKey, txnid, hash }).toString(),
      });
      raw = await res.text();
    } catch (e) {
      lastError = String(e);
      continue;
    }
    let parsed: any;
    try { parsed = JSON.parse(raw); } catch {
      lastNonJson = raw.slice(0, 200);
      console.error(`[easebuzz] retrieve ${host} returned non-JSON: ${lastNonJson}`);
      continue;
    }
    if (parsed?.status === 1 || parsed?.status === true) {
      // dashboard.easebuzz.in returns the txn under `msg`; the PHP SDK's wrapper
      // documents `data`. Accept either — reading only `data` made every
      // successful lookup look like "no such transaction".
      const payload = parsed.msg ?? parsed.data;
      const txn = Array.isArray(payload) ? payload[0] : payload;
      // status:1 with an empty payload means "we have no such txnid", not success.
      if (txn && typeof txn === "object") return { txn, raw: parsed };
      return { txn: null, error: "eb_no_data", raw: parsed };
    }
    return { txn: null, error: parsed?.error_desc || parsed?.message || `eb_status_${parsed?.status}`, raw: parsed };
  }
  return { txn: null, error: lastError || "EaseBuzz retrieve returned no JSON from any host", nonJson: lastNonJson };
}

/** EaseBuzz statuses that mean "the money is ours". */
export function isEasebuzzSuccess(txn: any): boolean {
  const st = String(txn?.status || txn?.txn_status || "").toLowerCase();
  return st === "success" || st === "settled" || st === "captured";
}
