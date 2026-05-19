# Google login setup

This app is configured for Google-only login by default.

1. Create an OAuth 2.0 Client ID in Google Cloud Console.
2. Choose **Web application**.
3. Add your exact app origin under **Authorized JavaScript origins**.
   - Local: `http://localhost:5000`
   - Hosted: `https://your-domain.com`
4. Put that client id in `.env` as `GOOGLE_CLIENT_ID`.
5. Keep `ALLOW_PASSWORD_AUTH=false` so users can only login with Google.

If the frontend is hosted separately from the backend, also set:

```env
FRONTEND_URL=https://your-frontend-domain.com
CORS_ALLOWED_ORIGINS=https://your-frontend-domain.com
```

If the backend serves `frontend/` directly, just open the backend URL.
