# AI Assistant MVP

Minimal, safe MVP:
- Frontend: static HTML/CSS/JS
- Backend: FastAPI + SQLModel + JWT
- Connectors: Email (SMTP), Telegram bot, WhatsApp (Twilio)
- Safety: crisis keyword detector (opt-in escalation), rate limit, owner pass-key gate

## Structure

```
ai-assistant-mvp/
├─ .env.example
├─ README.md
├─ backend/
│  ├─ pyproject.toml
│  ├─ app/
│  │  ├─ main.py
│  │  ├─ db.py
│  │  ├─ models.py
│  │  ├─ auth.py
│  │  ├─ schemas.py
│  │  ├─ security.py
│  │  ├─ rate_limit.py
│  │  ├─ crisis.py
│  │  └─ connectors/
│  │     ├─ email_sender.py
│  │     ├─ telegram_bot.py
│  │     └─ whatsapp_twilio.py
│  └─ alembic/ (optional)
└─ frontend/
   ├─ index.html
   ├─ styles.css
   └─ app.js
```

## Run (local)

1) Copy `.env.example` to `backend/.env` and fill in secrets (at least `JWT_SECRET`).

2) Backend:

```bash
cd backend
# Poetry (recommended)
poetry install
poetry run uvicorn app.main:app --reload --port 8000

# OR with pip/venv
python -m venv .venv
# Windows PowerShell:
. .venv/Scripts/Activate.ps1
# macOS/Linux:
source .venv/bin/activate

pip install fastapi "uvicorn[standard]" python-dotenv passlib[bcrypt] pyjwt sqlite-utils sqlmodel httpx aiosmtplib
uvicorn app.main:app --reload --port 8000
```

3) Frontend (static):

```bash
cd ../frontend
python -m http.server 5173
# open http://127.0.0.1:5173
```

Notes:
- Web Speech API requires a user click to start listening.
- Crisis escalation only if the user opted in and provided a trusted contact.
- WhatsApp/Telegram/Email require valid credentials.
