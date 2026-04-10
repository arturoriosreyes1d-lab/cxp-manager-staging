import React, { useState, useEffect, useMemo } from "react";
import { supabase } from "./supabase.js";

const C = {
  navy:"#0F2D4A", blue:"#1565C0", sky:"#2196F3", teal:"#00897B",
  cream:"#FAFBFC", surface:"#FFFFFF", border:"#E2E8F0", muted:"#64748B",
  text:"#1A2332", danger:"#E53935", warn:"#F59E0B", ok:"#43A047",
  mxn:"#1565C0", usd:"#2E7D32", eur:"#6A1B9A",
};
const fmt = n => isNaN(n)||n===""||n===null ? "—" :
  new Intl.NumberFormat("es-MX",{minimumFractionDigits:2,maximumFractionDigits:2}).format(+n);
const sym = cur => cur==="EUR" ? "€" : "$";
const getMonday = d => {
  const dt=new Date(d); dt.setHours(12,0,0,0);
  const day=dt.getDay(); dt.setDate(dt.getDate()-day+(day===0?-6:1)); return dt;
};
const addDays=(d,n)=>{const dt=new Date(d);dt.setDate(dt.getDate()+n);return dt;};
const toISO=d=>d.toISOString().split("T")[0];
const DIAS=["Lun","Mar","Mié","Jue","Vie"];
const MESES=["Ene","Feb","Mar","Abr","May","Jun","Jul","Ago","Sep","Oct","Nov","Dic"];
const CURRENCIES=["MXN","USD","EUR"];
const CATS_ING=["Circuitos","Tour Adicionales","Botelería","Reprotección","Cobranza directa","Transferencia","Otro"];
const CATS_EGR=["Financiamientos","Nómina","Combustible","Impuestos","Seguros","Reprotecciones",
  "Apoyos transportación","Peajes","Sistemas","Honorarios","Fondo fijo","Mantenimiento","Servicios","Otro"];
const inputSt={padding:"8px 12px",borderRadius:8,border:"1px solid #E2E8F0",fontSize:14,
  outline:"none",background:"#FAFBFC",width:"100%",fontFamily:"inherit",color:"#1A2332",boxSizing:"border-box"};
const selSt={...inputSt,cursor:"pointer"};
const iconBtn={background:"none",border:"none",cursor:"pointer",fontSize:15,padding:"3px 5px"};

/* ── Supabase ── */
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
  }else{
    const{data,error}=await supabase.from("efe_items").insert(row).select().single();
    if(error){console.error(error);return null;}return data;
  }
}
async function deleteEfeItem(id){
  const{error}=await supabase.from("efe_items").delete().eq("id",id);
  if(error)console.error(error);
}
async function fetchEfeSaldo(empresaId,semana){
  const{data}=await supabase.from("efe_saldos").select("*")
    .eq("empresa_id",empresaId).eq("semana",semana).single();
  return data||null;
}
async function upsertEfeSaldo(empresaId,semana,saldo){
  await supabase.from("efe_saldos").upsert(
    {empresa_id:empresaId,semana,saldo_mxn:saldo.MXN||0,saldo_usd:saldo.USD||0,saldo_eur:saldo.EUR||0},
    {onConflict:"empresa_id,semana"});
}

/* ═══════════════════════════════════════════════════════════════════ */
export default function EfeView({
  invoices,ingresos,cobros,empresaId,esConsulta,
  onProjectInvoice,onUnprojectInvoice,onProjectIngreso,onUnprojectIngreso,
}){
  const[weekStart,setWeekStart]=useState(()=>getMonday(new Date()));
  const[efeItems,setEfeItems]=useState([]);
  const[saldoIni,setSaldoIni]=useState({MXN:0,USD:0,EUR:0});
  const[loading,setLoading]=useState(true);
  const[modalItem,setModalItem]=useState(null);
  const[saldoModal,setSaldoModal]=useState(false);
  const[delConfirm,setDelConfirm]=useState(null);
  const[panelOpen,setPanelOpen]=useState(false);

  const weekDays=useMemo(()=>Array.from({length:5},(_,i)=>{
    const d=addDays(weekStart,i);
    return{date:toISO(d),label:`${DIAS[i]} ${d.getDate()}/${d.getMonth()+1}`};
  }),[weekStart]);
  const weekFrom=weekDays[0].date;
  const weekTo=weekDays[4].date;

  useEffect(()=>{
    let cancelled=false;
    async function load(){
      setLoading(true);
      const[items,saldo]=await Promise.all([
        fetchEfeItems(empresaId,weekFrom,weekTo),
        fetchEfeSaldo(empresaId,weekFrom),
      ]);
      if(cancelled)return;
      setEfeItems(items);
      setSaldoIni(saldo?{MXN:saldo.saldo_mxn||0,USD:saldo.saldo_usd||0,EUR:saldo.saldo_eur||0}:{MXN:0,USD:0,EUR:0});
      setLoading(false);
    }
    load();
    return()=>{cancelled=true;};
  },[empresaId,weekFrom,weekTo]);

  /* ── Grid rows — solo items autorizados (enEfe=true) ── */
  const{rowsIng,rowsEgr}=useMemo(()=>{
    const rowsIng=[],rowsEgr=[];

    /* CxC autorizados */
    ingresos.filter(i=>i.enEfe).forEach(ing=>{
      const fecha=ing.fechaEfe||ing.fechaFicticia||ing.fechaVencimiento||ing.fecha;
      if(!fecha||fecha<weekFrom||fecha>weekTo)return;
      const cobrado=cobros.filter(c=>c.ingresoId===ing.id).reduce((s,c)=>s+c.monto,0);
      const pend=Math.max(0,ing.monto-cobrado);
      if(pend<=0)return;
      rowsIng.push({key:`cxc-${ing.id}`,id:ing.id,source:"cxc",
        categoria:ing.categoria||"Sin categoría",concepto:ing.concepto||"",
        proveedor:ing.cliente||"",hotel:"",destino:"",
        monto:pend,moneda:ing.moneda||"MXN",fecha,
        fechaEfe:ing.fechaEfe,totalMonto:ing.monto,cobrado});
    });

    /* Items libres ingreso */
    efeItems.filter(i=>i.tipo==="ingreso").forEach(i=>rowsIng.push({
      key:`libre-${i.id}`,id:i.id,source:"libre",
      categoria:i.categoria||"Otro",concepto:i.concepto||"",
      proveedor:i.proveedor_cliente||"",hotel:i.hotel||"",destino:i.destino||"",
      monto:+i.monto||0,moneda:i.moneda||"MXN",fecha:i.fecha,notas:i.notas||"",
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
      rowsEgr.push({key:`cxp-${inv.id}`,id:inv.id,source:"cxp",
        categoria:inv.clasificacion||"Sin clasificar",concepto:inv.concepto||inv.folio||"",
        proveedor:inv.proveedor||"",hotel:"",destino:"",
        monto:saldo,moneda:inv.moneda||"MXN",fecha,fechaEfe:inv.fechaEfe});
    });

    /* Items libres egreso */
    efeItems.filter(i=>i.tipo==="egreso").forEach(i=>rowsEgr.push({
      key:`libre-${i.id}`,id:i.id,source:"libre",
      categoria:i.categoria||"Otro",concepto:i.concepto||"",
      proveedor:i.proveedor_cliente||"",hotel:i.hotel||"",destino:i.destino||"",
      monto:+i.monto||0,moneda:i.moneda||"MXN",fecha:i.fecha,notas:i.notas||"",
    }));

    return{rowsIng,rowsEgr};
  },[invoices,ingresos,cobros,efeItems,weekFrom,weekTo]);

  /* ── Totales ── */
  const dayTotals=useMemo(()=>{
    const dt={};
    weekDays.forEach(({date})=>{dt[date]={ing:{MXN:0,USD:0,EUR:0},egr:{MXN:0,USD:0,EUR:0}};});
    rowsIng.forEach(r=>{if(dt[r.fecha])dt[r.fecha].ing[r.moneda]=(dt[r.fecha].ing[r.moneda]||0)+r.monto;});
    rowsEgr.forEach(r=>{if(dt[r.fecha])dt[r.fecha].egr[r.moneda]=(dt[r.fecha].egr[r.moneda]||0)+r.monto;});
    return dt;
  },[rowsIng,rowsEgr,weekDays]);

  const runningSaldo=useMemo(()=>{
    const rs={};let s={...saldoIni};
    weekDays.forEach(({date})=>{
      const dt=dayTotals[date];
      s={MXN:s.MXN+(dt?.ing.MXN||0)-(dt?.egr.MXN||0),
         USD:s.USD+(dt?.ing.USD||0)-(dt?.egr.USD||0),
         EUR:s.EUR+(dt?.ing.EUR||0)-(dt?.egr.EUR||0)};
      rs[date]={...s};
    });
    return rs;
  },[dayTotals,saldoIni,weekDays]);

  const weekTotals=useMemo(()=>{
    const wt={ing:{MXN:0,USD:0,EUR:0},egr:{MXN:0,USD:0,EUR:0}};
    rowsIng.forEach(r=>wt.ing[r.moneda]=(wt.ing[r.moneda]||0)+r.monto);
    rowsEgr.forEach(r=>wt.egr[r.moneda]=(wt.egr[r.moneda]||0)+r.monto);
    return wt;
  },[rowsIng,rowsEgr]);

  /* Badge: items disponibles para autorizar */
  const pendientesCount=useMemo(()=>{
    const allInv=[...(invoices.MXN||[]),...(invoices.USD||[]),...(invoices.EUR||[])];
    return allInv.filter(i=>!i.enEfe&&i.estatus!=="Pagado"&&i.fechaProgramacion).length
         + ingresos.filter(i=>!i.enEfe).length;
  },[invoices,ingresos]);

  /* ── CRUD items libres ── */
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

  const weekLabel=()=>{
    const[y0,m0,d0]=weekFrom.split("-");const[,m1,d1]=weekTo.split("-");
    return m0===m1?`${+d0}–${+d1} ${MESES[+m0-1]} ${y0}`
      :`${+d0} ${MESES[+m0-1]} – ${+d1} ${MESES[+m1-1]} ${y0}`;
  };
  const groupBy=(rows,key)=>rows.reduce((acc,r)=>{
    const k=r[key]||"Otro";if(!acc[k])acc[k]=[];acc[k].push(r);return acc;
  },{});

  /* ── Sección tabla ── */
  const renderSection=(rows,tipo)=>{
    const isIng=tipo==="ingreso";
    const grouped=groupBy(rows,"categoria");
    const hdrBg=isIng?"#1B5E20":"#BF360C";
    const catBg=isIng?"#E8F5E9":"#FBE9E7";
    const catClr=isIng?"#2E7D32":"#BF360C";
    const accentC=isIng?C.ok:C.danger;
    return(
      <>
        <tr>
          <td colSpan={9} style={{background:hdrBg,color:"#fff",fontWeight:800,
            padding:"8px 16px",fontSize:13,letterSpacing:.5}}>
            {isIng?"▲  INGRESOS":"▼  EGRESOS"}
          </td>
        </tr>
        {Object.entries(grouped).map(([cat,items])=>(
          <React.Fragment key={cat}>
            <tr>
              <td colSpan={2} style={{background:catBg,color:catClr,fontWeight:700,
                padding:"3px 14px 3px 28px",fontSize:11,textTransform:"uppercase",letterSpacing:.5}}>
                {cat}
              </td>
              {weekDays.map(({date})=>{
                const s=items.filter(i=>i.fecha===date&&i.moneda==="MXN").reduce((a,i)=>a+i.monto,0);
                return<td key={date} style={{background:catBg,textAlign:"right",padding:"3px 8px",
                  fontSize:11,color:catClr,fontWeight:s>0?700:400}}>{s>0?`$${fmt(s)}`:""}</td>;
              })}
              <td style={{background:catBg,textAlign:"right",padding:"3px 10px",fontSize:11,
                color:catClr,fontWeight:700}}>
                {(()=>{const t=items.filter(i=>i.moneda==="MXN").reduce((a,i)=>a+i.monto,0);return t>0?`$${fmt(t)}`:""})()}
              </td>
              <td style={{background:catBg}}/>
            </tr>
            {items.map(row=>(
              <tr key={row.key} style={{borderBottom:`1px solid ${C.border}`}}
                onMouseEnter={e=>e.currentTarget.style.background="#F8FAFC"}
                onMouseLeave={e=>e.currentTarget.style.background=""}>
                <td style={{padding:"5px 12px 5px 34px",fontSize:12,color:C.text,maxWidth:200}}>
                  <div style={{display:"flex",alignItems:"center",gap:5,flexWrap:"wrap"}}>
                    <span style={{fontWeight:500}}>{row.proveedor||row.concepto||"—"}</span>
                    {row.source==="cxc"&&<span style={{fontSize:9,background:"#E0F2F1",color:C.teal,
                      borderRadius:4,padding:"1px 5px",fontWeight:700}}>CxC</span>}
                    {row.source==="cxp"&&<span style={{fontSize:9,background:"#FFF8E1",color:C.warn,
                      borderRadius:4,padding:"1px 5px",fontWeight:700}}>CxP</span>}
                  </div>
                  {row.concepto&&row.proveedor&&
                    <div style={{fontSize:10,color:C.muted,marginTop:1}}>{row.concepto}</div>}
                </td>
                <td style={{padding:"5px 8px",fontSize:11,color:C.muted}}>{row.hotel||row.destino||""}</td>
                {weekDays.map(({date})=>(
                  <td key={date} style={{textAlign:"right",padding:"5px 8px",
                    background:row.fecha===date?(isIng?"#F0FFF4":"#FFF5F5"):""}}>
                    {row.fecha===date&&(
                      <span style={{color:isIng?C.ok:C.danger,fontWeight:700}}>
                        {sym(row.moneda)}{fmt(row.monto)}{row.moneda!=="MXN"?` ${row.moneda}`:""}
                      </span>
                    )}
                  </td>
                ))}
                <td style={{textAlign:"right",padding:"5px 10px",fontSize:12,
                  color:accentC,fontWeight:600}}>
                  {sym(row.moneda)}{fmt(row.monto)}{row.moneda!=="MXN"?` ${row.moneda}`:""}
                </td>
                <td style={{padding:"3px 8px",textAlign:"center"}}>
                  {row.source==="libre"&&!esConsulta&&(
                    <div style={{display:"flex",gap:2}}>
                      <button onClick={()=>setModalItem({...row,tipo})} style={{...iconBtn,color:C.sky}}>✏️</button>
                      <button onClick={()=>setDelConfirm(row.id)} style={{...iconBtn,color:C.danger}}>🗑</button>
                    </div>
                  )}
                  {(row.source==="cxp"||row.source==="cxc")&&!esConsulta&&(
                    <button
                      onClick={()=>row.source==="cxp"?onUnprojectInvoice?.(row.id):onUnprojectIngreso?.(row.id)}
                      style={{...iconBtn,color:C.muted,fontSize:12,opacity:.7}}
                      title="Quitar del EFE">✕</button>
                  )}
                </td>
              </tr>
            ))}
          </React.Fragment>
        ))}
        {/* Totales de sección */}
        <tr style={{borderTop:`2px solid ${accentC}`,background:catBg}}>
          <td colSpan={2} style={{fontWeight:800,color:accentC,padding:"7px 16px",fontSize:13}}>
            TOTAL {isIng?"INGRESOS":"EGRESOS"} MXN
          </td>
          {weekDays.map(({date})=>{
            const s=rows.filter(r=>r.fecha===date&&r.moneda==="MXN").reduce((a,r)=>a+r.monto,0);
            return<td key={date} style={{textAlign:"right",fontWeight:800,color:accentC,
              padding:"7px 8px",fontSize:13}}>{s>0?`$${fmt(s)}`:"—"}</td>;
          })}
          <td style={{textAlign:"right",fontWeight:800,color:accentC,padding:"7px 10px",fontSize:13}}>
            ${fmt(isIng?weekTotals.ing.MXN:weekTotals.egr.MXN)}
          </td>
          <td/>
        </tr>
        {["USD","EUR"].map(cur=>{
          const total=isIng?weekTotals.ing[cur]:weekTotals.egr[cur];
          if(!total)return null;
          return(
            <tr key={cur} style={{background:catBg}}>
              <td colSpan={2} style={{fontWeight:700,color:accentC,padding:"3px 16px",fontSize:12,opacity:.8}}>
                TOTAL {isIng?"INGRESOS":"EGRESOS"} {cur}
              </td>
              {weekDays.map(({date})=>{
                const s=rows.filter(r=>r.fecha===date&&r.moneda===cur).reduce((a,r)=>a+r.monto,0);
                return<td key={date} style={{textAlign:"right",fontSize:12,color:accentC,
                  padding:"3px 8px",opacity:.8}}>{s>0?`${sym(cur)}${fmt(s)}`:""}</td>;
              })}
              <td style={{textAlign:"right",fontSize:12,color:accentC,padding:"3px 10px",
                opacity:.8,fontWeight:700}}>{sym(cur)}{fmt(total)}</td>
              <td/>
            </tr>
          );
        })}
        {!esConsulta&&(
          <tr>
            <td colSpan={9} style={{padding:"5px 16px",borderBottom:`1px solid ${C.border}`}}>
              <button onClick={()=>setModalItem({tipo,fecha:weekDays[0].date,moneda:"MXN",
                monto:0,categoria:"",concepto:"",proveedor_cliente:"",hotel:"",destino:""})}
                style={{background:"none",border:`1px dashed ${accentC}`,color:accentC,
                  borderRadius:8,padding:"3px 14px",fontSize:12,cursor:"pointer",fontFamily:"inherit"}}>
                + Agregar {isIng?"ingreso":"egreso"} libre
              </button>
            </td>
          </tr>
        )}
      </>
    );
  };

  /* ══════════════════════════════════════════════════════════════════
     RENDER PRINCIPAL
     ══════════════════════════════════════════════════════════════════ */
  return(
    <div>
      {/* Header */}
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",
        marginBottom:20,flexWrap:"wrap",gap:12}}>
        <div>
          <h1 style={{fontSize:24,fontWeight:800,color:C.navy,margin:0}}>Flujo de Efectivo Semanal</h1>
          <p style={{color:C.muted,marginTop:4,fontSize:14}}>
            Solo muestra items autorizados · CxP + CxC + libres
          </p>
        </div>
        <div style={{display:"flex",gap:10,flexWrap:"wrap",alignItems:"center"}}>
          {/* Botón Panel Selector */}
          {!esConsulta&&(
            <button onClick={()=>setPanelOpen(true)}
              style={{display:"flex",alignItems:"center",gap:8,padding:"10px 18px",
                borderRadius:12,border:"none",background:C.navy,color:"#fff",fontWeight:700,
                fontSize:14,cursor:"pointer",fontFamily:"inherit",position:"relative"}}>
              📋 Autorizar al EFE
              {pendientesCount>0&&(
                <span style={{background:C.danger,color:"#fff",fontSize:11,fontWeight:800,
                  borderRadius:"50%",width:20,height:20,display:"flex",alignItems:"center",
                  justifyContent:"center",position:"absolute",top:-8,right:-8,lineHeight:1}}>
                  {pendientesCount>99?"99+":pendientesCount}
                </span>
              )}
            </button>
          )}
          {/* Navegador semana */}
          <div style={{display:"flex",alignItems:"center",gap:8,background:"#fff",
            border:`1px solid ${C.border}`,borderRadius:12,padding:"8px 14px"}}>
            <button onClick={()=>setWeekStart(prev=>addDays(prev,-7))}
              style={{border:"none",background:"#F1F5F9",borderRadius:7,padding:"5px 12px",
                cursor:"pointer",fontSize:18,lineHeight:1}}>‹</button>
            <span style={{fontWeight:700,color:C.navy,fontSize:14,
              minWidth:200,textAlign:"center"}}>{weekLabel()}</span>
            <button onClick={()=>setWeekStart(prev=>addDays(prev,7))}
              style={{border:"none",background:"#F1F5F9",borderRadius:7,padding:"5px 12px",
                cursor:"pointer",fontSize:18,lineHeight:1}}>›</button>
            <button onClick={()=>setWeekStart(getMonday(new Date()))}
              style={{border:"none",background:"#E8F0FE",borderRadius:7,padding:"5px 10px",
                cursor:"pointer",fontSize:12,color:C.blue,fontWeight:700,fontFamily:"inherit"}}>
              Hoy
            </button>
          </div>
        </div>
      </div>

      {/* Saldos iniciales */}
      <div style={{display:"flex",gap:12,marginBottom:20,flexWrap:"wrap",alignItems:"center"}}>
        {CURRENCIES.map(cur=>(
          <div key={cur} style={{background:"#fff",border:`1px solid ${C.border}`,
            borderLeft:`4px solid ${{MXN:C.mxn,USD:C.usd,EUR:C.eur}[cur]}`,
            borderRadius:12,padding:"12px 18px",minWidth:170}}>
            <div style={{fontSize:11,color:C.muted,fontWeight:700,textTransform:"uppercase",marginBottom:4}}>
              Saldo inicial {cur}
            </div>
            <div style={{fontSize:20,fontWeight:800,color:{MXN:C.mxn,USD:C.usd,EUR:C.eur}[cur]}}>
              {sym(cur)}{fmt(saldoIni[cur])}
            </div>
          </div>
        ))}
        {!esConsulta&&(
          <button onClick={()=>setSaldoModal(true)}
            style={{alignSelf:"center",background:"#F1F5F9",border:`1px solid ${C.border}`,
              borderRadius:10,padding:"8px 16px",cursor:"pointer",
              fontSize:13,color:C.navy,fontWeight:600,fontFamily:"inherit"}}>
            ✏️ Editar saldos
          </button>
        )}
      </div>

      {loading?(
        <div style={{textAlign:"center",padding:60,color:C.muted,fontSize:16}}>
          Cargando flujo de efectivo…
        </div>
      ):(
        <>
          {/* Estado vacío */}
          {rowsIng.length===0&&rowsEgr.length===0&&(
            <div style={{background:"#F8FAFC",border:`2px dashed ${C.border}`,borderRadius:16,
              padding:48,textAlign:"center",marginBottom:20}}>
              <div style={{fontSize:40,marginBottom:12}}>🌊</div>
              <div style={{fontWeight:700,color:C.navy,fontSize:16,marginBottom:6}}>
                No hay items autorizados para esta semana
              </div>
              <p style={{color:C.muted,fontSize:14,margin:"0 0 20px"}}>
                Presiona 🌊 en facturas/ingresos desde <strong>Cartera</strong> o <strong>CxC</strong>,
                o usa el botón de abajo para selección masiva.
              </p>
              {!esConsulta&&(
                <button onClick={()=>setPanelOpen(true)}
                  style={{padding:"10px 24px",borderRadius:10,border:"none",background:C.navy,
                    color:"#fff",fontWeight:700,fontSize:14,cursor:"pointer",fontFamily:"inherit"}}>
                  📋 Autorizar al EFE
                  {pendientesCount>0&&<span style={{marginLeft:8,background:C.danger,color:"#fff",
                    fontSize:11,borderRadius:20,padding:"1px 8px",fontWeight:800}}>
                    {pendientesCount}
                  </span>}
                </button>
              )}
            </div>
          )}

          {/* Tabla principal */}
          {(rowsIng.length>0||rowsEgr.length>0)&&(
            <div style={{background:"#fff",border:`1px solid ${C.border}`,borderRadius:16,
              overflow:"hidden",boxShadow:"0 2px 12px rgba(0,0,0,.06)",overflowX:"auto"}}>
              <table style={{width:"100%",borderCollapse:"collapse",minWidth:760}}>
                <colgroup>
                  <col style={{width:210}}/><col style={{width:110}}/>
                  {weekDays.map((_,i)=><col key={i} style={{width:105}}/>)}
                  <col style={{width:115}}/><col style={{width:52}}/>
                </colgroup>
                <thead>
                  <tr style={{background:C.navy}}>
                    <th style={{color:"#fff",textAlign:"left",padding:"11px 16px",fontSize:12,fontWeight:700}}>
                      Concepto / Proveedor
                    </th>
                    <th style={{color:"#fff",textAlign:"left",padding:"11px 8px",fontSize:12,fontWeight:700}}>
                      Hotel / Destino
                    </th>
                    {weekDays.map(({date,label})=>(
                      <th key={date} style={{color:"#fff",textAlign:"right",
                        padding:"11px 8px",fontSize:12,fontWeight:700}}>{label}</th>
                    ))}
                    <th style={{color:"#fff",textAlign:"right",padding:"11px 10px",fontSize:12,fontWeight:700}}>
                      Total sem.
                    </th>
                    <th/>
                  </tr>
                </thead>
                <tbody>
                  {renderSection(rowsIng,"ingreso")}
                  <tr><td colSpan={9} style={{height:8,background:"#F8FAFC"}}/></tr>
                  {renderSection(rowsEgr,"egreso")}
                  <tr><td colSpan={9} style={{height:8,background:"#F8FAFC"}}/></tr>

                  {/* Flujo neto */}
                  <tr>
                    <td colSpan={9} style={{background:"#263238",color:"#CFD8DC",fontWeight:700,
                      padding:"7px 16px",fontSize:12,letterSpacing:.5}}>
                      FLUJO NETO POR DIVISA
                    </td>
                  </tr>
                  {CURRENCIES.map(cur=>{
                    const ingT=weekTotals.ing[cur]||0,egrT=weekTotals.egr[cur]||0;
                    if(!ingT&&!egrT)return null;
                    const clr={MXN:C.mxn,USD:C.usd,EUR:C.eur}[cur];
                    return(
                      <tr key={cur} style={{background:{MXN:"#EFF6FF",USD:"#F0FDF4",EUR:"#F5F3FF"}[cur]}}>
                        <td colSpan={2} style={{fontWeight:700,color:clr,padding:"8px 16px",fontSize:13}}>
                          Flujo {cur}
                        </td>
                        {weekDays.map(({date})=>{
                          const dt=dayTotals[date];
                          const fl=(dt?.ing[cur]||0)-(dt?.egr[cur]||0);
                          const neg=fl<0;
                          return<td key={date} style={{textAlign:"right",fontWeight:700,
                            padding:"8px 8px",fontSize:13,
                            color:fl===0?C.muted:neg?C.danger:C.ok}}>
                            {fl!==0?`${neg?"-":""}${sym(cur)}${fmt(Math.abs(fl))}`:"—"}
                          </td>;
                        })}
                        <td style={{textAlign:"right",fontWeight:800,padding:"8px 10px",fontSize:13,
                          color:(ingT-egrT)<0?C.danger:(ingT-egrT)>0?C.ok:C.muted}}>
                          {ingT-egrT!==0?`${ingT-egrT<0?"-":""}${sym(cur)}${fmt(Math.abs(ingT-egrT))}`:"—"}
                        </td>
                        <td/>
                      </tr>
                    );
                  })}

                  {/* Saldo acumulado */}
                  <tr style={{background:C.navy}}>
                    <td colSpan={2} style={{fontWeight:800,color:"#fff",padding:"10px 16px",fontSize:13}}>
                      Saldo bancario MXN (acumulado)
                    </td>
                    {weekDays.map(({date})=>{
                      const s=runningSaldo[date]?.MXN||0;
                      return<td key={date} style={{textAlign:"right",fontWeight:800,fontSize:13,
                        padding:"10px 8px",color:s>=0?"#A5F3FC":"#FCA5A5"}}>${fmt(s)}</td>;
                    })}
                    <td style={{textAlign:"right",fontWeight:800,fontSize:13,padding:"10px 10px",
                      color:(runningSaldo[weekDays[4]?.date]?.MXN||0)>=0?"#A5F3FC":"#FCA5A5"}}>
                      ${fmt(runningSaldo[weekDays[4]?.date]?.MXN||0)}
                    </td>
                    <td/>
                  </tr>
                  {["USD","EUR"].map(cur=>{
                    const finalS=runningSaldo[weekDays[4]?.date]?.[cur]||0;
                    if(!finalS&&!(weekTotals.ing[cur])&&!(weekTotals.egr[cur]))return null;
                    return(
                      <tr key={cur} style={{background:"#1A3040"}}>
                        <td colSpan={2} style={{fontWeight:700,color:"#B0BEC5",padding:"7px 16px",fontSize:12}}>
                          Saldo bancario {cur} (acumulado)
                        </td>
                        {weekDays.map(({date})=>{
                          const s=runningSaldo[date]?.[cur]||0;
                          return<td key={date} style={{textAlign:"right",fontWeight:700,fontSize:12,
                            padding:"7px 8px",color:s>=0?"#80DEEA":"#FFAB91"}}>{sym(cur)}{fmt(s)}</td>;
                        })}
                        <td style={{textAlign:"right",fontWeight:700,fontSize:12,padding:"7px 10px",
                          color:finalS>=0?"#80DEEA":"#FFAB91"}}>{sym(cur)}{fmt(finalS)}</td>
                        <td/>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}

          {/* KPIs */}
          <div style={{display:"flex",gap:12,marginTop:20,flexWrap:"wrap"}}>
            {[
              {label:"Ingresos sem. MXN",value:`$${fmt(weekTotals.ing.MXN)}`,color:C.ok,icon:"▲"},
              {label:"Egresos sem. MXN",value:`$${fmt(weekTotals.egr.MXN)}`,color:C.danger,icon:"▼"},
              {label:"Flujo neto MXN",
                value:`${(weekTotals.ing.MXN-weekTotals.egr.MXN)<0?"-":""}$${fmt(Math.abs(weekTotals.ing.MXN-weekTotals.egr.MXN))}`,
                color:(weekTotals.ing.MXN-weekTotals.egr.MXN)<0?C.danger:C.ok,icon:"≈"},
              {label:"Pendientes de autorizar",value:pendientesCount,
                color:pendientesCount>0?C.warn:C.ok,icon:"🌊"},
            ].map(kpi=>(
              <div key={kpi.label} style={{background:"#fff",border:`1px solid ${C.border}`,
                borderLeft:`4px solid ${kpi.color}`,borderRadius:12,padding:"14px 20px",flex:1,minWidth:160}}>
                <div style={{fontSize:11,color:C.muted,fontWeight:700,textTransform:"uppercase",marginBottom:4}}>
                  {kpi.icon} {kpi.label}
                </div>
                <div style={{fontSize:22,fontWeight:800,color:kpi.color}}>{kpi.value}</div>
              </div>
            ))}
          </div>
        </>
      )}

      {/* Modals */}
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
        <SaldoIniModal saldo={saldoIni} onSave={handleSaveSaldo} onClose={()=>setSaldoModal(false)}/>
      )}
      {delConfirm&&(
        <div style={{position:"fixed",inset:0,background:"rgba(15,45,74,.45)",display:"flex",
          alignItems:"center",justifyContent:"center",zIndex:1000}}>
          <div style={{background:"#fff",borderRadius:16,padding:28,maxWidth:340,
            textAlign:"center",boxShadow:"0 20px 60px rgba(0,0,0,.25)"}}>
            <div style={{fontSize:32,marginBottom:12}}>🗑</div>
            <p style={{fontWeight:700,color:C.navy,marginBottom:8}}>¿Eliminar este item?</p>
            <p style={{color:C.muted,fontSize:13,marginBottom:20}}>Esta acción no se puede deshacer.</p>
            <div style={{display:"flex",gap:10}}>
              <button onClick={()=>setDelConfirm(null)} style={{flex:1,padding:"9px",borderRadius:9,
                border:`1px solid ${C.border}`,background:"#F8FAFC",cursor:"pointer",fontFamily:"inherit"}}>
                Cancelar
              </button>
              <button onClick={()=>handleDeleteItem(delConfirm)} style={{flex:1,padding:"9px",borderRadius:9,
                border:"none",background:C.danger,color:"#fff",fontWeight:700,
                cursor:"pointer",fontFamily:"inherit"}}>Eliminar</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════════
   PANEL SELECTOR MODAL
   ═══════════════════════════════════════════════════════════════════ */
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
    const m={};allInv.forEach(inv=>{m[inv.id]=inv.fechaEfe||inv.fechaProgramacion||"";});return m;
  });
  const[invSel,setInvSel]=useState(new Set());
  const[ingDates,setIngDates]=useState(()=>{
    const m={};ingresos.forEach(ing=>{m[ing.id]=ing.fechaEfe||ing.fechaFicticia||ing.fechaVencimiento||ing.fecha||"";});return m;
  });
  const[ingSel,setIngSel]=useState(new Set());

  const q=search.toLowerCase();
  const filteredInv=allInv.filter(i=>!q||[i.proveedor,i.clasificacion,i.concepto].some(s=>s?.toLowerCase().includes(q)));
  const filteredIng=ingresos.filter(i=>!i.oculta&&(!q||[i.cliente,i.concepto,i.categoria].some(s=>s?.toLowerCase().includes(q))));

  const fmtN=n=>new Intl.NumberFormat("es-MX",{minimumFractionDigits:2,maximumFractionDigits:2}).format(+n||0);
  const symC=cur=>cur==="EUR"?"€":"$";

  const toggleInv=id=>setInvSel(prev=>{const n=new Set(prev);n.has(id)?n.delete(id):n.add(id);return n;});
  const toggleAllInv=()=>{
    const ids=filteredInv.filter(i=>!i.enEfe).map(i=>i.id);
    setInvSel(prev=>prev.size===ids.length?new Set():new Set(ids));
  };
  const proyectarInvSel=async()=>{
    for(const id of invSel){
      const inv=allInv.find(i=>i.id===id);
      if(inv)await onProjectInvoice?.(inv,invDates[id]||"");
    }
    setInvSel(new Set());
  };

  const toggleIng=id=>setIngSel(prev=>{const n=new Set(prev);n.has(id)?n.delete(id):n.add(id);return n;});
  const toggleAllIng=()=>{
    const ids=filteredIng.filter(i=>!i.enEfe).map(i=>i.id);
    setIngSel(prev=>prev.size===ids.length?new Set():new Set(ids));
  };
  const proyectarIngSel=async()=>{
    for(const id of ingSel){
      const ing=ingresos.find(i=>i.id===id);
      if(ing)await onProjectIngreso?.(ing,ingDates[id]||"");
    }
    setIngSel(new Set());
  };

  const pendInv=filteredInv.filter(i=>!i.enEfe).length;
  const pendIng=filteredIng.filter(i=>!i.enEfe).length;

  const TH=({children,right,center,w})=>(
    <th style={{padding:"8px 8px",textAlign:right?"right":center?"center":"left",
      fontWeight:700,color:C.muted,fontSize:12,width:w,whiteSpace:"nowrap"}}>
      {children}
    </th>
  );

  return(
    <div style={{position:"fixed",inset:0,background:"rgba(15,45,74,.5)",
      display:"flex",alignItems:"center",justifyContent:"center",zIndex:1100,padding:16}}
      onClick={onClose}>
      <div onClick={e=>e.stopPropagation()} style={{background:"#fff",borderRadius:20,
        width:"100%",maxWidth:860,maxHeight:"88vh",display:"flex",flexDirection:"column",
        boxShadow:"0 24px 80px rgba(0,0,0,.3)"}}>

        {/* Header */}
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",
          padding:"20px 24px 12px",flexShrink:0}}>
          <div>
            <h2 style={{fontSize:20,fontWeight:800,color:C.navy,margin:0}}>📋 Autorizar al EFE</h2>
            <p style={{color:C.muted,fontSize:13,margin:"4px 0 0"}}>
              Selecciona y asigna fecha para incluir en el flujo semanal
            </p>
          </div>
          <button onClick={onClose} style={{background:"#F1F5F9",border:"none",borderRadius:8,
            width:36,height:36,cursor:"pointer",fontSize:18}}>×</button>
        </div>

        {/* Search */}
        <div style={{padding:"0 24px 12px",flexShrink:0}}>
          <input value={search} onChange={e=>setSearch(e.target.value)}
            placeholder="🔍 Buscar proveedor, cliente, concepto..."
            style={{...inputSt,background:"#F8FAFC"}}/>
        </div>

        {/* Tabs */}
        <div style={{display:"flex",borderBottom:`2px solid ${C.border}`,
          padding:"0 24px",flexShrink:0}}>
          {[{id:"cxp",label:"Facturas CxP",count:pendInv,color:C.warn},
            {id:"cxc",label:"Ingresos CxC",count:pendIng,color:C.ok}].map(t=>(
            <button key={t.id} onClick={()=>setTab(t.id)}
              style={{padding:"8px 20px",border:"none",background:"none",cursor:"pointer",
                fontFamily:"inherit",fontSize:14,fontWeight:tab===t.id?800:500,
                color:tab===t.id?C.blue:C.muted,
                borderBottom:tab===t.id?`3px solid ${C.blue}`:"3px solid transparent",
                marginBottom:-2,display:"flex",alignItems:"center",gap:8}}>
              {t.label}
              {t.count>0&&<span style={{background:t.color,color:"#fff",fontSize:11,
                fontWeight:700,borderRadius:20,padding:"1px 8px"}}>{t.count} pend.</span>}
            </button>
          ))}
        </div>

        {/* Tabla */}
        <div style={{flex:1,overflowY:"auto",padding:"0 24px 8px"}}>
          {tab==="cxp"&&(
            <table style={{width:"100%",borderCollapse:"collapse",fontSize:13,marginTop:10}}>
              <thead>
                <tr style={{background:"#F8FAFC",position:"sticky",top:0,zIndex:1}}>
                  <th style={{padding:"8px 6px",textAlign:"center",width:36}}>
                    <input type="checkbox"
                      checked={invSel.size>0&&invSel.size===filteredInv.filter(i=>!i.enEfe).length}
                      onChange={toggleAllInv} style={{cursor:"pointer",width:15,height:15,accentColor:C.blue}}/>
                  </th>
                  <TH>Proveedor</TH><TH>Clasificación</TH>
                  <TH right>Saldo</TH>
                  <TH center w={135}>Fecha EFE</TH>
                  <TH center w={80}>Estado</TH>
                </tr>
              </thead>
              <tbody>
                {filteredInv.map(inv=>{
                  const saldo=Math.max(0,(inv.total||0)-(inv.montoPagado||0));
                  const inEfe=inv.enEfe;
                  return(
                    <tr key={inv.id} style={{borderBottom:`1px solid ${C.border}`,
                      background:inEfe?"#EFF6FF":""}}
                      onMouseEnter={e=>{if(!inEfe)e.currentTarget.style.background="#F8FAFC"}}
                      onMouseLeave={e=>{e.currentTarget.style.background=inEfe?"#EFF6FF":"";}}>
                      <td style={{padding:"7px 6px",textAlign:"center"}}>
                        {!inEfe&&<input type="checkbox" checked={invSel.has(inv.id)}
                          onChange={()=>toggleInv(inv.id)}
                          style={{cursor:"pointer",width:15,height:15,accentColor:C.blue}}/>}
                      </td>
                      <td style={{padding:"7px 8px"}}>
                        <div style={{fontWeight:600,color:C.text}}>{inv.proveedor}</div>
                        <div style={{fontSize:11,color:C.muted}}>{inv.serie}{inv.folio} · {inv.moneda}</div>
                      </td>
                      <td style={{padding:"7px 8px",color:C.muted,fontSize:12}}>{inv.clasificacion}</td>
                      <td style={{padding:"7px 8px",textAlign:"right",fontWeight:700,color:C.danger}}>
                        {symC(inv.moneda)}{fmtN(saldo)}
                      </td>
                      <td style={{padding:"7px 8px",textAlign:"center"}}>
                        {!inEfe?(
                          <input type="date" value={invDates[inv.id]||""}
                            onChange={e=>setInvDates(prev=>({...prev,[inv.id]:e.target.value}))}
                            style={{padding:"3px 6px",fontSize:12,border:`1px solid ${C.border}`,
                              borderRadius:6,fontFamily:"inherit",color:C.text}}/>
                        ):(
                          <span style={{fontSize:12,color:C.blue,fontWeight:600}}>✅ {inv.fechaEfe||"—"}</span>
                        )}
                      </td>
                      <td style={{padding:"7px 8px",textAlign:"center"}}>
                        {inEfe?(
                          <button onClick={()=>onUnprojectInvoice?.(inv.id)}
                            style={{...iconBtn,fontSize:11,color:C.danger,border:`1px solid #FFCDD2`,
                              borderRadius:6,padding:"2px 8px",background:"#FFEBEE"}}>
                            Quitar
                          </button>
                        ):(
                          <button onClick={async()=>{await onProjectInvoice?.(inv,invDates[inv.id]||"");}}
                            disabled={!invDates[inv.id]}
                            style={{...iconBtn,fontSize:11,
                              color:invDates[inv.id]?C.blue:C.muted,
                              border:`1px solid ${invDates[inv.id]?C.blue:C.border}`,
                              borderRadius:6,padding:"2px 8px",
                              background:invDates[inv.id]?"#EFF6FF":"#F8FAFC",
                              cursor:invDates[inv.id]?"pointer":"not-allowed"}}>
                            🌊
                          </button>
                        )}
                      </td>
                    </tr>
                  );
                })}
                {filteredInv.length===0&&(
                  <tr><td colSpan={6} style={{textAlign:"center",padding:30,color:C.muted}}>
                    No hay facturas
                  </td></tr>
                )}
              </tbody>
            </table>
          )}

          {tab==="cxc"&&(
            <table style={{width:"100%",borderCollapse:"collapse",fontSize:13,marginTop:10}}>
              <thead>
                <tr style={{background:"#F8FAFC",position:"sticky",top:0,zIndex:1}}>
                  <th style={{padding:"8px 6px",textAlign:"center",width:36}}>
                    <input type="checkbox"
                      checked={ingSel.size>0&&ingSel.size===filteredIng.filter(i=>!i.enEfe).length}
                      onChange={toggleAllIng} style={{cursor:"pointer",width:15,height:15,accentColor:C.blue}}/>
                  </th>
                  <TH>Cliente</TH><TH>Categoría</TH>
                  <TH right>Por cobrar</TH>
                  <TH center w={135}>Fecha EFE</TH>
                  <TH center w={80}>Estado</TH>
                </tr>
              </thead>
              <tbody>
                {filteredIng.map(ing=>{
                  const cobrado=cobros.filter(c=>c.ingresoId===ing.id).reduce((s,c)=>s+c.monto,0);
                  const porCobrar=Math.max(0,ing.monto-cobrado);
                  const inEfe=ing.enEfe;
                  return(
                    <tr key={ing.id} style={{borderBottom:`1px solid ${C.border}`,
                      background:inEfe?"#F0FDF4":""}}
                      onMouseEnter={e=>{if(!inEfe)e.currentTarget.style.background="#F8FAFC"}}
                      onMouseLeave={e=>{e.currentTarget.style.background=inEfe?"#F0FDF4":"";}}>
                      <td style={{padding:"7px 6px",textAlign:"center"}}>
                        {!inEfe&&<input type="checkbox" checked={ingSel.has(ing.id)}
                          onChange={()=>toggleIng(ing.id)}
                          style={{cursor:"pointer",width:15,height:15,accentColor:C.blue}}/>}
                      </td>
                      <td style={{padding:"7px 8px"}}>
                        <div style={{fontWeight:600,color:C.text}}>{ing.cliente}</div>
                        <div style={{fontSize:11,color:C.muted}}>{ing.concepto} · {ing.moneda||"MXN"}</div>
                      </td>
                      <td style={{padding:"7px 8px",color:C.muted,fontSize:12}}>{ing.categoria}</td>
                      <td style={{padding:"7px 8px",textAlign:"right",fontWeight:700,color:C.ok}}>
                        {symC(ing.moneda||"MXN")}{fmtN(porCobrar)}
                      </td>
                      <td style={{padding:"7px 8px",textAlign:"center"}}>
                        {!inEfe?(
                          <input type="date" value={ingDates[ing.id]||""}
                            onChange={e=>setIngDates(prev=>({...prev,[ing.id]:e.target.value}))}
                            style={{padding:"3px 6px",fontSize:12,border:`1px solid ${C.border}`,
                              borderRadius:6,fontFamily:"inherit",color:C.text}}/>
                        ):(
                          <span style={{fontSize:12,color:C.ok,fontWeight:600}}>✅ {ing.fechaEfe||"—"}</span>
                        )}
                      </td>
                      <td style={{padding:"7px 8px",textAlign:"center"}}>
                        {inEfe?(
                          <button onClick={()=>onUnprojectIngreso?.(ing.id)}
                            style={{...iconBtn,fontSize:11,color:C.danger,border:`1px solid #FFCDD2`,
                              borderRadius:6,padding:"2px 8px",background:"#FFEBEE"}}>
                            Quitar
                          </button>
                        ):(
                          <button onClick={async()=>{await onProjectIngreso?.(ing,ingDates[ing.id]||"");}}
                            disabled={!ingDates[ing.id]}
                            style={{...iconBtn,fontSize:11,
                              color:ingDates[ing.id]?C.ok:C.muted,
                              border:`1px solid ${ingDates[ing.id]?C.ok:C.border}`,
                              borderRadius:6,padding:"2px 8px",
                              background:ingDates[ing.id]?"#F0FDF4":"#F8FAFC",
                              cursor:ingDates[ing.id]?"pointer":"not-allowed"}}>
                            🌊
                          </button>
                        )}
                      </td>
                    </tr>
                  );
                })}
                {filteredIng.length===0&&(
                  <tr><td colSpan={6} style={{textAlign:"center",padding:30,color:C.muted}}>
                    No hay ingresos
                  </td></tr>
                )}
              </tbody>
            </table>
          )}
        </div>

        {/* Footer */}
        <div style={{padding:"14px 24px",borderTop:`1px solid ${C.border}`,flexShrink:0,
          display:"flex",gap:10,alignItems:"center",background:"#F8FAFC",
          borderRadius:"0 0 20px 20px"}}>
          {tab==="cxp"&&(
            <>
              <span style={{flex:1,fontSize:13,color:C.muted}}>
                {invSel.size} seleccionada{invSel.size!==1?"s":""}
                {invSel.size>0&&<span style={{color:C.sky,marginLeft:6,fontSize:12}}>
                  — verifica fechas asignadas
                </span>}
              </span>
              <button onClick={proyectarInvSel} disabled={invSel.size===0}
                style={{padding:"9px 22px",borderRadius:9,border:"none",fontFamily:"inherit",
                  background:invSel.size>0?C.navy:"#B0BEC5",color:"#fff",
                  fontWeight:700,cursor:invSel.size>0?"pointer":"not-allowed",fontSize:14}}>
                🌊 Proyectar {invSel.size>0?`${invSel.size} `:""}al EFE
              </button>
            </>
          )}
          {tab==="cxc"&&(
            <>
              <span style={{flex:1,fontSize:13,color:C.muted}}>
                {ingSel.size} seleccionado{ingSel.size!==1?"s":""}
                {ingSel.size>0&&<span style={{color:C.sky,marginLeft:6,fontSize:12}}>
                  — verifica fechas asignadas
                </span>}
              </span>
              <button onClick={proyectarIngSel} disabled={ingSel.size===0}
                style={{padding:"9px 22px",borderRadius:9,border:"none",fontFamily:"inherit",
                  background:ingSel.size>0?C.navy:"#B0BEC5",color:"#fff",
                  fontWeight:700,cursor:ingSel.size>0?"pointer":"not-allowed",fontSize:14}}>
                🌊 Proyectar {ingSel.size>0?`${ingSel.size} `:""}al EFE
              </button>
            </>
          )}
          <button onClick={onClose} style={{padding:"9px 18px",borderRadius:9,
            border:`1px solid ${C.border}`,background:"#fff",cursor:"pointer",
            fontFamily:"inherit",fontSize:14,color:C.text}}>Cerrar</button>
        </div>
      </div>
    </div>
  );
}

/* ── Item libre modal ── */
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
  const Lbl=({label,children})=>(
    <div style={{marginBottom:14}}>
      <label style={{display:"block",fontSize:11,fontWeight:700,color:C.muted,
        textTransform:"uppercase",letterSpacing:.4,marginBottom:5}}>{label}</label>
      {children}
    </div>
  );
  return(
    <div style={{position:"fixed",inset:0,background:"rgba(15,45,74,.45)",display:"flex",
      alignItems:"center",justifyContent:"center",zIndex:1200,padding:20}} onClick={onClose}>
      <div onClick={e=>e.stopPropagation()} style={{background:"#fff",borderRadius:20,
        padding:28,width:"100%",maxWidth:500,boxShadow:"0 20px 60px rgba(0,0,0,.25)",
        maxHeight:"90vh",overflowY:"auto"}}>
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:18}}>
          <h2 style={{fontSize:18,fontWeight:800,color:C.navy,margin:0}}>
            {form.id?"Editar":"Nuevo"} item libre
          </h2>
          <button onClick={onClose} style={{background:"#F1F5F9",border:"none",borderRadius:8,
            width:34,height:34,cursor:"pointer",fontSize:18}}>×</button>
        </div>
        <div style={{display:"flex",gap:8,marginBottom:16}}>
          {["ingreso","egreso"].map(t=>(
            <button key={t} onClick={()=>setForm(f=>({...f,tipo:t,categoria:""}))}
              style={{flex:1,padding:"8px",borderRadius:9,fontFamily:"inherit",fontWeight:700,
                cursor:"pointer",fontSize:13,
                border:`2px solid ${form.tipo===t?accentC:C.border}`,
                background:form.tipo===t?(t==="ingreso"?"#E8F5E9":"#FFEBEE"):"#fff",
                color:form.tipo===t?accentC:C.muted}}>
              {t==="ingreso"?"▲ Ingreso":"▼ Egreso"}
            </button>
          ))}
        </div>
        <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:12}}>
          <Lbl label="Categoría">
            <select name="categoria" value={form.categoria} onChange={upd} style={selSt}>
              <option value="">— Selecciona —</option>
              {(isIng?CATS_ING:CATS_EGR).map(c=><option key={c}>{c}</option>)}
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
        <div style={{display:"flex",gap:10,marginTop:8}}>
          <button onClick={onClose} style={{flex:1,padding:"10px",borderRadius:10,
            border:`1px solid ${C.border}`,background:"#F8FAFC",cursor:"pointer",fontFamily:"inherit"}}>
            Cancelar
          </button>
          <button onClick={()=>onSave(form)} style={{flex:2,padding:"10px",borderRadius:10,
            border:"none",background:accentC,color:"#fff",fontWeight:700,
            cursor:"pointer",fontFamily:"inherit"}}>
            {form.id?"Guardar cambios":"Agregar"}
          </button>
        </div>
      </div>
    </div>
  );
}

/* ── Saldo inicial modal ── */
function SaldoIniModal({saldo,onSave,onClose}){
  const[form,setForm]=useState({...saldo});
  return(
    <div style={{position:"fixed",inset:0,background:"rgba(15,45,74,.45)",display:"flex",
      alignItems:"center",justifyContent:"center",zIndex:1200,padding:20}} onClick={onClose}>
      <div onClick={e=>e.stopPropagation()} style={{background:"#fff",borderRadius:20,
        padding:28,maxWidth:380,width:"100%",boxShadow:"0 20px 60px rgba(0,0,0,.25)"}}>
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:18}}>
          <h2 style={{fontSize:18,fontWeight:800,color:C.navy,margin:0}}>
            Saldo inicial de la semana
          </h2>
          <button onClick={onClose} style={{background:"#F1F5F9",border:"none",borderRadius:8,
            width:34,height:34,cursor:"pointer",fontSize:18}}>×</button>
        </div>
        {CURRENCIES.map(cur=>(
          <div key={cur} style={{marginBottom:14}}>
            <label style={{display:"block",fontSize:11,fontWeight:700,color:C.muted,
              textTransform:"uppercase",letterSpacing:.4,marginBottom:5}}>
              Saldo {cur} {cur==="MXN"?"🇲🇽":cur==="USD"?"🇺🇸":"🇪🇺"}
            </label>
            <input type="number" value={form[cur]}
              onChange={e=>setForm(f=>({...f,[cur]:+e.target.value||0}))}
              style={inputSt} min="0" step="0.01"/>
          </div>
        ))}
        <div style={{display:"flex",gap:10,marginTop:20}}>
          <button onClick={onClose} style={{flex:1,padding:"10px",borderRadius:10,
            border:`1px solid ${C.border}`,background:"#F8FAFC",cursor:"pointer",fontFamily:"inherit"}}>
            Cancelar
          </button>
          <button onClick={()=>onSave(form)} style={{flex:2,padding:"10px",borderRadius:10,
            border:"none",background:C.blue,color:"#fff",fontWeight:700,
            cursor:"pointer",fontFamily:"inherit"}}>
            Guardar saldos
          </button>
        </div>
      </div>
    </div>
  );
}
