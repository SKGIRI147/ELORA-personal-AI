import os, httpx

TWILIO_ACCOUNT_SID = os.getenv("TWILIO_ACCOUNT_SID")
TWILIO_AUTH_TOKEN = os.getenv("TWILIO_AUTH_TOKEN")
TWILIO_WHATSAPP_FROM = os.getenv("TWILIO_WHATSAPP_FROM")  # e.g. 'whatsapp:+14155238886'

async def send_whatsapp(to: str, text: str):
    if not all([TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_WHATSAPP_FROM]):
        raise RuntimeError("Twilio WhatsApp env not set")
    url = f"https://api.twilio.com/2010-04-01/Accounts/{TWILIO_ACCOUNT_SID}/Messages.json"
    auth = (TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN)
    data = {"From": TWILIO_WHATSAPP_FROM, "To": f"whatsapp:{to}", "Body": text}
    async with httpx.AsyncClient(timeout=15, auth=auth) as client:
        r = await client.post(url, data=data)
        r.raise_for_status()
        return r.json()
