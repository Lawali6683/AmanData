export default {
    async fetch(request, env) {
        if (request.method !== "POST") {
            return new Response(JSON.stringify({ success: false, message: "Method Not Allowed" }), {
                status: 405,
                headers: { "Content-Type": "application/json" }
            });
        }

        try {
            const payload = await request.json();
            const { full_name, email, action, pin, password, type } = payload;

            if (!email || !full_name) {
                return new Response(JSON.stringify({ success: false, message: "Required user metadata is absent." }), {
                    status: 400,
                    headers: { "Content-Type": "application/json" }
                });
            }

            const BREVO_API_KEY = env.BREVO_API_KEY;
            const SENDER_EMAIL = env.SENDER_EMAIL;
            const SENDER_NAME = env.SENDER_NAME || "AmanData Services";

            let emailSubject = "";
            let emailHtmlContent = "";

            if (type === "forget") {
                emailSubject = "AmanData Account Access Recovery";
                emailHtmlContent = `
                    <!DOCTYPE html>
                    <html>
                    <head>
                        <meta charset="utf-8">
                        <style>
                            body { font-family: Arial, sans-serif; background-color: #f8fafc; color: #1e293b; padding: 20px; }
                            .card { background-color: #ffffff; border: 1px solid #e2e8f0; border-radius: 16px; padding: 32px; max-width: 500px; margin: 0 auto; box-shadow: 0 4px 6px -1px rgba(0,0,0,0.1); }
                            .logo-area { text-align: center; margin-bottom: 24px; }
                            .headline { font-size: 20px; font-weight: 700; color: #4834d4; margin-bottom: 16px; text-align: center; }
                            .paragraph { font-size: 14px; line-height: 1.6; color: #475569; margin-bottom: 24px; }
                            .credential-box { background-color: #f1f5f9; border-radius: 12px; padding: 18px; text-align: center; margin-bottom: 24px; border: 1px dashed #6c5ce7; }
                            .label { font-size: 11px; text-transform: uppercase; letter-spacing: 0.5px; color: #64748b; font-weight: 700; margin-bottom: 6px; }
                            .value { font-size: 22px; font-weight: 800; color: #0f172a; letter-spacing: 1px; }
                            .footer { font-size: 11px; color: #94a3b8; text-align: center; margin-top: 32px; }
                        </style>
                    </head>
                    <body>
                        <div class="card">
                            <div class="logo-area">
                                <h1 style="color: #6c5ce7; font-size: 24px; margin: 0;">AmanData</h1>
                            </div>
                            <div class="headline">Access Password Recovery</div>
                            <div class="paragraph">Hello ${full_name},<br><br>We received a request to retrieve your registered login password. Your account credential parameters are safely fetched as requested:</div>
                            <div class="credential-box">
                                <div class="label">Your Login Password</div>
                                <div class="value">${password}</div>
                            </div>
                            <div class="paragraph" style="font-size: 12px; color: #ef4444;">Warning: If you did not trigger this retrieval sequence, modify your password immediately from your account profile hub.</div>
                            <div class="footer">AmanData Tech Labs &copy; 2026. All security configurations monitored.</div>
                        </div>
                    </body>
                    </html>
                `;
            } else if (action === "Transaction PIN") {
                emailSubject = "AmanData Security Change: Transaction PIN Updated";
                emailHtmlContent = `
                    <!DOCTYPE html>
                    <html>
                    <head>
                        <meta charset="utf-8">
                        <style>
                            body { font-family: Arial, sans-serif; background-color: #f8fafc; color: #1e293b; padding: 20px; }
                            .card { background-color: #ffffff; border: 1px solid #e2e8f0; border-radius: 16px; padding: 32px; max-width: 500px; margin: 0 auto; box-shadow: 0 4px 6px -1px rgba(0,0,0,0.1); }
                            .logo-area { text-align: center; margin-bottom: 24px; }
                            .headline { font-size: 20px; font-weight: 700; color: #10b981; margin-bottom: 16px; text-align: center; }
                            .paragraph { font-size: 14px; line-height: 1.6; color: #475569; margin-bottom: 24px; }
                            .status-box { background-color: #ecfdf5; border: 1px solid #a7f3d0; border-radius: 12px; padding: 18px; text-align: center; margin-bottom: 24px; }
                            .status-title { font-size: 14px; font-weight: 700; color: #065f46; margin-bottom: 4px; }
                            .status-time { font-size: 11px; color: #047857; }
                            .footer { font-size: 11px; color: #94a3b8; text-align: center; margin-top: 32px; }
                        </style>
                    </head>
                    <body>
                        <div class="card">
                            <div class="logo-area">
                                <h1 style="color: #6c5ce7; font-size: 24px; margin: 0;">AmanData</h1>
                            </div>
                            <div class="headline">Transaction PIN Changed</div>
                            <div class="paragraph">Hello ${full_name},<br><br>Your 4-digit transaction authorization key configuration has been modified successfully.</div>
                            <div class="status-box">
                                <div class="status-title">Security Settings Updated</div>
                                <div class="status-time">Date/Time: ${new Date().toUTCString()}</div>
                            </div>
                            <div class="paragraph" style="font-size: 12px; color: #ef4444;">If you did not authorize this change, contact system support or lock your account parameters immediately.</div>
                            <div class="footer">AmanData Tech Labs &copy; 2026. All security configurations monitored.</div>
                        </div>
                    </body>
                    </html>
                `;
            } else if (action === "Login Password") {
                emailSubject = "AmanData Security Change: Password Updated Successfully";
                emailHtmlContent = `
                    <!DOCTYPE html>
                    <html>
                    <head>
                        <meta charset="utf-8">
                        <style>
                            body { font-family: Arial, sans-serif; background-color: #f8fafc; color: #1e293b; padding: 20px; }
                            .card { background-color: #ffffff; border: 1px solid #e2e8f0; border-radius: 16px; padding: 32px; max-width: 500px; margin: 0 auto; box-shadow: 0 4px 6px -1px rgba(0,0,0,0.1); }
                            .logo-area { text-align: center; margin-bottom: 24px; }
                            .headline { font-size: 20px; font-weight: 700; color: #4834d4; margin-bottom: 16px; text-align: center; }
                            .paragraph { font-size: 14px; line-height: 1.6; color: #475569; margin-bottom: 24px; }
                            .status-box { background-color: #f5f3ff; border: 1px solid #ddd6fe; border-radius: 12px; padding: 18px; text-align: center; margin-bottom: 24px; }
                            .status-title { font-size: 14px; font-weight: 700; color: #5b21b6; margin-bottom: 4px; }
                            .status-time { font-size: 11px; color: #6d28d9; }
                            .footer { font-size: 11px; color: #94a3b8; text-align: center; margin-top: 32px; }
                        </style>
                    </head>
                    <body>
                        <div class="card">
                            <div class="logo-area">
                                <h1 style="color: #6c5ce7; font-size: 24px; margin: 0;">AmanData</h1>
                            </div>
                            <div class="headline">Account Access Key Updated</div>
                            <div class="paragraph">Hello ${full_name},<br><br>Your login gateway account access password has been updated successfully.</div>
                            <div class="status-box">
                                <div class="status-title">Security Key Reset Success</div>
                                <div class="status-time">Date/Time: ${new Date().toUTCString()}</div>
                            </div>
                            <div class="paragraph" style="font-size: 12px; color: #ef4444;">If you did not execute this authentication update, immediately contact support.</div>
                            <div class="footer">AmanData Tech Labs &copy; 2026. All security configurations monitored.</div>
                        </div>
                    </body>
                    </html>
                `;
            } else {
                return new Response(JSON.stringify({ success: false, message: "Invalid action context query parameters." }), {
                    status: 400,
                    headers: { "Content-Type": "application/json" }
                });
            }

            const brevoPayload = {
                sender: { name: SENDER_NAME, email: SENDER_EMAIL },
                to: [{ email: email, name: full_name }],
                subject: emailSubject,
                htmlContent: emailHtmlContent
            };

            const brevoResponse = await fetch("https://api.brevo.com/v3/smtp/email", {
                method: "POST",
                headers: {
                    "accept": "application/json",
                    "api-key": BREVO_API_KEY,
                    "content-type": "application/json"
                },
                body: JSON.stringify(brevoPayload)
            });

            if (!brevoResponse.ok) {
                const errorDetails = await brevoResponse.text();
                return new Response(JSON.stringify({ success: false, message: "Mailing system error response", raw: errorDetails }), {
                    status: 502,
                    headers: { "Content-Type": "application/json" }
                });
            }

            return new Response(JSON.stringify({ success: true, message: "Email dispatched successfully" }), {
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
