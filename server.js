const express = require('express');
const crypto = require('crypto');

const app = express();
const PORT = process.env.PORT || 3000;

const CLIENT_ID = process.env.POLAR_CLIENT_ID;
const CLIENT_SECRET = process.env.POLAR_CLIENT_SECRET;
const REDIRECT_URI = process.env.POLAR_REDIRECT_URI;

function b64url(buffer) {
  return buffer.toString('base64').replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
}

function createState() {
  const payload = Buffer.from(JSON.stringify({
    iat: Date.now(),
    nonce: crypto.randomBytes(16).toString('hex')
  })).toString('base64url');
  const signature = crypto.createHmac('sha256', CLIENT_SECRET).update(payload).digest('base64url');
  return `${payload}.${signature}`;
}

function validState(state) {
  if (!state || !state.includes('.')) return false;
  const [payload, signature] = state.split('.');
  if (!payload || !signature) return false;

  const expected = crypto.createHmac('sha256', CLIENT_SECRET).update(payload).digest('base64url');
  const a = Buffer.from(signature);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return false;

  try {
    const data = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    return Date.now() - data.iat < 10 * 60 * 1000;
  } catch {
    return false;
  }
}

app.get('/', (req, res) => {
  res.send('Pierino Coach Polar backend OK');
});

app.get('/oauth/start', (req, res) => {
  if (!CLIENT_ID || !CLIENT_SECRET || !REDIRECT_URI) {
    return res.status(500).send('Missing Polar environment variables.');
  }

  const state = createState();
  const params = new URLSearchParams({
    client_id: CLIENT_ID,
    response_type: 'code',
    scope: 'activity:read training_sessions:read profile:read',
    redirect_uri: REDIRECT_URI,
    state
  });

  res.redirect(`https://auth.polar.com/oauth/authorize?${params.toString()}`);
});

app.get('/oauth/callback', async (req, res) => {
  const { code, state, error, error_description } = req.query;

  if (!validState(state)) {
    return res.status(400).send('Invalid or expired OAuth state. Start again from /oauth/start');
  }

  if (error) {
    return res.status(400).send(`Polar authorization error: ${error}${error_description ? ` - ${error_description}` : ''}`);
  }

  if (!code) {
    return res.status(400).send('Missing authorization code.');
  }

  try {
    const basic = Buffer.from(`${CLIENT_ID}:${CLIENT_SECRET}`).toString('base64');
    const body = new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      redirect_uri: REDIRECT_URI
    });

    const tokenResponse = await fetch('https://auth.polar.com/oauth/token', {
      method: 'POST',
      headers: {
        Authorization: `Basic ${basic}`,
        'Content-Type': 'application/x-www-form-urlencoded'
      },
      body
    });

    const text = await tokenResponse.text();
    if (!tokenResponse.ok) {
      console.error('Polar token error:', tokenResponse.status, text);
      return res.status(500).send('Polar token exchange failed. Check Render logs.');
    }

    console.log('Polar authorization successful. Token received.');
    res.send('Polar authorization completed successfully. You can return to Pierino Coach.');
  } catch (err) {
    console.error('OAuth callback error:', err);
    res.status(500).send('OAuth callback failed. Check Render logs.');
  }
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`Pierino Coach Polar backend listening on port ${PORT}`);
});

