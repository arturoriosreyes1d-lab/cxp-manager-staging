import React, { useState, useEffect, useMemo } from "react";
import { supabase } from "./supabase.js";

/* ── Paleta ─────────────────────────────────────────────── */
const C = {
  navy:"#0F2D4A", blue:"#1565C0", sky:"#2196F3", teal:"#00897B",
  surface:"#FFFFFF", border:"#E2E8F0", muted:"#64748B", text:"#1A2332",
  danger:"#E53935", warn:"#F59E0B", ok:"#43A047",
  mxn:"#1565C0", usd:"#2E7D32", eur:"#6A1B9A",
  rowUSD:"#F0FFF4", rowEUR:"#F5F3FF", rowMXN:"#FFFFFF",
  badgeMXN:"#DBEAFE", badgeUSD:"#DCFCE7", badgeEUR:"#EDE9FE",
  textMXN:"#1565C0", textUSD:"#166534", textEUR:"#6B21A8",
};
const fmt = n => isNaN(n)||n===""||n===null ? "" :
  new Intl.NumberFormat("es-MX",{minimumFractionDigits:2,maximumFractionDigits:2}).format(+n);
const fmtCell = (n, pos=true) => {
  if (!n || n===0) return "";
  const s = fmt(Math.abs(n));
  return pos ? `$${s}` : `-$${s}`;
};
const sym = cur => cur==="EUR"?"€":"$";

/* ── Helpers de fecha ───────────────────────────────────── */
const getMonday = d => {
  const dt=new Date(d); dt.setHours(12,0,0,0);
  const day=dt.getDay(); dt.setDate(dt.getDate()-day+(day===0?-6:1)); return dt;
};
const addDays=(d,n)=>{const dt=new Date(d);dt.setDate(dt.getDate()+n);return dt;};
const toISO=d=>d.toISOString().split("T")[0];
const MESES_SHORT=["ENE","FEB","MZO","ABR","MAY","JUN","JUL","AGO","SEP","OCT","NOV","DIC"];
const DIAS_SHORT=["Lun","Mar","Mié","Jue","Vie"];
const CURRENCIES=["MXN","USD","EUR"];
const CATS_ING=["Circuitos","Tour Adicionales","Botelería","Reprotecciones","Traslados",
  "Hotelería","Cuba","Excursiones","Cobranza directa","Transferencia","Otro"];
const CATS_EGR=["Financiamientos","Nómina","Combustible","Impuestos","Seguros","Reprotecciones",
  "Apoyos transportación","Peajes","Sistemas","Honorarios","Fondo fijo","Mantenimiento","Servicios","Otro"];

const inputSt={padding:"7px 10px",borderRadius:7,border:"1px solid #E2E8F0",fontSize:13,
  outline:"none",background:"#FAFBFC",width:"100%",fontFamily:"inherit",color:"#1A2332",boxSizing:"border-box"};
const selSt={...inputSt,cursor:"pointer"};

/* ── Row background by moneda ───────────────────────────── */
const rowBg=(cur,alpha=1)=>({MXN:C.rowMXN,USD:C.rowUSD,EUR:C.rowEUR}[cur]||C.rowMXN);
const monedaBadge=(cur)=>{
  const bg={MXN:C.badgeMXN,USD:C.badgeUSD,EUR:C.badgeEUR}[cur]||C.badgeMXN;
  const cl={MXN:C.textMXN,USD:C.textUSD,EUR:C.textEUR}[cur]||C.textMXN;
  const lb={MXN:"MN",USD:"USD",EUR:"EUR"}[cur]||cur;
  return <span style={{background:bg,color:cl,fontWeight:700,fontSize:11,
    borderRadius:5,padding:"2px 7px",whiteSpace:"nowrap"}}>{lb}</span>;
};

/* ── Tab label estilo Excel ─────────────────────────────── */
const tabLabel = (monday) => {
  const friday = addDays(monday,4);
  const d0=+monday.getDate(), m0=monday.getMonth();
  const d4=+friday.getDate(), m4=friday.getMonth();
  if (m0===m4) return `${d0} AL ${d4} ${MESES_SHORT[m0]}`;
  return `${d0} ${MESES_SHORT[m0]} AL ${d4} ${MESES_SHORT[m4]}`;
};

/* ── DB helpers ─────────────────────────────────────────── */
async function fetchEfeItems(empresaId,from,to){
  const{data,error}=await supabase.from("efe_items").select("*")
    .eq("empresa_id",empresaId).gte("fecha",from).lte("fecha",to).order("fecha");
  if(error){console.error(error);return[];}return data||[];
}
async function saveEfeItem(item,empresaId){
  const row={empresa_id:empresaId,tipo:item.tipo,categoria:item.categoria||"",
    concepto:item.concepto||"",proveedor_cliente:item.proveedor_cliente||"",
    hotel:item.hotel||"",destino:item.destino||"",monto:+item.monto||0,
    moneda:item.moneda||"MXN",fecha:item.fecha,notas:item.notas||""};
  if(item.id){
    const{data,error}=await supabase.from("efe_items").update(row).eq("id",item.id).select().single();
    if(error){console.error(error);return null;}return data;
  }
  const{data,error}=await supabase.from("efe_items").insert(row).select().single();
  if(error){console.error(error);return null;}return data;
}
async function deleteEfeItem(id){await supabase.from("efe_items").delete().eq("id",id);}
async function fetchEfeSaldo(empresaId,semana){
  const{data}=await supabase.from("efe_saldos").select("*")
    .eq("empresa_id",empresaId).eq("semana",semana).single();
  return data||null;
}
async function upsertEfeSaldo(empresaId,semana,saldo){
  await supabase.from("efe_saldos").upsert(
    {empresa_id:empresaId,semana,saldo_mxn:+saldo.MXN||0,saldo_usd:+saldo.USD||0,saldo_eur:+saldo.EUR||0},
    {onConflict:"empresa_id,semana"});
}

/* ═══════════════════════════════════════════════════════════
   COMPONENTE PRINCIPAL
   ═══════════════════════════════════════════════════════════ */
export default function EfeView({
  invoices,ingresos,cobros,empresaId,esConsulta,
  onProjectInvoice,onUnprojectInvoice,onProjectIngreso,onUnprojectIngreso,
}){
  const[weekStart,setWeekStart]=useState(()=>getMonday(new Date()));
  const[efeItems,setEfeItems]=useState([]);
  const[saldoIni,setSaldoIni]=useState({MXN:0,USD:0,EUR:0});
  const[loading,setLoading]=useState(true);
  const[panelOpen,setPanelOpen]=useState(false);
  const[modalItem,setModalItem]=useState(null);
  const[saldoModal,setSaldoModal]=useState(false);
  const[delConfirm,setDelConfirm]=useState(null);

  /* ── 7 pestañas: 3 anteriores + actual + 3 siguientes ── */
  const weekTabs=useMemo(()=>Array.from({length:7},(_,i)=>addDays(weekStart,(i-3)*7)),[weekStart]);

  const weekDays=useMemo(()=>Array.from({length:5},(_,i)=>{
    const d=addDays(weekStart,i);
    const dm=d.getDate(), mo=MESES_SHORT[d.getMonth()];
    return{date:toISO(d),label:`${dm} ${mo}`,dayLabel:`${DIAS_SHORT[i]}\n${dm}/${d.getMonth()+1}`};
  }),[weekStart]);
  const weekFrom=weekDays[0].date;
  const weekTo=weekDays[4].date;

  /* ── Load ── */
  useEffect(()=>{
    let c=false;
    async function load(){
      setLoading(true);
      const[items,saldo]=await Promise.all([
        fetchEfeItems(empresaId,weekFrom,weekTo),
        fetchEfeSaldo(empresaId,weekFrom),
      ]);
      if(c)return;
      setEfeItems(items);
      setSaldoIni(saldo?{MXN:+saldo.saldo_mxn||0,USD:+saldo.saldo_usd||0,EUR:+saldo.saldo_eur||0}:{MXN:0,USD:0,EUR:0});
      setLoading(false);
    }
    load();
    return()=>{c=true;};
  },[empresaId,weekFrom,weekTo]);

  /* ── Build rows ── */
  const{ingRows,egrRows}=useMemo(()=>{
    const ingRows=[], egrRows=[];

    /* CxC autorizados */
    ingresos.filter(i=>i.enEfe).forEach(ing=>{
      const fecha=ing.fechaEfe||ing.fechaFicticia||ing.fechaVencimiento||ing.fecha;
      if(!fecha||fecha<weekFrom||fecha>weekTo)return;
      const cobrado=cobros.filter(c=>c.ingresoId===ing.id).reduce((s,c)=>s+c.monto,0);
      const pend=Math.max(0,ing.monto-cobrado);
      if(pend<=0)return;
      ingRows.push({
        key:`cxc-${ing.id}`,id:ing.id,source:"cxc",
        categoria:ing.categoria||"Sin categoría",
        segmento:ing.segmento||"",
        nombre:ing.cliente||"",
        concepto:ing.concepto||"",
        monto:pend,moneda:ing.moneda||"MXN",fecha,
      });
    });

    /* Items libres ingreso */
    efeItems.filter(i=>i.tipo==="ingreso").forEach(i=>ingRows.push({
      key:`libre-ing-${i.id}`,id:i.id,source:"libre",
      categoria:i.categoria||"Otro",segmento:"",
      nombre:i.proveedor_cliente||"",concepto:i.concepto||"",
      monto:+i.monto||0,moneda:i.moneda||"MXN",fecha:i.fecha,
    }));

    /* CxP autorizados */
    const allInv=[
      ...(invoices.MXN||[]).map(i=>({...i,moneda:"MXN"})),
      ...(invoices.USD||[]).map(i=>({...i,moneda:"USD"})),
      ...(invoices.EUR||[]).map(i=>({...i,moneda:"EUR"})),
    ];
    allInv.filter(inv=>inv.enEfe&&inv.estatus!=="Pagado").forEach(inv=>{
      const fecha=inv.fechaEfe||inv.fechaProgramacion;
      if(!fecha||fecha<weekFrom||fecha>weekTo)return;
      const saldo=Math.max(0,(inv.total||0)-(inv.montoPagado||0));
      if(saldo<=0)return;
      egrRows.push({
        key:`cxp-${inv.id}`,id:inv.id,source:"cxp",
        categoria:inv.clasificacion||"Sin clasificar",
        segmento:inv.clasificacion||"",
        nombre:inv.proveedor||"",concepto:inv.concepto||inv.folio||"",
        monto:saldo,moneda:inv.moneda||"MXN",fecha,
      });
    });

    /* Items libres egreso */
    efeItems.filter(i=>i.tipo==="egreso").forEach(i=>egrRows.push({
      key:`libre-egr-${i.id}`,id:i.id,source:"libre",
      categoria:i.categoria||"Otro",segmento:"",
      nombre:i.proveedor_cliente||"",concepto:i.concepto||"",
      monto:+i.monto||0,moneda:i.moneda||"MXN",fecha:i.fecha,
    }));

    return{ingRows,egrRows};
  },[invoices,ingresos,cobros,efeItems,weekFrom,weekTo]);

  /* ── Totales por día y moneda ── */
  const dayTotals=useMemo(()=>{
    const dt={};
    weekDays.forEach(({date})=>{dt[date]={ing:{MXN:0,USD:0,EUR:0},egr:{MXN:0,USD:0,EUR:0}};});
    ingRows.forEach(r=>{if(dt[r.fecha])dt[r.fecha].ing[r.moneda]=(dt[r.fecha].ing[r.moneda]||0)+r.monto;});
    egrRows.forEach(r=>{if(dt[r.fecha])dt[r.fecha].egr[r.moneda]=(dt[r.fecha].egr[r.moneda]||0)+r.monto;});
    return dt;
  },[ingRows,egrRows,weekDays]);

  /* ── Running saldo ── */
  const runningSaldo=useMemo(()=>{
    const rs={};let s={...saldoIni};
    weekDays.forEach(({date})=>{
      const dt=dayTotals[date];
      s={
        MXN:s.MXN+(dt?.ing.MXN||0)-(dt?.egr.MXN||0),
        USD:s.USD+(dt?.ing.USD||0)-(dt?.egr.USD||0),
        EUR:s.EUR+(dt?.ing.EUR||0)-(dt?.egr.EUR||0),
      };
      rs[date]={...s};
    });
    return rs;
  },[dayTotals,saldoIni,weekDays]);

  const weekTotalsIng=useMemo(()=>{
    const t={MXN:0,USD:0,EUR:0};
    ingRows.forEach(r=>t[r.moneda]=(t[r.moneda]||0)+r.monto);
    return t;
  },[ingRows]);
  const weekTotalsEgr=useMemo(()=>{
    const t={MXN:0,USD:0,EUR:0};
    egrRows.forEach(r=>t[r.moneda]=(t[r.moneda]||0)+r.monto);
    return t;
  },[egrRows]);

  /* ── Badge pendientes ── */
  const pendientesCount=useMemo(()=>{
    const allInv=[...(invoices.MXN||[]),...(invoices.USD||[]),...(invoices.EUR||[])];
    return allInv.filter(i=>!i.enEfe&&i.estatus!=="Pagado"&&i.fechaProgramacion).length
         + ingresos.filter(i=>!i.enEfe).length;
  },[invoices,ingresos]);

  /* ── CRUD ── */
  const handleSaveItem=async(draft)=>{
    const saved=await saveEfeItem(draft,empresaId);
    if(!saved)return;
    setEfeItems(prev=>draft.id?prev.map(e=>e.id===draft.id?saved:e):[...prev,saved]);
    setModalItem(null);
  };
  const handleDeleteItem=async(id)=>{
    await deleteEfeItem(id);
    setEfeItems(prev=>prev.filter(e=>e.id!==id));
    setDelConfirm(null);
  };
  const handleSaveSaldo=async(s)=>{
    setSaldoIni(s);
    await upsertEfeSaldo(empresaId,weekFrom,s);
    setSaldoModal(false);
  };

  /* ── Estilos de celda ── */
  const thSt=(extra={})=>({padding:"8px 8px",fontWeight:700,fontSize:11,
    color:"#fff",textAlign:"right",...extra});
  const tdNum=(n,color,bg)=>({
    textAlign:"right",padding:"5px 8px",fontSize:12,fontWeight:n?600:400,
    color:n?color:C.muted,background:bg||""
  });

  /* ── Render fila de datos ── */
  const renderDataRow=(row,tipo,idx)=>{
    const isIng=tipo==="ingreso";
    const bg=rowBg(row.moneda);
    const amtColor=isIng?C.usd:C.danger;
    const weekTotal=row.monto;
    return(
      <tr key={row.key}
        style={{background:bg,borderBottom:`1px solid ${C.border}`}}
        onMouseEnter={e=>e.currentTarget.style.filter="brightness(0.96)"}
        onMouseLeave={e=>e.currentTarget.style.filter=""}>
        {/* Categoría */}
        <td style={{padding:"5px 8px",fontSize:11,color:C.muted,whiteSpace:"nowrap",
          borderRight:`1px solid ${C.border}`}}>
          {row.categoria}
        </td>
        {/* Segmento */}
        <td style={{padding:"5px 8px",fontSize:11,color:C.muted,whiteSpace:"nowrap",
          borderRight:`1px solid ${C.border}`}}>
          {row.segmento}
        </td>
        {/* Nombre */}
        <td style={{padding:"5px 10px",fontSize:12,color:C.text,fontWeight:500,
          borderRight:`1px solid ${C.border}`}}>
          <div style={{display:"flex",alignItems:"center",gap:6}}>
            <span>{row.nombre||row.concepto||"—"}</span>
            {row.source==="cxc"&&<span style={{fontSize:9,background:"#CCFBF1",color:C.teal,
              borderRadius:3,padding:"1px 4px",fontWeight:700}}>CxC</span>}
            {row.source==="cxp"&&<span style={{fontSize:9,background:"#FEF9C3",color:"#854D0E",
              borderRadius:3,padding:"1px 4px",fontWeight:700}}>CxP</span>}
            {row.source==="libre"&&!esConsulta&&(
              <span style={{display:"flex",gap:2}}>
                <button onClick={()=>setModalItem({...row,tipo})}
                  style={{border:"none",background:"none",cursor:"pointer",fontSize:12,
                    color:C.sky,padding:"1px 3px"}}>✏️</button>
                <button onClick={()=>setDelConfirm(row.id)}
                  style={{border:"none",background:"none",cursor:"pointer",fontSize:12,
                    color:C.danger,padding:"1px 3px"}}>🗑</button>
              </span>
            )}
            {(row.source==="cxp"||row.source==="cxc")&&!esConsulta&&(
              <button
                onClick={()=>row.source==="cxp"?onUnprojectInvoice?.(row.id):onUnprojectIngreso?.(row.id)}
                style={{border:"none",background:"none",cursor:"pointer",fontSize:11,
                  color:C.muted,padding:"1px 3px"}}
                title="Quitar del EFE">✕</button>
            )}
          </div>
          {row.concepto&&row.nombre&&
            <div style={{fontSize:10,color:C.muted}}>{row.concepto}</div>}
        </td>
        {/* Días */}
        {weekDays.map(({date})=>(
          <td key={date} style={{
            textAlign:"right",padding:"5px 8px",fontSize:12,
            fontWeight:row.fecha===date?700:400,
            color:row.fecha===date?amtColor:C.muted,
            background:row.fecha===date?(isIng?"#DCFCE7":"#FEE2E2"):"",
            borderRight:`1px solid ${C.border}`,
          }}>
            {row.fecha===date?`${sym(row.moneda)}${fmt(row.monto)}`:""}
          </td>
        ))}
        {/* Total */}
        <td style={{textAlign:"right",padding:"5px 8px",fontSize:12,fontWeight:600,
          color:amtColor,borderRight:`1px solid ${C.border}`}}>
          {sym(row.moneda)}{fmt(weekTotal)}
        </td>
        {/* Moneda */}
        <td style={{padding:"4px 6px",textAlign:"center"}}>
          {monedaBadge(row.moneda)}
        </td>
      </tr>
    );
  };

  /* ── Fila separadora de sección ── */
  const SectionRow=({label,bg,color})=>(
    <tr>
      <td colSpan={9} style={{background:bg,color,fontWeight:800,
        padding:"6px 12px",fontSize:12,letterSpacing:.8}}>
        {label}
      </td>
    </tr>
  );

  /* ── Fila de subtotal ── */
  const SubtotalRow=({label,totals,bg,color})=>(
    <>
      {CURRENCIES.filter(cur=>totals[cur]>0||cur==="MXN").map(cur=>{
        if(totals[cur]===0&&cur!=="MXN")return null;
        return(
          <tr key={cur} style={{background:bg,borderTop:cur==="MXN"?`2px solid ${color}`:""}}>
            <td colSpan={3} style={{fontWeight:800,color,padding:"6px 12px",fontSize:12}}>
              {cur==="MXN"?label:`${label} ${cur}`}
            </td>
            {weekDays.map(({date})=>{
              const s=(ingRows.concat(egrRows)).filter(r=>r.fecha===date&&r.moneda===cur&&
                (label.includes("INGRESO")?ingRows.includes(r):egrRows.includes(r)))
                .reduce((a,r)=>a+r.monto,0);
              return<td key={date} style={{textAlign:"right",fontWeight:700,
                color:s>0?color:C.muted,padding:"6px 8px",fontSize:12,
                borderRight:`1px solid ${C.border}`}}>
                {s>0?`${sym(cur)}${fmt(s)}`:""}
              </td>;
            })}
            <td style={{textAlign:"right",fontWeight:800,color,padding:"6px 8px",fontSize:12,
              borderRight:`1px solid ${C.border}`}}>
              {totals[cur]>0?`${sym(cur)}${fmt(totals[cur])}`:"—"}
            </td>
            <td style={{padding:"4px 6px",textAlign:"center"}}>{monedaBadge(cur)}</td>
          </tr>
        );
      })}
    </>
  );

  /* ═══════════════════════════════════════════════════════
     RENDER PRINCIPAL
     ═══════════════════════════════════════════════════════ */
  return(
    <div style={{fontFamily:"inherit"}}>

      {/* ── Título + botón Panel ── */}
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",
        marginBottom:16,flexWrap:"wrap",gap:10}}>
        <div>
          <h1 style={{fontSize:22,fontWeight:800,color:C.navy,margin:0}}>
            Flujo de Efectivo Semanal
          </h1>
          <p style={{color:C.muted,margin:"3px 0 0",fontSize:13}}>
            Solo items autorizados · CxP + CxC + libres
          </p>
        </div>
        <div style={{display:"flex",gap:8,alignItems:"center"}}>
          {!esConsulta&&(
            <button onClick={()=>setSaldoModal(true)}
              style={{padding:"8px 14px",borderRadius:9,border:`1px solid ${C.border}`,
                background:"#F8FAFC",cursor:"pointer",fontSize:13,color:C.navy,
                fontWeight:600,fontFamily:"inherit"}}>
              ✏️ Saldos iniciales
            </button>
          )}
          {!esConsulta&&(
            <button onClick={()=>setPanelOpen(true)}
              style={{display:"flex",alignItems:"center",gap:7,padding:"9px 16px",
                borderRadius:10,border:"none",background:C.navy,color:"#fff",fontWeight:700,
                fontSize:14,cursor:"pointer",fontFamily:"inherit",position:"relative"}}>
              📋 Autorizar al EFE
              {pendientesCount>0&&(
                <span style={{background:C.danger,color:"#fff",fontSize:10,fontWeight:800,
                  borderRadius:"50%",width:18,height:18,display:"flex",alignItems:"center",
                  justifyContent:"center",position:"absolute",top:-7,right:-7,lineHeight:1}}>
                  {pendientesCount>99?"99+":pendientesCount}
                </span>
              )}
            </button>
          )}
        </div>
      </div>

      {/* ── Pestañas estilo Excel ── */}
      <div style={{display:"flex",gap:2,marginBottom:0,overflowX:"auto",
        paddingBottom:0,borderBottom:`2px solid ${C.border}`}}>
        {weekTabs.map((monday,i)=>{
          const iso=toISO(monday);
          const isActive=iso===toISO(weekStart);
          return(
            <button key={iso} onClick={()=>setWeekStart(monday)}
              style={{padding:"7px 14px",borderRadius:"8px 8px 0 0",
                border:`1px solid ${isActive?C.blue:C.border}`,
                borderBottom:isActive?"2px solid #fff":"1px solid "+C.border,
                background:isActive?"#fff":"#F8FAFC",
                color:isActive?C.blue:C.muted,fontWeight:isActive?800:500,
                fontSize:12,cursor:"pointer",fontFamily:"inherit",whiteSpace:"nowrap",
                marginBottom:-2,transition:"all .1s",
                boxShadow:isActive?"0 -2px 6px rgba(0,0,0,.06)":"none"}}>
              {tabLabel(monday)}
            </button>
          );
        })}
        {/* Botón + para ir a semana siguiente */}
        <button onClick={()=>setWeekStart(prev=>addDays(prev,7*4))}
          style={{padding:"7px 10px",borderRadius:"8px 8px 0 0",border:`1px solid ${C.border}`,
            borderBottom:"1px solid "+C.border,background:"#F8FAFC",color:C.muted,
            fontSize:14,cursor:"pointer",marginBottom:-2}}>›</button>
        <button onClick={()=>setWeekStart(prev=>addDays(prev,-7*4))}
          style={{padding:"7px 10px",borderRadius:"8px 8px 0 0",border:`1px solid ${C.border}`,
            borderBottom:"1px solid "+C.border,background:"#F8FAFC",color:C.muted,
            fontSize:14,cursor:"pointer",marginBottom:-2,order:-1}}>‹</button>
      </div>

      {/* ── Tabla principal ── */}
      <div style={{background:"#fff",border:`1px solid ${C.border}`,borderTop:"none",
        borderRadius:"0 0 12px 12px",overflowX:"auto",
        boxShadow:"0 4px 16px rgba(0,0,0,.07)"}}>

        {loading?(
          <div style={{textAlign:"center",padding:60,color:C.muted,fontSize:15}}>
            Cargando flujo…
          </div>
        ):(
          <table style={{width:"100%",borderCollapse:"collapse",minWidth:900}}>
            <colgroup>
              <col style={{width:100}}/> {/* Categoría */}
              <col style={{width:110}}/> {/* Segmento */}
              <col style={{width:200}}/> {/* Nombre */}
              {weekDays.map((_,i)=><col key={i} style={{width:95}}/>)}
              <col style={{width:105}}/> {/* Total */}
              <col style={{width:64}}/> {/* Moneda */}
            </colgroup>

            {/* ── Header ── */}
            <thead>
              <tr style={{background:C.navy}}>
                <th style={thSt({textAlign:"left"})}>Categoría</th>
                <th style={thSt({textAlign:"left"})}>Segmento</th>
                <th style={thSt({textAlign:"left"})}>Ingresos / Egresos</th>
                {weekDays.map(({date,label})=>(
                  <th key={date} style={thSt()}>{label}</th>
                ))}
                <th style={thSt()}>Total</th>
                <th style={thSt({textAlign:"center"})}>Moneda</th>
              </tr>
            </thead>

            <tbody>
              {/* ── SALDO INICIAL (3 filas) ── */}
              <tr style={{background:"#1A3040"}}>
                <td colSpan={9} style={{padding:"4px 12px",fontSize:11,
                  color:"#94A3B8",fontWeight:600,letterSpacing:.5}}>
                  SALDO INICIAL
                </td>
              </tr>
              {CURRENCIES.map(cur=>{
                const s=saldoIni[cur]||0;
                const clr={MXN:C.textMXN,USD:C.textUSD,EUR:C.textEUR}[cur];
                return(
                  <tr key={cur} style={{background:rowBg(cur),
                    borderBottom:`1px solid ${C.border}`}}>
                    <td colSpan={3} style={{padding:"6px 12px",fontWeight:700,
                      color:clr,fontSize:13,borderRight:`1px solid ${C.border}`}}>
                      Saldo Inicial {cur==="MXN"?"MN":cur}
                    </td>
                    {weekDays.map(({date})=>(
                      <td key={date} style={{textAlign:"right",padding:"6px 8px",
                        fontWeight:600,color:s>=0?clr:C.danger,fontSize:13,
                        borderRight:`1px solid ${C.border}`}}>
                        {s!==0?`${s<0?"-":""}${sym(cur)}${fmt(Math.abs(s))}`:"—"}
                      </td>
                    ))}
                    <td style={{textAlign:"right",padding:"6px 8px",fontWeight:700,
                      color:s>=0?clr:C.danger,fontSize:13,
                      borderRight:`1px solid ${C.border}`}}>
                      {s!==0?`${s<0?"-":""}${sym(cur)}${fmt(Math.abs(s))}`:"—"}
                    </td>
                    <td style={{padding:"4px 6px",textAlign:"center"}}>
                      {monedaBadge(cur)}
                    </td>
                  </tr>
                );
              })}

              {/* ── INGRESOS ── */}
              <SectionRow label="▲  INGRESOS" bg="#1B5E20" color="#fff"/>
              {ingRows.length===0&&(
                <tr>
                  <td colSpan={9} style={{padding:"14px 12px",color:C.muted,fontSize:13,
                    fontStyle:"italic",textAlign:"center"}}>
                    No hay ingresos autorizados para esta semana
                    {!esConsulta&&<span> · <button onClick={()=>setPanelOpen(true)}
                      style={{border:"none",background:"none",color:C.blue,cursor:"pointer",
                        fontSize:13,textDecoration:"underline",fontFamily:"inherit"}}>
                      Autorizar →
                    </button></span>}
                  </td>
                </tr>
              )}
              {ingRows.map((row,i)=>renderDataRow(row,"ingreso",i))}
              {ingRows.length>0&&(
                <tr style={{background:"#E8F5E9",borderTop:`2px solid #2E7D32`}}>
                  <td colSpan={3} style={{fontWeight:800,color:"#2E7D32",padding:"7px 12px",fontSize:12}}>
                    TOTAL INGRESOS MN
                  </td>
                  {weekDays.map(({date})=>{
                    const s=ingRows.filter(r=>r.fecha===date&&r.moneda==="MXN").reduce((a,r)=>a+r.monto,0);
                    return<td key={date} style={{textAlign:"right",fontWeight:700,
                      color:"#2E7D32",padding:"7px 8px",fontSize:12,
                      borderRight:`1px solid ${C.border}`}}>
                      {s>0?`$${fmt(s)}`:""}
                    </td>;
                  })}
                  <td style={{textAlign:"right",fontWeight:800,color:"#2E7D32",padding:"7px 8px",fontSize:12,
                    borderRight:`1px solid ${C.border}`}}>
                    ${fmt(weekTotalsIng.MXN)}
                  </td>
                  <td style={{padding:"4px 6px",textAlign:"center"}}>{monedaBadge("MXN")}</td>
                </tr>
              )}
              {["USD","EUR"].filter(cur=>weekTotalsIng[cur]>0).map(cur=>(
                <tr key={cur} style={{background:rowBg(cur)}}>
                  <td colSpan={3} style={{fontWeight:700,color:{USD:C.textUSD,EUR:C.textEUR}[cur],
                    padding:"5px 12px",fontSize:11}}>TOTAL INGRESOS {cur}</td>
                  {weekDays.map(({date})=>{
                    const s=ingRows.filter(r=>r.fecha===date&&r.moneda===cur).reduce((a,r)=>a+r.monto,0);
                    return<td key={date} style={{textAlign:"right",fontSize:11,padding:"5px 8px",
                      borderRight:`1px solid ${C.border}`,
                      color:{USD:C.textUSD,EUR:C.textEUR}[cur]}}>
                      {s>0?`${sym(cur)}${fmt(s)}`:""}
                    </td>;
                  })}
                  <td style={{textAlign:"right",fontSize:11,fontWeight:700,padding:"5px 8px",
                    borderRight:`1px solid ${C.border}`,color:{USD:C.textUSD,EUR:C.textEUR}[cur]}}>
                    {sym(cur)}{fmt(weekTotalsIng[cur])}
                  </td>
                  <td style={{padding:"4px 6px",textAlign:"center"}}>{monedaBadge(cur)}</td>
                </tr>
              ))}
              {!esConsulta&&(
                <tr>
                  <td colSpan={9} style={{padding:"5px 12px"}}>
                    <button onClick={()=>setModalItem({tipo:"ingreso",fecha:weekDays[0].date,
                      moneda:"MXN",monto:0,categoria:"",concepto:"",proveedor_cliente:""})}
                      style={{background:"none",border:"1px dashed #2E7D32",color:"#2E7D32",
                        borderRadius:7,padding:"3px 12px",fontSize:12,cursor:"pointer",fontFamily:"inherit"}}>
                      + Agregar ingreso libre
                    </button>
                  </td>
                </tr>
              )}

              {/* ── Espacio ── */}
              <tr><td colSpan={9} style={{height:6,background:"#F1F5F9"}}/></tr>

              {/* ── EGRESOS ── */}
              <SectionRow label="▼  EGRESOS" bg="#BF360C" color="#fff"/>
              {egrRows.length===0&&(
                <tr>
                  <td colSpan={9} style={{padding:"14px 12px",color:C.muted,fontSize:13,
                    fontStyle:"italic",textAlign:"center"}}>
                    No hay egresos autorizados para esta semana
                    {!esConsulta&&<span> · <button onClick={()=>setPanelOpen(true)}
                      style={{border:"none",background:"none",color:C.blue,cursor:"pointer",
                        fontSize:13,textDecoration:"underline",fontFamily:"inherit"}}>
                      Autorizar →
                    </button></span>}
                  </td>
                </tr>
              )}
              {egrRows.map((row,i)=>renderDataRow(row,"egreso",i))}
              {egrRows.length>0&&(
                <tr style={{background:"#FBE9E7",borderTop:`2px solid ${C.danger}`}}>
                  <td colSpan={3} style={{fontWeight:800,color:C.danger,padding:"7px 12px",fontSize:12}}>
                    TOTAL EGRESOS MN
                  </td>
                  {weekDays.map(({date})=>{
                    const s=egrRows.filter(r=>r.fecha===date&&r.moneda==="MXN").reduce((a,r)=>a+r.monto,0);
                    return<td key={date} style={{textAlign:"right",fontWeight:700,
                      color:C.danger,padding:"7px 8px",fontSize:12,
                      borderRight:`1px solid ${C.border}`}}>
                      {s>0?`$${fmt(s)}`:""}
                    </td>;
                  })}
                  <td style={{textAlign:"right",fontWeight:800,color:C.danger,padding:"7px 8px",
                    fontSize:12,borderRight:`1px solid ${C.border}`}}>
                    ${fmt(weekTotalsEgr.MXN)}
                  </td>
                  <td style={{padding:"4px 6px",textAlign:"center"}}>{monedaBadge("MXN")}</td>
                </tr>
              )}
              {["USD","EUR"].filter(cur=>weekTotalsEgr[cur]>0).map(cur=>(
                <tr key={cur} style={{background:rowBg(cur)}}>
                  <td colSpan={3} style={{fontWeight:700,color:C.danger,
                    padding:"5px 12px",fontSize:11}}>TOTAL EGRESOS {cur}</td>
                  {weekDays.map(({date})=>{
                    const s=egrRows.filter(r=>r.fecha===date&&r.moneda===cur).reduce((a,r)=>a+r.monto,0);
                    return<td key={date} style={{textAlign:"right",fontSize:11,padding:"5px 8px",
                      borderRight:`1px solid ${C.border}`,color:C.danger}}>
                      {s>0?`${sym(cur)}${fmt(s)}`:""}
                    </td>;
                  })}
                  <td style={{textAlign:"right",fontSize:11,fontWeight:700,padding:"5px 8px",
                    borderRight:`1px solid ${C.border}`,color:C.danger}}>
                    {sym(cur)}{fmt(weekTotalsEgr[cur])}
                  </td>
                  <td style={{padding:"4px 6px",textAlign:"center"}}>{monedaBadge(cur)}</td>
                </tr>
              ))}
              {!esConsulta&&(
                <tr>
                  <td colSpan={9} style={{padding:"5px 12px"}}>
                    <button onClick={()=>setModalItem({tipo:"egreso",fecha:weekDays[0].date,
                      moneda:"MXN",monto:0,categoria:"",concepto:"",proveedor_cliente:""})}
                      style={{background:"none",border:`1px dashed ${C.danger}`,color:C.danger,
                        borderRadius:7,padding:"3px 12px",fontSize:12,cursor:"pointer",fontFamily:"inherit"}}>
                      + Agregar egreso libre
                    </button>
                  </td>
                </tr>
              )}

              {/* ── Espacio ── */}
              <tr><td colSpan={9} style={{height:6,background:"#F1F5F9"}}/></tr>

              {/* ── FLUJO NETO por divisa ── */}
              <tr style={{background:"#263238"}}>
                <td colSpan={9} style={{padding:"5px 12px",fontSize:11,
                  color:"#90A4AE",fontWeight:700,letterSpacing:.5}}>
                  FLUJO NETO
                </td>
              </tr>
              {CURRENCIES.map(cur=>{
                const ingT=weekTotalsIng[cur]||0, egrT=weekTotalsEgr[cur]||0;
                if(!ingT&&!egrT) return null;
                const neto=ingT-egrT;
                const neg=neto<0;
                const clr=neg?C.danger:C.ok;
                const bg={MXN:"#EFF6FF",USD:"#F0FDF4",EUR:"#F5F3FF"}[cur];
                return(
                  <tr key={cur} style={{background:bg,borderBottom:`1px solid ${C.border}`}}>
                    <td colSpan={3} style={{fontWeight:700,color:clr,padding:"7px 12px",fontSize:13}}>
                      Flujo Neto {cur==="MXN"?"MN":cur}
                    </td>
                    {weekDays.map(({date})=>{
                      const dt=dayTotals[date];
                      const fl=(dt?.ing[cur]||0)-(dt?.egr[cur]||0);
                      const n=fl<0;
                      return<td key={date} style={{textAlign:"right",fontWeight:700,
                        color:fl===0?C.muted:n?C.danger:C.ok,padding:"7px 8px",fontSize:13,
                        borderRight:`1px solid ${C.border}`}}>
                        {fl!==0?`${n?"-":""}${sym(cur)}${fmt(Math.abs(fl))}`:"—"}
                      </td>;
                    })}
                    <td style={{textAlign:"right",fontWeight:800,padding:"7px 8px",
                      fontSize:13,color:clr,borderRight:`1px solid ${C.border}`}}>
                      {`${neg?"-":""}${sym(cur)}${fmt(Math.abs(neto))}`}
                    </td>
                    <td style={{padding:"4px 6px",textAlign:"center"}}>{monedaBadge(cur)}</td>
                  </tr>
                );
              })}

              {/* ── SALDO FINAL ── */}
              {CURRENCIES.map(cur=>{
                const sf=runningSaldo[weekDays[4]?.date]?.[cur]||0;
                const ingT=weekTotalsIng[cur]||0, egrT=weekTotalsEgr[cur]||0;
                if(!sf&&!ingT&&!egrT) return null;
                const neg=sf<0;
                const clr=neg?"#FCA5A5":"#A5F3FC";
                return(
                  <tr key={cur} style={{background:C.navy}}>
                    <td colSpan={3} style={{fontWeight:800,color:"#fff",padding:"8px 12px",fontSize:13}}>
                      Saldo Final {cur==="MXN"?"MN":cur}
                    </td>
                    {weekDays.map(({date})=>{
                      const s=runningSaldo[date]?.[cur]||0;
                      return<td key={date} style={{textAlign:"right",fontWeight:700,
                        color:s>=0?"#A5F3FC":"#FCA5A5",padding:"8px 8px",fontSize:13,
                        borderRight:"1px solid rgba(255,255,255,.1)"}}>
                        {`${s<0?"-":""}${sym(cur)}${fmt(Math.abs(s))}`}
                      </td>;
                    })}
                    <td style={{textAlign:"right",fontWeight:800,padding:"8px 8px",
                      fontSize:13,color:clr,borderRight:"1px solid rgba(255,255,255,.1)"}}>
                      {`${neg?"-":""}${sym(cur)}${fmt(Math.abs(sf))}`}
                    </td>
                    <td style={{padding:"4px 6px",textAlign:"center"}}>{monedaBadge(cur)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      {/* ══════════ MODALS ══════════ */}
      {panelOpen&&(
        <PanelSelectorModal
          invoices={invoices} ingresos={ingresos} cobros={cobros}
          onProjectInvoice={onProjectInvoice} onUnprojectInvoice={onUnprojectInvoice}
          onProjectIngreso={onProjectIngreso} onUnprojectIngreso={onUnprojectIngreso}
          onClose={()=>setPanelOpen(false)}
        />
      )}
      {modalItem&&(
        <ItemModal item={modalItem} weekDays={weekDays}
          onSave={handleSaveItem} onClose={()=>setModalItem(null)}/>
      )}
      {saldoModal&&(
        <SaldoIniModal saldo={saldoIni}
          onSave={handleSaveSaldo} onClose={()=>setSaldoModal(false)}/>
      )}
      {delConfirm&&(
        <div style={{position:"fixed",inset:0,background:"rgba(15,45,74,.45)",
          display:"flex",alignItems:"center",justifyContent:"center",zIndex:1000}}>
          <div style={{background:"#fff",borderRadius:14,padding:26,maxWidth:320,
            textAlign:"center",boxShadow:"0 20px 60px rgba(0,0,0,.25)"}}>
            <div style={{fontSize:30,marginBottom:10}}>🗑</div>
            <p style={{fontWeight:700,color:C.navy,margin:"0 0 6px"}}>¿Eliminar item?</p>
            <p style={{color:C.muted,fontSize:12,margin:"0 0 18px"}}>No se puede deshacer.</p>
            <div style={{display:"flex",gap:8}}>
              <button onClick={()=>setDelConfirm(null)} style={{flex:1,padding:"9px",
                borderRadius:8,border:`1px solid ${C.border}`,background:"#F8FAFC",
                cursor:"pointer",fontFamily:"inherit"}}>Cancelar</button>
              <button onClick={()=>handleDeleteItem(delConfirm)} style={{flex:1,padding:"9px",
                borderRadius:8,border:"none",background:C.danger,color:"#fff",
                fontWeight:700,cursor:"pointer",fontFamily:"inherit"}}>Eliminar</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════
   PANEL SELECTOR
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
  const filtInv=allInv.filter(i=>!q||[i.proveedor,i.clasificacion,i.concepto].some(s=>s?.toLowerCase().includes(q)));
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
  const TH=({ch,r,c,w})=><th style={{padding:"7px 8px",textAlign:r?"right":c?"center":"left",
    fontWeight:700,color:C.muted,fontSize:11,width:w}}>{ch}</th>;
  return(
    <div style={{position:"fixed",inset:0,background:"rgba(15,45,74,.5)",
      display:"flex",alignItems:"center",justifyContent:"center",zIndex:1100,padding:16}}
      onClick={onClose}>
      <div onClick={e=>e.stopPropagation()} style={{background:"#fff",borderRadius:18,
        width:"100%",maxWidth:820,maxHeight:"88vh",display:"flex",flexDirection:"column",
        boxShadow:"0 24px 80px rgba(0,0,0,.3)"}}>
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",
          padding:"18px 22px 10px",flexShrink:0}}>
          <div>
            <h2 style={{fontSize:19,fontWeight:800,color:C.navy,margin:0}}>📋 Autorizar al EFE</h2>
            <p style={{color:C.muted,fontSize:12,margin:"3px 0 0"}}>
              Selecciona items y asigna la fecha en que aparecerán en el flujo
            </p>
          </div>
          <button onClick={onClose} style={{background:"#F1F5F9",border:"none",borderRadius:8,
            width:34,height:34,cursor:"pointer",fontSize:17}}>×</button>
        </div>
        <div style={{padding:"0 22px 10px",flexShrink:0}}>
          <input value={search} onChange={e=>setSearch(e.target.value)}
            placeholder="🔍 Buscar..." style={{...inputSt,background:"#F8FAFC"}}/>
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
                    checked={tab==="cxp"
                      ?invSel.size===filtInv.filter(i=>!i.enEfe).length&&invSel.size>0
                      :ingSel.size===filtIng.filter(i=>!i.enEfe).length&&ingSel.size>0}
                    onChange={()=>{
                      if(tab==="cxp"){
                        const ids=filtInv.filter(i=>!i.enEfe).map(i=>i.id);
                        setInvSel(p=>p.size===ids.length?new Set():new Set(ids));
                      }else{
                        const ids=filtIng.filter(i=>!i.enEfe).map(i=>i.id);
                        setIngSel(p=>p.size===ids.length?new Set():new Set(ids));
                      }
                    }}
                    style={{cursor:"pointer",width:14,height:14,accentColor:C.blue}}/>
                </th>
                {tab==="cxp"?<>
                  <TH ch="Proveedor"/><TH ch="Clasificación"/>
                  <TH ch="Saldo" r/><TH ch="Fecha EFE" c w={130}/><TH ch="Estado" c w={72}/>
                </>:<>
                  <TH ch="Cliente"/><TH ch="Categoría"/>
                  <TH ch="Por cobrar" r/><TH ch="Fecha EFE" c w={130}/><TH ch="Estado" c w={72}/>
                </>}
              </tr>
            </thead>
            <tbody>
              {tab==="cxp"&&filtInv.map(inv=>{
                const saldo=Math.max(0,(inv.total||0)-(inv.montoPagado||0));
                const inEfe=inv.enEfe;
                return(
                  <tr key={inv.id} style={{borderBottom:`1px solid ${C.border}`,
                    background:inEfe?rowBg(inv.moneda||"MXN"):""}}
                    onMouseEnter={e=>{if(!inEfe)e.currentTarget.style.background="#F8FAFC"}}
                    onMouseLeave={e=>{e.currentTarget.style.background=inEfe?rowBg(inv.moneda||"MXN"):"";}}>
                    <td style={{padding:"6px 6px",textAlign:"center"}}>
                      {!inEfe&&<input type="checkbox" checked={invSel.has(inv.id)}
                        onChange={()=>toggleInv(inv.id)}
                        style={{cursor:"pointer",width:14,height:14,accentColor:C.blue}}/>}
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
                          style={{padding:"3px 5px",fontSize:11,border:`1px solid ${C.border}`,
                            borderRadius:5,fontFamily:"inherit"}}/>
                        :<span style={{fontSize:11,color:C.blue,fontWeight:600}}>✅ {inv.fechaEfe}</span>
                      }
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
                            color:invDates[inv.id]?C.blue:C.muted,
                            borderRadius:5,padding:"2px 7px",fontSize:11,
                            cursor:invDates[inv.id]?"pointer":"not-allowed",fontFamily:"inherit"}}>
                          🌊
                        </button>
                      }
                    </td>
                  </tr>
                );
              })}
              {tab==="cxc"&&filtIng.map(ing=>{
                const cobrado=cobros.filter(c=>c.ingresoId===ing.id).reduce((s,c)=>s+c.monto,0);
                const pc=Math.max(0,ing.monto-cobrado);
                const inEfe=ing.enEfe;
                return(
                  <tr key={ing.id} style={{borderBottom:`1px solid ${C.border}`,
                    background:inEfe?rowBg(ing.moneda||"MXN"):""}}
                    onMouseEnter={e=>{if(!inEfe)e.currentTarget.style.background="#F8FAFC"}}
                    onMouseLeave={e=>{e.currentTarget.style.background=inEfe?rowBg(ing.moneda||"MXN"):"";}}>
                    <td style={{padding:"6px 6px",textAlign:"center"}}>
                      {!inEfe&&<input type="checkbox" checked={ingSel.has(ing.id)}
                        onChange={()=>toggleIng(ing.id)}
                        style={{cursor:"pointer",width:14,height:14,accentColor:C.blue}}/>}
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
                          style={{padding:"3px 5px",fontSize:11,border:`1px solid ${C.border}`,
                            borderRadius:5,fontFamily:"inherit"}}/>
                        :<span style={{fontSize:11,color:C.ok,fontWeight:600}}>✅ {ing.fechaEfe}</span>
                      }
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
                            color:ingDates[ing.id]?C.ok:C.muted,
                            borderRadius:5,padding:"2px 7px",fontSize:11,
                            cursor:ingDates[ing.id]?"pointer":"not-allowed",fontFamily:"inherit"}}>
                          🌊
                        </button>
                      }
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <div style={{padding:"12px 22px",borderTop:`1px solid ${C.border}`,flexShrink:0,
          display:"flex",gap:8,alignItems:"center",background:"#F8FAFC",
          borderRadius:"0 0 18px 18px"}}>
          <span style={{flex:1,fontSize:12,color:C.muted}}>
            {tab==="cxp"?invSel.size:ingSel.size} seleccionado(s)
          </span>
          <button
            onClick={tab==="cxp"?proyInv:proyIng}
            disabled={tab==="cxp"?invSel.size===0:ingSel.size===0}
            style={{padding:"8px 20px",borderRadius:8,border:"none",fontFamily:"inherit",
              background:(tab==="cxp"?invSel.size:ingSel.size)>0?C.navy:"#B0BEC5",
              color:"#fff",fontWeight:700,
              cursor:(tab==="cxp"?invSel.size:ingSel.size)>0?"pointer":"not-allowed",fontSize:13}}>
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

/* ── Item Libre Modal ── */
function ItemModal({item,weekDays,onSave,onClose}){
  const[form,setForm]=useState({id:item.id||null,tipo:item.tipo||"ingreso",
    categoria:item.categoria||"",concepto:item.concepto||"",
    proveedor_cliente:item.proveedor_cliente||item.proveedor||"",
    hotel:item.hotel||"",destino:item.destino||"",
    monto:item.monto||0,moneda:item.moneda||"MXN",
    fecha:item.fecha||weekDays[0].date,notas:item.notas||""});
  const upd=e=>setForm(f=>({...f,[e.target.name]:e.target.value}));
  const isIng=form.tipo==="ingreso";
  const accentC=isIng?C.ok:C.danger;
  const cats=isIng?CATS_ING:CATS_EGR;
  const Lbl=({label,children})=>(
    <div style={{marginBottom:13}}>
      <label style={{display:"block",fontSize:11,fontWeight:700,color:C.muted,
        textTransform:"uppercase",letterSpacing:.4,marginBottom:4}}>{label}</label>
      {children}
    </div>
  );
  return(
    <div style={{position:"fixed",inset:0,background:"rgba(15,45,74,.45)",display:"flex",
      alignItems:"center",justifyContent:"center",zIndex:1200,padding:20}} onClick={onClose}>
      <div onClick={e=>e.stopPropagation()} style={{background:"#fff",borderRadius:18,
        padding:26,width:"100%",maxWidth:490,boxShadow:"0 20px 60px rgba(0,0,0,.25)",
        maxHeight:"90vh",overflowY:"auto"}}>
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:16}}>
          <h2 style={{fontSize:17,fontWeight:800,color:C.navy,margin:0}}>
            {form.id?"Editar":"Nuevo"} item libre
          </h2>
          <button onClick={onClose} style={{background:"#F1F5F9",border:"none",borderRadius:7,
            width:32,height:32,cursor:"pointer",fontSize:17}}>×</button>
        </div>
        <div style={{display:"flex",gap:7,marginBottom:14}}>
          {["ingreso","egreso"].map(t=>(
            <button key={t} onClick={()=>setForm(f=>({...f,tipo:t,categoria:""}))}
              style={{flex:1,padding:"7px",borderRadius:8,fontFamily:"inherit",fontWeight:700,
                cursor:"pointer",fontSize:12,
                border:`2px solid ${form.tipo===t?accentC:C.border}`,
                background:form.tipo===t?(t==="ingreso"?"#E8F5E9":"#FFEBEE"):"#fff",
                color:form.tipo===t?accentC:C.muted}}>
              {t==="ingreso"?"▲ Ingreso":"▼ Egreso"}
            </button>
          ))}
        </div>
        <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10}}>
          <Lbl label="Categoría">
            <select name="categoria" value={form.categoria} onChange={upd} style={selSt}>
              <option value="">—</option>{cats.map(c=><option key={c}>{c}</option>)}
            </select>
          </Lbl>
          <Lbl label="Moneda">
            <select name="moneda" value={form.moneda} onChange={upd} style={selSt}>
              {CURRENCIES.map(c=><option key={c}>{c}</option>)}
            </select>
          </Lbl>
          <Lbl label="Monto">
            <input type="number" name="monto" value={form.monto} onChange={upd}
              style={inputSt} min="0" step="0.01"/>
          </Lbl>
          <Lbl label="Fecha">
            <select name="fecha" value={form.fecha} onChange={upd} style={selSt}>
              {weekDays.map(({date,label})=><option key={date} value={date}>{label}</option>)}
            </select>
          </Lbl>
        </div>
        <Lbl label="Proveedor / Cliente">
          <input name="proveedor_cliente" value={form.proveedor_cliente} onChange={upd}
            style={inputSt} placeholder="Nombre..."/>
        </Lbl>
        <Lbl label="Concepto">
          <input name="concepto" value={form.concepto} onChange={upd}
            style={inputSt} placeholder="Descripción..."/>
        </Lbl>
        <div style={{display:"flex",gap:8,marginTop:6}}>
          <button onClick={onClose} style={{flex:1,padding:"9px",borderRadius:9,
            border:`1px solid ${C.border}`,background:"#F8FAFC",cursor:"pointer",fontFamily:"inherit"}}>
            Cancelar
          </button>
          <button onClick={()=>onSave(form)} style={{flex:2,padding:"9px",borderRadius:9,
            border:"none",background:accentC,color:"#fff",fontWeight:700,
            cursor:"pointer",fontFamily:"inherit"}}>
            {form.id?"Guardar":"Agregar"}
          </button>
        </div>
      </div>
    </div>
  );
}

/* ── Saldo Inicial Modal ── */
function SaldoIniModal({saldo,onSave,onClose}){
  const[form,setForm]=useState({...saldo});
  return(
    <div style={{position:"fixed",inset:0,background:"rgba(15,45,74,.45)",display:"flex",
      alignItems:"center",justifyContent:"center",zIndex:1200,padding:20}} onClick={onClose}>
      <div onClick={e=>e.stopPropagation()} style={{background:"#fff",borderRadius:18,
        padding:26,maxWidth:360,width:"100%",boxShadow:"0 20px 60px rgba(0,0,0,.25)"}}>
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:16}}>
          <h2 style={{fontSize:17,fontWeight:800,color:C.navy,margin:0}}>Saldo inicial</h2>
          <button onClick={onClose} style={{background:"#F1F5F9",border:"none",borderRadius:7,
            width:32,height:32,cursor:"pointer",fontSize:17}}>×</button>
        </div>
        {CURRENCIES.map(cur=>(
          <div key={cur} style={{marginBottom:12}}>
            <label style={{display:"block",fontSize:11,fontWeight:700,color:C.muted,
              textTransform:"uppercase",letterSpacing:.4,marginBottom:4}}>
              {cur==="MXN"?"MN (MXN)":cur} {cur==="MXN"?"🇲🇽":cur==="USD"?"🇺🇸":"🇪🇺"}
            </label>
            <input type="number" value={form[cur]}
              onChange={e=>setForm(f=>({...f,[cur]:+e.target.value||0}))}
              style={inputSt} step="0.01"/>
          </div>
        ))}
        <div style={{display:"flex",gap:8,marginTop:16}}>
          <button onClick={onClose} style={{flex:1,padding:"9px",borderRadius:9,
            border:`1px solid ${C.border}`,background:"#F8FAFC",cursor:"pointer",fontFamily:"inherit"}}>
            Cancelar
          </button>
          <button onClick={()=>onSave(form)} style={{flex:2,padding:"9px",borderRadius:9,
            border:"none",background:C.blue,color:"#fff",fontWeight:700,
            cursor:"pointer",fontFamily:"inherit"}}>
            Guardar
          </button>
        </div>
      </div>
    </div>
  );
}
