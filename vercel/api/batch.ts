import { isAuthorized, runEnvelope, unauthorized, type Envelope, type Reply } from "./_envelope";

export const config = {
  runtime: "nodejs",
  maxDuration: 800,
};

export default async function handler(req: Request): Promise<Response> {
  if (req.method !== "POST") {
    return new Response("method not allowed", { status: 405 });
  }
  if (!isAuthorized(req)) {
    return unauthorized();
  }
  let payload: Envelope;
  try {
    payload = (await req.json()) as Envelope;
  } catch {
    return new Response(JSON.stringify({ e: "bad_json" }), {
      status: 400,
      headers: { "content-type": "application/json" },
    });
  }
  const envs = Array.isArray(payload.q) ? payload.q : [];
  const replies: Reply[] = await Promise.all(envs.map(runEnvelope));
  return new Response(JSON.stringify({ r: replies }), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}
