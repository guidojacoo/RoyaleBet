# royalebet (evolution api v2)

## requisitos
- ubuntu 22+ con docker y docker compose
- node 20+, postgres 14+
- token clash royale
- un numero de whatsapp dedicado (no tu personal)

## 1) clonar e instalar
```bash
git clone https://tu-repo.git royalebet
cd royalebet
cp .env.example .env
# edita .env (EVOLUTION_API_KEY, PUBLIC_BASE_URL, DATABASE_URL, CLASH_TOKEN, ADMIN_JIDS, GROUP_ID)
