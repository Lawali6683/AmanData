export default {
    async fetch(request, env) {
        if (request.method !== "POST") {
            return new Response("Method Not Allowed", { status: 405 });
        }

        const MONNIFY_SECRET_KEY = env.MONNIFY_SECRET_KEY || "@haruna66_monnify_secret";
        const SUPABASE_URL = "https://pzyxknmysydjbszumptt.supabase.co";
        const SUPABASE_SERVICE_ROLE_KEY = env.SUPABASE_SERVICE_ROLE_KEY;

        const signature = request.headers.get("monnify-signature");
        if (!signature) {
            return new Response("Unauthorized: Missing Signature", { status: 401 });
        }

        const rawBody = await request.text();

        const encoder = new TextEncoder();
        const keyData = encoder.encode(MONNIFY_SECRET_KEY);
        const messageData = encoder.encode(rawBody);

        const cryptoKey = await crypto.subtle.importKey(
            "raw",
            keyData,
            { name: "HMAC", hash: "SHA-512" },
            false,
            ["sign"]
        );

        const signatureBuffer = await crypto.subtle.sign("HMAC", cryptoKey, messageData);
        const hashArray = Array.from(new Uint8Array(signatureBuffer));
        const computedSignature = hashArray.map(b => b.toString(16).padStart(2, "0")).join("");

        if (computedSignature !== signature) {
            return new Response("Unauthorized: Invalid Signature", { status: 401 });
        }

        let payload;
        try {
            payload = JSON.parse(rawBody);
        } catch (e) {
            return new Response("Bad Request: Invalid JSON", { status: 400 });
        }

        const eventType = payload.eventType;
        if (eventType !== "SUCCESSFUL_TRANSACTION") {
            return new Response("Event ignored", { status: 200 });
        }

        const transactionData = payload.eventData;
        const email = transactionData.customer.email.trim().toLowerCase();
        const amountPaid = parseFloat(transactionData.amountPaid);
        const transactionRef = transactionData.transactionReference;

        if (isNaN(amountPaid) || amountPaid <= 0) {
            return new Response("Invalid Amount", { status: 400 });
        }

        try {
            const checkTxRes = await fetch(`${SUPABASE_URL}/rest/v1/transactions?reference=eq.${encodeURIComponent(transactionRef)}`, {
                method: "GET",
                headers: {
                    "apikey": SUPABASE_SERVICE_ROLE_KEY,
                    "Authorization": `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
                    "Content-Type": "application/json"
                }
            });

            if (!checkTxRes.ok) {
                throw new Error("Failed to check duplicate transaction reference");
            }

            const existingTx = await checkTxRes.json();
            if (existingTx.length > 0) {
                return new Response("Transaction already processed", { status: 200 });
            }

            const userQueryRes = await fetch(`${SUPABASE_URL}/rest/v1/user_profiles`, {
                method: "GET",
                headers: {
                    "apikey": SUPABASE_SERVICE_ROLE_KEY,
                    "Authorization": `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
                    "Content-Type": "application/json"
                }
            });

            if (!userQueryRes.ok) {
                throw new Error("Failed to fetch user profiles for verification");
            }

            const allProfiles = await userQueryRes.json();
            const matchedProfile = allProfiles.find(profile => 
                profile.user_data && 
                profile.user_data.email && 
                profile.user_data.email.trim().toLowerCase() === email
            );

            if (!matchedProfile) {
                await fetch(`${SUPABASE_URL}/rest/v1/failed_webhooks`, {
                    method: "POST",
                    headers: {
                        "apikey": SUPABASE_SERVICE_ROLE_KEY,
                        "Authorization": `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
                        "Content-Type": "application/json",
                        "Prefer": "return=minimal"
                    },
                    body: JSON.stringify({
                        email: email,
                        amount: amountPaid,
                        reference: transactionRef,
                        raw_payload: payload,
                        reason: "User email not found in database",
                        created_at: new Date().toISOString()
                    })
                });

                return new Response("User not found, logged to failed_webhooks", { status: 200 });
            }

            const userId = matchedProfile.id;
            const currentBalance = parseFloat(matchedProfile.user_data.user_balance || "0.00");
            const newBalance = currentBalance + amountPaid;

            const updatedUserData = {
                ...matchedProfile.user_data,
                user_balance: newBalance.toFixed(2)
            };

            const updateProfileRes = await fetch(`${SUPABASE_URL}/rest/v1/user_profiles?id=eq.${userId}`, {
                method: "PATCH",
                headers: {
                    "apikey": SUPABASE_SERVICE_ROLE_KEY,
                    "Authorization": `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
                    "Content-Type": "application/json",
                    "Prefer": "return=minimal"
                },
                body: JSON.stringify({
                    user_data: updatedUserData
                })
            });

            if (!updateProfileRes.ok) {
                throw new Error("Failed to update user balance in user_profiles");
            }

            const newTransaction = {
                user_id: userId,
                email: email,
                amount: amountPaid,
                type: "deposit",
                reference: transactionRef,
                created_at: new Date().toISOString()
            };

            const insertTxRes = await fetch(`${SUPABASE_URL}/rest/v1/transactions`, {
                method: "POST",
                headers: {
                    "apikey": SUPABASE_SERVICE_ROLE_KEY,
                    "Authorization": `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
                    "Content-Type": "application/json",
                    "Prefer": "return=representation"
                },
                body: JSON.stringify(newTransaction)
            });

            if (!insertTxRes.ok) {
                throw new Error("Failed to record new transaction log");
            }

            const fetchUserTxsRes = await fetch(`${SUPABASE_URL}/rest/v1/transactions?user_id=eq.${userId}&order=created_at.desc`, {
                method: "GET",
                headers: {
                    "apikey": SUPABASE_SERVICE_ROLE_KEY,
                    "Authorization": `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
                    "Content-Type": "application/json"
                }
            });

            if (fetchUserTxsRes.ok) {
                const userTxs = await fetchUserTxsRes.json();
                if (userTxs.length > 5) {
                    const txsToDelete = userTxs.slice(5);
                    for (const tx of txsToDelete) {
                        await fetch(`${SUPABASE_URL}/rest/v1/transactions?id=eq.${tx.id}`, {
                            method: "DELETE",
                            headers: {
                                "apikey": SUPABASE_SERVICE_ROLE_KEY,
                                "Authorization": `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
                                "Content-Type": "application/json"
                            }
                        });
                    }
                }
            }

            return new Response("Webhook processed successfully", { status: 200 });

        } catch (error) {
            try {
                await fetch(`${SUPABASE_URL}/rest/v1/failed_webhooks`, {
                    method: "POST",
                    headers: {
                        "apikey": SUPABASE_SERVICE_ROLE_KEY,
                        "Authorization": `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
                        "Content-Type": "application/json",
                        "Prefer": "return=minimal"
                    },
                    body: JSON.stringify({
                        email: email,
                        amount: amountPaid,
                        reference: transactionRef,
                        raw_payload: payload,
                        reason: error.message || "System runtime execution crash",
                        created_at: new Date().toISOString()
                    })
                });
            } catch (loggingError) {}

            return new Response("Internal Server Error: Logged internally", { status: 500 });
        }
    }
};