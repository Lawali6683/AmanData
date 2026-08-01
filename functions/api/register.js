export async function onRequestPost(context) {
  const { request, env } = context;

  try {
    const body = await request.json();
    const { 
      fullName, 
      email, 
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
      return new Response(JSON.stringify({ success: false, message: "Unauthorized gateway access token configuration." }), {
        status: 401,
        headers: { "Content-Type": "application/json" }
      });
    }

    if (!fullName || !email || !phone || !pin || !password) {
      return new Response(JSON.stringify({ success: false, message: "Missing required profile registration details." }), {
        status: 400,
        headers: { "Content-Type": "application/json" }
      });
    }

    const supabaseUrl = env.SUPABASE_URL || "https://pzyxknmysydjbszumptt.supabase.co/rest/v1/";
    const supabaseKey = env.SUPABASE_SERVICE_ROLE_KEY;

    const checkUserRes = await fetch(`${supabaseUrl}user_profiles?select=id,user_data`, {
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
        profile.user_data && (profile.user_data.email?.toLowerCase() === email.toLowerCase())
      );
      
      if (emailExists) {
        return new Response(JSON.stringify({ success: false, message: "This email address is already registered to another account." }), {
          status: 400,
          headers: { "Content-Type": "application/json" }
        });
      }
    } else {
      return new Response(JSON.stringify({ success: false, message: "Failed to verify existing records from system database." }), {
        status: 500,
        headers: { "Content-Type": "application/json" }
      });
    }

    const uniqueId = crypto.randomUUID();
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
      password: password,
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

    const insertProfileRes = await fetch(`${supabaseUrl}user_profiles`, {
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
      return new Response(JSON.stringify({ success: false, message: "Database infrastructure failure during profile generation." }), {
        status: 500,
        headers: { "Content-Type": "application/json" }
      });
    }

    try {
      context.waitUntil(
        fetch("https://amandata.pages.dev/api/welcome", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ fullName: fullName, email: email })
        }).catch(() => {})
      );
    } catch(e) {}

    return new Response(JSON.stringify({ 
      success: true, 
      message: "Registration completed successfully.", 
      userId: uniqueId 
    }), {
      status: 201,
      headers: { "Content-Type": "application/json" }
    });

  } catch (globalError) {
    return new Response(JSON.stringify({ success: false, message: "An internal core pipeline error occurred on the server." }), {
      status: 500,
      headers: { "Content-Type": "application/json" }
    });
  }
}
