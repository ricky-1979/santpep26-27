# SantPep 26-27

Horaris de pretemporada i temporada 26-27 del CB Sant Josep de Badalona,
per a consulta dels coachs.

**Web pública:** https://ricky-1979.github.io/santpep26-27/horaris.html

- `horaris.html` — pàgina de consulta d'horaris (dades incrustades).
- Publicat amb GitHub Actions (`.github/workflows/pages.yml`).

## Avisos WhatsApp de canvis al calendari

El workflow `Actualitza partits` pot enviar un WhatsApp quan detecta canvis a
`partits.html` despres d'importar els calendaris. Si no hi ha secrets de Twilio
configurats, el pas no envia res i el workflow continua.

Secrets necessaris a GitHub Actions:

- `TWILIO_ACCOUNT_SID`
- `TWILIO_AUTH_TOKEN`
- `TWILIO_WHATSAPP_FROM` amb format `whatsapp:+14155238886` o `+14155238886`
- `WHATSAPP_RECIPIENTS` com a JSON (`["+34600111222"]`) o llista separada per
  comes/salts de linia

Per provar amb el sandbox de Twilio, cada destinatari ha d'haver fet abans
l'alta al sandbox seguint les instruccions de Twilio.
