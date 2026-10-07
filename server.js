const express = require("express");
const crypto = require("crypto");

const app = express();
const PORT = process.env.PORT || 10000;

const CLIENT_ID = process.env.POLAR_CLIENT_ID;
const CLIENT_SECRET = process.env.POLAR_CLIENT_SECRET;
const REDIRECT_URI = process.env.POLAR_REDIRECT_URI;

app.get("/", (req, res) => {
  res.send("Pierino Coach Polar backend OK");
});

function createState() {
  const payload = {
    t: Date.now(),
    r: crypto.randomBytes(16).toString("hex")
  };

  return Buffer.from(JSON.stringify(payload)).toString("base64url");
}

app.get("/oauth/start", (req, res) => {
  const state = createState();

  const params = new URLSearchParams({
    client_id: CLIENT_ID,
    response_type: "code",
    scope: "activity:read training_sessions:read profile:read",
    redirect_uri: REDIRECT_URI,
    state
  });

  const url = `https://auth.polar.com/oauth/authorize?${params.toString()}`;

  res.redirect(url);
});

app.get("/oauth/callback", async (req, res) => {
  try {
    console.log("=== POLAR CALLBACK ===");
    console.log("Has code:", !!req.query.code);
    console.log("Has state:", !!req.query.state);
    console.log("Has error:", !!req.query.error);

    if (req.query.error) {
      console.error("Polar authorization error:", req.query.error);
      console.error("Description:", req.query.error_description || "");
      return res.status(400).send(
        `Polar authorization error: ${req.query.error}`
      );
    }

    if (!req.query.code) {
      return res.status(400).send("Missing authorization code.");
    }

    const code = req.query.code;

    console.log("Starting token exchange...");

    const credentials = Buffer.from(
      `${CLIENT_ID}:${CLIENT_SECRET}`
    ).toString("base64");

    const body = new URLSearchParams({
      grant_type: "authorization_code",
      code: code,
      redirect_uri: REDIRECT_URI
    });

    const response = await fetch(
      "https://auth.polar.com/oauth/token",
      {
        method: "POST",
        headers: {
          "Authorization": `Basic ${credentials}`,
          "Content-Type": "application/x-www-form-urlencoded",
          "Accept": "application/json"
        },
        body: body.toString()
      }
    );

    const responseText = await response.text();

    console.log("Polar token HTTP status:", response.status);
    console.log("Polar token response:", responseText);

    if (!response.ok) {
      return res.status(500).send(
        `Polar token exchange failed. HTTP ${response.status}. Check Render logs.`
      );
    }

    const tokenData = JSON.parse(responseText);

    console.log("Token exchange SUCCESS.");
    console.log("Token type:", tokenData.token_type);
    console.log("Expires in:", tokenData.expires_in);
    console.log("Scope:", tokenData.scope);

    res.send(`
      <h2>Polar collegato correttamente!</h2>
      <p>Pierino Coach è stato autorizzato.</p>
      <p>Ora possiamo procedere con il collegamento dei dati Polar.</p>
    `);

  } catch (error) {
    console.error("TOKEN EXCHANGE EXCEPTION:");
    console.error(error);

    res.status(500).send(
      "Server error during Polar token exchange. Check Render logs."
    );
  }
});

app.listen(PORT, "0.0.0.0", () => {
  console.log(`Pierino Coach Polar backend listening on port ${PORT}`);
});

