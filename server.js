import express from "express";
import crypto from "crypto";

const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: false }));

const PORT = process.env.PORT || 10000;
const CLIENT_ID = process.env.POLAR_CLIENT_ID;
const CLIENT_SECRET = process.env.POLAR_CLIENT_SECRET;
const REDIRECT_URI = process.env.POLAR_REDIRECT_URI;

const states = new Map();

function cleanupStates() {
  const now = Date.now();
  for (const [state, value] of states) {
    if (now - value.createdAt > 10 * 60 * 1000) states.delete(state);
  }
}
setInterval(cleanupStates, 60_000).unref();

app.get("/", (_req, res) => {
  res.type("text").send("Pierino Coach Polar backend OK");
});

app.get("/oauth/start", (_req, res) => {
  const state = crypto.randomBytes(32).toString("hex");
  states.set(state, { createdAt: Date.now() });

  const params = new URLSearchParams({
    client_id: CLIENT_ID,
    response_type: "code",
    scope: "activity:read training_sessions:read profile:read",
    redirect_uri: REDIRECT_URI,
    state
  });

  res.redirect("https://auth.polar.com/oauth/authorize?" + params.toString());
});

app.get("/oauth/callback", async (req, res) => {
  const { code, state, error, error_description } = req.query;

  if (!state || !states.has(state)) {
    return res.status(400).type("text").send(
      "Invalid or expired OAuth state. Start again from /oauth/start."
    );
  }

  states.delete(state);

  if (error) {
    return res.status(400).type("text").send(
      "Polar authorization was not completed: " +
      (error_description || error)
    );
  }

  if (!code) {
    return res.status(400).type("text").send("No authorization code received.");
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
        Authorization: `Basic ${basic}`,
        "Content-Type": "application/x-www-form-urlencoded"
      },
      body
    });

    const data = await tokenResponse.json();

    if (!tokenResponse.ok) {
      console.error("Polar token error:", data);
      return res.status(502).type("text").send(
        "Polar token exchange failed. Check the Render logs."
      );
    }

    console.log("Polar authorization successful. Token received.");
    return res.type("text").send(
      "Polar authorization completed successfully. You can return to Pierino Coach."
    );
  } catch (err) {
    console.error(err);
    return res.status(500).type("text").send("Server error during Polar authorization.");
  }
});

app.listen(PORT, "0.0.0.0", () => {
  console.log(`Pierino Polar backend listening on ${PORT}`);
});
