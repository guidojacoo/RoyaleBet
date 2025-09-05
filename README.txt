1) crear db y correr sql_init.sql
2) npm init -y && npm i express axios form-data pg
3) completa .env (whatsapp, db, clash, admins, alias/cvu)
4) docker compose up -d
5) configura webhook meta: https://tu-dominio.com/webhook
6) prueba:
   - "menu"
   - registro: "1" -> username, luego "#TAG"
   - cargar:
       a) "3" -> instrucciones
       b) "cargar 1500" -> te da alias, monto, ref e id
       c) envia foto del comprobante -> se reenvia a admins con id
       d) admin: "admin carga aprobar id:1" -> saldo + aviso + menu
   - retiro:
       a) "retirar 2000 cvu:mi.alias"
       b) a admins llega el pedido con id
       c) admin: "admin retiro aprobar id:1" o "admin retiro rechazar id:1" (devuelve fichas)
   - partidas: "crear 10", "unirme id:1", "resultado id:1 ganador:@usuario", "cancelar id:1"
