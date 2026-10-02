# Pierino Coach – Polar backend

## Render
Runtime: Node
Build Command: `npm install`
Start Command: `npm start`
Plan: Free

## Environment variables
POLAR_CLIENT_ID = your Polar Client ID
POLAR_CLIENT_SECRET = your Polar Client Secret
POLAR_REDIRECT_URI = https://YOUR-SERVICE.onrender.com/oauth/callback

Never commit the Client Secret to GitHub.

OAuth flow:
Android -> /oauth/start -> Polar -> /oauth/callback -> /oauth/status
