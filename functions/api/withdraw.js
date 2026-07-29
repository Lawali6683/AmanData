export default {
  async fetch(request, env) {
    if (request.method !== "POST") {
      return new Response(JSON.stringify({ success: false, message: "Method Not Allowed" }), { status: 405, headers: { "Content-Type": "application/json" } });
    }

    try {
      const body = await request.json();
      const { action, req_pass, uuid, amount, bank_code, bank_name, account_number } = body;

      if (req_pass !== "@haruna66") {
        return new Response(JSON.stringify({ success: false, message: "Unauthorized Access" }), { status: 401, headers: { "Content-Type": "application/json" } });
      }

      if (action === "verify_account") {
        const secret = btoa(`${env.MONNIFY_API_KEY}:${env.MONNIFY_SECRET_KEY}`);
        const authRes = await fetch(`${env.MONNIFY_BASE_URL}/api/v1/auth/login`, {
          method: "POST",
          headers: { "Authorization": `Basic ${secret}` }
        });
        const authData = await authRes.json();
        const token = authData.responseBody.accessToken;

        const verifyUrl = `${env.MONNIFY_BASE_URL}/api/v1/disbursements/account/validate?accountNumber=${account_number}&bankCode=${bank_code}`;
        const monnifyRes = await fetch(verifyUrl, {
          method: "GET",
          headers: { "Authorization": `Bearer ${token}` }
        });
        const monnifyData = await monnifyRes.json();

        if (monnifyData.requestSuccessful && monnifyData.responseBody) {
          return new Response(JSON.stringify({ success: true, account_name: monnifyData.responseBody.accountName }), { headers: { "Content-Type": "application/json" } });
        } else {
          return new Response(JSON.stringify({ success: false, message: "Invalid Account Details" }), { headers: { "Content-Type": "application/json" } });
        }
      }

      if (action === "payout") {
        if (!uuid || !amount || amount <= 0 || !account_number) {
          return new Response(JSON.stringify({ success: false, message: "Bad Parameters" }), { status: 400, headers: { "Content-Type": "application/json" } });
        }

        const lockKey = `lock:${uuid}`;
        if (env.LOCK_KV) {
          const isLocked = await env.LOCK_KV.get(lockKey);
          if (isLocked) {
            return new Response(JSON.stringify({ success: false, message: "Duplicate transaction pending" }), { headers: { "Content-Type": "application/json" } });
          }
          await env.LOCK_KV.put(lockKey, "true", { expirationTtl: 60 });
        }

        const supabaseUrl = env.SUPABASE_URL;
        const supabaseKey = env.SUPABASE_SERVICE_ROLE_KEY;

        const userRes = await fetch(`${supabaseUrl}profiles?id=eq.${uuid}`, {
          method: "GET",
          headers: { "apikey": supabaseKey, "Authorization": `Bearer ${supabaseKey}` }
        });
        const userData = await userRes.json();

        if (!userData || userData.length === 0) {
          if (env.LOCK_KV) await env.LOCK_KV.delete(lockKey);
          return new Response(JSON.stringify({ success: false, message: "User profile not found" }), { headers: { "Content-Type": "application/json" } });
        }

        const currentBalance = parseFloat(userData[0].balance || 0);
        if (currentBalance < amount) {
          if (env.LOCK_KV) await env.LOCK_KV.delete(lockKey);
          return new Response(JSON.stringify({ success: false, message: "Insolvent balance logged" }), { headers: { "Content-Type": "application/json" } });
        }

        const gasFee = amount * 0.03;
        const netPayout = amount - gasFee;
        const referenceId = `PD-PAY-${Date.now()}-${Math.floor(Math.random() * 1000)}`;

        const newBalance = currentBalance - amount;
        const updateRes = await fetch(`${supabaseUrl}profiles?id=eq.${uuid}`, {
          method: "PATCH",
          headers: { "apikey": supabaseKey, "Authorization": `Bearer ${supabaseKey}`, "Content-Type": "application/json" },
          body: JSON.stringify({ balance: newBalance })
        });

        if (!updateRes.ok) {
          if (env.LOCK_KV) await env.LOCK_KV.delete(lockKey);
          return new Response(JSON.stringify({ success: false, message: "Reconciliation failed" }), { headers: { "Content-Type": "application/json" } });
        }

        const secret = btoa(`${env.MONNIFY_API_KEY}:${env.MONNIFY_SECRET_KEY}`);
        const authRes = await fetch(`${env.MONNIFY_BASE_URL}/api/v1/auth/login`, {
          method: "POST",
          headers: { "Authorization": `Basic ${secret}` }
        });
        const authData = await authRes.json();
        const token = authData.responseBody.accessToken;

        const payoutPayload = {
          amount: netPayout,
          reference: referenceId,
          narration: "AmanData Secure Wallet Payout",
          destinationBankCode: bank_code,
          destinationAccountNumber: account_number,
          currency: "NGN",
          sourceAccountNumber: env.MONNIFY_CONTRACT_CODE
        };

        const monnifyPayRes = await fetch(`${env.MONNIFY_BASE_URL}/api/v1/disbursements/single`, {
          method: "POST",
          headers: { "Authorization": `Bearer ${token}`, "Content-Type": "application/json" },
          body: JSON.stringify(payoutPayload)
        });

        const monnifyPayData = await monnifyPayRes.json();

        if (monnifyPayData.requestSuccessful) {
          if (env.LOCK_KV) await env.LOCK_KV.delete(lockKey);
          return new Response(JSON.stringify({ success: true, message: "Disbursement completed", ref: referenceId }), { headers: { "Content-Type": "application/json" } });
        } else {
          await fetch(`${supabaseUrl}profiles?id=eq.${uuid}`, {
            method: "PATCH",
            headers: { "apikey": supabaseKey, "Authorization": `Bearer ${supabaseKey}`, "Content-Type": "application/json" },
            body: JSON.stringify({ balance: currentBalance })
          });
          if (env.LOCK_KV) await env.LOCK_KV.delete(lockKey);
          return new Response(JSON.stringify({ success: false, message: "Gateway Decline" }), { headers: { "Content-Type": "application/json" } });
        }
      }

    } catch (err) {
      return new Response(JSON.stringify({ success: false, message: "Internal server error" }), { status: 500, headers: { "Content-Type": "application/json" } });
    }
  }
};
