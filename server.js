import express from "express";
import crypto from "crypto";

const app = express();
app.use(express.urlencoded({ extended: false }));
app.use(express.json());

const PORT = process.env.PORT || 10000;
const CLIENT_ID = process.env.POLAR_CLIENT_ID;
const CLIENT_SECRET = process.env.POLAR_CLIENT_SECRET;
const REDIRECT_URI = process.env.POLAR_REDIRECT_URI;

const pending = new Map();

setInterval(() => {
  const now = Date.now();
  for (const [state, item] of pending) {
    if (now - item.createdAt > 10 * 60 * 1000) pending.delete(state);
  }
}, 60000).unref();

app.get("/", (_req, res) => res.type("text").send("Pierino Coach Polar backend OK"));

app.get("/oauth/start", (req, res) => {
  const state = crypto.randomBytes(24).toString("hex");
  pending.set(state, { createdAt: Date.now(), status: "waiting" });

  const params = new URLSearchParams({
    client_id: CLIENT_ID,
    response_type: "code",
    scope: "REQUESTED_SCOPES",
    redirect_uri: REDIRECT_URI,
    state
  });

  res.redirect(`https://auth.polar.com/oauth/authorize?${params.toString()}`);
});

app.get("/oauth/callback", async (req, res) => {
  const { code, state, error, error_description } = req.query;
  const item = pending.get(state);

  if (!item) return res.status(400).send("Invalid or expired OAuth state.");

  if (error) {
    item.status = "error";
    item.error = error_description || error;
    return res.type("text").send("Polar authorization was not completed. You can close this page.");
  }

  if (!code) {
    item.status = "error";
    item.error = "No authorization code received.";
    return res.status(400).send("No authorization code received.");
  }

  try {
    const basic = Buffer.from(`${CLIENT_ID}:${CLIENT_SECRET}`).toString("base64");
    const body = new URLSearchParams({
      grant_type: "authorization_code",
      code,
      redirect_uri: REDIRECT_URI
    });

    const tokenResponse = await fetch("https://auth.polar.com/oauth/token", {
      method: "POST",
      headers: {
        "Authorization": `Basic ${basic}`,
        "Content-Type": "application/x-www-form-urlencoded"
      },
      body
    });

    const data = await tokenResponse.json();
    if (!tokenResponse.ok) throw new Error(JSON.stringify(data));

    item.status = "ready";
    item.token = data;
    return res.type("text").send("Polar authorization completed. You can return to Pierino Coach.");
  } catch (e) {
    item.status = "error";
    item.error = "Token exchange failed";
    return res.status(500).send("Polar token exchange failed.");
  }
});

app.get("/oauth/status", (req, res) => {
  const state = String(req.query.state || "");
  const item = pending.get(state);
  if (!item) return res.status(404).json({ status: "expired" });

  if (item.status === "ready") {
    const token = item.token;
    pending.delete(state);
    return res.json({
      status: "ready",
      access_token: token.access_token,
      refresh_token: token.refresh_token,
      expires_in: token.expires_in,
      scope: token.scope
    });
  }

  res.json({ status: item.status, error: item.error || null });
});

app.post("/oauth/refresh", async (req, res) => {
  try {
    const { refresh_token } = req.body;
    if (!refresh_token) return res.status(400).json({ error: "refresh_token required" });

    const basic = Buffer.from(`${CLIENT_ID}:${CLIENT_SECRET}`).toString("base64");
    const body = new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token
    });

    const tokenResponse = await fetch("https://auth.polar.com/oauth/token", {
      method: "POST",
      headers: {
        "Authorization": `Basic ${basic}`,
        "Content-Type": "application/x-www-form-urlencoded"
      },
      body
    });

    const data = await tokenResponse.json();
    if (!tokenResponse.ok) return res.status(tokenResponse.status).json(data);
    res.json(data);
  } catch {
    res.status(500).json({ error: "refresh_failed" });
  }
});

app.listen(PORT, "0.0.0.0", () => {
  console.log(`Pierino Polar backend listening on ${PORT}`);
});
