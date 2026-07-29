export async function onRequest(context) {
 
  const supabaseUrl = context.env.SUPABASE_URL || "https://pzyxknmysydjbszumptt.supabase.co/rest/v1/";
  const serviceKey = context.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!serviceKey) {
    return new Response(
      JSON.stringify({ error: "Ba a sami SUPABASE_SERVICE_ROLE_KEY ba a Pages Settings!" }), 
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }

  try {
  
    const response = await fetch(`${supabaseUrl}`, {
      method: "GET",
      headers: {
        "apikey": serviceKey,
        "Authorization": `Bearer ${serviceKey}`,
        "Content-Type": "application/json"
      }
    });

    if (response.ok) {
      return new Response(
        JSON.stringify({ success: true, message: "Supabase yana nan raye, ba zai yi barci ba!" }), 
        { status: 200, headers: { "Content-Type": "application/json" } }
      );
    } else {
      return new Response(
        JSON.stringify({ success: false, error: `Supabase ya dawo da status: ${response.status}` }), 
        { status: 400, headers: { "Content-Type": "application/json" } }
      );
    }
  } catch (error) {
    return new Response(
      JSON.stringify({ success: false, error: error.message }), 
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }
}