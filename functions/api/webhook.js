const jsonResponse = (data, status) =>
  new Response(JSON.stringify(data), {
    status: status,
    headers: { "Content-Type": "application/json" }
  });

const getBaseUrl = (value) => {
  let base = (value || "https://pzyxknmysydjbszumptt.supabase.co").trim();
  base = base.replace(/\/+$/, "").replace(/\/rest\/v1$/, "").replace(/\/+$/, "");
  return base;
};

const safeEqual = (a, b) => {
  if (typeof a !== "string" || typeof b !== "string" || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
};

export default {
  async fetch(request, env) {
    if (request.method !== "POST") {
      return new Response("Method Not Allowed", { status: 405 });
    }

    const PAYSTACK_SECRET = env.PAYSTACK_API_KEY;
    const SUPABASE_URL = getBaseUrl(env.SUPABASE_URL);
    const SERVICE_KEY = env.SUPABASE_SERVICE_ROLE_KEY;

    if (!PAYSTACK_SECRET || !SERVICE_KEY) {
      return jsonResponse({ success: false, message: "Server is not configured." }, 500);
    }

    const signature = request.headers.get("x-paystack-signature");
    if (!signature) {
      return new Response("Unauthorized: Missing Signature", { status: 401 });
    }

    const rawBody = await request.text();

    const encoder = new TextEncoder();
    const cryptoKey = await crypto.subtle.importKey(
      "raw",
      encoder.encode(PAYSTACK_SECRET),
      { name: "HMAC", hash: "SHA-512" },
      false,
      ["sign"]
    );
    const signatureBuffer = await crypto.subtle.sign("HMAC", cryptoKey, encoder.encode(rawBody));
    const computedSignature = Array.from(new Uint8Array(signatureBuffer))
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");

    if (!safeEqual(computedSignature, signature.trim().toLowerCase())) {
      return new Response("Unauthorized: Invalid Signature", { status: 401 });
    }

    let payload;
    try {
      payload = JSON.parse(rawBody);
    } catch (e) {
      return new Response("Bad Request: Invalid JSON", { status: 400 });
    }

    if (payload.event !== "charge.success") {
      return new Response("Event ignored", { status: 200 });
    }

    const eventData = payload.data || {};
    const reference = eventData.reference ? String(eventData.reference) : "";

    if (!reference) {
      return new Response("Bad Request: Missing reference", { status: 400 });
    }

    if (eventData.channel !== "dedicated_nuban") {
      return new Response("Event ignored: not a virtual account transfer", { status: 200 });
    }

    const sbHeaders = {
      "apikey": SERVICE_KEY,
      "Authorization": `Bearer ${SERVICE_KEY}`,
      "Content-Type": "application/json"
    };

    let email = eventData.customer && eventData.customer.email
      ? String(eventData.customer.email).trim().toLowerCase()
      : "";
    let amountNaira = Number(eventData.amount) / 100;

    const logFailed = async (reason) => {
      try {
        await fetch(`${SUPABASE_URL}/rest/v1/failed_webhooks`, {
          method: "POST",
          headers: { ...sbHeaders, "Prefer": "return=minimal" },
          body: JSON.stringify({
            email: email,
            amount: isNaN(amountNaira) ? 0 : amountNaira,
            reference: reference,
            raw_payload: payload,
            reason: reason,
            created_at: new Date().toISOString()
          })
        });
      } catch (e) {}
    };

    try {
      const verifyRes = await fetch(
        `https://api.paystack.co/transaction/verify/${encodeURIComponent(reference)}`,
        {
          method: "GET",
          headers: { "Authorization": `Bearer ${PAYSTACK_SECRET}` }
        }
      );

      let verifyJson = null;
      try {
        verifyJson = await verifyRes.json();
      } catch (e) {}

      if (!verifyRes.ok || !verifyJson || verifyJson.status !== true || !verifyJson.data) {
        throw new Error(
          (verifyJson && verifyJson.message) ? `Paystack verify failed: ${verifyJson.message}` : "Paystack verify failed"
        );
      }

      const verified = verifyJson.data;

      if (verified.status !== "success") {
        return new Response("Transaction not successful, ignored", { status: 200 });
      }

      if (verified.currency && verified.currency !== "NGN") {
        await logFailed("Unsupported currency: " + verified.currency);
        return new Response("Unsupported currency, logged", { status: 200 });
      }

      const grossKobo = Number(verified.amount);
      if (!Number.isInteger(grossKobo) || grossKobo <= 0) {
        await logFailed("Invalid verified amount");
        return new Response("Invalid Amount", { status: 400 });
      }

      const feeKobo = Math.round(grossKobo / 100);
      const netKobo = grossKobo - feeKobo;

      if (netKobo <= 0) {
        await logFailed("Net amount after fee is not positive");
        return new Response("Amount too small, logged", { status: 200 });
      }

      const grossNaira = grossKobo / 100;
      const feeNaira = feeKobo / 100;
      const netNaira = netKobo / 100;
      amountNaira = grossNaira;

      email = verified.customer && verified.customer.email
        ? String(verified.customer.email).trim().toLowerCase()
        : email;

      if (!email) {
        await logFailed("No customer email on transaction");
        return new Response("No email, logged to failed_webhooks", { status: 200 });
      }

      const lookupSelect = "select=id,user_data";
      let profiles = [];

      const exactRes = await fetch(
        `${SUPABASE_URL}/rest/v1/user_profiles?${lookupSelect}&user_data->>email=eq.${encodeURIComponent(email)}&limit=2`,
        { method: "GET", headers: sbHeaders }
      );
      if (!exactRes.ok) {
        throw new Error("Failed to look up user profile");
      }
      profiles = await exactRes.json();

      if (!Array.isArray(profiles) || profiles.length === 0) {
        const looseRes = await fetch(
          `${SUPABASE_URL}/rest/v1/user_profiles?${lookupSelect}&user_data->>email=ilike.${encodeURIComponent(email)}&limit=5`,
          { method: "GET", headers: sbHeaders }
        );
        if (!looseRes.ok) {
          throw new Error("Failed to look up user profile (case-insensitive)");
        }
        const looseProfiles = await looseRes.json();
        profiles = (Array.isArray(looseProfiles) ? looseProfiles : []).filter(
          (p) =>
            p.user_data &&
            p.user_data.email &&
            String(p.user_data.email).trim().toLowerCase() === email
        );
      }

      if (profiles.length === 0) {
        await logFailed("User email not found in database");
        return new Response("User not found, logged to failed_webhooks", { status: 200 });
      }

      if (profiles.length > 1) {
        await logFailed("More than one profile matches this email");
        return new Response("Ambiguous user, logged to failed_webhooks", { status: 200 });
      }

      const userId = profiles[0].id;

      const rpcRes = await fetch(`${SUPABASE_URL}/rest/v1/rpc/credit_wallet`, {
        method: "POST",
        headers: sbHeaders,
        body: JSON.stringify({
          p_user_id: userId,
          p_email: email,
          p_reference: reference,
          p_gross: grossNaira,
          p_fee: feeNaira,
          p_net: netNaira
        })
      });

      if (!rpcRes.ok) {
        let rpcError = "";
        try {
          rpcError = await rpcRes.text();
        } catch (e) {}
        throw new Error("Wallet credit failed: " + rpcError);
      }

      let result = "";
      try {
        result = await rpcRes.json();
      } catch (e) {}

      if (result === "duplicate") {
        return new Response("Transaction already processed", { status: 200 });
      }

      return new Response("Webhook processed successfully", { status: 200 });
    } catch (error) {
      const message = error && error.message ? error.message : "System runtime execution crash";
      await logFailed(message);
      return jsonResponse({ success: false, message: message }, 500);
    }
  }
};
