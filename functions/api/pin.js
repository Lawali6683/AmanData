export default {
    async fetch(request, env) {
        if (request.method !== "POST") {
            return new Response(JSON.stringify({ success: false, message: "Method Not Allowed" }), {
                status: 405,
                headers: { "Content-Type": "application/json" }
            });
        }

        try {
            const body = await request.json();
            const { password, uuid, pin, new_password, type } = body;

            if (password !== "@haruna66") {
                return new Response(JSON.stringify({ success: false, message: "Access Denied: Invalid authentication signature." }), {
                    status: 401,
                    headers: { "Content-Type": "application/json" }
                });
            }

            if (!uuid || !type) {
                return new Response(JSON.stringify({ success: false, message: "Missing required identifier parameters." }), {
                    status: 400,
                    headers: { "Content-Type": "application/json" }
                });
            }

            const supabaseUrl = env.SUPABASE_URL || "https://pzyxknmysydjbszumptt.supabase.co/rest/v1/";
            const supabaseKey = env.SUPABASE_SERVICE_ROLE_KEY;

            const userQueryRes = await fetch(`${supabaseUrl}user_profiles?id=eq.${uuid}`, {
                method: "GET",
                headers: {
                    "apikey": supabaseKey,
                    "Authorization": `Bearer ${supabaseKey}`,
                    "Content-Type": "application/json"
                }
            });

            if (!userQueryRes.ok) {
                return new Response(JSON.stringify({ success: false, message: "Failed to connect to profile database." }), {
                    status: 500,
                    headers: { "Content-Type": "application/json" }
                });
            }

            const userRecords = await userQueryRes.json();
            if (userRecords.length === 0) {
                return new Response(JSON.stringify({ success: false, message: "User profile record not found." }), {
                    status: 404,
                    headers: { "Content-Type": "application/json" }
                });
            }

            const profile = userRecords[0];
            let patchPayload = {};

            if (type === "pin") {
                if (!pin || pin.length !== 4) {
                    return new Response(JSON.stringify({ success: false, message: "PIN format must be exactly 4 digits." }), {
                        status: 400,
                        headers: { "Content-Type": "application/json" }
                    });
                }
                patchPayload = { pin: pin };
            } else if (type === "password") {
                if (!new_password || new_password.length < 6) {
                    return new Response(JSON.stringify({ success: false, message: "Password must be at least 6 characters long." }), {
                        status: 400,
                        headers: { "Content-Type": "application/json" }
                    });
                }
                patchPayload = { password: new_password };
            } else {
                return new Response(JSON.stringify({ success: false, message: "Invalid configuration modification request type." }), {
                    status: 400,
                    headers: { "Content-Type": "application/json" }
                });
            }

            const updateRes = await fetch(`${supabaseUrl}user_profiles?id=eq.${uuid}`, {
                method: "PATCH",
                headers: {
                    "apikey": supabaseKey,
                    "Authorization": `Bearer ${supabaseKey}`,
                    "Content-Type": "application/json",
                    "Prefer": "return=minimal"
                },
                body: JSON.stringify(patchPayload)
            });

            if (!updateRes.ok) {
                return new Response(JSON.stringify({ success: false, message: "Failed to update profile configurations on remote." }), {
                    status: 500,
                    headers: { "Content-Type": "application/json" }
                });
            }

            return new Response(JSON.stringify({ success: true, message: "Database updated successfully." }), {
                status: 200,
                headers: { "Content-Type": "application/json" }
            });

        } catch (error) {
            return new Response(JSON.stringify({ success: false, message: error.message }), {
                status: 500,
                headers: { "Content-Type": "application/json" }
            });
        }
    }
};