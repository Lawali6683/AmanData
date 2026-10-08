const BATCH_SIZE = 10;

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

const maskEmail = (email) => {
  const parts = String(email || "").split("@");
  if (parts.length !== 2) return "";
  return parts[0].slice(0, 2) + "***@" + parts[1];
};

export async function onRequestPost(context) {
  const { request, env } = context;
  try {
    let body = {};
    try {
      body = await request.json();
    } catch (e) {
      body = {};
    }

    const supabaseKey = env.SUPABASE_SERVICE_ROLE_KEY;
    if (!supabaseKey) {
      return jsonResponse({ success: false, message: "Server is not configured." }, 500);
    }

    const offset = Math.max(0, parseInt(body.offset, 10) || 0);
    const baseUrl = getBaseUrl(env.SUPABASE_URL);
    const restUrl = `${baseUrl}/rest/v1/`;

    const headers = {
      "apikey": supabaseKey,
      "Authorization": `Bearer ${supabaseKey}`,
      "Content-Type": "application/json"
    };

    const listRes = await fetch(
      `${restUrl}user_profiles?select=id,user_data&order=id.asc&limit=${BATCH_SIZE}&offset=${offset}`,
      { method: "GET", headers: headers }
    );

    if (!listRes.ok) {
      return jsonResponse({ success: false, message: "Could not read user profiles." }, 500);
    }

    const rows = await listRes.json();

    const createAuthUser = async (row, email, password) => {
      const res = await fetch(`${baseUrl}/auth/v1/admin/users`, {
        method: "POST",
        headers: headers,
        body: JSON.stringify({
          id: row.id,
          email: email,
          password: password,
          email_confirm: true,
          user_metadata: {
            full_name: row.user_data.full_name || "",
            phone_number: row.user_data.phone_number || ""
          }
        })
      });
      if (res.ok) return { ok: true };
      let data = {};
      try {
        data = await res.json();
      } catch (e) {}
      const code = String(data.error_code || data.code || "").toLowerCase();
      const text = JSON.stringify(data).toLowerCase();
      return {
        ok: false,
        status: res.status,
        weak: code === "weak_password" || text.includes("weak_password"),
        exists: code === "email_exists" || code === "user_already_exists" || text.includes("already") || text.includes("exists"),
        message: data.msg || data.message || data.error_description || ""
      };
    };

    const authUserExists = async (id) => {
      try {
        const res = await fetch(`${baseUrl}/auth/v1/admin/users/${id}`, {
          method: "GET",
          headers: headers
        });
        return res.ok;
      } catch (e) {
        return false;
      }
    };

    const migrateOne = async (row) => {
      const data = row.user_data || {};
      row.user_data = data;
      const email = String(data.email || "").trim().toLowerCase();
      const label = maskEmail(email) || String(row.id).slice(0, 8);

      if (!email) {
        return { label: label, status: "skipped", note: "No email in profile." };
      }

      let password = data.password !== undefined && data.password !== null ? String(data.password) : "";
      let needsReset = false;

      if (password.length < 6) {
        password = crypto.randomUUID() + crypto.randomUUID();
        needsReset = true;
      }

      let result = await createAuthUser(row, email, password);

      if (!result.ok && result.weak && !needsReset) {
        needsReset = true;
        result = await createAuthUser(row, email, crypto.randomUUID() + crypto.randomUUID());
      }

      if (result.ok) {
        return {
          label: label,
          status: "migrated",
          needsReset: needsReset,
          note: needsReset ? "Password did not meet rules. User must use Forgot Password." : ""
        };
      }

      if (result.exists) {
        const sameUser = await authUserExists(row.id);
        if (sameUser) {
          return { label: label, status: "already_exists", note: "" };
        }
        return {
          label: label,
          status: "email_conflict",
          note: "This email already belongs to a different auth account."
        };
      }

      return {
        label: label,
        status: "failed",
        note: result.message || ("Auth error " + result.status)
      };
    };

    const results = [];
    for (const row of rows) {
      try {
        results.push(await migrateOne(row));
      } catch (e) {
        results.push({ label: String(row.id).slice(0, 8), status: "failed", note: "Unexpected error." });
      }
    }

    return jsonResponse({
      success: true,
      done: rows.length < BATCH_SIZE,
      nextOffset: offset + rows.length,
      results: results
    }, 200);
  } catch (error) {
    return jsonResponse({ success: false, message: "Critical internal system exception caught." }, 500);
  }
}
