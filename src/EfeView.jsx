import React, { useState, useEffect, useMemo, useRef, useCallback } from "react";
import { supabase } from "./supabase.js";

/* ── Paleta ────────────────────────────────────────────── */
const C = {
  navy:"#0F2D4A", blue:"#1565C0", sky:"#2196F3", teal:"#00897B",
  surface:"#FFFFFF", border:"#E2E8F0", muted:"#64748B", text:"#1A2332",
  danger:"#E53935", warn:"#F59E0B", ok:"#43A047",
  mxn:"#1565C0", usd:"#2E7D32", eur:"#6A1B9A",
  rowUSD:"#F0FFF4", rowEUR:"#F5F3FF",
};
const fmt  = n => isNaN(n)||!n ? "" :
  new Intl.NumberFormat("es-MX",{minimumFractionDigits:2,maximumFractionDigits:2}).format(+n);
const fmtZ = n => !+n ? "$ —" : `$ ${fmt(+n)}`;
const sym  = cur => cur==="EUR" ? "€" : "$";
const rowBg = cur => ({MXN:"#fff",USD:C.rowUSD,EUR:C.rowEUR}[cur]||"#fff");
const Badge = ({cur}) => {
  const cfg={MXN:{bg:"#DBEAFE",cl:"#1e40af",lb:"MN"},
             USD:{bg:"#DCFCE7",cl:"#166534",lb:"USD"},
             EUR:{bg:"#EDE9FE",cl:"#6B21A8",lb:"EUR"}}[cur]||{bg:"#F1F5F9",cl:C.muted,lb:cur};
  return <span style={{background:cfg.bg,color:cfg.cl,fontWeight:700,fontSize:10,
    borderRadius:4,padding:"2px 6px",whiteSpace:"nowrap"}}>{cfg.lb}</span>;
};

/* ── Fechas ─────────────────────────────────────────────── */
const getMonday = d => {
  const dt=new Date(d); dt.setHours(12,0,0,0);
  const day=dt.getDay(); dt.setDate(dt.getDate()-day+(day===0?-6:1)); return dt;
};
const addDays  = (d,n) => { const dt=new Date(d); dt.setDate(dt.getDate()+n); return dt; };
const toISO    = d  => d.toISOString().split("T")[0];
const MESES    = ["ENE","FEB","MZO","ABR","MAY","JUN","JUL","AGO","SEP","OCT","NOV","DIC"];
const DIAS     = ["Lun","Mar","Mié","Jue","Vie"];
const CURRENCIES = ["MXN","USD","EUR"];
const CATS_ING = ["Circuitos","Tour Adicionales","Botelería","Reprotecciones","Traslados",
  "Hotelería","Cuba","Excursiones","Otros Ingresos","Cambio de Divisas","Traspaso","Otro"];
const CATS_EGR = ["Financiamientos","Nómina","Combustible","Impuestos","Seguros","Reprotecciones",
  "Apoyos transportación","Peajes","Sistemas","Honorarios","Fondo fijo","Mantenimiento","Servicios","Otro"];

const inputSt = {padding:"6px 9px",borderRadius:6,border:"1px solid #E2E8F0",fontSize:13,
  outline:"none",background:"#FAFBFC",width:"100%",fontFamily:"inherit",color:C.text,boxSizing:"border-box"};
const selSt   = {...inputSt,cursor:"pointer"};
const tabLabel = monday => {
  const fri=addDays(monday,4);
  const d0=monday.getDate(), m0=monday.getMonth();
  const d4=fri.getDate(),    m4=fri.getMonth();
  return m0===m4 ? `${d0} AL ${d4} ${MESES[m0]}` : `${d0} ${MESES[m0]} AL ${d4} ${MESES[m4]}`;
};

/* ══════════════════════════════════════════════════════════
   DB HELPERS
   ══════════════════════════════════════════════════════════ */
async function fetchPlantilla(empresaId) {
  const {data,error} = await supabase.from("efe_plantilla")
    .select("*").eq("empresa_id",empresaId).order("tipo").order("orden");
  if(error){console.error("fetchPlantilla:",error);return[];}
  return data||[];
}
async function savePlantillaRow(row, empresaId) {
  const r={empresa_id:empresaId,tipo:row.tipo,categoria:row.categoria||"",
    segmento:row.segmento||"",nombre:row.nombre,moneda:row.moneda||"MXN",
    orden:+row.orden||0,activo:row.activo!==false,notas:row.notas||""};
  if(row.id){
    const{data,error}=await supabase.from("efe_plantilla").update(r).eq("id",row.id).select().single();
    if(error){console.error(error);return null;}return data;
  }
  const{data,error}=await supabase.from("efe_plantilla").insert(r).select().single();
  if(error){console.error(error);return null;}return data;
}
async function deletePlantillaRow(id){
  await supabase.from("efe_plantilla").delete().eq("id",id);
}
async function fetchValores(empresaId, from, to) {
  const{data:pl}=await supabase.from("efe_plantilla").select("id").eq("empresa_id",empresaId);
  const ids=(pl||[]).map(r=>r.id);
  if(!ids.length) return {};
  const{data}=await supabase.from("efe_valores").select("*")
    .in("plantilla_id",ids).gte("fecha",from).lte("fecha",to);
  const map={};
  (data||[]).forEach(r=>{
    if(!map[r.plantilla_id]) map[r.plantilla_id]={};
    map[r.plantilla_id][r.fecha]=+r.monto||0;
  });
  return map;
}
async function upsertValor(plantillaId, empresaId, fecha, monto) {
  const n=parseFloat(monto)||0;
  if(n===0){
    await supabase.from("efe_valores").delete().eq("plantilla_id",plantillaId).eq("fecha",fecha);
    return;
  }
  await supabase.from("efe_valores").upsert(
    {plantilla_id:plantillaId,empresa_id:empresaId,fecha,monto:n},
    {onConflict:"plantilla_id,fecha"});
}
async function fetchEfeSaldo(empresaId, semana) {
  const{data}=await supabase.from("efe_saldos").select("*")
    .eq("empresa_id",empresaId).eq("semana",semana).single();
  return data||null;
}
async function upsertEfeSaldo(empresaId, semana, saldo, tc) {
  await supabase.from("efe_saldos").upsert(
    {empresa_id:empresaId,semana,
     saldo_mxn:+saldo.MXN||0,saldo_usd:+saldo.USD||0,saldo_eur:+saldo.EUR||0,
     tc_usd:+tc.USD||17,tc_eur:+tc.EUR||20.5},
    {onConflict:"empresa_id,semana"});
}

/* ══════════════════════════════════════════════════════════
   COMPONENTE PRINCIPAL
   ══════════════════════════════════════════════════════════ */
export default function EfeView({
  invoices, ingresos, cobros, empresaId, esConsulta,
  onProjectInvoice, onUnprojectInvoice, onProjectIngreso, onUnprojectIngreso,
}) {
  const [weekStart,     setWeekStart]     = useState(() => getMonday(new Date()));
  const [plantilla,     setPlantilla]     = useState([]);
  const [valores,       setValores]       = useState({});   // {plantillaId: {date: monto}}
  const [saldoIni,      setSaldoIni]      = useState({MXN:0, USD:0, EUR:0});
  const [tipoCambio,    setTipoCambio]    = useState({USD:17.0, EUR:20.5});
  const [loading,       setLoading]       = useState(true);
  const [editCell,      setEditCell]      = useState(null); // {id, date}
  const [editVal,       setEditVal]       = useState("");
  const [plantModal,    setPlantModal]    = useState(false);
  const [saldoModal,    setSaldoModal]    = useState(false);
  const [panelOpen,     setPanelOpen]     = useState(false);
  const editRef = useRef(null);

  /* ── Semana ── */
  const weekDays = useMemo(() => Array.from({length:5},(_,i)=>{
    const d=addDays(weekStart,i);
    return {date:toISO(d), label:`${d.getDate()} ${MESES[d.getMonth()]}`,
            short:`${DIAS[i]}\n${d.getDate()}/${d.getMonth()+1}`};
  }),[weekStart]);
  const weekFrom = weekDays[0].date;
  const weekTo   = weekDays[4].date;

  /* ── Pestañas: 3 antes + actual + 3 después ── */
  const weekTabs = useMemo(()=>Array.from({length:7},(_,i)=>addDays(weekStart,(i-3)*7)),[weekStart]);

  /* ── Load ── */
  useEffect(()=>{
    let cancelled=false;
    async function load(){
      setLoading(true);
      const [pl, vals, saldo] = await Promise.all([
        fetchPlantilla(empresaId),
        fetchValores(empresaId, weekFrom, weekTo),
        fetchEfeSaldo(empresaId, weekFrom),
      ]);
      if(cancelled) return;
      setPlantilla(pl);
      setValores(vals);
      if(saldo){
        setSaldoIni({MXN:+saldo.saldo_mxn||0, USD:+saldo.saldo_usd||0, EUR:+saldo.saldo_eur||0});
        setTipoCambio({USD:+saldo.tc_usd||17, EUR:+saldo.tc_eur||20.5});
      } else {
        setSaldoIni({MXN:0,USD:0,EUR:0}); setTipoCambio({USD:17,EUR:20.5});
      }
      setLoading(false);
    }
    load(); return ()=>{cancelled=true;};
  },[empresaId, weekFrom, weekTo]);

  /* ── CxC autorizados (como antes) ── */
  const {ingRows, egrRows} = useMemo(()=>{
    const ingRows=[], egrRows=[];
    ingresos.filter(i=>i.enEfe).forEach(ing=>{
      const fecha=ing.fechaEfe||ing.fechaFicticia||ing.fechaVencimiento||ing.fecha;
      if(!fecha||fecha<weekFrom||fecha>weekTo) return;
      const cobrado=cobros.filter(c=>c.ingresoId===ing.id).reduce((s,c)=>s+c.monto,0);
      const pend=Math.max(0,ing.monto-cobrado);
      if(pend<=0) return;
      ingRows.push({key:`cxc-${ing.id}`,id:ing.id,source:"cxc",
        categoria:ing.categoria||"CxC",segmento:ing.segmento||"",
        nombre:ing.cliente||"",monto:pend,moneda:ing.moneda||"MXN",fecha});
    });
    const allInv=[...(invoices.MXN||[]).map(i=>({...i,moneda:"MXN"})),
                  ...(invoices.USD||[]).map(i=>({...i,moneda:"USD"})),
                  ...(invoices.EUR||[]).map(i=>({...i,moneda:"EUR"}))];
    allInv.filter(inv=>inv.enEfe&&inv.estatus!=="Pagado").forEach(inv=>{
      const fecha=inv.fechaEfe||inv.fechaProgramacion;
      if(!fecha||fecha<weekFrom||fecha>weekTo) return;
      const saldo=Math.max(0,(inv.total||0)-(inv.montoPagado||0));
      if(saldo<=0) return;
      egrRows.push({key:`cxp-${inv.id}`,id:inv.id,source:"cxp",
        categoria:inv.clasificacion||"CxP",segmento:"",
        nombre:inv.proveedor||"",monto:saldo,moneda:inv.moneda||"MXN",fecha});
    });
    return {ingRows, egrRows};
  },[invoices,ingresos,cobros,weekFrom,weekTo]);

  /* ── Totales diarios por divisa (plantilla + CxC/CxP) ── */
  const {ingDayTot, egrDayTot} = useMemo(()=>{
    const ingDayTot={}, egrDayTot={};
    weekDays.forEach(({date})=>{
      ingDayTot[date]={MXN:0,USD:0,EUR:0};
      egrDayTot[date]={MXN:0,USD:0,EUR:0};
    });
    plantilla.filter(r=>r.activo&&r.tipo==="ingreso").forEach(row=>{
      const rv=valores[row.id]||{};
      weekDays.forEach(({date})=>{
        const v=+rv[date]||0;
        if(v) ingDayTot[date][row.moneda]=(ingDayTot[date][row.moneda]||0)+v;
      });
    });
    plantilla.filter(r=>r.activo&&r.tipo==="egreso").forEach(row=>{
      const rv=valores[row.id]||{};
      weekDays.forEach(({date})=>{
        const v=+rv[date]||0;
        if(v) egrDayTot[date][row.moneda]=(egrDayTot[date][row.moneda]||0)+v;
      });
    });
    ingRows.forEach(r=>{if(ingDayTot[r.fecha]) ingDayTot[r.fecha][r.moneda]=(ingDayTot[r.fecha][r.moneda]||0)+r.monto;});
    egrRows.forEach(r=>{if(egrDayTot[r.fecha]) egrDayTot[r.fecha][r.moneda]=(egrDayTot[r.fecha][r.moneda]||0)+r.monto;});
    return {ingDayTot, egrDayTot};
  },[plantilla,valores,ingRows,egrRows,weekDays]);

  const ingWeekTot = useMemo(()=>{
    const t={MXN:0,USD:0,EUR:0};
    weekDays.forEach(({date})=>CURRENCIES.forEach(c=>t[c]+=(ingDayTot[date]?.[c]||0)));
    return t;
  },[ingDayTot,weekDays]);
  const egrWeekTot = useMemo(()=>{
    const t={MXN:0,USD:0,EUR:0};
    weekDays.forEach(({date})=>CURRENCIES.forEach(c=>t[c]+=(egrDayTot[date]?.[c]||0)));
    return t;
  },[egrDayTot,weekDays]);

  /* ── Running saldo ── */
  const runningSaldo = useMemo(()=>{
    const rs={}; let s={...saldoIni};
    weekDays.forEach(({date})=>{
      const i=ingDayTot[date], e=egrDayTot[date];
      s={MXN:s.MXN+(i?.MXN||0)-(e?.MXN||0), USD:s.USD+(i?.USD||0)-(e?.USD||0), EUR:s.EUR+(i?.EUR||0)-(e?.EUR||0)};
      rs[date]={...s};
    });
    return rs;
  },[ingDayTot,egrDayTot,saldoIni,weekDays]);

  const pendientesCount = useMemo(()=>{
    const allInv=[...(invoices.MXN||[]),...(invoices.USD||[]),...(invoices.EUR||[])];
    return allInv.filter(i=>!i.enEfe&&i.estatus!=="Pagado"&&i.fechaProgramacion).length
          +ingresos.filter(i=>!i.enEfe).length;
  },[invoices,ingresos]);

  /* ── Inline cell editing ── */
  const startEdit = useCallback((id, date, currentVal) => {
    if(esConsulta) return;
    setEditCell({id,date});
    setEditVal(currentVal>0 ? String(currentVal) : "");
    setTimeout(()=>editRef.current?.focus(),30);
  },[esConsulta]);

  const commitEdit = useCallback(async(id, date) => {
    const monto = parseFloat(editVal)||0;
    setValores(prev=>({...prev,[id]:{...(prev[id]||{}),[date]:monto}}));
    setEditCell(null);
    await upsertValor(id, empresaId, date, monto);
  },[editVal,empresaId]);

  const onKeyDownCell = useCallback((e,id,date)=>{
    if(e.key==="Enter"){e.preventDefault();commitEdit(id,date);}
    if(e.key==="Escape"){setEditCell(null);setEditVal("");}
  },[commitEdit]);

  /* ── Plantilla CRUD ── */
  const handleSavePlant = async (row) => {
    const saved = await savePlantillaRow(row, empresaId);
    if(!saved) return;
    setPlantilla(prev => row.id ? prev.map(r=>r.id===row.id?saved:r) : [...prev,saved]);
  };
  const handleDeletePlant = async (id) => {
    await deletePlantillaRow(id);
    setPlantilla(prev=>prev.filter(r=>r.id!==id));
  };
  const handleReorder = async (id, dir) => {
    const list = [...plantilla];
    const idx = list.findIndex(r=>r.id===id);
    if(dir==="up" && idx>0){[list[idx],list[idx-1]]=[list[idx-1],list[idx]];}
    else if(dir==="down" && idx<list.length-1){[list[idx],list[idx+1]]=[list[idx+1],list[idx]];}
    else return;
    const updated = list.map((r,i)=>({...r,orden:i}));
    setPlantilla(updated);
    for(const r of updated) await supabase.from("efe_plantilla").update({orden:r.orden}).eq("id",r.id);
  };

  /* ── Save saldo + TC ── */
  const handleSaveSaldo = async(s,tc)=>{
    setSaldoIni(s); setTipoCambio(tc);
    await upsertEfeSaldo(empresaId, weekFrom, s, tc);
    setSaldoModal(false);
  };

  /* ── Estilos comunes ── */
  const TH = (children, extra={}) => (
    <th style={{padding:"9px 8px",color:"#fff",fontWeight:700,fontSize:11,
      textAlign:"right",whiteSpace:"nowrap",...extra}}>{children}</th>
  );
  const cellStyle = (cur,isActive,tipo) => ({
    textAlign:"right",padding:"4px 7px",fontSize:12,cursor:esConsulta?"default":"pointer",
    background: isActive ? (tipo==="ingreso"?"#D1FAE5":"#FEE2E2") : rowBg(cur),
    color: isActive ? (tipo==="ingreso"?C.ok:C.danger) : C.muted,
    fontWeight: isActive ? 700 : 400,
    minWidth:88, borderRight:`1px solid ${C.border}`,
    transition:"background .1s",
  });

  /* ── Render celda editable ── */
  const renderCell = (row, date, tipo) => {
    const val = +valores[row.id]?.[date] || 0;
    const isEdit = editCell?.id===row.id && editCell?.date===date;
    if(isEdit) return (
      <td key={date} style={{padding:"2px 4px",background:rowBg(row.moneda),
        borderRight:`1px solid ${C.border}`}}>
        <input ref={editRef} value={editVal}
          onChange={e=>setEditVal(e.target.value)}
          onBlur={()=>commitEdit(row.id, date)}
          onKeyDown={e=>onKeyDownCell(e,row.id,date)}
          style={{width:"100%",padding:"4px 6px",fontSize:12,fontWeight:700,
            border:`2px solid ${tipo==="ingreso"?C.ok:C.danger}`,borderRadius:5,
            textAlign:"right",fontFamily:"inherit",outline:"none",
            background:tipo==="ingreso"?"#F0FDF4":"#FFF5F5"}}
          type="number" step="0.01" min="0"
          placeholder="0.00"/>
      </td>
    );
    return (
      <td key={date} style={cellStyle(row.moneda, val>0, tipo)}
        onClick={()=>startEdit(row.id, date, val)}
        title={!esConsulta?"Clic para editar":""}>
        {val > 0 ? `${sym(row.moneda)} ${fmt(val)}` : ""}
      </td>
    );
  };

  /* ── Render fila de plantilla ── */
  const renderPlantRow = (row, tipo) => {
    const weekTotal = weekDays.reduce((s,{date})=>s+(+valores[row.id]?.[date]||0),0);
    return (
      <tr key={row.id} style={{background:rowBg(row.moneda),
        borderBottom:`1px solid ${C.border}`}}>
        <td style={{padding:"5px 8px",fontSize:11,color:C.muted,
          borderRight:`1px solid ${C.border}`}}>{row.categoria}</td>
        <td style={{padding:"5px 8px",fontSize:11,color:C.muted,
          borderRight:`1px solid ${C.border}`}}>{row.segmento}</td>
        <td style={{padding:"5px 10px",fontSize:12,fontWeight:600,color:C.text,
          borderRight:`1px solid ${C.border}`}}>
          {row.nombre}
        </td>
        {weekDays.map(({date})=>renderCell(row, date, tipo))}
        <td style={{textAlign:"right",padding:"5px 8px",fontSize:12,fontWeight:700,
          color:weekTotal>0?(tipo==="ingreso"?C.ok:C.danger):C.muted,
          borderRight:`1px solid ${C.border}`}}>
          {weekTotal>0?`${sym(row.moneda)} ${fmt(weekTotal)}`:"$ —"}
        </td>
        <td style={{padding:"4px 6px",textAlign:"center"}}>
          <Badge cur={row.moneda}/>
        </td>
      </tr>
    );
  };

  /* ── Render fila CxC/CxP ── */
  const renderAutoRow = (row, tipo) => (
    <tr key={row.key} style={{background:rowBg(row.moneda),
      borderBottom:`1px solid ${C.border}`}}>
      <td style={{padding:"5px 8px",fontSize:11,color:C.muted,
        borderRight:`1px solid ${C.border}`}}>{row.categoria}</td>
      <td style={{padding:"5px 8px",fontSize:11,color:C.muted,
        borderRight:`1px solid ${C.border}`}}>{row.segmento}</td>
      <td style={{padding:"5px 10px",fontSize:12,fontWeight:500,color:C.text,
        borderRight:`1px solid ${C.border}`}}>
        <div style={{display:"flex",alignItems:"center",gap:5}}>
          {row.nombre||"—"}
          <span style={{fontSize:9,background:row.source==="cxc"?"#CCFBF1":"#FEF9C3",
            color:row.source==="cxc"?C.teal:"#854D0E",borderRadius:3,
            padding:"1px 4px",fontWeight:700}}>{row.source.toUpperCase()}</span>
          {!esConsulta&&(
            <button onClick={()=>row.source==="cxp"?onUnprojectInvoice?.(row.id):onUnprojectIngreso?.(row.id)}
              style={{border:"none",background:"none",cursor:"pointer",fontSize:10,
                color:C.muted,padding:"1px 3px"}} title="Quitar del EFE">✕</button>
          )}
        </div>
      </td>
      {weekDays.map(({date})=>(
        <td key={date} style={{...cellStyle(row.moneda, row.fecha===date, tipo), cursor:"default"}}>
          {row.fecha===date ? `${sym(row.moneda)} ${fmt(row.monto)}` : ""}
        </td>
      ))}
      <td style={{textAlign:"right",padding:"5px 8px",fontSize:12,fontWeight:700,
        color:tipo==="ingreso"?C.ok:C.danger,borderRight:`1px solid ${C.border}`}}>
        {sym(row.moneda)} {fmt(row.monto)}
      </td>
      <td style={{padding:"4px 6px",textAlign:"center"}}>
        <Badge cur={row.moneda}/>
      </td>
    </tr>
  );

  /* ── Fila resumen ── */
  const SummaryRow=({label,dayVals,weekVals,bg,color,bold=false,colSpan3=false})=>(
    <tr style={{background:bg,borderBottom:`1px solid ${C.border}`}}>
      <td colSpan={colSpan3?3:1} style={{fontWeight:bold?800:700,color,padding:"6px 10px",
        fontSize:bold?13:12,textAlign:colSpan3?"right":"left",
        borderRight:`1px solid ${C.border}`,whiteSpace:"nowrap"}}>
        {label}
      </td>
      {!colSpan3&&<td colSpan={2} style={{borderRight:`1px solid ${C.border}`}}/>}
      {weekDays.map(({date})=>{
        const v=dayVals[date]||0;
        return<td key={date} style={{textAlign:"right",fontWeight:bold?800:600,
          color:v?color:C.muted,padding:"6px 8px",fontSize:bold?13:12,
          borderRight:`1px solid ${C.border}`}}>
          {v?`$ ${fmt(v)}`:"$ —"}
        </td>;
      })}
      <td style={{textAlign:"right",fontWeight:bold?800:700,color:color,
        padding:"6px 8px",fontSize:bold?13:12,borderRight:`1px solid ${C.border}`}}>
        {weekVals?`$ ${fmt(weekVals)}`:"$ —"}
      </td>
      <td/>
    </tr>
  );

  /* ═════════════════════════════════════════════════════════
     RENDER
     ═════════════════════════════════════════════════════════ */
  const plantIng = plantilla.filter(r=>r.activo&&r.tipo==="ingreso");
  const plantEgr = plantilla.filter(r=>r.activo&&r.tipo==="egreso");

  return (
    <div style={{fontFamily:"inherit"}}>

      {/* ── Título y botones ── */}
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",
        marginBottom:14,flexWrap:"wrap",gap:10}}>
        <div>
          <h1 style={{fontSize:22,fontWeight:800,color:C.navy,margin:0}}>
            Estado de Flujo de Efectivo
          </h1>
          <p style={{color:C.muted,margin:"3px 0 0",fontSize:13}}>
            TC: USD ${tipoCambio.USD.toFixed(4)} · EUR ${tipoCambio.EUR.toFixed(4)} · Clic en celda para editar
          </p>
        </div>
        <div style={{display:"flex",gap:8,flexWrap:"wrap"}}>
          {!esConsulta&&(
            <button onClick={()=>setPlantModal(true)}
              style={{padding:"8px 14px",borderRadius:9,border:`1px solid ${C.border}`,
                background:"#F8FAFC",cursor:"pointer",fontSize:13,color:C.navy,
                fontWeight:600,fontFamily:"inherit"}}>
              📋 Gestionar plantilla
            </button>
          )}
          {!esConsulta&&(
            <button onClick={()=>setSaldoModal(true)}
              style={{padding:"8px 14px",borderRadius:9,border:`1px solid ${C.border}`,
                background:"#F8FAFC",cursor:"pointer",fontSize:13,color:C.navy,
                fontWeight:600,fontFamily:"inherit"}}>
              ⚙️ Saldos / TC
            </button>
          )}
          {!esConsulta&&(
            <button onClick={()=>setPanelOpen(true)}
              style={{display:"flex",alignItems:"center",gap:7,padding:"8px 16px",
                borderRadius:9,border:"none",background:C.navy,color:"#fff",fontWeight:700,
                fontSize:13,cursor:"pointer",fontFamily:"inherit",position:"relative"}}>
              🌊 Autorizar al EFE
              {pendientesCount>0&&(
                <span style={{background:C.danger,color:"#fff",fontSize:10,fontWeight:800,
                  borderRadius:"50%",width:18,height:18,display:"flex",alignItems:"center",
                  justifyContent:"center",position:"absolute",top:-7,right:-7}}>
                  {pendientesCount>99?"99+":pendientesCount}
                </span>
              )}
            </button>
          )}
        </div>
      </div>

      {/* ── Pestañas estilo Excel ── */}
      <div style={{display:"flex",gap:2,borderBottom:`2px solid ${C.border}`,
        overflowX:"auto",paddingBottom:0}}>
        <button onClick={()=>setWeekStart(prev=>addDays(prev,-7*4))}
          style={{padding:"6px 10px",borderRadius:"7px 7px 0 0",border:`1px solid ${C.border}`,
            background:"#F8FAFC",color:C.muted,fontSize:14,cursor:"pointer",marginBottom:-2}}>‹</button>
        {weekTabs.map((monday)=>{
          const iso=toISO(monday);
          const active=iso===toISO(weekStart);
          return(
            <button key={iso} onClick={()=>setWeekStart(monday)}
              style={{padding:"6px 14px",borderRadius:"7px 7px 0 0",
                border:`1px solid ${active?C.blue:C.border}`,
                borderBottom:active?"2px solid #fff":"1px solid "+C.border,
                background:active?"#fff":"#F8FAFC",color:active?C.blue:C.muted,
                fontWeight:active?800:500,fontSize:12,cursor:"pointer",
                fontFamily:"inherit",whiteSpace:"nowrap",marginBottom:-2,
                boxShadow:active?"0 -2px 6px rgba(0,0,0,.06)":"none"}}>
              {tabLabel(monday)}
            </button>
          );
        })}
        <button onClick={()=>setWeekStart(prev=>addDays(prev,7*4))}
          style={{padding:"6px 10px",borderRadius:"7px 7px 0 0",border:`1px solid ${C.border}`,
            background:"#F8FAFC",color:C.muted,fontSize:14,cursor:"pointer",marginBottom:-2}}>›</button>
      </div>

      {/* ── Tabla principal ── */}
      <div style={{background:"#fff",border:`1px solid ${C.border}`,borderTop:"none",
        borderRadius:"0 0 12px 12px",overflowX:"auto",
        boxShadow:"0 4px 16px rgba(0,0,0,.07)"}}>
        {loading ? (
          <div style={{textAlign:"center",padding:60,color:C.muted,fontSize:15}}>Cargando flujo…</div>
        ) : (
          <table style={{width:"100%",borderCollapse:"collapse",minWidth:900}}>
            <colgroup>
              <col style={{width:95}}/><col style={{width:105}}/><col style={{width:200}}/>
              {weekDays.map((_,i)=><col key={i} style={{width:92}}/>)}
              <col style={{width:108}}/><col style={{width:62}}/>
            </colgroup>
            <thead>
              <tr style={{background:C.navy}}>
                {TH("Categoría",   {textAlign:"left"})}
                {TH("Segmento",    {textAlign:"left"})}
                {TH("Proveedor / Cliente", {textAlign:"left"})}
                {weekDays.map(({date,label})=>(
                  <th key={date} style={{padding:"9px 8px",color:"#fff",fontWeight:700,
                    fontSize:11,textAlign:"right",whiteSpace:"nowrap"}}>{label}</th>
                ))}
                {TH("Total sem.")}
                {TH("Mon.",{textAlign:"center"})}
              </tr>
            </thead>
            <tbody>

              {/* ── SALDO INICIAL ── */}
              <tr style={{background:"#1E3A5F"}}>
                <td colSpan={9} style={{padding:"4px 10px",fontSize:10,
                  color:"#94A3B8",fontWeight:700,letterSpacing:.8}}>SALDO INICIAL</td>
              </tr>
              {CURRENCIES.map(cur=>{
                const s=saldoIni[cur]||0;
                const clr={MXN:C.mxn,USD:C.usd,EUR:C.eur}[cur];
                return(
                  <tr key={cur} style={{background:rowBg(cur),borderBottom:`1px solid ${C.border}`}}>
                    <td colSpan={3} style={{padding:"5px 10px",fontWeight:700,color:clr,fontSize:13,
                      borderRight:`1px solid ${C.border}`}}>
                      Saldo Inicial {cur==="MXN"?"MN":cur}
                    </td>
                    {weekDays.map(({date})=>(
                      <td key={date} style={{textAlign:"right",padding:"5px 8px",fontWeight:600,
                        color:s>=0?clr:C.danger,fontSize:12,borderRight:`1px solid ${C.border}`}}>
                        {s!==0?`${s<0?"-":""}${sym(cur)} ${fmt(Math.abs(s))}`:"$ —"}
                      </td>
                    ))}
                    <td style={{textAlign:"right",padding:"5px 8px",fontWeight:700,
                      color:s>=0?clr:C.danger,fontSize:12,borderRight:`1px solid ${C.border}`}}>
                      {s!==0?`${s<0?"-":""}${sym(cur)} ${fmt(Math.abs(s))}`:"$ —"}
                    </td>
                    <td style={{padding:"4px 6px",textAlign:"center"}}><Badge cur={cur}/></td>
                  </tr>
                );
              })}

              {/* ── INGRESOS ── */}
              <tr style={{background:"#1B5E20"}}>
                <td colSpan={9} style={{padding:"5px 10px",color:"#fff",fontWeight:800,
                  fontSize:12,letterSpacing:.6}}>▲  INGRESOS</td>
              </tr>
              {plantIng.length===0&&ingRows.length===0&&(
                <tr><td colSpan={9} style={{padding:"16px",color:C.muted,
                  textAlign:"center",fontStyle:"italic",fontSize:13}}>
                  Plantilla vacía — usa "Gestionar plantilla" para agregar filas
                </td></tr>
              )}
              {plantIng.map(row=>renderPlantRow(row,"ingreso"))}
              {ingRows.length>0&&(
                <>
                  <tr style={{background:"#F0FDF4"}}>
                    <td colSpan={9} style={{padding:"3px 10px",fontSize:10,
                      color:C.usd,fontWeight:700,letterSpacing:.5}}>
                      — AUTORIZADOS CxC —
                    </td>
                  </tr>
                  {ingRows.map(row=>renderAutoRow(row,"ingreso"))}
                </>
              )}

              {/* SUMA DIVISAS */}
              <tr style={{background:"#1B5E20",borderTop:`2px solid #2E7D32`}}>
                <td colSpan={3} style={{fontWeight:800,color:"#fff",padding:"6px 10px",fontSize:12,
                  borderRight:`1px solid rgba(255,255,255,.2)`}}>SUMA DIVISAS</td>
                {weekDays.map(({date})=>{
                  const dt=ingDayTot[date];
                  const s=(dt?.MXN||0)+(dt?.USD||0)+(dt?.EUR||0);
                  return<td key={date} style={{textAlign:"right",fontWeight:700,color:"#fff",
                    padding:"6px 8px",fontSize:12,borderRight:`1px solid rgba(255,255,255,.2)`}}>
                    {s>0?`$ ${fmt(s)}`:"$ —"}
                  </td>;
                })}
                <td style={{textAlign:"right",fontWeight:800,color:"#fff",padding:"6px 8px",fontSize:12,
                  borderRight:`1px solid rgba(255,255,255,.2)`}}>
                  {(ingWeekTot.MXN+ingWeekTot.USD+ingWeekTot.EUR)>0
                    ?`$ ${fmt(ingWeekTot.MXN+ingWeekTot.USD+ingWeekTot.EUR)}`:"$ —"}
                </td>
                <td/>
              </tr>

              {/* INGRESOS POR DIVISA */}
              <tr style={{background:"#004D40"}}>
                <td colSpan={9} style={{padding:"4px 10px",fontSize:10,
                  color:"#80CBC4",fontWeight:700,letterSpacing:.5}}>INGRESOS POR DIVISA</td>
              </tr>
              {CURRENCIES.map(cur=>{
                const wt=ingWeekTot[cur]||0;
                if(!wt&&!weekDays.some(({date})=>(ingDayTot[date]?.[cur]||0)>0)) return null;
                const clr={MXN:"#B2DFDB",USD:"#A5F3FC",EUR:"#C4B5FD"}[cur];
                return(
                  <tr key={cur} style={{background:"#00695C",borderBottom:"1px solid #00796B"}}>
                    <td colSpan={3} style={{padding:"5px 10px",fontWeight:700,color:clr,fontSize:12,
                      borderRight:"1px solid rgba(255,255,255,.15)"}}>
                      {cur==="MXN"?"MN":cur}
                    </td>
                    {weekDays.map(({date})=>{
                      const v=ingDayTot[date]?.[cur]||0;
                      return<td key={date} style={{textAlign:"right",fontWeight:v?700:400,
                        color:v?clr:"rgba(255,255,255,.3)",padding:"5px 8px",fontSize:12,
                        borderRight:"1px solid rgba(255,255,255,.15)"}}>
                        {v?`$ ${fmt(v)}`:"$ —"}
                      </td>;
                    })}
                    <td style={{textAlign:"right",fontWeight:700,color:clr,padding:"5px 8px",fontSize:12,
                      borderRight:"1px solid rgba(255,255,255,.15)"}}>
                      {wt?`$ ${fmt(wt)}`:"$ —"}
                    </td>
                    <td style={{padding:"4px 6px",textAlign:"center"}}><Badge cur={cur}/></td>
                  </tr>
                );
              })}

              {/* INGRESOS CONVERSIÓN A MONEDA NACIONAL */}
              <tr style={{background:"#1A237E"}}>
                <td colSpan={9} style={{padding:"4px 10px",fontSize:10,
                  color:"#9FA8DA",fontWeight:700,letterSpacing:.5}}>
                  INGRESOS CONVERSIÓN A MONEDA NACIONAL  ·  USD ×{tipoCambio.USD.toFixed(4)}  ·  EUR ×{tipoCambio.EUR.toFixed(4)}
                </td>
              </tr>
              {[
                {cur:"MXN", factor:1, label:"MN",  clr:"#C5CAE9"},
                {cur:"USD", factor:tipoCambio.USD, label:"USD", clr:"#B3E5FC"},
                {cur:"EUR", factor:tipoCambio.EUR, label:"EUR", clr:"#E1BEE7"},
              ].map(({cur,factor,label,clr})=>{
                const wt=(ingWeekTot[cur]||0)*factor;
                return(
                  <tr key={cur} style={{background:"#283593",borderBottom:"1px solid #303F9F"}}>
                    <td colSpan={3} style={{padding:"5px 10px",fontWeight:700,color:clr,fontSize:12,
                      borderRight:"1px solid rgba(255,255,255,.1)"}}>{label}</td>
                    {weekDays.map(({date})=>{
                      const v=(ingDayTot[date]?.[cur]||0)*factor;
                      return<td key={date} style={{textAlign:"right",fontWeight:v?700:400,
                        color:v?clr:"rgba(255,255,255,.3)",padding:"5px 8px",fontSize:12,
                        borderRight:"1px solid rgba(255,255,255,.1)"}}>
                        {v?`$ ${fmt(v)}`:"$ —"}
                      </td>;
                    })}
                    <td style={{textAlign:"right",fontWeight:700,color:clr,padding:"5px 8px",fontSize:12,
                      borderRight:"1px solid rgba(255,255,255,.1)"}}>
                      {wt?`$ ${fmt(wt)}`:"$ —"}
                    </td>
                    <td/>
                  </tr>
                );
              })}
              {/* Total conversión */}
              <tr style={{background:"#0D47A1",borderTop:"2px solid #1565C0"}}>
                <td colSpan={3} style={{fontWeight:800,color:"#fff",padding:"7px 10px",fontSize:13,
                  borderRight:"1px solid rgba(255,255,255,.2)"}}>TOTAL MN EQUIVALENTE</td>
                {weekDays.map(({date})=>{
                  const dt=ingDayTot[date];
                  const v=(dt?.MXN||0)+(dt?.USD||0)*tipoCambio.USD+(dt?.EUR||0)*tipoCambio.EUR;
                  return<td key={date} style={{textAlign:"right",fontWeight:800,
                    color:v?"#FFE082":"rgba(255,255,255,.4)",padding:"7px 8px",fontSize:13,
                    borderRight:"1px solid rgba(255,255,255,.2)"}}>
                    {v?`$ ${fmt(v)}`:"$ —"}
                  </td>;
                })}
                <td style={{textAlign:"right",fontWeight:800,color:"#FFE082",padding:"7px 8px",fontSize:13,
                  borderRight:"1px solid rgba(255,255,255,.2)"}}>
                  {(()=>{const v=(ingWeekTot.MXN||0)+(ingWeekTot.USD||0)*tipoCambio.USD+(ingWeekTot.EUR||0)*tipoCambio.EUR;return v?`$ ${fmt(v)}`:"$ —";})()}
                </td>
                <td/>
              </tr>

              {/* ── ESPACIO ── */}
              <tr><td colSpan={9} style={{height:8,background:"#F1F5F9"}}/></tr>

              {/* ── EGRESOS ── */}
              <tr style={{background:"#BF360C"}}>
                <td colSpan={9} style={{padding:"5px 10px",color:"#fff",fontWeight:800,
                  fontSize:12,letterSpacing:.6}}>▼  EGRESOS</td>
              </tr>
              {plantEgr.length===0&&egrRows.length===0&&(
                <tr><td colSpan={9} style={{padding:"16px",color:C.muted,
                  textAlign:"center",fontStyle:"italic",fontSize:13}}>
                  Sin egresos en la plantilla para esta semana
                </td></tr>
              )}
              {plantEgr.map(row=>renderPlantRow(row,"egreso"))}
              {egrRows.length>0&&(
                <>
                  <tr style={{background:"#FFF8E1"}}>
                    <td colSpan={9} style={{padding:"3px 10px",fontSize:10,
                      color:C.warn,fontWeight:700,letterSpacing:.5}}>
                      — AUTORIZADOS CxP —
                    </td>
                  </tr>
                  {egrRows.map(row=>renderAutoRow(row,"egreso"))}
                </>
              )}
              <tr style={{background:C.danger,borderTop:`2px solid #C62828`}}>
                <td colSpan={3} style={{fontWeight:800,color:"#fff",padding:"6px 10px",fontSize:12,
                  borderRight:"1px solid rgba(255,255,255,.2)"}}>TOTAL EGRESOS MN</td>
                {weekDays.map(({date})=>{
                  const s=egrDayTot[date]?.MXN||0;
                  return<td key={date} style={{textAlign:"right",fontWeight:700,color:"#fff",
                    padding:"6px 8px",fontSize:12,borderRight:"1px solid rgba(255,255,255,.2)"}}>
                    {s?`$ ${fmt(s)}`:"$ —"}
                  </td>;
                })}
                <td style={{textAlign:"right",fontWeight:800,color:"#fff",padding:"6px 8px",fontSize:12,
                  borderRight:"1px solid rgba(255,255,255,.2)"}}>
                  {egrWeekTot.MXN?`$ ${fmt(egrWeekTot.MXN)}`:"$ —"}
                </td>
                <td/>
              </tr>

              {/* ── SALDO FINAL ── */}
              <tr><td colSpan={9} style={{height:6,background:"#F1F5F9"}}/></tr>
              {CURRENCIES.map(cur=>{
                const finalS=runningSaldo[weekDays[4]?.date]?.[cur]||0;
                const ingT=ingWeekTot[cur]||0, egrT=egrWeekTot[cur]||0;
                if(!finalS&&!ingT&&!egrT) return null;
                const neg=finalS<0;
                return(
                  <tr key={cur} style={{background:C.navy,borderBottom:"1px solid #1A3040"}}>
                    <td colSpan={3} style={{fontWeight:800,color:"#fff",padding:"8px 10px",fontSize:13,
                      borderRight:"1px solid rgba(255,255,255,.1)"}}>
                      Saldo Final {cur==="MXN"?"MN":cur}
                    </td>
                    {weekDays.map(({date})=>{
                      const s=runningSaldo[date]?.[cur]||0;
                      return<td key={date} style={{textAlign:"right",fontWeight:700,fontSize:13,
                        padding:"8px 8px",color:s>=0?"#A5F3FC":"#FCA5A5",
                        borderRight:"1px solid rgba(255,255,255,.1)"}}>
                        {`${s<0?"-":""}${sym(cur)} ${fmt(Math.abs(s))}`}
                      </td>;
                    })}
                    <td style={{textAlign:"right",fontWeight:800,fontSize:13,padding:"8px 8px",
                      color:neg?"#FCA5A5":"#A5F3FC",borderRight:"1px solid rgba(255,255,255,.1)"}}>
                      {`${neg?"-":""}${sym(cur)} ${fmt(Math.abs(finalS))}`}
                    </td>
                    <td style={{padding:"4px 6px",textAlign:"center"}}><Badge cur={cur}/></td>
                  </tr>
                );
              })}

            </tbody>
          </table>
        )}
      </div>

      {/* ═══════ MODALS ═══════ */}
      {plantModal&&(
        <PlantillaModal
          plantilla={plantilla}
          onSave={handleSavePlant}
          onDelete={handleDeletePlant}
          onReorder={handleReorder}
          onClose={()=>setPlantModal(false)}
          empresaId={empresaId}
        />
      )}
      {saldoModal&&(
        <SaldoTCModal
          saldo={saldoIni} tc={tipoCambio}
          onSave={handleSaveSaldo}
          onClose={()=>setSaldoModal(false)}
        />
      )}
      {panelOpen&&(
        <PanelSelectorModal
          invoices={invoices} ingresos={ingresos} cobros={cobros}
          onProjectInvoice={onProjectInvoice} onUnprojectInvoice={onUnprojectInvoice}
          onProjectIngreso={onProjectIngreso} onUnprojectIngreso={onUnprojectIngreso}
          onClose={()=>setPanelOpen(false)}
        />
      )}
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════
   MODAL: GESTIONAR PLANTILLA
   ═══════════════════════════════════════════════════════════ */
function PlantillaModal({ plantilla, onSave, onDelete, onReorder, onClose }) {
  const EMPTY = {tipo:"ingreso",categoria:"",segmento:"",nombre:"",moneda:"MXN",orden:0};
  const [form, setForm]   = useState(EMPTY);
  const [editId, setEditId] = useState(null);
  const upd = e => setForm(f=>({...f,[e.target.name]:e.target.value}));
  const startEdit = (row) => { setForm({...row}); setEditId(row.id); };
  const cancel    = () => { setForm(EMPTY); setEditId(null); };
  const save = () => {
    if(!form.nombre.trim()) return;
    const maxOrden = plantilla.length ? Math.max(...plantilla.map(r=>r.orden||0))+1 : 0;
    onSave({...form, id: editId||undefined, orden: editId?form.orden:maxOrden});
    cancel();
  };
  const isIng = form.tipo==="ingreso";
  const accentC = isIng ? C.ok : C.danger;
  const Lbl = ({label,children}) => (
    <div style={{marginBottom:10}}>
      <label style={{display:"block",fontSize:10,fontWeight:700,color:C.muted,
        textTransform:"uppercase",letterSpacing:.4,marginBottom:3}}>{label}</label>
      {children}
    </div>
  );
  return (
    <div style={{position:"fixed",inset:0,background:"rgba(15,45,74,.5)",
      display:"flex",alignItems:"center",justifyContent:"center",zIndex:1100,padding:16}}
      onClick={onClose}>
      <div onClick={e=>e.stopPropagation()} style={{background:"#fff",borderRadius:18,
        width:"100%",maxWidth:760,maxHeight:"88vh",display:"flex",flexDirection:"column",
        boxShadow:"0 24px 80px rgba(0,0,0,.3)"}}>

        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",
          padding:"18px 22px 12px",flexShrink:0}}>
          <h2 style={{fontSize:19,fontWeight:800,color:C.navy,margin:0}}>
            📋 Gestionar plantilla del EFE
          </h2>
          <button onClick={onClose} style={{background:"#F1F5F9",border:"none",borderRadius:8,
            width:34,height:34,cursor:"pointer",fontSize:17}}>×</button>
        </div>

        {/* Lista de filas existentes */}
        <div style={{flex:1,overflowY:"auto",padding:"0 22px 8px"}}>
          {plantilla.length===0&&(
            <p style={{textAlign:"center",color:C.muted,padding:20,fontStyle:"italic"}}>
              Sin filas aún — agrega la primera abajo
            </p>
          )}
          {["ingreso","egreso"].map(tipo=>{
            const rows=plantilla.filter(r=>r.tipo===tipo);
            if(!rows.length) return null;
            return(
              <div key={tipo} style={{marginBottom:16}}>
                <div style={{fontWeight:700,color:tipo==="ingreso"?C.ok:C.danger,
                  fontSize:12,textTransform:"uppercase",letterSpacing:.5,marginBottom:8}}>
                  {tipo==="ingreso"?"▲ Ingresos":"▼ Egresos"}
                </div>
                <table style={{width:"100%",borderCollapse:"collapse",fontSize:12}}>
                  <thead>
                    <tr style={{background:"#F8FAFC"}}>
                      <th style={{padding:"6px 8px",textAlign:"left",fontWeight:700,color:C.muted,width:30}}>#</th>
                      <th style={{padding:"6px 8px",textAlign:"left",fontWeight:700,color:C.muted}}>Nombre</th>
                      <th style={{padding:"6px 8px",textAlign:"left",fontWeight:700,color:C.muted}}>Categoría</th>
                      <th style={{padding:"6px 8px",textAlign:"left",fontWeight:700,color:C.muted}}>Segmento</th>
                      <th style={{padding:"6px 8px",textAlign:"center",fontWeight:700,color:C.muted,width:60}}>Mon.</th>
                      <th style={{padding:"6px 8px",textAlign:"center",fontWeight:700,color:C.muted,width:100}}>Orden</th>
                      <th style={{padding:"6px 8px",width:80}}></th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((row,idx)=>(
                      <tr key={row.id} style={{borderBottom:`1px solid ${C.border}`,
                        background:editId===row.id?"#EFF6FF":""}}>
                        <td style={{padding:"6px 8px",color:C.muted}}>{idx+1}</td>
                        <td style={{padding:"6px 8px",fontWeight:600,color:C.text}}>{row.nombre}</td>
                        <td style={{padding:"6px 8px",color:C.muted}}>{row.categoria}</td>
                        <td style={{padding:"6px 8px",color:C.muted}}>{row.segmento}</td>
                        <td style={{padding:"6px 8px",textAlign:"center"}}><Badge cur={row.moneda}/></td>
                        <td style={{padding:"6px 8px",textAlign:"center"}}>
                          <div style={{display:"flex",gap:4,justifyContent:"center"}}>
                            <button onClick={()=>onReorder(row.id,"up")}
                              style={{border:`1px solid ${C.border}`,background:"#F8FAFC",
                                borderRadius:5,padding:"1px 7px",cursor:"pointer",fontSize:12}}>↑</button>
                            <button onClick={()=>onReorder(row.id,"down")}
                              style={{border:`1px solid ${C.border}`,background:"#F8FAFC",
                                borderRadius:5,padding:"1px 7px",cursor:"pointer",fontSize:12}}>↓</button>
                          </div>
                        </td>
                        <td style={{padding:"6px 8px",textAlign:"right"}}>
                          <button onClick={()=>startEdit(row)}
                            style={{border:"none",background:"none",cursor:"pointer",
                              fontSize:13,color:C.sky,padding:"2px 4px"}}>✏️</button>
                          <button onClick={()=>onDelete(row.id)}
                            style={{border:"none",background:"none",cursor:"pointer",
                              fontSize:13,color:C.danger,padding:"2px 4px"}}>🗑</button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            );
          })}
        </div>

        {/* Formulario agregar/editar */}
        <div style={{padding:"14px 22px",borderTop:`1px solid ${C.border}`,
          background:"#F8FAFC",borderRadius:"0 0 18px 18px",flexShrink:0}}>
          <div style={{fontWeight:700,color:C.navy,fontSize:13,marginBottom:10}}>
            {editId ? "✏️ Editando fila" : "➕ Nueva fila"}
          </div>
          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr 1fr 90px",gap:10,marginBottom:10}}>
            <Lbl label="Nombre *">
              <input name="nombre" value={form.nombre} onChange={upd}
                style={inputSt} placeholder="BRASIL WORLD"/>
            </Lbl>
            <Lbl label="Categoría">
              <select name="categoria" value={form.categoria} onChange={upd} style={selSt}>
                <option value="">—</option>
                {(isIng?CATS_ING:CATS_EGR).map(c=><option key={c}>{c}</option>)}
              </select>
            </Lbl>
            <Lbl label="Segmento">
              <input name="segmento" value={form.segmento} onChange={upd}
                style={inputSt} placeholder="TAS / Transporte…"/>
            </Lbl>
            <Lbl label="Moneda">
              <select name="moneda" value={form.moneda} onChange={upd} style={selSt}>
                {["MXN","USD","EUR"].map(c=><option key={c}>{c}</option>)}
              </select>
            </Lbl>
            <Lbl label="Tipo">
              <select name="tipo" value={form.tipo} onChange={upd} style={selSt}>
                <option value="ingreso">Ingreso</option>
                <option value="egreso">Egreso</option>
              </select>
            </Lbl>
          </div>
          <div style={{display:"flex",gap:8}}>
            {editId&&(
              <button onClick={cancel}
                style={{padding:"8px 16px",borderRadius:8,border:`1px solid ${C.border}`,
                  background:"#fff",cursor:"pointer",fontFamily:"inherit",fontSize:13}}>
                Cancelar
              </button>
            )}
            <button onClick={save} disabled={!form.nombre.trim()}
              style={{padding:"8px 22px",borderRadius:8,border:"none",fontFamily:"inherit",
                background:form.nombre.trim()?accentC:"#B0BEC5",color:"#fff",fontWeight:700,
                cursor:form.nombre.trim()?"pointer":"not-allowed",fontSize:13}}>
              {editId ? "Guardar cambios" : "Agregar fila"}
            </button>
            <button onClick={onClose}
              style={{marginLeft:"auto",padding:"8px 16px",borderRadius:8,
                border:`1px solid ${C.border}`,background:"#fff",cursor:"pointer",
                fontFamily:"inherit",fontSize:13}}>
              Cerrar
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════
   MODAL: SALDOS + TIPO DE CAMBIO
   ═══════════════════════════════════════════════════════════ */
function SaldoTCModal({ saldo, tc, onSave, onClose }) {
  const [s, setS] = useState({...saldo});
  const [t, setT] = useState({...tc});
  const inputSt2={padding:"7px 10px",borderRadius:6,border:"1px solid #E2E8F0",fontSize:14,
    outline:"none",background:"#FAFBFC",width:"100%",fontFamily:"inherit",boxSizing:"border-box"};
  const Lbl=({label,children})=>(
    <div style={{marginBottom:13}}>
      <label style={{display:"block",fontSize:11,fontWeight:700,color:C.muted,
        textTransform:"uppercase",letterSpacing:.4,marginBottom:4}}>{label}</label>
      {children}
    </div>
  );
  return (
    <div style={{position:"fixed",inset:0,background:"rgba(15,45,74,.45)",display:"flex",
      alignItems:"center",justifyContent:"center",zIndex:1200,padding:20}} onClick={onClose}>
      <div onClick={e=>e.stopPropagation()} style={{background:"#fff",borderRadius:18,
        padding:26,maxWidth:400,width:"100%",boxShadow:"0 20px 60px rgba(0,0,0,.25)"}}>
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:18}}>
          <h2 style={{fontSize:17,fontWeight:800,color:C.navy,margin:0}}>⚙️ Saldos y Tipo de Cambio</h2>
          <button onClick={onClose} style={{background:"#F1F5F9",border:"none",borderRadius:7,
            width:32,height:32,cursor:"pointer",fontSize:17}}>×</button>
        </div>

        <div style={{fontSize:12,fontWeight:700,color:C.muted,textTransform:"uppercase",
          letterSpacing:.5,marginBottom:10}}>Saldo Inicial</div>
        {["MXN","USD","EUR"].map(cur=>(
          <Lbl key={cur} label={`Saldo ${cur==="MXN"?"MN (MXN)":cur}`}>
            <input type="number" value={s[cur]}
              onChange={e=>setS(p=>({...p,[cur]:+e.target.value||0}))}
              style={inputSt2} step="0.01"/>
          </Lbl>
        ))}

        <div style={{fontSize:12,fontWeight:700,color:C.muted,textTransform:"uppercase",
          letterSpacing:.5,margin:"16px 0 10px"}}>Tipo de Cambio (para conversión a MN)</div>
        {["USD","EUR"].map(cur=>(
          <Lbl key={cur} label={`TC ${cur} → MN`}>
            <div style={{display:"flex",gap:6,alignItems:"center"}}>
              <input type="number" value={t[cur]}
                onChange={e=>setT(p=>({...p,[cur]:+e.target.value||0}))}
                style={{...inputSt2,fontWeight:700}} step="0.0001" min="0"/>
              <span style={{fontSize:12,color:C.muted,whiteSpace:"nowrap"}}>MXN x {cur}</span>
            </div>
          </Lbl>
        ))}

        <div style={{display:"flex",gap:8,marginTop:18}}>
          <button onClick={onClose} style={{flex:1,padding:"9px",borderRadius:9,
            border:`1px solid ${C.border}`,background:"#F8FAFC",cursor:"pointer",fontFamily:"inherit"}}>
            Cancelar
          </button>
          <button onClick={()=>onSave(s,t)} style={{flex:2,padding:"9px",borderRadius:9,
            border:"none",background:C.blue,color:"#fff",fontWeight:700,
            cursor:"pointer",fontFamily:"inherit"}}>
            Guardar
          </button>
        </div>
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════
   MODAL: PANEL SELECTOR (sin cambios)
   ═══════════════════════════════════════════════════════════ */
function PanelSelectorModal({
  invoices,ingresos,cobros,
  onProjectInvoice,onUnprojectInvoice,onProjectIngreso,onUnprojectIngreso,onClose,
}){
  const[tab,setTab]=useState("cxp");
  const[search,setSearch]=useState("");
  const allInv=[
    ...(invoices.MXN||[]).map(i=>({...i,moneda:"MXN"})),
    ...(invoices.USD||[]).map(i=>({...i,moneda:"USD"})),
    ...(invoices.EUR||[]).map(i=>({...i,moneda:"EUR"})),
  ].filter(i=>i.estatus!=="Pagado");
  const[invDates,setInvDates]=useState(()=>{
    const m={};allInv.forEach(i=>{m[i.id]=i.fechaEfe||i.fechaProgramacion||"";});return m;
  });
  const[invSel,setInvSel]=useState(new Set());
  const[ingDates,setIngDates]=useState(()=>{
    const m={};ingresos.forEach(i=>{m[i.id]=i.fechaEfe||i.fechaFicticia||i.fechaVencimiento||i.fecha||"";});return m;
  });
  const[ingSel,setIngSel]=useState(new Set());
  const q=search.toLowerCase();
  const filtInv=allInv.filter(i=>!q||[i.proveedor,i.clasificacion].some(s=>s?.toLowerCase().includes(q)));
  const filtIng=ingresos.filter(i=>!i.oculta&&(!q||[i.cliente,i.concepto,i.categoria].some(s=>s?.toLowerCase().includes(q))));
  const fmtN=n=>new Intl.NumberFormat("es-MX",{minimumFractionDigits:2,maximumFractionDigits:2}).format(+n||0);
  const s2=cur=>cur==="EUR"?"€":"$";
  const toggleInv=id=>setInvSel(p=>{const n=new Set(p);n.has(id)?n.delete(id):n.add(id);return n;});
  const toggleIng=id=>setIngSel(p=>{const n=new Set(p);n.has(id)?n.delete(id):n.add(id);return n;});
  const proyInv=async()=>{
    for(const id of invSel){const inv=allInv.find(i=>i.id===id);if(inv)await onProjectInvoice?.(inv,invDates[id]||"");}
    setInvSel(new Set());
  };
  const proyIng=async()=>{
    for(const id of ingSel){const ing=ingresos.find(i=>i.id===id);if(ing)await onProjectIngreso?.(ing,ingDates[id]||"");}
    setIngSel(new Set());
  };
  const pendInv=filtInv.filter(i=>!i.enEfe).length;
  const pendIng=filtIng.filter(i=>!i.enEfe).length;
  const inputSt={padding:"7px 10px",borderRadius:6,border:"1px solid #E2E8F0",fontSize:13,
    outline:"none",background:"#FAFBFC",width:"100%",fontFamily:"inherit",color:C.text,boxSizing:"border-box"};
  return(
    <div style={{position:"fixed",inset:0,background:"rgba(15,45,74,.5)",
      display:"flex",alignItems:"center",justifyContent:"center",zIndex:1100,padding:16}} onClick={onClose}>
      <div onClick={e=>e.stopPropagation()} style={{background:"#fff",borderRadius:18,
        width:"100%",maxWidth:820,maxHeight:"88vh",display:"flex",flexDirection:"column",
        boxShadow:"0 24px 80px rgba(0,0,0,.3)"}}>
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",
          padding:"18px 22px 10px",flexShrink:0}}>
          <h2 style={{fontSize:19,fontWeight:800,color:C.navy,margin:0}}>🌊 Autorizar al EFE</h2>
          <button onClick={onClose} style={{background:"#F1F5F9",border:"none",borderRadius:8,
            width:34,height:34,cursor:"pointer",fontSize:17}}>×</button>
        </div>
        <div style={{padding:"0 22px 10px",flexShrink:0}}>
          <input value={search} onChange={e=>setSearch(e.target.value)}
            placeholder="🔍 Buscar..." style={inputSt}/>
        </div>
        <div style={{display:"flex",borderBottom:`2px solid ${C.border}`,padding:"0 22px",flexShrink:0}}>
          {[{id:"cxp",label:"Facturas CxP",count:pendInv,color:C.warn},
            {id:"cxc",label:"Ingresos CxC",count:pendIng,color:C.ok}].map(t=>(
            <button key={t.id} onClick={()=>setTab(t.id)}
              style={{padding:"7px 18px",border:"none",background:"none",cursor:"pointer",
                fontFamily:"inherit",fontSize:13,fontWeight:tab===t.id?800:500,
                color:tab===t.id?C.blue:C.muted,
                borderBottom:tab===t.id?`3px solid ${C.blue}`:"3px solid transparent",
                marginBottom:-2,display:"flex",alignItems:"center",gap:7}}>
              {t.label}
              {t.count>0&&<span style={{background:t.color,color:"#fff",fontSize:10,
                fontWeight:700,borderRadius:20,padding:"1px 7px"}}>{t.count}</span>}
            </button>
          ))}
        </div>
        <div style={{flex:1,overflowY:"auto",padding:"0 22px 10px"}}>
          <table style={{width:"100%",borderCollapse:"collapse",fontSize:12,marginTop:8}}>
            <thead>
              <tr style={{background:"#F8FAFC",position:"sticky",top:0,zIndex:1}}>
                <th style={{padding:"7px 6px",width:34}}>
                  <input type="checkbox"
                    checked={tab==="cxp"?invSel.size===filtInv.filter(i=>!i.enEfe).length&&invSel.size>0
                                        :ingSel.size===filtIng.filter(i=>!i.enEfe).length&&ingSel.size>0}
                    onChange={()=>{
                      if(tab==="cxp"){const ids=filtInv.filter(i=>!i.enEfe).map(i=>i.id);setInvSel(p=>p.size===ids.length?new Set():new Set(ids));}
                      else{const ids=filtIng.filter(i=>!i.enEfe).map(i=>i.id);setIngSel(p=>p.size===ids.length?new Set():new Set(ids));}
                    }}
                    style={{cursor:"pointer",width:14,height:14,accentColor:C.blue}}/>
                </th>
                <th style={{padding:"7px 8px",textAlign:"left",fontWeight:700,color:C.muted}}>
                  {tab==="cxp"?"Proveedor":"Cliente"}
                </th>
                <th style={{padding:"7px 8px",textAlign:"left",fontWeight:700,color:C.muted}}>Cat.</th>
                <th style={{padding:"7px 8px",textAlign:"right",fontWeight:700,color:C.muted}}>Saldo</th>
                <th style={{padding:"7px 8px",textAlign:"center",fontWeight:700,color:C.muted,width:130}}>Fecha EFE</th>
                <th style={{padding:"7px 8px",textAlign:"center",fontWeight:700,color:C.muted,width:70}}>Estado</th>
              </tr>
            </thead>
            <tbody>
              {tab==="cxp"&&filtInv.map(inv=>{
                const saldo=Math.max(0,(inv.total||0)-(inv.montoPagado||0));
                const inEfe=inv.enEfe;
                return(
                  <tr key={inv.id} style={{borderBottom:`1px solid ${C.border}`,background:inEfe?"#EFF6FF":""}}
                    onMouseEnter={e=>{if(!inEfe)e.currentTarget.style.background="#F8FAFC"}}
                    onMouseLeave={e=>{e.currentTarget.style.background=inEfe?"#EFF6FF":"";}}>
                    <td style={{padding:"6px 6px",textAlign:"center"}}>
                      {!inEfe&&<input type="checkbox" checked={invSel.has(inv.id)}
                        onChange={()=>toggleInv(inv.id)} style={{cursor:"pointer",width:14,height:14,accentColor:C.blue}}/>}
                    </td>
                    <td style={{padding:"6px 8px"}}>
                      <div style={{fontWeight:600,color:C.text}}>{inv.proveedor}</div>
                      <div style={{fontSize:10,color:C.muted}}>{inv.serie}{inv.folio} · {inv.moneda}</div>
                    </td>
                    <td style={{padding:"6px 8px",color:C.muted,fontSize:11}}>{inv.clasificacion}</td>
                    <td style={{padding:"6px 8px",textAlign:"right",fontWeight:700,color:C.danger}}>
                      {s2(inv.moneda)}{fmtN(saldo)}
                    </td>
                    <td style={{padding:"6px 8px",textAlign:"center"}}>
                      {!inEfe
                        ?<input type="date" value={invDates[inv.id]||""}
                          onChange={e=>setInvDates(p=>({...p,[inv.id]:e.target.value}))}
                          style={{padding:"3px 5px",fontSize:11,border:`1px solid ${C.border}`,borderRadius:5,fontFamily:"inherit"}}/>
                        :<span style={{fontSize:11,color:C.blue,fontWeight:600}}>✅ {inv.fechaEfe}</span>}
                    </td>
                    <td style={{padding:"6px 8px",textAlign:"center"}}>
                      {inEfe
                        ?<button onClick={()=>onUnprojectInvoice?.(inv.id)}
                          style={{border:"1px solid #FFCDD2",background:"#FFEBEE",color:C.danger,
                            borderRadius:5,padding:"2px 7px",fontSize:11,cursor:"pointer",fontFamily:"inherit"}}>
                          Quitar
                        </button>
                        :<button onClick={async()=>await onProjectInvoice?.(inv,invDates[inv.id]||"")}
                          disabled={!invDates[inv.id]}
                          style={{border:`1px solid ${invDates[inv.id]?C.blue:C.border}`,
                            background:invDates[inv.id]?"#EFF6FF":"#F8FAFC",
                            color:invDates[inv.id]?C.blue:C.muted,borderRadius:5,
                            padding:"2px 7px",fontSize:11,cursor:invDates[inv.id]?"pointer":"not-allowed",fontFamily:"inherit"}}>
                          🌊
                        </button>}
                    </td>
                  </tr>
                );
              })}
              {tab==="cxc"&&filtIng.map(ing=>{
                const cobrado=cobros.filter(c=>c.ingresoId===ing.id).reduce((s,c)=>s+c.monto,0);
                const pc=Math.max(0,ing.monto-cobrado);
                const inEfe=ing.enEfe;
                return(
                  <tr key={ing.id} style={{borderBottom:`1px solid ${C.border}`,background:inEfe?"#F0FDF4":""}}
                    onMouseEnter={e=>{if(!inEfe)e.currentTarget.style.background="#F8FAFC"}}
                    onMouseLeave={e=>{e.currentTarget.style.background=inEfe?"#F0FDF4":"";}}>
                    <td style={{padding:"6px 6px",textAlign:"center"}}>
                      {!inEfe&&<input type="checkbox" checked={ingSel.has(ing.id)}
                        onChange={()=>toggleIng(ing.id)} style={{cursor:"pointer",width:14,height:14,accentColor:C.blue}}/>}
                    </td>
                    <td style={{padding:"6px 8px"}}>
                      <div style={{fontWeight:600,color:C.text}}>{ing.cliente}</div>
                      <div style={{fontSize:10,color:C.muted}}>{ing.concepto} · {ing.moneda||"MXN"}</div>
                    </td>
                    <td style={{padding:"6px 8px",color:C.muted,fontSize:11}}>{ing.categoria}</td>
                    <td style={{padding:"6px 8px",textAlign:"right",fontWeight:700,color:C.ok}}>
                      {s2(ing.moneda||"MXN")}{fmtN(pc)}
                    </td>
                    <td style={{padding:"6px 8px",textAlign:"center"}}>
                      {!inEfe
                        ?<input type="date" value={ingDates[ing.id]||""}
                          onChange={e=>setIngDates(p=>({...p,[ing.id]:e.target.value}))}
                          style={{padding:"3px 5px",fontSize:11,border:`1px solid ${C.border}`,borderRadius:5,fontFamily:"inherit"}}/>
                        :<span style={{fontSize:11,color:C.ok,fontWeight:600}}>✅ {ing.fechaEfe}</span>}
                    </td>
                    <td style={{padding:"6px 8px",textAlign:"center"}}>
                      {inEfe
                        ?<button onClick={()=>onUnprojectIngreso?.(ing.id)}
                          style={{border:"1px solid #FFCDD2",background:"#FFEBEE",color:C.danger,
                            borderRadius:5,padding:"2px 7px",fontSize:11,cursor:"pointer",fontFamily:"inherit"}}>
                          Quitar
                        </button>
                        :<button onClick={async()=>await onProjectIngreso?.(ing,ingDates[ing.id]||"")}
                          disabled={!ingDates[ing.id]}
                          style={{border:`1px solid ${ingDates[ing.id]?C.ok:C.border}`,
                            background:ingDates[ing.id]?"#F0FDF4":"#F8FAFC",
                            color:ingDates[ing.id]?C.ok:C.muted,borderRadius:5,
                            padding:"2px 7px",fontSize:11,cursor:ingDates[ing.id]?"pointer":"not-allowed",fontFamily:"inherit"}}>
                          🌊
                        </button>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <div style={{padding:"12px 22px",borderTop:`1px solid ${C.border}`,flexShrink:0,
          display:"flex",gap:8,alignItems:"center",background:"#F8FAFC",borderRadius:"0 0 18px 18px"}}>
          <span style={{flex:1,fontSize:12,color:C.muted}}>
            {tab==="cxp"?invSel.size:ingSel.size} seleccionado(s)
          </span>
          <button onClick={tab==="cxp"?proyInv:proyIng}
            disabled={tab==="cxp"?invSel.size===0:ingSel.size===0}
            style={{padding:"8px 20px",borderRadius:8,border:"none",fontFamily:"inherit",
              background:(tab==="cxp"?invSel.size:ingSel.size)>0?C.navy:"#B0BEC5",
              color:"#fff",fontWeight:700,cursor:"pointer",fontSize:13}}>
            🌊 Proyectar al EFE
          </button>
          <button onClick={onClose} style={{padding:"8px 16px",borderRadius:8,
            border:`1px solid ${C.border}`,background:"#fff",cursor:"pointer",
            fontFamily:"inherit",fontSize:13}}>Cerrar</button>
        </div>
      </div>
    </div>
  );
}
