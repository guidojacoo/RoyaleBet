let M = {
  // menu principal (armado dinamico con user/saldo)
  menu_header: (u)=>`hola ${u.username||'jugador'} ${u.tag_cr?`(#${u.tag_cr})`:''}
saldo: ${u.saldo_fichas} fichas

elegi una opcion:`,
  menu_ops:
`1 registrarme
2 ver reglas
3 cargar saldo (manual)
4 crear partida
5 unirme a una partida
6 reportar resultado
7 retirar dinero
8 soporte`,

  reglas:
`reglas
- 1 ficha = 1 peso
- comision 10 del pozo (premio neto 90)
- fichas en escrow al crear y al unirse
- verificacion por api del juego
- el creador puede cancelar si aun no hay rival`,

  pedir_username: `decime tu nombre de usuario. ejemplo: juancr7`,
  pedir_tag: `ahora tu tag de clash (empieza con #). ejemplo: #ABCD123`,
  registrado_ok: `listo. registrado como {username} ({tag})`,

  // carga manual
  cargar_info:
`carga manual de fichas 🎟️
mandame: cargar {monto_en_pesos}
ejemplo: cargar 1500`,

  pago_datos:
`pago generado: #{id}
monto: ${'{monto}'} pesos
alias/cvu: {alias}
concepto: {ref}
cuando pagues, mandame una foto del comprobante (que se vea el concepto).`,

  pago_recibido_user: `recibi tu comprobante para la carga #{id}. lo pase a admin para validar.`,
  pago_admin_caption:
`🧾 comprobante carga #{id}
user: @{user} • phone: {phone}
monto: ${'{monto}'} • ref: {ref}
comandos:
- admin carga aprobar id:{id}
- admin carga rechazar id:{id}`,

  carga_aprobada_user: `carga #{id} aprobada ✅ se acreditaron {fichas} fichas. tu saldo ahora es {saldo}`,
  carga_rechazada_user: `carga #{id} rechazada. si hubo error, habla con soporte`,

  // retiro
  retirar_info:
`para retirar, usa:
retirar {monto_en_pesos} cvu:{tu_cvu_o_alias}
ejemplo: retirar 2000 cvu:mi.cvu.alias`,

  retiro_pend_user: `retiro #{id} recibido ✅ monto ${'{monto}'} a cvu: {cvu}. un admin lo procesa y te avisamos`,
  retiro_admin_msg:
`💸 retiro #{id}
user: @{user} • phone: {phone}
monto: ${'{monto}'} • cvu: {cvu}
comandos:
- admin retiro aprobar id:{id}
- admin retiro rechazar id:{id}`,

  retiro_pagado_user: `retiro #{id} pagado ✅`,
  retiro_rechazado_user: `retiro #{id} rechazado. devolvi las fichas a tu saldo`,

  saldo_actual: `tu saldo es {saldo} fichas`,
  saldo_insuf: `no tenes fichas suficientes. usa "3" para cargar`,
  soporte: `deja tu mensaje y un admin te responde`,

  // partidas
  pedir_fichas_crear: `cuantas fichas queres apostar por jugador. ejemplo: crear 10`,
  partida_publicada:
`🧩 partida abierta
id: #{id}
apuesta: {f} fichas por jugador
pozo: {pozo} fichas
premio neto: {premio} fichas
creador: @{user}
para unirte: escribi al bot "unirme id:{id}"
(el creador puede cancelar con: cancelar id:{id})`,
  partida_creada_ok: `partida #{id} publicada en el grupo`,
  partida_no_disponible: `la partida no esta disponible`,
  partida_cancelada_priv: `ok. #${'{id}'} cancelada y fichas devueltas`,
  partida_cancelada_grupo: `❌ actualizacion #${'{id}'}: partida cancelada por el creador. fichas devueltas`,

  pedir_id_unirme: `decime el id. ejemplo: unirme id:123`,
  emparejado_creador: `se encontro rival para #{id}. juga contra {tel_rival}. al terminar: resultado id:{id} ganador:@usuario`,
  emparejado_rival: `entraste a #{id}. juga contra {tel_creador}. al terminar: resultado id:{id} ganador:@usuario`,

  resultado_hint: `formato: resultado id:{id} ganador:@{user}`,
  resultado_recibido: `reporte recibido para #{id}. verificando por api...`,
  pedir_video:
`no veo la partida en el battlelog aun
mandame un video corto:
1 abre el juego
2 entra a historial
3 mostrala vs {oponente}
4 al final abre el panel de hora del telefono`,
  result_grupo:
`✅ resultado #${'{id}'}
ganador: @{user}
duracion: {mins} min {secs}s
premio: {premio} fichas (neto)`,
  liquidada_g: `#{id} aprobada ✅ ganador @{user}. premio {premio} fichas. tu nuevo saldo es {saldo}`,
  liquidada_p: `#{id} aprobada. tu nuevo saldo es {saldo}`,
  a_revision: `no pude verificar con lo disponible. lo paso a revision de admin`,

  // admin
  admin_err: `no autorizado`,
  admin_ok: `ok admin`,
  admin_panel:
`panel admin
- admin cargar phone:{phone} fichas:{n}
- admin descontar phone:{phone} fichas:{n}
- admin carga aprobar id:{id}
- admin carga rechazar id:{id}
- admin retiro aprobar id:{id}
- admin retiro rechazar id:{id}`,
}

export default M
