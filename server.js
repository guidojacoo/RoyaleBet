// royalebet v2 - evolution api (grupos), verificacion clash, pagos manuales
import 'dotenv/config'
import express from 'express'
import axios from 'axios'
import { Pool } from 'pg'

const app = express()
app.use(express.json({ limit: '5mb' }))
app.use(express.urlencoded({ extended: true }))

// env
const EVO_BASE = process.env.EVOLUTION_URL || 'http://127.0.0.1:8080'
const EVO_KEY  = process.env.EVOLUTION_API_KEY
const INSTANCE = process.env.EVOLUTION_INSTANCE || 'royalebet'
const GROUP_ID = process.env.GROUP_ID || ''                           // 1203...@g.us
const ADMIN_JIDS = (process.env.ADMIN_JIDS || '').split(',').map(s=>s.trim()).filter(Boolean)
const PUBLIC_BASE = process.env.PUBLIC_BASE_URL || ''                 // https://.../evo-webhook
const WEBHOOK_SECRET = process.env.WEBHOOK_SECRET || 'whsec'
const PORT = process.env.PORT || 3000

const CR_API   = process.env.CLASH_API || 'https://api.clashroyale.com/v1'
const CR_TOKEN = process.env.CLASH_TOKEN
const CR_HEADERS = { Authorization: `Bearer ${CR_TOKEN}` }

const pool = new Pool({ connectionString: process.env.DATABASE_URL })
const q = async (sql, p=[]) => (await pool.query(sql, p)).rows

// ensure schema (por si falta correr sql_init.sql)
await pool.query(`
CREATE TABLE IF NOT EXISTS usuarios(
  jid text PRIMARY KEY, username text, clash_tag text, saldo int DEFAULT 0, created_at timestamptz DEFAULT now()
);
CREATE TABLE IF NOT EXISTS mesas(
  id bigserial PRIMARY KEY, creador text NOT NULL, oponente text,
  fichas int NOT NULL, estado text NOT NULL DEFAULT 'abierta',
  premio int NOT NULL, rake int NOT NULL DEFAULT 10,
  creador_tag text, oponente_tag text,
  started_at timestamptz, ended_at timestamptz,
  ganador text, duracion_seg int, created_at timestamptz DEFAULT now()
);
CREATE TABLE IF NOT EXISTS depositos(
  id bigserial PRIMARY KEY, jid text NOT NULL, monto int NOT NULL, estado text NOT NULL DEFAULT 'pendiente', media_url text, created_at timestamptz DEFAULT now()
);
CREATE TABLE IF NOT EXISTS retiros(
  id bigserial PRIMARY KEY, jid text NOT NULL, monto int NOT NULL, cvu text NOT NULL, estado text NOT NULL DEFAULT 'pendiente', created_at timestamptz DEFAULT now()
);
`)

// helpers
const normTag = t => { if(!t) return null; let s=t.trim().toUpperCase(); if(s.startsWith('#')) s=s.slice(1); return '#'+s }
const encTag  = t => '%23'+normTag(t).slice(1)
const isAdmin = jid => ADMIN_JIDS.includes(jid)
const mention = jid => `@${(jid.split('@')[0]||'')}`

async function sendTextJid(jid, text){
  // evolution sendText (v2): POST /message/sendText/{instance} con body {number,text} y header apikey
  // doc: https://doc.evolution-api.com/v2/api-reference/message-controller/send-text
  await axios.post(
    `${EVO_BASE}/message/sendText/${INSTANCE}`,
    { number: jid, text },
    { headers: { 'Content-Type':'application/json', apikey: EVO_KEY }, timeout: 10000 }
  )
}

async function sendGroup(text){
  if (!GROUP_ID) return
  return sendTextJid(GROUP_ID, text)
}

async function battlelog(tag){
  const { data } = await axios.get(`${CR_API}/players/${encTag(tag)}/battlelog`, { headers: CR_HEADERS, timeout: 10000 })
  return Array.isArray(data) ? data : []
}
const parseBattleTime = s => { const d=new Date(s); return isNaN(d.getTime())?new Date():d }
const extract = b => ({
  teamTag: b.team?.[0]?.tag ? '#'+String(b.team[0].tag).toUpperCase() : null,
  oppTag:  b.opponent?.[0]?.tag ? '#'+String(b.opponent[0].tag).toUpperCase() : null,
  teamCrowns: b.team?.[0]?.crowns ?? null,
  oppCrowns:  b.opponent?.[0]?.crowns ?? null
})
async function findMatchBetween(tagA, tagB, startedAt){
  const A=normTag(tagA), B=normTag(tagB)
  const tol=2*60*1000, since=new Date((startedAt?new Date(startedAt).getTime():Date.now())-tol)
  const cand=[...(await battlelog(A)), ...(await battlelog(B))]
  for(const b of cand){
    const t=parseBattleTime(b.battleTime); if (t<since) continue
    const {teamTag,oppTag,teamCrowns,oppCrowns}=extract(b)
    if (!teamTag||!oppTag) continue
    const set=new Set([teamTag,oppTag]); if (!set.has(A)||!set.has(B)) continue
    let winner=null
    if (teamTag===A) { if (teamCrowns>oppCrowns) winner=A; else if (oppCrowns>teamCrowns) winner=B }
    else if (oppTag===A) { if (oppCrowns>teamCrowns) winner=A; else if (teamCrowns>oppCrowns) winner=B }
    return { when:t, winnerTag:winner }
  }
  return null
}

function menu(u){
  return `bienvenido ${u?.username||u?.jid||''}

1) menu
2) cargar fichas
3) crear sala
4) unirme a sala
5) mi saldo
6) configurar usuario/tag
7) retirar

comandos:
usuario <nombre>
tag <#ABC123>
mesa <fichas>
unirme <id>
cancelar <id>
verificar <id>
saldo
retirar <monto> <cvu>`
}

function bienvenida(){
  return `hola! te explico rapido:

- para jugar 1v1 necesito tu usuario y tu tag de clash royale.
- como sacar tu tag:
  1) abre clash royale
  2) toca tu perfil
  3) copia el tag que empieza con # (ej: #ABC123)

registrate enviando:
usuario <tu_nombre>
tag <#TU_TAG>

cuando termines, manda "menu".`
}

// evo webhook (entrantes). formato general v2, ver docs de webhooks.
// vamos a tolerar estructuras distintas y extraer: remoteJid, fromMe, text/imagem, etc.
app.post('/evo-webhook', async (req, res) => {
  try{
    // seguridad simple
    if (WEBHOOK_SECRET && req.headers['x-webhook-secret'] !== WEBHOOK_SECRET) {
      return res.sendStatus(401)
    }

    const payload = req.body || {}
    // evolution puede mandar uno o varios eventos. normalizamos como array
    const events = Array.isArray(payload) ? payload : (payload.events || [payload])
    for (const ev of events) {
      const msg = ev?.message || ev?.data || ev // segun version
      const remoteJid = msg?.key?.remoteJid || msg?.remoteJid || ev?.remoteJid
      const fromMe = msg?.key?.fromMe || msg?.fromMe || false

      // ignorar mensajes del propio bot
      if (!remoteJid || fromMe) continue

      // solo procesamos DM (jid persona termina con @s.whatsapp.net)
      const isGroup = remoteJid.endsWith('@g.us')
      if (isGroup) continue

      const text =
        msg?.message?.conversation ||
        msg?.message?.extendedTextMessage?.text ||
        ev?.text ||
        ''

      const mediaUrl =
        msg?.message?.imageMessage?.url ||
        msg?.message?.documentMessage?.url ||
        null

      await routeUser(remoteJid, text.trim().toLowerCase(), mediaUrl)
    }
    res.sendStatus(200)
  }catch(e){
    console.log('webhook err', e.message)
    res.sendStatus(200)
  }
})

async function upsertUser(jid){
  const u = (await q('select * from usuarios where jid=$1',[jid]))[0]
  if (u) return u
  return (await q('insert into usuarios(jid) values($1) returning *',[jid]))[0]
}

async function getUser(jid){ return (await q('select * from usuarios where jid=$1',[jid]))[0] }

async function routeUser(jid, body, mediaUrl){
  const user = await upsertUser(jid)

  // imagen = comprobante
  if (mediaUrl){
    const dep = (await q('select * from depositos where jid=$1 and estado=$2 order by id desc limit 1',[jid,'pendiente']))[0]
    if (!dep){ await sendTextJid(jid, 'no tenes depositos pendientes. primero: "cargar <monto>"'); return }
    await q('update depositos set media_url=$1 where id=$2',[mediaUrl, dep.id])
    await sendTextJid(jid, `recibi el comprobante del deposito #${dep.id}. un admin lo revisa y acredita.`)
    for (const a of ADMIN_JIDS) await sendTextJid(a, `comprobante deposito #${dep.id}\nuser: ${jid}\nmonto: ${dep.monto}\n${mediaUrl}`)
    return
  }

  if (!body || body==='hola'){
    await sendTextJid(jid, bienvenida())
    await sendTextJid(jid, menu(user))
    return
  }

  if (isAdmin(jid)){ await handleAdmin(jid, body); return }

  if (['1','menu','m'].includes(body)) return sendTextJid(jid, menu(user))

  if (body.startsWith('usuario ')){
    const name = body.slice(8).trim().slice(0,20)
    await q('update usuarios set username=$1 where jid=$2',[name, jid])
    const u = await getUser(jid)
    await sendTextJid(jid, `listo ${u.username||''}.`)
    return sendTextJid(jid, menu(u))
  }

  if (body.startsWith('tag ')){
    const tag = normTag(body.slice(4))
    if (!tag || !/^#[A-Z0-9]+$/.test(tag)) return sendTextJid(jid, 'tag invalido. ej: tag #ABC123')
    await q('update usuarios set clash_tag=$1 where jid=$2',[tag, jid])
    const u = await getUser(jid)
    await sendTextJid(jid, `guardado tu tag ${u.clash_tag}.`)
    return sendTextJid(jid, menu(u))
  }

  if (['2','cargar','cargar fichas'].includes(body) || body.startsWith('cargar ')){
    const parts = body.split(/\s+/)
    const monto = parseInt(parts[1]||'0',10)
    if (!monto){
      return sendTextJid(jid,
        `para cargar:\n- transfiere al alias/cvu indicado\n- envia una **imagen** del comprobante aca\n- un admin acredita\n\nsi queres abrir ticket: "cargar 500"`)
    }
    const dep = (await q('insert into depositos(jid,monto) values($1,$2) returning id',[jid,monto]))[0]
    await sendTextJid(jid, `ticket #${dep.id} por ${monto} creado. envia ahora la **imagen** del comprobante.`)
    for (const a of ADMIN_JIDS) await sendTextJid(a, `nuevo deposito #${dep.id}\nuser: ${jid}\nmonto: ${monto}\nestado: pendiente`)
    return
  }

  if (['7','retirar'].includes(body) || body.startsWith('retirar ')){
    const parts = body.split(/\s+/)
    const monto = parseInt(parts[1]||'0',10)
    const cvu   = parts.slice(2).join(' ').trim()
    if (!monto || !cvu) return sendTextJid(jid, 'formato: retirar <monto> <cvu/alias>')
    const u = await getUser(jid)
    if (u.saldo < monto) return sendTextJid(jid, `no te alcanza. saldo: ${u.saldo}`)
    const r = (await q('insert into retiros(jid,monto,cvu) values($1,$2,$3) returning id',[jid,monto,cvu]))[0]
    for (const a of ADMIN_JIDS) await sendTextJid(a, `retiro #${r.id}\nuser: ${jid}\nmonto: ${monto}\ncvu: ${cvu}\nestado: pendiente`)
    return sendTextJid(jid, `retiro #${r.id} enviado a admins. te avisamos cuando se pague.`)
  }

  if (['3','crear','crear sala'].includes(body) || body.startsWith('mesa ') || body.startsWith('crear ')){
    const parts = body.split(/\s+/)
    const fichas = parseInt(parts[1]||'0',10)
    if (!fichas || fichas<=0) return sendTextJid(jid, 'formato: mesa <fichas>')
    const u = await getUser(jid)
    if (!u.clash_tag) return sendTextJid(jid, 'primero guarda tu tag: tag #ABC123')
    if (u.saldo < fichas) return sendTextJid(jid, `no te alcanza. saldo: ${u.saldo}`)
    const rake=10, premio=(fichas*2) - Math.floor((fichas*2)*rake/100)
    const r = (await q('insert into mesas(creador,fichas,premio,rake,creador_tag) values($1,$2,$3,$4,$5) returning id',[jid,fichas,premio,rake,u.clash_tag]))[0]
    await q('update usuarios set saldo = saldo - $1 where jid=$2',[fichas, jid])
    await sendTextJid(jid, `creaste la mesa #${r.id} (${fichas} fichas). para unirse: "unirme ${r.id}"`)
    if (GROUP_ID){
      await sendGroup(`[mesa #${r.id}] ${fichas} vs ${fichas}
premio neto: ${premio} (rake ${rake}%)
creador: ${mention(jid)}
para unirse: "unirme ${r.id}"`)
    } else {
      for (const a of ADMIN_JIDS) await sendTextJid(a, `[reenviar al grupo]\nmesa #${r.id} por ${fichas} fichas\npremio ${premio}\ncreador ${jid}`)
    }
    return
  }

  if (['4','unirme'].includes(body) || body.startsWith('unirme ')){
    const id = parseInt(body.split(/\s+/)[1]||'0',10)
    if (!id) return sendTextJid(jid, 'formato: unirme <id>')
    const mesa = (await q('select * from mesas where id=$1',[id]))[0]
    if (!mesa) return sendTextJid(jid, `no existe la mesa #${id}`)
    if (mesa.estado!=='abierta') return sendTextJid(jid, `la mesa #${id} no esta abierta`)
    if (mesa.creador===jid) return sendTextJid(jid, 'no podes unirte a tu propia mesa')
    const u = await getUser(jid)
    if (!u.clash_tag) return sendTextJid(jid, 'primero guarda tu tag: tag #ABC123')
    if (u.saldo < mesa.fichas) return sendTextJid(jid, `no te alcanza. saldo: ${u.saldo}`)

    await q('update usuarios set saldo = saldo - $1 where jid=$2',[mesa.fichas, jid])
    await q('update mesas set oponente=$1, oponente_tag=$2, estado=$3, started_at=now() where id=$4',[jid,u.clash_tag,'en_juego',id])

    await sendTextJid(mesa.creador, `match listo en mesa #${id}!\noponente: ${jid}\ncuando terminen: verificar ${id}`)
    await sendTextJid(jid, `entraste a mesa #${id}. creador: ${mesa.creador}\ncuando terminen: verificar ${id}`)
    if (GROUP_ID) await sendGroup(`mesa #${id} ahora en juego. suerte!`)
    return
  }

  if (body.startsWith('cancelar ')){
    const id = parseInt(body.split(/\s+/)[1]||'0',10)
    if (!id) return sendTextJid(jid, 'formato: cancelar <id>')
    const mesa = (await q('select * from mesas where id=$1',[id]))[0]
    if (!mesa) return sendTextJid(jid, `no existe la mesa #${id}`)
    if (mesa.creador!==jid) return sendTextJid(jid, 'solo el creador puede cancelar')
    if (mesa.estado!=='abierta') return sendTextJid(jid, 'la mesa ya no se puede cancelar')
    await q('update mesas set estado=$1 where id=$2',['cancelada',id])
    await q('update usuarios set saldo = saldo + $1 where jid=$2',[mesa.fichas, jid])
    await sendTextJid(jid, `mesa #${id} cancelada. devolvimos ${mesa.fichas} fichas.`)
    if (GROUP_ID) await sendGroup(`mesa #${id} cancelada por el creador.`)
    return
  }

  if (body.startsWith('verificar ')){
    const id = parseInt(body.split(/\s+/)[1]||'0',10)
    if (!id) return sendTextJid(jid, 'formato: verificar <id>')
    const mesa = (await q('select * from mesas where id=$1',[id]))[0]
    if (!mesa) return sendTextJid(jid, `no existe la mesa #${id}`)
    if (mesa.estado!=='en_juego') return sendTextJid(jid, `la mesa #${id} no esta en juego`)
    if (!mesa.creador_tag || !mesa.oponente_tag) return sendTextJid(jid, 'faltan tags, configuren con: tag #ABC123')

    try{
      const match = await findMatchBetween(mesa.creador_tag, mesa.oponente_tag, mesa.started_at)
      if (!match) { await sendTextJid(jid, 'no encontre la partida en battlelog aun. intenten de nuevo en 1-2 minutos.'); return }
      if (!match.winnerTag){
        for (const a of ADMIN_JIDS) await sendTextJid(a, `empate detectado mesa #${id}. decidir manual con: aprobarwin ${id} <jid>`)
        await sendTextJid(jid, 'aparecio como empate. un admin decidira el ganador.')
        return
      }
      let ganador=null
      if (normTag(mesa.creador_tag)===match.winnerTag) ganador=mesa.creador
      if (normTag(mesa.oponente_tag)===match.winnerTag) ganador=mesa.oponente
      if (!ganador){ for (const a of ADMIN_JIDS) await sendTextJid(a, `no pude mapear ganador en mesa #${id}. usar: aprobarwin ${id} <jid>`); await sendTextJid(jid,'hubo un problema mapeando el ganador. admin decidira.'); return }

      await q('update mesas set estado=$1, ganador=$2, ended_at=now() where id=$3',['finalizada',ganador,id])
      await q('update usuarios set saldo = saldo + $1 where jid=$2',[mesa.premio, ganador])

      await sendTextJid(mesa.creador, `resultado mesa #${id}: ganador ${ganador}. premio ${mesa.premio}`)
      if (mesa.oponente) await sendTextJid(mesa.oponente, `resultado mesa #${id}: ganador ${ganador}. premio ${mesa.premio}`)
      if (GROUP_ID) await sendGroup(`resultado mesa #${id}: ganador ${mention(ganador)} | premio ${mesa.premio}`)
      return
    }catch(e){
      for (const a of ADMIN_JIDS) await sendTextJid(a, `error battlelog mesa #${id}: ${e.message}. usar: aprobarwin ${id} <jid>`)
      await sendTextJid(jid, 'error consultando battlelog. intenta luego o habla con admin.')
      return
    }
  }

  if (['5','saldo'].includes(body)){
    const u = await getUser(jid)
    return sendTextJid(jid, `tu saldo: ${u.saldo} fichas`)
  }

  return sendTextJid(jid, `no te entendi. escribe "menu".`)
}

async function handleAdmin(jid, body){
  if (body==='panel'){
    return sendTextJid(jid, `panel admin:
cargar <jid> <monto> [id_dep]
debitar <jid> <monto>
aprobarwin <id_mesa> <jid_ganador>
pagar <id_retiro>
rechazar <id>`)
  }

  if (body.startsWith('cargar ')){
    const p=body.split(/\s+/); const target=p[1]; const monto=parseInt(p[2]||'0',10); const depId=parseInt(p[3]||'0',10)
    if (!target||!monto) return sendTextJid(jid,'uso: cargar <jid> <monto> [id_deposito]')
    await q('update usuarios set saldo = saldo + $1 where jid=$2',[monto,target])
    if (depId) await q('update depositos set estado=$1 where id=$2',['aprobado',depId])
    await sendTextJid(target, `✅ acreditamos ${monto} fichas. escribe "menu" para ver opciones.`)
    return sendTextJid(jid, `ok, ${monto} a ${target}${depId?` y deposito #${depId} aprobado`:''}`)
  }

  if (body.startsWith('debitar ')){
    const p=body.split(/\s+/); const target=p[1]; const monto=parseInt(p[2]||'0',10)
    if (!target||!monto) return sendTextJid(jid,'uso: debitar <jid> <monto>')
    await q('update usuarios set saldo = greatest(0, saldo - $1) where jid=$2',[monto,target])
    await sendTextJid(target, `⚠️ se debitaron ${monto} fichas por ajuste.`)
    return sendTextJid(jid, `ok, debitadas ${monto} a ${target}`)
  }

  if (body.startsWith('aprobarwin ')){
    const p=body.split(/\s+/); const id=parseInt(p[1]||'0',10); const ganador=p[2]
    if (!id||!ganador) return sendTextJid(jid,'uso: aprobarwin <id_mesa> <jid_ganador>')
    const mesa=(await q('select * from mesas where id=$1',[id]))[0]
    if (!mesa) return sendTextJid(jid,`no existe mesa #${id}`)
    if (mesa.estado==='finalizada') return sendTextJid(jid,`mesa #${id} ya finalizada`)
    await q('update mesas set estado=$1, ganador=$2, ended_at=now() where id=$3',['finalizada',ganador,id])
    await q('update usuarios set saldo = saldo + $1 where jid=$2',[mesa.premio,ganador])
    await sendTextJid(mesa.creador, `resultado mesa #${id} (admin): ganador ${ganador}. premio ${mesa.premio}`)
    if (mesa.oponente) await sendTextJid(mesa.oponente, `resultado mesa #${id} (admin): ganador ${ganador}. premio ${mesa.premio}`)
    if (GROUP_ID) await sendGroup(`resultado mesa #${id} (admin): ganador ${mention(ganador)} | premio ${mesa.premio}`)
    return sendTextJid(jid, 'ok, ganador seteado y premio acreditado.')
  }

  if (body.startsWith('pagar ')){
    const id=parseInt(body.split(/\s+/)[1]||'0',10)
    const r=(await q('select * from retiros where id=$1',[id]))[0]
    if (!r) return sendTextJid(jid,`no existe retiro #${id}`)
    if (r.estado!=='pendiente') return sendTextJid(jid,`retiro #${id} no esta pendiente`)
    await q('update usuarios set saldo = saldo - $1 where jid=$2',[r.monto,r.jid])
    await q('update retiros set estado=$1 where id=$2',['pagado',id])
    await sendTextJid(r.jid, `✅ retiro #${id} pagado por ${r.monto}. gracias!`)
    return sendTextJid(jid, `ok, retiro #${id} pagado`)
  }

  if (body.startsWith('rechazar ')){
    const id=parseInt(body.split(/\s+/)[1]||'0',10)
    const d=(await q('update depositos set estado=$1 where id=$2 and estado=$3 returning jid',['rechazado',id,'pendiente']))
    if (d.length){ await sendTextJid(d[0].jid, `❌ tu deposito #${id} fue rechazado`); return sendTextJid(jid, `rechazado deposito #${id}`) }
    const r=(await q('update retiros set estado=$1 where id=$2 and estado=$3 returning jid',['rechazado',id,'pendiente']))
    if (r.length){ await sendTextJid(r[0].jid, `❌ tu retiro #${id} fue rechazado`); return sendTextJid(jid, `rechazado retiro #${id}`) }
    return sendTextJid(jid, `no encontre pendiente #${id}`)
  }

  return sendTextJid(jid,'comando admin no reconocido. escribe "panel"')
}

app.get('/', (_req,res)=>res.send('ok'))
app.listen(PORT, ()=>console.log('bot listo en puerto', PORT))
