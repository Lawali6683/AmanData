const HEADERS = { "Content-Type": "application/json", "Cache-Control": "no-store" };
const LOGO_URL = "https://i.imgur.com/vQBFHZI.png";

function reply(body, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: HEADERS });
}

function snippet(text) {
  return String(text === undefined || text === null ? "" : text).replace(/\s+/g, " ").slice(0, 200);
}

function cleanRoot(url) {
  return String(url || "").trim().replace(/\/rest\/v1\/?$/, "").replace(/\/+$/, "");
}

function escapeHtml(value) {
  return String(value === undefined || value === null ? "" : value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function money(value) {
  const number = Number(value) || 0;
  return "₦" + number.toLocaleString("en-NG", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function formatTime(value) {
  const date = new Date(value);
  if (isNaN(date.getTime())) return "";
  return date.toLocaleString("en-NG", {
    timeZone: "Africa/Lagos",
    day: "numeric",
    month: "long",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    hour12: true
  });
}

function maskAccount(value) {
  const digits = String(value || "");
  if (digits.length <= 4) return digits;
  return "******" + digits.slice(-4);
}

async function requireAdmin(request, env) {
  const root = cleanRoot(env.AUTH_SUPABASE_URL || env.SUPABASE_URL);
  const key = env.AUTH_SUPABASE_KEY || env.SUPABASE_SERVICE_ROLE_KEY;
  const token = (request.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
  if (!token) return reply({ success: false, message: "Please sign in first." }, 401);
  if (!root || !key) return reply({ success: false, message: "Server is not configured" }, 500);

  let res;
  try {
    res = await fetch(root + "/rest/v1/rpc/is_admin_user", {
      method: "POST",
      headers: { apikey: key, Authorization: "Bearer " + token, "Content-Type": "application/json" },
      body: "{}"
    });
  } catch {
    return reply({ success: false, message: "Could not reach Supabase to verify your access." }, 502);
  }
  if (res.status === 401) return reply({ success: false, message: "Your session was rejected. Sign in again." }, 401);
  if (!res.ok) return reply({ success: false, message: "Access check failed (" + res.status + ")." }, 500);

  let allowed = false;
  try {
    allowed = (await res.json()) === true;
  } catch {
    allowed = false;
  }
  if (!allowed) return reply({ success: false, message: "You do not have access to this page." }, 403);
  return null;
}

async function loadCompletedWithdrawal(env, reference) {
  const root = cleanRoot(env.SUPABASE_URL);
  const key = env.SUPABASE_SERVICE_ROLE_KEY;
  if (!root || !key) return { error: "Server is not configured" };
  const fields = "email,full_name,amount,fee,net_amount,bank_name,account_number,account_name,reference,completed_at";
  let res;
  try {
    res = await fetch(
      `${root}/rest/v1/withdrawals?reference=eq.${encodeURIComponent(reference)}&status=eq.completed&select=${fields}&limit=1`,
      { headers: { apikey: key, Authorization: "Bearer " + key } }
    );
  } catch {
    return { error: "Could not reach the database" };
  }
  const text = await res.text();
  if (!res.ok) return { error: "Database " + res.status + ": " + snippet(text) };
  let rows = [];
  try {
    rows = JSON.parse(text);
  } catch {
    rows = [];
  }
  if (!Array.isArray(rows) || rows.length === 0) {
    return { error: "No completed withdrawal was found for this reference" };
  }
  return { row: rows[0] };
}

function detailRow(label, value, highlight) {
  const color = highlight ? "#16a34a" : "#0f172a";
  const weight = highlight ? "800" : "700";
  return `<tr>
    <td style="padding:12px 0;border-bottom:1px solid #e2e8f0;font-size:14px;color:#64748b;">${escapeHtml(label)}</td>
    <td align="right" style="padding:12px 0;border-bottom:1px solid #e2e8f0;font-size:14px;font-weight:${weight};color:${color};">${escapeHtml(value)}</td>
  </tr>`;
}

function buildEmail(data, brand) {
  const firstName = escapeHtml(String(data.full_name || "Valued Customer").trim().split(/\s+/)[0]);
  const amountPaid = money(data.net_amount);
  const when = formatTime(data.time);

  const rows = [
    detailRow("Amount Requested", money(data.amount), false),
    detailRow("Withdrawal Fee (1%)", money(data.fee), false),
    detailRow("Amount Paid To You", amountPaid, true),
    detailRow("Bank", data.bank_name, false),
    detailRow("Account Number", maskAccount(data.account_number), false),
    data.account_name ? detailRow("Account Name", data.account_name, false) : "",
    when ? detailRow("Date & Time", when, false) : "",
    data.reference ? detailRow("Reference", data.reference, false) : ""
  ].join("");

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Withdrawal Paid</title>
</head>
<body style="margin:0;padding:0;background-color:#f1f5f9;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="background-color:#f1f5f9;padding:24px 12px;">
<tr>
<td align="center">
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="max-width:560px;background-color:#ffffff;border-radius:24px;overflow:hidden;">
<tr>
<td align="center" style="background:linear-gradient(135deg,#0066ff 0%,#0052cc 100%);background-color:#0066ff;padding:32px 24px 28px;">
<img src="${LOGO_URL}" alt="${escapeHtml(brand)}" width="110" style="display:block;max-width:110px;height:auto;margin:0 auto 18px;border:0;">
<table role="presentation" cellspacing="0" cellpadding="0" border="0" style="margin:0 auto 14px;">
<tr>
<td align="center" width="64" height="64" style="width:64px;height:64px;background-color:#ffffff;border-radius:32px;font-size:34px;line-height:64px;color:#16a34a;font-weight:800;">&#10003;</td>
</tr>
</table>
<h1 style="margin:0;font-size:24px;line-height:1.3;color:#ffffff;font-weight:800;">Your Withdrawal Has Been Paid</h1>
</td>
</tr>
<tr>
<td style="padding:30px 26px 8px;">
<p style="margin:0 0 14px;font-size:16px;color:#0f172a;font-weight:700;">Hello ${firstName},</p>
<p style="margin:0 0 20px;font-size:15px;line-height:1.7;color:#475569;">Great news! Your withdrawal request has been approved and we have successfully sent <strong style="color:#0f172a;">${escapeHtml(amountPaid)}</strong> to your bank account. Thank you for being part of the ${escapeHtml(brand)} family.</p>
</td>
</tr>
<tr>
<td style="padding:0 26px;">
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="background-color:#f8fafc;border-radius:16px;padding:6px 18px;">
${rows}
</table>
</td>
</tr>
<tr>
<td style="padding:22px 26px 6px;">
<p style="margin:0;font-size:14px;line-height:1.7;color:#475569;">Most banks reflect the money within a few minutes. If you do not see it in your account after some time, please contact our support team and share the reference above so we can help you right away.</p>
</td>
</tr>
<tr>
<td align="center" style="padding:22px 26px 30px;">
<a href="https://wa.me/2347060739494?text=I%20need%20help%20with%20my%20withdrawal" style="display:inline-block;background-color:#16a34a;color:#ffffff;text-decoration:none;font-size:15px;font-weight:700;padding:14px 28px;border-radius:12px;">Contact Support</a>
</td>
</tr>
<tr>
<td align="center" style="background-color:#0f172a;padding:20px 24px;">
<p style="margin:0 0 4px;font-size:13px;color:#e2e8f0;font-weight:700;">${escapeHtml(brand)}</p>
<p style="margin:0;font-size:12px;line-height:1.6;color:#94a3b8;">This is an automated message. Please do not reply to this email.</p>
</td>
</tr>
</table>
</td>
</tr>
</table>
</body>
</html>`;
}

async function handle(request, env) {
  if (request.method !== "POST") {
    return reply({ success: false, message: "Method Not Allowed" }, 405);
  }

  const denied = await requireAdmin(request, env);
  if (denied) return denied;

  let body;
  try {
    body = await request.json();
  } catch {
    return reply({ success: false, message: "Bad Request" }, 400);
  }

  const reference = String((body && body.reference) || "").trim();
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(reference)) {
    return reply({ success: false, message: "A valid withdrawal reference is required" }, 400);
  }

  const found = await loadCompletedWithdrawal(env, reference);
  if (found.error) return reply({ success: false, message: found.error });
  const data = Object.assign({}, found.row, { time: found.row.completed_at || body.time });

  const email = String(data.email || body.email || "").trim();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return reply({ success: false, message: "Invalid email address" });
  }

  if (!env.EMAILJS_SERVICE_ID || !env.EMAILJS_TEMPLATE_ID || !env.EMAILJS_PUBLIC_KEY || !env.EMAILJS_PRIVATE_KEY) {
    return reply({ success: false, message: "Email service is not configured" });
  }

  const brand = env.FROM_NAME || "AmanData";
  const fromEmail = env.FROM_EMAIL || "no-reply@amandata.com.ng";
  const amountPaid = money(data.net_amount);

  const payload = {
    service_id: env.EMAILJS_SERVICE_ID,
    template_id: env.EMAILJS_TEMPLATE_ID,
    user_id: env.EMAILJS_PUBLIC_KEY,
    accessToken: env.EMAILJS_PRIVATE_KEY,
    template_params: {
      subject: `Your withdrawal of ${amountPaid} has been paid`,
      to_email: email,
      to_name: String(data.full_name || "Customer"),
      from_email: fromEmail,
      from_name: brand,
      html_content: buildEmail(data, brand)
    }
  };

  try {
    const res = await fetch("https://api.emailjs.com/api/v1.0/email/send", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });
    if (!res.ok) {
      const text = await res.text();
      return reply({ success: false, message: "Email provider rejected the request (" + res.status + "): " + snippet(text) });
    }
    return reply({ success: true, message: "Email sent" });
  } catch {
    return reply({ success: false, message: "Unable to reach email provider" });
  }
}

export async function onRequest(context) {
  return handle(context.request, context.env);
}
