import axios from "axios"

let CLASH_API = process.env.CLASH_API
let CLASH_TOKEN = process.env.CLASH_TOKEN
let H = { headers: { Authorization: "Bearer "+CLASH_TOKEN, Accept: "application/json" } }

function encTag(tag){
  if(!tag) return ""
  let t = tag.startsWith("#") ? tag.slice(1) : tag
  return "%23"+t
}

function battlelog(tag){
  let url = CLASH_API + "/players/" + encTag(tag) + "/battlelog"
  return axios.get(url, H).then(r=>r.data)
}

async function buscarMatchReciente(tagA, tagB, ventanaMin){
  let a = await battlelog(tagA)
  let ahora = Date.now()
  let ventana = ventanaMin*60*1000
  let i = 0
  while(i < a.length){
    let m = a[i]
    let team = m.team && m.team[0]
    let opp  = m.opponent && m.opponent[0]
    if(team && opp){
      let tA = (team.tag||"").toUpperCase()
      let tB = (opp.tag||"").toUpperCase()
      if(tA === tagA.toUpperCase() && tB === tagB.toUpperCase()){
        let ts = Date.parse((m.battleTime||"").replace(".000Z","Z"))
        if(ts && (ahora - ts) <= ventana){
          let ganador = (team.crowns||0) > (opp.crowns||0) ? tagA : tagB
          return {ok:true, ganador}
        }
      }
    }
    i++
  }
  return {ok:false}
}

export { buscarMatchReciente }
