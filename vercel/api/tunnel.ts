import { isAuthorized, runEnvelope, unauthorized, type Envelope } from "./_envelope";

export const config = {
  runtime: "nodejs",
  // 800s is the Pro / Fluid Compute ceiling. On Hobby this gets clamped
  // to 300s by the runtime — fine for everything except the very longest
  // streaming uploads.
  maxDuration: 800,
};

export default async function handler(req: Request): Promise<Response> {
  if (req.method !== "POST") {
    return new Response("method not allowed", { status: 405 });
  }
  if (!isAuthorized(req)) {
    return unauthorized();
  }
  let env: Envelope;
  try {
    env = (await req.json()) as Envelope;
  } catch {
    return new Response(JSON.stringify({ e: "bad_json" }), {
      status: 400,
      headers: { "content-type": "application/json" },
    });
  }
  const reply = await runEnvelope(env);
  return new Response(JSON.stringify(reply), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}
