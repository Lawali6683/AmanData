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

export async function onRequestPost(context) {
  const { request, env } = context;
  let createdAuthId = null;
  let baseUrl = "";
  let supabaseKey = "";

  const removeAuthUser = async () => {
    if (!createdAuthId) return;
    try {
      await fetch(`${baseUrl}/auth/v1/admin/users/${createdAuthId}`, {
        method: "DELETE",
        headers: {
          "apikey": supabaseKey,
          "Authorization": `Bearer ${supabaseKey}`
        }
      });
    } catch (e) {}
    createdAuthId = null;
  };

  try {
    let body;
    try {
      body = await request.json();
    } catch (e) {
      return jsonResponse({ success: false, message: "Invalid request." }, 400);
    }

    const {
      fullName,
      email: rawEmail,
      phone,
      pin,
      password,
      referralBy,
      ipAddress,
      location,
      device,
      secureToken
    } = body;

    if (secureToken !== "@haruna66") {
      return jsonResponse({ success: false, message: "Unauthorized gateway access token." }, 401);
    }

    if (!fullName || !rawEmail || !phone || !pin || !password) {
      return jsonResponse({ success: false, message: "Missing required registration credentials." }, 400);
    }

    const email = String(rawEmail).trim().toLowerCase();

    if (String(password).length < 6) {
      return jsonResponse({ success: false, message: "Password must be at least 6 characters." }, 400);
    }

    baseUrl = getBaseUrl(env.SUPABASE_URL);
    supabaseKey = env.SUPABASE_SERVICE_ROLE_KEY;

    if (!supabaseKey) {
      return jsonResponse({ success: false, message: "Server is not configured." }, 500);
    }

    const restUrl = `${baseUrl}/rest/v1/`;

    const checkUserRes = await fetch(`${restUrl}user_profiles?select=id,user_data`, {
      method: "GET",
      headers: {
        "apikey": supabaseKey,
        "Authorization": `Bearer ${supabaseKey}`,
        "Content-Type": "application/json"
      }
    });

    if (checkUserRes.ok) {
      const allProfiles = await checkUserRes.json();
      const emailExists = allProfiles.some(profile =>
        profile.user_data && String(profile.user_data.email || "").trim().toLowerCase() === email
      );

      if (emailExists) {
        return jsonResponse({ success: false, message: "Email address already linked to another profile." }, 400);
      }
    }

    const uniqueId = crypto.randomUUID();

    const authCreateRes = await fetch(`${baseUrl}/auth/v1/admin/users`, {
      method: "POST",
      headers: {
        "apikey": supabaseKey,
        "Authorization": `Bearer ${supabaseKey}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        id: uniqueId,
        email: email,
        password: String(password),
        email_confirm: true,
        user_metadata: {
          full_name: fullName,
          phone_number: phone
        }
      })
    });

    if (!authCreateRes.ok) {
      let authError = null;
      try {
        authError = await authCreateRes.json();
      } catch (e) {}
      const errorText = JSON.stringify(authError || {}).toLowerCase();
      if (authCreateRes.status === 422 || errorText.includes("already") || errorText.includes("exists")) {
        return jsonResponse({ success: false, message: "Email address already linked to another profile." }, 400);
      }
      return jsonResponse({ success: false, message: "Could not create login account. Registration aborted." }, 500);
    }

    const authUser = await authCreateRes.json();
    createdAuthId = authUser && authUser.id ? authUser.id : uniqueId;

    if (createdAuthId !== uniqueId) {
      await removeAuthUser();
      return jsonResponse({ success: false, message: "Account identifier mismatch. Registration aborted." }, 500);
    }

    const generatedRefCode = Math.random().toString(36).substring(2, 8).toUpperCase();
    const generatedRefLink = `https://www.amandata.com.ng/register/ref/${generatedRefCode}`;
    const registrationDate = new Date().toISOString();

    let monnifyAccessToken = null;
    const monnifyAuthBase = btoa(`${env.MONNIFY_API_KEY}:${env.MONNIFY_SECRET_KEY}`);

    try {
      const monnifyAuthRes = await fetch(`${env.MONNIFY_BASE_URL}/api/v1/auth/login`, {
        method: "POST",
        headers: {
          "Authorization": `Basic ${monnifyAuthBase}`,
          "Content-Type": "application/json"
        }
      });
      if (monnifyAuthRes.ok) {
        const authData = await monnifyAuthRes.json();
        monnifyAccessToken = authData.responseBody.accessToken;
      }
    } catch (e) {}

    let virtualAccounts = [];
    if (monnifyAccessToken) {
      try {
        const monnifyAccountRes = await fetch(`${env.MONNIFY_BASE_URL}/api/v2/bank-transfer/reserved-accounts`, {
          method: "POST",
          headers: {
            "Authorization": `Bearer ${monnifyAccessToken}`,
            "Content-Type": "application/json"
          },
          body: JSON.stringify({
            accountReference: uniqueId,
            accountName: fullName,
            currencyCode: "NGN",
            contractCode: env.MONNIFY_CONTRACT_CODE,
            customerEmail: email,
            customerName: fullName,
            getAllAvailableBanks: false,
            preferredBanks: ["035", "50515"]
          })
        });

        if (monnifyAccountRes.ok) {
          const accData = await monnifyAccountRes.json();
          if (accData.requestSuccessful && accData.responseBody) {
            virtualAccounts = accData.responseBody.accounts.map(acc => ({
              bankName: acc.bankName,
              accountNumber: acc.accountNumber,
              accountName: acc.accountName
            }));
          }
        }
      } catch (e) {}
    }

    const finalUserData = {
      full_name: fullName,
      email: email,
      phone_number: phone,
      pin: pin,
      referral_code: generatedRefCode,
      referral_link: generatedRefLink,
      referred_by: referralBy || null,
      register_date: registrationDate,
      ip_address: ipAddress,
      device: device,
      location: location,
      user_balance: "0.00",
      transactions: [],
      virtual_accounts: virtualAccounts
    };

    const insertProfileRes = await fetch(`${restUrl}user_profiles`, {
      method: "POST",
      headers: {
        "apikey": supabaseKey,
        "Authorization": `Bearer ${supabaseKey}`,
        "Content-Type": "application/json",
        "Prefer": "return=minimal"
      },
      body: JSON.stringify({
        id: uniqueId,
        user_data: finalUserData
      })
    });

    if (!insertProfileRes.ok) {
      await removeAuthUser();
      return jsonResponse({ success: false, message: "Database core execution error. Registration aborted." }, 500);
    }

    try {
      context.waitUntil(
        fetch("https://amandata.pages.dev/api/welcome", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ fullName: fullName, email: email })
        }).catch(() => {})
      );
    } catch (e) {}

    return jsonResponse({
      success: true,
      message: "Registration completed successfully.",
      userId: uniqueId
    }, 201);
  } catch (globalError) {
    await removeAuthUser();
    return jsonResponse({ success: false, message: "Critical internal system exception caught." }, 500);
  }
}