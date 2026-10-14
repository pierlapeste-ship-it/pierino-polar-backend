


const express = require("express");
const crypto = require("crypto");

const app = express();
const PORT = process.env.PORT || 10000;
const CLIENT_ID = process.env.POLAR_CLIENT_ID;
const CLIENT_SECRET = process.env.POLAR_CLIENT_SECRET;
const REDIRECT_URI = process.env.POLAR_REDIRECT_URI;

// Temporary in-memory token storage for the first data-access test.
// Tokens are never returned to the browser or written to logs.
let polarTokens = null;
let tokenExpiresAt = 0;

app.get("/", (req, res) => res.send("Pierino Coach Polar backend OK"));

function createState() {
  const payload = { t: Date.now(), r: crypto.randomBytes(16).toString("hex") };
  return Buffer.from(JSON.stringify(payload)).toString("base64url");
}

app.get("/oauth/start", (req, res) => {
  if (!CLIENT_ID || !REDIRECT_URI) {
    return res.status(500).send("Missing Polar configuration. Check Render environment variables.");
  }
  const state = createState();
  const params = new URLSearchParams({
    client_id: CLIENT_ID,
    response_type: "code",
    scope: "activity:read training_sessions:read profile:read",
    redirect_uri: REDIRECT_URI,
    state
  });
  res.redirect(`https://auth.polar.com/oauth/authorize?${params.toString()}`);
});

app.get("/oauth/callback", async (req, res) => {
  try {
    console.log("=== POLAR CALLBACK ===");
    console.log("Has code:", !!req.query.code);
    console.log("Has state:", !!req.query.state);

    if (req.query.error) {
      console.error("Polar authorization error:", req.query.error);
      return res.status(400).send(`Polar authorization error: ${String(req.query.error)}`);
    }
    if (!req.query.code) return res.status(400).send("Missing authorization code.");
    if (!CLIENT_ID || !CLIENT_SECRET || !REDIRECT_URI) {
      return res.status(500).send("Missing Polar configuration. Check Render environment variables.");
    }

    const credentials = Buffer.from(`${CLIENT_ID}:${CLIENT_SECRET}`).toString("base64");
    const body = new URLSearchParams({
      grant_type: "authorization_code",
      code: String(req.query.code),
      redirect_uri: REDIRECT_URI
    });
    const response = await fetch("https://auth.polar.com/oauth/token", {
      method: "POST",
      headers: {
        Authorization: `Basic ${credentials}`,
        "Content-Type": "application/x-www-form-urlencoded",
        Accept: "application/json"
      },
      body: body.toString()
    });
    const responseText = await response.text();
    console.log("Polar token HTTP status:", response.status);
    if (!response.ok) {
      // Do not log raw response bodies in case a provider response ever includes sensitive data.
      console.error("Polar token exchange rejected by Polar.");
      return res.status(500).send(`Polar token exchange failed. HTTP ${response.status}. Check Render logs.`);
    }

    const tokenData = JSON.parse(responseText);
    polarTokens = {
      access_token: tokenData.access_token,
      refresh_token: tokenData.refresh_token
    };
    tokenExpiresAt = Date.now() + (Number(tokenData.expires_in || 43199) * 1000);
    console.log("Token exchange SUCCESS.");
    console.log("Token type:", tokenData.token_type);
    console.log("Expires in:", tokenData.expires_in);
    console.log("Scope:", tokenData.scope);

    res.send(`<h2>Polar collegato correttamente!</h2><p>Autorizzazione completata. Ora puoi verificare i dati:</p><p><a href="/polar/status">Controlla stato Polar</a></p><p><a href="/polar/sessions">Leggi allenamenti recenti</a></p><p><strong>Nota:</strong> questa versione di prova conserva i token solo finché il servizio resta attivo; non chiudere né riavviare Render prima del test.</p>`);
  } catch (error) {
    console.error("TOKEN EXCHANGE EXCEPTION:", error.message);
    res.status(500).send("Server error during Polar token exchange. Check Render logs.");
  }
});

async function ensureFreshToken() {
  if (!polarTokens || !polarTokens.access_token) return false;
  if (Date.now() < tokenExpiresAt - 60_000) return true;
  if (!polarTokens.refresh_token) return false;

  const credentials = Buffer.from(`${CLIENT_ID}:${CLIENT_SECRET}`).toString("base64");
  const body = new URLSearchParams({
    grant_type: "refresh_token",
    refresh_token: polarTokens.refresh_token
  });
  const response = await fetch("https://auth.polar.com/oauth/token", {
    method: "POST",
    headers: {
      Authorization: `Basic ${credentials}`,
      "Content-Type": "application/x-www-form-urlencoded",
      Accept: "application/json"
    },
    body: body.toString()
  });
  if (!response.ok) {
    console.error("Polar token refresh failed. HTTP", response.status);
    return false;
  }
  const refreshed = await response.json();
  polarTokens = {
    access_token: refreshed.access_token,
    refresh_token: refreshed.refresh_token || polarTokens.refresh_token
  };
  tokenExpiresAt = Date.now() + (Number(refreshed.expires_in || 43199) * 1000);
  return true;
}

app.get("/polar/status", async (req, res) => {
  if (!polarTokens) return res.status(401).json({ connected: false, message: "Polar non autorizzato in questa sessione del server. Apri /oauth/start." });
  const ok = await ensureFreshToken();
  if (!ok) return res.status(401).json({ connected: false, message: "Token assente o scaduto. Ricollega Polar da /oauth/start." });
  res.json({ connected: true, message: "Token presente sul backend; nessun token viene mostrato." });
});

app.get("/polar/sessions", async (req, res) => {
  try {
    if (!polarTokens) return res.status(401).json({ connected: false, message: "Polar non autorizzato in questa sessione del server. Apri /oauth/start." });
    const ok = await ensureFreshToken();
    if (!ok) return res.status(401).json({ connected: false, message: "Token assente o scaduto. Ricollega Polar da /oauth/start." });

    const to = new Date();
    const from = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const params = new URLSearchParams({
  from: from.toISOString().slice(0, 10),
  to: to.toISOString().slice(0, 10)
});
    const response = await fetch(`https://www.polaraccesslink.com/v4/data/training-sessions/list?${params.toString()}`, {
      headers: { Authorization: `Bearer ${polarTokens.access_token}`, Accept: "application/json" }
    });
    const responseText = await response.text();
    console.log("Polar sessions HTTP status:", response.status);
    if (response.status === 204) return res.json({ connected: true, count: 0, trainingSessions: [] });
    if (!response.ok) {
      console.error("Polar sessions request failed. HTTP", response.status);
      return res.status(response.status).json({ connected: true, error: "Polar non ha restituito gli allenamenti.", httpStatus: response.status, details: responseText.slice(0, 500) });
    }
    const data = JSON.parse(responseText);
    const sessions = data.trainingSessions || data.training_sessions || [];
    res.json({ connected: true, count: sessions.length, trainingSessions: sessions });
  } catch (error) {
    console.error("POLAR SESSIONS EXCEPTION:", error.message);
    res.status(500).json({ error: "Errore durante la lettura degli allenamenti Polar." });
  }
});

app.listen(PORT, "0.0.0.0", () => {
  console.log(`Pierino Coach Polar backend listening on port ${PORT}`);
});
