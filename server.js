import express from "express"
import axios from "axios"
import FormData from "form-data"
import M from "./messages.js"
import {
  upsertUsuario, setUser, getByPhone, getById, addSaldo,
  crearPartida, getPartida, setRival, setEstado, setGanador, setGroupMsg,
  listarPartidasAbiertas,
  crearCarga, setCargaMedia, setCargaEstado, getCarga, getCargaPendienteUsuario,
  crearRetiro, setRetiroEstado, getRetiro
} from "./db.js"
import { buscarMatchReciente } from "./clash.js"

let app = express()
app.use(express.json())

const WURL = "https://graph.facebook.com/v20.0/" + process.env.WABA_PHONE_ID + "/messages"
const WH = { headers: { Authorization: "Bearer " + process.env.WABA_TOKEN } }
const GRAPH = "https://graph.facebook.com/v20.0"

const PRECIO = parseFloat(process.env.PRICE_PER_FICHA || "1")
const FEE   = parseFloat(process.env.FEE_PORCENTAJE || "0.10")
const ADMINS = (process.env.ADMIN_PHONES||"").split(",").map(s=>s.trim()).filter(Boolean)
const ADMINS_CONTACTO = process.env.ADMINS_CONTACTO || "admin 1, admin 2"
const PAGO_ALIAS = process.env.PAGO_ALIAS_O_CVU || "tu.alias"

function sendText(to, body){
  return axios.post(WURL, { messaging_product:"whatsapp", to, text:{ body } }, WH)
}
function replyText(to, replyToMessageId, body){
  return axios.post(WURL, {
    messaging_product:"whatsapp", to,
    context:{ message_id: replyToMessageId },
    text:{ body }
  }, WH)
}
async function postToGroupAndReturnId(body){
  const r = await axios.post(WURL, { messaging_product:"whatsapp", to: process.env.GRUPO_ID, text:{ body } }, WH)
  try { return r.data.messages[0].id } catch { return null }
}
async function sendImageById(to, mediaId, caption){
  return axios.post(WURL, { messaging_product:"whatsapp", to, image: { id: mediaId, caption } }, WH)
}
async function downloadMedia(mediaId){
  // paso 1: obtener url
  const a = await axios.get(`${GRAPH}/${mediaId}`, WH)
  const url = a.data.url
  // paso 2: descargar binario
  const b = await axios.get(url, { headers: { Authorization: "Bearer "+process.env.WABA_TOKEN }, responseType: "arraybuffer" })
  return { buffer: Buffer.from(b.data), mime: b.headers["content-type"] || "image/jpeg" }
}
async function uploadMedia(buffer, mime){
  const fd = new FormData()
  fd.append("messaging_product","whatsapp")
  fd.append("file", buffer, { filename: "comp.jpg", contentType: mime })
  fd.append("type", mime)
  const r = await axios.post(`${GRAPH}/${process.env.WABA_PHONE_ID}/media`, fd, { headers: { Authorization: "Bearer "+process.env.WABA_TOKEN, ...fd.getHeaders() } })
  return r.data.id
}

// parser
function parseCmd(msg){
  const t=(msg||"").trim()
  const l=t.toLowerCase()
  if(l==="menu") return {cmd:"menu"}
  if(l==="1") return {cmd:"reg_ask_user"}
  if(l==="2") return {cmd:"reglas"}
  if(l==="3") return {cmd:"cargar_info"}
  if(l.startsWith("cargar ")) return {cmd:"cargar_monto", raw:t}
  if(l==="4") return {cmd:"crear_ask"}
  if(l.startsWith("crear ")) return {cmd:"crear", raw:t}
  if(l==="5") return {cmd:"unirme_ask"}
  if(l.startsWith("unirme")) return {cmd:"unirme", raw:t}
  if(l==="6") return {cmd:"resultado_hint"}
  if(l.startsWith("resultado")) return {cmd:"resultado", raw:t}
  if(l==="7") return {cmd:"retirar_info"}
  if(l.startsWith("retirar ")) return {cmd:"retirar", raw:t}
  if(l==="8") return {cmd:"soporte"}
  if(l==="panel") return {cmd:"admin_panel"}
  if(l.startsWith("admin ")) return {cmd:"admin_cmd", raw:t}
  if(l.startsWith("cancelar")) return {cmd:"cancelar", raw:t}
  return {cmd:"other", raw:t}
}

/* webhook verify */
app.get("/webhook",(req,res)=>{
  if(req.query["hub.verify_token"]===process.env.WABA_VERIFY_TOKEN) res.send(req.query["hub.challenge"])
  else res.sendStatus(403)
})

/* webhook receive */
app.post("/webhook", async (req,res)=>{
  res.sendStatus(200)
  const e=req.body.entry && req.body.entry[0]
  if(!e) return
  const c=e.changes && e.changes[0]
  if(!c || !c.value || !c.value.messages) return
  const m=c.value.messages[0]
  const from=m.from
  if(!from) return

  const u=await upsertUsuario(from)

  // tipos
  const isText = !!(m.text && m.text.body)
  const isImage= m.type==="image" && m.image && m.image.id

  // si es imagen: se trata como comprobante si hay carga pendiente
  if(isImage){
    try{
      const cargaPend = await getCargaPendienteUsuario(u.id)
      if(!cargaPend){
        await sendText(from, "recibi la imagen. si es un comprobante, primero usa: cargar {monto}")
        return
      }
      // bajar y re-subir media para poder reenviar
      const {buffer,mime} = await downloadMedia(m.image.id)
      const newId = await uploadMedia(buffer, mime)

      // guardar media ids
      await setCargaMedia(cargaPend.id, m.image.id, newId)

      // avisar a usuario
      await sendText(from, M.pago_recibido_user.replace("{id}", cargaPend.id))

      // armar caption para admins
      const uu = await getById(u.id)
      const caption = M.pago_admin_caption
        .replaceAll("{id}", cargaPend.id)
        .replace("{user}", uu.username||"user")
        .replace("{phone}", uu.phone)
        .replace("{monto}", cargaPend.monto_pesos)
        .replace("{ref}", cargaPend.referencia)

      // enviar a admins (grupo si hay, si no a cada admin)
      if(process.env.GRUPO_ID){
        await sendImageById(process.env.GRUPO_ID, newId, caption)
      }else{
        for(const a of ADMINS){ await sendImageById(a, newId, caption) }
      }
    }catch(err){
      console.error("error reenviando comprobante", err)
      await sendText(from, "hubo un problema con tu comprobante, probemos de nuevo en 1 minuto")
    }
    return
  }

  // texto
  const text = (m.text && m.text.body)||""
  const {cmd, raw} = parseCmd(text)

  // helpers
  const sendMenu = async (uid)=>{
    const user = await getById(uid)
    await sendText(user.phone, M.menu_header(user) + "\n\n" + M.menu_ops)
  }

  if(cmd==="menu"){ await sendMenu(u.id); return }
  if(cmd==="reglas"){ await sendText(from, M.reglas); return }
  if(cmd==="soporte"){ await sendText(from, M.soporte); return }

  // registro
  if(cmd==="reg_ask_user"){ await sendText(from, M.pedir_username); return }
  if(!u.username && cmd==="other" && text && !text.includes(" ") && text.length>=3){
    await setUser(u.id, text.trim(), u.tag_cr||"")
    await sendText(from, M.pedir_tag); return
  }
  if(text.startsWith("#") && (!u.tag_cr || u.tag_cr==="")){
    const uu=await setUser(u.id, u.username||"user", text.trim())
    await sendText(from, M.registrado_ok.replace("{username}", uu.username).replace("{tag}", "#"+uu.tag_cr))
    await sendMenu(u.id); return
  }

  // cargar manual (pedido + datos de pago + genera id)
  if(cmd==="cargar_info"){ await sendText(from, M.cargar_info); return }
  if(cmd==="cargar_monto"){
    const monto = parseInt(raw.split(" ")[1]||"0",10)
    if(!(monto>0)){ await sendText(from,"formato: cargar 1500"); return }
    const ref = "DEP-" + Math.floor(1000 + Math.random()*9000)
    const cg = await crearCarga(u.id, monto, ref)
    await sendText(from, M.pago_datos
      .replaceAll("{id}", cg.id)
      .replace("{monto}", monto)
      .replace("{alias}", PAGO_ALIAS)
      .replace("{ref}", ref)
    )
    return
  }

  // retiro: retirar {monto} cvu:XXXX
  if(cmd==="retirar_info"){ await sendText(from, M.retirar_info); return }
  if(cmd==="retirar"){
    const parts = raw.split(" ")
    const monto = parseInt(parts[1]||"0",10)
    const cvu  = (parts.find(x=>x.toLowerCase().startsWith("cvu:"))||"").split(":")[1]||""
    if(!(monto>0) || !cvu){ await sendText(from, 'formato: retirar 2000 cvu:mi.alias'); return }
    const me=await getById(u.id)
    if(me.saldo_fichas < monto){ await sendText(from, M.saldo_insuf); return }
    // bloquear fichas
    await addSaldo(u.id, -monto, "retiro_bloq", null)
    const r = await crearRetiro(u.id, monto, cvu)
    await sendText(from, M.retiro_pend_user.replace("{id}", r.id).replace("{monto}", monto).replace("{cvu}", cvu))
    const uu = await getById(u.id)
    const msg = M.retiro_admin_msg
      .replaceAll("{id}", r.id)
      .replace("{user}", uu.username||"user")
      .replace("{phone}", uu.phone)
      .replace("{monto}", monto)
      .replace("{cvu}", cvu)
    if(process.env.GRUPO_ID){ await sendText(process.env.GRUPO_ID, msg) }
    else { for(const a of ADMINS){ await sendText(a, msg) } }
    return
  }

  // crear / cancelar / unirse / resultado (igual que antes)
  if(cmd==="crear_ask"){ await sendText(from, M.pedir_fichas_crear); return }
  if(cmd==="crear"){
    const fichas=parseInt(raw.split(" ")[1]||"0",10)
    if(!(fichas>0)){ await sendText(from,"formato: crear 10"); return }
    const me=await getById(u.id)
    if(me.saldo_fichas < fichas){ await sendText(from, M.saldo_insuf); return }
    await addSaldo(u.id, -fichas, "bloqueo", null)
    const p=await crearPartida(u.id, fichas, FEE)
    const body=M.partida_publicada
      .replace("{id}", p.id).replace("{f}", p.fichas)
      .replace("{pozo}", p.pozo_fichas)
      .replace("{premio}", p.premio_fichas)
      .replace("{user}", u.username||u.phone)
    const msgId=await postToGroupAndReturnId(body)
    if(msgId) await setGroupMsg(p.id, msgId)
    await sendText(from, M.partida_creada_ok.replace("{id}", p.id))
    return
  }
  if(cmd==="cancelar"){
    const id=parseInt(raw.split(" ").pop().replace("id:",""),10)
    if(!(id>0)){ await sendText(from,"formato: cancelar id:123"); return }
    const p=await getPartida(id)
    if(!p || p.estado!=="buscando_rival"){ await sendText(from, M.partida_no_disponible); return }
    if(p.creador!==u.id){ await sendText(from,"solo el creador puede cancelar"); return }
    await addSaldo(u.id, p.fichas, "devolucion", id)
    await setEstado(id,"cancelada")
    await sendText(from, M.partida_cancelada_priv.replace("{id}", id))
    if(p.group_msg_id){ await replyText(process.env.GRUPO_ID, p.group_msg_id, M.partida_cancelada_grupo.replace("{id}", id)) }
    return
  }
  if(cmd==="unirme_ask"){ await sendText(from, M.pedir_id_unirme); return }
  if(cmd==="unirme"){
    const id=parseInt(raw.split(" ").pop().replace("id:",""),10)
    if(!(id>0)){ await sendText(from,"formato: unirme id:123"); return }
    const p=await getPartida(id)
    if(!p || p.estado!=="buscando_rival"){ await sendText(from, M.partida_no_disponible); return }
    const me=await getById(u.id)
    if(me.saldo_fichas < p.fichas){ await sendText(from, M.saldo_insuf); return }
    await addSaldo(u.id, -p.fichas, "bloqueo", id)
    const px=await setRival(id, u.id)
    const creador=await getById(px.creador)
    await sendText(from, M.emparejado_rival.replace("{id}", id).replace("{tel_creador}", creador.phone))
    await sendText(creador.phone, M.emparejado_creador.replace("{id}", id).replace("{tel_rival}", u.phone))
    return
  }
  if(cmd==="resultado_hint"){
    await sendText(from, M.resultado_hint.replace("{id}","123").replace("{user}","tu_usuario"))
    return
  }
  if(cmd==="resultado"){
    const parts=raw.split(" ")
    const id=parseInt((parts[1]||"").replace("id:",""),10)
    if(!(id>0)){ await sendText(from,"formato: resultado id:123 ganador:@usuario"); return }
    const p=await getPartida(id)
    if(!p || p.estado!=="en_juego"){ await sendText(from,"la partida no esta en juego"); return }

    await setEstado(id,"pendiente_api")
    await sendText(from, M.resultado_recibido.replace("{id}", id))

    const creador=await getById(p.creador)
    const rival  =await getById(p.rival)
    const tagC = "#"+(creador.tag_cr||"")
    const tagR = "#"+(rival.tag_cr||"")

    const v=await buscarMatchReciente(tagC, tagR, 15)
    if(v.ok){
      const ganadorId = (v.ganador.toUpperCase() === tagC.toUpperCase()) ? p.creador : p.rival
      const perdedorId= (ganadorId===p.creador)? p.rival : p.creador
      await setGanador(id, ganadorId)
      await setEstado(id,"liquidada")

      const saldoG = await addSaldo(ganadorId, p.premio_fichas, "premio", id)
      const ganadorUserName = (ganadorId===p.creador? creador.username : rival.username) || "ganador"

      const p2=await getPartida(id)
      const ms= Math.max(0, new Date(p2.ended_at)-new Date(p2.started_at||p2.creado))
      const mins = Math.floor(ms/60000)
      const secs = Math.floor((ms%60000)/1000)

      await sendText((await getById(ganadorId)).phone, M.liquidada_g.replace("{id}",id).replace("{user}",ganadorUserName).replace("{premio}",p.premio_fichas).replace("{saldo}",saldoG))
      const perdPhone=(await getById(perdedorId)).phone
      const saldoP=(await getById(perdedorId)).saldo_fichas
      await sendText(perdPhone, M.liquidada_p.replace("{id}",id).replace("{saldo}",saldoP))

      if(p.group_msg_id){
        const txt=M.result_grupo
          .replace("{id}", id).replace("{user}", ganadorUserName)
          .replace("{mins}", mins).replace("{secs}", secs)
          .replace("{premio}", p.premio_fichas)
        await replyText(process.env.GRUPO_ID, p.group_msg_id, txt)
      }
      return
    }
    await sendText(from, M.pedir_video.replace("{oponente}", (creador.phone===from? rival.username : creador.username)||"oponente"))
    return
  }

  // admin panel texto
  if(cmd==="admin_panel"){
    if(!ADMINS.includes(from)){ await sendText(from, M.admin_err); return }
    await sendText(from, M.admin_panel); return
  }

  // admin comandos
  if(cmd==="admin_cmd"){
    if(!ADMINS.includes(from)){ await sendText(from, M.admin_err); return }
    const l=raw.toLowerCase()

    // admin cargar phone:xxx fichas:nn
    if(l.startsWith("admin cargar")){
      const parts=raw.split(" ")
      const ph=(parts.find(x=>x.startsWith("phone:"))||"").split(":")[1]||""
      const fs=parseInt((parts.find(x=>x.startsWith("fichas:"))||"").split(":")[1]||"0",10)
      if(!ph || !(fs>0)){ await sendText(from,"formato: admin cargar phone:... fichas:..."); return }
      const u2=await getByPhone(ph); if(!u2){ await sendText(from,"no existe ese phone"); return }
      const s=await addSaldo(u2.id, fs, "carga", null)
      await sendText(from, M.admin_ok+" saldo:"+s)
      await sendText(u2.phone, `carga manual aprobada ✅ +${fs} fichas. saldo: ${s}`)
      return
    }

    // admin descontar phone:xxx fichas:nn
    if(l.startsWith("admin descontar")){
      const parts=raw.split(" ")
      const ph=(parts.find(x=>x.startsWith("phone:"))||"").split(":")[1]||""
      const fs=parseInt((parts.find(x=>x.startsWith("fichas:"))||"").split(":")[1]||"0",10)
      if(!ph || !(fs>0)){ await sendText(from,"formato: admin descontar phone:... fichas:..."); return }
      const u2=await getByPhone(ph); if(!u2){ await sendText(from,"no existe ese phone"); return }
      const s=await addSaldo(u2.id, -fs, "descuento", null)
      await sendText(from, M.admin_ok+" saldo:"+s)
      await sendText(u2.phone, `se descontaron ${fs} fichas. saldo: ${s}`)
      return
    }

    // admin carga aprobar id:nn  |  admin carga rechazar id:nn
    if(l.startsWith("admin carga aprobar")){
      const id=parseInt(l.split("id:")[1]||"0",10)
      if(!(id>0)){ await sendText(from,"formato: admin carga aprobar id:123"); return }
      const cg=await getCarga(id); if(!cg || cg.estado!=='pendiente'){ await sendText(from,"carga inexistente o no pendiente"); return }
      const fichas = cg.monto_pesos // 1 peso = 1 ficha
      const saldo = await addSaldo(cg.usuario, fichas, "carga", null)
      await setCargaEstado(id,"aprobada")
      const usr=await getById(cg.usuario)
      await sendText(from, M.admin_ok)
      await sendText(usr.phone, M.carga_aprobada_user.replace("{id}", id).replace("{fichas}", fichas).replace("{saldo}", saldo))
      await sendText(usr.phone, M.menu_header(usr) + "\n\n" + M.menu_ops)
      return
    }
    if(l.startsWith("admin carga rechazar")){
      const id=parseInt(l.split("id:")[1]||"0",10)
      if(!(id>0)){ await sendText(from,"formato: admin carga rechazar id:123"); return }
      const cg=await getCarga(id); if(!cg || cg.estado!=='pendiente'){ await sendText(from,"carga inexistente o no pendiente"); return }
      await setCargaEstado(id,"rechazada")
      const usr=await getById(cg.usuario)
      await sendText(from, M.admin_ok)
      await sendText(usr.phone, M.carga_rechazada_user.replace("{id}", id))
      await sendText(usr.phone, M.menu_header(usr) + "\n\n" + M.menu_ops)
      return
    }

    // admin retiro aprobar/rechazar
    if(l.startsWith("admin retiro aprobar")){
      const id=parseInt(l.split("id:")[1]||"0",10)
      if(!(id>0)){ await sendText(from,"formato: admin retiro aprobar id:123"); return }
      const r=await getRetiro(id); if(!r || r.estado!=='pendiente'){ await sendText(from,"retiro inexistente o no pendiente"); return }
      await setRetiroEstado(id,"pagado")
      const usr=await getById(r.usuario)
      await sendText(from, M.admin_ok)
      await sendText(usr.phone, M.retiro_pagado_user.replace("{id}", id))
      await sendText(usr.phone, M.menu_header(usr) + "\n\n" + M.menu_ops)
      return
    }
    if(l.startsWith("admin retiro rechazar")){
      const id=parseInt(l.split("id:")[1]||"0",10)
      if(!(id>0)){ await sendText(from,"formato: admin retiro rechazar id:123"); return }
      const r=await getRetiro(id); if(!r || r.estado!=='pendiente'){ await sendText(from,"retiro inexistente o no pendiente"); return }
      // devolver fichas
      await addSaldo(r.usuario, r.monto_pesos, "retiro_dev", null)
      await setRetiroEstado(id,"rechazado")
      const usr=await getById(r.usuario)
      await sendText(from, M.admin_ok)
      await sendText(usr.phone, M.retiro_rechazado_user.replace("{id}", id))
      await sendText(usr.phone, M.menu_header(usr) + "\n\n" + M.menu_ops)
      return
    }

    await sendText(from, M.admin_panel); return
  }

  // default
  await sendText(from, M.menu_header(u) + "\n\n" + M.menu_ops)
})

app.get("/",(_req,res)=>res.send("ok"))
app.listen(process.env.PORT||3000)
