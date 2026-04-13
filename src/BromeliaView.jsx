import { useState, useCallback, useMemo, useEffect } from "react";
import * as XLSX from "xlsx";
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend,
  PieChart, Pie, Cell, ResponsiveContainer, LineChart, Line
} from "recharts";
import { fetchBromeliaData, upsertBromeliaData } from "./db.js";

// ─── THEME ───────────────────────────────────────────────────────────────────
const COLORS = {
  bg: "#f0f2f5",
  card: "#ffffff",
  border: "#e2e8f0",
  accent: "#d97706",
  accent2: "#0284c7",
  accent3: "#059669",
  danger: "#dc2626",
  muted: "#94a3b8",
  text: "#0f172a",
  textDim: "#64748b",
  transporte: "#0284c7",
  proteccion: "#7c3aed",
  equipajes: "#d97706",
  rentas: "#059669",
  circuitos: "#ea580c",
};

const SERVICE_MAP = {
  TRANSPORTE: "Transportación",
  PROTECCION: "Protección Integral",
  EQUIPAJES: "Equipajes",
  RENTAS: "Rentas",
  CIRCUITOS: "Circuitos",
};

const DEST_MAP = {
  CUN: "Cancún",
  SJD: "Los Cabos",
  TQO: "Tulum",
  MID: "Mérida",
  PVR: "Puerto Vallarta",
};

const AIRLINE_KEYWORDS = ["AMERICAN", "DELTA", "UNITED", "SOUTHWEST", "JETBLUE", "AEROMEXICO", "AIR FRANCE", "WN", "B6", "AA", "DL", "UA"];

// ─── HELPERS ─────────────────────────────────────────────────────────────────
const toNum = (v) => {
  const n = parseFloat(String(v).replace(/,/g, ""));
  return isNaN(n) ? 0 : n;
};

const fmt = (n, decimals = 0) =>
  new Intl.NumberFormat("es-MX", {
    style: "currency",
    currency: "MXN",
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  }).format(n || 0);

const fmtShort = (n) => {
  if (Math.abs(n) >= 1e6) return `$${(n / 1e6).toFixed(2)}M`;
  if (Math.abs(n) >= 1e3) return `$${(n / 1e3).toFixed(0)}K`;
  return fmt(n);
};

const MES_NAMES = ["", "Ene", "Feb", "Mar", "Abr", "May", "Jun", "Jul", "Ago", "Sep", "Oct", "Nov", "Dic"];

function detectService(row) {
  const svc = String(row["UNIDAD DE SERVICIO"] || "").trim().toUpperCase();
  const cliente = String(row["CLIENTE"] || "").toUpperCase();
  if (svc === "TRANSPORTE") return "TRANSPORTE";
  if (svc === "PROTECCION") return "PROTECCION";
  if (svc.includes("EQUIP") || cliente.includes("EQUIP")) return "EQUIPAJES";
  if (svc === "RENTAS" || svc === "RENTA") return "RENTAS";
  if (svc === "CIRCUITOS" || svc === "CIRCUITO") return "CIRCUITOS";
  return svc || "OTROS";
}

function parseXLSX(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const wb = XLSX.read(e.target.result, { type: "array", cellDates: true });

        // Always use "Concentrado" sheet; fallback to auto-detect if not found
        let targetSheet = null;
        const preferredNames = ["Concentrado", "concentrado", "CONCENTRADO"];
        for (const name of preferredNames) {
          if (wb.Sheets[name]) {
            const ws = wb.Sheets[name];
            const raw = XLSX.utils.sheet_to_json(ws, { header: 1 });
            for (let ri = 0; ri < Math.min(8, raw.length); ri++) {
              const row = raw[ri] || [];
              const rowStr = row.map((v) => String(v || "").trim().toUpperCase());
              if (rowStr.includes("DESTINO") && rowStr.includes("UNIDAD DE SERVICIO")) {
                targetSheet = { name, ws, raw, headerIdx: ri };
                break;
              }
            }
            if (targetSheet) break;
          }
        }

        // Fallback: scan all sheets
        if (!targetSheet) {
          for (const name of wb.SheetNames) {
            const ws = wb.Sheets[name];
            const raw = XLSX.utils.sheet_to_json(ws, { header: 1 });
            for (let ri = 0; ri < Math.min(8, raw.length); ri++) {
              const row = raw[ri] || [];
              const rowStr = row.map((v) => String(v || "").trim().toUpperCase());
              if (rowStr.includes("DESTINO") && rowStr.includes("UNIDAD DE SERVICIO") && rowStr.includes("TOTAL CON IVA")) {
                targetSheet = { name, ws, raw, headerIdx: ri };
                break;
              }
            }
            if (targetSheet) break;
          }
        }

        if (!targetSheet) { reject("No se encontró la hoja 'Concentrado' ni una hoja con estructura válida."); return; }

        const { raw, headerIdx } = targetSheet;
        const headerRow = raw[headerIdx];
        const rows = raw.slice(headerIdx + 1).map((r) => {
          const obj = {};
          headerRow.forEach((h, i) => { if (h) obj[String(h).trim()] = r[i]; });
          return obj;
        }).filter((r) => r["UNIDAD DE SERVICIO"] && String(r["UNIDAD DE SERVICIO"]).trim() !== "x");

        resolve(rows);
      } catch (err) { reject(String(err)); }
    };
    reader.onerror = () => reject("Error leyendo archivo");
    reader.readAsArrayBuffer(file);
  });
}

function processData(rows) {
  return rows.map((r) => {
    // Ingreso c/IVA: columna V (DP CON IVA) + columna X (TOTAL F CON IVA)
    const ingrC = toNum(r["DP CON IVA"] ?? 0) + toNum(r["TOTAL F CON IVA"] ?? r["TOTAL CON IVA"] ?? 0);
    // Ingreso s/IVA: replica fórmula Excel Y = IF(G/E=2, TOTAL_F_CON_IVA/1.16, TOTAL_F_CON_IVA) + DP/1.16
    const ge = toNum(r["G / E"] ?? 0);
    const totalFConIva = toNum(r["TOTAL F CON IVA"] ?? r["TOTAL CON IVA"] ?? 0);
    const totalFSinIva = ge === 2 ? totalFConIva / 1.16 : totalFConIva;
    const ingrS = (toNum(r["DP CON IVA"] ?? 0) / 1.16) + totalFSinIva;
    // Egreso c/IVA: columna AF (DP CON IVA2) + columna AH (TOTAL F CON IVA2)
    const egrsC = toNum(r["DP CON IVA2"] ?? 0) + toNum(r["TOTAL F CON IVA2"] ?? 0);
    // Egreso s/IVA: replica fórmula Excel AI = IF(G/E=2, TOTAL_F_CON_IVA2/1.16, TOTAL_F_CON_IVA2) + DP2/1.16
    const totalF2ConIva = toNum(r["TOTAL F CON IVA2"] ?? 0);
    const totalF2SinIva = ge === 2 ? totalF2ConIva / 1.16 : totalF2ConIva;
    const egrsS = (toNum(r["DP CON IVA2"] ?? 0) / 1.16) + totalF2SinIva;
    // Margen Bruto: calculado = Ingreso c/IVA - Egreso c/IVA (no se toma del archivo)
    const margen = ingrC - egrsC;
    // Margen Bruto s/IVA: calculado = Ingreso s/IVA - Egreso s/IVA
    const margenS = ingrS - egrsS;
    // SO: "SO" o "AJ" en nuevo, "SO" en viejo
    const so = String(r["SO"] ?? r["# DE PAX"] ?? "").trim();
    // Factura proveedor: "FACTURA PROVEEDOR" (ambos)
    const facturaProv = String(r["FACTURA PROVEEDOR"] ?? "").trim();
    // Factura cliente: "FACTURA CLIENTE" (ambos)
    const facturaCliente = String(r["FACTURA CLIENTE"] ?? "").trim();
    // Estado proveedor: "ESTADO PROVEEDOR" (ambos)
    const estadoProv = String(r["ESTADO PROVEEDOR"] ?? r["ESTADO PROV"] ?? "").trim().toUpperCase();
    // Estado cliente: "ESTADO CLIENTE" (ambos)
    const estadoCliRaw = String(r["ESTADO CLIENTE"] ?? "").trim().toUpperCase();
    const estadoCli = estadoCliRaw === "" ? "SIN PAGAR" : estadoCliRaw;

    const fechaRaw = r["FECHA  IN"] ?? r["FECHA IN"] ?? r["FECHA"];
    const fecha = (() => {
      if (!fechaRaw) return null;
      if (fechaRaw instanceof Date) return fechaRaw;
      const p = new Date(fechaRaw);
      return isNaN(p) ? null : p;
    })();

    const osNum = String(r["OS"] ?? r["Os"] ?? "").trim();
    const totalFactMX = toNum(r["TOTAL FACTURADO MX"] ?? r["MONTO MX CLIENTE"] ?? 0);
    const totalFactUSD = toNum(r["TOTAL FACTURADO USD"] ?? r["MONTO USD CLIENTE"] ?? 0);
    const facturado = (facturaCliente && facturaCliente !== "" && facturaCliente.toLowerCase() !== "x" && facturaCliente.toLowerCase() !== "na") || totalFactMX > 0 || totalFactUSD > 0;

    return {
      ...r,
      _servicio: detectService(r),
      _destino: String(r["DESTINO"] ?? "").trim().toUpperCase(),
      _cliente: String(r["CLIENTE"] ?? r["Cliente2"] ?? "").trim(),
      _mes: fecha ? fecha.getMonth() + 1 : null,
      _fecha: fecha,
      _ingrC: ingrC,
      _ingrS: ingrS,
      _egrsC: egrsC,
      _egrsS: egrsS,
      _margen: margen,
      _margenS: margenS,
      _estadoProv: estadoProv,
      _estadoCli: estadoCli,
      _so: so,
      _os: osNum,
      _facturaProv: facturaProv,
      _facturaCliente: facturaCliente,
      _facturado: facturado,
      _totalFactMX: totalFactMX,
      _totalFactUSD: totalFactUSD,
      _proveedor: String(r["PROVEEDOR"] ?? "").trim(),
    };
  });
}

// ─── COMPONENTS ──────────────────────────────────────────────────────────────
function KPICard({ label, value, sub, color = COLORS.accent, onClick }) {
  const [hover, setHover] = useState(false);
  return (
    <div
      onClick={onClick}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        background: hover ? "#f8fafc" : COLORS.card,
        border: `1px solid ${hover ? color : COLORS.border}`,
        borderRadius: 12, padding: "18px 20px", position: "relative", overflow: "hidden",
        cursor: onClick ? "pointer" : "default",
        transition: "all 0.18s",
        transform: hover && onClick ? "translateY(-2px)" : "none",
        boxShadow: hover && onClick ? `0 4px 20px ${color}22` : "none",
      }}
    >
      <div style={{ position: "absolute", top: 0, left: 0, width: 3, height: "100%", background: color, borderRadius: "3px 0 0 3px" }} />
      <div style={{ fontSize: 11, color: COLORS.textDim, textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 6, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        {label}
        {onClick && <span style={{ fontSize: 10, color: color, opacity: hover ? 1 : 0.5, transition: "opacity 0.15s" }}>Ver detalle →</span>}
      </div>
      <div style={{ fontSize: 22, fontWeight: 700, color: COLORS.text, fontFamily: "'DM Mono', monospace" }}>{value}</div>
      {sub && <div style={{ fontSize: 12, color: COLORS.textDim, marginTop: 4 }}>{sub}</div>}
    </div>
  );
}

// ─── REPORTE CLIENTE MODAL ────────────────────────────────────────────────────
function ReporteClienteModal({ data, clientesList, onClose }) {
  const [cliente, setCliente] = useState("");
  const [clienteSearch, setClienteSearch] = useState("");
  const [periodoTipo, setPeriodoTipo] = useState("rango"); // rango | semana | quincena
  const [desde, setDesde] = useState("");
  const [hasta, setHasta] = useState("");
  const [semanaRef, setSemanaRef] = useState("actual"); // actual | pasada
  const [calYear, setCalYear] = useState(new Date().getFullYear());
  const [calMonth, setCalMonth] = useState(new Date().getMonth());
  const [calHover, setCalHover] = useState(null);


  const clientesFiltrados = clienteSearch.trim()
    ? clientesList.filter(c => c.nombre.toLowerCase().includes(clienteSearch.toLowerCase()))
    : clientesList;

  const calcPeriodo = () => {
    const hoy = new Date();
    const dow = hoy.getDay();
    const diffMon = dow === 0 ? -6 : 1 - dow;
    const lunes = new Date(hoy); lunes.setHours(0,0,0,0); lunes.setDate(hoy.getDate() + diffMon);
    const domingo = new Date(lunes); domingo.setDate(lunes.getDate() + 6);

    if (periodoTipo === "semana") {
      if (semanaRef === "actual") return { d: lunes, h: domingo };
      const lunesPas = new Date(lunes); lunesPas.setDate(lunes.getDate() - 7);
      const domPas = new Date(lunesPas); domPas.setDate(lunesPas.getDate() + 6);
      return { d: lunesPas, h: domPas };
    }
    if (periodoTipo === "quincena") {
      const dia = hoy.getDate();
      if (semanaRef === "actual") {
        const ini = new Date(hoy.getFullYear(), hoy.getMonth(), dia <= 15 ? 1 : 16);
        const fin = dia <= 15 ? new Date(hoy.getFullYear(), hoy.getMonth(), 15) : new Date(hoy.getFullYear(), hoy.getMonth()+1, 0);
        return { d: ini, h: fin };
      } else {
        const mes = dia <= 15 ? (hoy.getMonth() === 0 ? 11 : hoy.getMonth()-1) : hoy.getMonth();
        const anio = dia <= 15 && hoy.getMonth() === 0 ? hoy.getFullYear()-1 : hoy.getFullYear();
        const ini = new Date(anio, mes, dia <= 15 ? 16 : 1);
        const fin = dia <= 15 ? new Date(anio, mes+1, 0) : new Date(anio, mes, 15);
        return { d: ini, h: fin };
      }
    }
    return null;
  };

  const periodoLabel = () => {
    if (periodoTipo === "rango" && desde && hasta) {
      return `${new Date(desde+"T12:00:00").toLocaleDateString("es-MX",{day:"2-digit",month:"short",year:"numeric"})} al ${new Date(hasta+"T12:00:00").toLocaleDateString("es-MX",{day:"2-digit",month:"short",year:"numeric"})}`;
    }
    const p = calcPeriodo();
    if (p) return `${p.d.toLocaleDateString("es-MX",{day:"2-digit",month:"short",year:"numeric"})} al ${p.h.toLocaleDateString("es-MX",{day:"2-digit",month:"short",year:"numeric"})}`;
    return "";
  };

  const REPORT_COLS = [
    { key: "DESTINO", label: "DESTINO" },
    { key: "MODALIDAD DE SERVICIO", label: "MODALIDAD DE SERVICIO" },
    { key: "UNIDAD DE SERVICIO", label: "UNIDAD DE SERVICIO" },
    { key: "MES", label: "MES" },
    { key: "FECHA  IN", label: "FECHA IN" },
    { key: "FECHA OUT", label: "FECHA OUT" },
    { key: "G / E", label: "G / E" },
    { key: "TIPO DE SERVICIO", label: "TIPO DE SERVICIO" },
    { key: "ADULTOS", label: "ADULTOS" },
    { key: "MENORES", label: "MENORES" },
    { key: "INFANTES", label: "INFANTES" },
    { key: "NOMBRE DE PAX", label: "NOMBRE DE PAX" },
    { key: "CUPON", label: "CUPON" },
    { key: "VUELO", label: "VUELO" },
    { key: "HORA", label: "HORA" },
    { key: "ZONA", label: "ZONA" },
    { key: "HOTEL", label: "HOTEL" },
    { key: "CLIENTE", label: "CLIENTE" },
    { key: "DP CON IVA", label: "DP CON IVA" },
    { key: "TOTAL F CON IVA", label: "TOTAL F CON IVA" },
    { key: "TOTAL SIN IVA", label: "TOTAL SIN IVA" },
    { key: "TIPO DE UNIDAD CLIENTE", label: "TIPO DE UNIDAD CLIENTE" },
    { key: "SO", label: "SO" },
    { key: "PO", label: "PO" },
    { key: "OS", label: "OS" },
  ];

  const handleExport = () => {
    if (!cliente) return alert("Selecciona un cliente");

    let rows = data.filter(r => r._cliente === cliente);

    if (periodoTipo === "rango") {
      if (desde) rows = rows.filter(r => r._fecha && r._fecha >= new Date(desde+"T00:00:00"));
      if (hasta) rows = rows.filter(r => r._fecha && r._fecha <= new Date(hasta+"T23:59:59"));
    } else {
      const p = calcPeriodo();
      if (p) rows = rows.filter(r => r._fecha && r._fecha >= p.d && r._fecha <= new Date(p.h.getTime() + 86399999));
    }

    if (rows.length === 0) return alert("No hay registros para el periodo seleccionado");

    const NUM_COLS = new Set(["DP CON IVA","TOTAL F CON IVA","TOTAL SIN IVA"]);

    const header = REPORT_COLS.map(c => c.label);
    const dataRows = rows.map(r => REPORT_COLS.map(c => {
      const v = r[c.key];
      if (c.key === "HORA" && v instanceof Date) return v.toLocaleTimeString("es-MX", { hour: "2-digit", minute: "2-digit" });
      if (v instanceof Date) return v.toLocaleDateString("es-MX");
      if (NUM_COLS.has(c.key)) return typeof v === "number" ? v : (parseFloat(String(v||"0").replace(/,/g,"")) || 0);
      return v ?? "";
    }));

    const totalesRow = REPORT_COLS.map(c => {
      if (c.key === "DESTINO") return "TOTAL";
      if (NUM_COLS.has(c.key)) return rows.reduce((s, r) => {
        const v = r[c.key];
        return s + (typeof v === "number" ? v : parseFloat(String(v||"0").replace(/,/g,"")) || 0);
      }, 0);
      return "";
    });

    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.aoa_to_sheet([
      ["BROMELIA - RELACION DE SERVICIOS"],
      ["Cliente: " + cliente],
      ["Periodo: " + periodoLabel() + "     |     Total de servicios: " + rows.length],
      [],
      header,
      ...dataRows,
      totalesRow,
    ]);

    const colWidths = {
      "DESTINO": 10, "MODALIDAD DE SERVICIO": 22, "UNIDAD DE SERVICIO": 20,
      "MES": 6, "FECHA  IN": 12, "FECHA OUT": 12, "G / E": 6,
      "TIPO DE SERVICIO": 18, "ADULTOS": 8, "MENORES": 8, "INFANTES": 8,
      "NOMBRE DE PAX": 28, "CUPON": 18, "VUELO": 12, "HORA": 8,
      "ZONA": 18, "HOTEL": 26, "CLIENTE": 28,
      "DP CON IVA": 14, "TOTAL F CON IVA": 16, "TOTAL SIN IVA": 16,
      "TIPO DE UNIDAD CLIENTE": 20, "SO": 10, "PO": 10, "OS": 10,
    };
    ws["!cols"] = REPORT_COLS.map(c => ({ wch: colWidths[c.key] || 16 }));
    ws["!merges"] = [
      { s: { r:0, c:0 }, e: { r:0, c: REPORT_COLS.length-1 } },
      { s: { r:1, c:0 }, e: { r:1, c: REPORT_COLS.length-1 } },
      { s: { r:2, c:0 }, e: { r:2, c: REPORT_COLS.length-1 } },
    ];
    ws["!autofilter"] = { ref: XLSX.utils.encode_range({ s:{r:4,c:0}, e:{r:4,c:REPORT_COLS.length-1} }) };

    // Formato moneda en columnas numéricas
    rows.forEach((_, rowIdx) => {
      REPORT_COLS.forEach((c, colIdx) => {
        if (NUM_COLS.has(c.key)) {
          const cellRef = XLSX.utils.encode_cell({ r: rowIdx + 5, c: colIdx });
          if (ws[cellRef]) ws[cellRef].z = '"$"#,##0.00';
        }
      });
    });

    XLSX.utils.book_append_sheet(wb, ws, "Relacion de Servicios");
    const fecha = new Date().toISOString().slice(0,10);
    const nombreCliente = cliente.replace(/[^a-zA-Z0-9]/g, "_").slice(0,30);
    XLSX.writeFile(wb, "Relacion_" + nombreCliente + "_" + fecha + ".xlsx");
  };

  if (!data) return null;

  return (
    <div onClick={onClose} style={{ position:"fixed", inset:0, background:"rgba(0,0,0,0.4)", zIndex:1100, display:"flex", alignItems:"center", justifyContent:"center", padding:24, backdropFilter:"blur(4px)" }}>
      <div onClick={e=>e.stopPropagation()} style={{ background:COLORS.card, borderRadius:16, width:"100%", maxWidth:560, boxShadow:"0 24px 60px rgba(0,0,0,0.2)", border:`1px solid ${COLORS.border}` }}>
        {/* Header */}
        <div style={{ padding:"18px 24px", borderBottom:`1px solid ${COLORS.border}`, display:"flex", justifyContent:"space-between", alignItems:"center" }}>
          <div>
            <div style={{ fontSize:15, fontWeight:700, color:COLORS.text }}>📋 Reporte de Servicios al Cliente</div>
            <div style={{ fontSize:11, color:COLORS.textDim, marginTop:2 }}>Genera una relación de servicios para enviar al cliente</div>
          </div>
          <button onClick={onClose} style={{ background:COLORS.bg, border:`1px solid ${COLORS.border}`, color:COLORS.textDim, borderRadius:8, padding:"6px 12px", cursor:"pointer" }}>✕</button>
        </div>

        {/* Body */}
        <div style={{ padding:"20px 24px", display:"flex", flexDirection:"column", gap:16 }}>

          {/* Cliente */}
          <div>
            <div style={{ fontSize:11, fontWeight:700, color:COLORS.textDim, textTransform:"uppercase", letterSpacing:"0.06em", marginBottom:6 }}>Cliente</div>
            <div style={{ position:"relative" }}>
              <input value={clienteSearch} onChange={e=>{setClienteSearch(e.target.value);setCliente("");}}
                placeholder="Buscar cliente..."
                style={{ width:"100%", background:COLORS.bg, border:`1px solid ${cliente ? COLORS.accent2 : COLORS.border}`, color:COLORS.text, borderRadius:8, padding:"8px 12px", fontSize:13, outline:"none", boxSizing:"border-box" }} />
              {clienteSearch && !cliente && (
                <div style={{ position:"absolute", top:"calc(100% + 4px)", left:0, right:0, zIndex:200, background:COLORS.card, border:`1px solid ${COLORS.border}`, borderRadius:10, maxHeight:200, overflowY:"auto", boxShadow:"0 8px 24px rgba(0,0,0,0.1)" }}>
                  {clientesFiltrados.slice(0,20).map(c => (
                    <div key={c.nombre} onClick={()=>{setCliente(c.nombre);setClienteSearch(c.nombre);}}
                      style={{ padding:"8px 12px", cursor:"pointer", borderBottom:`1px solid ${COLORS.border}`, display:"flex", justifyContent:"space-between", fontSize:13 }}
                      onMouseEnter={e=>e.currentTarget.style.background=COLORS.bg}
                      onMouseLeave={e=>e.currentTarget.style.background="transparent"}>
                      <span>{c.nombre}</span>
                      <span style={{ color:COLORS.textDim, fontSize:11 }}>{new Intl.NumberFormat("es-MX",{style:"currency",currency:"MXN",minimumFractionDigits:0}).format(c.ingrC)}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
            {cliente && <div style={{ marginTop:6, fontSize:11, color:COLORS.accent2 }}>✓ {cliente}</div>}
          </div>

          {/* Tipo de periodo */}
          <div>
            <div style={{ fontSize:11, fontWeight:700, color:COLORS.textDim, textTransform:"uppercase", letterSpacing:"0.06em", marginBottom:6 }}>Periodo</div>
            <div style={{ display:"flex", gap:6, marginBottom:12 }}>
              {[["rango","Rango libre"],["semana","Semana"],["quincena","Quincena"]].map(([v,l])=>(
                <button key={v} onClick={()=>setPeriodoTipo(v)} style={{ flex:1, padding:"7px 0", borderRadius:8, fontSize:12, fontWeight:600, cursor:"pointer", border:`1px solid ${periodoTipo===v ? COLORS.accent2 : COLORS.border}`, background:periodoTipo===v ? "#eff6ff" : "transparent", color:periodoTipo===v ? COLORS.accent2 : COLORS.textDim, transition:"all 0.15s" }}>{l}</button>
              ))}
            </div>

            {periodoTipo === "rango" && (() => {
              const MESES = ["Enero","Febrero","Marzo","Abril","Mayo","Junio","Julio","Agosto","Septiembre","Octubre","Noviembre","Diciembre"];
              const DIAS = ["Lu","Ma","Mi","Ju","Vi","Sa","Do"];
              const firstDay = new Date(calYear, calMonth, 1);
              const lastDay = new Date(calYear, calMonth+1, 0);
              const startDow = (firstDay.getDay() + 6) % 7;
              const totalDays = lastDay.getDate();
              const toISO = (y,m,d) => `${y}-${String(m+1).padStart(2,"0")}-${String(d).padStart(2,"0")}`;
              const fromISO = (s) => s ? new Date(s+"T12:00:00") : null;
              const desdeD = fromISO(desde), hastaD = fromISO(hasta);
              const hoverD = calHover ? new Date(calHover+"T12:00:00") : null;
              const rangeEnd = hastaD || hoverD;
              const isStart = (iso) => iso === desde;
              const isEnd   = (iso) => iso === hasta;
              const inRange = (iso) => {
                if (!desdeD || !rangeEnd) return false;
                const d = new Date(iso+"T12:00:00");
                const lo = desdeD < rangeEnd ? desdeD : rangeEnd;
                const hi = desdeD < rangeEnd ? rangeEnd : desdeD;
                return d > lo && d < hi;
              };
              const handleDay = (iso) => {
                if (!desde || (desde && hasta)) { setDesde(iso); setHasta(""); setCalHover(null); }
                else { if (iso < desde) { setHasta(desde); setDesde(iso); } else { setHasta(iso); } setCalHover(null); }
              };
              const prevM = () => { if (calMonth===0){setCalMonth(11);setCalYear(y=>y-1);}else setCalMonth(m=>m-1); };
              const nextM = () => { if (calMonth===11){setCalMonth(0);setCalYear(y=>y+1);}else setCalMonth(m=>m+1); };
              const cells = [];
              for (let i=0;i<startDow;i++) cells.push(null);
              for (let d=1;d<=totalDays;d++) cells.push(d);
              const rangeLabel = desde && hasta
                ? `${new Date(desde+"T12:00:00").toLocaleDateString("es-MX",{day:"2-digit",month:"short"})} → ${new Date(hasta+"T12:00:00").toLocaleDateString("es-MX",{day:"2-digit",month:"short"})}`
                : desde ? `Desde ${new Date(desde+"T12:00:00").toLocaleDateString("es-MX",{day:"2-digit",month:"short"})}` : "";
              return (
                <div style={{ border:`1px solid ${COLORS.border}`, borderRadius:12, padding:14 }}>
                  <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", marginBottom:10 }}>
                    <button onClick={prevM} style={{ background:"none", border:`1px solid ${COLORS.border}`, borderRadius:6, width:26, height:26, cursor:"pointer", fontSize:13, color:COLORS.textDim }}>‹</button>
                    <span style={{ fontSize:13, fontWeight:700, color:COLORS.text }}>{MESES[calMonth]} {calYear}</span>
                    <button onClick={nextM} style={{ background:"none", border:`1px solid ${COLORS.border}`, borderRadius:6, width:26, height:26, cursor:"pointer", fontSize:13, color:COLORS.textDim }}>›</button>
                  </div>
                  <div style={{ display:"grid", gridTemplateColumns:"repeat(7,1fr)", marginBottom:4 }}>
                    {DIAS.map(d=><div key={d} style={{ textAlign:"center", fontSize:10, fontWeight:700, color:COLORS.textDim, padding:"2px 0" }}>{d}</div>)}
                  </div>
                  <div style={{ display:"grid", gridTemplateColumns:"repeat(7,1fr)", gap:2 }}>
                    {cells.map((day,i) => {
                      if (!day) return <div key={`e-${i}`}/>;
                      const iso = toISO(calYear,calMonth,day);
                      const isS=isStart(iso),isE=isEnd(iso),inR=inRange(iso);
                      const isToday = iso===new Date().toISOString().slice(0,10);
                      const bg = isS||isE ? COLORS.accent2 : inR ? COLORS.accent2+"22" : "transparent";
                      const clr = isS||isE ? "#fff" : inR ? COLORS.accent2 : isToday ? COLORS.accent2 : COLORS.text;
                      return (
                        <div key={iso} onClick={()=>handleDay(iso)}
                          onMouseEnter={()=>desde&&!hasta&&setCalHover(iso)}
                          onMouseLeave={()=>setCalHover(null)}
                          style={{ textAlign:"center", padding:"5px 0", borderRadius:6, fontSize:12, fontWeight:isS||isE?700:400, background:bg, color:clr, cursor:"pointer", border:isToday&&!isS&&!isE?`1px solid ${COLORS.accent2}`:"1px solid transparent" }}>
                          {day}
                        </div>
                      );
                    })}
                  </div>
                  <div style={{ marginTop:10, fontSize:11, color:COLORS.textDim, textAlign:"center" }}>
                    {!desde ? "Selecciona la fecha inicial" : !hasta ? "Ahora selecciona la fecha final" : rangeLabel}
                  </div>
                  {rangeLabel && <div style={{ marginTop:6, fontSize:11, color:COLORS.accent2, fontWeight:600, textAlign:"center" }}>📅 {rangeLabel}</div>}
                  <div style={{ display:"flex", gap:6, marginTop:10 }}>
                    {[["Sem",()=>{const t=new Date();const d=t.getDay();const m=new Date(t);m.setDate(t.getDate()-(d===0?6:d-1));const s=new Date(m);s.setDate(m.getDate()+6);setDesde(m.toISOString().slice(0,10));setHasta(s.toISOString().slice(0,10));}],
                      ["Mes",()=>{const t=new Date();const f=new Date(t.getFullYear(),t.getMonth(),1);const l=new Date(t.getFullYear(),t.getMonth()+1,0);setDesde(f.toISOString().slice(0,10));setHasta(l.toISOString().slice(0,10));}],
                      ["Año",()=>{const y=new Date().getFullYear();setDesde(`${y}-01-01`);setHasta(`${y}-12-31`);}],
                    ].map(([lbl,fn])=>(
                      <button key={lbl} onClick={fn} style={{ flex:1, background:COLORS.bg, border:`1px solid ${COLORS.border}`, color:COLORS.textDim, borderRadius:6, padding:"4px 0", fontSize:11, cursor:"pointer" }}>{lbl}</button>
                    ))}
                  </div>
                </div>
              );
            })()}

            {(periodoTipo === "semana" || periodoTipo === "quincena") && (
              <div style={{ display:"flex", gap:6 }}>
                {[["actual", periodoTipo==="semana"?"Semana actual":"Quincena actual"],["pasada", periodoTipo==="semana"?"Semana pasada":"Quincena pasada"]].map(([v,l])=>(
                  <button key={v} onClick={()=>setSemanaRef(v)} style={{ flex:1, padding:"7px 0", borderRadius:8, fontSize:12, fontWeight:600, cursor:"pointer", border:`1px solid ${semanaRef===v ? COLORS.accent2 : COLORS.border}`, background:semanaRef===v ? "#eff6ff" : "transparent", color:semanaRef===v ? COLORS.accent2 : COLORS.textDim, transition:"all 0.15s" }}>{l}</button>
                ))}
              </div>
            )}

            {periodoLabel() && (
              <div style={{ marginTop:8, fontSize:11, color:COLORS.accent2, fontWeight:600 }}>📅 {periodoLabel()}</div>
            )}
          </div>
        </div>


          {/* Lista de clientes en el periodo seleccionado */}
          {(() => {
            let rowsPeriodo = [];
            if (periodoTipo === "rango" && desde && hasta) {
              rowsPeriodo = data.filter(r => r._fecha && r._fecha >= new Date(desde+"T00:00:00") && r._fecha <= new Date(hasta+"T23:59:59"));
            } else if (periodoTipo !== "rango") {
              const p = calcPeriodo();
              if (p) rowsPeriodo = data.filter(r => r._fecha && r._fecha >= p.d && r._fecha <= new Date(p.h.getTime() + 86399999));
            }
            if (rowsPeriodo.length === 0) return null;

            const clientesMap = {};
            rowsPeriodo.forEach(r => {
              const k = r._cliente || "Sin cliente";
              if (!clientesMap[k]) clientesMap[k] = { nombre: k, ops: 0, ingrC: 0 };
              clientesMap[k].ops += 1;
              clientesMap[k].ingrC += r._ingrC || 0;
            });
            const clientesList2 = Object.values(clientesMap).sort((a, b) => b.ingrC - a.ingrC);

            return (
              <div>
                <div style={{ fontSize:11, fontWeight:700, color:COLORS.textDim, textTransform:"uppercase", letterSpacing:"0.06em", marginBottom:6 }}>
                  Clientes en el periodo · {clientesList2.length} clientes · {rowsPeriodo.length} servicios
                </div>
                <div style={{ border:`1px solid ${COLORS.border}`, borderRadius:10, overflow:"hidden", maxHeight:200, overflowY:"auto" }}>
                  {clientesList2.map((c, i) => (
                    <div key={c.nombre} onClick={() => { setCliente(c.nombre); setClienteSearch(c.nombre); }}
                      style={{ padding:"8px 12px", borderBottom:`1px solid ${COLORS.border}`, display:"flex", justifyContent:"space-between", alignItems:"center", cursor:"pointer", background: cliente === c.nombre ? "#eff6ff" : i % 2 === 0 ? COLORS.card : "#f8fafc" }}
                      onMouseEnter={e => e.currentTarget.style.background = "#eff6ff"}
                      onMouseLeave={e => e.currentTarget.style.background = cliente === c.nombre ? "#eff6ff" : i % 2 === 0 ? COLORS.card : "#f8fafc"}>
                      <div style={{ display:"flex", alignItems:"center", gap:8 }}>
                        {cliente === c.nombre && <span style={{ color:COLORS.accent2, fontSize:12 }}>✓</span>}
                        <span style={{ fontSize:12, color:COLORS.text, fontWeight: cliente === c.nombre ? 700 : 400 }}>{c.nombre}</span>
                      </div>
                      <div style={{ display:"flex", gap:12, alignItems:"center" }}>
                        <span style={{ fontSize:11, color:COLORS.textDim }}>{c.ops} servicio{c.ops !== 1 ? "s" : ""}</span>
                        <span style={{ fontSize:11, fontFamily:"'DM Mono', monospace", color:COLORS.accent3 }}>
                          {new Intl.NumberFormat("es-MX",{style:"currency",currency:"MXN",minimumFractionDigits:0}).format(c.ingrC)}
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            );
          })()}
        <div style={{ padding:"16px 24px", borderTop:`1px solid ${COLORS.border}`, display:"flex", gap:10, justifyContent:"flex-end" }}>
          <button onClick={onClose} style={{ background:COLORS.bg, border:`1px solid ${COLORS.border}`, color:COLORS.textDim, borderRadius:8, padding:"9px 20px", fontSize:13, cursor:"pointer" }}>Cancelar</button>
          <button onClick={handleExport} style={{ background:COLORS.accent2, border:"none", color:"#fff", borderRadius:8, padding:"9px 24px", fontSize:13, fontWeight:700, cursor:"pointer" }}>
            ⬇ Generar Excel
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── DRILL-DOWN MODAL ─────────────────────────────────────────────────────────
function DrillModal({ modal, onClose }) {
  const [search, setSearch] = useState("");
  const [expanded, setExpanded] = useState({});
  const [viewMode, setViewMode] = useState("agrupado"); // agrupado | detalle

  if (!modal) return null;
  const { title, color, rows, columns, totals } = modal;

  const filtered = search.trim()
    ? rows.filter((r) => columns.some((c) => String(r[c.key] ?? "").toLowerCase().includes(search.toLowerCase())) || String(r._cliente || "").toLowerCase().includes(search.toLowerCase()) || String(r._proveedor || "").toLowerCase().includes(search.toLowerCase()))
    : rows;

  // Group by cliente or proveedor depending on modal config
  const groupBy = modal.groupBy || "cliente";
  const getGroupKey = (r) => groupBy === "proveedor" ? (r._proveedor || "Sin proveedor") : (r._cliente || "Sin cliente");
  const groupLabel = groupBy === "proveedor" ? "Proveedor" : "Cliente";

  const grouped = {};
  filtered.forEach((r) => {
    const k = getGroupKey(r);
    if (!grouped[k]) grouped[k] = { nombre: k, rows: [], ingrC: 0, egrsC: 0, margen: 0, ingrS: 0, egrsS: 0, margenS: 0 };
    grouped[k].rows.push(r);
    grouped[k].ingrC  += r._ingrC  || 0;
    grouped[k].egrsC  += r._egrsC  || 0;
    grouped[k].margen += r._margen || 0;
    grouped[k].ingrS  += r._ingrS  || 0;
    grouped[k].egrsS  += r._egrsS  || 0;
    grouped[k].margenS += r._margenS || 0;
  });
  const sortKey = groupBy === "proveedor" ? "egrsC" : "ingrC";
  const groupedList = Object.values(grouped).sort((a, b) => b[sortKey] - a[sortKey]);

  const toggleExpand = (k) => setExpanded((prev) => ({ ...prev, [k]: !prev[k] }));

  const fmtV = (n) => new Intl.NumberFormat("es-MX", { style: "currency", currency: "MXN", minimumFractionDigits: 0, maximumFractionDigits: 0 }).format(n || 0);
  const fmtS = (n) => {
    if (Math.abs(n) >= 1e6) return `$${(n/1e6).toFixed(2)}M`;
    if (Math.abs(n) >= 1e3) return `$${(n/1e3).toFixed(0)}K`;
    return fmtV(n);
  };

  return (
    <div onClick={onClose} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)", zIndex: 1000, display: "flex", alignItems: "center", justifyContent: "center", padding: 24, backdropFilter: "blur(4px)", animation: "fadeIn 0.15s ease" }}>
      <style>{`@keyframes fadeIn{from{opacity:0;transform:scale(0.97)}to{opacity:1;transform:scale(1)}}`}</style>
      <div onClick={(e) => e.stopPropagation()} style={{ background: COLORS.card, border: `1px solid ${color}44`, borderRadius: 16, width: "100%", maxWidth: 980, maxHeight: "85vh", display: "flex", flexDirection: "column", boxShadow: `0 24px 60px rgba(0,0,0,0.3), 0 0 0 1px ${color}33` }}>

        {/* Header */}
        <div style={{ padding: "16px 24px", borderBottom: `1px solid ${COLORS.border}`, display: "flex", alignItems: "center", justifyContent: "space-between", flexShrink: 0 }}>
          <div>
            <div style={{ fontSize: 14, fontWeight: 700, color: COLORS.text }}>{title}</div>
            <div style={{ fontSize: 11, color: COLORS.textDim, marginTop: 2 }}>
              {viewMode === "agrupado" ? `${groupedList.length} clientes · ${filtered.length} registros` : `${filtered.length} registros`}
              {search ? ` · filtrado por "${search}"` : ""}
            </div>
          </div>
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            {/* Toggle view */}
            <div style={{ display: "flex", background: COLORS.bg, borderRadius: 8, padding: 3, border: `1px solid ${COLORS.border}` }}>
              {[["agrupado","👥 Por cliente"],["detalle","📋 Detalle"]].map(([mode, label]) => (
                <button key={mode} onClick={() => setViewMode(mode)} style={{ padding: "4px 12px", borderRadius: 6, fontSize: 11, fontWeight: 600, cursor: "pointer", border: "none", background: viewMode === mode ? color : "transparent", color: viewMode === mode ? "#fff" : COLORS.textDim, transition: "all 0.15s" }}>{label}</button>
              ))}
            </div>
            <div style={{ position: "relative" }}>
              <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Buscar cliente, folio..." style={{ background: COLORS.bg, border: `1px solid ${COLORS.border}`, color: COLORS.text, borderRadius: 8, padding: "6px 12px 6px 30px", fontSize: 12, width: 190, outline: "none" }} />
              <span style={{ position: "absolute", left: 9, top: "50%", transform: "translateY(-50%)", color: COLORS.textDim, fontSize: 12 }}>🔍</span>
            </div>
            <button onClick={onClose} style={{ background: COLORS.bg, border: `1px solid ${COLORS.border}`, color: COLORS.textDim, borderRadius: 8, padding: "6px 12px", cursor: "pointer", fontSize: 13 }}>✕ Cerrar</button>
          </div>
        </div>

        {/* Body */}
        <div style={{ overflowY: "auto", flex: 1 }}>
          {viewMode === "agrupado" ? (
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
              <thead style={{ position: "sticky", top: 0, zIndex: 1 }}>
                <tr>
                  <th style={{ padding: "10px 14px", background: COLORS.bg, color: color, fontWeight: 600, fontSize: 10, textTransform: "uppercase", letterSpacing: "0.06em", textAlign: "left", borderBottom: `1px solid ${color}44`, width: 32 }}></th>
                  <th style={{ padding: "10px 14px", background: COLORS.bg, color: color, fontWeight: 600, fontSize: 10, textTransform: "uppercase", letterSpacing: "0.06em", textAlign: "left", borderBottom: `1px solid ${color}44` }}>{groupLabel}</th>
                  <th style={{ padding: "10px 14px", background: COLORS.bg, color: color, fontWeight: 600, fontSize: 10, textTransform: "uppercase", letterSpacing: "0.06em", textAlign: "right", borderBottom: `1px solid ${color}44` }}>Ops</th>
                  <th style={{ padding: "10px 14px", background: COLORS.bg, color: color, fontWeight: 600, fontSize: 10, textTransform: "uppercase", letterSpacing: "0.06em", textAlign: "right", borderBottom: `1px solid ${color}44` }}>Ingreso c/IVA</th>
                  <th style={{ padding: "10px 14px", background: COLORS.bg, color: color, fontWeight: 600, fontSize: 10, textTransform: "uppercase", letterSpacing: "0.06em", textAlign: "right", borderBottom: `1px solid ${color}44` }}>Egreso c/IVA</th>
                  <th style={{ padding: "10px 14px", background: COLORS.bg, color: color, fontWeight: 600, fontSize: 10, textTransform: "uppercase", letterSpacing: "0.06em", textAlign: "right", borderBottom: `1px solid ${color}44` }}>Margen c/IVA</th>
                  <th style={{ padding: "10px 14px", background: COLORS.bg, color: color, fontWeight: 600, fontSize: 10, textTransform: "uppercase", letterSpacing: "0.06em", textAlign: "right", borderBottom: `1px solid ${color}44` }}>Margen s/IVA</th>
                </tr>
              </thead>
              <tbody>
                {groupedList.map((g, gi) => (
                  <>
                    {/* Group row */}
                    <tr key={g.nombre} onClick={() => toggleExpand(g.nombre)} style={{ background: expanded[g.nombre] ? `${color}11` : gi % 2 === 0 ? COLORS.card : "#f8fafc", borderBottom: `1px solid ${COLORS.border}`, cursor: "pointer" }}
                      onMouseEnter={(e) => e.currentTarget.style.background = `${color}11`}
                      onMouseLeave={(e) => e.currentTarget.style.background = expanded[g.nombre] ? `${color}11` : gi % 2 === 0 ? COLORS.card : "#f8fafc"}>
                      <td style={{ padding: "9px 14px", textAlign: "center", fontSize: 12, color: color }}>{expanded[g.nombre] ? "▾" : "▸"}</td>
                      <td style={{ padding: "9px 14px", fontWeight: 600, color: COLORS.text, maxWidth: 220, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{g.nombre}</td>
                      <td style={{ padding: "9px 14px", textAlign: "right", color: COLORS.textDim }}>{g.rows.length}</td>
                      <td style={{ padding: "9px 14px", textAlign: "right", fontFamily: "'DM Mono', monospace", color: COLORS.accent3, fontWeight: 600 }}>{fmtS(g.ingrC)}</td>
                      <td style={{ padding: "9px 14px", textAlign: "right", fontFamily: "'DM Mono', monospace", color: COLORS.danger }}>{fmtS(g.egrsC)}</td>
                      <td style={{ padding: "9px 14px", textAlign: "right", fontFamily: "'DM Mono', monospace", color: g.margen >= 0 ? COLORS.accent3 : COLORS.danger }}>{fmtS(g.margen)}</td>
                      <td style={{ padding: "9px 14px", textAlign: "right", fontFamily: "'DM Mono', monospace", color: g.margenS >= 0 ? COLORS.accent2 : COLORS.danger }}>{fmtS(g.margenS)}</td>
                    </tr>
                    {/* Expanded detail rows */}
                    {expanded[g.nombre] && g.rows.map((row, i) => (
                      <tr key={`${g.nombre}-${i}`} style={{ background: "#f1f5f9", borderBottom: `1px solid ${COLORS.border}` }}>
                        <td style={{ padding: "7px 14px" }}></td>
                        {columns.map((c) => (
                          <td key={c.key} style={{ padding: "7px 14px", color: c.color ? c.color(row) : COLORS.textDim, textAlign: c.align || "left", fontFamily: c.mono ? "'DM Mono', monospace" : "inherit", fontSize: 11, whiteSpace: "nowrap", maxWidth: c.maxWidth || "none", overflow: "hidden", textOverflow: "ellipsis" }}>
                            {c.format ? c.format(row[c.key], row) : (row[c.key] ?? "—")}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </>
                ))}
                {groupedList.length === 0 && <tr><td colSpan={7} style={{ padding: 32, textAlign: "center", color: COLORS.textDim }}>Sin resultados</td></tr>}
              </tbody>
            </table>
          ) : (
            (() => {
              const byMes = {};
              filtered.forEach((r) => {
                const k = r._mes || 0;
                const label = MES_NAMES[k] || "Sin mes";
                if (!byMes[k]) byMes[k] = { mes: k, label, rows: [], ingrC: 0, egrsC: 0, margen: 0, ingrS: 0, egrsS: 0, margenS: 0 };
                byMes[k].rows.push(r);
                byMes[k].ingrC  += r._ingrC  || 0;
                byMes[k].egrsC  += r._egrsC  || 0;
                byMes[k].margen += r._margen || 0;
                byMes[k].ingrS  += r._ingrS  || 0;
                byMes[k].egrsS  += r._egrsS  || 0;
                byMes[k].margenS += r._margenS || 0;
              });
              const mesGroups = Object.values(byMes).sort((a, b) => a.mes - b.mes);
              const fmtS = (n) => { if(Math.abs(n)>=1e6) return `$${(n/1e6).toFixed(2)}M`; if(Math.abs(n)>=1e3) return `$${(n/1e3).toFixed(0)}K`; return `$${Math.round(n).toLocaleString("es-MX")}`; };

              return (
                <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
                  <thead style={{ position: "sticky", top: 0, zIndex: 1 }}>
                    <tr>
                      <th style={{ padding: "10px 14px", background: COLORS.bg, color: color, fontWeight: 600, fontSize: 10, textTransform: "uppercase", borderBottom: `1px solid ${color}44`, width: 32 }}></th>
                      <th style={{ padding: "10px 14px", background: COLORS.bg, color: color, fontWeight: 600, fontSize: 10, textTransform: "uppercase", letterSpacing: "0.06em", textAlign: "left", borderBottom: `1px solid ${color}44` }}>Mes</th>
                      <th style={{ padding: "10px 14px", background: COLORS.bg, color: color, fontWeight: 600, fontSize: 10, textTransform: "uppercase", letterSpacing: "0.06em", textAlign: "right", borderBottom: `1px solid ${color}44` }}>Ops</th>
                      <th style={{ padding: "10px 14px", background: COLORS.bg, color: color, fontWeight: 600, fontSize: 10, textTransform: "uppercase", letterSpacing: "0.06em", textAlign: "right", borderBottom: `1px solid ${color}44` }}>Ingreso c/IVA</th>
                      <th style={{ padding: "10px 14px", background: COLORS.bg, color: color, fontWeight: 600, fontSize: 10, textTransform: "uppercase", letterSpacing: "0.06em", textAlign: "right", borderBottom: `1px solid ${color}44` }}>Egreso c/IVA</th>
                      <th style={{ padding: "10px 14px", background: COLORS.bg, color: color, fontWeight: 600, fontSize: 10, textTransform: "uppercase", letterSpacing: "0.06em", textAlign: "right", borderBottom: `1px solid ${color}44` }}>Margen c/IVA</th>
                      <th style={{ padding: "10px 14px", background: COLORS.bg, color: color, fontWeight: 600, fontSize: 10, textTransform: "uppercase", letterSpacing: "0.06em", textAlign: "right", borderBottom: `1px solid ${color}44` }}>Margen s/IVA</th>
                    </tr>
                  </thead>
                  <tbody>
                    {mesGroups.map((mg, gi) => (
                      <>
                        <tr key={`mes-${mg.mes}`} onClick={() => toggleExpand(`mes-${mg.mes}`)}
                          style={{ background: expanded[`mes-${mg.mes}`] ? `${color}11` : gi % 2 === 0 ? COLORS.card : "#f8fafc", borderBottom: `1px solid ${COLORS.border}`, cursor: "pointer" }}
                          onMouseEnter={(e) => e.currentTarget.style.background = `${color}11`}
                          onMouseLeave={(e) => e.currentTarget.style.background = expanded[`mes-${mg.mes}`] ? `${color}11` : gi % 2 === 0 ? COLORS.card : "#f8fafc"}>
                          <td style={{ padding: "9px 14px", textAlign: "center", fontSize: 12, color: color }}>{expanded[`mes-${mg.mes}`] ? "▾" : "▸"}</td>
                          <td style={{ padding: "9px 14px", fontWeight: 600, color: COLORS.text }}>📅 {mg.label}</td>
                          <td style={{ padding: "9px 14px", textAlign: "right", color: COLORS.textDim }}>{mg.rows.length}</td>
                          <td style={{ padding: "9px 14px", textAlign: "right", fontFamily: "'DM Mono', monospace", color: COLORS.accent3, fontWeight: 600 }}>{fmtS(mg.ingrC)}</td>
                          <td style={{ padding: "9px 14px", textAlign: "right", fontFamily: "'DM Mono', monospace", color: COLORS.danger }}>{fmtS(mg.egrsC)}</td>
                          <td style={{ padding: "9px 14px", textAlign: "right", fontFamily: "'DM Mono', monospace", color: mg.margen >= 0 ? COLORS.accent3 : COLORS.danger }}>{fmtS(mg.margen)}</td>
                          <td style={{ padding: "9px 14px", textAlign: "right", fontFamily: "'DM Mono', monospace", color: mg.margenS >= 0 ? COLORS.accent2 : COLORS.danger }}>{fmtS(mg.margenS)}</td>
                        </tr>
                        {expanded[`mes-${mg.mes}`] && mg.rows.map((row, i) => (
                          <tr key={`${mg.mes}-${i}`} style={{ background: "#f1f5f9", borderBottom: `1px solid ${COLORS.border}` }}>
                            <td style={{ padding: "7px 14px" }}></td>
                            {columns.map((c) => (
                              <td key={c.key} style={{ padding: "7px 14px", color: c.color ? c.color(row) : COLORS.textDim, textAlign: c.align || "left", fontFamily: c.mono ? "'DM Mono', monospace" : "inherit", fontSize: 11, whiteSpace: "nowrap", maxWidth: c.maxWidth || "none", overflow: "hidden", textOverflow: "ellipsis" }}>
                                {c.format ? c.format(row[c.key], row) : (row[c.key] ?? "—")}
                              </td>
                            ))}
                          </tr>
                        ))}
                      </>
                    ))}
                    {mesGroups.length === 0 && <tr><td colSpan={7} style={{ padding: 32, textAlign: "center", color: COLORS.textDim }}>Sin resultados</td></tr>}
                  </tbody>
                </table>
              );
            })()
          )}
        </div>

        {/* Footer totals */}
        <div style={{ padding: "12px 24px", borderTop: `1px solid ${COLORS.border}`, display: "flex", gap: 24, flexShrink: 0, flexWrap: "wrap" }}>
          {totals && totals.map((t, i) => (
            <div key={i} style={{ fontSize: 12 }}>
              <span style={{ color: COLORS.textDim }}>{t.label}: </span>
              <span style={{ color: t.color || color, fontWeight: 700, fontFamily: "'DM Mono', monospace" }}>{t.value}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function SectionTitle({ children }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 16, marginTop: 8 }}>
      <div style={{ width: 3, height: 18, background: COLORS.accent, borderRadius: 2 }} />
      <span style={{ fontSize: 13, fontWeight: 600, color: COLORS.text, textTransform: "uppercase", letterSpacing: "0.06em" }}>{children}</span>
    </div>
  );
}

function StatusBadge({ status }) {
  const s = String(status || "").trim().toUpperCase();
  const cfg = {
    "PAGADO": { bg: "#dcfce7", color: "#059669", label: "Pagado" },
    "PAGADA": { bg: "#dcfce7", color: COLORS.accent3, label: "Pagado" },
    "SIN PAGAR": { bg: "#fee2e2", color: COLORS.danger, label: "Sin pagar" },
    " SIN PAGAR ": { bg: "#fee2e2", color: COLORS.danger, label: "Sin pagar" },
    "PAGADO PARCIALMENTE": { bg: "#fff7ed", color: "#f97316", label: "Pago parcial" },
    " NA ": { bg: "#f1f5f9", color: COLORS.muted, label: "N/A" },
    "NA": { bg: "#f1f5f9", color: COLORS.muted, label: "N/A" },
    "NO PAGADA": { bg: "#fee2e2", color: COLORS.danger, label: "Sin pagar" },
  };
  const c = cfg[s] || { bg: "#e2e8f0", color: COLORS.textDim, label: status || "—" };
  return (
    <span style={{ background: c.bg, color: c.color, borderRadius: 4, padding: "2px 8px", fontSize: 11, fontWeight: 600 }}>
      {c.label}
    </span>
  );
}

function ChartCard({ title, children, style = {} }) {
  return (
    <div style={{ background: COLORS.card, border: `1px solid ${COLORS.border}`, borderRadius: 12, padding: "20px", ...style }}>
      <div style={{ fontSize: 12, fontWeight: 600, color: COLORS.textDim, textTransform: "uppercase", letterSpacing: "0.07em", marginBottom: 16 }}>{title}</div>
      {children}
    </div>
  );
}

const TOOLTIP_STYLE = {
  contentStyle: { background: "#ffffff", border: `1px solid ${COLORS.border}`, borderRadius: 8, color: COLORS.text },
  labelStyle: { color: COLORS.textDim },
  formatter: (v) => [fmtShort(v), ""],
};

// ─── UPLOAD ZONE ─────────────────────────────────────────────────────────────
function UploadZone({ onFile, loading, error }) {
  const [drag, setDrag] = useState(false);
  const handle = useCallback((f) => { if (f) onFile(f); }, [onFile]);
  return (
    <div style={{
      minHeight: "100vh", background: COLORS.bg, display: "flex", alignItems: "center",
      justifyContent: "center", flexDirection: "column", gap: 20, padding: 40,
      fontFamily: "'Sora', sans-serif",
    }}>
      <link href="https://fonts.googleapis.com/css2?family=Sora:wght@300;400;500;600;700&family=DM+Mono:wght@400;500&display=swap" rel="stylesheet" />
      <div style={{ textAlign: "center", marginBottom: 8 }}>
        <div style={{ fontSize: 32, fontWeight: 700, color: COLORS.text, letterSpacing: "-0.02em" }}>
          🌸 Bromelia
        </div>
        <div style={{ fontSize: 14, color: COLORS.textDim, marginTop: 6 }}>
          Dashboard Financiero · Transportación · Protección Integral · Equipajes
        </div>
      </div>

      <div
        onDragOver={(e) => { e.preventDefault(); setDrag(true); }}
        onDragLeave={() => setDrag(false)}
        onDrop={(e) => { e.preventDefault(); setDrag(false); const f = e.dataTransfer.files[0]; if (f) handle(f); }}
        onClick={() => document.getElementById("xl-input").click()}
        style={{
          width: "100%", maxWidth: 460, border: `2px dashed ${drag ? COLORS.accent : COLORS.border}`,
          borderRadius: 16, padding: "48px 32px", textAlign: "center", cursor: "pointer",
          background: drag ? "#fffbeb" : COLORS.card, transition: "all 0.2s",
        }}
      >
        <div style={{ fontSize: 40, marginBottom: 12 }}>📂</div>
        <div style={{ fontSize: 15, fontWeight: 600, color: COLORS.text }}>
          {loading ? "Procesando archivo…" : "Arrastra tu archivo .xlsx aquí"}
        </div>
        <div style={{ fontSize: 12, color: COLORS.textDim, marginTop: 6 }}>
          o haz clic para seleccionar · actualizable por día o semana
        </div>
      </div>
      <input id="xl-input" type="file" accept=".xlsx,.xls" style={{ display: "none" }}
        onChange={(e) => handle(e.target.files[0])} />
      {error && <div style={{ color: COLORS.danger, fontSize: 13 }}>⚠ {error}</div>}
    </div>
  );
}

// ─── MAIN DASHBOARD ──────────────────────────────────────────────────────────
function Dashboard({ data, fileName, onReset, onUpload }) {
  const [activeService, setActiveService] = useState("TODOS");
  const [filterMes, setFilterMes] = useState("TODOS");
  const [filterDestino, setFilterDestino] = useState("TODOS");
  const [filterFechaDesde, setFilterFechaDesde] = useState("");
  const [filterFechaHasta, setFilterFechaHasta] = useState("");
  const [showDatePicker, setShowDatePicker] = useState(false);
  const calState = useState(new Date().getFullYear());
  const calMonthState = useState(new Date().getMonth());
  const hoverState = useState(null);
  const [filterCliente, setFilterCliente] = useState("TODOS");
  const [clienteSearch, setClienteSearch] = useState("");
  const [activeView, setActiveView] = useState("overview");
  const [activeModule, setActiveModule] = useState("mando"); // mando | financiero | operativo
  const [modal, setModal] = useState(null);
  const [globalSearch, setGlobalSearch] = useState("");
  const [filterWeek, setFilterWeek] = useState("TODOS"); // TODOS | LASTWEEK | THISWEEK
  const [osSearch, setOsSearch] = useState("");
  const [osSearchInput, setOsSearchInput] = useState("");
  const [arSubTab, setArSubTab] = useState("sinFacturar"); // facturado | sinFacturar
  const [expApProv, setExpApProv] = useState({});
  const [expArCli, setExpArCli] = useState({});
  const [expOpsGrp, setExpOpsGrp] = useState({});
  const [showReporteModal, setShowReporteModal] = useState(false);

  // Compute week boundaries dynamically
  const weekBounds = useMemo(() => {
    const today = new Date();
    const dow = today.getDay(); // 0=Sun
    const diffToMon = (dow === 0 ? -6 : 1 - dow);
    const thisMonday = new Date(today); thisMonday.setHours(0,0,0,0); thisMonday.setDate(today.getDate() + diffToMon);
    const thisSunday = new Date(thisMonday); thisSunday.setDate(thisMonday.getDate() + 6); thisSunday.setHours(23,59,59,999);
    const lastMonday = new Date(thisMonday); lastMonday.setDate(thisMonday.getDate() - 7);
    const lastSunday = new Date(thisMonday); lastSunday.setDate(thisMonday.getDate() - 1); lastSunday.setHours(23,59,59,999);
    const yesterday = new Date(today); yesterday.setDate(today.getDate() - 1); yesterday.setHours(0,0,0,0);
    const yesterdayEnd = new Date(yesterday); yesterdayEnd.setHours(23,59,59,999);
    return { thisMonday, thisSunday, lastMonday, lastSunday, yesterday, yesterdayEnd };
  }, []);

  const meses = useMemo(() => [...new Set(data.map((r) => r._mes).filter(Boolean))].sort((a, b) => a - b), [data]);
  const destinos = useMemo(() => [...new Set(data.map((r) => r._destino).filter(Boolean))].sort(), [data]);
  const servicios = useMemo(() => [...new Set(data.map((r) => r._servicio).filter(Boolean))].sort(), [data]);

  // All unique clients sorted by total income for the dropdown
  const clientesList = useMemo(() => {
    const m = {};
    data.forEach((r) => {
      const k = r._cliente;
      if (!k) return;
      if (!m[k]) m[k] = { nombre: k, ingrC: 0, ops: 0 };
      m[k].ingrC += r._ingrC;
      m[k].ops += 1;
    });
    return Object.values(m).sort((a, b) => b.ingrC - a.ingrC);
  }, [data]);

  const clientesFiltrados = useMemo(() =>
    clienteSearch.trim()
      ? clientesList.filter((c) => c.nombre.toLowerCase().includes(clienteSearch.toLowerCase()))
      : clientesList
  , [clientesList, clienteSearch]);

  const filtered = useMemo(() => data.filter((r) => {
    if (activeService !== "TODOS" && r._servicio !== activeService) return false;
    if (filterMes !== "TODOS" && r._mes !== parseInt(filterMes)) return false;
    if (filterDestino !== "TODOS" && r._destino !== filterDestino) return false;
    if (filterCliente !== "TODOS" && r._cliente !== filterCliente) return false;
    if (filterWeek === "YESTERDAY" && r._fecha) {
      if (r._fecha < weekBounds.yesterday || r._fecha > weekBounds.yesterdayEnd) return false;
    }
    if (filterWeek === "LASTWEEK" && r._fecha) {
      if (r._fecha < weekBounds.lastMonday || r._fecha > weekBounds.lastSunday) return false;
    }
    if (filterWeek === "THISWEEK" && r._fecha) {
      if (r._fecha < weekBounds.thisMonday || r._fecha > weekBounds.thisSunday) return false;
    }
    if (filterFechaDesde && r._fecha) {
      const desde = new Date(filterFechaDesde + "T00:00:00");
      if (r._fecha < desde) return false;
    }
    if (filterFechaHasta && r._fecha) {
      const hasta = new Date(filterFechaHasta + "T23:59:59");
      if (r._fecha > hasta) return false;
    }
    return true;
  }), [data, activeService, filterMes, filterDestino, filterCliente, filterWeek, weekBounds, filterFechaDesde, filterFechaHasta]);

  // Global search across filtered data
  const searchActive = globalSearch.trim().length > 0;
  const searchResults = useMemo(() => {
    if (!searchActive) return [];
    const q = globalSearch.toLowerCase();
    return filtered.filter((r) =>
      (r._cliente && r._cliente.toLowerCase().includes(q)) ||
      (r._os && r._os.toLowerCase().includes(q)) ||
      (r._facturaProv && r._facturaProv.toLowerCase().includes(q)) ||
      (r._facturaCliente && r._facturaCliente.toLowerCase().includes(q)) ||
      (r._proveedor && r._proveedor.toLowerCase().includes(q)) ||
      (r["VUELO"] && String(r["VUELO"]).toLowerCase().includes(q)) ||
      (r._destino && r._destino.toLowerCase().includes(q)) ||
      (r._servicio && r._servicio.toLowerCase().includes(q))
    );
  }, [globalSearch, filtered, searchActive]);

  // KPIs
  const kpis = useMemo(() => {
    const ingrC = filtered.reduce((s, r) => s + r._ingrC, 0);
    const ingrS = filtered.reduce((s, r) => s + r._ingrS, 0);
    const egrsC = filtered.reduce((s, r) => s + r._egrsC, 0);
    const egrsS = filtered.reduce((s, r) => s + r._egrsS, 0);
    const margen = filtered.reduce((s, r) => s + r._margen, 0);
    const margenS = filtered.reduce((s, r) => s + r._margenS, 0);
    const ops = filtered.length;
    return { ingrC, ingrS, egrsC, egrsS, margen, margenS, ops };
  }, [filtered]);

  // Monthly chart
  const monthlyData = useMemo(() => {
    const m = {};
    filtered.forEach((r) => {
      if (!r._mes) return;
      const k = r._mes;
      if (!m[k]) m[k] = { mes: MES_NAMES[k], ingreso: 0, egreso: 0, margen: 0 };
      m[k].ingreso += r._ingrC;
      m[k].egreso += r._egrsC;
      m[k].margen += r._margen;
    });
    return Object.values(m).sort((a, b) => MES_NAMES.indexOf(a.mes) - MES_NAMES.indexOf(b.mes));
  }, [filtered]);

  // By service
  const byService = useMemo(() => {
    const m = {};
    filtered.forEach((r) => {
      const k = r._servicio;
      if (!k || k === "x") return;
      if (!m[k]) m[k] = { svc: k, name: SERVICE_MAP[k] || k, ingreso: 0, egreso: 0, ops: 0 };
      m[k].ingreso += r._ingrC;
      m[k].egreso += r._egrsC;
      m[k].ops += 1;
    });
    return Object.values(m);
  }, [filtered]);

  // By destino
  const byDestino = useMemo(() => {
    const m = {};
    filtered.forEach((r) => {
      const k = r._destino;
      if (!k || k === "X") return;
      if (!m[k]) m[k] = { name: DEST_MAP[k] || k, ingreso: 0, ops: 0 };
      m[k].ingreso += r._ingrC;
      m[k].ops += 1;
    });
    return Object.values(m).sort((a, b) => b.ingreso - a.ingreso);
  }, [filtered]);

  // By cliente top 10
  const byCliente = useMemo(() => {
    const m = {};
    filtered.forEach((r) => {
      const k = String(r._cliente || "").trim();
      if (!k) return;
      if (!m[k]) m[k] = { name: k, ingreso: 0, ops: 0 };
      m[k].ingreso += r._ingrC;
      m[k].ops += 1;
    });
    return Object.values(m).sort((a, b) => b.ingreso - a.ingreso).slice(0, 10);
  }, [filtered]);

  // AP: cuentas por pagar (proveedor sin pagar)
  const ap = useMemo(() => filtered
    .filter((r) => r._estadoProv.includes("SIN PAGAR"))
    .sort((a, b) => b._egrsC - a._egrsC), [filtered]);

  const apTotal = useMemo(() => ap.reduce((s, r) => s + r._egrsC, 0), [ap]);
  const apSTotal = useMemo(() => ap.reduce((s, r) => s + r._egrsS, 0), [ap]);

  // AR: todos los registros pendientes de pago — usa _estadoCli que ya normaliza vacíos a SIN PAGAR
  const ar = useMemo(() => filtered.filter((r) => {
    return r._estadoCli === "SIN PAGAR" || r._estadoCli === "PAGADO PARCIALMENTE";
  }).sort((a, b) => b._ingrC - a._ingrC), [filtered]);

  const arFacturado = useMemo(() => ar.filter((r) => {
    const f = String(r._facturaCliente || "").trim().toLowerCase();
    return f !== "" && f !== "nan" && f !== "x" && f !== "na" && f !== "n/a";
  }), [ar]);

  // AR sin facturar: sin FACTURA CLIENTE, sin filtro de estado (todos los que no tienen folio)
  const arSinFacturar = useMemo(() => filtered.filter((r) => {
    const f = String(r._facturaCliente || "").trim().toLowerCase();
    return f === "" || f === "nan" || f === "x" || f === "na" || f === "n/a";
  }).sort((a, b) => b._ingrC - a._ingrC), [filtered]);

  const arTotal = useMemo(() => arFacturado.reduce((s, r) => s + r._ingrC, 0), [arFacturado]);
  const arSinFacturarTotal = useMemo(() => arSinFacturar.reduce((s, r) => s + r._ingrC, 0), [arSinFacturar]);

  // Ops table
  const ops = useMemo(() => filtered.filter((r) => r._os).slice(0, 200), [filtered]);

  // OS search
  const allWithOS = useMemo(() => data.filter((r) => r._os && typeof r._os === "string" && r._os.trim() !== ""), [data]);
  const osResults = useMemo(() => {
    const q = osSearch.trim().toLowerCase();
    if (!q) return [];
    return allWithOS.filter((r) => (r._os || "").toLowerCase().includes(q));
  }, [osSearch, allWithOS]);

  const fmtDate = (r) => r._fecha ? r._fecha.toLocaleDateString("es-MX", { day: "2-digit", month: "short", year: "2-digit" }) : "—";
  const svcBadge = (r) => SERVICE_MAP[r._servicio] || r._servicio || "—";
  const dstLabel = (r) => DEST_MAP[r._destino] || r._destino || "—";

  const BASE_COLS = [
    { key: "_os", label: "OS", color: () => COLORS.accent2, mono: true },
    { key: "_fecha", label: "Fecha", format: (_, r) => fmtDate(r) },
    { key: "_servicio", label: "Servicio", format: (_, r) => svcBadge(r), color: (r) => r._servicio === "TRANSPORTE" ? COLORS.transporte : r._servicio === "PROTECCION" ? COLORS.proteccion : r._servicio === "RENTAS" ? COLORS.rentas : r._servicio === "CIRCUITOS" ? COLORS.circuitos : COLORS.equipajes },
    { key: "_destino", label: "Destino", format: (_, r) => dstLabel(r), color: () => COLORS.textDim },
    { key: "_cliente", label: "Cliente", maxWidth: 200, wrap: true },
    { key: "VUELO", label: "Vuelo", color: () => COLORS.textDim },
  ];

  const openModal = useCallback((type) => {
    const INGR_COLS = [...BASE_COLS,
      { key: "_ingrC", label: "Ingreso c/IVA", align: "right", mono: true, color: () => COLORS.accent3, format: (v) => fmt(v) },
      { key: "_ingrS", label: "Ingreso s/IVA", align: "right", mono: true, color: () => COLORS.textDim, format: (v) => fmt(v) },
      { key: "_estadoCli", label: "Estado", format: (v) => v || "—", color: (r) => r._estadoCli.includes("NO PAGADA") ? COLORS.danger : COLORS.accent3 },
    ];
    const EGRS_COLS = [...BASE_COLS,
      { key: "_proveedor", label: "Proveedor", maxWidth: 180, wrap: true },
      { key: "_facturaProv", label: "Factura Prov.", color: () => COLORS.accent, mono: true },
      { key: "_egrsC", label: "Egreso c/IVA", align: "right", mono: true, color: () => COLORS.danger, format: (v) => fmt(v) },
      { key: "_egrsS", label: "Egreso s/IVA", align: "right", mono: true, color: () => COLORS.textDim, format: (v) => fmt(v) },
    ];
    const MARGEN_COLS = [...BASE_COLS,
      { key: "_ingrC", label: "Ingreso c/IVA", align: "right", mono: true, color: () => COLORS.accent3, format: (v) => fmt(v) },
      { key: "_ingrS", label: "Ingreso s/IVA", align: "right", mono: true, color: () => COLORS.textDim, format: (v) => fmt(v) },
      { key: "_egrsC", label: "Egreso c/IVA", align: "right", mono: true, color: () => COLORS.danger, format: (v) => fmt(v) },
      { key: "_egrsS", label: "Egreso s/IVA", align: "right", mono: true, color: () => COLORS.textDim, format: (v) => fmt(v) },
      { key: "_margen", label: "Margen c/IVA", align: "right", mono: true, color: (r) => r._margen >= 0 ? COLORS.accent3 : COLORS.danger, format: (v) => fmt(v) },
      { key: "_margenS", label: "Margen s/IVA", align: "right", mono: true, color: (r) => r._margenS >= 0 ? COLORS.accent2 : COLORS.danger, format: (v) => fmt(v) },
    ];

    const configs = {
      ingrc: {
        title: "Desglose · Ingresos con IVA", color: COLORS.accent3,
        rows: [...filtered].sort((a, b) => b._ingrC - a._ingrC),
        columns: INGR_COLS,
        totals: [
          { label: "Total Ingresos c/IVA", value: fmt(filtered.reduce((s, r) => s + r._ingrC, 0)), color: COLORS.accent3 },
          { label: "Total Ingresos s/IVA", value: fmt(filtered.reduce((s, r) => s + r._ingrS, 0)), color: COLORS.textDim },
          { label: "Registros", value: filtered.length },
        ],
      },
      egrsc: {
        title: "Desglose · Egresos con IVA", color: COLORS.danger,
        rows: [...filtered].filter((r) => r._egrsC > 0).sort((a, b) => b._egrsC - a._egrsC),
        columns: EGRS_COLS,
        groupBy: "proveedor",
        totals: [
          { label: "Total Egresos c/IVA", value: fmt(filtered.reduce((s, r) => s + r._egrsC, 0)), color: COLORS.danger },
          { label: "Total Egresos s/IVA", value: fmt(filtered.reduce((s, r) => s + r._egrsS, 0)), color: COLORS.textDim },
        ],
      },
      margen: {
        title: "Desglose · Margen Bruto", color: COLORS.accent,
        rows: [...filtered].sort((a, b) => b._margenS - a._margenS),
        columns: MARGEN_COLS,
        totals: [
          { label: "Margen c/IVA", value: fmt(filtered.reduce((s, r) => s + r._margen, 0)), color: COLORS.accent },
          { label: "Margen s/IVA", value: fmt(filtered.reduce((s, r) => s + r._margenS, 0)), color: COLORS.accent2 },
          { label: "% Margen s/IVA", value: `${filtered.reduce((s, r) => s + r._ingrS, 0) > 0 ? ((filtered.reduce((s, r) => s + r._margenS, 0) / filtered.reduce((s, r) => s + r._ingrS, 0)) * 100).toFixed(1) : 0}%`, color: COLORS.accent },
        ],
      },
      cxc: {
        title: "Desglose · Por Cobrar — Facturado sin pagar", color: COLORS.danger,
        rows: [...arFacturado].sort((a, b) => b._ingrC - a._ingrC),
        columns: INGR_COLS,
        totals: [
          { label: "Total c/IVA", value: fmt(arTotal), color: COLORS.danger },
          { label: "Total s/IVA", value: fmt(arFacturado.reduce((s, r) => s + r._ingrS, 0)), color: COLORS.textDim },
          { label: "Registros", value: arFacturado.length },
        ],
      },
      cxcSinFacturar: {
        title: "Desglose · Por Facturar — Pendiente de facturar", color: "#f97316",
        rows: [...arSinFacturar].sort((a, b) => b._ingrC - a._ingrC),
        columns: INGR_COLS,
        totals: [
          { label: "Total c/IVA", value: fmt(arSinFacturarTotal), color: "#f97316" },
          { label: "Total s/IVA", value: fmt(arSinFacturar.reduce((s, r) => s + r._ingrS, 0)), color: COLORS.textDim },
          { label: "Registros", value: arSinFacturar.length },
        ],
      },
      cxp: {
        title: "Desglose · Cuentas por Pagar (Sin Pagar)", color: COLORS.accent2,
        rows: [...ap].sort((a, b) => b._egrsC - a._egrsC),
        columns: EGRS_COLS,
        groupBy: "proveedor",
        totals: [
          { label: "CxP Total c/IVA", value: fmt(apTotal), color: COLORS.accent2 },
          { label: "CxP Total s/IVA", value: fmt(apSTotal), color: COLORS.textDim },
          { label: "Proveedores", value: new Set(ap.map((r) => r._proveedor)).size },
          { label: "Registros pendientes", value: ap.length },
        ],
      },
      ops: {
        title: "Desglose · Todas las Operaciones", color: COLORS.muted,
        rows: [...filtered].sort((a, b) => (b._fecha || 0) - (a._fecha || 0)),
        columns: [
          ...BASE_COLS,
          { key: "_ingrC", label: "Ingreso c/IVA", align: "right", mono: true, color: () => COLORS.accent3, format: (v) => fmt(v) },
          { key: "_egrsC", label: "Egreso c/IVA", align: "right", mono: true, color: () => COLORS.danger, format: (v) => fmt(v) },
          { key: "_margen", label: "Margen", align: "right", mono: true, color: (r) => r._margen >= 0 ? COLORS.accent3 : COLORS.danger, format: (v) => fmt(v) },
        ],
        totals: [
          { label: "Total operaciones", value: filtered.length },
          ...["TRANSPORTE","PROTECCION","EQUIPAJES","RENTAS","CIRCUITOS"].flatMap((svc) => {
            const rows = filtered.filter((r) => r._servicio === svc);
            if (rows.length === 0) return [];
            const colors = { TRANSPORTE: COLORS.transporte, PROTECCION: COLORS.proteccion, EQUIPAJES: COLORS.equipajes, RENTAS: COLORS.rentas, CIRCUITOS: COLORS.circuitos };
            if (svc === "PROTECCION") {
              const count = new Set(rows.map((r) => r._os).filter(Boolean)).size;
              return [{ label: "Protección (OS únicas)", value: count, color: colors[svc] }];
            }
            if (svc === "CIRCUITOS") {
              const circuitos = rows.filter((r) => String(r["TIPO DE SERVICIO"] || "").trim().toUpperCase() === "CIRCUITO").length;
              const interhoteles = rows.filter((r) => ["INTER HOTEL","INTER-HOTEL","INTER - HOTEL"].includes(String(r["TIPO DE SERVICIO"] || "").trim().toUpperCase())).length;
              const result = [];
              if (circuitos > 0) result.push({ label: "Circuitos", value: circuitos, color: colors[svc] });
              if (interhoteles > 0) result.push({ label: "Interhoteles", value: interhoteles, color: COLORS.accent2 });
              return result;
            }
            return [{ label: SERVICE_MAP[svc] || svc, value: rows.length, color: colors[svc] }];
          }),
        ],
      },
    };
    setModal(configs[type]);
  }, [filtered, ar, ap, arTotal, apTotal]);

  const PIE_COLORS = [COLORS.transporte, COLORS.proteccion, COLORS.equipajes, COLORS.rentas, COLORS.circuitos];
  const SVC_COLOR_MAP = { TRANSPORTE: COLORS.transporte, PROTECCION: COLORS.proteccion, EQUIPAJES: COLORS.equipajes, RENTAS: COLORS.rentas, CIRCUITOS: COLORS.circuitos };

  const handleExport = useCallback(() => {
    const wb = XLSX.utils.book_new();

    // ── HOJA 1: RESUMEN ──────────────────────────────────────────────────
    const resumenRows = [
      ["BROMELIA – DASHBOARD FINANCIERO", "", "", "", "", ""],
      [`Archivo: ${fileName}`, "", "", "", "", ""],
      [`Filtros: Servicio=${activeService}, Mes=${filterMes === "TODOS" ? "Todos" : MES_NAMES[parseInt(filterMes)]}, Destino=${filterDestino}`],
      [],
      ["KPI", "Valor"],
      ["Ingresos con IVA", kpis.ingrC],
      ["Ingresos sin IVA", kpis.ingrS],
      ["Egresos con IVA", kpis.egrsC],
      ["Egresos sin IVA", kpis.egrsS],
      ["Margen Bruto", kpis.margen],
      ["% Margen", kpis.ingrC > 0 ? kpis.margen / kpis.ingrC : 0],
      ["CxC Pendiente", arTotal],
      ["CxP Pendiente", apTotal],
      ["Total Operaciones", kpis.ops],
      [],
      ["POR TIPO DE SERVICIO", "", "", "", "", ""],
      ["Servicio", "Operaciones", "Ingreso c/IVA", "Ingreso s/IVA", "Egreso c/IVA", "Egreso s/IVA", "Margen Bruto"],
      ...servicios.filter((s) => s !== "x").map((svc) => {
        const rows = filtered.filter((r) => r._servicio === svc);
        return [
          SERVICE_MAP[svc] || svc,
          rows.length,
          rows.reduce((s, r) => s + r._ingrC, 0),
          rows.reduce((s, r) => s + r._ingrS, 0),
          rows.reduce((s, r) => s + r._egrsC, 0),
          rows.reduce((s, r) => s + r._egrsS, 0),
          rows.reduce((s, r) => s + r._margen, 0),
        ];
      }),
      [],
      ["POR DESTINO", "", ""],
      ["Destino", "Operaciones", "Ingreso c/IVA"],
      ...byDestino.map((d) => [d.name, d.ops, d.ingreso]),
      [],
      ["TOP 10 CLIENTES", "", ""],
      ["Cliente", "Operaciones", "Ingreso c/IVA"],
      ...byCliente.map((c) => [c.name, c.ops, c.ingreso]),
      [],
      ["POR MES", "", "", ""],
      ["Mes", "Ingreso c/IVA", "Egreso c/IVA", "Margen Bruto"],
      ...monthlyData.map((m) => [m.mes, m.ingreso, m.egreso, m.margen]),
    ];
    const wsResumen = XLSX.utils.aoa_to_sheet(resumenRows);
    wsResumen["!cols"] = [{ wch: 35 }, { wch: 18 }, { wch: 18 }, { wch: 18 }, { wch: 18 }, { wch: 18 }, { wch: 18 }];
    XLSX.utils.book_append_sheet(wb, wsResumen, "Resumen");

    // ── HOJA 2: CxP ──────────────────────────────────────────────────────
    const apHeader = ["SO", "Fecha", "Mes", "Servicio", "Destino", "Proveedor", "Factura Proveedor", "Egreso c/IVA", "Egreso s/IVA", "Estado Proveedor"];
    const apData = ap.map((r) => [
      r._os || "",
      r._fecha ? r._fecha.toLocaleDateString("es-MX") : "",
      r._mes ? MES_NAMES[r._mes] : "",
      SERVICE_MAP[r._servicio] || r._servicio || "",
      DEST_MAP[r._destino] || r._destino || "",
      r._proveedor || "",
      r._facturaProv || "",
      r._egrsC,
      r._egrsS,
      String(r["ESTADO PROVEEDOR"] || "").trim(),
    ]);
    const wsCxP = XLSX.utils.aoa_to_sheet([
      [`CxP TOTAL: ${fmt(apTotal)} | ${ap.length} registros`],
      [],
      apHeader,
      ...apData,
    ]);
    wsCxP["!cols"] = [8,12,6,20,14,28,22,16,16,14].map((w) => ({ wch: w }));
    XLSX.utils.book_append_sheet(wb, wsCxP, "CxP - Cuentas x Pagar");

    // ── HOJA 3: CxC ──────────────────────────────────────────────────────
    const arHeader = ["SO", "Fecha", "Mes", "Servicio", "Destino", "Cliente", "Vuelo", "Factura Cliente", "Ingreso c/IVA", "Ingreso s/IVA", "Estado Cliente"];
    const arData = ar.map((r) => [
      r._os || "",
      r._fecha ? r._fecha.toLocaleDateString("es-MX") : "",
      r._mes ? MES_NAMES[r._mes] : "",
      SERVICE_MAP[r._servicio] || r._servicio || "",
      DEST_MAP[r._destino] || r._destino || "",
      r._cliente || "",
      r["VUELO"] || "",
      r._facturaCliente || "",
      r._ingrC,
      r._ingrS,
      String(r["ESTADO CLIENTE"] || "").trim(),
    ]);
    const wsCxC = XLSX.utils.aoa_to_sheet([
      [`CxC TOTAL: ${fmt(arTotal)} | ${ar.length} registros`],
      [],
      arHeader,
      ...arData,
    ]);
    wsCxC["!cols"] = [8,12,6,20,14,28,10,20,16,16,14].map((w) => ({ wch: w }));
    XLSX.utils.book_append_sheet(wb, wsCxC, "CxC - Cuentas x Cobrar");

    // ── HOJA 4: OPERACIONES ───────────────────────────────────────────────
    const opsHeader = ["SO", "Fecha In", "Fecha Out", "Mes", "Servicio", "Tipo de Servicio", "Destino", "Cliente", "Vuelo", "PAX", "Proveedor", "Factura Prov.", "Ingreso c/IVA", "Ingreso s/IVA", "Egreso c/IVA", "Egreso s/IVA", "Margen Bruto", "Estado Proveedor", "Estado Cliente"];
    const opsData = filtered.map((r) => [
      r._os || "",
      r._fecha ? r._fecha.toLocaleDateString("es-MX") : "",
      r["FECHA OUT"] ? new Date(r["FECHA OUT"]).toLocaleDateString("es-MX") : "",
      r._mes ? MES_NAMES[r._mes] : "",
      SERVICE_MAP[r._servicio] || r._servicio || "",
      r["TIPO DE SERVICIO"] || "",
      DEST_MAP[r._destino] || r._destino || "",
      r._cliente || "",
      r["VUELO"] || "",
      r["ADULTOS"] || "",
      r._proveedor || "",
      r._facturaProv || "",
      r._ingrC,
      r._ingrS,
      r._egrsC,
      r._egrsS,
      r._margen,
      String(r["ESTADO PROVEEDOR"] || "").trim(),
      String(r["ESTADO CLIENTE"] || "").trim(),
    ]);
    const wsOps = XLSX.utils.aoa_to_sheet([opsHeader, ...opsData]);
    wsOps["!cols"] = [8,12,12,6,20,16,14,28,10,5,28,20,16,16,16,16,16,14,14].map((w) => ({ wch: w }));
    XLSX.utils.book_append_sheet(wb, wsOps, "Operaciones");

    const date = new Date().toISOString().slice(0, 10);
    XLSX.writeFile(wb, `Bromelia_Dashboard_${date}.xlsx`);
  }, [filtered, ap, ar, kpis, arTotal, apTotal, byDestino, byCliente, monthlyData, servicios, activeService, filterMes, filterDestino, fileName]);



  const SELECT_STYLE = {
    background: "#e2e8f0", border: `1px solid ${COLORS.border}`, color: COLORS.text,
    borderRadius: 8, padding: "6px 12px", fontSize: 12, cursor: "pointer",
  };

  const TAB_STYLE = (active) => ({
    padding: "8px 16px", borderRadius: 8, fontSize: 12, fontWeight: 600, cursor: "pointer",
    background: active ? COLORS.accent : "transparent",
    color: active ? "#000" : COLORS.textDim,
    border: active ? "none" : `1px solid ${COLORS.border}`,
    transition: "all 0.15s",
  });

  const SVCBTN_STYLE = (svc) => ({
    padding: "6px 14px", borderRadius: 6, fontSize: 12, fontWeight: 500, cursor: "pointer",
    background: activeService === svc ? (svc === "TRANSPORTE" ? COLORS.transporte : svc === "PROTECCION" ? COLORS.proteccion : svc === "EQUIPAJES" ? COLORS.equipajes : svc === "RENTAS" ? COLORS.rentas : svc === "CIRCUITOS" ? COLORS.circuitos : COLORS.accent) : COLORS.card,
    color: activeService === svc ? "#fff" : COLORS.textDim,
    border: `1px solid ${activeService === svc ? "transparent" : COLORS.border}`,
    transition: "all 0.15s",
  });

  return (
    <div style={{ background: COLORS.bg, minHeight: "100vh", fontFamily: "'Sora', sans-serif", color: COLORS.text }}>
      <link href="https://fonts.googleapis.com/css2?family=Sora:wght@300;400;500;600;700&family=DM+Mono:wght@400;500&display=swap" rel="stylesheet" />

      {/* HEADER */}
      <div style={{ background: "#ffffff", borderBottom: "1px solid #e2e8f0", padding: "14px 28px", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <span style={{ fontSize: 20 }}>🌸</span>
          <div>
            <div style={{ fontSize: 16, fontWeight: 700, letterSpacing: "-0.01em" }}>Bromelia · Dashboard Financiero</div>
            <div style={{ fontSize: 11, color: COLORS.textDim }}>{fileName} · {data.length.toLocaleString()} registros</div>
          </div>
        </div>
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <button onClick={() => setShowReporteModal(true)} style={{ ...SVCBTN_STYLE(null), fontSize: 11, background: "#eff6ff", color: COLORS.accent2, border: `1px solid ${COLORS.accent2}` }}>
            📋 Reporte Cliente
          </button>
          <button onClick={handleExport} style={{ ...SVCBTN_STYLE(null), fontSize: 11, background: "#dcfce7", color: COLORS.accent3, border: `1px solid ${COLORS.accent3}` }}>
            ⬇ Exportar Excel
          </button>
          <button onClick={onReset} style={{ ...SVCBTN_STYLE(null), fontSize: 11 }}>🔄 Recargar</button>
          <button onClick={() => document.getElementById("brom-upload-input").click()} style={{ ...SVCBTN_STYLE(null), fontSize: 11, background: "#fefce8", color: "#a16207", border: "1px solid #facc15" }}>📤 Subir Excel</button>
          <input id="brom-upload-input" type="file" accept=".xlsx,.xls" style={{ display: "none" }} onChange={e => { if (e.target.files[0] && onUpload) onUpload(e.target.files[0]); e.target.value = ""; }} />
        </div>
      </div>

      {/* FILTERS + SEARCH */}
      <div style={{ padding: "14px 28px", display: "flex", gap: 10, flexWrap: "wrap", borderBottom: `1px solid ${COLORS.border}`, alignItems: "center" }}>
        <div style={{ display: "flex", gap: 6 }}>
          {["TODOS", ...servicios.filter((s) => s !== "x")].map((s) => (
            <button key={s} onClick={() => setActiveService(s)} style={SVCBTN_STYLE(s)}>
              {s === "TODOS" ? "Todos" : (SERVICE_MAP[s] || s)}
            </button>
          ))}
        </div>

        {/* Week quick filters */}
        <div style={{ display: "flex", gap: 4, background: COLORS.bg, borderRadius: 8, padding: 3, border: `1px solid ${COLORS.border}` }}>
          {[["TODOS","Todo el periodo"],["YESTERDAY","Ayer"],["LASTWEEK","Sem. pasada"],["THISWEEK","Sem. actual"]].map(([val, label]) => (
            <button key={val} onClick={() => { setFilterWeek(val); if (val !== "TODOS") setFilterMes("TODOS"); }}
              style={{ padding: "4px 12px", borderRadius: 6, fontSize: 11, fontWeight: 600, cursor: "pointer", border: "none", transition: "all 0.15s",
                background: filterWeek === val ? COLORS.accent : "transparent",
                color: filterWeek === val ? "#000" : COLORS.textDim,
              }}>
              {label}
            </button>
          ))}
        </div>

        <div style={{ flex: 1 }} />
        {/* 🔍 Buscador unificado */}
        <div style={{ position: "relative" }}>
          <input
            value={globalSearch}
            onChange={(e) => { setGlobalSearch(e.target.value); if (filterCliente !== "TODOS") { setFilterCliente("TODOS"); setClienteSearch(""); } }}
            placeholder="Buscar cliente, OS, vuelo, proveedor..."
            style={{
              background: globalSearch ? "#eff6ff" : "#e2e8f0",
              border: `1px solid ${globalSearch ? COLORS.accent2 : COLORS.border}`,
              color: COLORS.text, borderRadius: 8,
              padding: "6px 36px 6px 32px", fontSize: 12, width: 300, outline: "none",
              transition: "all 0.2s",
            }}
          />
          <span style={{ position: "absolute", left: 10, top: "50%", transform: "translateY(-50%)", color: globalSearch ? COLORS.accent2 : COLORS.textDim, fontSize: 13 }}>🔍</span>
          {globalSearch && (
            <button onClick={() => { setGlobalSearch(""); setFilterCliente("TODOS"); setClienteSearch(""); }} style={{ position: "absolute", right: 8, top: "50%", transform: "translateY(-50%)", background: "none", border: "none", color: COLORS.textDim, cursor: "pointer", fontSize: 14, lineHeight: 1 }}>✕</button>
          )}
          {/* Dropdown clientes cuando escribe algo */}
          {globalSearch.trim().length >= 2 && (() => {
            const q = globalSearch.toLowerCase();
            const clienteSuggs = clientesList.filter((c) => c.nombre.toLowerCase().includes(q)).slice(0, 6);
            if (clienteSuggs.length === 0) return null;
            return (
              <div style={{ position: "absolute", top: "calc(100% + 4px)", left: 0, zIndex: 300, background: COLORS.card, border: `1px solid ${COLORS.accent2}`, borderRadius: 10, width: 320, maxHeight: 220, overflowY: "auto", boxShadow: "0 8px 32px rgba(0,0,0,0.5)" }}>
                <div style={{ padding: "6px 14px", fontSize: 10, color: COLORS.textDim, textTransform: "uppercase", letterSpacing: "0.06em", borderBottom: `1px solid ${COLORS.border}` }}>Filtrar por cliente</div>
                {clienteSuggs.map((c) => (
                  <div key={c.nombre} onClick={() => { setFilterCliente(c.nombre); setClienteSearch(c.nombre); setGlobalSearch(""); }}
                    style={{ padding: "9px 14px", cursor: "pointer", borderBottom: `1px solid ${COLORS.border}`, display: "flex", justifyContent: "space-between", alignItems: "center" }}
                    onMouseEnter={(e) => e.currentTarget.style.background = "#e2e8f0"}
                    onMouseLeave={(e) => e.currentTarget.style.background = "transparent"}>
                    <span style={{ fontSize: 12, color: COLORS.text }}>{c.nombre}</span>
                    <span style={{ fontSize: 11, color: COLORS.accent, fontFamily: "'DM Mono', monospace" }}>{fmtShort(c.ingrC)}</span>
                  </div>
                ))}
              </div>
            );
          })()}
        </div>
        <select value={filterMes} onChange={(e) => { setFilterMes(e.target.value); setFilterWeek("TODOS"); setFilterFechaDesde(""); setFilterFechaHasta(""); }} style={SELECT_STYLE}>
          <option value="TODOS">Todos los meses</option>
          {meses.map((m) => <option key={m} value={m}>{MES_NAMES[m]}</option>)}
        </select>
        <select value={filterDestino} onChange={(e) => setFilterDestino(e.target.value)} style={SELECT_STYLE}>
          <option value="TODOS">Todos los destinos</option>
          {destinos.map((d) => <option key={d} value={d}>{DEST_MAP[d] || d}</option>)}
        </select>
        {/* Rango de fechas — Calendario personalizado */}
        {(() => {
          const hasRange = filterFechaDesde || filterFechaHasta;
          const label = filterFechaDesde && filterFechaHasta
            ? `${new Date(filterFechaDesde+"T12:00:00").toLocaleDateString("es-MX",{day:"2-digit",month:"short"})} → ${new Date(filterFechaHasta+"T12:00:00").toLocaleDateString("es-MX",{day:"2-digit",month:"short"})}`
            : filterFechaDesde ? `Desde ${new Date(filterFechaDesde+"T12:00:00").toLocaleDateString("es-MX",{day:"2-digit",month:"short"})}` : "📅 Fechas";

          const [calYear, setCalYear] = calState;
          const [calMonth, setCalMonth] = calMonthState;
          const [hoverDate, setHoverDate] = hoverState;

          const MESES = ["Enero","Febrero","Marzo","Abril","Mayo","Junio","Julio","Agosto","Septiembre","Octubre","Noviembre","Diciembre"];
          const DIAS = ["Lu","Ma","Mi","Ju","Vi","Sa","Do"];

          const firstDay = new Date(calYear, calMonth, 1);
          const lastDay = new Date(calYear, calMonth+1, 0);
          const startDow = (firstDay.getDay() + 6) % 7; // Monday=0
          const totalDays = lastDay.getDate();

          const toISO = (y,m,d) => `${y}-${String(m+1).padStart(2,"0")}-${String(d).padStart(2,"0")}`;
          const fromISO = (s) => s ? new Date(s+"T12:00:00") : null;

          const desdeD = fromISO(filterFechaDesde);
          const hastaD = fromISO(filterFechaHasta);
          const hoverD = hoverDate ? new Date(hoverDate+"T12:00:00") : null;
          const rangeEnd = hastaD || hoverD;

          const isStart = (iso) => iso === filterFechaDesde;
          const isEnd   = (iso) => iso === filterFechaHasta;
          const inRange = (iso) => {
            if (!desdeD || !rangeEnd) return false;
            const d = new Date(iso+"T12:00:00");
            const lo = desdeD < rangeEnd ? desdeD : rangeEnd;
            const hi = desdeD < rangeEnd ? rangeEnd : desdeD;
            return d > lo && d < hi;
          };

          const handleDayClick = (iso) => {
            setFilterMes("TODOS"); setFilterWeek("TODOS");
            if (!filterFechaDesde || (filterFechaDesde && filterFechaHasta)) {
              setFilterFechaDesde(iso); setFilterFechaHasta(""); setHoverDate(null);
            } else {
              if (iso < filterFechaDesde) { setFilterFechaHasta(filterFechaDesde); setFilterFechaDesde(iso); }
              else { setFilterFechaHasta(iso); }
              setShowDatePicker(false); setHoverDate(null);
            }
          };

          const prevMonth = () => { if (calMonth === 0) { setCalMonth(11); setCalYear(y=>y-1); } else setCalMonth(m=>m-1); };
          const nextMonth = () => { if (calMonth === 11) { setCalMonth(0); setCalYear(y=>y+1); } else setCalMonth(m=>m+1); };

          const cells = [];
          for (let i = 0; i < startDow; i++) cells.push(null);
          for (let d = 1; d <= totalDays; d++) cells.push(d);

          return (
            <div style={{ position: "relative" }}>
              <button onClick={() => setShowDatePicker(p=>!p)}
                style={{ ...SELECT_STYLE, border: `1px solid ${hasRange ? COLORS.accent2 : COLORS.border}`, color: hasRange ? COLORS.accent2 : COLORS.textDim, fontWeight: hasRange ? 600 : 400, cursor: "pointer", whiteSpace: "nowrap", background: hasRange ? "#eff6ff" : SELECT_STYLE.background }}>
                {label} {!hasRange && "▾"}
                {hasRange && <span onClick={(e)=>{e.stopPropagation();setFilterFechaDesde("");setFilterFechaHasta("");setShowDatePicker(false);}} style={{marginLeft:8,color:COLORS.textDim,fontWeight:400}}>✕</span>}
              </button>
              {showDatePicker && (
                <div onClick={(e)=>e.stopPropagation()} style={{ position:"absolute", top:"calc(100% + 6px)", left:0, zIndex:300, background:COLORS.card, border:`1px solid ${COLORS.border}`, borderRadius:14, padding:16, boxShadow:"0 8px 32px rgba(0,0,0,0.15)", width:280 }}>
                  {/* Header */}
                  <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", marginBottom:12 }}>
                    <button onClick={prevMonth} style={{ background:"none", border:`1px solid ${COLORS.border}`, borderRadius:6, width:28, height:28, cursor:"pointer", fontSize:14, color:COLORS.textDim }}>‹</button>
                    <span style={{ fontSize:13, fontWeight:700, color:COLORS.text }}>{MESES[calMonth]} {calYear}</span>
                    <button onClick={nextMonth} style={{ background:"none", border:`1px solid ${COLORS.border}`, borderRadius:6, width:28, height:28, cursor:"pointer", fontSize:14, color:COLORS.textDim }}>›</button>
                  </div>
                  {/* Day headers */}
                  <div style={{ display:"grid", gridTemplateColumns:"repeat(7,1fr)", marginBottom:4 }}>
                    {DIAS.map(d => <div key={d} style={{ textAlign:"center", fontSize:10, fontWeight:700, color:COLORS.textDim, padding:"2px 0" }}>{d}</div>)}
                  </div>
                  {/* Days grid */}
                  <div style={{ display:"grid", gridTemplateColumns:"repeat(7,1fr)", gap:2 }}>
                    {cells.map((day, ci) => {
                      if (!day) return <div key={"e-"+ci} />;
                      const iso = toISO(calYear, calMonth, day);
                      const isS = isStart(iso), isE = isEnd(iso), inR = inRange(iso);
                      const isToday = iso === new Date().toISOString().slice(0,10);
                      const bg = isS || isE ? COLORS.accent2 : inR ? COLORS.accent2+"22" : "transparent";
                      const clr = isS || isE ? "#fff" : inR ? COLORS.accent2 : isToday ? COLORS.accent2 : COLORS.text;
                      return (
                        <div key={iso} onClick={() => handleDayClick(iso)}
                          onMouseEnter={() => filterFechaDesde && !filterFechaHasta && setHoverDate(iso)}
                          onMouseLeave={() => setHoverDate(null)}
                          style={{ textAlign:"center", padding:"5px 0", borderRadius:6, fontSize:12, fontWeight: isS||isE ? 700 : 400, background:bg, color:clr, cursor:"pointer", border: isToday && !isS && !isE ? `1px solid ${COLORS.accent2}` : "1px solid transparent", transition:"background 0.1s" }}>
                          {day}
                        </div>
                      );
                    })}
                  </div>
                  {/* Status */}
                  <div style={{ marginTop:12, fontSize:11, color:COLORS.textDim, textAlign:"center" }}>
                    {!filterFechaDesde ? "Selecciona la fecha inicial" : !filterFechaHasta ? "Ahora selecciona la fecha final" : `${new Date(filterFechaDesde+"T12:00:00").toLocaleDateString("es-MX",{day:"2-digit",month:"short",year:"numeric"})} → ${new Date(filterFechaHasta+"T12:00:00").toLocaleDateString("es-MX",{day:"2-digit",month:"short",year:"numeric"})}`}
                  </div>
                  {/* Shortcuts */}
                  <div style={{ display:"flex", gap:6, marginTop:10 }}>
                    {[["Sem",()=>{const t=new Date();const d=t.getDay();const m=new Date(t);m.setDate(t.getDate()-(d===0?6:d-1));const s=new Date(m);s.setDate(m.getDate()+6);setFilterFechaDesde(m.toISOString().slice(0,10));setFilterFechaHasta(s.toISOString().slice(0,10));setFilterMes("TODOS");setFilterWeek("TODOS");setShowDatePicker(false);}],
                      ["Mes",()=>{const t=new Date();const f=new Date(t.getFullYear(),t.getMonth(),1);const l=new Date(t.getFullYear(),t.getMonth()+1,0);setFilterFechaDesde(f.toISOString().slice(0,10));setFilterFechaHasta(l.toISOString().slice(0,10));setFilterMes("TODOS");setFilterWeek("TODOS");setShowDatePicker(false);}],
                      ["Año",()=>{const y=new Date().getFullYear();setFilterFechaDesde(`${y}-01-01`);setFilterFechaHasta(`${y}-12-31`);setFilterMes("TODOS");setFilterWeek("TODOS");setShowDatePicker(false);}],
                    ].map(([lbl,fn])=>(
                      <button key={lbl} onClick={fn} style={{ flex:1, background:COLORS.bg, border:`1px solid ${COLORS.border}`, color:COLORS.textDim, borderRadius:6, padding:"4px 0", fontSize:11, cursor:"pointer" }}>{lbl}</button>
                    ))}
                  </div>
                </div>
              )}
            </div>
          );
        })()}
      </div>

      {/* CLIENT FILTER BAR */}
      <div style={{ padding: "10px 28px", borderBottom: `1px solid ${COLORS.border}`, background: "#f8fafc", display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>

        {/* Active client chip */}
        {filterCliente !== "TODOS" && (
          <div style={{ display: "flex", alignItems: "center", gap: 8, background: "#eff6ff", border: `1px solid ${COLORS.accent}`, borderRadius: 20, padding: "4px 14px" }}>
            <span style={{ fontSize: 12, color: COLORS.accent, fontWeight: 600 }}>{filterCliente}</span>
            <button onClick={() => { setFilterCliente("TODOS"); setClienteSearch(""); }}
              style={{ background: "none", border: "none", color: COLORS.textDim, cursor: "pointer", fontSize: 13, lineHeight: 1 }}>✕</button>
          </div>
        )}

        {/* Quick airline shortcuts */}
        <div style={{ flex: 1 }} />
        <span style={{ fontSize: 10, color: COLORS.textDim }}>Acceso rápido:</span>
        {["AMERICAN AIRLINES","DELTA AIRLINES","UNITED AIRLINES","AEROMEXICO EQUIPAJES","JETBLUE"].map((airline) => {
          const found = clientesList.find((c) => c.nombre.toUpperCase().includes(airline.split(" ")[0]));
          if (!found) return null;
          const isActive = filterCliente === found.nombre;
          return (
            <button key={airline} onClick={() => { setFilterCliente(isActive ? "TODOS" : found.nombre); setClienteSearch(isActive ? "" : found.nombre); }}
              style={{ padding: "4px 10px", borderRadius: 6, fontSize: 10, fontWeight: 600, cursor: "pointer", border: `1px solid ${isActive ? COLORS.accent : COLORS.border}`, background: isActive ? COLORS.accent : "transparent", color: isActive ? "#000" : COLORS.textDim, transition: "all 0.15s" }}>
              {airline.split(" ")[0]}
            </button>
          );
        })}
      </div>

      {/* NAV MÓDULOS — sticky */}
      <div style={{ position: "sticky", top: 0, zIndex: 100, background: "#ffffff", borderBottom: "1px solid #e2e8f0", padding: "0 28px" }}>
{/* NAV MÓDULOS */}
        <div style={{ marginBottom: 0 }}>
          {/* Módulos principales */}
          <div style={{ display: "flex", borderBottom: `2px solid ${COLORS.border}`, marginBottom: 0 }}>
            {[
              ["mando",      "MANDO INTEGRAL"],
              ["financiero", "CONTROL FINANCIERO"],
              ["operativo",  "OPERATIVO"],
            ].map(([mod, label]) => (
              <button key={mod} onClick={() => {
                setActiveModule(mod);
                if (mod === "mando")      setActiveView("overview");
                if (mod === "financiero") setActiveView("ar");
                if (mod === "operativo")  setActiveView("operativo");
              }} style={{
                padding: "12px 28px", fontSize: 12, fontWeight: 700, cursor: "pointer",
                background: "transparent", border: "none",
                color: activeModule === mod ? COLORS.accent3 : COLORS.textDim,
                borderBottom: activeModule === mod ? `2px solid ${COLORS.accent3}` : "2px solid transparent",
                marginBottom: -2, letterSpacing: "0.08em", textTransform: "uppercase",
                transition: "all 0.15s",
              }}>
                {label}
              </button>
            ))}
          </div>

          {/* Sub-tabs por módulo */}
          <div style={{ display: "flex", gap: 6, padding: "10px 0 16px 0", flexWrap: "wrap" }}>
            {activeModule === "mando" && [
              ["overview",  "📊 Resumen"],
              ["ingresos",  "💹 Ingresos"],
              ["egresos",   "💸 Egresos"],
              ["margen",    "📈 Margen Bruto"],
              ["semaforo",  "🚦 Semáforo"],
            ].map(([id, label]) => (
              <button key={id} onClick={() => setActiveView(id)} style={TAB_STYLE(activeView === id)}>{label}</button>
            ))}
            {activeModule === "financiero" && [
              ["ar",  "💰 Ctas x Cobrar"],
              ["ap",  "💸 Ctas x Pagar"],
            ].map(([id, label]) => (
              <button key={id} onClick={() => setActiveView(id)} style={TAB_STYLE(activeView === id)}>{label}</button>
            ))}
            {activeModule === "operativo" && [
              ["operativo", "⚙️ Dashboard Operativo"],
              ["ops",       "📋 Operaciones"],
              ["os",        "🔎 Buscar OS"],
            ].map(([id, label]) => (
              <button key={id} onClick={() => setActiveView(id)} style={TAB_STYLE(activeView === id)}>{label}</button>
            ))}
          </div>
        </div>
      </div>

      {/* MAIN CONTENT */}
      <div style={{ padding: "20px 28px", maxWidth: 1400, margin: "0 auto" }}>

        {/* CLIENT SUMMARY BANNER */}
        {filterCliente !== "TODOS" && (() => {
          const cli = clientesList.find((c) => c.nombre === filterCliente);
          const cxcCli = arFacturado.filter((r) => r._cliente === filterCliente).reduce((s, r) => s + r._ingrC, 0);
          const cxcSFCli = arSinFacturar.filter((r) => r._cliente === filterCliente).reduce((s, r) => s + r._ingrC, 0);
          const byMesCli = {};
          filtered.forEach((r) => {
            if (!r._mes) return;
            if (!byMesCli[r._mes]) byMesCli[r._mes] = { mes: MES_NAMES[r._mes], ingrC: 0, ingrS: 0, egrsC: 0, egrsS: 0, ops: 0 };
            byMesCli[r._mes].ingrC += r._ingrC;
            byMesCli[r._mes].ingrS += r._ingrS;
            byMesCli[r._mes].egrsC += r._egrsC;
            byMesCli[r._mes].egrsS += r._egrsS;
            byMesCli[r._mes].ops += 1;
          });
          const meses = Object.values(byMesCli).sort((a, b) => MES_NAMES.indexOf(a.mes) - MES_NAMES.indexOf(b.mes));
          return (
            <div style={{ background: COLORS.card, border: `1px solid ${COLORS.accent}55`, borderRadius: 12, marginBottom: 20, overflow: "hidden" }}>
              {/* Header */}
              <div style={{ padding: "14px 20px", background: "#f1f5f9", borderBottom: `1px solid ${COLORS.border}`, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                  <span style={{ fontSize: 18 }}>🏢</span>
                  <div>
                    <div style={{ fontSize: 14, fontWeight: 700, color: COLORS.accent }}>{filterCliente}</div>
                    <div style={{ fontSize: 11, color: COLORS.textDim }}>{filtered.length} operaciones · {[...new Set(filtered.map((r) => r._destino))].map((d) => DEST_MAP[d] || d).join(", ")}</div>
                  </div>
                </div>
                <div style={{ display: "flex", gap: 20 }}>
                  {[
                    { label: "Ingreso c/IVA",    value: filtered.reduce((s,r)=>s+r._ingrC,0),  color: COLORS.accent3 },
                    { label: "Ingreso s/IVA",    value: filtered.reduce((s,r)=>s+r._ingrS,0),  color: COLORS.accent3 },
                    { label: "Egreso c/IVA",     value: filtered.reduce((s,r)=>s+r._egrsC,0),  color: COLORS.danger  },
                    { label: "Margen c/IVA",     value: filtered.reduce((s,r)=>s+r._margen,0), color: COLORS.accent  },
                    { label: "Margen s/IVA",     value: filtered.reduce((s,r)=>s+r._margenS,0),color: COLORS.accent  },
                    { label: "Por Cobrar (fact.)", value: cxcCli,    color: COLORS.danger },
                    { label: "Por Facturar",       value: cxcSFCli, color: "#f97316"      },
                  ].map((item) => (
                    <div key={item.label} style={{ textAlign: "right" }}>
                      <div style={{ fontSize: 10, color: COLORS.textDim }}>{item.label}</div>
                      <div style={{ fontSize: 13, fontWeight: 700, color: item.color, fontFamily: "'DM Mono', monospace" }}>{fmtShort(item.value)}</div>
                    </div>
                  ))}
                </div>
              </div>
              {/* Monthly breakdown */}
              {meses.length > 0 && (
                <div style={{ overflowX: "auto" }}>
                  <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
                    <thead>
                      <tr>
                        {["Mes","Ops","Ingreso c/IVA","Ingreso s/IVA","Egreso c/IVA","Egreso s/IVA","Margen c/IVA","Margen s/IVA"].map((h) => (
                          <th key={h} style={{ padding: "8px 14px", background: COLORS.bg, color: COLORS.accent, fontWeight: 600, fontSize: 10, textTransform: "uppercase", letterSpacing: "0.05em", textAlign: h === "Mes" || h === "Ops" ? "left" : "right", borderBottom: `1px solid ${COLORS.accent}33`, whiteSpace: "nowrap" }}>{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {meses.map((m, i) => (
                        <tr key={i} style={{ background: i % 2 === 0 ? COLORS.card : "#f8fafc", borderBottom: `1px solid ${COLORS.border}` }}>
                          <td style={{ padding: "8px 14px", color: COLORS.accent2, fontWeight: 600 }}>{m.mes}</td>
                          <td style={{ padding: "8px 14px", color: COLORS.textDim }}>{m.ops}</td>
                          <td style={{ padding: "8px 14px", textAlign: "right", fontFamily: "'DM Mono', monospace", color: COLORS.accent3 }}>{fmt(m.ingrC)}</td>
                          <td style={{ padding: "8px 14px", textAlign: "right", fontFamily: "'DM Mono', monospace", color: COLORS.accent3 }}>{fmt(m.ingrS)}</td>
                          <td style={{ padding: "8px 14px", textAlign: "right", fontFamily: "'DM Mono', monospace", color: COLORS.danger }}>{fmt(m.egrsC)}</td>
                          <td style={{ padding: "8px 14px", textAlign: "right", fontFamily: "'DM Mono', monospace", color: COLORS.danger }}>{fmt(m.egrsS)}</td>
                          <td style={{ padding: "8px 14px", textAlign: "right", fontFamily: "'DM Mono', monospace", color: (m.ingrC-m.egrsC) >= 0 ? COLORS.accent3 : COLORS.danger }}>{fmt(m.ingrC - m.egrsC)}</td>
                          <td style={{ padding: "8px 14px", textAlign: "right", fontFamily: "'DM Mono', monospace", color: (m.ingrS-m.egrsS) >= 0 ? COLORS.accent3 : COLORS.danger }}>{fmt(m.ingrS - m.egrsS)}</td>
                        </tr>
                      ))}
                      {/* Totals row */}
                      <tr style={{ borderTop: `2px solid ${COLORS.accent}55`, background: "#f1f5f9" }}>
                        <td style={{ padding: "9px 14px", color: COLORS.accent, fontWeight: 700 }}>TOTAL</td>
                        <td style={{ padding: "9px 14px", color: COLORS.textDim, fontWeight: 700 }}>{meses.reduce((s,m)=>s+m.ops,0)}</td>
                        {[
                          meses.reduce((s,m)=>s+m.ingrC,0), meses.reduce((s,m)=>s+m.ingrS,0),
                          meses.reduce((s,m)=>s+m.egrsC,0), meses.reduce((s,m)=>s+m.egrsS,0),
                          meses.reduce((s,m)=>s+m.ingrC-m.egrsC,0), meses.reduce((s,m)=>s+m.ingrS-m.egrsS,0),
                        ].map((val, i) => (
                          <td key={i} style={{ padding: "9px 14px", textAlign: "right", fontFamily: "'DM Mono', monospace", fontWeight: 700, color: i < 2 ? COLORS.accent3 : i < 4 ? COLORS.danger : val >= 0 ? COLORS.accent3 : COLORS.danger }}>{fmt(val)}</td>
                        ))}
                      </tr>
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          );
        })()}


        {searchActive && (
          <div style={{ background: COLORS.card, border: `1px solid ${COLORS.accent2}`, borderRadius: 12, marginBottom: 20, overflow: "hidden" }}>
            <div style={{ padding: "12px 20px", borderBottom: `1px solid ${COLORS.border}`, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <span style={{ fontSize: 13, fontWeight: 600, color: COLORS.accent2 }}>
                🔍 Resultados para "{globalSearch}" · {searchResults.length} encontrados
                <span style={{ fontSize: 11, color: COLORS.textDim, marginLeft: 10, fontWeight: 400 }}>· Haz clic en el cliente para filtrar el dashboard</span>
              </span>
              <button onClick={() => setGlobalSearch("")} style={{ background: "none", border: `1px solid ${COLORS.border}`, color: COLORS.textDim, borderRadius: 6, padding: "4px 10px", cursor: "pointer", fontSize: 11 }}>Limpiar búsqueda</button>
            </div>
            <div style={{ overflowX: "auto", maxHeight: 360, overflowY: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
                <thead>
                  <tr>
                    {["SO","Fecha","Servicio","Destino","Cliente","Vuelo","Proveedor","Factura Prov.","Ingreso c/IVA","Egreso c/IVA","Margen","Est. Prov.","Est. Cliente"].map((h) => (
                      <th key={h} style={{ padding: "8px 12px", background: COLORS.bg, color: COLORS.accent2, fontWeight: 600, fontSize: 10, textTransform: "uppercase", letterSpacing: "0.05em", textAlign: ["Ingreso c/IVA","Egreso c/IVA","Margen"].includes(h) ? "right" : "left", whiteSpace: "nowrap", borderBottom: `1px solid ${COLORS.accent2}44` }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {searchResults.slice(0, 200).map((r, i) => (
                    <tr key={i} style={{ background: i % 2 === 0 ? COLORS.card : "#f8fafc", borderBottom: `1px solid ${COLORS.border}` }}>
                      <td style={{ padding: "7px 12px", fontFamily: "'DM Mono', monospace", color: COLORS.accent2, fontSize: 11 }}>{r._os || "—"}</td>
                      <td style={{ padding: "7px 12px", color: COLORS.textDim, fontSize: 11, whiteSpace: "nowrap" }}>{r._fecha ? r._fecha.toLocaleDateString("es-MX", { day: "2-digit", month: "short" }) : "—"}</td>
                      <td style={{ padding: "7px 12px", fontSize: 11 }}><span style={{ background: "#e2e8f0", borderRadius: 4, padding: "1px 7px", color: r._servicio === "TRANSPORTE" ? COLORS.transporte : r._servicio === "PROTECCION" ? COLORS.proteccion : r._servicio === "RENTAS" ? COLORS.rentas : r._servicio === "CIRCUITOS" ? COLORS.circuitos : COLORS.equipajes }}>{SERVICE_MAP[r._servicio] || r._servicio || "—"}</span></td>
                      <td style={{ padding: "7px 12px", color: COLORS.textDim, fontSize: 11 }}>{DEST_MAP[r._destino] || r._destino || "—"}</td>
                      <td onClick={() => { if(r._cliente){ setFilterCliente(r._cliente); setClienteSearch(r._cliente); setGlobalSearch(""); } }} style={{ padding: "7px 12px", fontSize: 11, maxWidth: 160, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", cursor: r._cliente ? "pointer" : "default", color: r._cliente ? COLORS.accent2 : COLORS.textDim }}>{r._cliente || "—"}</td>
                      <td style={{ padding: "7px 12px", color: COLORS.textDim, fontSize: 11 }}>{r["VUELO"] || "—"}</td>
                      <td style={{ padding: "7px 12px", fontSize: 11, maxWidth: 140, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", color: COLORS.textDim }}>{r._proveedor || "—"}</td>
                      <td style={{ padding: "7px 12px", fontFamily: "'DM Mono', monospace", color: COLORS.accent, fontSize: 11 }}>{r._facturaProv || "—"}</td>
                      <td style={{ padding: "7px 12px", textAlign: "right", fontFamily: "'DM Mono', monospace", color: COLORS.accent3, fontSize: 11 }}>{fmt(r._ingrC)}</td>
                      <td style={{ padding: "7px 12px", textAlign: "right", fontFamily: "'DM Mono', monospace", color: COLORS.danger, fontSize: 11 }}>{fmt(r._egrsC)}</td>
                      <td style={{ padding: "7px 12px", textAlign: "right", fontFamily: "'DM Mono', monospace", color: r._margen >= 0 ? COLORS.accent3 : COLORS.danger, fontSize: 11 }}>{fmt(r._margen)}</td>
                      <td style={{ padding: "7px 12px" }}><StatusBadge status={r["ESTADO PROVEEDOR"]} /></td>
                      <td style={{ padding: "7px 12px" }}><StatusBadge status={r["ESTADO CLIENTE"]} /></td>
                    </tr>
                  ))}
                  {searchResults.length === 0 && <tr><td colSpan={13} style={{ padding: 24, textAlign: "center", color: COLORS.textDim }}>Sin resultados para "{globalSearch}"</td></tr>}
                  {searchResults.length > 200 && <tr><td colSpan={13} style={{ padding: 8, textAlign: "center", color: COLORS.textDim, fontSize: 11 }}>Mostrando 200 de {searchResults.length} resultados</td></tr>}
                </tbody>
              </table>
            </div>
          </div>
        )}



        {/* WEEKLY SUMMARY BANNER */}
        {filterWeek !== "TODOS" && (() => {
          const bounds = filterWeek === "LASTWEEK" ? { start: weekBounds.lastMonday, end: weekBounds.lastSunday } : filterWeek === "YESTERDAY" ? { start: weekBounds.yesterday, end: weekBounds.yesterdayEnd } : { start: weekBounds.thisMonday, end: weekBounds.thisSunday };
          const label = filterWeek === "LASTWEEK" ? "Semana pasada" : filterWeek === "YESTERDAY" ? "Ayer" : "Semana actual";
          const fmtD = (d) => d.toLocaleDateString("es-MX", { day: "2-digit", month: "short", year: "numeric" });
          const byDay = {};
          filtered.forEach((r) => {
            if (!r._fecha) return;
            const k = r._fecha.toLocaleDateString("es-MX", { weekday: "short", day: "2-digit", month: "short" });
            if (!byDay[k]) byDay[k] = { label: k, ingreso: 0, egreso: 0, margen: 0, ops: 0 };
            byDay[k].ingreso += r._ingrC;
            byDay[k].egreso += r._egrsC;
            byDay[k].margen += r._margen;
            byDay[k].ops += 1;
          });
          const days = Object.values(byDay);
          return (
            <div style={{ background: COLORS.card, border: `1px solid ${COLORS.accent}44`, borderRadius: 12, marginBottom: 20, padding: "16px 20px" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
                <div>
                  <span style={{ fontSize: 13, fontWeight: 700, color: COLORS.accent }}>📅 {label}</span>
                  <span style={{ fontSize: 11, color: COLORS.textDim, marginLeft: 10 }}>{fmtD(bounds.start)} → {fmtD(bounds.end)} · {filtered.length} operaciones</span>
                </div>
                <div style={{ display: "flex", gap: 24 }}>
                  <div><span style={{ fontSize: 10, color: COLORS.textDim }}>Ingreso c/IVA </span><span style={{ fontSize: 14, fontWeight: 700, color: COLORS.accent3, fontFamily: "'DM Mono', monospace" }}>{fmtShort(kpis.ingrC)}</span></div>
                  <div><span style={{ fontSize: 10, color: COLORS.textDim }}>Egreso c/IVA </span><span style={{ fontSize: 14, fontWeight: 700, color: COLORS.danger, fontFamily: "'DM Mono', monospace" }}>{fmtShort(kpis.egrsC)}</span></div>
                  <div><span style={{ fontSize: 10, color: COLORS.textDim }}>Margen c/IVA </span><span style={{ fontSize: 14, fontWeight: 700, color: COLORS.accent, fontFamily: "'DM Mono', monospace" }}>{fmtShort(kpis.margen)}</span></div>
                  <div><span style={{ fontSize: 10, color: COLORS.textDim }}>Margen s/IVA </span><span style={{ fontSize: 14, fontWeight: 700, color: COLORS.accent, fontFamily: "'DM Mono', monospace" }}>{fmtShort(kpis.margenS)}</span></div>
                </div>
              </div>
              {/* Day by day breakdown */}
              {days.length > 0 && (
                <div style={{ overflowX: "auto" }}>
                  <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
                    <thead>
                      <tr>
                        {["Día","Operaciones","Ingreso c/IVA","Egreso c/IVA","Margen"].map((h) => (
                          <th key={h} style={{ padding: "6px 12px", color: COLORS.accent, fontWeight: 600, fontSize: 10, textTransform: "uppercase", letterSpacing: "0.05em", textAlign: h === "Día" || h === "Operaciones" ? "left" : "right", borderBottom: `1px solid ${COLORS.accent}33` }}>{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {days.map((d, i) => (
                        <tr key={i} style={{ borderBottom: `1px solid ${COLORS.border}` }}>
                          <td style={{ padding: "7px 12px", color: COLORS.accent2, fontWeight: 600 }}>{d.label}</td>
                          <td style={{ padding: "7px 12px", color: COLORS.textDim }}>{d.ops}</td>
                          <td style={{ padding: "7px 12px", textAlign: "right", fontFamily: "'DM Mono', monospace", color: COLORS.accent3 }}>{fmt(d.ingreso)}</td>
                          <td style={{ padding: "7px 12px", textAlign: "right", fontFamily: "'DM Mono', monospace", color: COLORS.danger }}>{fmt(d.egreso)}</td>
                          <td style={{ padding: "7px 12px", textAlign: "right", fontFamily: "'DM Mono', monospace", color: d.margen >= 0 ? COLORS.accent3 : COLORS.danger }}>{fmt(d.margen)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
              {days.length === 0 && <div style={{ color: COLORS.textDim, fontSize: 12, textAlign: "center", padding: 12 }}>Sin operaciones en este periodo</div>}
            </div>
          );
        })()}




        {/* DASHBOARD OPERATIVO */}
        {activeView === "operativo" && (() => {
          const SVCS = ["TRANSPORTE","PROTECCION","EQUIPAJES","RENTAS","CIRCUITOS"];
          const SVC_COLORS = { TRANSPORTE: COLORS.transporte, PROTECCION: COLORS.proteccion, EQUIPAJES: COLORS.equipajes, RENTAS: COLORS.rentas, CIRCUITOS: COLORS.circuitos };

          // KPIs por unidad de servicio
          const byUnd = SVCS.map((svc) => {
            const rows = filtered.filter((r) => r._servicio === svc);
            const osUnicas = (svc === "PROTECCION")
              ? new Set(rows.map(r => r._os).filter(Boolean)).size
              : (svc === "CIRCUITOS")
              ? rows.filter(r => String(r["TIPO DE SERVICIO"]||"").trim().toUpperCase() === "CIRCUITO").length
              : null;
            return {
              svc,
              label: SERVICE_MAP[svc] || svc,
              color: SVC_COLORS[svc],
              ops: rows.length,
              osUnicas,
              ingrC: rows.reduce((s, r) => s + r._ingrC, 0),
              ingrS: rows.reduce((s, r) => s + r._ingrS, 0),
              egrsC: rows.reduce((s, r) => s + r._egrsC, 0),
              egrsS: rows.reduce((s, r) => s + r._egrsS, 0),
              margen: rows.reduce((s, r) => s + r._margen, 0),
              margenS: rows.reduce((s, r) => s + r._margenS, 0),
            };
          }).filter((u) => u.ops > 0);

          // Comparativo mensual por unidad
          const monthBySvc = {};
          filtered.forEach((r) => {
            if (!r._mes || !SVCS.includes(r._servicio)) return;
            const k = r._mes;
            if (!monthBySvc[k]) monthBySvc[k] = { mes: MES_NAMES[k] };
            if (!monthBySvc[k][r._servicio]) monthBySvc[k][r._servicio] = 0;
            monthBySvc[k][r._servicio] += r._ingrC;
          });
          const monthBySvcData = Object.values(monthBySvc).sort((a, b) => MES_NAMES.indexOf(a.mes) - MES_NAMES.indexOf(b.mes));

          // Productividad staff — solo CLAVE OP.2 numérica pura 1-500 (sin letra), solo TRANSPORTE y PROTECCION
          const staffRows = filtered.filter((r) => {
            const svc = r._servicio;
            if (svc !== "TRANSPORTE" && svc !== "PROTECCION") return false;
            const clave = String(r["CLAVE OP.2"] || "").trim();
            if (!clave || clave === "" || clave.toUpperCase() === "NA") return false;
            // Solo numérico puro, sin letras
            const matchNum = clave.match(/^(\d+)$/);
            if (!matchNum) return false;
            const n = parseInt(matchNum[1]);
            return n >= 1 && n <= 500;
          });

          const staffMap = {};
          staffRows.forEach((r) => {
            const clave = String(r["CLAVE OP.2"] || "").trim().toUpperCase();
            if (!staffMap[clave]) staffMap[clave] = { clave, transporte: 0, proteccion: 0, total: 0, ingrC: 0 };
            staffMap[clave].total += 1;
            staffMap[clave].ingrC += r._ingrC;
            if (r._servicio === "TRANSPORTE") staffMap[clave].transporte += 1;
            if (r._servicio === "PROTECCION") staffMap[clave].proteccion += 1;
          });
          const staffList = Object.values(staffMap).sort((a, b) => b.total - a.total);

          return (
            <div>
              {/* KPIs por unidad */}
              <SectionTitle>KPIs por Unidad de Servicio</SectionTitle>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: 12, marginBottom: 24 }}>
                {byUnd.map((u) => (
                  <div key={u.svc} style={{ background: COLORS.card, border: `1px solid ${u.color}44`, borderRadius: 12, padding: "16px 18px", position: "relative", overflow: "hidden" }}>
                    <div style={{ position: "absolute", top: 0, left: 0, width: 3, height: "100%", background: u.color, borderRadius: "3px 0 0 3px" }} />
                    <div style={{ fontSize: 11, color: u.color, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.07em", marginBottom: 10 }}>{u.label}</div>
                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
                      {[
                        { l: "Registros", v: u.ops.toLocaleString(), mono: false },
                        ...(u.osUnicas !== null ? [{ l: u.svc === "PROTECCION" ? "Protecciones (OS)" : "Circuitos", v: u.osUnicas.toLocaleString(), mono: false, color: u.color }] : []),
                        { l: "Ingreso c/IVA", v: fmtShort(u.ingrC), mono: true },
                        { l: "Egreso c/IVA", v: fmtShort(u.egrsC), mono: true, color: COLORS.danger },
                        { l: "Margen s/IVA", v: fmtShort(u.margenS), mono: true, color: u.margenS >= 0 ? COLORS.accent3 : COLORS.danger },
                        { l: "% Margen", v: `${u.ingrC > 0 ? ((u.margen / u.ingrC) * 100).toFixed(1) : 0}%`, mono: true, color: COLORS.accent },
                      ].map((item) => (
                        <div key={item.l}>
                          <div style={{ fontSize: 9, color: COLORS.textDim, textTransform: "uppercase", letterSpacing: "0.06em" }}>{item.l}</div>
                          <div style={{ fontSize: 13, fontWeight: 700, color: item.color || COLORS.text, fontFamily: item.mono ? "'DM Mono', monospace" : "inherit" }}>{item.v}</div>
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </div>

              {/* Comparativo ingresos por unidad/mes */}
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16, marginBottom: 24 }}>
                <ChartCard title="Ingresos por Unidad de Servicio · Mensual">
                  <ResponsiveContainer width="100%" height={240}>
                    <BarChart data={monthBySvcData}>
                      <CartesianGrid strokeDasharray="3 3" stroke={COLORS.border} />
                      <XAxis dataKey="mes" tick={{ fill: COLORS.textDim, fontSize: 11 }} />
                      <YAxis tickFormatter={fmtShort} tick={{ fill: COLORS.textDim, fontSize: 10 }} />
                      <Tooltip {...TOOLTIP_STYLE} />
                      <Legend wrapperStyle={{ fontSize: 11 }} />
                      {byUnd.map((u) => (
                        <Bar key={u.svc} dataKey={u.svc} name={u.label} fill={u.color} stackId="a" radius={[0,0,0,0]} />
                      ))}
                    </BarChart>
                  </ResponsiveContainer>
                </ChartCard>

                <ChartCard title="Comparativo de Margen s/IVA por Unidad">
                  <ResponsiveContainer width="100%" height={240}>
                    <BarChart data={byUnd} layout="vertical">
                      <CartesianGrid strokeDasharray="3 3" stroke={COLORS.border} />
                      <XAxis type="number" tickFormatter={fmtShort} tick={{ fill: COLORS.textDim, fontSize: 10 }} />
                      <YAxis type="category" dataKey="label" width={110} tick={{ fill: COLORS.textDim, fontSize: 11 }} />
                      <Tooltip formatter={(v) => [fmtShort(v), "Margen s/IVA"]} contentStyle={{ background: "#ffffff", border: "1px solid #e2e8f0", borderRadius: 8, color: "#0f172a" }} />
                      <Bar dataKey="margenS" name="Margen s/IVA" radius={[0, 4, 4, 0]}>
                        {byUnd.map((u, i) => (
                          <Cell key={i} fill={u.color} />
                        ))}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                </ChartCard>
              </div>

              {/* Tabla comparativa */}
              <ChartCard title="Comparativo por Unidad de Servicio" style={{ marginBottom: 24 }}>
                <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
                  <thead>
                    <tr style={{ borderBottom: `1px solid ${COLORS.border}` }}>
                      {["Unidad", "Ops", "Ingreso c/IVA", "Ingreso s/IVA", "Egreso c/IVA", "Egreso s/IVA", "Margen c/IVA", "Margen s/IVA", "% Margen"].map((h) => (
                        <th key={h} style={{ padding: "8px 12px", color: COLORS.textDim, fontWeight: 600, textAlign: h === "Unidad" || h === "Ops" ? "left" : "right", fontSize: 11, textTransform: "uppercase", letterSpacing: "0.05em", whiteSpace: "nowrap" }}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {byUnd.map((u) => (
                      <tr key={u.svc} style={{ borderBottom: `1px solid ${COLORS.border}` }}>
                        <td style={{ padding: "10px 12px" }}>
                          <span style={{ display: "flex", alignItems: "center", gap: 8 }}>
                            <span style={{ width: 8, height: 8, borderRadius: "50%", background: u.color, display: "inline-block" }} />
                            <strong style={{ color: u.color }}>{u.label}</strong>
                          </span>
                        </td>
                        <td style={{ padding: "10px 12px", color: COLORS.textDim }}>{u.ops.toLocaleString()}</td>
                        <td style={{ padding: "10px 12px", textAlign: "right", fontFamily: "'DM Mono', monospace" }}>{fmt(u.ingrC)}</td>
                        <td style={{ padding: "10px 12px", textAlign: "right", fontFamily: "'DM Mono', monospace", color: COLORS.textDim }}>{fmt(u.ingrS)}</td>
                        <td style={{ padding: "10px 12px", textAlign: "right", fontFamily: "'DM Mono', monospace", color: COLORS.danger }}>{fmt(u.egrsC)}</td>
                        <td style={{ padding: "10px 12px", textAlign: "right", fontFamily: "'DM Mono', monospace", color: COLORS.textDim }}>{fmt(u.egrsS)}</td>
                        <td style={{ padding: "10px 12px", textAlign: "right", fontFamily: "'DM Mono', monospace", color: u.margen >= 0 ? COLORS.accent3 : COLORS.danger }}>{fmt(u.margen)}</td>
                        <td style={{ padding: "10px 12px", textAlign: "right", fontFamily: "'DM Mono', monospace", color: u.margenS >= 0 ? COLORS.accent3 : COLORS.danger }}>{fmt(u.margenS)}</td>
                        <td style={{ padding: "10px 12px", textAlign: "right", fontFamily: "'DM Mono', monospace", color: COLORS.accent }}>{u.ingrC > 0 ? ((u.margen / u.ingrC) * 100).toFixed(1) : 0}%</td>
                      </tr>
                    ))}
                    {/* Total row */}
                    <tr style={{ borderTop: `2px solid ${COLORS.border}`, background: "#f1f5f9" }}>
                      <td style={{ padding: "10px 12px", color: COLORS.accent, fontWeight: 700 }}>TOTAL</td>
                      <td style={{ padding: "10px 12px", color: COLORS.textDim, fontWeight: 700 }}>{byUnd.reduce((s, u) => s + u.ops, 0).toLocaleString()}</td>
                      {["ingrC","ingrS","egrsC","egrsS","margen","margenS"].map((k, i) => {
                        const total = byUnd.reduce((s, u) => s + u[k], 0);
                        const isMargen = k.includes("margen");
                        return <td key={k} style={{ padding: "10px 12px", textAlign: "right", fontFamily: "'DM Mono', monospace", fontWeight: 700, color: isMargen ? (total >= 0 ? COLORS.accent3 : COLORS.danger) : i < 2 ? COLORS.text : COLORS.danger }}>{fmt(total)}</td>;
                      })}
                      <td style={{ padding: "10px 12px", textAlign: "right", fontFamily: "'DM Mono', monospace", fontWeight: 700, color: COLORS.accent }}>
                        {byUnd.reduce((s,u)=>s+u.ingrC,0) > 0 ? ((byUnd.reduce((s,u)=>s+u.margen,0) / byUnd.reduce((s,u)=>s+u.ingrC,0)) * 100).toFixed(1) : 0}%
                      </td>
                    </tr>
                  </tbody>
                </table>
              </ChartCard>

              {/* Productividad Staff Interno */}
              <SectionTitle>Productividad Staff Interno · Traslados y Reprotecciones</SectionTitle>
              <div style={{ fontSize: 11, color: COLORS.textDim, marginBottom: 12, marginTop: -8 }}>
                CLAVE OP.2 interna (01–500) · {staffList.length} operadores activos · {staffRows.length} servicios
              </div>
              {staffList.length === 0 ? (
                <div style={{ background: COLORS.card, border: `1px solid ${COLORS.border}`, borderRadius: 12, padding: 32, textAlign: "center", color: COLORS.textDim }}>
                  Sin datos de staff para el filtro seleccionado
                </div>
              ) : (
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
                  {/* Gráfica top operadores */}
                  <ChartCard title="Top Operadores por Volumen de Servicios">
                    <ResponsiveContainer width="100%" height={Math.max(200, staffList.slice(0,15).length * 28)}>
                      <BarChart data={staffList.slice(0, 15)} layout="vertical">
                        <CartesianGrid strokeDasharray="3 3" stroke={COLORS.border} />
                        <XAxis type="number" tick={{ fill: COLORS.textDim, fontSize: 10 }} />
                        <YAxis type="category" dataKey="clave" width={70} tick={{ fill: COLORS.textDim, fontSize: 10 }} />
                        <Tooltip contentStyle={{ background: "#ffffff", border: "1px solid #e2e8f0", borderRadius: 8, color: "#0f172a" }} />
                        <Legend wrapperStyle={{ fontSize: 11 }} />
                        <Bar dataKey="transporte" name="Traslados" fill={COLORS.transporte} stackId="a" />
                        <Bar dataKey="proteccion" name="Reprotecciones" fill={COLORS.proteccion} stackId="a" radius={[0, 4, 4, 0]} />
                      </BarChart>
                    </ResponsiveContainer>
                  </ChartCard>

                  {/* Tabla staff */}
                  <ChartCard title="Detalle por Operador">
                    <div style={{ overflowY: "auto", maxHeight: 400 }}>
                      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
                        <thead>
                          <tr style={{ borderBottom: `1px solid ${COLORS.border}` }}>
                            {["CLAVE OP.2", "Traslados", "Reprotec.", "Total", "Ingreso c/IVA"].map((h) => (
                              <th key={h} style={{ padding: "7px 10px", color: COLORS.textDim, fontWeight: 600, fontSize: 10, textTransform: "uppercase", letterSpacing: "0.05em", textAlign: h === "CLAVE OP.2" ? "left" : "right", whiteSpace: "nowrap" }}>{h}</th>
                            ))}
                          </tr>
                        </thead>
                        <tbody>
                          {staffList.map((s, i) => (
                            <tr key={s.clave} style={{ background: i % 2 === 0 ? COLORS.card : "#f8fafc", borderBottom: `1px solid ${COLORS.border}` }}>
                              <td style={{ padding: "7px 10px", fontFamily: "'DM Mono', monospace", color: COLORS.accent2, fontWeight: 700 }}>{s.clave}</td>
                              <td style={{ padding: "7px 10px", textAlign: "right", color: COLORS.transporte }}>{s.transporte}</td>
                              <td style={{ padding: "7px 10px", textAlign: "right", color: COLORS.proteccion }}>{s.proteccion}</td>
                              <td style={{ padding: "7px 10px", textAlign: "right", fontWeight: 700, color: COLORS.text }}>{s.total}</td>
                              <td style={{ padding: "7px 10px", textAlign: "right", fontFamily: "'DM Mono', monospace", color: COLORS.accent3 }}>{fmt(s.ingrC)}</td>
                            </tr>
                          ))}
                          <tr style={{ borderTop: `2px solid ${COLORS.border}`, background: "#f1f5f9" }}>
                            <td style={{ padding: "7px 10px", color: COLORS.accent, fontWeight: 700 }}>TOTAL</td>
                            <td style={{ padding: "7px 10px", textAlign: "right", fontWeight: 700, color: COLORS.transporte }}>{staffList.reduce((s,r)=>s+r.transporte,0)}</td>
                            <td style={{ padding: "7px 10px", textAlign: "right", fontWeight: 700, color: COLORS.proteccion }}>{staffList.reduce((s,r)=>s+r.proteccion,0)}</td>
                            <td style={{ padding: "7px 10px", textAlign: "right", fontWeight: 700, color: COLORS.text }}>{staffList.reduce((s,r)=>s+r.total,0)}</td>
                            <td style={{ padding: "7px 10px", textAlign: "right", fontFamily: "'DM Mono', monospace", fontWeight: 700, color: COLORS.accent3 }}>{fmt(staffList.reduce((s,r)=>s+r.ingrC,0))}</td>
                          </tr>
                        </tbody>
                      </table>
                    </div>
                  </ChartCard>
                </div>
              )}
            </div>
          );
        })()}

        {/* MODAL */}
        <DrillModal modal={modal} onClose={() => setModal(null)} />

        {/* REPORTE CLIENTE MODAL */}
        {showReporteModal && <ReporteClienteModal data={data} clientesList={clientesList} onClose={() => setShowReporteModal(false)} />}

        {/* INGRESOS */}
        {activeView === "ingresos" && (
          <>
  
            <ChartCard title="Ingresos por Mes">
              <ResponsiveContainer width="100%" height={260}>
                <BarChart data={monthlyData}>
                  <CartesianGrid strokeDasharray="3 3" stroke={COLORS.border} />
                  <XAxis dataKey="mes" tick={{ fill: COLORS.textDim, fontSize: 11 }} />
                  <YAxis tickFormatter={fmtShort} tick={{ fill: COLORS.textDim, fontSize: 10 }} />
                  <Tooltip {...TOOLTIP_STYLE} />
                  <Bar dataKey="ingreso" fill={COLORS.accent3} name="Ingresos c/IVA" radius={[4,4,0,0]} />
                </BarChart>
              </ResponsiveContainer>
            </ChartCard>
          </>
        )}

        {/* EGRESOS */}
        {activeView === "egresos" && (
          <>
  
            <ChartCard title="Egresos por Mes">
              <ResponsiveContainer width="100%" height={260}>
                <BarChart data={monthlyData}>
                  <CartesianGrid strokeDasharray="3 3" stroke={COLORS.border} />
                  <XAxis dataKey="mes" tick={{ fill: COLORS.textDim, fontSize: 11 }} />
                  <YAxis tickFormatter={fmtShort} tick={{ fill: COLORS.textDim, fontSize: 10 }} />
                  <Tooltip {...TOOLTIP_STYLE} />
                  <Bar dataKey="egreso" fill={COLORS.danger} name="Egresos c/IVA" radius={[4,4,0,0]} />
                </BarChart>
              </ResponsiveContainer>
            </ChartCard>
          </>
        )}

        {/* MARGEN */}
        {activeView === "margen" && (
          <>
  
            <ChartCard title="Margen Bruto por Mes">
              <ResponsiveContainer width="100%" height={260}>
                <LineChart data={monthlyData}>
                  <CartesianGrid strokeDasharray="3 3" stroke={COLORS.border} />
                  <XAxis dataKey="mes" tick={{ fill: COLORS.textDim, fontSize: 11 }} />
                  <YAxis tickFormatter={fmtShort} tick={{ fill: COLORS.textDim, fontSize: 10 }} />
                  <Tooltip {...TOOLTIP_STYLE} />
                  <Line type="monotone" dataKey="margen" stroke={COLORS.accent} strokeWidth={2} dot={{ fill: COLORS.accent }} name="Margen c/IVA" />
                </LineChart>
              </ResponsiveContainer>
            </ChartCard>
          </>
        )}

        {/* SEMÁFORO */}
        {activeView === "semaforo" && (() => {
          const SVCS = ["TRANSPORTE","PROTECCION","EQUIPAJES","RENTAS","CIRCUITOS"];
          const SVC_COLORS = { TRANSPORTE: COLORS.transporte, PROTECCION: COLORS.proteccion, EQUIPAJES: COLORS.equipajes, RENTAS: COLORS.rentas, CIRCUITOS: COLORS.circuitos };
          const units = SVCS.map((svc) => {
            const rows = filtered.filter((r) => r._servicio === svc);
            if (rows.length === 0) return null;
            const ingrC = rows.reduce((s,r)=>s+r._ingrC,0);
            const margenS = rows.reduce((s,r)=>s+r._margenS,0);
            const pct = ingrC > 0 ? (margenS/ingrC)*100 : 0;
            const status = pct >= 20 ? "verde" : pct >= 5 ? "amarillo" : "rojo";
            const statusColors = { verde: COLORS.accent3, amarillo: COLORS.accent, rojo: COLORS.danger };
            const statusLabels = { verde: "✅ Saludable", amarillo: "⚠️ En riesgo", rojo: "🔴 Crítico" };
            return { svc, label: SERVICE_MAP[svc]||svc, color: SVC_COLORS[svc], ops: rows.length, ingrC, margenS, pct, status, statusColor: statusColors[status], statusLabel: statusLabels[status] };
          }).filter(Boolean);
          return (
            <div>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))", gap: 16, marginBottom: 24 }}>
                {units.map((u) => (
                  <div key={u.svc} style={{ background: COLORS.card, border: `2px solid ${u.statusColor}55`, borderRadius: 14, padding: "20px 22px", position: "relative", overflow: "hidden" }}>
                    <div style={{ position: "absolute", top: 0, left: 0, width: 4, height: "100%", background: u.statusColor }} />
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 14 }}>
                      <div>
                        <div style={{ fontSize: 13, fontWeight: 700, color: u.color, textTransform: "uppercase", letterSpacing: "0.06em" }}>{u.label}</div>
                        <div style={{ fontSize: 11, color: COLORS.textDim, marginTop: 2 }}>{u.ops.toLocaleString()} operaciones</div>
                      </div>
                      <span style={{ background: `${u.statusColor}22`, color: u.statusColor, borderRadius: 8, padding: "4px 12px", fontSize: 11, fontWeight: 700 }}>{u.statusLabel}</span>
                    </div>
                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 10 }}>
                      {[
                        { l: "Ingreso c/IVA", v: fmtShort(u.ingrC), c: COLORS.accent3 },
                        { l: "Margen s/IVA",  v: fmtShort(u.margenS), c: u.statusColor },
                        { l: "% Margen",      v: `${u.pct.toFixed(1)}%`, c: u.statusColor },
                      ].map((item) => (
                        <div key={item.l}>
                          <div style={{ fontSize: 9, color: COLORS.textDim, textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 3 }}>{item.l}</div>
                          <div style={{ fontSize: 16, fontWeight: 700, color: item.c, fontFamily: "'DM Mono', monospace" }}>{item.v}</div>
                        </div>
                      ))}
                    </div>
                    {/* Barra de progreso margen */}
                    <div style={{ marginTop: 14, height: 6, background: COLORS.border, borderRadius: 3, overflow: "hidden" }}>
                      <div style={{ height: "100%", width: `${Math.min(Math.max(u.pct, 0), 100)}%`, background: u.statusColor, borderRadius: 3, transition: "width 0.5s ease" }} />
                    </div>
                    <div style={{ display: "flex", justifyContent: "space-between", marginTop: 4 }}>
                      <span style={{ fontSize: 9, color: COLORS.textDim }}>0%</span>
                      <span style={{ fontSize: 9, color: COLORS.textDim }}>Meta: 20%</span>
                      <span style={{ fontSize: 9, color: COLORS.textDim }}>100%</span>
                    </div>
                  </div>
                ))}
              </div>
              <ChartCard title="Comparativo % Margen s/IVA por Unidad de Negocio">
                <ResponsiveContainer width="100%" height={220}>
                  <BarChart data={units} layout="vertical">
                    <CartesianGrid strokeDasharray="3 3" stroke={COLORS.border} />
                    <XAxis type="number" tickFormatter={(v) => `${v.toFixed(0)}%`} tick={{ fill: COLORS.textDim, fontSize: 10 }} domain={[0, 'auto']} />
                    <YAxis type="category" dataKey="label" width={120} tick={{ fill: COLORS.textDim, fontSize: 11 }} />
                    <Tooltip formatter={(v) => [`${v.toFixed(1)}%`, "% Margen s/IVA"]} contentStyle={{ background: "#ffffff", border: "1px solid #e2e8f0", borderRadius: 8, color: "#0f172a" }} />
                    <Bar dataKey="pct" name="% Margen" radius={[0,4,4,0]}>
                      {units.map((u, i) => <Cell key={i} fill={u.statusColor} />)}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </ChartCard>
            </div>
          );
        })()}

        {/* OVERVIEW */}
        {activeView === "overview" && (
          <>
            {/* KPI CARDS */}
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: 14, marginBottom: 24 }}>
              <KPICard label="Ingresos c/IVA"    value={fmtShort(kpis.ingrC)}   sub={`${kpis.ops} operaciones`}                                                          color={COLORS.accent3}  onClick={() => openModal("ingrc")} />
              <KPICard label="Ingresos s/IVA"    value={fmtShort(kpis.ingrS)}   sub={`${kpis.ingrC > 0 ? ((kpis.ingrS / kpis.ingrC) * 100).toFixed(1) : 0}% del c/IVA`} color={COLORS.accent3}  onClick={() => openModal("ingrc")} />
              <KPICard label="Egresos c/IVA"     value={fmtShort(kpis.egrsC)}   sub={`${kpis.ingrC > 0 ? ((kpis.egrsC / kpis.ingrC) * 100).toFixed(1) : 0}% del ingreso`} color={COLORS.danger}  onClick={() => openModal("egrsc")} />
              <KPICard label="Egresos s/IVA"     value={fmtShort(kpis.egrsS)}   sub={`${kpis.ingrS > 0 ? ((kpis.egrsS / kpis.ingrS) * 100).toFixed(1) : 0}% del ingreso`} color={COLORS.danger}  onClick={() => openModal("egrsc")} />
              <KPICard label="Margen Bruto c/IVA" value={fmtShort(kpis.margen)}  sub={`${kpis.ingrC > 0 ? ((kpis.margen  / kpis.ingrC) * 100).toFixed(1) : 0}% sobre ingresos`} color={COLORS.accent} onClick={() => openModal("margen")} />
              <KPICard label="Margen Bruto s/IVA" value={fmtShort(kpis.margenS)} sub={`${kpis.ingrS > 0 ? ((kpis.margenS / kpis.ingrS) * 100).toFixed(1) : 0}% sobre ingresos`} color={COLORS.accent} onClick={() => openModal("margen")} />
              <KPICard label="Por Cobrar (Facturado)" value={fmtShort(arTotal)}          sub={`${arFacturado.length} registros · facturado`}           color={COLORS.danger}   onClick={() => openModal("cxc")} />
              <KPICard label="Por Facturar (Pendiente)" value={fmtShort(arSinFacturarTotal)} sub={`${arSinFacturar.length} registros · sin factura`}      color="#f97316"         onClick={() => openModal("cxcSinFacturar")} />
              <KPICard label="CxP Pendiente" value={fmtShort(apTotal)}
                sub={`s/IVA: ${fmtShort(apSTotal)} · ${ap.length} registros`}
                color={COLORS.accent2} onClick={() => openModal("cxp")} />
              <KPICard label="Operaciones" value={kpis.ops.toLocaleString()}
                sub={(() => {
                  const parts = [];
                  ["TRANSPORTE","PROTECCION","EQUIPAJES","RENTAS","CIRCUITOS"].forEach((s) => {
                    const rows = filtered.filter((r) => r._servicio === s);
                    if (rows.length === 0) return;
                    if (s === "PROTECCION") {
                      parts.push(`Protección ${new Set(rows.map((r) => r._os).filter(Boolean)).size} OS`);
                    } else if (s === "CIRCUITOS") {
                      const circ = rows.filter((r) => String(r["TIPO DE SERVICIO"] || "").trim().toUpperCase() === "CIRCUITO").length;
                      const inter = rows.filter((r) => ["INTER HOTEL","INTER-HOTEL","INTER - HOTEL"].includes(String(r["TIPO DE SERVICIO"] || "").trim().toUpperCase())).length;
                      if (circ > 0) parts.push(`Circuitos ${circ}`);
                      if (inter > 0) parts.push(`Interhoteles ${inter} (Circuitos)`);
                    } else {
                      parts.push(`${(SERVICE_MAP[s]||s).split(" ")[0]} ${rows.length}`);
                    }
                  });
                  return parts.join(" · ");
                })()}
                color={COLORS.muted} onClick={() => openModal("ops")} />
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16, marginBottom: 16 }}>
              <ChartCard title="Ingresos vs Egresos por Mes">
                <ResponsiveContainer width="100%" height={220}>
                  <BarChart data={monthlyData}>
                    <CartesianGrid strokeDasharray="3 3" stroke={COLORS.border} />
                    <XAxis dataKey="mes" tick={{ fill: COLORS.textDim, fontSize: 11 }} />
                    <YAxis tickFormatter={fmtShort} tick={{ fill: COLORS.textDim, fontSize: 10 }} />
                    <Tooltip {...TOOLTIP_STYLE} />
                    <Legend wrapperStyle={{ fontSize: 11 }} />
                    <Bar dataKey="ingreso" fill={COLORS.accent3} name="Ingresos" radius={[4, 4, 0, 0]} />
                    <Bar dataKey="egreso" fill={COLORS.danger} name="Egresos" radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </ChartCard>

              <ChartCard title="Margen Bruto por Mes">
                <ResponsiveContainer width="100%" height={220}>
                  <LineChart data={monthlyData}>
                    <CartesianGrid strokeDasharray="3 3" stroke={COLORS.border} />
                    <XAxis dataKey="mes" tick={{ fill: COLORS.textDim, fontSize: 11 }} />
                    <YAxis tickFormatter={fmtShort} tick={{ fill: COLORS.textDim, fontSize: 10 }} />
                    <Tooltip {...TOOLTIP_STYLE} />
                    <Line type="monotone" dataKey="margen" stroke={COLORS.accent} strokeWidth={2} dot={{ fill: COLORS.accent }} name="Margen" />
                  </LineChart>
                </ResponsiveContainer>
              </ChartCard>
            </div>

            <div style={{ display: "grid", gridTemplateColumns: "1fr 1.5fr 1fr", gap: 16, marginBottom: 16 }}>
              <ChartCard title="Por Tipo de Servicio">
                <ResponsiveContainer width="100%" height={220}>
                  <PieChart>
                    <Pie data={byService} dataKey="ingreso" nameKey="name" cx="50%" cy="50%" outerRadius={80} label={({ name, percent }) => `${(percent * 100).toFixed(0)}%`} labelLine={false}>
                      {byService.map((entry, i) => <Cell key={i} fill={SVC_COLOR_MAP[entry.svc] || PIE_COLORS[i % PIE_COLORS.length]} />)}
                    </Pie>
                    <Tooltip formatter={(v) => [fmtShort(v), "Ingreso"]} contentStyle={{ background: "#ffffff", border: "1px solid #e2e8f0", borderRadius: 8, color: "#0f172a" }} />
                    <Legend wrapperStyle={{ fontSize: 11 }} />
                  </PieChart>
                </ResponsiveContainer>
              </ChartCard>

              <ChartCard title="Top 10 Clientes por Ingreso">
                <ResponsiveContainer width="100%" height={220}>
                  <BarChart data={byCliente} layout="vertical" margin={{ left: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke={COLORS.border} />
                    <XAxis type="number" tickFormatter={fmtShort} tick={{ fill: COLORS.textDim, fontSize: 10 }} />
                    <YAxis type="category" dataKey="name" width={120} tick={{ fill: COLORS.textDim, fontSize: 9 }} />
                    <Tooltip {...TOOLTIP_STYLE} />
                    <Bar dataKey="ingreso" fill={COLORS.accent2} name="Ingreso" radius={[0, 4, 4, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </ChartCard>

              <ChartCard title="Por Destino">
                <ResponsiveContainer width="100%" height={220}>
                  <PieChart>
                    <Pie data={byDestino} dataKey="ingreso" nameKey="name" cx="50%" cy="50%" outerRadius={80} label={({ name, percent }) => `${(percent * 100).toFixed(0)}%`} labelLine={false}>
                      {byDestino.map((_, i) => <Cell key={i} fill={PIE_COLORS[(i + 2) % PIE_COLORS.length]} />)}
                    </Pie>
                    <Tooltip formatter={(v) => [fmtShort(v), "Ingreso"]} contentStyle={{ background: "#ffffff", border: "1px solid #e2e8f0", borderRadius: 8, color: "#0f172a" }} />
                    <Legend wrapperStyle={{ fontSize: 11 }} />
                  </PieChart>
                </ResponsiveContainer>
              </ChartCard>
            </div>

            {/* Service breakdown table */}
            <ChartCard title="Desglose por Tipo de Servicio">
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
                <thead>
                  <tr style={{ borderBottom: `1px solid ${COLORS.border}` }}>
                    {["Servicio", "Operaciones", "Ingreso c/IVA", "Ingreso s/IVA", "Egreso c/IVA", "Egreso s/IVA", "Margen c/IVA", "Margen s/IVA"].map((h) => (
                      <th key={h} style={{ padding: "8px 12px", color: COLORS.textDim, fontWeight: 600, textAlign: h === "Servicio" ? "left" : "right", fontSize: 11, textTransform: "uppercase", letterSpacing: "0.05em" }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {servicios.filter((s) => s !== "x").map((svc) => {
                    const rows = filtered.filter((r) => r._servicio === svc);
                    const ingrC = rows.reduce((s, r) => s + r._ingrC, 0);
                    const ingrS = rows.reduce((s, r) => s + r._ingrS, 0);
                    const egrsC = rows.reduce((s, r) => s + r._egrsC, 0);
                    const egrsS = rows.reduce((s, r) => s + r._egrsS, 0);
                    const mrg = rows.reduce((s, r) => s + r._margen, 0);
                    const mrgS = rows.reduce((s, r) => s + r._margenS, 0);
                    const svcColor = svc === "TRANSPORTE" ? COLORS.transporte : svc === "PROTECCION" ? COLORS.proteccion : svc === "RENTAS" ? COLORS.rentas : svc === "CIRCUITOS" ? COLORS.circuitos : COLORS.equipajes;
                    return (
                      <tr key={svc} style={{ borderBottom: `1px solid ${COLORS.border}`, background: "transparent" }}>
                        <td style={{ padding: "10px 12px" }}>
                          <span style={{ display: "flex", alignItems: "center", gap: 8 }}>
                            <span style={{ width: 8, height: 8, borderRadius: "50%", background: svcColor, display: "inline-block" }} />
                            <strong style={{ color: svcColor }}>{SERVICE_MAP[svc] || svc}</strong>
                          </span>
                        </td>
                        <td style={{ padding: "10px 12px", textAlign: "right", color: COLORS.textDim }}>{rows.length.toLocaleString()}</td>
                        <td style={{ padding: "10px 12px", textAlign: "right", fontFamily: "'DM Mono', monospace" }}>{fmt(ingrC)}</td>
                        <td style={{ padding: "10px 12px", textAlign: "right", fontFamily: "'DM Mono', monospace", color: COLORS.textDim }}>{fmt(ingrS)}</td>
                        <td style={{ padding: "10px 12px", textAlign: "right", fontFamily: "'DM Mono', monospace", color: COLORS.danger }}>{fmt(egrsC)}</td>
                        <td style={{ padding: "10px 12px", textAlign: "right", fontFamily: "'DM Mono', monospace", color: COLORS.textDim }}>{fmt(egrsS)}</td>
                        <td style={{ padding: "10px 12px", textAlign: "right", fontFamily: "'DM Mono', monospace", color: COLORS.accent3 }}>{fmt(mrg)}</td>
                        <td style={{ padding: "10px 12px", textAlign: "right", fontFamily: "'DM Mono', monospace", color: COLORS.accent3 }}>{fmt(mrgS)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </ChartCard>
          </>
        )}

        {/* CUENTAS POR PAGAR */}
        {activeView === "ap" && (() => {
          const apGrouped = {};
          ap.forEach((r) => {
            const k = r._proveedor || "Sin proveedor";
            if (!apGrouped[k]) apGrouped[k] = { nombre: k, rows: [], egrsC: 0, egrsS: 0 };
            apGrouped[k].rows.push(r);
            apGrouped[k].egrsC += r._egrsC || 0;
            apGrouped[k].egrsS += r._egrsS || 0;
          });
          const apGroupList = Object.values(apGrouped).sort((a, b) => b.egrsC - a.egrsC);
          return (
            <ChartCard title={`Cuentas por Pagar · ${apGroupList.length} proveedores · c/IVA: ${fmt(apTotal)} · s/IVA: ${fmt(apSTotal)}`}>
              <div style={{ overflowX: "auto" }}>
                <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
                  <thead>
                    <tr style={{ background: COLORS.bg }}>
                      <th style={{ padding: "9px 12px", width: 32 }}></th>
                      {["Proveedor", "Registros", "Egreso c/IVA", "Egreso s/IVA"].map((h) => (
                        <th key={h} style={{ padding: "9px 12px", color: COLORS.textDim, fontWeight: 600, textAlign: h.includes("Egreso") ? "right" : "left", fontSize: 11, textTransform: "uppercase", letterSpacing: "0.04em", whiteSpace: "nowrap", borderBottom: `1px solid ${COLORS.border}` }}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {apGroupList.map((g, gi) => (
                      <>
                        <tr key={g.nombre} onClick={() => setExpApProv(p => ({...p, [g.nombre]: !p[g.nombre]}))}
                          style={{ background: expApProv[g.nombre] ? `${COLORS.accent2}11` : gi % 2 === 0 ? COLORS.card : "#f8fafc", borderBottom: `1px solid ${COLORS.border}`, cursor: "pointer" }}
                          onMouseEnter={(e) => e.currentTarget.style.background = `${COLORS.accent2}11`}
                          onMouseLeave={(e) => e.currentTarget.style.background = expApProv[g.nombre] ? `${COLORS.accent2}11` : gi % 2 === 0 ? COLORS.card : "#f8fafc"}>
                          <td style={{ padding: "9px 12px", textAlign: "center", color: COLORS.accent2 }}>{expApProv[g.nombre] ? "▾" : "▸"}</td>
                          <td style={{ padding: "9px 12px", fontWeight: 700, color: COLORS.text, maxWidth: 260, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{g.nombre}</td>
                          <td style={{ padding: "9px 12px", color: COLORS.textDim }}>{g.rows.length}</td>
                          <td style={{ padding: "9px 12px", textAlign: "right", fontFamily: "'DM Mono', monospace", color: COLORS.danger, fontWeight: 600 }}>{fmt(g.egrsC)}</td>
                          <td style={{ padding: "9px 12px", textAlign: "right", fontFamily: "'DM Mono', monospace", color: COLORS.textDim }}>{fmt(g.egrsS)}</td>
                        </tr>
                        {expApProv[g.nombre] && g.rows.map((r, i) => (
                          <tr key={`${g.nombre}-${i}`} style={{ background: "#f1f5f9", borderBottom: `1px solid ${COLORS.border}` }}>
                            <td style={{ padding: "7px 12px" }}></td>
                            <td style={{ padding: "7px 12px", color: COLORS.textDim, fontSize: 11 }}>{r._facturaProv || "—"}</td>
                            <td style={{ padding: "7px 12px", color: COLORS.textDim, fontSize: 11 }}>{r._fecha ? r._fecha.toLocaleDateString("es-MX", { day: "2-digit", month: "short", year: "2-digit" }) : "—"}</td>
                            <td style={{ padding: "7px 12px", textAlign: "right", fontFamily: "'DM Mono', monospace", color: COLORS.danger, fontSize: 11 }}>{fmt(r._egrsC)}</td>
                            <td style={{ padding: "7px 12px", textAlign: "right", fontFamily: "'DM Mono', monospace", color: COLORS.textDim, fontSize: 11 }}>{fmt(r._egrsS)}</td>
                          </tr>
                        ))}
                      </>
                    ))}
                    {apGroupList.length === 0 && <tr><td colSpan={5} style={{ padding: 32, textAlign: "center", color: COLORS.textDim }}>Sin cuentas por pagar pendientes</td></tr>}
                  </tbody>
                </table>
              </div>
            </ChartCard>
          );
        })()}

        {/* CUENTAS POR COBRAR */}
        {activeView === "ar" && (
          <>
          {/* Subtabs */}
          <div style={{ display: "flex", gap: 8, marginBottom: 16 }}>
            <button onClick={() => setArSubTab("facturado")} style={{ padding: "6px 16px", borderRadius: 6, fontSize: 12, fontWeight: 600, cursor: "pointer", border: `1px solid ${arSubTab === "facturado" ? COLORS.danger : COLORS.border}`, background: arSubTab === "facturado" ? "#fee2e2" : "transparent", color: arSubTab === "facturado" ? COLORS.danger : COLORS.textDim, transition: "all 0.15s" }}>
              🔴 Por Cobrar — Facturado sin pagar · {arFacturado.length} reg · {fmtShort(arTotal)}
            </button>
            <button onClick={() => setArSubTab("sinFacturar")} style={{ padding: "6px 16px", borderRadius: 6, fontSize: 12, fontWeight: 600, cursor: "pointer", border: `1px solid ${arSubTab === "sinFacturar" ? "#f97316" : COLORS.border}`, background: arSubTab === "sinFacturar" ? "#fff7ed" : "transparent", color: arSubTab === "sinFacturar" ? "#f97316" : COLORS.textDim, transition: "all 0.15s" }}>
              🟠 Por Facturar — Pendiente · {arSinFacturar.length} reg · {fmtShort(arSinFacturarTotal)}
            </button>
          </div>

          {arSubTab === "facturado" && (() => {
            const grp = {};
            arFacturado.forEach((r) => {
              const k = r._cliente || "Sin cliente";
              if (!grp[k]) grp[k] = { nombre: k, rows: [], ingrC: 0, ingrS: 0 };
              grp[k].rows.push(r);
              grp[k].ingrC += r._ingrC || 0;
              grp[k].ingrS += r._ingrS || 0;
            });
            const grpList = Object.values(grp).sort((a, b) => b.ingrC - a.ingrC);
            return (
              <ChartCard title={`Por Cobrar · Facturado sin pagar · ${grpList.length} clientes · c/IVA: ${fmt(arTotal)}`}>
                <div style={{ overflowX: "auto" }}>
                  <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
                    <thead>
                      <tr style={{ background: COLORS.bg }}>
                        <th style={{ padding: "9px 12px", width: 32 }}></th>
                        {["Cliente", "Registros", "Ingreso c/IVA", "Ingreso s/IVA"].map((h) => (
                          <th key={h} style={{ padding: "9px 12px", color: COLORS.textDim, fontWeight: 600, textAlign: h.includes("Ingreso") ? "right" : "left", fontSize: 11, textTransform: "uppercase", letterSpacing: "0.04em", whiteSpace: "nowrap", borderBottom: `1px solid ${COLORS.border}` }}>{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {grpList.map((g, gi) => (
                        <>
                          <tr key={g.nombre} onClick={() => setExpArCli(p => ({...p, [`f-${g.nombre}`]: !p[`f-${g.nombre}`]}))}
                            style={{ background: expArCli[`f-${g.nombre}`] ? `${COLORS.danger}11` : gi % 2 === 0 ? COLORS.card : "#f8fafc", borderBottom: `1px solid ${COLORS.border}`, cursor: "pointer" }}
                            onMouseEnter={(e) => e.currentTarget.style.background = `${COLORS.danger}11`}
                            onMouseLeave={(e) => e.currentTarget.style.background = expArCli[`f-${g.nombre}`] ? `${COLORS.danger}11` : gi % 2 === 0 ? COLORS.card : "#f8fafc"}>
                            <td style={{ padding: "9px 12px", textAlign: "center", color: COLORS.danger }}>{expArCli[`f-${g.nombre}`] ? "▾" : "▸"}</td>
                            <td style={{ padding: "9px 12px", fontWeight: 700, color: COLORS.text, maxWidth: 260, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{g.nombre}</td>
                            <td style={{ padding: "9px 12px", color: COLORS.textDim }}>{g.rows.length}</td>
                            <td style={{ padding: "9px 12px", textAlign: "right", fontFamily: "'DM Mono', monospace", color: COLORS.danger, fontWeight: 600 }}>{fmt(g.ingrC)}</td>
                            <td style={{ padding: "9px 12px", textAlign: "right", fontFamily: "'DM Mono', monospace", color: COLORS.textDim }}>{fmt(g.ingrS)}</td>
                          </tr>
                          {expArCli[`f-${g.nombre}`] && g.rows.map((r, i) => (
                            <tr key={`f-${g.nombre}-${i}`} style={{ background: "#f1f5f9", borderBottom: `1px solid ${COLORS.border}` }}>
                              <td style={{ padding: "7px 12px" }}></td>
                              <td style={{ padding: "7px 12px", color: COLORS.textDim, fontSize: 11 }}>{r._facturaCliente || "—"}</td>
                              <td style={{ padding: "7px 12px", color: COLORS.textDim, fontSize: 11 }}>{r._fecha ? r._fecha.toLocaleDateString("es-MX", { day: "2-digit", month: "short", year: "2-digit" }) : "—"}</td>
                              <td style={{ padding: "7px 12px", textAlign: "right", fontFamily: "'DM Mono', monospace", color: COLORS.accent3, fontSize: 11 }}>{fmt(r._ingrC)}</td>
                              <td style={{ padding: "7px 12px", textAlign: "right", fontFamily: "'DM Mono', monospace", color: COLORS.textDim, fontSize: 11 }}>{fmt(r._ingrS)}</td>
                            </tr>
                          ))}
                        </>
                      ))}
                      {grpList.length === 0 && <tr><td colSpan={5} style={{ padding: 32, textAlign: "center", color: COLORS.textDim }}>Sin registros facturados pendientes de cobro</td></tr>}
                    </tbody>
                  </table>
                </div>
              </ChartCard>
            );
          })()}

          {arSubTab === "sinFacturar" && (() => {
            const grp = {};
            arSinFacturar.forEach((r) => {
              const k = r._cliente || "Sin cliente";
              if (!grp[k]) grp[k] = { nombre: k, rows: [], ingrC: 0, ingrS: 0 };
              grp[k].rows.push(r);
              grp[k].ingrC += r._ingrC || 0;
              grp[k].ingrS += r._ingrS || 0;
            });
            const grpList = Object.values(grp).sort((a, b) => b.ingrC - a.ingrC);
            return (
              <ChartCard title={`Por Facturar · Pendiente · ${grpList.length} clientes · c/IVA: ${fmt(arSinFacturarTotal)}`}>
                <div style={{ overflowX: "auto" }}>
                  <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
                    <thead>
                      <tr style={{ background: COLORS.bg }}>
                        <th style={{ padding: "9px 12px", width: 32 }}></th>
                        {["Cliente", "Registros", "Ingreso c/IVA", "Ingreso s/IVA"].map((h) => (
                          <th key={h} style={{ padding: "9px 12px", color: COLORS.textDim, fontWeight: 600, textAlign: h.includes("Ingreso") ? "right" : "left", fontSize: 11, textTransform: "uppercase", letterSpacing: "0.04em", whiteSpace: "nowrap", borderBottom: `1px solid ${COLORS.border}` }}>{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {grpList.map((g, gi) => (
                        <>
                          <tr key={g.nombre} onClick={() => setExpArCli(p => ({...p, [`sf-${g.nombre}`]: !p[`sf-${g.nombre}`]}))}
                            style={{ background: expArCli[`sf-${g.nombre}`] ? "#f9730011" : gi % 2 === 0 ? COLORS.card : "#f8fafc", borderBottom: `1px solid ${COLORS.border}`, cursor: "pointer" }}
                            onMouseEnter={(e) => e.currentTarget.style.background = "#f9730011"}
                            onMouseLeave={(e) => e.currentTarget.style.background = expArCli[`sf-${g.nombre}`] ? "#f9730011" : gi % 2 === 0 ? COLORS.card : "#f8fafc"}>
                            <td style={{ padding: "9px 12px", textAlign: "center", color: "#f97316" }}>{expArCli[`sf-${g.nombre}`] ? "▾" : "▸"}</td>
                            <td style={{ padding: "9px 12px", fontWeight: 700, color: COLORS.text, maxWidth: 260, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{g.nombre}</td>
                            <td style={{ padding: "9px 12px", color: COLORS.textDim }}>{g.rows.length}</td>
                            <td style={{ padding: "9px 12px", textAlign: "right", fontFamily: "'DM Mono', monospace", color: "#f97316", fontWeight: 600 }}>{fmt(g.ingrC)}</td>
                            <td style={{ padding: "9px 12px", textAlign: "right", fontFamily: "'DM Mono', monospace", color: COLORS.textDim }}>{fmt(g.ingrS)}</td>
                          </tr>
                          {expArCli[`sf-${g.nombre}`] && g.rows.map((r, i) => (
                            <tr key={`sf-${g.nombre}-${i}`} style={{ background: "#f1f5f9", borderBottom: `1px solid ${COLORS.border}` }}>
                              <td style={{ padding: "7px 12px" }}></td>
                              <td style={{ padding: "7px 12px", color: COLORS.textDim, fontSize: 11 }}>{r._os || "—"}</td>
                              <td style={{ padding: "7px 12px", color: COLORS.textDim, fontSize: 11 }}>{r._fecha ? r._fecha.toLocaleDateString("es-MX", { day: "2-digit", month: "short", year: "2-digit" }) : "—"}</td>
                              <td style={{ padding: "7px 12px", textAlign: "right", fontFamily: "'DM Mono', monospace", color: COLORS.accent3, fontSize: 11 }}>{fmt(r._ingrC)}</td>
                              <td style={{ padding: "7px 12px", textAlign: "right", fontFamily: "'DM Mono', monospace", color: COLORS.textDim, fontSize: 11 }}>{fmt(r._ingrS)}</td>
                            </tr>
                          ))}
                        </>
                      ))}
                      {grpList.length === 0 && <tr><td colSpan={5} style={{ padding: 32, textAlign: "center", color: COLORS.textDim }}>Sin registros pendientes de facturar</td></tr>}
                    </tbody>
                  </table>
                </div>
              </ChartCard>
            );
          })()}
          </>
        )}

        {/* OPERACIONES */}
        {activeView === "ops" && (() => {
          const SVCS_ORDER = ["TRANSPORTE","PROTECCION","EQUIPAJES","RENTAS","CIRCUITOS"];
          const SVC_CLR = { TRANSPORTE: COLORS.transporte, PROTECCION: COLORS.proteccion, EQUIPAJES: COLORS.equipajes, RENTAS: COLORS.rentas, CIRCUITOS: COLORS.circuitos };
          const opsGrp = {};
          filtered.forEach((r) => {
            const k = r._servicio || "OTROS";
            if (!opsGrp[k]) opsGrp[k] = { svc: k, label: SERVICE_MAP[k] || k, rows: [], ingrC: 0, egrsC: 0, margen: 0 };
            opsGrp[k].rows.push(r);
            opsGrp[k].ingrC  += r._ingrC  || 0;
            opsGrp[k].egrsC  += r._egrsC  || 0;
            opsGrp[k].margen += r._margen || 0;
          });
          const opsGrpList = [...SVCS_ORDER.filter(s => opsGrp[s]), ...Object.keys(opsGrp).filter(s => !SVCS_ORDER.includes(s))].map(s => opsGrp[s]);

          return (
            <ChartCard title={`Operaciones · ${filtered.length.toLocaleString()} registros · ${opsGrpList.length} unidades`}>
              <div style={{ overflowX: "auto" }}>
                <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
                  <thead>
                    <tr style={{ background: COLORS.bg }}>
                      <th style={{ padding: "9px 12px", width: 32 }}></th>
                      {["Unidad de Servicio", "Ops", "Ingreso c/IVA", "Egreso c/IVA", "Margen c/IVA"].map((h) => (
                        <th key={h} style={{ padding: "9px 12px", color: COLORS.textDim, fontWeight: 600, textAlign: ["Ingreso c/IVA","Egreso c/IVA","Margen c/IVA"].includes(h) ? "right" : "left", fontSize: 11, textTransform: "uppercase", letterSpacing: "0.04em", whiteSpace: "nowrap", borderBottom: `1px solid ${COLORS.border}` }}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {opsGrpList.map((g, gi) => {
                      const clr = SVC_CLR[g.svc] || COLORS.muted;
                      const expKey = `ops-${g.svc}`;
                      return (
                        <>
                          <tr key={g.svc} onClick={() => setExpOpsGrp(p => ({...p, [expKey]: !p[expKey]}))}
                            style={{ background: expOpsGrp[expKey] ? `${clr}11` : gi % 2 === 0 ? COLORS.card : "#f8fafc", borderBottom: `1px solid ${COLORS.border}`, cursor: "pointer" }}
                            onMouseEnter={(e) => e.currentTarget.style.background = `${clr}11`}
                            onMouseLeave={(e) => e.currentTarget.style.background = expOpsGrp[expKey] ? `${clr}11` : gi % 2 === 0 ? COLORS.card : "#f8fafc"}>
                            <td style={{ padding: "9px 12px", textAlign: "center", color: clr }}>{expOpsGrp[expKey] ? "▾" : "▸"}</td>
                            <td style={{ padding: "9px 12px", fontWeight: 700 }}>
                              <span style={{ display: "flex", alignItems: "center", gap: 8 }}>
                                <span style={{ width: 8, height: 8, borderRadius: "50%", background: clr, display: "inline-block", flexShrink: 0 }} />
                                <span style={{ color: clr }}>{g.label}</span>
                              </span>
                            </td>
                            <td style={{ padding: "9px 12px", color: COLORS.textDim }}>{g.rows.length.toLocaleString()}</td>
                            <td style={{ padding: "9px 12px", textAlign: "right", fontFamily: "'DM Mono', monospace", color: COLORS.accent3, fontWeight: 600 }}>{fmt(g.ingrC)}</td>
                            <td style={{ padding: "9px 12px", textAlign: "right", fontFamily: "'DM Mono', monospace", color: COLORS.danger }}>{fmt(g.egrsC)}</td>
                            <td style={{ padding: "9px 12px", textAlign: "right", fontFamily: "'DM Mono', monospace", color: g.margen >= 0 ? COLORS.accent3 : COLORS.danger, fontWeight: 600 }}>{fmt(g.margen)}</td>
                          </tr>
                          {expOpsGrp[expKey] && g.rows.slice(0, 300).map((r, i) => (
                            <tr key={`${g.svc}-${i}`} style={{ background: "#f1f5f9", borderBottom: `1px solid ${COLORS.border}` }}>
                              <td style={{ padding: "6px 12px" }}></td>
                              <td style={{ padding: "6px 12px", color: COLORS.textDim, fontSize: 10 }}>{r._cliente || "—"}</td>
                              <td style={{ padding: "6px 12px", fontFamily: "'DM Mono', monospace", color: COLORS.accent2, fontSize: 10 }}>{r._os || "—"}</td>
                              <td style={{ padding: "6px 12px", textAlign: "right", fontFamily: "'DM Mono', monospace", color: COLORS.accent3, fontSize: 10 }}>{fmt(r._ingrC)}</td>
                              <td style={{ padding: "6px 12px", textAlign: "right", fontFamily: "'DM Mono', monospace", color: COLORS.danger, fontSize: 10 }}>{fmt(r._egrsC)}</td>
                              <td style={{ padding: "6px 12px", textAlign: "right", fontFamily: "'DM Mono', monospace", color: r._margen >= 0 ? COLORS.accent3 : COLORS.danger, fontSize: 10 }}>{fmt(r._margen)}</td>
                            </tr>
                          ))}
                          {expOpsGrp[expKey] && g.rows.length > 300 && (
                            <tr style={{ background: "#f1f5f9" }}>
                              <td colSpan={6} style={{ padding: "6px 12px", textAlign: "center", color: COLORS.textDim, fontSize: 10 }}>Mostrando 300 de {g.rows.length} registros</td>
                            </tr>
                          )}
                        </>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </ChartCard>
          );
        })()}

        {/* BUSCAR OS */}
        {activeView === "os" && (
          <div>
            {/* Search input */}
            <div style={{ background: COLORS.card, border: `1px solid ${COLORS.border}`, borderRadius: 12, padding: "24px 28px", marginBottom: 20 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 8 }}>
                <span style={{ fontSize: 20 }}>🔎</span>
                <div>
                  <div style={{ fontSize: 14, fontWeight: 700, color: COLORS.text }}>Buscador de Orden de Servicio</div>
                  <div style={{ fontSize: 11, color: COLORS.textDim, marginTop: 2 }}>Ingresa el número de OS para ver su estado de facturación · busca en todos los registros del archivo</div>
                </div>
              </div>
              <div style={{ display: "flex", gap: 12, alignItems: "center", marginTop: 16 }}>
                <div style={{ position: "relative", flex: 1, maxWidth: 480 }}>
                  <input
                    value={osSearch}
                    onChange={(e) => setOsSearch(e.target.value)}
                    placeholder="Escribe el número de OS..."
                    autoFocus
                    style={{
                      width: "100%", background: "#eff6ff",
                      border: `2px solid ${osSearch ? COLORS.accent : COLORS.border}`,
                      color: COLORS.text, borderRadius: 10,
                      padding: "10px 40px 10px 16px", fontSize: 15,
                      outline: "none", transition: "all 0.2s",
                      fontFamily: "'DM Mono', monospace", letterSpacing: "0.04em",
                      boxSizing: "border-box",
                    }}
                  />
                  {osSearch && (
                    <button onClick={() => setOsSearch("")}
                      style={{ position: "absolute", right: 12, top: "50%", transform: "translateY(-50%)", background: "none", border: "none", color: COLORS.textDim, cursor: "pointer", fontSize: 16 }}>✕</button>
                  )}
                </div>
                {osSearch && (
                  <div style={{ fontSize: 13, fontWeight: 600 }}>
                    {osResults.length === 0
                      ? <span style={{ color: COLORS.danger }}>⚠ Sin resultados</span>
                      : <span style={{ color: COLORS.accent3 }}>✓ {osResults.length} registro{osResults.length !== 1 ? "s" : ""} encontrado{osResults.length !== 1 ? "s" : ""}</span>
                    }
                  </div>
                )}
              </div>
            </div>

            {/* Results table */}
            {osSearch && osResults.length > 0 && (
              <ChartCard title={`Resultados OS "${osSearch.toUpperCase()}" · ${osResults.length} registro${osResults.length !== 1 ? "s" : ""} · ${osResults.filter(r => r._facturaCliente && r._facturaCliente.trim() !== "").length} facturados · ${osResults.filter(r => !r._facturaCliente || r._facturaCliente.trim() === "").length} sin factura`}>
                <div style={{ overflowX: "auto" }}>
                  <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
                    <thead>
                      <tr style={{ borderBottom: `1px solid ${COLORS.border}` }}>
                        {["OS","SO","Fecha","Servicio","Destino","Cliente","Vuelo","Proveedor","Factura Cliente","Factura Prov.","Ingreso c/IVA","Egreso c/IVA","Facturado","Est. Cliente","Est. Prov."].map((h) => (
                          <th key={h} style={{ padding: "8px 12px", color: COLORS.textDim, fontWeight: 600, textAlign: ["Ingreso c/IVA","Egreso c/IVA"].includes(h) ? "right" : "left", fontSize: 10, textTransform: "uppercase", letterSpacing: "0.04em", whiteSpace: "nowrap" }}>{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {osResults.map((r, i) => {
                        const facturado = r._facturaCliente && r._facturaCliente.trim() !== "";
                        return (
                          <tr key={i} style={{ background: i % 2 === 0 ? COLORS.card : "#f8fafc", borderBottom: `1px solid ${COLORS.border}` }}>
                            <td style={{ padding: "9px 12px", fontFamily: "'DM Mono', monospace", color: COLORS.accent, fontWeight: 700, fontSize: 12 }}>{r._os || "—"}</td>
                            <td style={{ padding: "9px 12px", fontFamily: "'DM Mono', monospace", color: COLORS.accent2, fontSize: 11 }}>{r._os || "—"}</td>
                            <td style={{ padding: "9px 12px", color: COLORS.textDim, whiteSpace: "nowrap", fontSize: 11 }}>
                              {r._fecha ? r._fecha.toLocaleDateString("es-MX", { day: "2-digit", month: "short", year: "2-digit" }) : "—"}
                            </td>
                            <td style={{ padding: "9px 12px" }}>
                              <span style={{ fontSize: 10, background: "#e2e8f0", borderRadius: 4, padding: "2px 8px", color: r._servicio === "TRANSPORTE" ? COLORS.transporte : r._servicio === "PROTECCION" ? COLORS.proteccion : r._servicio === "RENTAS" ? COLORS.rentas : r._servicio === "CIRCUITOS" ? COLORS.circuitos : COLORS.equipajes }}>
                                {SERVICE_MAP[r._servicio] || r._servicio || "—"}
                              </span>
                            </td>
                            <td style={{ padding: "9px 12px", color: COLORS.textDim, fontSize: 11 }}>{DEST_MAP[r._destino] || r._destino || "—"}</td>
                            <td style={{ padding: "9px 12px", maxWidth: 160, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{r._cliente || "—"}</td>
                            <td style={{ padding: "9px 12px", color: COLORS.textDim, fontSize: 11 }}>{r["VUELO"] || "—"}</td>
                            <td style={{ padding: "9px 12px", maxWidth: 140, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", color: COLORS.textDim, fontSize: 11 }}>{r._proveedor || "—"}</td>
                            <td style={{ padding: "9px 12px", fontFamily: "'DM Mono', monospace", color: facturado ? COLORS.accent3 : COLORS.danger, fontSize: 11, fontWeight: facturado ? 600 : 400 }}>
                              {facturado ? r._facturaCliente : "Sin factura"}
                            </td>
                            <td style={{ padding: "9px 12px", fontFamily: "'DM Mono', monospace", color: COLORS.accent, fontSize: 11 }}>{r._facturaProv || "—"}</td>
                            <td style={{ padding: "9px 12px", textAlign: "right", fontFamily: "'DM Mono', monospace", color: COLORS.accent3, fontSize: 11 }}>{fmt(r._ingrC)}</td>
                            <td style={{ padding: "9px 12px", textAlign: "right", fontFamily: "'DM Mono', monospace", color: COLORS.danger, fontSize: 11 }}>{fmt(r._egrsC)}</td>
                            <td style={{ padding: "9px 12px" }}>
                              {facturado
                                ? <span style={{ background: "#dcfce7", color: COLORS.accent3, borderRadius: 5, padding: "3px 10px", fontSize: 11, fontWeight: 700 }}>✓ Facturado</span>
                                : <span style={{ background: "#fee2e2", color: COLORS.danger, borderRadius: 5, padding: "3px 10px", fontSize: 11, fontWeight: 700 }}>✗ Sin facturar</span>
                              }
                            </td>
                            <td style={{ padding: "9px 12px" }}><StatusBadge status={r["ESTADO CLIENTE"]} /></td>
                            <td style={{ padding: "9px 12px" }}><StatusBadge status={r["ESTADO PROVEEDOR"]} /></td>
                          </tr>
                        );
                      })}
                    </tbody>
                    <tfoot>
                      <tr style={{ borderTop: `2px solid ${COLORS.border}`, background: "#f1f5f9" }}>
                        <td colSpan={10} style={{ padding: "9px 12px", fontSize: 11, fontWeight: 700, color: COLORS.textDim }}>
                          TOTAL
                        </td>
                        <td style={{ padding: "9px 12px", textAlign: "right", fontFamily: "'DM Mono', monospace", color: COLORS.accent3, fontWeight: 700 }}>{fmt(osResults.reduce((s,r) => s + r._ingrC, 0))}</td>
                        <td style={{ padding: "9px 12px", textAlign: "right", fontFamily: "'DM Mono', monospace", color: COLORS.danger, fontWeight: 700 }}>{fmt(osResults.reduce((s,r) => s + r._egrsC, 0))}</td>
                        <td colSpan={3} />
                      </tr>
                    </tfoot>
                  </table>
                </div>
              </ChartCard>
            )}

            {/* Empty state */}
            {!osSearch && (
              <div style={{ textAlign: "center", padding: "60px 20px", color: COLORS.textDim }}>
                <div style={{ fontSize: 48, marginBottom: 16 }}>📋</div>
                <div style={{ fontSize: 15, fontWeight: 600, color: COLORS.text, marginBottom: 8 }}>Busca una Orden de Servicio</div>
                <div style={{ fontSize: 12 }}>Escribe el número de OS para verificar si está facturada o no</div>
              </div>
            )}

            {osSearch && osResults.length === 0 && (
              <div style={{ textAlign: "center", padding: "60px 20px", color: COLORS.textDim }}>
                <div style={{ fontSize: 48, marginBottom: 16 }}>🔍</div>
                <div style={{ fontSize: 15, fontWeight: 600, color: COLORS.danger, marginBottom: 8 }}>OS no encontrada</div>
                <div style={{ fontSize: 12 }}>No hay registros con OS "{osSearch}" en el archivo cargado</div>
              </div>
            )}
          </div>
        )}

      </div>
    </div>
  );
}

// ─── PREVIEW MODAL (resumen antes de confirmar) ──────────────────────────────
function UploadPreviewModal({ preview, existingCount, onConfirm, onCancel, saving, savingMsg }) {
  if (!preview) return null;
  const { rows, fileName } = preview;
  const totalIngr = rows.reduce((s, r) => s + r._ingrC, 0);
  const totalEgrs = rows.reduce((s, r) => s + r._egrsC, 0);
  const totalMargen = rows.reduce((s, r) => s + r._margen, 0);
  const servicios = {};
  const destinos = {};
  const clientes = new Set();
  let fechaMin = null, fechaMax = null;
  rows.forEach(r => {
    servicios[r._servicio] = (servicios[r._servicio] || 0) + 1;
    destinos[r._destino] = (destinos[r._destino] || 0) + 1;
    if (r._cliente) clientes.add(r._cliente);
    if (r._fecha) {
      if (!fechaMin || r._fecha < fechaMin) fechaMin = r._fecha;
      if (!fechaMax || r._fecha > fechaMax) fechaMax = r._fecha;
    }
  });
  const fmtD = d => d ? d.toLocaleDateString("es-MX", { day: "2-digit", month: "short", year: "numeric" }) : "—";

  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)", zIndex: 2000, display: "flex", alignItems: "center", justifyContent: "center", padding: 24, backdropFilter: "blur(4px)" }}>
      <div style={{ background: "#fff", borderRadius: 20, width: "100%", maxWidth: 580, boxShadow: "0 24px 60px rgba(0,0,0,0.25)", overflow: "hidden" }}>
        {/* Header */}
        <div style={{ padding: "20px 28px", borderBottom: "1px solid #e2e8f0", background: "#f8fafc" }}>
          <div style={{ fontSize: 18, fontWeight: 700, color: "#0f172a" }}>📋 Resumen de Importación</div>
          <div style={{ fontSize: 12, color: "#64748b", marginTop: 4 }}>Archivo: {fileName}</div>
        </div>

        {/* Body */}
        <div style={{ padding: "20px 28px" }}>
          {existingCount > 0 && (
            <div style={{ background: "#eff6ff", border: "1px solid #93c5fd", borderRadius: 10, padding: "10px 14px", marginBottom: 16, fontSize: 13, color: "#1e40af" }}>
              ⚠️ Ya tienes <b>{existingCount}</b> registros en la base. Se reemplazarán con los {rows.length.toLocaleString()} del nuevo Excel.
            </div>
          )}

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 16 }}>
            <div style={{ background: "#f8fafc", borderRadius: 10, padding: "12px 16px", border: "1px solid #e2e8f0" }}>
              <div style={{ fontSize: 11, color: "#64748b", textTransform: "uppercase", letterSpacing: "0.05em" }}>Registros nuevos</div>
              <div style={{ fontSize: 24, fontWeight: 700, color: "#0f172a", marginTop: 4 }}>{rows.length.toLocaleString()}</div>
            </div>
            <div style={{ background: "#f8fafc", borderRadius: 10, padding: "12px 16px", border: "1px solid #e2e8f0" }}>
              <div style={{ fontSize: 11, color: "#64748b", textTransform: "uppercase", letterSpacing: "0.05em" }}>Clientes únicos</div>
              <div style={{ fontSize: 24, fontWeight: 700, color: "#0f172a", marginTop: 4 }}>{clientes.size}</div>
            </div>
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 10, marginBottom: 16 }}>
            <div style={{ textAlign: "center", padding: "10px 8px", background: "#f0fdf4", borderRadius: 10, border: "1px solid #bbf7d0" }}>
              <div style={{ fontSize: 10, color: "#15803d", fontWeight: 600 }}>INGRESOS</div>
              <div style={{ fontSize: 14, fontWeight: 700, color: "#166534", marginTop: 2 }}>{fmt(totalIngr)}</div>
            </div>
            <div style={{ textAlign: "center", padding: "10px 8px", background: "#fef2f2", borderRadius: 10, border: "1px solid #fecaca" }}>
              <div style={{ fontSize: 10, color: "#dc2626", fontWeight: 600 }}>EGRESOS</div>
              <div style={{ fontSize: 14, fontWeight: 700, color: "#991b1b", marginTop: 2 }}>{fmt(totalEgrs)}</div>
            </div>
            <div style={{ textAlign: "center", padding: "10px 8px", background: "#eff6ff", borderRadius: 10, border: "1px solid #93c5fd" }}>
              <div style={{ fontSize: 10, color: "#1d4ed8", fontWeight: 600 }}>MARGEN</div>
              <div style={{ fontSize: 14, fontWeight: 700, color: "#1e3a5f", marginTop: 2 }}>{fmt(totalMargen)}</div>
            </div>
          </div>

          <div style={{ fontSize: 12, color: "#64748b", marginBottom: 8 }}>
            <b>Periodo:</b> {fmtD(fechaMin)} → {fmtD(fechaMax)}
          </div>

          {/* Servicios breakdown */}
          <div style={{ fontSize: 12, color: "#64748b", marginBottom: 6 }}><b>Por servicio:</b></div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 16 }}>
            {Object.entries(servicios).sort((a, b) => b[1] - a[1]).map(([svc, cnt]) => (
              <span key={svc} style={{ background: "#f1f5f9", border: "1px solid #e2e8f0", borderRadius: 6, padding: "3px 10px", fontSize: 11, fontWeight: 600 }}>
                {SERVICE_MAP[svc] || svc}: {cnt}
              </span>
            ))}
          </div>

          {/* Destinos breakdown */}
          <div style={{ fontSize: 12, color: "#64748b", marginBottom: 6 }}><b>Por destino:</b></div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 20 }}>
            {Object.entries(destinos).sort((a, b) => b[1] - a[1]).map(([dest, cnt]) => (
              <span key={dest} style={{ background: "#f1f5f9", border: "1px solid #e2e8f0", borderRadius: 6, padding: "3px 10px", fontSize: 11, fontWeight: 600 }}>
                {DEST_MAP[dest] || dest}: {cnt}
              </span>
            ))}
          </div>
        </div>

        {/* Footer */}
        <div style={{ padding: "16px 28px", borderTop: "1px solid #e2e8f0", display: "flex", justifyContent: "flex-end", gap: 10, background: "#f8fafc" }}>
          <button onClick={onCancel} disabled={saving} style={{ padding: "10px 24px", borderRadius: 10, border: "1px solid #e2e8f0", background: "#fff", color: "#64748b", fontWeight: 600, fontSize: 14, cursor: "pointer", fontFamily: "inherit" }}>
            Cancelar
          </button>
          <button onClick={onConfirm} disabled={saving} style={{ padding: "10px 28px", borderRadius: 10, border: "none", background: saving ? "#94a3b8" : "#059669", color: "#fff", fontWeight: 700, fontSize: 14, cursor: saving ? "wait" : "pointer", fontFamily: "inherit", transition: "background 0.15s" }}>
            {saving ? (savingMsg || "Guardando…") : `✓ Confirmar y Guardar ${rows.length.toLocaleString()} registros`}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── MAIN EXPORT (integrated with Supabase) ──────────────────────────────────
export default function BromeliaView({ empresaId, user }) {
  const [data, setData] = useState(null);
  const [fileName, setFileName] = useState("Supabase");
  const [loading, setLoading] = useState(true);
  const [loadingCount, setLoadingCount] = useState(0);
  const [error, setError] = useState(null);
  const [preview, setPreview] = useState(null);   // { rows, fileName }
  const [saving, setSaving] = useState(false);
  const [savingMsg, setSavingMsg] = useState("");
  const [uploadMsg, setUploadMsg] = useState(null); // { type, text }

  // ── Load from Supabase on mount ──
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setLoadingCount(0);
    fetchBromeliaData(empresaId, (count) => {
      if (!cancelled) setLoadingCount(count);
    }).then(rows => {
      if (cancelled) return;
      if (rows.length > 0) {
        setData(rows);
        setFileName(`Supabase · ${rows.length.toLocaleString()} registros`);
      }
      setLoading(false);
    }).catch(err => {
      if (!cancelled) { setError("Error cargando datos: " + err); setLoading(false); }
    });
    return () => { cancelled = true; };
  }, [empresaId]);

  // ── Handle file: parse and show preview (NOT save yet) ──
  const handleFile = useCallback(async (file) => {
    setError(null);
    setUploadMsg(null);
    try {
      const raw = await parseXLSX(file);
      const processed = processData(raw);
      setPreview({ rows: processed, fileName: file.name });
    } catch (e) {
      setError(`Error procesando archivo: ${e}`);
    }
  }, []);

  // ── Confirm: save to Supabase, then reload ──
  const handleConfirm = useCallback(async () => {
    if (!preview) return;
    setSaving(true);
    setSavingMsg("Preparando registros…");
    try {
      const result = await upsertBromeliaData(
        preview.rows, empresaId, user?.username || user?.nombre || null,
        ({ batchNum, totalBatches, inserted, errors, phase }) => {
          setSavingMsg(phase ? `${phase} · ${inserted.toLocaleString()} guardados${errors > 0 ? ` · ${errors} errores` : ''}` : 'Preparando…');
        }
      );
      if (result.errors > 0 && result.inserted === 0) {
        // Todo falló — mostrar error real
        setUploadMsg({ type: "error", text: `❌ Error al guardar: ${result.errorMsg || 'Error desconocido'}. Revisa la consola (F12) para más detalles.` });
        setPreview(null);
      } else {
        setSavingMsg("Recargando datos…");
        const fresh = await fetchBromeliaData(empresaId);
        setData(fresh);
        setFileName(`Supabase · ${fresh.length.toLocaleString()} registros`);
        setPreview(null);
        const parts = [`${result.inserted.toLocaleString()} registros guardados`];
        if (result.errors > 0) parts.push(`${result.errors} errores`);
        setUploadMsg({ type: result.errors > 0 ? "warn" : "ok", text: `✅ ${parts.join(' · ')}` });
      }
      setTimeout(() => setUploadMsg(null), 10000);
    } catch (e) {
      setUploadMsg({ type: "error", text: `❌ Error: ${e.message || e}` });
    } finally {
      setSaving(false);
      setSavingMsg("");
    }
  }, [preview, empresaId, user]);

  // ── Cancel preview ──
  const handleCancel = useCallback(() => {
    setPreview(null);
  }, []);

  // ── Reload from Supabase (reset) ──
  const handleReset = useCallback(async () => {
    setLoading(true);
    setLoadingCount(0);
    const rows = await fetchBromeliaData(empresaId, (count) => setLoadingCount(count));
    if (rows.length > 0) {
      setData(rows);
      setFileName(`Supabase · ${rows.length.toLocaleString()} registros`);
    } else {
      setData(null);
      setFileName("");
    }
    setLoading(false);
  }, [empresaId]);

  if (loading) return (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "center", minHeight: 400, fontFamily: "'Sora', sans-serif" }}>
      <div style={{ textAlign: "center" }}>
        <div style={{ fontSize: 36, marginBottom: 12 }}>🌸</div>
        <div style={{ fontSize: 15, color: "#64748b" }}>Cargando datos Bromelia…</div>
        {loadingCount > 0 && <div style={{ fontSize: 13, color: "#94a3b8", marginTop: 6 }}>{loadingCount.toLocaleString()} registros cargados</div>}
      </div>
    </div>
  );

  return (
    <div style={{ fontFamily: "'Sora', sans-serif" }}>
      <link href="https://fonts.googleapis.com/css2?family=Sora:wght@300;400;500;600;700&family=DM+Mono:wght@400;500&display=swap" rel="stylesheet" />

      {/* Upload message banner */}
      {uploadMsg && (
        <div style={{ padding: "10px 20px", background: uploadMsg.type === "ok" ? "#f0fdf4" : "#fef2f2", border: `1px solid ${uploadMsg.type === "ok" ? "#bbf7d0" : "#fecaca"}`, borderRadius: 10, marginBottom: 16, fontSize: 13, fontWeight: 600, color: uploadMsg.type === "ok" ? "#166534" : "#991b1b" }}>
          {uploadMsg.text}
        </div>
      )}

      {/* If no data: show upload zone inline */}
      {!data && (
        <UploadZone onFile={handleFile} loading={false} error={error} />
      )}

      {/* If data exists: show dashboard with upload button */}
      {data && (
        <Dashboard data={data} fileName={fileName} onReset={handleReset} onUpload={handleFile} />
      )}

      {/* Preview modal */}
      {preview && (
        <UploadPreviewModal
          preview={preview}
          existingCount={data ? data.length : 0}
          onConfirm={handleConfirm}
          onCancel={handleCancel}
          saving={saving}
          savingMsg={savingMsg}
        />
      )}
    </div>
  );
}
