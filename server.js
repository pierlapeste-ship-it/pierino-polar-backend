




const express = require("express");
const crypto = require("crypto");

const app = express();
const PORT = process.env.PORT || 10000;

const CLIENT_ID = process.env.POLAR_CLIENT_ID;
const CLIENT_SECRET = process.env.POLAR_CLIENT_SECRET;
const REDIRECT_URI = process.env.POLAR_REDIRECT_URI;

// Token temporanei: si perdono se Render riavvia il servizio.
let polarTokens = null;
let tokenExpiresAt = 0;

app.get("/", (req, res) => {
  res.send("Pierino Coach Polar backend OK");
});

app.get("/oauth/start", (req, res) => {
  if (!CLIENT_ID || !REDIRECT_URI) {
    return res.status(500).send(
      "Configurazione Polar mancante nelle variabili Render."
    );
  }

  const state = crypto.randomBytes(24).toString("hex");

  const params = new URLSearchParams({
    client_id: CLIENT_ID,
    response_type: "code",
    scope: "activity:read training_sessions:read profile:read",
    redirect_uri: REDIRECT_URI,
    state
  });

  res.redirect(
    `https://auth.polar.com/oauth/authorize?${params.toString()}`
  );
});

app.get("/oauth/callback", async (req, res) => {
  try {
    if (req.query.error) {
      return res.status(400).send(
        "Autorizzazione Polar non completata."
      );
    }

    if (!req.query.code) {
      return res.status(400).send(
        "Codice di autorizzazione mancante."
      );
    }

    if (!CLIENT_ID || !CLIENT_SECRET || !REDIRECT_URI) {
      return res.status(500).send(
        "Configurazione Polar mancante nelle variabili Render."
      );
    }

    const credentials = Buffer.from(
      `${CLIENT_ID}:${CLIENT_SECRET}`
    ).toString("base64");

    const body = new URLSearchParams({
      grant_type: "authorization_code",
      code: String(req.query.code),
      redirect_uri: REDIRECT_URI
    });

    const response = await fetch(
      "https://auth.polar.com/oauth/token",
      {
        method: "POST",
        headers: {
          Authorization: `Basic ${credentials}`,
          "Content-Type": "application/x-www-form-urlencoded",
          Accept: "application/json"
        },
        body: body.toString()
      }
    );

    const responseText = await response.text();

    console.log("Polar token HTTP status:", response.status);

    if (!response.ok) {
      console.error("Polar token exchange failed.");
      return res.status(502).send(
        `Collegamento Polar fallito. HTTP ${response.status}.`
      );
    }

    const tokenData = JSON.parse(responseText);

    if (!tokenData.access_token) {
      return res.status(502).send(
        "Polar non ha restituito il token di accesso."
      );
    }

    polarTokens = {
      access_token: tokenData.access_token,
      refresh_token: tokenData.refresh_token || null
    };

    tokenExpiresAt =
      Date.now() + Number(tokenData.expires_in || 43199) * 1000;

    console.log("Polar token exchange SUCCESS.");

    res.send(`
      <h2>Polar collegato correttamente!</h2>
      <p><a href="/polar/status">Controlla stato Polar</a></p>
      <p><a href="/polar/sessions">Leggi gli allenamenti</a></p>
      <p>I token sono temporanei e possono perdersi al riavvio.</p>
    `);
  } catch (error) {
    console.error("OAuth callback error:", error.message);
    res.status(500).send(
      "Errore durante il collegamento Polar."
    );
  }
});

async function ensureFreshToken() {
  if (!polarTokens || !polarTokens.access_token) {
    return false;
  }

  if (Date.now() < tokenExpiresAt - 60000) {
    return true;
  }

  if (!polarTokens.refresh_token ||
      !CLIENT_ID ||
      !CLIENT_SECRET) {
    return false;
  }

  const credentials = Buffer.from(
    `${CLIENT_ID}:${CLIENT_SECRET}`
  ).toString("base64");

  const body = new URLSearchParams({
    grant_type: "refresh_token",
    refresh_token: polarTokens.refresh_token
  });

  const response = await fetch(
    "https://auth.polar.com/oauth/token",
    {
      method: "POST",
      headers: {
        Authorization: `Basic ${credentials}`,
        "Content-Type": "application/x-www-form-urlencoded",
        Accept: "application/json"
      },
      body: body.toString()
    }
  );

  if (!response.ok) {
    console.error("Polar refresh HTTP status:", response.status);
    return false;
  }

  const refreshed = await response.json();

  if (!refreshed.access_token) {
    return false;
  }

  polarTokens = {
    access_token: refreshed.access_token,
    refresh_token:
      refreshed.refresh_token || polarTokens.refresh_token
  };

  tokenExpiresAt =
    Date.now() + Number(refreshed.expires_in || 43199) * 1000;

  return true;
}

app.get("/polar/status", async (req, res) => {
  try {
    if (!polarTokens) {
      return res.status(401).json({
        connected: false,
        message: "Apri /oauth/start per collegare Polar."
      });
    }

    const ok = await ensureFreshToken();

    if (!ok) {
      return res.status(401).json({
        connected: false,
        message: "Token scaduto o non valido. Ricollega Polar."
      });
    }

    return res.json({
      connected: true,
      message: "Token presente sul backend."
    });
  } catch (error) {
    console.error("Polar status error:", error.message);
    return res.status(500).json({
      connected: false,
      error: "Errore nel controllo dello stato Polar."
    });
  }
});

app.get("/polar/sessions", async (req, res) => {
  try {
    if (!polarTokens) {
      return res.status(401).json({
        connected: false,
        message: "Apri /oauth/start per collegare Polar."
      });
    }

    const ok = await ensureFreshToken();

    if (!ok) {
      return res.status(401).json({
        connected: false,
        message: "Token scaduto o non valido. Ricollega Polar."
      });
    }

    // Date ISO 8601: AAAA-MM-GG.
    const to = new Date();
    const from = new Date(
      Date.now() - 30 * 24 * 60 * 60 * 1000
    );

    const params = new URLSearchParams({
  from: from.toISOString().slice(0, 19),
  to: to.toISOString().slice(0, 19)
});

    const url =
      "https://www.polaraccesslink.com/v4/data/training-sessions/list?" +
      params.toString();

    console.log("Polar sessions from:", params.get("from"));
    console.log("Polar sessions to:", params.get("to"));

    const response = await fetch(url, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${polarTokens.access_token}`,
        Accept: "application/json"
      }
    });

    const responseText = await response.text();

    console.log("Polar sessions HTTP status:", response.status);

    if (response.status === 204) {
      return res.json({
        connected: true,
        count: 0,
        trainingSessions: []
      });
    }

    if (!response.ok) {
      return res.status(response.status).json({
        connected: true,
        error: "Polar non ha restituito gli allenamenti.",
        httpStatus: response.status,
        details: responseText.slice(0, 500)
      });
    }

    const data = responseText
      ? JSON.parse(responseText)
      : {};

    const sessions = Array.isArray(data)
      ? data
      : (data.trainingSessions ||
         data.training_sessions ||
         []);

    return res.json({
      connected: true,
      count: sessions.length,
      trainingSessions: sessions
    });
  } catch (error) {
    console.error("Polar sessions error:", error.message);
    return res.status(500).json({
      error: "Errore durante la lettura degli allenamenti Polar."
    });
  }
});

app.listen(PORT, "0.0.0.0", () => {
  console.log(
    `Pierino Coach Polar backend listening on port ${PORT}`
  );
});
