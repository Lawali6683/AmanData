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

const PAYSTACK_BASE_URL = "https://api.paystack.co";

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

  const removeProfileRow = async (id) => {
    try {
      await fetch(`${baseUrl}/rest/v1/user_profiles?id=eq.${encodeURIComponent(id)}`, {
        method: "DELETE",
        headers: {
          "apikey": supabaseKey,
          "Authorization": `Bearer ${supabaseKey}`
        }
      });
    } catch (e) {}
  };

  const paystackCall = async (path, method, payload) => {
    const res = await fetch(`${PAYSTACK_BASE_URL}${path}`, {
      method: method,
      headers: {
        "Authorization": `Bearer ${env.PAYSTACK_API_KEY}`,
        "Content-Type": "application/json"
      },
      body: payload ? JSON.stringify(payload) : undefined
    });
    let data = null;
    try {
      data = await res.json();
    } catch (e) {}
    return {
      ok: res.ok && !!data && data.status === true,
      data: data,
      httpStatus: res.status
    };
  };

  const paystackMessage = (result, fallback) => {
    if (result && result.data && result.data.message) return String(result.data.message);
    return fallback;
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
    const passwordText = String(password);

    if (passwordText.length < 6) {
      return jsonResponse({ success: false, message: "Password must be at least 6 characters." }, 400);
    }

    baseUrl = getBaseUrl(env.SUPABASE_URL);
    supabaseKey = env.SUPABASE_SERVICE_ROLE_KEY;

    if (!supabaseKey || !env.PAYSTACK_API_KEY) {
      return jsonResponse({ success: false, message: "Server is not configured." }, 500);
    }

    const restUrl = `${baseUrl}/rest/v1/`;

    try {
      const checkUserRes = await fetch(
        `${restUrl}user_profiles?select=id&user_data->>email=eq.${encodeURIComponent(email)}&limit=1`,
        {
          method: "GET",
          headers: {
            "apikey": supabaseKey,
            "Authorization": `Bearer ${supabaseKey}`,
            "Content-Type": "application/json"
          }
        }
      );

      if (checkUserRes.ok) {
        const matchedProfiles = await checkUserRes.json();
        if (Array.isArray(matchedProfiles) && matchedProfiles.length > 0) {
          return jsonResponse({ success: false, message: "Email address already linked to another profile." }, 400);
        }
      }
    } catch (e) {}

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
        password: passwordText,
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
      if (errorText.includes("weak") || errorText.includes("password")) {
        return jsonResponse({ success: false, message: "Password is too weak. Use a stronger password." }, 400);
      }
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

    let verifyStatus = 0;
    let verifyText = "";
    try {
      const verifyRes = await fetch(`${baseUrl}/auth/v1/token?grant_type=password`, {
        method: "POST",
        headers: {
          "apikey": supabaseKey,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({ email: email, password: passwordText })
      });
      verifyStatus = verifyRes.status;
      if (!verifyRes.ok) {
        verifyText = (await verifyRes.text()).toLowerCase();
      }
    } catch (e) {}

    if (verifyStatus === 400 && verifyText.includes("invalid")) {
      await removeAuthUser();
      return jsonResponse({ success: false, message: "Login account could not be verified. Registration aborted." }, 500);
    }

    const generatedRefCode = Math.random().toString(36).substring(2, 8).toUpperCase();
    const generatedRefLink = `https://www.amandata.com.ng/register/ref/${generatedRefCode}`;
    const registrationDate = new Date().toISOString();

    const nameParts = String(fullName).trim().split(/\s+/);
    const firstName = nameParts[0];
    const lastName = nameParts.length > 1 ? nameParts.slice(1).join(" ") : nameParts[0];

    let virtualAccounts = [];
    let paystackError = null;

    try {
      const customerRes = await paystackCall("/customer", "POST", {
        email: email,
        first_name: firstName,
        last_name: lastName,
        phone: String(phone).trim()
      });

      if (!customerRes.ok || !customerRes.data.data || !customerRes.data.data.customer_code) {
        paystackError = paystackMessage(customerRes, "Paystack could not create the customer.");
      } else {
        const customerCode = customerRes.data.data.customer_code;
        let dva = null;

        const existingRes = await paystackCall(`/customer/${encodeURIComponent(customerCode)}`, "GET");
        if (
          existingRes.ok &&
          existingRes.data.data &&
          existingRes.data.data.dedicated_account &&
          existingRes.data.data.dedicated_account.account_number
        ) {
          dva = existingRes.data.data.dedicated_account;
        }

        if (!dva) {
          const dvaRes = await paystackCall("/dedicated_account", "POST", {
            customer: customerCode,
            preferred_bank: "wema-bank"
          });

          if (!dvaRes.ok) {
            paystackError = paystackMessage(dvaRes, "Paystack could not create the virtual account.");
          } else if (dvaRes.data.data && dvaRes.data.data.account_number) {
            dva = dvaRes.data.data;
          } else {
            paystackError = paystackMessage(dvaRes, "Paystack did not return an account number.");
          }
        }

        if (!paystackError && dva && dva.account_number) {
          virtualAccounts = [
            {
              bankName: (dva.bank && dva.bank.name) ? dva.bank.name : "Wema Bank",
              accountNumber: String(dva.account_number),
              accountName: dva.account_name || `AmanData ${fullName}`
            }
          ];
        } else if (!paystackError) {
          paystackError = "Paystack did not return an account number.";
        }
      }
    } catch (e) {
      paystackError = "Could not reach Paystack. Registration aborted.";
    }

    if (paystackError || virtualAccounts.length === 0) {
      await removeAuthUser();
      return jsonResponse({ success: false, message: paystackError || "Virtual account could not be created. Registration aborted." }, 502);
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
      await removeProfileRow(uniqueId);
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

    let authHost = "";
    try {
      authHost = new URL(baseUrl).host;
    } catch (e) {}

    return jsonResponse({
      success: true,
      message: "Registration completed successfully.",
      userId: uniqueId,
      authHost: authHost
    }, 201);
  } catch (globalError) {
    await removeAuthUser();
    return jsonResponse({ success: false, message: "Critical internal system exception caught." }, 500);
  }
}
