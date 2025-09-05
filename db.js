import pg from "pg"
let pool = new pg.Pool({ connectionString: process.env.DATABASE_URL })
function q(sql, params){ return pool.query(sql, params) }

/* usuarios */
function upsertUsuario(phone){
  let s="insert into usuarios(phone) values($1) on conflict(phone) do update set phone=excluded.phone returning *"
  return q(s,[phone]).then(r=>r.rows[0])
}
function setUser(id, username, tag){
  let t=(tag||"").replace("#","")
  return q("update usuarios set username=$1, tag_cr=$2 where id=$3 returning *",[username,t,id]).then(r=>r.rows[0])
}
function getById(id){ return q("select * from usuarios where id=$1",[id]).then(r=>r.rows[0]) }
function getByPhone(phone){ return q("select * from usuarios where phone=$1",[phone]).then(r=>r.rows[0]) }
function addSaldo(id, fichas, tipo, partida){
  let u="update usuarios set saldo_fichas=saldo_fichas+$1 where id=$2 returning saldo_fichas"
  return q(u,[fichas,id]).then(r=>q(
    "insert into movimientos(usuario,tipo,fichas,partida) values($1,$2,$3,$4)",
    [id,tipo,fichas,partida||null]
  ).then(_=>r.rows[0].saldo_fichas))
}

/* partidas */
function crearPartida(creador, f, fee){
  let pozo = 2*f
  let premio = Math.round(pozo*(1-fee))
  let s="insert into partidas(creador,fichas,pozo_fichas,premio_fichas,estado) values($1,$2,$3,$4,'buscando_rival') returning *"
  return q(s,[creador,f,pozo,premio]).then(r=>r.rows[0])
}
function setGroupMsg(id, msgId){ return q("update partidas set group_msg_id=$1 where id=$2",[msgId,id]).then(_=>null) }
function getPartida(id){ return q("select * from partidas where id=$1",[id]).then(r=>r.rows[0]) }
function setRival(id, rival){
  return q("update partidas set rival=$1, estado='en_juego', started_at=now() where id=$2 and estado='buscando_rival' returning *",[rival,id]).then(r=>r.rows[0])
}
function setEstado(id, estado){ return q("update partidas set estado=$1 where id=$2 returning *",[estado,id]).then(r=>r.rows[0]) }
function setGanador(id, ganador){
  return q("update partidas set ganador=$1, ended_at=now() where id=$2 returning *",[ganador,id]).then(r=>r.rows[0])
}

/* listados admin */
async function listarPartidasAbiertas(limit=20){
  let r = await q("select id, fichas, pozo_fichas, premio_fichas, creado from partidas where estado='buscando_rival' order by creado desc limit $1",[limit])
  return r.rows
}

/* cargas manuales */
function crearCarga(usuario, monto, ref){
  return q("insert into cargas(usuario,monto_pesos,referencia) values($1,$2,$3) returning *",[usuario,monto,ref]).then(r=>r.rows[0])
}
function setCargaMedia(id, mediaIn, mediaAdmin){
  return q("update cargas set media_in_id=$1, media_admin_id=$2 where id=$3 returning *",[mediaIn,mediaAdmin,id]).then(r=>r.rows[0])
}
function setCargaEstado(id, estado){
  return q("update cargas set estado=$1 where id=$2 returning *",[estado,id]).then(r=>r.rows[0])
}
function getCarga(id){ return q("select * from cargas where id=$1",[id]).then(r=>r.rows[0]) }
async function getCargaPendienteUsuario(uid){
  let r=await q("select * from cargas where usuario=$1 and estado='pendiente' order by ts desc limit 1",[uid])
  return r.rows[0]
}

/* retiros */
function crearRetiro(usuario, monto, cvu){
  return q("insert into retiros(usuario,monto_pesos,cvu) values($1,$2,$3) returning *",[usuario,monto,cvu]).then(r=>r.rows[0])
}
function setRetiroEstado(id, estado){
  return q("update retiros set estado=$1 where id=$2 returning *",[estado,id]).then(r=>r.rows[0])
}
function getRetiro(id){ return q("select * from retiros where id=$1",[id]).then(r=>r.rows[0]) }

export {
  q,
  upsertUsuario, setUser, getById, getByPhone, addSaldo,
  crearPartida, getPartida, setRival, setEstado, setGanador, setGroupMsg,
  listarPartidasAbiertas,
  crearCarga, setCargaMedia, setCargaEstado, getCarga, getCargaPendienteUsuario,
  crearRetiro, setRetiroEstado, getRetiro
}
