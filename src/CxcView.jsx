import { useState, useMemo, useRef } from "react";
import * as XLSX from "xlsx";
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  PieChart, Pie, Cell,
} from "recharts";
import {
  upsertIngreso, deleteIngreso as deleteIngresoDB,
  insertCobro, deleteCobro as deleteCobro_DB,
  upsertInvoiceIngreso, deleteInvoiceIngreso as deleteInvoiceIngresoDB,
  upsertCategoriaIngreso, deleteCategoriaIngreso as deleteCategoriaIngresoDB,
  updateIngresoField,
} from "./db.js";

/* ── Palette (same as CxpApp) ──────────────────────────────────────────── */
const C = {
  navy:"#0F2D4A", blue:"#1565C0", sky:"#2196F3", teal:"#00897B",
  cream:"#FAFBFC", surface:"#FFFFFF", border:"#E2E8F0", muted:"#64748B",
  text:"#1A2332", danger:"#E53935", warn:"#F59E0B", ok:"#43A047",
  mxn:"#1565C0", usd:"#2E7D32", eur:"#6A1B9A",
  green:"#1B5E20",
};

/* ── Styles ────────────────────────────────────────────────────────────── */
const inputStyle = { padding:"8px 12px", borderRadius:8, border:"1px solid #E2E8F0", fontSize:14, outline:"none", background:"#FAFBFC", width:"100%", fontFamily:"inherit", color:"#1A2332", boxSizing:"border-box" };
const selectStyle = { ...inputStyle, cursor:"pointer" };
const btnStyle = { padding:"9px 20px", borderRadius:10, border:"none", background:"#1565C0", color:"#fff", fontWeight:700, fontSize:14, cursor:"pointer", fontFamily:"inherit", whiteSpace:"nowrap" };
const iconBtn = { background:"none", border:"none", cursor:"pointer", fontSize:16, padding:"4px 6px" };

/* ── Helpers ───────────────────────────────────────────────────────────── */
const fmt = n => isNaN(n)||n===""||n===null ? "—" : new Intl.NumberFormat("es-MX",{minimumFractionDigits:2,maximumFractionDigits:2}).format(+n);
const today = () => new Date().toISOString().split("T")[0];
const uid = () => Math.random().toString(36).slice(2,10);
const addDays = (ds, d) => { if(!ds||!d) return ""; const x=new Date(ds+"T12:00:00"); x.setDate(x.getDate()+ +d); return x.toISOString().split("T")[0]; };

const DEFAULT_CATS = ["Circuito","Reprotección","Excursión","Venta Individual","Otro"];
const CAT_COLORS = {
  "Circuito": { bg:"#E3F2FD", border:"#90CAF9", text:"#1565C0" },
  "Reprotección": { bg:"#FFEBEE", border:"#EF9A9A", text:"#C62828" },
  "Excursión": { bg:"#E8F5E9", border:"#A5D6A7", text:"#2E7D32" },
  "Venta Individual": { bg:"#FFF8E1", border:"#FFE082", text:"#F57F17" },
  "Otro": { bg:"#F3F4F6", border:"#D1D5DB", text:"#374151" },
};
const getCatStyle = (cat) => CAT_COLORS[cat] || { bg:"#F3F4F6", border:"#D1D5DB", text:"#374151" };
const monedaSym = (m) => m === "EUR" ? "€" : "$";

/* ── Reusable small components ──────────────────────────────────────────── */
const Field = ({label, children}) => (
  <div style={{marginBottom:16}}>
    <label style={{display:"block",fontSize:12,fontWeight:700,color:C.muted,textTransform:"uppercase",letterSpacing:.4,marginBottom:6}}>{label}</label>
    {children}
  </div>
);

const ModalShell = ({title,onClose,wide,extraWide,children}) => (
  <div style={{position:"fixed",inset:0,background:"rgba(15,45,74,.45)",display:"flex",alignItems:"center",justifyContent:"center",zIndex:2000,padding:20}} onClick={onClose}>
    <div onClick={e=>e.stopPropagation()} style={{background:C.surface,borderRadius:20,padding:32,width:"100%",maxWidth:extraWide?1200:wide?860:600,maxHeight:"92vh",overflowY:"auto",boxShadow:"0 20px 60px rgba(0,0,0,.25)"}}>
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:24}}>
        <h2 style={{fontSize:20,fontWeight:800,color:C.navy,margin:0}}>{title}</h2>
        <button onClick={onClose} style={{background:"#F1F5F9",border:"none",borderRadius:8,width:36,height:36,cursor:"pointer",fontSize:18}}>×</button>
      </div>
      {children}
    </div>
  </div>
);

const KpiCard = ({label,value,sub,color=C.navy,icon,bg}) => (
  <div style={{background:bg||C.surface,borderRadius:16,padding:"18px 22px",border:`1px solid ${C.border}`,boxShadow:"0 2px 8px rgba(0,0,0,.05)",flex:1,minWidth:150}}>
    <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start"}}>
      <div>
        <div style={{fontSize:11,color:C.muted,fontWeight:700,textTransform:"uppercase",letterSpacing:.5}}>{label}</div>
        <div style={{fontSize:22,fontWeight:800,color,marginTop:4}}>{value}</div>
        {sub && <div style={{fontSize:11,color:C.muted,marginTop:2}}>{sub}</div>}
      </div>
      <div style={{fontSize:26}}>{icon}</div>
    </div>
  </div>
);

/* ══════════════════════════════════════════════════════════════════════════
   MAIN CxC VIEW COMPONENT
   ══════════════════════════════════════════════════════════════════════════ */
export default function CxcView({
  invoices, payments,
  ingresos, setIngresos,
  cobros, setCobros,
  invoiceIngresos, setInvoiceIngresos,
  categorias, setCategorias,
  empresaId,
  clientes = [],
}) {
  /* ── Filters ───────────────────────────────────────────────── */
  const [filtroCliente, setFiltroCliente] = useState("");
  const [filtroCategoria, setFiltroCategoria] = useState("");
  const [filtroMoneda, setFiltroMoneda] = useState("");
  const [filtroFechaFrom, setFiltroFechaFrom] = useState("");
  const [filtroFechaTo, setFiltroFechaTo] = useState("");
  const [filtroSearch, setFiltroSearch] = useState("");
  const [filtroCobro, setFiltroCobro] = useState("");
  const [filtroMesContable, setFiltroMesContable] = useState("");
  const [filtroSegmento, setFiltroSegmento] = useState(""); // "" | "cobrado" | "porCobrar"

  /* ── Modals ────────────────────────────────────────────────── */
  const [modalIngreso, setModalIngreso] = useState(null);
  const [detailIngreso, setDetailIngreso] = useState(null);
  const [deleteConfirm, setDeleteConfirm] = useState(null);
  const [configCats, setConfigCats] = useState(false);
  const [newCatInput, setNewCatInput] = useState("");
  const [proyeccionView, setProyeccionView] = useState(false);
  const [calDayDetail, setCalDayDetail] = useState(null);
  const [kpiModal, setKpiModal] = useState(null); // { titulo, tipo, moneda }
  const [vistaGrupo, setVistaGrupo] = useState("cliente"); // "ingreso" | "cliente"
  const [clientesExpanded, setClientesExpanded] = useState(new Set());
  const [importModal, setImportModal] = useState(false);
  const [importPreview, setImportPreview] = useState(null); // { rows, dupes, catDefault }
  const [importCatDefault, setImportCatDefault] = useState("");
  const [importando, setImportando] = useState(false);
  const importRef = useRef();
  const tasImportRef = useRef();
  const [selectedIngresos, setSelectedIngresos] = useState(new Set());
  const [bulkFechaModal, setBulkFechaModal] = useState(false);
  const [cobroMasivoModal, setCobroMasivoModal] = useState(false);
  const [sortCol, setSortCol] = useState("fecha");
  const [sortDir, setSortDir] = useState("desc");
  const [tasModal, setTasModal] = useState(false);
  const [tasPreview, setTasPreview] = useState(null); // {rows, dupes}
  const [tasCatDefault, setTasCatDefault] = useState("");
  const [tasImportando, setTasImportando] = useState(false);

  /* ── Derived data ──────────────────────────────────────────── */
  const allInvoices = useMemo(() => [
    ...invoices.MXN.map(i=>({...i,moneda:"MXN"})),
    ...invoices.USD.map(i=>({...i,moneda:"USD"})),
    ...invoices.EUR.map(i=>({...i,moneda:"EUR"})),
  ], [invoices]);

  // Days diff helper
  const diasDiff = (fechaStr) => {
    if (!fechaStr) return null;
    const hoy = new Date(); hoy.setHours(0,0,0,0);
    const f = new Date(fechaStr+"T12:00:00");
    return Math.round((f - hoy) / 86400000);
  };

  // Segmentos únicos para filtro
  const segmentosList = useMemo(() => {
    const s = new Set(ingresos.map(i=>i.segmento).filter(Boolean));
    return [...s].sort();
  }, [ingresos]);

  // Meses únicos de fechaContable para filtro "Mes de Venta"
  const MESES_NOMBRES = ["Enero","Febrero","Marzo","Abril","Mayo","Junio","Julio","Agosto","Septiembre","Octubre","Noviembre","Diciembre"];
  const mesesContableList = useMemo(() => {
    const s = new Set();
    ingresos.forEach(i => {
      if (i.fechaContable) s.add(i.fechaContable.slice(0,7)); // YYYY-MM
    });
    return [...s].sort();
  }, [ingresos]);

  const catList = categorias.length > 0 ? categorias.map(c=>c.nombre) : DEFAULT_CATS;
  const clientesList = [...new Set(ingresos.map(i=>i.cliente))].filter(Boolean).sort();

  /* TC conversion: everything to ingreso's currency
     TC in ingresos = "cuántos MXN vale 1 USD/EUR"
     e.g. ingreso USD at TC=20.5 → 1 USD = 20.5 MXN
  */
  const convertToMonedaIngreso = (monto, monedaFactura, ingreso) => {
    if (!monto || monto === 0) return 0;
    const mi = ingreso.moneda;
    const mf = monedaFactura;
    const tc = ingreso.tipoCambio || 1;
    if (mi === mf) return monto;
    // To MXN from foreign: monto * tc
    if (mi === "MXN" && (mf === "USD" || mf === "EUR")) return monto * tc;
    // To foreign from MXN: monto / tc
    if ((mi === "USD" || mi === "EUR") && mf === "MXN") return monto / tc;
    // USD <-> EUR: use tc as best approximation
    return monto;
  };

  /* Per-ingreso computed metrics */
  const metrics = useMemo(() => {
    const result = {};
    ingresos.forEach(ing => {
      const ingCobros         = cobros.filter(c => c.ingresoId === ing.id);
      const cobrosRealizados  = ingCobros.filter(c => c.tipo !== 'proyectado');
      const cobrosProyectados = ingCobros.filter(c => c.tipo === 'proyectado');
      const totalCobrado      = cobrosRealizados.reduce((s,c) => s+c.monto, 0);
      const totalProyectado   = cobrosProyectados.reduce((s,c) => s+c.monto, 0);
      const porCobrar         = Math.max(0, ing.monto - totalCobrado);

      const vincs = invoiceIngresos.filter(v => v.ingresoId === ing.id);
      let consumido = 0;
      let porPagar  = 0;
      let comprometido = 0;

      vincs.forEach(v => {
        const inv = allInvoices.find(i => i.id === v.invoiceId);
        if (!inv) return;
        const converted = convertToMonedaIngreso(v.montoAsignado, inv.moneda, ing);
        comprometido += converted;
        if (inv.estatus === "Pagado") {
          consumido += converted;
        } else if (inv.estatus === "Parcial") {
          const ratio = (+inv.total||0) > 0 ? (+inv.montoPagado||0)/(+inv.total||0) : 0;
          consumido += converted * ratio;
          porPagar  += converted * (1 - ratio);
        } else {
          porPagar += converted;
        }
      });

      const disponible = totalCobrado - consumido;
      result[ing.id] = {
        totalCobrado,
        totalProyectado,
        porCobrar,
        consumido,
        porPagar,
        comprometido,
        disponible,
        disponibleNeto: disponible - porPagar,
        vinculaciones: vincs.length,
      };
    });
    return result;
  }, [ingresos, cobros, invoiceIngresos, allInvoices]);

  /* KPIs globales */
  const kpis = useMemo(() => {
    const byMon = {
      MXN:{monto:0,cobrado:0,porCobrar:0,consumido:0,porPagar:0,disponible:0,disponibleNeto:0},
      USD:{monto:0,cobrado:0,porCobrar:0,consumido:0,porPagar:0,disponible:0,disponibleNeto:0},
      EUR:{monto:0,cobrado:0,porCobrar:0,consumido:0,porPagar:0,disponible:0,disponibleNeto:0},
    };
    ingresos.forEach(ing => {
      const m = metrics[ing.id] || {};
      const k = byMon[ing.moneda] || byMon.MXN;
      k.monto         += ing.monto;
      k.cobrado       += m.totalCobrado||0;
      k.porCobrar     += m.porCobrar||0;
      k.consumido     += m.consumido||0;
      k.porPagar      += m.porPagar||0;
      k.disponible    += m.disponible||0;
      k.disponibleNeto+= m.disponibleNeto||0;
    });
    return byMon;
  }, [ingresos, metrics]);

  /* Filtered ingresos */
  const filtered = useMemo(() => {
    return ingresos.filter(ing => {
      if (filtroSearch) {
        const q = filtroSearch.toLowerCase();
        if (!(ing.cliente+ing.concepto+ing.categoria+(ing.segmento||"")).toLowerCase().includes(q)) return false;
      }
      if (filtroCliente && ing.cliente !== filtroCliente) return false;
      if (filtroCategoria && ing.categoria !== filtroCategoria) return false;
      if (filtroMoneda && ing.moneda !== filtroMoneda) return false;
      if (filtroFechaFrom && ing.fecha && ing.fecha < filtroFechaFrom) return false;
      if (filtroFechaTo && ing.fecha && ing.fecha > filtroFechaTo) return false;
      if (filtroCobro === "cobrado") { const m=metrics[ing.id]||{}; if((m.totalCobrado||0)<=0) return false; }
      if (filtroCobro === "porCobrar") { const m=metrics[ing.id]||{}; if((m.porCobrar||0)<=0) return false; }
      if (filtroMesContable && ing.fechaContable && !ing.fechaContable.startsWith(filtroMesContable)) return false;
      if (filtroMesContable && !ing.fechaContable) return false;
      if (filtroSegmento && ing.segmento !== filtroSegmento) return false;
      return true;
    });
  }, [ingresos, filtroSearch, filtroCliente, filtroCategoria, filtroMoneda, filtroFechaFrom, filtroFechaTo, filtroCobro, filtroMesContable, filtroSegmento, metrics]);

  /* Agrupado por cliente */
  const groupedByCliente = useMemo(() => {
    const map = {};
    filtered.forEach(ing => {
      if (!map[ing.cliente]) map[ing.cliente] = [];
      map[ing.cliente].push(ing);
    });
    return Object.entries(map).sort((a,b) => a[0].localeCompare(b[0]));
  }, [filtered]);

  /* Sorted filtered list */
  const sortedFiltered = useMemo(() => {
    const getVal = (ing, col) => {
      const m = metrics[ing.id] || {};
      switch(col) {
        case 'cliente':        return ing.cliente||"";
        case 'folio':          return ing.folio||"";
        case 'segmento':       return ing.segmento||"";
        case 'fechaContable':  return ing.fechaContable||"";
        case 'fecha':          return ing.fecha||"";
        case 'fechaVencimiento': return ing.fechaVencimiento||"";
        case 'fechaFicticia':  return ing.fechaFicticia||"";
        case 'monto':          return ing.monto||0;
        case 'cobrado':        return m.totalCobrado||0;
        case 'porCobrar':      return m.porCobrar||0;
        case 'consumido':      return m.consumido||0;
        case 'porPagar':       return m.porPagar||0;
        case 'disponible':     return m.disponible||0;
        case 'disponibleNeto': return m.disponibleNeto||0;
        case 'diasVencidos': {
          const d = diasDiff(ing.fechaVencimiento);
          return d !== null && d < 0 ? Math.abs(d) : 0;
        }
        default: return "";
      }
    };
    return [...filtered].sort((a,b) => {
      const va = getVal(a, sortCol);
      const vb = getVal(b, sortCol);
      let cmp = typeof va === 'number' ? va - vb : String(va).localeCompare(String(vb));
      return sortDir === 'asc' ? cmp : -cmp;
    });
  }, [filtered, sortCol, sortDir, metrics]);

  /* Totals of filtered (for footer) */
  const filteredTotals = useMemo(() => {
    const t = {};
    ['MXN','USD','EUR'].forEach(mon => {
      const rows = filtered.filter(i => i.moneda === mon);
      if (!rows.length) return;
      t[mon] = {
        monto: rows.reduce((s,i) => s + i.monto, 0),
        cobrado: rows.reduce((s,i) => s + (metrics[i.id]?.totalCobrado||0), 0),
        porCobrar: rows.reduce((s,i) => s + (metrics[i.id]?.porCobrar||0), 0),
        consumido: rows.reduce((s,i) => s + (metrics[i.id]?.consumido||0), 0),
        porPagar: rows.reduce((s,i) => s + (metrics[i.id]?.porPagar||0), 0),
        disponible: rows.reduce((s,i) => s + (metrics[i.id]?.disponible||0), 0),
        disponibleNeto: rows.reduce((s,i) => s + (metrics[i.id]?.disponibleNeto||0), 0),
      };
    });
    return t;
  }, [filtered, metrics]);

  /* Totals of selected */
  const selectedTotals = useMemo(() => {
    const t = {};
    ['MXN','USD','EUR'].forEach(mon => {
      const rows = filtered.filter(i => i.moneda === mon && selectedIngresos.has(i.id));
      if (!rows.length) return;
      t[mon] = {
        monto: rows.reduce((s,i) => s + i.monto, 0),
        cobrado: rows.reduce((s,i) => s + (metrics[i.id]?.totalCobrado||0), 0),
        porCobrar: rows.reduce((s,i) => s + (metrics[i.id]?.porCobrar||0), 0),
      };
    });
    return t;
  }, [filtered, selectedIngresos, metrics]);

  const handleSort = (col) => {
    if (sortCol === col) setSortDir(d => d === 'asc' ? 'desc' : 'asc');
    else { setSortCol(col); setSortDir('asc'); }
  };
  const sortIcon = (col) => sortCol === col ? (sortDir === 'asc' ? ' ▲' : ' ▼') : '';

  /* ── CRUD Handlers ─────────────────────────────────────────── */
  const saveIngreso = async (data) => {
    const saved = await upsertIngreso({ ...data, empresaId });
    setIngresos(prev => {
      const exists = prev.find(i => i.id === saved.id);
      if (exists) return prev.map(i => i.id === saved.id ? saved : i);
      return [saved, ...prev];
    });
    setModalIngreso(null);
  };

  const handleDeleteIngreso = async () => {
    if (!deleteConfirm) return;
    await deleteIngresoDB(deleteConfirm.id);
    setIngresos(prev => prev.filter(i => i.id !== deleteConfirm.id));
    setInvoiceIngresos(prev => prev.filter(v => v.ingresoId !== deleteConfirm.id));
    setCobros(prev => prev.filter(c => c.ingresoId !== deleteConfirm.id));
    setDeleteConfirm(null);
    if (detailIngreso === deleteConfirm.id) setDetailIngreso(null);
  };

  const addCobro = async (ingresoId, monto, fechaCobro, notas, tipo = 'realizado') => {
    const saved = await insertCobro({ ingresoId, monto:+monto, fechaCobro, notas, tipo });
    setCobros(prev => [saved, ...prev]);
  };

  const removeCobro = async (id) => {
    await deleteCobro_DB(id);
    setCobros(prev => prev.filter(c => c.id !== id));
  };

  const addCategoria = async () => {
    const nombre = newCatInput.trim();
    if (!nombre || catList.includes(nombre)) return;
    const saved = await upsertCategoriaIngreso(nombre);
    if (saved) setCategorias(prev => [...prev, saved]);
    else setCategorias(prev => [...prev, { id: uid(), nombre }]);
    setNewCatInput("");
  };

  const removeCategoria = async (cat) => {
    const found = categorias.find(c => c.nombre === cat);
    if (found) await deleteCategoriaIngresoDB(found.id);
    setCategorias(prev => prev.filter(c => c.nombre !== cat));
  };

  /* ── Toggle cliente expandido ──────────────────────────────── */
  const toggleCliente = (nombre) => {
    setClientesExpanded(prev => {
      const n = new Set(prev);
      if (n.has(nombre)) n.delete(nombre); else n.add(nombre);
      return n;
    });
  };

  /* ── Excel import handler ──────────────────────────────────── */
  const parseExcelDate = v => {
    if (!v) return "";
    if (v instanceof Date) return v.toISOString().split("T")[0];
    if (typeof v === "number") {
      const d = new Date(Math.round((v - 25569) * 86400000));
      return d.toISOString().split("T")[0];
    }
    const s = String(v);
    // dd/mm/yyyy or dd-mm-yyyy
    const m = s.match(/(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})/);
    if (m) return `${m[3].length===2?"20"+m[3]:m[3]}-${m[2].padStart(2,"0")}-${m[1].padStart(2,"0")}`;
    return s;
  };

  const handleImportFile = (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = ev => {
      try {
        const wb = XLSX.read(ev.target.result, { type:"array" });
        const ws = wb.Sheets[wb.SheetNames[0]];
        const rows = XLSX.utils.sheet_to_json(ws, { header:1 });

        // Find header row
        let hi = rows.findIndex(r => r.some(c => String(c||"").toUpperCase().includes("RECEPTOR") || String(c||"").toUpperCase().includes("CLIENTE")));
        if (hi < 0) hi = 0;
        const headers = rows[hi].map(h => String(h||"").trim().toUpperCase());

        const get = (row, keys) => {
          for (const k of keys) {
            const idx = headers.findIndex(h => h.includes(k));
            if (idx >= 0 && row[idx] !== undefined && row[idx] !== null && row[idx] !== "") return row[idx];
          }
          return "";
        };

        const cleanNum = v => {
          if (!v && v !== 0) return 0;
          if (typeof v === "number") return v;
          return +(String(v).replace(/[$,\s]/g, "")) || 0;
        };

        // UUID-based dupe detection (falls back to cliente+fecha+monto if no UUID)
        const existingUUIDs = new Set(ingresos.map(i=>(i.notas||"").trim().toLowerCase()).filter(Boolean));
        const existingKeys = new Set(ingresos.map(i => `${(i.cliente||"").toLowerCase()}|${i.fecha}|${i.monto}`));

        const newRows = [];
        const dupeRows = [];

        rows.slice(hi + 1).filter(r => r.some(c => c)).forEach(row => {
          const cliente = String(get(row, ["RECEPTOR","CLIENTE","NOMBRE"]) || "").trim();
          const fecha   = parseExcelDate(get(row, ["FECHA"]));
          const monto   = cleanNum(get(row, ["TOTAL"]));
          const moneda  = (() => {
            const raw = String(get(row, ["MONEDA","MON","CURRENCY"]) || "MXN").trim().toUpperCase();
            if (raw.includes("USD")||raw.includes("DOLAR")) return "USD";
            if (raw.includes("EUR")||raw.includes("EURO"))  return "EUR";
            return "MXN";
          })();
          const uuid    = String(get(row, ["UUID"]) || "");
          const serie   = String(get(row, ["SERIE"]) || "");
          const folio   = String(get(row, ["FOLIO"]) || "");
          const tipo    = String(get(row, ["TIPO"]) || "Factura");

          if (!cliente || !monto) return;

          // Check dupe: UUID first, then cliente+fecha+monto
          const uuidLow = uuid ? uuid.toLowerCase() : "";
          if (uuidLow && existingUUIDs.has(uuidLow)) {
            dupeRows.push({ cliente, fecha, monto, moneda });
            return;
          }
          const key = `${cliente.toLowerCase()}|${fecha}|${monto}`;
          if (!uuidLow && existingKeys.has(key)) {
            dupeRows.push({ cliente, fecha, monto, moneda });
            return;
          }
          if (uuidLow) existingUUIDs.add(uuidLow);
          existingKeys.add(key);

          newRows.push({
            id: Math.random().toString(36).slice(2,10),
            cliente,
            concepto: [serie, folio].filter(Boolean).join("-") || tipo,
            categoria: "",
            monto,
            moneda,
            tipoCambio: 1,
            fecha,
            notas: uuid,
          });
        });

        setImportPreview({ rows: newRows, dupes: dupeRows });
        setImportCatDefault(catList[0] || "");
      } catch(err) {
        alert("Error al leer el archivo: " + err.message);
      }
    };
    reader.readAsArrayBuffer(file);
    e.target.value = "";
  };

  const confirmarImport = async () => {
    if (!importPreview?.rows?.length) return;
    setImportando(true);
    const rowsToSave = importPreview.rows.map(r => ({
      ...r,
      categoria: importCatDefault || catList[0] || "Otro",
      empresaId,
    }));
    const saved = [];
    for (const row of rowsToSave) {
      const s = await upsertIngreso(row);
      saved.push(s);
    }
    setIngresos(prev => [...saved, ...prev]);
    setImportPreview(null);
    setImportModal(false);
    setImportando(false);
  };

  /* ── TAS (TravelAirSolutions) Excel import ───────────────────── */
  const handleTasImport = (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = ev => {
      try {
        const wb = XLSX.read(ev.target.result, { type:"array", cellDates:true });
        const ws = wb.Sheets[wb.SheetNames[0]];
        const rows = XLSX.utils.sheet_to_json(ws, { header:1, raw:false, dateNF:'yyyy-mm-dd' });

        // Find header row
        let hi = rows.findIndex(r => r.some(c => String(c||"").toUpperCase().includes("SEGMENTO")));
        if (hi < 0) hi = 0;
        const headers = rows[hi].map(h => String(h||"").trim().toUpperCase());

        const get = (row, keys) => {
          for (const k of keys) {
            const idx = headers.findIndex(h => h.includes(k));
            if (idx >= 0 && row[idx] !== undefined && row[idx] !== "" && row[idx] !== null) return row[idx];
          }
          return "";
        };

        const parseDate = v => {
          if (!v) return "";
          if (v instanceof Date) return v.toISOString().split("T")[0];
          const s = String(v).trim();
          if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0,10);
          if (/^\d+$/.test(s)) {
            const d = new Date(Math.round((+s - 25569) * 86400000));
            return d.toISOString().split("T")[0];
          }
          return s;
        };

        const cleanNum = v => {
          if (!v && v !== 0) return 0;
          return +(String(v).replace(/[$,\s]/g,"")) || 0;
        };

        // UUID-based dupe detection
        const existingUUIDs = new Set(ingresos.map(i=>(i.notas||"").trim().toLowerCase()).filter(Boolean));

        const newRows = [];
        const dupeRows = [];

        rows.slice(hi+1).filter(r=>r.some(c=>c)).forEach(row => {
          const cliente    = String(get(row,["EMPRESA","NOMBRE","RECEPTOR","CLIENTE"])||"").trim();
          const segmento   = String(get(row,["SEGMENTO"])||"").trim();
          const folio      = String(get(row,["CFDI FOLIO","FOLIO"])||"").trim();
          const uuid       = String(get(row,["CFDI UUID","UUID"])||"").trim();
          const fecha      = parseDate(get(row,["FECHA FACTURA","FECHA EMISION","FECHA"]));
          const fechaVencimiento = parseDate(get(row,["FECHA VENCIMIENTO","VENCIMIENTO"]));
          const fechaContable = parseDate(get(row,["ASIENTO CONTABLE","FECHA CONTABLE","CONTABLE"]));
          const monedaRaw  = String(get(row,["MONEDA"])||"MXN").toUpperCase();
          const moneda     = monedaRaw.includes("USD")?"USD":monedaRaw.includes("EUR")?"EUR":"MXN";
          const monto      = cleanNum(get(row,["IMPORTE ADEUDADO","TOTAL","IMPORTE"]));
          const concepto   = String(get(row,["LÍNEAS DE FACTURA","LINEAS DE FACTURA","PRODUCTO","DESCRIPCION"])||folio).trim();

          if (!cliente || !monto) return;

          // Dupe by UUID
          if (uuid && existingUUIDs.has(uuid.toLowerCase())) {
            dupeRows.push({ cliente, concepto, fecha, monto, moneda, uuid });
            return;
          }
          if (uuid) existingUUIDs.add(uuid.toLowerCase());

          newRows.push({
            id: Math.random().toString(36).slice(2,10),
            cliente, concepto: concepto||folio, folio,
            categoria: segmento||"", segmento,
            monto, moneda, tipoCambio:1, fecha, notas:uuid,
            fechaVencimiento, fechaContable, diasCredito:0, fechaFicticia:"",
            empresaId,
          });
        });

        setTasPreview({ rows: newRows, dupes: dupeRows });
        setTasCatDefault(catList[0]||"");
        setTasModal(true);
      } catch(err) {
        alert("Error al leer el archivo: "+err.message);
      }
    };
    reader.readAsArrayBuffer(file);
    e.target.value="";
  };

  const confirmarTasImport = async () => {
    if (!tasPreview?.rows?.length) return;
    setTasImportando(true);
    const rowsToSave = tasPreview.rows.map(r => ({
      ...r,
      categoria: r.segmento || tasCatDefault || catList[0] || "Otro",
    }));
    const saved = [];
    for (const row of rowsToSave) {
      const s = await upsertIngreso(row);
      saved.push(s);
    }
    setIngresos(prev => [...saved, ...prev]);
    setTasPreview(null);
    setTasModal(false);
    setTasImportando(false);
  };

  /* ── Ingreso Form Modal ─────────────────────────────────────── */
  const IngresoModal = () => {
    const [form, setForm] = useState(()=>{
      const f = {
        id: modalIngreso.id || "",
        cliente: modalIngreso.cliente || "",
        concepto: modalIngreso.concepto || "",
        categoria: modalIngreso.categoria || catList[0] || "Circuito",
        monto: modalIngreso.monto || "",
        moneda: modalIngreso.moneda || "MXN",
        tipoCambio: modalIngreso.tipoCambio || 1,
        fecha: modalIngreso.fecha || today(),
        notas: modalIngreso.notas || "",
        diasCredito: modalIngreso.diasCredito || 30,
        fechaFicticia: modalIngreso.fechaFicticia || "",
      };
      // Auto-calc fechaVencimiento if not set
      f.fechaVencimiento = modalIngreso.fechaVencimiento || addDays(f.fecha, f.diasCredito);
      return f;
    });
    const set = (k,v) => setForm(f=>{
      const u = {...f,[k]:v};
      // Auto-fill diasCredito from clientes catalog when cliente changes
      if(k==="cliente") {
        const cli = clientes.find(c=>c.nombre===v);
        if(cli) {
          u.diasCredito = cli.diasCredito;
          u.fechaVencimiento = addDays(f.fecha, cli.diasCredito);
        }
      }
      // Auto-calc fechaVencimiento when fecha or diasCredito changes
      if(k==="fecha"||k==="diasCredito") {
        u.fechaVencimiento = addDays(k==="fecha"?v:f.fecha, k==="diasCredito"?v:f.diasCredito);
      }
      return u;
    });
    const needsTC = form.moneda !== "MXN";

    return (
      <ModalShell title={form.id ? "Editar Ingreso" : "Nuevo Ingreso"} onClose={()=>setModalIngreso(null)}>
        <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:16}}>
          <Field label="Cliente *">
            <input list="cxc-clientes" value={form.cliente} onChange={e=>set("cliente",e.target.value)} placeholder="Nombre del cliente…" style={inputStyle}/>
            <datalist id="cxc-clientes">
              {clientes.length > 0
                ? clientes.map(c=><option key={c.id} value={c.nombre}/>)
                : clientesList.map(c=><option key={c} value={c}/>)
              }
            </datalist>
          </Field>
          <Field label="Categoría">
            <select value={form.categoria} onChange={e=>set("categoria",e.target.value)} style={selectStyle}>
              {catList.map(c=><option key={c}>{c}</option>)}
            </select>
          </Field>
          <Field label="Concepto / Servicio">
            <input value={form.concepto} onChange={e=>set("concepto",e.target.value)} placeholder="Ej: Circuito Europa 2026…" style={inputStyle}/>
          </Field>
          <Field label="Fecha">
            <input type="date" value={form.fecha} onChange={e=>set("fecha",e.target.value)} style={inputStyle}/>
          </Field>
          <Field label="Monto Total *">
            <input type="number" value={form.monto} onChange={e=>set("monto",e.target.value)} placeholder="0.00" style={inputStyle} step="0.01"/>
          </Field>
          <Field label="Moneda">
            <select value={form.moneda} onChange={e=>set("moneda",e.target.value)} style={selectStyle}>
              <option value="MXN">🇲🇽 MXN</option>
              <option value="USD">🇺🇸 USD</option>
              <option value="EUR">🇪🇺 EUR</option>
            </select>
          </Field>
          {needsTC && (
            <Field label="Tipo de Cambio (TC)">
              <input type="number" value={form.tipoCambio} onChange={e=>set("tipoCambio",e.target.value)} placeholder="20.50" style={inputStyle} step="0.0001"/>
              <div style={{fontSize:11,color:C.muted,marginTop:4}}>1 {form.moneda} = {form.tipoCambio} MXN. Se usa para convertir facturas MXN vinculadas.</div>
            </Field>
          )}
          <Field label="Días de Crédito">
            <input type="number" value={form.diasCredito} onChange={e=>set("diasCredito",e.target.value)} placeholder="30" style={inputStyle} min="0"/>
          </Field>
          <Field label="Fecha Vencimiento">
            <input type="date" value={form.fechaVencimiento} onChange={e=>set("fechaVencimiento",e.target.value)} style={{...inputStyle,background:"#F0F4FF"}}/>
            <div style={{fontSize:11,color:C.muted,marginTop:4}}>Calculada automáticamente (fecha + días crédito)</div>
          </Field>
          <Field label="Fecha Ficticia de Cobro">
            <input type="date" value={form.fechaFicticia} onChange={e=>set("fechaFicticia",e.target.value)} style={inputStyle}/>
            <div style={{fontSize:11,color:C.muted,marginTop:4}}>Opcional. Sobrescribe el vencimiento en la proyección.</div>
          </Field>
        </div>
        <Field label="Notas">
          <textarea value={form.notas} onChange={e=>set("notas",e.target.value)} rows={2} style={{...inputStyle,resize:"vertical"}} placeholder="Observaciones…"/>
        </Field>
        <div style={{display:"flex",gap:10,justifyContent:"flex-end",marginTop:8}}>
          <button onClick={()=>setModalIngreso(null)} style={{...btnStyle,background:"#F1F5F9",color:C.text}}>Cancelar</button>
          <button onClick={()=>{if(!form.cliente||!form.monto) return; saveIngreso(form);}} style={btnStyle} disabled={!form.cliente||!form.monto}>
            Guardar Ingreso
          </button>
        </div>
      </ModalShell>
    );
  };

  /* ── Ingreso Detail Modal ────────────────────────────────────── */
  const DetailModal = () => {
    // ── Hooks SIEMPRE primero (regla de React) ──
    const [cobroMonto, setCobroMonto] = useState("");
    const [cobroFecha, setCobroFecha] = useState(today());
    const [cobroNotas, setCobroNotas] = useState("");
    const [invDetail, setInvDetail] = useState(null);
    const [sortFacturas, setSortFacturas] = useState("estatus"); // "estatus"|"proveedor"|"monto"|"fecha"

    const ing = ingresos.find(i => i.id === detailIngreso);
    if (!ing) return null;

    const m = metrics[ing.id] || {};
    const ingCobros = cobros.filter(c => c.ingresoId === ing.id).sort((a,b)=>b.fechaCobro.localeCompare(a.fechaCobro));
    const vincs = invoiceIngresos.filter(v => v.ingresoId === ing.id);
    const vincsWithInv = vincs.map(v => {
      const inv = allInvoices.find(i => i.id === v.invoiceId);
      return { ...v, inv };
    }).filter(v => v.inv);
    const catStyle = getCatStyle(ing.categoria);
    const sym = monedaSym(ing.moneda);

    const chartData = [
      { name:"Monto Total", value:ing.monto, fill:"#90CAF9" },
      { name:"Cobrado", value:m.totalCobrado||0, fill:C.ok },
      { name:"Consumido", value:m.consumido||0, fill:C.danger },
      { name:"Disponible", value:Math.max(0,m.disponible||0), fill:C.teal },
    ];

    return (
      <ModalShell title={`Detalle — ${ing.cliente}`} onClose={()=>setDetailIngreso(null)} extraWide>
        {/* Header */}
        <div style={{display:"flex",gap:16,marginBottom:20,flexWrap:"wrap",alignItems:"flex-start"}}>
          <div style={{flex:1,minWidth:240}}>
            <div style={{display:"flex",gap:8,alignItems:"center",marginBottom:8}}>
              <span style={{background:catStyle.bg,color:catStyle.text,border:`1px solid ${catStyle.border}`,padding:"3px 12px",borderRadius:20,fontSize:12,fontWeight:700}}>{ing.categoria}</span>
              <span style={{background:{MXN:"#E3F2FD",USD:"#E8F5E9",EUR:"#F3E5F5"}[ing.moneda],color:{MXN:C.mxn,USD:C.usd,EUR:C.eur}[ing.moneda],padding:"3px 10px",borderRadius:20,fontSize:12,fontWeight:700}}>{ing.moneda}</span>
              {ing.moneda !== "MXN" && <span style={{fontSize:11,color:C.muted}}>TC: {fmt(ing.tipoCambio)}</span>}
            </div>
            <div style={{fontSize:16,fontWeight:700,color:C.text,marginBottom:4}}>{ing.concepto||"—"}</div>
            <div style={{fontSize:12,color:C.muted}}>📅 {ing.fecha}</div>
            {ing.notas && <div style={{fontSize:12,color:C.muted,marginTop:4,fontStyle:"italic"}}>📝 {ing.notas}</div>}
          </div>
          {/* KPI mini row */}
          <div style={{display:"flex",gap:10,flexWrap:"wrap"}}>
            {[
              {l:"Monto Total",     v:`${sym}${fmt(ing.monto)}`,        c:C.navy},
              {l:"Cobrado",         v:`${sym}${fmt(m.totalCobrado)}`,    c:C.ok},
              {l:"Por Cobrar",      v:`${sym}${fmt(m.porCobrar)}`,       c:C.warn},
              {l:"Consumido",       v:`${sym}${fmt(m.consumido)}`,       c:C.danger},
              {l:"Por Pagar",       v:`${sym}${fmt(m.porPagar)}`,        c:"#E65100", bg:"#FFF3E0"},
              {l:"Disponible",      v:`${sym}${fmt(m.disponible)}`,      c:C.teal},
              {l:"Disponible Neto", v:`${sym}${fmt(m.disponibleNeto)}`,  c:(m.disponibleNeto||0)>=0?C.green:C.danger, bg:(m.disponibleNeto||0)>=0?"#E8F5E9":"#FFEBEE"},
            ].map(k=>(
              <div key={k.l} style={{background:k.bg||"#F8FAFC",borderRadius:10,padding:"10px 14px",textAlign:"center",minWidth:110}}>
                <div style={{fontSize:10,fontWeight:700,color:C.muted,textTransform:"uppercase",marginBottom:2}}>{k.l}</div>
                <div style={{fontSize:16,fontWeight:800,color:k.c}}>{k.v}</div>
              </div>
            ))}
          </div>
        </div>

        {/* Progress bar */}
        {ing.monto > 0 && (
          <div style={{marginBottom:20}}>
            <div style={{display:"flex",justifyContent:"space-between",fontSize:11,color:C.muted,marginBottom:4}}>
              <span>Cobrado: {fmt((m.totalCobrado/ing.monto)*100)}%</span>
              <span>Consumido: {fmt((m.consumido/ing.monto)*100)}%</span>
            </div>
            <div style={{height:12,borderRadius:20,background:"#E2E8F0",overflow:"hidden",position:"relative"}}>
              <div style={{position:"absolute",left:0,top:0,height:"100%",width:`${Math.min(100,(m.consumido/ing.monto)*100)}%`,background:C.danger,borderRadius:20,transition:"width .4s"}}/>
              <div style={{position:"absolute",left:0,top:0,height:"100%",width:`${Math.min(100,(m.totalCobrado/ing.monto)*100)}%`,background:`${C.ok}88`,borderRadius:20,transition:"width .4s"}}/>
            </div>
          </div>
        )}

        <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:24}}>
          {/* LEFT: Cobros — realizados arriba, proyectados abajo */}
          <div>
            {/* REALIZADOS */}
            <h3 style={{fontSize:14,fontWeight:800,color:C.ok,marginBottom:10,display:"flex",alignItems:"center",gap:6}}>
              💵 Cobros Realizados
              <span style={{fontSize:11,fontWeight:500,color:C.muted}}>({ingCobros.filter(c=>c.tipo!=='proyectado').length})</span>
            </h3>
            <div style={{background:"#F0FFF4",border:"1px solid #A5D6A7",borderRadius:10,padding:12,marginBottom:10}}>
              <div style={{fontSize:11,fontWeight:700,color:C.ok,marginBottom:8}}>+ Registrar cobro recibido</div>
              <div style={{display:"flex",gap:8,flexWrap:"wrap",alignItems:"flex-end"}}>
                <div>
                  <div style={{fontSize:10,color:C.muted,fontWeight:600,marginBottom:3}}>Monto</div>
                  <input type="number" value={cobroMonto} onChange={e=>setCobroMonto(e.target.value)} placeholder="0.00" style={{...inputStyle,width:110}} step="0.01"/>
                </div>
                <div>
                  <div style={{fontSize:10,color:C.muted,fontWeight:600,marginBottom:3}}>Fecha</div>
                  <input type="date" value={cobroFecha} onChange={e=>setCobroFecha(e.target.value)} style={{...inputStyle,width:140}}/>
                </div>
                <div style={{flex:1,minWidth:80}}>
                  <div style={{fontSize:10,color:C.muted,fontWeight:600,marginBottom:3}}>Notas</div>
                  <input value={cobroNotas} onChange={e=>setCobroNotas(e.target.value)} placeholder="Anticipo, liq…" style={{...inputStyle}}/>
                </div>
                <button onClick={()=>{if(!cobroMonto||+cobroMonto<=0||!cobroFecha) return; addCobro(ing.id,cobroMonto,cobroFecha,cobroNotas,'realizado'); setCobroMonto(""); setCobroNotas("");}}
                  style={{...btnStyle,padding:"7px 14px",fontSize:12,background:C.ok}}>+ Agregar</button>
              </div>
            </div>
            {ingCobros.filter(c=>c.tipo!=='proyectado').length === 0
              ? <div style={{textAlign:"center",color:C.muted,fontSize:12,padding:12}}>Sin cobros realizados</div>
              : ingCobros.filter(c=>c.tipo!=='proyectado').map(c=>(
                <div key={c.id} style={{display:"flex",justifyContent:"space-between",alignItems:"center",padding:"9px 11px",borderRadius:8,border:`1px solid ${C.border}`,marginBottom:5,background:C.surface}}>
                  <div>
                    <div style={{fontWeight:700,color:C.ok,fontSize:13}}>{sym}{fmt(c.monto)}</div>
                    <div style={{fontSize:11,color:C.muted}}>📅 {c.fechaCobro||"—"}</div>
                    {c.notas && <div style={{fontSize:10,color:C.muted,fontStyle:"italic"}}>{c.notas}</div>}
                  </div>
                  <button onClick={()=>removeCobro(c.id)} style={{...iconBtn,color:C.danger}}>🗑️</button>
                </div>
              ))
            }
            {(m.totalCobrado||0) > 0 && (
              <div style={{padding:"7px 11px",background:"#E8F5E9",borderRadius:8,fontWeight:800,color:C.ok,fontSize:12,marginTop:4}}>
                Total cobrado: {sym}{fmt(m.totalCobrado)}
              </div>
            )}

            {/* PROYECTADOS */}
            <h3 style={{fontSize:14,fontWeight:800,color:"#7B1FA2",marginBottom:10,marginTop:18,display:"flex",alignItems:"center",gap:6}}>
              📆 Cobros Proyectados
              <span style={{fontSize:11,fontWeight:500,color:C.muted}}>({ingCobros.filter(c=>c.tipo==='proyectado').length})</span>
            </h3>
            <div style={{background:"#F3E5F5",border:"1px solid #CE93D8",borderRadius:10,padding:12,marginBottom:10}}>
              <div style={{fontSize:11,fontWeight:700,color:"#7B1FA2",marginBottom:8}}>+ Proyectar cobro futuro</div>
              <div style={{display:"flex",gap:8,flexWrap:"wrap",alignItems:"flex-end"}}>
                <div>
                  <div style={{fontSize:10,color:C.muted,fontWeight:600,marginBottom:3}}>Monto</div>
                  <input id="proy-monto" type="number" placeholder="0.00" style={{...inputStyle,width:110}} step="0.01"/>
                </div>
                <div>
                  <div style={{fontSize:10,color:C.muted,fontWeight:600,marginBottom:3}}>Fecha estimada</div>
                  <input id="proy-fecha" type="date" defaultValue={today()} style={{...inputStyle,width:140}}/>
                </div>
                <div style={{flex:1,minWidth:80}}>
                  <div style={{fontSize:10,color:C.muted,fontWeight:600,marginBottom:3}}>Notas</div>
                  <input id="proy-notas" type="text" placeholder="2do anticipo…" style={{...inputStyle}}/>
                </div>
                <button onClick={()=>{
                  const m2 = +document.getElementById('proy-monto').value;
                  const f2 = document.getElementById('proy-fecha').value;
                  const n2 = document.getElementById('proy-notas').value;
                  if(!m2||m2<=0||!f2) return;
                  addCobro(ing.id, m2, f2, n2, 'proyectado');
                  document.getElementById('proy-monto').value='';
                  document.getElementById('proy-notas').value='';
                }} style={{...btnStyle,padding:"7px 14px",fontSize:12,background:"#7B1FA2"}}>+ Proyectar</button>
              </div>
            </div>
            {ingCobros.filter(c=>c.tipo==='proyectado').length === 0
              ? <div style={{textAlign:"center",color:C.muted,fontSize:12,padding:12}}>Sin cobros proyectados.<br/><span style={{fontSize:10}}>Aparecerán en el calendario de proyección.</span></div>
              : ingCobros.filter(c=>c.tipo==='proyectado').map(c=>(
                <div key={c.id} style={{display:"flex",justifyContent:"space-between",alignItems:"center",padding:"9px 11px",borderRadius:8,border:"1px solid #CE93D8",marginBottom:5,background:"#FAF0FF"}}>
                  <div>
                    <div style={{fontWeight:700,color:"#7B1FA2",fontSize:13}}>{sym}{fmt(c.monto)}</div>
                    <div style={{fontSize:11,color:C.muted}}>📅 {c.fechaCobro||"—"}</div>
                    {c.notas && <div style={{fontSize:10,color:C.muted,fontStyle:"italic"}}>{c.notas}</div>}
                  </div>
                  <button onClick={()=>removeCobro(c.id)} style={{...iconBtn,color:C.danger}}>🗑️</button>
                </div>
              ))
            }
            {(m.totalProyectado||0) > 0 && (
              <div style={{padding:"7px 11px",background:"#F3E5F5",border:"1px solid #CE93D8",borderRadius:8,fontWeight:800,color:"#7B1FA2",fontSize:12,marginTop:4}}>
                Total proyectado: {sym}{fmt(m.totalProyectado)}
              </div>
            )}
          </div>

          {/* RIGHT: Facturas vinculadas */}
          <div>
            {/* Header + control de ordenamiento */}
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:12,flexWrap:"wrap",gap:8}}>
              <h3 style={{fontSize:15,fontWeight:800,color:C.navy,margin:0,display:"flex",alignItems:"center",gap:6}}>
                🔗 Facturas Vinculadas
                <span style={{fontSize:12,fontWeight:500,color:C.muted}}>({vincsWithInv.length})</span>
              </h3>
              {vincsWithInv.length > 1 && (
                <div style={{display:"flex",alignItems:"center",gap:6}}>
                  <span style={{fontSize:11,color:C.muted,fontWeight:600}}>Ordenar:</span>
                  {[
                    {v:"estatus",  l:"Estatus"},
                    {v:"proveedor",l:"Proveedor"},
                    {v:"monto",    l:"Monto"},
                    {v:"fecha",    l:"Fecha"},
                  ].map(opt=>(
                    <button key={opt.v} onClick={()=>setSortFacturas(opt.v)}
                      style={{padding:"3px 10px",borderRadius:20,border:`1px solid ${sortFacturas===opt.v?C.blue:C.border}`,background:sortFacturas===opt.v?"#E8F0FE":C.surface,color:sortFacturas===opt.v?C.blue:C.text,cursor:"pointer",fontSize:11,fontWeight:sortFacturas===opt.v?700:500,fontFamily:"inherit",transition:"all .15s"}}>
                      {opt.l}
                    </button>
                  ))}
                </div>
              )}
            </div>

            {vincsWithInv.length === 0 && (
              <div style={{textAlign:"center",color:C.muted,fontSize:13,padding:20}}>
                Sin facturas vinculadas.<br/><span style={{fontSize:11}}>Vincula desde la sección Cartera.</span>
              </div>
            )}

            {[...vincsWithInv].sort((a,b) => {
              const ESTATUS_ORDER = {Pagado:1, Parcial:2, Pendiente:3, Vencido:4};
              if (sortFacturas === "estatus")   return (ESTATUS_ORDER[a.inv.estatus]||5) - (ESTATUS_ORDER[b.inv.estatus]||5);
              if (sortFacturas === "proveedor") return (a.inv.proveedor||"").localeCompare(b.inv.proveedor||"");
              if (sortFacturas === "monto")     return b.montoAsignado - a.montoAsignado;
              if (sortFacturas === "fecha")     return (b.inv.fecha||"").localeCompare(a.inv.fecha||"");
              return 0;
            }).map(v=>{
              const inv = v.inv;
              const montoConv = convertToMonedaIngreso(v.montoAsignado, inv.moneda, ing);
              const sameMoneda = inv.moneda === ing.moneda;
              const statusBg = {Pagado:"#E8F5E9",Parcial:"#FFF3E0",Pendiente:"#EEF2FF",Vencido:"#FFEBEE"}[inv.estatus]||"#F8FAFC";
              const statusColor = {Pagado:C.ok,Parcial:C.warn,Pendiente:C.sky,Vencido:C.danger}[inv.estatus]||C.muted;
              return (
                <div key={v.id} onClick={()=>setInvDetail(inv)}
                  style={{padding:"10px 12px",borderRadius:8,border:`1px solid ${C.border}`,marginBottom:6,background:statusBg,cursor:"pointer",transition:"box-shadow .15s"}}
                  onMouseEnter={e=>{e.currentTarget.style.boxShadow="0 2px 12px rgba(0,0,0,.12)";}}
                  onMouseLeave={e=>{e.currentTarget.style.boxShadow="none";}}>
                  <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start"}}>
                    <div>
                      <div style={{fontWeight:700,fontSize:13}}>{inv.proveedor}</div>
                      <div style={{fontSize:11,color:C.muted}}>Folio: {inv.serie}{inv.folio} · {inv.fecha}</div>
                    </div>
                    <div style={{display:"flex",alignItems:"center",gap:8}}>
                      <span style={{color:statusColor,fontWeight:700,fontSize:11,background:`${statusColor}18`,padding:"2px 8px",borderRadius:20}}>{inv.estatus}</span>
                      <span style={{fontSize:11,color:C.muted,background:"#fff",padding:"1px 6px",borderRadius:6,border:`1px solid ${C.border}`}}>ver detalle →</span>
                    </div>
                  </div>
                  <div style={{display:"flex",gap:12,marginTop:6,fontSize:12}}>
                    <span><span style={{color:C.muted}}>Asignado: </span><b>{inv.moneda==="EUR"?"€":"$"}{fmt(v.montoAsignado)} {inv.moneda}</b></span>
                    {!sameMoneda && <span style={{color:C.muted}}>→ <b>{sym}{fmt(montoConv)} {ing.moneda}</b></span>}
                  </div>
                </div>
              );
            })}
            {vincsWithInv.length > 0 && (
              <div style={{padding:"8px 12px",background:"#FFEBEE",borderRadius:8,fontWeight:800,color:C.danger,fontSize:13,marginTop:4}}>
                Total comprometido: {sym}{fmt(m.comprometido)} | Consumido: {sym}{fmt(m.consumido)}
              </div>
            )}
          </div>
        </div>

        {/* Chart */}
        <div style={{marginTop:24,background:"#F8FAFC",borderRadius:14,padding:18}}>
          <h3 style={{fontSize:14,fontWeight:700,color:C.navy,marginBottom:14}}>📊 Resumen del Ingreso</h3>
          <ResponsiveContainer width="100%" height={160}>
            <BarChart data={chartData} layout="vertical">
              <CartesianGrid strokeDasharray="3 3"/>
              <XAxis type="number" tickFormatter={v=>`${sym}${fmt(v)}`} fontSize={10}/>
              <YAxis type="category" dataKey="name" fontSize={11} width={80}/>
              <Tooltip formatter={v=>`${sym}${fmt(v)}`}/>
              <Bar dataKey="value" radius={[0,4,4,0]}>
                {chartData.map((d,i)=><Cell key={i} fill={d.fill}/>)}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>

        {/* Actions */}
        <div style={{display:"flex",gap:10,justifyContent:"flex-end",marginTop:20}}>
          <button onClick={()=>{setDetailIngreso(null); setModalIngreso({...ing});}} style={{...btnStyle,background:"#F1F5F9",color:C.text}}>✏️ Editar</button>
          <button onClick={()=>{setDetailIngreso(null); setDeleteConfirm({id:ing.id,label:`${ing.cliente} — ${ing.concepto||ing.categoria}`});}} style={{...btnStyle,background:C.danger}}>🗑️ Eliminar</button>
          <button onClick={()=>{
            // Obtener fecha efectiva para ordenar
            const getFechaOrden = (inv, tipo) => {
              if (tipo === 'pagado') {
                const r = payments.filter(p=>p.invoiceId===inv.id&&p.tipo==='realizado'&&p.fechaPago).sort((a,b)=>a.fechaPago.localeCompare(b.fechaPago));
                return r[0]?.fechaPago || inv.fechaProgramacion || inv.vencimiento || "9999";
              } else {
                const p = payments.filter(p=>p.invoiceId===inv.id&&p.tipo==='programado'&&p.fechaPago).sort((a,b)=>a.fechaPago.localeCompare(b.fechaPago));
                return inv.fechaProgramacion || p[0]?.fechaPago || inv.vencimiento || "9999";
              }
            };
            const sortedVincs = [...vincsWithInv].sort((a,b)=>{
              const aPagado = a.inv.estatus==='Pagado';
              const bPagado = b.inv.estatus==='Pagado';
              // Pagadas primero, luego pendientes
              if(aPagado && !bPagado) return -1;
              if(!aPagado && bPagado) return 1;
              // Dentro de cada grupo, ordenar por fecha de más antigua a más reciente
              const fa = getFechaOrden(a.inv, aPagado?'pagado':'pendiente');
              const fb2 = getFechaOrden(b.inv, bPagado?'pagado':'pendiente');
              return fa.localeCompare(fb2);
            });
            const totalCobrado  = m.totalCobrado||0;
            const totalPorCobrar= m.porCobrar||0;
            const totalConsumido= m.consumido||0;
            const totalPorPagar = m.porPagar||0;
            const totalDisp     = m.disponible||0;
            const totalDispNeto = m.disponibleNeto||0;
            const sBg = {Pagado:"#E8F5E9",Parcial:"#FFF3E0",Pendiente:"#EEF2FF",Vencido:"#FFEBEE"};
            const sCol= {Pagado:"#43A047",Parcial:"#F57F17",Pendiente:"#1565C0",Vencido:"#E53935"};

            const html = `<!DOCTYPE html><html lang="es"><head>
              <meta charset="UTF-8"/>
              <title>Desglose — ${ing.cliente}</title>
              <style>
                *{box-sizing:border-box;margin:0;padding:0;}
                body{font-family:'Segoe UI',Arial,sans-serif;font-size:10px;color:#1A2332;padding:16px 20px;background:#fff;}
                h1{font-size:16px;font-weight:900;color:#0F2D4A;margin:3px 0 2px;}
                .sub{font-size:10px;color:#64748B;}
                .label{font-size:8px;color:#64748B;font-weight:700;text-transform:uppercase;letter-spacing:.4px;}
                .header{display:flex;justify-content:space-between;align-items:flex-start;border-bottom:2px solid #0F2D4A;padding-bottom:8px;margin-bottom:10px;}
                .kpi-row{display:flex;gap:6px;flex-wrap:nowrap;margin-bottom:10px;}
                .kpi-box{border:1px solid #E2E8F0;border-radius:6px;padding:6px 8px;flex:1;}
                .kpi-val{font-size:12px;font-weight:800;margin-top:2px;}
                table{width:100%;border-collapse:collapse;margin-top:4px;margin-bottom:10px;}
                th{background:#0F2D4A;color:#fff;padding:5px 7px;text-align:left;font-size:8px;text-transform:uppercase;font-weight:700;}
                td{padding:4px 7px;border-bottom:1px solid #E2E8F0;font-size:9px;}
                tfoot td{background:#EEF2FF;font-weight:800;border-top:2px solid #0F2D4A;font-size:9px;}
                .badge{display:inline-block;padding:1px 6px;border-radius:20px;font-size:8px;font-weight:700;}
                .section-title{font-size:9px;font-weight:700;color:#0F2D4A;text-transform:uppercase;letter-spacing:.4px;margin-bottom:4px;margin-top:2px;}
                .footer{margin-top:10px;font-size:8px;color:#94A3B8;border-top:1px solid #E2E8F0;padding-top:6px;}
                .right{text-align:right;}
                @page{size:A4 portrait;margin:10mm;}
                @media print{body{padding:0;}}
              </style>
            </head><body>
              <div class="header">
                <div>
                  <div class="label">Viajes Libero · CxC — Desglose de Ingreso</div>
                  <h1>${ing.cliente}</h1>
                  <div class="sub">${ing.concepto||""}${ing.concepto?" · ":""}${ing.categoria}</div>
                </div>
                <div style="text-align:right;">
                  <div class="label">Generado</div>
                  <div style="font-size:12px;color:#1A2332;margin-top:2px;">${new Date().toLocaleDateString("es-MX",{day:"2-digit",month:"long",year:"numeric"})}</div>
                  <div style="font-size:11px;color:#64748B;margin-top:2px;">Moneda: ${ing.moneda}${ing.moneda!=="MXN"?" · TC: "+ing.tipoCambio:""}</div>
                </div>
              </div>

              <div class="kpi-row">
                ${[
                  ["Monto Total",    `${sym}${fmt(ing.monto)}`,       "#0F2D4A", "#F8FAFC"],
                  ["Cobrado",        `${sym}${fmt(totalCobrado)}`,    "#43A047", "#F8FAFC"],
                  ["Por Cobrar",     `${sym}${fmt(totalPorCobrar)}`,  "#F57F17", "#F8FAFC"],
                  ["Consumido",      `${sym}${fmt(totalConsumido)}`,  "#E53935", "#F8FAFC"],
                  ["Por Pagar",      `${sym}${fmt(totalPorPagar)}`,   "#E65100", "#FFF3E0"],
                  ["Disponible",     `${sym}${fmt(totalDisp)}`,       "#00897B", "#F8FAFC"],
                  ["Disponible Neto",`${sym}${fmt(totalDispNeto)}`,   totalDispNeto>=0?"#1B5E20":"#E53935", "#F8FAFC"],
                ].map(([l,v,c,bg])=>`<div class="kpi-box" style="background:${bg};border:1px solid #E2E8F0;border-radius:6px;padding:8px 10px;flex:1;"><div class="label" style="font-size:8px;color:#64748B;font-weight:700;text-transform:uppercase;letter-spacing:.4px;">${l}</div><div style="font-size:13px;font-weight:800;color:${c};margin-top:3px;">${v}</div></div>`).join("")}
              </div>

              ${ingCobros.length>0?`
              <div class="section-title">Cobros (${ingCobros.length})</div>
              <table>
                <thead><tr><th>Fecha</th><th>Tipo</th><th>Monto</th><th>Notas</th></tr></thead>
                <tbody>
                  ${ingCobros.map(c=>`<tr>
                    <td>${c.fechaCobro||"—"}</td>
                    <td><span class="badge" style="background:${c.tipo==="proyectado"?"#F3E5F5":"#E8F5E9"};color:${c.tipo==="proyectado"?"#7B1FA2":"#43A047"}">${c.tipo==="proyectado"?"📆 Proyectado":"✅ Realizado"}</span></td>
                    <td style="font-weight:700;">${sym}${fmt(c.monto)}</td>
                    <td style="color:#64748B;">${c.notas||"—"}</td>
                  </tr>`).join("")}
                </tbody>
                <tfoot><tr>
                  <td colspan="2">Total cobrado realizado</td>
                  <td style="font-weight:900;color:#43A047;">${sym}${fmt(totalCobrado)}</td>
                  <td></td>
                </tr></tfoot>
              </table>`:""}

              ${sortedVincs.length>0?`
              <div class="section-title">Facturas Vinculadas — ${sortedVincs.length} factura${sortedVincs.length!==1?"s":""} (orden por estatus)</div>
              <table>
                <thead><tr>
                  <th style="width:10%">Estatus</th>
                  <th style="width:20%">Proveedor</th>
                  <th>Concepto</th>
                  <th style="width:14%;white-space:nowrap">Fecha Pago / Prog.</th>
                  <th style="width:10%;text-align:right">Asignado ${ing.moneda}</th>
                  <th style="width:13%;text-align:right">Total Factura</th>
                  <th style="width:9%;text-align:right">Saldo</th>
                </tr></thead>
                <tbody>
                  ${sortedVincs.map(v=>{
                    const inv=v.inv;
                    const sf=(+inv.total||0)-(+inv.montoPagado||0);
                    const cm=convertToMonedaIngreso(v.montoAsignado,inv.moneda,ing);
                    const fb=sBg[inv.estatus]||"#fff";
                    const fc=sCol[inv.estatus]||"#1A2332";
                    const monSym=inv.moneda==="EUR"?"€":"$";
                    // Buscar pagos realizados y programados
                    const realizados = payments
                      .filter(p=>p.invoiceId===inv.id && p.tipo==='realizado' && p.fechaPago)
                      .sort((a,b)=>b.fechaPago.localeCompare(a.fechaPago));
                    const programados = payments
                      .filter(p=>p.invoiceId===inv.id && p.tipo==='programado' && p.fechaPago)
                      .sort((a,b)=>a.fechaPago.localeCompare(b.fechaPago));
                    const esPagado = inv.estatus==='Pagado';
                    let fechaLabel, fechaColor;
                    if(esPagado){
                      const fp = realizados[0]?.fechaPago || inv.fechaProgramacion || inv.vencimiento || "";
                      fechaLabel = fp ? "✓ "+fp : "✓ Pagado";
                      fechaColor = "#43A047";
                    } else {
                      const fp = inv.fechaProgramacion || programados[0]?.fechaPago || inv.vencimiento || "";
                      fechaLabel = fp || "—";
                      fechaColor = inv.estatus==='Vencido' ? "#E53935" : "#1565C0";
                    }
                    return `<tr style="background:${fb}">
                      <td><span class="badge" style="background:${fb};color:${fc};border:1px solid ${fc}55">${inv.estatus}</span></td>
                      <td style="font-weight:600;overflow-wrap:break-word;word-break:break-word;">${inv.proveedor}</td>
                      <td style="color:#374151;overflow-wrap:break-word;word-break:break-word;">${inv.concepto||"—"}</td>
                      <td style="white-space:nowrap;color:${fechaColor};font-weight:700;">${fechaLabel}</td>
                      <td style="font-weight:700;text-align:right;">${sym}${fmt(cm)}</td>
                      <td style="text-align:right;white-space:nowrap;">${monSym}${fmt(inv.total)} <b style="font-size:7px;color:#64748B;">${inv.moneda}</b></td>
                      <td style="text-align:right;font-weight:700;white-space:nowrap;color:${sf>0?"#F57F17":"#43A047"}">${monSym}${fmt(sf)}</td>
                    </tr>`;
                  }).join("")}
                </tbody>
                <tfoot><tr>
                  <td colspan="4">TOTAL (${sortedVincs.length} facturas)</td>
                  <td style="color:#0F2D4A;text-align:right;">${sym}${fmt(m.comprometido)}</td>
                  <td style="text-align:right;color:#E53935;" colspan="2">${sym}${fmt(m.consumido)} consumido</td>
                </tr></tfoot>
              </table>`:""}

              <div class="footer">
                Disponible = Cobrado − Consumido &nbsp;·&nbsp; Disponible Neto = Disponible − Por Pagar &nbsp;·&nbsp; TC aplicado del ingreso
              </div>
              <script>window.onload=()=>{window.print();}<\/script>
            </body></html>`;

            const w = window.open("","_blank","width=1100,height=750");
            w.document.write(html);
            w.document.close();
          }} style={{...btnStyle,background:"#7C3AED",color:"#fff"}}>🖨️ Imprimir PDF</button>
          <button onClick={()=>setDetailIngreso(null)} style={btnStyle}>Cerrar</button>
        </div>

        {/* ── Popup detalle de factura vinculada ── */}
        {invDetail && (()=>{
          const i = invDetail;
          const sym2 = i.moneda==="EUR"?"€":"$";
          const saldo = (+i.total||0)-(+i.montoPagado||0);
          const statusColor = {Pagado:C.ok,Parcial:C.warn,Pendiente:C.sky,Vencido:C.danger}[i.estatus]||C.muted;
          const statusBg   = {Pagado:"#E8F5E9",Parcial:"#FFF3E0",Pendiente:"#EEF2FF",Vencido:"#FFEBEE"}[i.estatus]||"#F8FAFC";
          const monedaColor= {MXN:C.mxn,USD:C.usd,EUR:C.eur}[i.moneda]||C.navy;
          const monedaBg   = {MXN:"#E3F2FD",USD:"#E8F5E9",EUR:"#F3E5F5"}[i.moneda]||"#F8FAFC";
          const Row = ({label,value,bold,color}) => (
            <div style={{display:"flex",justifyContent:"space-between",padding:"9px 0",borderBottom:`1px solid ${C.border}`}}>
              <span style={{fontSize:13,color:C.muted}}>{label}</span>
              <span style={{fontSize:13,fontWeight:bold?700:500,color:color||C.text}}>{value||"—"}</span>
            </div>
          );
          return (
            <div style={{position:"fixed",inset:0,background:"rgba(15,45,74,.55)",display:"flex",alignItems:"center",justifyContent:"center",zIndex:3000,padding:20}}
              onClick={()=>setInvDetail(null)}>
              <div onClick={e=>e.stopPropagation()}
                style={{background:C.surface,borderRadius:20,padding:32,width:"100%",maxWidth:560,maxHeight:"90vh",overflowY:"auto",boxShadow:"0 24px 64px rgba(0,0,0,.3)"}}>
                {/* Header */}
                <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:20}}>
                  <div>
                    <div style={{fontSize:11,color:C.muted,fontWeight:700,textTransform:"uppercase",letterSpacing:.5,marginBottom:4}}>Detalle de Factura</div>
                    <div style={{fontSize:22,fontWeight:900,color:C.navy}}>{i.serie}{i.folio}</div>
                    <div style={{fontSize:14,color:C.muted,marginTop:2}}>{i.proveedor}</div>
                  </div>
                  <div style={{display:"flex",flexDirection:"column",alignItems:"flex-end",gap:6}}>
                    <span style={{background:statusBg,color:statusColor,fontWeight:800,fontSize:13,padding:"4px 14px",borderRadius:20,border:`1px solid ${statusColor}44`}}>
                      {i.estatus}
                    </span>
                    <span style={{background:monedaBg,color:monedaColor,fontWeight:700,fontSize:11,padding:"3px 10px",borderRadius:20}}>
                      {i.moneda}
                    </span>
                    <button onClick={()=>setInvDetail(null)}
                      style={{background:"#F1F5F9",border:"none",borderRadius:8,width:32,height:32,cursor:"pointer",fontSize:16,marginTop:4}}>×</button>
                  </div>
                </div>

                {/* Importes destacados */}
                <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:10,marginBottom:20}}>
                  {[
                    {l:"Total",    v:`${sym2}${fmt(i.total)}`,      c:C.navy,   bg:"#F8FAFC"},
                    {l:"Pagado",   v:`${sym2}${fmt(i.montoPagado)}`,c:C.ok,     bg:"#E8F5E9"},
                    {l:"Saldo",    v:`${sym2}${fmt(saldo)}`,         c:saldo>0?C.warn:C.ok, bg:saldo>0?"#FFF3E0":"#E8F5E9"},
                  ].map(k=>(
                    <div key={k.l} style={{background:k.bg,borderRadius:10,padding:"12px 14px",textAlign:"center"}}>
                      <div style={{fontSize:10,fontWeight:700,color:C.muted,textTransform:"uppercase",marginBottom:3}}>{k.l}</div>
                      <div style={{fontSize:18,fontWeight:800,color:k.c}}>{k.v}</div>
                    </div>
                  ))}
                </div>

                {/* Desglose */}
                <div style={{marginBottom:16}}>
                  <Row label="Tipo"               value={i.tipo}/>
                  <Row label="Fecha emisión"       value={i.fecha}/>
                  <Row label="UUID"                value={i.uuid ? i.uuid.slice(0,24)+"…" : "—"}/>
                  <Row label="Clasificación"       value={i.clasificacion}/>
                  {i.concepto && <Row label="Concepto" value={i.concepto}/>}
                  <Row label="Subtotal"            value={`${sym2}${fmt(i.subtotal)}`}/>
                  <Row label="IVA"                 value={`${sym2}${fmt(i.iva)}`}/>
                  {(+i.retIsr||0)>0 && <Row label="Ret. ISR" value={`${sym2}${fmt(i.retIsr)}`}/>}
                  {(+i.retIva||0)>0 && <Row label="Ret. IVA" value={`${sym2}${fmt(i.retIva)}`}/>}
                  <Row label="Total"               value={`${sym2}${fmt(i.total)}`} bold color={C.navy}/>
                  <Row label="Monto Pagado"        value={`${sym2}${fmt(i.montoPagado)}`} bold color={C.ok}/>
                  <Row label="Saldo Pendiente"     value={`${sym2}${fmt(saldo)}`} bold color={saldo>0?C.warn:C.ok}/>
                  <Row label="Vencimiento"         value={i.vencimiento}/>
                  {i.diasCredito && <Row label="Días crédito" value={`${i.diasCredito} días`}/>}
                  {i.fechaProgramacion && <Row label="Pago programado" value={i.fechaProgramacion}/>}
                  {i.referencia && <Row label="Referencia" value={i.referencia}/>}
                </div>

                {/* Autorizaciones */}
                <div style={{display:"flex",gap:10,marginBottom:20}}>
                  <div style={{flex:1,background:i.voBo?"#E8F5E9":"#F8FAFC",borderRadius:8,padding:"8px 14px",textAlign:"center",fontSize:12}}>
                    <div style={{color:C.muted,marginBottom:2}}>Visto Bueno</div>
                    <div style={{fontSize:18}}>{i.voBo?"✅":"⬜"}</div>
                  </div>
                  <div style={{flex:1,background:i.autorizadoDireccion?"#E8F5E9":"#F8FAFC",borderRadius:8,padding:"8px 14px",textAlign:"center",fontSize:12}}>
                    <div style={{color:C.muted,marginBottom:2}}>Aut. Dirección</div>
                    <div style={{fontSize:18}}>{i.autorizadoDireccion?"✅":"⬜"}</div>
                  </div>
                </div>

                {/* Notas */}
                {i.notas && (
                  <div style={{background:"#FFF8E1",border:"1px solid #FFE082",borderRadius:8,padding:"10px 14px",fontSize:12,color:"#856404"}}>
                    📝 {i.notas}
                  </div>
                )}

                <div style={{display:"flex",justifyContent:"flex-end",marginTop:20}}>
                  <button onClick={()=>setInvDetail(null)} style={btnStyle}>Cerrar</button>
                </div>
              </div>
            </div>
          );
        })()}
      </ModalShell>
    );
  };

  /* ── Ingreso row in table ─────────────────────────────────────── */
  const IngresoRow = ({ing, idx}) => {
    const m = metrics[ing.id] || {};
    const catStyle = getCatStyle(ing.categoria);
    const sym = monedaSym(ing.moneda);
    const disponColor = (m.disponible||0) > 0 ? C.teal : (m.disponible||0) === 0 ? C.muted : C.danger;
    const isSelected = selectedIngresos.has(ing.id);
    const diffDias = diasDiff(ing.fechaVencimiento);
    const hoy = today();
    const venceProx = ing.fechaVencimiento && ing.fechaVencimiento < hoy;

    return (
      <tr style={{borderTop:`1px solid ${C.border}`,background:isSelected?"#E8F0FE":idx%2===0?C.surface:"#FAFBFC",cursor:"pointer",transition:"background .12s"}}
        onMouseEnter={e=>{if(!isSelected)e.currentTarget.style.background="#F0F7FF";}}
        onMouseLeave={e=>{if(!isSelected)e.currentTarget.style.background=isSelected?"#E8F0FE":idx%2===0?C.surface:"#FAFBFC";}}
        onClick={()=>setDetailIngreso(ing.id)}>
        {/* Checkbox */}
        <td style={{padding:"10px 6px",textAlign:"center"}} onClick={e=>e.stopPropagation()}>
          <input type="checkbox" checked={isSelected} onChange={()=>{
            setSelectedIngresos(prev=>{const n=new Set(prev);if(n.has(ing.id))n.delete(ing.id);else n.add(ing.id);return n;});
          }} style={{cursor:"pointer",width:15,height:15,accentColor:C.blue}}/>
        </td>
        {/* Segmento */}
        <td style={{padding:"8px 8px"}} onClick={e=>e.stopPropagation()}>
          <input value={ing.segmento||""} onChange={e=>{
            const v=e.target.value;
            setIngresos(prev=>prev.map(i=>i.id===ing.id?{...i,segmento:v}:i));
            updateIngresoField(ing.id,{segmento:v});
          }} placeholder="—" style={{padding:"3px 7px",fontSize:11,border:`1px solid ${C.border}`,borderRadius:6,width:70,fontFamily:"inherit",background:"#FAFBFC"}}/>
        </td>
        {/* Cliente */}
        <td style={{padding:"10px 10px",fontWeight:700,color:C.navy,maxWidth:140,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{ing.cliente}</td>
        {/* Folio */}
        <td style={{padding:"10px 8px",fontSize:11,color:C.blue,fontWeight:600,whiteSpace:"nowrap"}}>{ing.folio||"—"}</td>
        {/* Concepto */}
        <td style={{padding:"10px 10px",color:ing.concepto?C.text:C.muted,fontStyle:ing.concepto?"normal":"italic",minWidth:150,maxWidth:200,whiteSpace:"normal",lineHeight:1.4,wordBreak:"break-word",fontSize:12}}>{ing.concepto||"—"}</td>
        {/* Moneda — fixed width, no wrap */}
        <td style={{padding:"10px 8px",whiteSpace:"nowrap"}}>
          <span style={{background:{MXN:"#E3F2FD",USD:"#E8F5E9",EUR:"#F3E5F5"}[ing.moneda]||"#F8FAFC",color:{MXN:C.mxn,USD:C.usd,EUR:C.eur}[ing.moneda]||C.navy,padding:"3px 8px",borderRadius:20,fontSize:11,fontWeight:700,display:"inline-block",minWidth:40,textAlign:"center"}}>
            {ing.moneda}
          </span>
        </td>
        {/* Fecha Contable */}
        <td style={{padding:"8px 8px"}} onClick={e=>e.stopPropagation()}>
          <input type="date" value={ing.fechaContable||""} onChange={e=>{
            const v=e.target.value;
            setIngresos(prev=>prev.map(i=>i.id===ing.id?{...i,fechaContable:v}:i));
            updateIngresoField(ing.id,{fechaContable:v});
          }} style={{padding:"3px 6px",fontSize:11,border:`1px solid ${ing.fechaContable?C.teal:C.border}`,borderRadius:6,color:ing.fechaContable?C.teal:C.text,width:125,fontFamily:"inherit"}}/>
        </td>
        {/* Fecha Factura */}
        <td style={{padding:"10px 10px",whiteSpace:"nowrap",fontSize:11,color:C.muted}}>{ing.fecha||"—"}</td>
        {/* Vencimiento */}
        <td style={{padding:"10px 10px",whiteSpace:"nowrap",fontSize:11,color:venceProx?C.danger:ing.fechaVencimiento?C.text:C.muted,fontWeight:ing.fechaVencimiento?600:400}}>
          {ing.fechaVencimiento||"—"}
        </td>
        {/* Días Vencidos */}
        <td style={{padding:"8px 8px",textAlign:"center"}}>
          {diffDias!==null && diffDias<0 ? (
            <span style={{background:"#FFEBEE",color:C.danger,fontWeight:800,fontSize:11,padding:"3px 8px",borderRadius:20,whiteSpace:"nowrap"}}>{Math.abs(diffDias)}d</span>
          ) : <span style={{color:C.muted,fontSize:11}}>—</span>}
        </td>
        {/* Por Vencer */}
        <td style={{padding:"8px 8px",textAlign:"center"}}>
          {diffDias!==null && diffDias>=0 ? (
            <span style={{background:diffDias<=7?"#FFF3E0":diffDias<=30?"#FFFDE7":"#E8F5E9",color:diffDias<=7?C.danger:diffDias<=30?C.warn:C.ok,fontWeight:800,fontSize:11,padding:"3px 8px",borderRadius:20,whiteSpace:"nowrap"}}>{diffDias}d</span>
          ) : <span style={{color:C.muted,fontSize:11}}>—</span>}
        </td>
        {/* Fecha Ficticia */}
        <td style={{padding:"8px 8px"}} onClick={e=>e.stopPropagation()}>
          <input type="date" value={ing.fechaFicticia||""} onChange={e=>{
            const v=e.target.value;
            setIngresos(prev=>prev.map(i=>i.id===ing.id?{...i,fechaFicticia:v}:i));
            updateIngresoField(ing.id,{fechaFicticia:v});
          }} style={{padding:"3px 6px",fontSize:11,width:125,border:`1px solid ${ing.fechaFicticia?"#7B1FA2":C.border}`,borderRadius:6,color:ing.fechaFicticia?"#7B1FA2":C.text,fontFamily:"inherit"}}/>
        </td>
        <td style={{padding:"10px 10px",fontWeight:700,textAlign:"right",whiteSpace:"nowrap"}}>{sym}{fmt(ing.monto)}</td>
        <td style={{padding:"10px 10px",fontWeight:600,color:C.ok,textAlign:"right",whiteSpace:"nowrap"}}>{sym}{fmt(m.totalCobrado||0)}</td>
        <td style={{padding:"10px 10px",fontWeight:600,color:(m.porCobrar||0)>0?C.warn:C.ok,textAlign:"right",whiteSpace:"nowrap"}}>{sym}{fmt(m.porCobrar||0)}</td>
        <td style={{padding:"10px 10px",fontWeight:600,color:C.danger,textAlign:"right",whiteSpace:"nowrap"}}>{sym}{fmt(m.consumido||0)}</td>
        <td style={{padding:"10px 10px",textAlign:"right",whiteSpace:"nowrap"}}>
          <span style={{fontWeight:700,color:"#E65100",background:(m.porPagar||0)>0?"#FFF3E0":"transparent",padding:(m.porPagar||0)>0?"2px 6px":"0",borderRadius:6}}>{sym}{fmt(m.porPagar||0)}</span>
        </td>
        <td style={{padding:"10px 10px",textAlign:"right",whiteSpace:"nowrap"}}>
          <span style={{fontWeight:800,color:disponColor}}>{sym}{fmt(m.disponible||0)}</span>
        </td>
        <td style={{padding:"10px 10px",textAlign:"right",whiteSpace:"nowrap"}}>
          <span style={{fontWeight:800,color:(m.disponibleNeto||0)>=0?C.green:C.danger,background:(m.disponibleNeto||0)>=0?"#E8F5E9":"#FFEBEE",padding:"2px 7px",borderRadius:6}}>{sym}{fmt(m.disponibleNeto||0)}</span>
        </td>
        <td style={{padding:"10px 8px",whiteSpace:"nowrap"}} onClick={e=>e.stopPropagation()}>
          <button onClick={()=>setDetailIngreso(ing.id)} style={{...iconBtn,color:C.sky}} title="Ver detalle">🔍</button>
          <button onClick={()=>setModalIngreso({...ing})} style={{...iconBtn,color:C.blue}} title="Editar">✏️</button>
          <button onClick={()=>setDeleteConfirm({id:ing.id,label:`${ing.cliente} — ${ing.folio||ing.concepto||ing.segmento}`})} style={{...iconBtn,color:C.danger}} title="Eliminar">🗑️</button>
        </td>
      </tr>
    );
  };



  /* ── Proyección en Calendario ───────────────────────────────── */
  const ProyeccionCalendario = () => {
    const [calYear,  setCalYear]  = useState(() => new Date().getFullYear());
    const [calMonth, setCalMonth] = useState(() => new Date().getMonth());
    const [calDayDetailLocal, setCalDayDetailLocal] = useState(null);

    const MESES = ["Enero","Febrero","Marzo","Abril","Mayo","Junio","Julio","Agosto","Septiembre","Octubre","Noviembre","Diciembre"];
    const DIAS  = ["Dom","Lun","Mar","Mié","Jue","Vie","Sáb"];

    // Build map: "YYYY-MM-DD" → [ { ing, cobro?, tipo } ]
    const calMap = useMemo(() => {
      const map = {};
      // 1. Cobros proyectados manuales (prioridad)
      cobros.filter(c => c.tipo === 'proyectado' && c.fechaCobro).forEach(c => {
        const ing = ingresos.find(i => i.id === c.ingresoId);
        if (!ing) return;
        if (!map[c.fechaCobro]) map[c.fechaCobro] = [];
        map[c.fechaCobro].push({ ing, cobro: c, tipo: 'proyectado' });
      });
      // 2. Ingresos con fecha ficticia o vencimiento (sin cobros proyectados)
      ingresos.forEach(ing => {
        const tieneCobrosProy = cobros.some(c => c.ingresoId === ing.id && c.tipo === 'proyectado');
        if (tieneCobrosProy) return; // ya está cubierto arriba
        const fecha = ing.fechaFicticia || ing.fechaVencimiento;
        if (!fecha) return;
        const porCobrar = (metrics[ing.id]?.porCobrar || 0);
        if (porCobrar <= 0) return; // ya cobrado
        if (!map[fecha]) map[fecha] = [];
        map[fecha].push({
          ing,
          cobro: { monto: porCobrar, notas: ing.fechaFicticia ? "Fecha ficticia" : "Vencimiento" },
          tipo: ing.fechaFicticia ? 'ficticia' : 'vencimiento',
        });
      });
      return map;
    }, [cobros, ingresos, metrics]);

    const firstDay    = new Date(calYear, calMonth, 1).getDay();
    const daysInMonth = new Date(calYear, calMonth + 1, 0).getDate();
    const todayStr    = today();

    const prevMonth = () => { if(calMonth===0){setCalYear(y=>y-1);setCalMonth(11);}else setCalMonth(m=>m-1); };
    const nextMonth = () => { if(calMonth===11){setCalYear(y=>y+1);setCalMonth(0);}else setCalMonth(m=>m+1); };

    const monthPrefix = `${calYear}-${String(calMonth+1).padStart(2,'0')}`;
    const monthEntries = Object.entries(calMap).filter(([d])=>d.startsWith(monthPrefix));
    const monthTotals = {};
    monthEntries.forEach(([,items])=>items.forEach(({ing,cobro})=>{
      monthTotals[ing.moneda] = (monthTotals[ing.moneda]||0) + cobro.monto;
    }));

    return (
      <div>
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:16}}>
          <div>
            <h2 style={{fontSize:18,fontWeight:800,color:C.navy,margin:0}}>📆 Proyección de Cobros</h2>
            <p style={{color:C.muted,fontSize:13,margin:"4px 0 0"}}>Cobros proyectados capturados en el detalle de cada ingreso</p>
          </div>
          <button onClick={()=>setProyeccionView(false)} style={{...btnStyle,background:"#F1F5F9",color:C.text,padding:"7px 14px",fontSize:12}}>← Volver</button>
        </div>

        {Object.keys(monthTotals).length > 0 && (
          <div style={{display:"flex",gap:10,marginBottom:16,flexWrap:"wrap"}}>
            <span style={{fontSize:12,color:C.muted,alignSelf:"center"}}>Este mes:</span>
            {Object.entries(monthTotals).map(([mon,val])=>(
              <div key={mon} style={{background:{MXN:"#E3F2FD",USD:"#E8F5E9",EUR:"#F3E5F5"}[mon]||"#F8FAFC",border:"1px solid",borderColor:{MXN:"#90CAF9",USD:"#A5D6A7",EUR:"#CE93D8"}[mon]||"#E0E0E0",borderRadius:20,padding:"5px 14px",fontSize:13,fontWeight:700,color:{MXN:C.mxn,USD:C.usd,EUR:C.eur}[mon]||C.navy}}>
                {mon==="EUR"?"€":"$"}{fmt(val)} {mon}
              </div>
            ))}
          </div>
        )}

        <div style={{background:C.surface,border:`1px solid ${C.border}`,borderRadius:16,overflow:"hidden",boxShadow:"0 2px 12px rgba(0,0,0,.06)"}}>
          <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",padding:"14px 20px",background:C.navy}}>
            <button onClick={prevMonth} style={{background:"rgba(255,255,255,.15)",border:"none",color:"#fff",borderRadius:8,width:34,height:34,cursor:"pointer",fontSize:16,fontWeight:700}}>‹</button>
            <span style={{fontWeight:800,fontSize:17,color:"#fff"}}>{MESES[calMonth]} {calYear}</span>
            <button onClick={nextMonth} style={{background:"rgba(255,255,255,.15)",border:"none",color:"#fff",borderRadius:8,width:34,height:34,cursor:"pointer",fontSize:16,fontWeight:700}}>›</button>
          </div>
          <div style={{display:"grid",gridTemplateColumns:"repeat(7,1fr)",background:"#F8FAFC",borderBottom:`1px solid ${C.border}`}}>
            {DIAS.map(d=>(
              <div key={d} style={{padding:"8px 4px",textAlign:"center",fontSize:11,fontWeight:700,color:C.muted,textTransform:"uppercase"}}>{d}</div>
            ))}
          </div>
          <div style={{display:"grid",gridTemplateColumns:"repeat(7,1fr)"}}>
            {Array.from({length:firstDay}).map((_,i)=>(
              <div key={`e${i}`} style={{minHeight:110,background:"#FAFBFC",borderRight:`1px solid ${C.border}`,borderBottom:`1px solid ${C.border}`}}/>
            ))}
            {Array.from({length:daysInMonth}).map((_,i)=>{
              const day = i + 1;
              const dateStr = `${calYear}-${String(calMonth+1).padStart(2,'0')}-${String(day).padStart(2,'0')}`;
              const entries = calMap[dateStr] || [];
              const isToday = dateStr === todayStr;
              const hasCobros = entries.length > 0;
              const byMon = {};
              entries.forEach(({ing,cobro})=>{ byMon[ing.moneda]=(byMon[ing.moneda]||0)+cobro.monto; });
              // Color by dominant type
              const tipos = entries.map(e=>e.tipo);
              const bgCell = !hasCobros ? (isToday?"#E8F0FE":C.surface) :
                tipos.includes('proyectado') ? "#F3E5F5" :
                tipos.includes('ficticia')   ? "#E8F5E9" : "#FFF3E0";
              const textCol = !hasCobros ? C.text :
                tipos.includes('proyectado') ? "#7B1FA2" :
                tipos.includes('ficticia')   ? "#2E7D32" : "#E65100";

              return (
                <div key={day}
                  onClick={hasCobros ? ()=>setCalDayDetailLocal({fecha:dateStr,entries}) : undefined}
                  style={{minHeight:110,padding:"8px 8px 6px",borderRight:`1px solid ${C.border}`,borderBottom:`1px solid ${C.border}`,background:bgCell,cursor:hasCobros?"pointer":"default",transition:"background .15s"}}
                  onMouseEnter={e=>{if(hasCobros)e.currentTarget.style.opacity=".85";}}
                  onMouseLeave={e=>{if(hasCobros)e.currentTarget.style.opacity="1";}}>
                  <div style={{width:28,height:28,borderRadius:"50%",display:"flex",alignItems:"center",justifyContent:"center",background:isToday?C.navy:"transparent",color:isToday?"#fff":hasCobros?textCol:C.text,fontWeight:isToday||hasCobros?800:400,fontSize:14,marginBottom:6}}>{day}</div>
                  {Object.entries(byMon).map(([mon,val])=>(
                    <div key={mon} style={{background:{MXN:"#1976D2",USD:"#2E7D32",EUR:"#6A1B9A"}[mon]||"#546E7A",color:"#fff",borderRadius:7,padding:"4px 7px",fontSize:13,fontWeight:800,marginBottom:4,whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis",letterSpacing:"-0.3px"}}>
                      {mon==="EUR"?"€":"$"}{fmt(val)}
                      <span style={{fontSize:10,fontWeight:600,opacity:.85,marginLeft:3}}>{mon}</span>
                    </div>
                  ))}
                  {hasCobros && (
                    <div style={{fontSize:10,color:textCol,fontWeight:700,marginTop:2}}>
                      {tipos.includes('proyectado')?"📆 Proyectado":tipos.includes('ficticia')?"📅 Ficticia":"⏰ Vencimiento"}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>

        <div style={{display:"flex",gap:16,marginTop:12,fontSize:11,color:C.muted,flexWrap:"wrap"}}>
          <span style={{display:"flex",alignItems:"center",gap:5}}><span style={{width:14,height:14,borderRadius:3,background:"#F3E5F5",border:"1px solid #CE93D8",display:"inline-block"}}/>📆 Cobro proyectado manual</span>
          <span style={{display:"flex",alignItems:"center",gap:5}}><span style={{width:14,height:14,borderRadius:3,background:"#E8F5E9",border:"1px solid #A5D6A7",display:"inline-block"}}/>📅 Fecha ficticia de cobro</span>
          <span style={{display:"flex",alignItems:"center",gap:5}}><span style={{width:14,height:14,borderRadius:3,background:"#FFF3E0",border:"1px solid #FFCC80",display:"inline-block"}}/>⏰ Fecha de vencimiento</span>
          <span style={{display:"flex",alignItems:"center",gap:5}}><span style={{width:14,height:14,borderRadius:"50%",background:C.navy,display:"inline-block"}}/>Hoy</span>
        </div>

        {/* Day detail popup */}
        {calDayDetailLocal && (
          <div style={{position:"fixed",inset:0,background:"rgba(15,45,74,.5)",display:"flex",alignItems:"center",justifyContent:"center",zIndex:3000,padding:20}}
            onClick={()=>setCalDayDetailLocal(null)}>
            <div onClick={e=>e.stopPropagation()}
              style={{background:C.surface,borderRadius:20,padding:28,width:"100%",maxWidth:540,maxHeight:"80vh",overflowY:"auto",boxShadow:"0 24px 64px rgba(0,0,0,.3)"}}>
              <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:18}}>
                <div>
                  <div style={{fontSize:11,color:C.muted,fontWeight:700,textTransform:"uppercase"}}>Cobros proyectados</div>
                  <div style={{fontSize:20,fontWeight:900,color:"#7B1FA2"}}>📅 {calDayDetailLocal.fecha}</div>
                </div>
                <button onClick={()=>setCalDayDetailLocal(null)} style={{background:"#F1F5F9",border:"none",borderRadius:8,width:32,height:32,cursor:"pointer",fontSize:16}}>×</button>
              </div>
              {(()=>{
                const dt = {};
                calDayDetailLocal.entries.forEach(({ing,cobro})=>{ dt[ing.moneda]=(dt[ing.moneda]||0)+cobro.monto; });
                return (
                  <div style={{display:"flex",gap:8,marginBottom:16,flexWrap:"wrap"}}>
                    {Object.entries(dt).map(([mon,val])=>(
                      <div key={mon} style={{background:{MXN:"#E3F2FD",USD:"#E8F5E9",EUR:"#F3E5F5"}[mon],border:"1px solid",borderColor:{MXN:"#90CAF9",USD:"#A5D6A7",EUR:"#CE93D8"}[mon],borderRadius:10,padding:"10px 16px",textAlign:"center"}}>
                        <div style={{fontSize:10,color:C.muted,fontWeight:700,textTransform:"uppercase"}}>{mon}</div>
                        <div style={{fontSize:20,fontWeight:800,color:{MXN:C.mxn,USD:C.usd,EUR:C.eur}[mon]}}>{mon==="EUR"?"€":"$"}{fmt(val)}</div>
                      </div>
                    ))}
                  </div>
                );
              })()}
              {calDayDetailLocal.entries.map(({ing,cobro})=>{
                const sym = monedaSym(ing.moneda);
                const catStyle = getCatStyle(ing.categoria);
                return (
                  <div key={cobro.id}
                    style={{padding:"12px 14px",borderRadius:10,border:"1px solid #CE93D8",background:"#FAF0FF",marginBottom:8,cursor:"pointer"}}
                    onClick={()=>{setCalDayDetailLocal(null); setProyeccionView(false); setDetailIngreso(ing.id);}}>
                    <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start"}}>
                      <div>
                        <div style={{fontWeight:800,color:C.navy,fontSize:14}}>{ing.cliente}</div>
                        <div style={{fontSize:12,color:C.muted,marginTop:2}}>{ing.concepto||ing.categoria}</div>
                        <span style={{background:catStyle.bg,color:catStyle.text,border:`1px solid ${catStyle.border}`,padding:"1px 8px",borderRadius:20,fontSize:10,fontWeight:700,marginTop:4,display:"inline-block"}}>{ing.categoria}</span>
                      </div>
                      <div style={{textAlign:"right"}}>
                        <div style={{fontWeight:900,fontSize:16,color:"#7B1FA2"}}>{sym}{fmt(cobro.monto)} {ing.moneda}</div>
                        {cobro.notas && <div style={{fontSize:11,color:C.muted,fontStyle:"italic",marginTop:2}}>{cobro.notas}</div>}
                        <div style={{fontSize:10,color:C.muted,marginTop:4}}>Clic para ver detalle →</div>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>
    );
  };

  /* ── Main Render ───────────────────────────────────────────────── */
  if (proyeccionView) return (
    <div>
      <ProyeccionCalendario/>
      {detailIngreso && <DetailModal/>}
    </div>
  );

  const totalIngresos = ingresos.length;
  const pendientesDeCobrar = ingresos.filter(ing=>(metrics[ing.id]?.porCobrar||0)>0).length;

  return (
    <div>
      {/* Header */}
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:4,flexWrap:"wrap",gap:10}}>
        <div>
          <h1 style={{fontSize:24,fontWeight:800,color:C.navy,margin:0}}>💵 Cuentas por Cobrar</h1>
          <p style={{color:C.muted,fontSize:14,margin:"4px 0 0"}}>Controla ingresos de clientes y vincúlalos a tus gastos</p>
        </div>
        <div style={{display:"flex",gap:8,flexWrap:"wrap"}}>
          <button onClick={()=>setProyeccionView(true)} style={{...btnStyle,background:"#E8F0FE",color:C.blue,padding:"8px 16px",fontSize:13}}>📆 Proyección</button>
          <button onClick={()=>setConfigCats(true)} style={{...btnStyle,background:"#F1F5F9",color:C.text,padding:"8px 14px",fontSize:13}}>⚙️ Categorías</button>
          {/* Vista toggle */}
          <div style={{display:"flex",border:`1px solid ${C.border}`,borderRadius:10,overflow:"hidden"}}>
            <button onClick={()=>setVistaGrupo("cliente")} style={{padding:"8px 14px",border:"none",background:vistaGrupo==="cliente"?C.navy:"#F1F5F9",color:vistaGrupo==="cliente"?"#fff":C.text,fontWeight:700,fontSize:13,cursor:"pointer",fontFamily:"inherit"}}>👥 Por cliente</button>
            <button onClick={()=>setVistaGrupo("ingreso")} style={{padding:"8px 14px",border:"none",background:vistaGrupo==="ingreso"?C.navy:"#F1F5F9",color:vistaGrupo==="ingreso"?"#fff":C.text,fontWeight:700,fontSize:13,cursor:"pointer",fontFamily:"inherit"}}>📋 Por ingreso</button>
          </div>
          {/* Importar Excel TravelAirSolutions */}
          {empresaId === "empresa_2" && (
            <button onClick={()=>{setTasPreview(null);setTasModal(true);}} style={{...btnStyle,background:"#C0392B",color:"#fff",padding:"8px 16px",fontSize:13}}>✈️ Importar TAS</button>
          )}
          <button onClick={()=>{setImportPreview(null);setImportModal(true);}} style={{...btnStyle,background:"#00897B",color:"#fff",padding:"8px 16px",fontSize:13}}>📥 Importar Excel</button>
          <button onClick={()=>setModalIngreso({id:"",cliente:"",concepto:"",categoria:catList[0]||"Circuito",monto:"",moneda:"MXN",tipoCambio:1,fecha:today(),notas:""})} style={btnStyle}>
            + Nuevo Ingreso
          </button>
        </div>
      </div>
      {/* Hidden file inputs */}
      <input ref={importRef} type="file" accept=".xlsx,.xls" onChange={handleImportFile} style={{display:"none"}}/>
      <input ref={tasImportRef} type="file" accept=".xlsx,.xls" onChange={handleTasImport} style={{display:"none"}}/>

      {/* KPI Cards — per currency */}
      <div style={{display:"flex",gap:12,flexWrap:"wrap",margin:"20px 0"}}>
        {Object.entries(kpis).map(([mon,v])=>{
          if (v.monto === 0 && v.cobrado === 0) return null;
          const sym = monedaSym(mon);
          const flagMap = {MXN:"🇲🇽",USD:"🇺🇸",EUR:"🇪🇺"};
          const colMap  = {MXN:C.mxn,USD:C.usd,EUR:C.eur};
          const bgMap   = {MXN:"#E3F2FD",USD:"#E8F5E9",EUR:"#F3E5F5"};
          const mk = (key,label,value,color,icon,bg,tipo) => (
            <div key={key} onClick={()=>setKpiModal({titulo:label,tipo,moneda:mon})}
              style={{background:bg||C.surface,borderRadius:16,padding:"18px 22px",border:`1px solid ${C.border}`,boxShadow:"0 2px 8px rgba(0,0,0,.05)",flex:1,minWidth:150,cursor:"pointer",transition:"transform .15s, box-shadow .15s"}}
              onMouseEnter={e=>{e.currentTarget.style.transform="scale(1.03)";e.currentTarget.style.boxShadow="0 6px 20px rgba(0,0,0,.12)";}}
              onMouseLeave={e=>{e.currentTarget.style.transform="scale(1)";e.currentTarget.style.boxShadow="0 2px 8px rgba(0,0,0,.05)";}}>
              <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start"}}>
                <div>
                  <div style={{fontSize:11,color:C.muted,fontWeight:700,textTransform:"uppercase",letterSpacing:.5}}>{label}</div>
                  <div style={{fontSize:22,fontWeight:800,color,marginTop:4}}>{value}</div>
                  <div style={{fontSize:10,color:C.muted,marginTop:3}}>Clic para ver desglose</div>
                </div>
                <div style={{fontSize:26}}>{icon}</div>
              </div>
            </div>
          );
          return [
            mk(`${mon}-monto`,    `${flagMap[mon]} ${mon} Total`,  `${sym}${fmt(v.monto)}`,         colMap[mon],    "💼", bgMap[mon],    "total"),
            mk(`${mon}-cobrado`,  `${mon} Cobrado`,                `${sym}${fmt(v.cobrado)}`,        C.ok,           "✅", null,          "cobrado"),
            mk(`${mon}-porCobrar`,`${mon} Por Cobrar`,             `${sym}${fmt(v.porCobrar)}`,      C.warn,         "⏳", null,          "porCobrar"),
            mk(`${mon}-consumido`,`${mon} Consumido`,              `${sym}${fmt(v.consumido)}`,      C.danger,       "📤", null,          "consumido"),
            mk(`${mon}-porPagar`, `${mon} Por Pagar`,              `${sym}${fmt(v.porPagar)}`,       "#E65100",      "🧾", "#FFF3E0",     "porPagar"),
            mk(`${mon}-disponible`,`${mon} Disponible`,            `${sym}${fmt(v.disponible)}`,     C.teal,         "💰", null,          "disponible"),
            mk(`${mon}-dispNeto`, `${mon} Disponible Neto`,        `${sym}${fmt(v.disponibleNeto)}`, v.disponibleNeto>=0?C.green:C.danger,"🏦",v.disponibleNeto>=0?"#E8F5E9":"#FFEBEE","disponibleNeto"),
          ];
        })}
      </div>

      {/* ── KPI Desglose Modal ── */}
      {kpiModal && (()=>{
        const { titulo, tipo, moneda } = kpiModal;
        const sym = monedaSym(moneda);

        // Filtra los ingresos de esa moneda según el tipo de KPI
        const rows = ingresos.filter(ing => ing.moneda === moneda).map(ing => {
          const m = metrics[ing.id] || {};
          let valor = 0;
          if (tipo === "total")          valor = ing.monto;
          else if (tipo === "cobrado")   valor = m.totalCobrado || 0;
          else if (tipo === "porCobrar") valor = m.porCobrar || 0;
          else if (tipo === "consumido") valor = m.consumido || 0;
          else if (tipo === "porPagar")  valor = m.porPagar || 0;
          else if (tipo === "disponible")    valor = m.disponible || 0;
          else if (tipo === "disponibleNeto") valor = m.disponibleNeto || 0;
          return { ing, valor };
        }).filter(r => r.valor !== 0).sort((a,b) => Math.abs(b.valor) - Math.abs(a.valor));

        const total = rows.reduce((s,r) => s+r.valor, 0);
        const colorTipo = {
          total:C.navy, cobrado:C.ok, porCobrar:C.warn, consumido:C.danger,
          porPagar:"#E65100", disponible:C.teal, disponibleNeto:total>=0?C.green:C.danger
        }[tipo]||C.navy;

        return (
          <div style={{position:"fixed",inset:0,background:"rgba(15,45,74,.5)",display:"flex",alignItems:"center",justifyContent:"center",zIndex:2500,padding:20}}
            onClick={()=>setKpiModal(null)}>
            <div onClick={e=>e.stopPropagation()}
              style={{background:C.surface,borderRadius:20,padding:28,width:"100%",maxWidth:620,maxHeight:"85vh",overflowY:"auto",boxShadow:"0 24px 64px rgba(0,0,0,.3)"}}>
              {/* Header */}
              <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:20}}>
                <div>
                  <div style={{fontSize:11,color:C.muted,fontWeight:700,textTransform:"uppercase",letterSpacing:.5,marginBottom:4}}>Desglose</div>
                  <div style={{fontSize:20,fontWeight:900,color:colorTipo}}>{titulo}</div>
                </div>
                <button onClick={()=>setKpiModal(null)} style={{background:"#F1F5F9",border:"none",borderRadius:8,width:34,height:34,cursor:"pointer",fontSize:18}}>×</button>
              </div>
              {/* Total */}
              <div style={{background:"#F8FAFC",borderRadius:10,padding:"12px 16px",marginBottom:20,display:"flex",justifyContent:"space-between",alignItems:"center"}}>
                <span style={{fontSize:13,color:C.muted,fontWeight:600}}>Total {moneda}</span>
                <span style={{fontSize:22,fontWeight:900,color:colorTipo}}>{sym}{fmt(total)}</span>
              </div>
              {/* Tabla de ingresos */}
              {rows.length === 0 ? (
                <div style={{textAlign:"center",padding:30,color:C.muted}}>Sin registros</div>
              ) : (
                <table style={{width:"100%",borderCollapse:"collapse",fontSize:13}}>
                  <thead>
                    <tr style={{background:"#F8FAFC"}}>
                      {["Cliente","Concepto","Categoría","Fecha","Importe"].map(h=>(
                        <th key={h} style={{padding:"9px 10px",textAlign:h==="Importe"?"right":"left",color:C.muted,fontWeight:700,fontSize:11,textTransform:"uppercase",borderBottom:`2px solid ${C.border}`}}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map(({ing,valor},idx)=>{
                      const catStyle = getCatStyle(ing.categoria);
                      return (
                        <tr key={ing.id}
                          style={{borderBottom:`1px solid ${C.border}`,background:idx%2===0?C.surface:"#FAFBFC",cursor:"pointer",transition:"background .12s"}}
                          onClick={()=>{setKpiModal(null); setDetailIngreso(ing.id);}}
                          onMouseEnter={e=>{e.currentTarget.style.background="#F0F7FF";}}
                          onMouseLeave={e=>{e.currentTarget.style.background=idx%2===0?C.surface:"#FAFBFC";}}>
                          <td style={{padding:"10px 10px",fontWeight:700,color:C.navy}}>{ing.cliente}</td>
                          <td style={{padding:"10px 10px",color:ing.concepto?C.text:C.muted,fontStyle:ing.concepto?"normal":"italic",maxWidth:160,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{ing.concepto||"—"}</td>
                          <td style={{padding:"10px 10px"}}>
                            <span style={{background:catStyle.bg,color:catStyle.text,border:`1px solid ${catStyle.border}`,padding:"2px 8px",borderRadius:20,fontSize:11,fontWeight:700,whiteSpace:"nowrap"}}>{ing.categoria}</span>
                          </td>
                          <td style={{padding:"10px 10px",fontSize:12,color:C.muted,whiteSpace:"nowrap"}}>{ing.fecha||"—"}</td>
                          <td style={{padding:"10px 10px",textAlign:"right",fontWeight:800,color:valor>=0?colorTipo:C.danger}}>{sym}{fmt(valor)}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                  <tfoot>
                    <tr style={{borderTop:`2px solid ${C.navy}`,background:"#EEF2FF"}}>
                      <td colSpan={4} style={{padding:"10px 10px",fontWeight:800,color:C.navy,fontSize:13}}>TOTAL ({rows.length} ingresos)</td>
                      <td style={{padding:"10px 10px",textAlign:"right",fontWeight:900,fontSize:15,color:colorTipo}}>{sym}{fmt(total)}</td>
                    </tr>
                  </tfoot>
                </table>
              )}
              <div style={{fontSize:11,color:C.muted,marginTop:12,textAlign:"center"}}>Clic en una fila para abrir el detalle del ingreso</div>
            </div>
          </div>
        );
      })()}

      {/* Global stats strip */}
      <div style={{display:"flex",gap:12,marginBottom:20,flexWrap:"wrap"}}>
        <div style={{background:"#E8F0FE",border:`1px solid #C7D7FD`,borderRadius:10,padding:"8px 16px",fontSize:13}}>
          <span style={{color:C.muted}}>Total ingresos: </span><span style={{fontWeight:700,color:C.navy}}>{totalIngresos}</span>
        </div>
        <div style={{background:"#FFF3E0",border:"1px solid #FFCC80",borderRadius:10,padding:"8px 16px",fontSize:13}}>
          <span style={{color:C.muted}}>Pendientes de cobro: </span><span style={{fontWeight:700,color:C.warn}}>{pendientesDeCobrar}</span>
        </div>
        <div style={{background:"#E0F2F1",border:"1px solid #80CBC4",borderRadius:10,padding:"8px 16px",fontSize:13}}>
          <span style={{color:C.muted}}>Vinculaciones activas: </span><span style={{fontWeight:700,color:C.teal}}>{invoiceIngresos.length}</span>
        </div>
      </div>

      {/* Filters */}
      <div style={{background:C.surface,border:`1px solid ${C.border}`,borderRadius:14,padding:18,marginBottom:20}}>
        <div style={{display:"flex",gap:10,flexWrap:"wrap",alignItems:"center"}}>
          <input placeholder="🔍 Buscar cliente, concepto…" value={filtroSearch} onChange={e=>setFiltroSearch(e.target.value)} style={{...inputStyle,maxWidth:220}}/>
          <select value={filtroCliente} onChange={e=>setFiltroCliente(e.target.value)} style={{...selectStyle,maxWidth:200}}>
            <option value="">Todos los clientes</option>
            {clientesList.map(c=><option key={c}>{c}</option>)}
          </select>
          <select value={filtroCategoria} onChange={e=>setFiltroCategoria(e.target.value)} style={{...selectStyle,maxWidth:180}}>
            <option value="">Todas las categorías</option>
            {catList.map(c=><option key={c}>{c}</option>)}
          </select>
          <select value={filtroMoneda} onChange={e=>setFiltroMoneda(e.target.value)} style={{...selectStyle,maxWidth:130}}>
            <option value="">Todas las monedas</option>
            <option value="MXN">🇲🇽 MXN</option>
            <option value="USD">🇺🇸 USD</option>
            <option value="EUR">🇪🇺 EUR</option>
          </select>
          <select value={filtroCobro} onChange={e=>setFiltroCobro(e.target.value)} style={{...selectStyle,maxWidth:160}}>
            <option value="">💵 Todos</option>
            <option value="cobrado">✅ Con cobros</option>
            <option value="porCobrar">⏳ Por cobrar</option>
          </select>
          {/* Mes de Venta (Fecha Contable) */}
          <select value={filtroMesContable} onChange={e=>setFiltroMesContable(e.target.value)} style={{...selectStyle,maxWidth:170,borderColor:filtroMesContable?"#7B1FA2":C.border,color:filtroMesContable?"#7B1FA2":C.text}}>
            <option value="">📅 Mes de Venta</option>
            {mesesContableList.map(m=>{
              const [y,mo]=m.split("-");
              return <option key={m} value={m}>{MESES_NOMBRES[+mo-1]} {y}</option>;
            })}
          </select>
          {/* Segmento */}
          {segmentosList.length > 0 && (
            <select value={filtroSegmento} onChange={e=>setFiltroSegmento(e.target.value)} style={{...selectStyle,maxWidth:150}}>
              <option value="">Todos los segmentos</option>
              {segmentosList.map(s=><option key={s}>{s}</option>)}
            </select>
          )}
          <input type="date" value={filtroFechaFrom} onChange={e=>setFiltroFechaFrom(e.target.value)} style={{...inputStyle,maxWidth:150}} title="Desde"/>
          <input type="date" value={filtroFechaTo} onChange={e=>setFiltroFechaTo(e.target.value)} style={{...inputStyle,maxWidth:150}} title="Hasta"/>
          {(filtroSearch||filtroCliente||filtroCategoria||filtroMoneda||filtroFechaFrom||filtroFechaTo||filtroCobro||filtroMesContable||filtroSegmento) && (
            <button onClick={()=>{setFiltroSearch("");setFiltroCliente("");setFiltroCategoria("");setFiltroMoneda("");setFiltroFechaFrom("");setFiltroFechaTo("");setFiltroCobro("");setFiltroMesContable("");setFiltroSegmento("");}} style={{...btnStyle,background:"#F1F5F9",color:C.text,padding:"7px 14px",fontSize:12}}>✕ Limpiar</button>
          )}
        </div>
      </div>

      {/* Bulk toolbar */}
      {selectedIngresos.size > 0 && (
        <div style={{background:"#E8F0FE",border:`1px solid ${C.blue}`,borderRadius:10,padding:"10px 16px",marginBottom:12}}>
          <div style={{display:"flex",alignItems:"center",gap:12,flexWrap:"wrap"}}>
            <span style={{fontWeight:700,color:C.blue,fontSize:13}}>{selectedIngresos.size} ingreso{selectedIngresos.size!==1?"s":""} seleccionado{selectedIngresos.size!==1?"s":""}</span>
            {Object.entries(selectedTotals).map(([mon,v])=>(
              <div key={mon} style={{display:"flex",gap:10,fontSize:12,flexWrap:"wrap"}}>
                <span style={{fontWeight:700,color:{MXN:C.mxn,USD:C.usd,EUR:C.eur}[mon]}}>{mon}:</span>
                <span style={{color:C.navy,fontWeight:700}}>Total {monedaSym(mon)}{fmt(v.monto)}</span>
                <span style={{color:C.ok}}>Cobrado {monedaSym(mon)}{fmt(v.cobrado)}</span>
                <span style={{color:C.warn}}>x Cobrar {monedaSym(mon)}{fmt(v.porCobrar)}</span>
              </div>
            ))}
          </div>
          <div style={{display:"flex",gap:8,marginTop:8,flexWrap:"wrap"}}>
            <button onClick={()=>setCobroMasivoModal(true)} style={{...btnStyle,background:C.ok,padding:"6px 14px",fontSize:12}}>💰 Cobro Masivo</button>
            <button onClick={()=>setBulkFechaModal(true)} style={{...btnStyle,background:"#7B1FA2",padding:"6px 14px",fontSize:12}}>📅 Fecha Ficticia Masiva</button>
            <button onClick={()=>setSelectedIngresos(new Set())} style={{...btnStyle,background:"#F1F5F9",color:C.text,padding:"6px 12px",fontSize:12}}>✕ Deseleccionar</button>
          </div>
        </div>
      )}

      {/* Ingresos — vista condicional */}
      {filtered.length === 0 ? (
        <div style={{textAlign:"center",padding:60,color:C.muted,background:C.surface,borderRadius:14,border:`1px solid ${C.border}`}}>
          <div style={{fontSize:48,marginBottom:12}}>💵</div>
          <div style={{fontSize:16,fontWeight:600}}>
            {ingresos.length === 0 ? "Sin ingresos registrados" : "Sin resultados con estos filtros"}
          </div>
          {ingresos.length === 0 && (
            <button onClick={()=>setModalIngreso({id:"",cliente:"",concepto:"",categoria:catList[0]||"Circuito",monto:"",moneda:"MXN",tipoCambio:1,fecha:today(),notas:""})} style={{...btnStyle,marginTop:16}}>
              + Crear primer ingreso
            </button>
          )}
        </div>
      ) : vistaGrupo === "cliente" ? (

        /* ── VISTA AGRUPADA POR CLIENTE ── */
        <div style={{display:"flex",flexDirection:"column",gap:8}}>
          {groupedByCliente.map(([cliente, ings]) => {
            const expanded = clientesExpanded.has(cliente);
            // Consolidated metrics per moneda
            const byMon = {};
            ings.forEach(ing => {
              const m = metrics[ing.id] || {};
              const mon = ing.moneda;
              if (!byMon[mon]) byMon[mon] = {monto:0,cobrado:0,porCobrar:0,consumido:0,porPagar:0,disponible:0,disponibleNeto:0};
              byMon[mon].monto          += ing.monto;
              byMon[mon].cobrado        += m.totalCobrado||0;
              byMon[mon].porCobrar      += m.porCobrar||0;
              byMon[mon].consumido      += m.consumido||0;
              byMon[mon].porPagar       += m.porPagar||0;
              byMon[mon].disponible     += m.disponible||0;
              byMon[mon].disponibleNeto += m.disponibleNeto||0;
            });
            const monedas = Object.keys(byMon);
            return (
              <div key={cliente} style={{background:C.surface,border:`1px solid ${expanded?C.blue:C.border}`,borderRadius:14,overflow:"hidden",transition:"border-color .2s"}}>
                {/* Cliente header — clickable */}
                <div onClick={()=>toggleCliente(cliente)}
                  style={{display:"flex",justifyContent:"space-between",alignItems:"center",padding:"14px 18px",background:expanded?"#E8F0FE":"#F8FAFC",cursor:"pointer",transition:"background .15s"}}
                  onMouseEnter={e=>{if(!expanded)e.currentTarget.style.background="#F0F4FF";}}
                  onMouseLeave={e=>{if(!expanded)e.currentTarget.style.background="#F8FAFC";}}>
                  <div style={{display:"flex",alignItems:"center",gap:12}}>
                    <span style={{fontSize:16,color:expanded?C.blue:C.muted,transition:"transform .2s",display:"inline-block",transform:expanded?"rotate(90deg)":"rotate(0deg)"}}>▶</span>
                    <div>
                      <div style={{fontWeight:800,fontSize:15,color:C.navy}}>{cliente}</div>
                      <div style={{fontSize:12,color:C.muted,marginTop:2}}>{ings.length} ingreso{ings.length!==1?"s":""}</div>
                    </div>
                  </div>
                  {/* KPI chips por moneda */}
                  <div style={{display:"flex",gap:16,flexWrap:"wrap",alignItems:"center"}}>
                    {monedas.map(mon => {
                      const v = byMon[mon];
                      const sym = monedaSym(mon);
                      const monCol = {MXN:C.mxn,USD:C.usd,EUR:C.eur}[mon]||C.navy;
                      const monBg  = {MXN:"#E3F2FD",USD:"#E8F5E9",EUR:"#F3E5F5"}[mon]||"#F8FAFC";
                      return (
                        <div key={mon} style={{display:"flex",gap:10,flexWrap:"wrap",alignItems:"center"}}>
                          <span style={{background:monBg,color:monCol,fontWeight:800,fontSize:11,padding:"2px 8px",borderRadius:20}}>{mon}</span>
                          {[
                            {l:"Monto",           v:`${sym}${fmt(v.monto)}`,          c:C.navy},
                            {l:"Cobrado",         v:`${sym}${fmt(v.cobrado)}`,         c:C.ok},
                            {l:"Por Cobrar",      v:`${sym}${fmt(v.porCobrar)}`,       c:C.warn},
                            {l:"Consumido",       v:`${sym}${fmt(v.consumido||0)}`,    c:C.danger},
                            {l:"Por Pagar",       v:`${sym}${fmt(v.porPagar||0)}`,     c:"#E65100"},
                            {l:"Disponible",      v:`${sym}${fmt(v.disponible)}`,      c:C.teal},
                            {l:"Disponible Neto", v:`${sym}${fmt(v.disponibleNeto)}`,  c:v.disponibleNeto>=0?C.green:C.danger},
                          ].map(k=>(
                            <div key={k.l} style={{textAlign:"center",minWidth:100}}>
                              <div style={{fontSize:10,color:C.muted,fontWeight:700,textTransform:"uppercase",letterSpacing:.3}}>{k.l}</div>
                              <div style={{fontSize:16,fontWeight:800,color:k.c,marginTop:1}}>{k.v}</div>
                            </div>
                          ))}
                        </div>
                      );
                    })}
                  </div>
                </div>

                {/* Ingresos expandidos */}
                {expanded && (
                  <div style={{borderTop:`1px solid ${C.border}`,overflowX:"auto"}}>
                    <table style={{width:"100%",borderCollapse:"collapse",fontSize:12,minWidth:1000}}>
                      <thead>
                        <tr style={{background:"#EEF2FF"}}>
                          <th style={{padding:"8px 6px",width:36,textAlign:"center"}}>
                            <input type="checkbox" style={{cursor:"pointer",accentColor:C.blue}}
                              checked={ings.every(i=>selectedIngresos.has(i.id))}
                              onChange={()=>{
                                const allSelected = ings.every(i=>selectedIngresos.has(i.id));
                                setSelectedIngresos(prev=>{
                                  const n=new Set(prev);
                                  if(allSelected) ings.forEach(i=>n.delete(i.id));
                                  else ings.forEach(i=>n.add(i.id));
                                  return n;
                                });
                              }}/>
                          </th>
                          {["Segmento","Folio Factura","Concepto","Fecha Contable","Fecha Factura","Vencimiento","Días Vencidos","Por Vencer","Fecha Ficticia","Monto","Cobrado","Por Cobrar","Consumido","Por Pagar","Disponible","D. Neto","Acciones"].map(h=>(
                            <th key={h} style={{padding:"8px 8px",textAlign:["Monto","Cobrado","Por Cobrar","Consumido","Por Pagar","Disponible","D. Neto"].includes(h)?"right":["Días Vencidos","Por Vencer"].includes(h)?"center":"left",color:C.blue,fontWeight:700,fontSize:10,textTransform:"uppercase",whiteSpace:"nowrap"}}>{h}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {ings.map((ing,idx) => {
                          const m = metrics[ing.id]||{};
                          const sym = monedaSym(ing.moneda);
                          const disponColor = (m.disponible||0)>0?C.teal:(m.disponible||0)===0?C.muted:C.danger;
                          const isSelected = selectedIngresos.has(ing.id);
                          const hoy = today();
                          const venceProx = ing.fechaVencimiento && ing.fechaVencimiento < hoy;
                          return (
                            <tr key={ing.id}
                              style={{borderTop:`1px solid ${C.border}`,background:isSelected?"#E8F0FE":idx%2===0?"#FAFBFF":"#fff",cursor:"pointer"}}
                              onClick={()=>setDetailIngreso(ing.id)}
                              onMouseEnter={e=>{if(!isSelected)e.currentTarget.style.background="#E8F0FE";}}
                              onMouseLeave={e=>{if(!isSelected)e.currentTarget.style.background=idx%2===0?"#FAFBFF":"#fff";}}>
                              <td style={{padding:"8px 6px",textAlign:"center"}} onClick={e=>e.stopPropagation()}>
                                <input type="checkbox" checked={isSelected} onChange={()=>{
                                  setSelectedIngresos(prev=>{const n=new Set(prev);if(n.has(ing.id))n.delete(ing.id);else n.add(ing.id);return n;});
                                }} style={{cursor:"pointer",accentColor:C.blue}}/>
                              </td>
                              {/* Segmento */}
                              <td style={{padding:"8px 6px"}} onClick={e=>e.stopPropagation()}>
                                <input value={ing.segmento||""} onChange={e=>{const v=e.target.value;setIngresos(prev=>prev.map(i=>i.id===ing.id?{...i,segmento:v}:i));updateIngresoField(ing.id,{segmento:v});}} placeholder="—" style={{padding:"2px 5px",fontSize:10,border:`1px solid ${C.border}`,borderRadius:5,width:55,fontFamily:"inherit"}}/>
                              </td>
                              {/* Folio */}
                              <td style={{padding:"9px 8px",fontSize:11,color:C.blue,fontWeight:600,whiteSpace:"nowrap"}}>{ing.folio||"—"}</td>
                              {/* Concepto */}
                              <td style={{padding:"9px 8px",color:ing.concepto?C.text:C.muted,fontStyle:ing.concepto?"normal":"italic",minWidth:120}}>{ing.concepto||"—"}</td>
                              {/* Fecha Contable */}
                              <td style={{padding:"8px 6px"}} onClick={e=>e.stopPropagation()}>
                                <input type="date" value={ing.fechaContable||""} onChange={e=>{const v=e.target.value;setIngresos(prev=>prev.map(i=>i.id===ing.id?{...i,fechaContable:v}:i));updateIngresoField(ing.id,{fechaContable:v});}} style={{padding:"2px 5px",fontSize:10,border:`1px solid ${ing.fechaContable?C.teal:C.border}`,borderRadius:5,color:ing.fechaContable?C.teal:C.text,width:112,fontFamily:"inherit"}}/>
                              </td>
                              <td style={{padding:"9px 8px",whiteSpace:"nowrap",fontSize:11,color:C.muted}}>{ing.fecha||"—"}</td>
                              <td style={{padding:"9px 8px",whiteSpace:"nowrap",fontSize:11,color:venceProx?C.danger:C.text,fontWeight:ing.fechaVencimiento?600:400}}>{ing.fechaVencimiento||"—"}</td>
                              {/* Días Vencidos */}
                              <td style={{padding:"9px 6px",textAlign:"center"}}>{(() => { const d=diasDiff(ing.fechaVencimiento); return d!==null&&d<0?<span style={{background:"#FFEBEE",color:C.danger,fontWeight:800,fontSize:10,padding:"2px 6px",borderRadius:20}}>{Math.abs(d)}d</span>:<span style={{color:C.muted,fontSize:10}}>—</span>; })()}</td>
                              {/* Por Vencer */}
                              <td style={{padding:"9px 6px",textAlign:"center"}}>{(() => { const d=diasDiff(ing.fechaVencimiento); return d!==null&&d>=0?<span style={{background:d<=7?"#FFF3E0":d<=30?"#FFFDE7":"#E8F5E9",color:d<=7?C.danger:d<=30?C.warn:C.ok,fontWeight:800,fontSize:10,padding:"2px 6px",borderRadius:20}}>{d}d</span>:<span style={{color:C.muted,fontSize:10}}>—</span>; })()}</td>
                              {/* Fecha Ficticia */}
                              <td style={{padding:"8px 6px"}} onClick={e=>e.stopPropagation()}>
                                <input type="date" value={ing.fechaFicticia||""} onChange={e=>{const v=e.target.value;setIngresos(prev=>prev.map(i=>i.id===ing.id?{...i,fechaFicticia:v}:i));updateIngresoField(ing.id,{fechaFicticia:v});}} style={{padding:"2px 5px",fontSize:10,border:`1px solid ${ing.fechaFicticia?"#7B1FA2":C.border}`,borderRadius:5,color:ing.fechaFicticia?"#7B1FA2":C.text,width:112,fontFamily:"inherit"}}/>
                              </td>
                              <td style={{padding:"9px 10px",fontWeight:700,textAlign:"right"}}>{sym}{fmt(ing.monto)}</td>
                              <td style={{padding:"9px 10px",color:C.ok,textAlign:"right"}}>{sym}{fmt(m.totalCobrado||0)}</td>
                              <td style={{padding:"9px 10px",color:(m.porCobrar||0)>0?C.warn:C.ok,textAlign:"right",fontWeight:600}}>{sym}{fmt(m.porCobrar||0)}</td>
                              <td style={{padding:"9px 10px",color:C.danger,textAlign:"right"}}>{sym}{fmt(m.consumido||0)}</td>
                              <td style={{padding:"9px 10px",textAlign:"right"}}>
                                <span style={{color:"#E65100",background:(m.porPagar||0)>0?"#FFF3E0":"transparent",padding:(m.porPagar||0)>0?"1px 5px":"0",borderRadius:5,fontWeight:700}}>{sym}{fmt(m.porPagar||0)}</span>
                              </td>
                              <td style={{padding:"9px 10px",textAlign:"right"}}><span style={{fontWeight:800,color:disponColor}}>{sym}{fmt(m.disponible||0)}</span></td>
                              <td style={{padding:"9px 10px",textAlign:"right"}}>
                                <span style={{fontWeight:800,color:(m.disponibleNeto||0)>=0?C.green:C.danger,background:(m.disponibleNeto||0)>=0?"#E8F5E9":"#FFEBEE",padding:"2px 6px",borderRadius:5}}>{sym}{fmt(m.disponibleNeto||0)}</span>
                              </td>
                              <td style={{padding:"9px 8px",whiteSpace:"nowrap"}} onClick={e=>e.stopPropagation()}>
                                <button onClick={()=>setDetailIngreso(ing.id)} style={{...iconBtn,color:C.sky,fontSize:14}} title="Detalle">🔍</button>
                                <button onClick={()=>setModalIngreso({...ing})} style={{...iconBtn,color:C.blue,fontSize:14}} title="Editar">✏️</button>
                                <button onClick={()=>setDeleteConfirm({id:ing.id,label:`${ing.cliente} — ${ing.concepto||ing.categoria}`})} style={{...iconBtn,color:C.danger,fontSize:14}} title="Eliminar">🗑️</button>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            );
          })}
        </div>

      ) : (

        /* ── VISTA PLANA POR INGRESO (original) ── */
        <div style={{background:C.surface,border:`1px solid ${C.border}`,borderRadius:14,overflow:"hidden"}}>
          <div style={{overflowX:"auto"}}>
            <table style={{width:"100%",borderCollapse:"collapse",fontSize:13,minWidth:1100}}>
              <thead>
                <tr style={{background:C.navy}}>
                  <th style={{padding:"10px 6px",textAlign:"center",width:36}}>
                    <input type="checkbox" style={{cursor:"pointer",accentColor:"#fff"}}
                      checked={selectedIngresos.size===filtered.length && filtered.length>0}
                      onChange={()=>{
                        if(selectedIngresos.size===filtered.length) setSelectedIngresos(new Set());
                        else setSelectedIngresos(new Set(filtered.map(i=>i.id)));
                      }}/>
                  </th>
                  {[
                    {label:"Segmento",       col:"segmento"},
                    {label:"Cliente",         col:"cliente"},
                    {label:"Folio Factura",   col:"folio"},
                    {label:"Concepto",        col:"concepto"},
                    {label:"Moneda",          col:"moneda"},
                    {label:"Fecha Contable",  col:"fechaContable"},
                    {label:"Fecha Factura",   col:"fecha"},
                    {label:"Vencimiento",     col:"fechaVencimiento"},
                    {label:"Días Vencidos",   col:"diasVencidos"},
                    {label:"Por Vencer",      col:null},
                    {label:"Fecha Ficticia",  col:"fechaFicticia"},
                    {label:"Monto",           col:"monto",       right:true},
                    {label:"Cobrado",         col:"cobrado",     right:true},
                    {label:"Por Cobrar",      col:"porCobrar",   right:true},
                    {label:"Consumido",       col:"consumido",   right:true},
                    {label:"Por Pagar",       col:"porPagar",    right:true},
                    {label:"Disponible",      col:"disponible",  right:true},
                    {label:"Disp. Neto",      col:"disponibleNeto", right:true},
                    {label:"Acciones",        col:null},
                  ].map(h=>(
                    <th key={h.label}
                      onClick={h.col ? ()=>handleSort(h.col) : undefined}
                      style={{padding:"10px 8px",textAlign:h.right?"right":"left",color:"#fff",fontWeight:600,fontSize:10,textTransform:"uppercase",whiteSpace:"nowrap",cursor:h.col?"pointer":"default",userSelect:"none"}}
                    >{h.label}{h.col ? sortIcon(h.col) : ""}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {sortedFiltered.map((ing,idx)=><IngresoRow key={ing.id} ing={ing} idx={idx}/>)}
              </tbody>
              {Object.keys(filteredTotals).map(mon => {
                const v = filteredTotals[mon];
                const sym = monedaSym(mon);
                return (
                  <tfoot key={mon}>
                    <tr style={{borderTop:`2px solid ${C.navy}`,background:"#EEF2FF"}}>
                      <td colSpan={4} style={{padding:"8px 10px",fontWeight:800,color:C.navy,fontSize:12}}>
                        TOTAL {mon} ({filtered.filter(i=>i.moneda===mon).length} registros)
                      </td>
                      <td colSpan={7}/>
                      <td style={{padding:"8px 10px",fontWeight:800,textAlign:"right",color:C.navy,whiteSpace:"nowrap"}}>{sym}{fmt(v.monto)}</td>
                      <td style={{padding:"8px 10px",fontWeight:800,textAlign:"right",color:C.ok,whiteSpace:"nowrap"}}>{sym}{fmt(v.cobrado)}</td>
                      <td style={{padding:"8px 10px",fontWeight:800,textAlign:"right",color:C.warn,whiteSpace:"nowrap"}}>{sym}{fmt(v.porCobrar)}</td>
                      <td style={{padding:"8px 10px",fontWeight:800,textAlign:"right",color:C.danger,whiteSpace:"nowrap"}}>{sym}{fmt(v.consumido)}</td>
                      <td style={{padding:"8px 10px",fontWeight:800,textAlign:"right",color:"#E65100",whiteSpace:"nowrap"}}>{sym}{fmt(v.porPagar)}</td>
                      <td style={{padding:"8px 10px",fontWeight:800,textAlign:"right",color:C.teal,whiteSpace:"nowrap"}}>{sym}{fmt(v.disponible)}</td>
                      <td style={{padding:"8px 10px",fontWeight:800,textAlign:"right",color:v.disponibleNeto>=0?C.green:C.danger,whiteSpace:"nowrap"}}>{sym}{fmt(v.disponibleNeto)}</td>
                      <td/>
                    </tr>
                  </tfoot>
                );
              })}
            </table>
          </div>
        </div>
      )}

      {/* ── Nota de multimoneda */}
      <div style={{marginTop:12,padding:"10px 14px",background:"#FFFDE7",border:"1px solid #FFE082",borderRadius:8,fontSize:11,color:"#856404",lineHeight:1.6}}>
        💡 <b>Consumido</b> = facturas pagadas vinculadas · <b>Por Pagar</b> = facturas pendientes/parciales vinculadas (no afecta Disponible) ·
        <b> Disponible</b> = Cobrado − Consumido · <b>Disp. Neto</b> = Disponible − Por Pagar (lo que queda tras cubrir todo lo comprometido).
        Los totales no se suman entre monedas distintas.
      </div>

      {/* ── Modals ── */}
      {modalIngreso && <IngresoModal/>}
      {detailIngreso && <DetailModal/>}

      {/* Delete confirm */}
      {deleteConfirm && (
        <ModalShell title="Confirmar Eliminación" onClose={()=>setDeleteConfirm(null)}>
          <div style={{textAlign:"center",padding:"20px 0"}}>
            <div style={{fontSize:48,marginBottom:16}}>🗑️</div>
            <p style={{fontSize:15,color:C.text,marginBottom:8}}>¿Eliminar este ingreso?</p>
            <p style={{fontSize:14,fontWeight:700,color:C.navy,marginBottom:8}}>{deleteConfirm.label}</p>
            <p style={{fontSize:12,color:C.danger,marginBottom:24}}>Se eliminan también sus cobros y vinculaciones con facturas.</p>
            <div style={{display:"flex",gap:12,justifyContent:"center"}}>
              <button onClick={()=>setDeleteConfirm(null)} style={{...btnStyle,background:"#F1F5F9",color:C.text,padding:"10px 28px"}}>Cancelar</button>
              <button onClick={handleDeleteIngreso} style={{...btnStyle,background:C.danger,padding:"10px 28px"}}>Sí, Eliminar</button>
            </div>
          </div>
        </ModalShell>
      )}

      {/* Config categorías */}
      {configCats && (
        <ModalShell title="⚙️ Categorías de Ingreso" onClose={()=>setConfigCats(false)}>
          <div style={{marginBottom:16}}>
            <div style={{display:"flex",flexWrap:"wrap",gap:8,marginBottom:16}}>
              {catList.map(c=>{
                const cs = getCatStyle(c);
                return (
                  <div key={c} style={{display:"flex",alignItems:"center",gap:4,background:cs.bg,border:`1px solid ${cs.border}`,borderRadius:20,padding:"4px 12px"}}>
                    <span style={{fontSize:13,color:cs.text,fontWeight:600}}>{c}</span>
                    {catList.length > 1 && (
                      <button onClick={()=>removeCategoria(c)} style={{background:"none",border:"none",cursor:"pointer",color:C.danger,fontSize:14,padding:0}}>×</button>
                    )}
                  </div>
                );
              })}
            </div>
            <div style={{display:"flex",gap:8}}>
              <input placeholder="Nueva categoría…" value={newCatInput} onChange={e=>setNewCatInput(e.target.value)}
                onKeyDown={e=>{if(e.key==="Enter") addCategoria();}}
                style={{...inputStyle,flex:1}}/>
              <button onClick={addCategoria} style={btnStyle}>Agregar</button>
            </div>
          </div>
          <div style={{background:"#EEF2FF",borderRadius:8,padding:"10px 14px",fontSize:12,color:C.muted}}>
            💡 Las categorías predeterminadas son: {DEFAULT_CATS.join(", ")}.
          </div>
        </ModalShell>
      )}

      {/* Import Modal */}
      {importModal && (
        <ModalShell title="📥 Importar Ingresos desde Excel" onClose={()=>{setImportModal(false);setImportPreview(null);}} wide>
          {!importPreview ? (
            <div>
              {/* Upload zone */}
              <div onClick={()=>importRef.current?.click()}
                style={{border:`2px dashed ${C.border}`,borderRadius:14,padding:40,textAlign:"center",cursor:"pointer",background:"#FAFBFC",marginBottom:20,transition:"border-color .2s"}}
                onMouseEnter={e=>{e.currentTarget.style.borderColor=C.blue;}}
                onMouseLeave={e=>{e.currentTarget.style.borderColor=C.border;}}>
                <div style={{fontSize:44,marginBottom:10}}>📂</div>
                <div style={{fontSize:16,fontWeight:700,color:C.navy,marginBottom:4}}>Selecciona tu archivo Excel</div>
                <div style={{fontSize:13,color:C.muted,marginBottom:16}}>Formatos: .xlsx · .xls</div>
                <button style={btnStyle} onClick={e=>{e.stopPropagation();importRef.current?.click();}}>Seleccionar archivo</button>
              </div>
              {/* Expected format */}
              <div style={{background:"#EEF2FF",border:"1px solid #C7D7FD",borderRadius:12,padding:16}}>
                <div style={{fontWeight:700,color:C.navy,marginBottom:10,fontSize:13}}>📋 Columnas esperadas</div>
                <div style={{overflowX:"auto"}}>
                  <table style={{borderCollapse:"collapse",fontSize:12,minWidth:500}}>
                    <thead><tr style={{background:C.navy}}>
                      {["Tipo","Fecha Emision","Serie","Folio","UUID","Nombre Receptor","SubTotal","IVA 16%","Total","Moneda"].map(h=>(
                        <th key={h} style={{padding:"6px 10px",color:"#fff",fontWeight:600,fontSize:10,textTransform:"uppercase",whiteSpace:"nowrap"}}>{h}</th>
                      ))}
                    </tr></thead>
                    <tbody><tr style={{background:"#fff"}}>
                      {["Factura","10/03/2026","A","11439","fcd49e…","TRANSPORTES BROMELIA","6,882.33","1,101.17","7,983.50","MXN"].map((v,i)=>(
                        <td key={i} style={{padding:"6px 10px",borderBottom:`1px solid ${C.border}`,textAlign:"center",fontSize:11}}>{v}</td>
                      ))}
                    </tr></tbody>
                  </table>
                </div>
                <div style={{fontSize:11,color:C.muted,marginTop:10}}>
                  💡 <b>Concepto</b> y <b>Categoría</b> se asignan después en la app. El sistema detecta duplicados automáticamente.
                </div>
              </div>
            </div>
          ) : (
            <div>
              {/* Preview results */}
              <div style={{display:"flex",gap:12,marginBottom:20,flexWrap:"wrap"}}>
                <div style={{background:"#E8F5E9",border:"1px solid #A5D6A7",borderRadius:10,padding:"10px 18px"}}>
                  <div style={{fontSize:11,color:C.muted,fontWeight:700,textTransform:"uppercase"}}>Nuevos</div>
                  <div style={{fontSize:24,fontWeight:900,color:C.ok}}>{importPreview.rows.length}</div>
                </div>
                <div style={{background:"#FFF3E0",border:"1px solid #FFCC80",borderRadius:10,padding:"10px 18px"}}>
                  <div style={{fontSize:11,color:C.muted,fontWeight:700,textTransform:"uppercase"}}>Duplicados (omitidos)</div>
                  <div style={{fontSize:24,fontWeight:900,color:C.warn}}>{importPreview.dupes.length}</div>
                </div>
              </div>

              {/* Categoría default */}
              <div style={{background:"#F8FAFC",border:`1px solid ${C.border}`,borderRadius:10,padding:14,marginBottom:16}}>
                <div style={{fontSize:13,fontWeight:700,color:C.navy,marginBottom:8}}>Asignar categoría a todos los ingresos importados:</div>
                <div style={{display:"flex",gap:8,flexWrap:"wrap"}}>
                  {catList.map(cat => {
                    const cs = getCatStyle(cat);
                    return (
                      <button key={cat} onClick={()=>setImportCatDefault(cat)}
                        style={{padding:"5px 14px",borderRadius:20,border:`2px solid ${importCatDefault===cat?cs.text:C.border}`,background:importCatDefault===cat?cs.bg:"#fff",color:importCatDefault===cat?cs.text:C.text,cursor:"pointer",fontWeight:importCatDefault===cat?700:500,fontSize:12,fontFamily:"inherit",transition:"all .15s"}}>
                        {cat}
                      </button>
                    );
                  })}
                </div>
                <div style={{fontSize:11,color:C.muted,marginTop:8}}>Podrás cambiar la categoría individualmente desde la app después de importar.</div>
              </div>

              {/* Preview table */}
              {importPreview.rows.length > 0 && (
                <div style={{maxHeight:280,overflowY:"auto",border:`1px solid ${C.border}`,borderRadius:10,marginBottom:16}}>
                  <table style={{width:"100%",borderCollapse:"collapse",fontSize:12}}>
                    <thead style={{position:"sticky",top:0}}>
                      <tr style={{background:C.navy}}>
                        {["Cliente","Concepto","Fecha","Monto","Moneda"].map(h=>(
                          <th key={h} style={{padding:"8px 10px",color:"#fff",fontWeight:600,fontSize:10,textTransform:"uppercase",textAlign:h==="Monto"?"right":"left"}}>{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {importPreview.rows.map((r,i)=>(
                        <tr key={i} style={{borderBottom:`1px solid ${C.border}`,background:i%2===0?"#fff":"#FAFBFC"}}>
                          <td style={{padding:"7px 10px",fontWeight:600,color:C.navy}}>{r.cliente}</td>
                          <td style={{padding:"7px 10px",color:C.muted,fontStyle:"italic"}}>{r.concepto||"—"}</td>
                          <td style={{padding:"7px 10px",color:C.muted,fontSize:11}}>{r.fecha||"—"}</td>
                          <td style={{padding:"7px 10px",fontWeight:700,textAlign:"right"}}>{r.moneda==="EUR"?"€":"$"}{fmt(r.monto)}</td>
                          <td style={{padding:"7px 10px"}}><span style={{background:{MXN:"#E3F2FD",USD:"#E8F5E9",EUR:"#F3E5F5"}[r.moneda],color:{MXN:C.mxn,USD:C.usd,EUR:C.eur}[r.moneda],padding:"2px 7px",borderRadius:20,fontSize:10,fontWeight:700}}>{r.moneda}</span></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}

              {importPreview.rows.length === 0 && (
                <div style={{textAlign:"center",padding:24,color:C.muted,background:"#FFF3E0",borderRadius:10,marginBottom:16}}>
                  ⚠️ Todos los registros del archivo ya existen — no hay nada nuevo que importar.
                </div>
              )}

              <div style={{display:"flex",gap:10,justifyContent:"flex-end"}}>
                <button onClick={()=>setImportPreview(null)} style={{...btnStyle,background:"#F1F5F9",color:C.text}}>← Cambiar archivo</button>
                <button disabled={importPreview.rows.length===0||importando||!importCatDefault}
                  onClick={confirmarImport}
                  style={{...btnStyle,background:C.ok,opacity:(importPreview.rows.length===0||importando||!importCatDefault)?0.5:1}}>
                  {importando ? "Importando…" : `✅ Importar ${importPreview.rows.length} ingreso${importPreview.rows.length!==1?"s":""}`}
                </button>
              </div>
            </div>
          )}
        </ModalShell>
      )}
      {/* Bulk Fecha Ficticia Modal */}
      {bulkFechaModal && <BulkFechaModal
        selectedList={filtered.filter(i=>selectedIngresos.has(i.id))}
        onClose={()=>setBulkFechaModal(false)}
        onSave={async(fecha)=>{
          const list = filtered.filter(i=>selectedIngresos.has(i.id));
          for(const ing of list){
            await updateIngresoField(ing.id,{fechaFicticia:fecha});
            setIngresos(prev=>prev.map(i=>i.id===ing.id?{...i,fechaFicticia:fecha}:i));
          }
          setSelectedIngresos(new Set());
          setBulkFechaModal(false);
        }}
      />}

      {/* TAS Import Modal */}
      {tasModal && (
        <ModalShell title="✈️ Importar Facturas TravelAirSolutions" onClose={()=>{setTasModal(false);setTasPreview(null);}} wide>
          {!tasPreview ? (
            <div>
              {/* Upload zone */}
              <div onClick={()=>tasImportRef.current?.click()}
                style={{border:`2px dashed ${C.border}`,borderRadius:14,padding:40,textAlign:"center",cursor:"pointer",background:"#FFF5F5",marginBottom:20,transition:"border-color .2s"}}
                onMouseEnter={e=>{e.currentTarget.style.borderColor="#C0392B";}}
                onMouseLeave={e=>{e.currentTarget.style.borderColor=C.border;}}>
                <div style={{fontSize:44,marginBottom:10}}>✈️</div>
                <div style={{fontSize:16,fontWeight:700,color:C.navy,marginBottom:4}}>Selecciona el archivo Excel de TAS</div>
                <div style={{fontSize:13,color:C.muted,marginBottom:16}}>Formatos: .xlsx · .xls</div>
                <button style={{...btnStyle,background:"#C0392B"}} onClick={e=>{e.stopPropagation();tasImportRef.current?.click();}}>Seleccionar archivo</button>
              </div>
              {/* Expected format */}
              <div style={{background:"#FFF5F5",border:"1px solid #FFCDD2",borderRadius:12,padding:16}}>
                <div style={{fontWeight:700,color:"#C0392B",marginBottom:10,fontSize:13}}>📋 Columnas esperadas del Excel TAS</div>
                <div style={{overflowX:"auto"}}>
                  <table style={{borderCollapse:"collapse",fontSize:11,minWidth:700}}>
                    <thead><tr style={{background:"#C0392B"}}>
                      {["SEGMENTO","Empresa/Nombre","CFDI Folio","CFDI UUID","Fecha factura","Fecha vencimiento","Moneda","Importe adeudado","Asiento contable/Fecha"].map(h=>(
                        <th key={h} style={{padding:"6px 10px",color:"#fff",fontWeight:600,fontSize:10,whiteSpace:"nowrap"}}>{h}</th>
                      ))}
                    </tr></thead>
                    <tbody><tr style={{background:"#fff"}}>
                      {["TRF","VIAJES LIBERO","AA/2026/0122","1b5f4cbe-e269…","10/03/2026","09/04/2026","MXN","23,103.60","27/02/2026"].map((v,i)=>(
                        <td key={i} style={{padding:"6px 10px",borderBottom:`1px solid ${C.border}`,fontSize:11,textAlign:"center"}}>{v}</td>
                      ))}
                    </tr></tbody>
                  </table>
                </div>
                <div style={{fontSize:11,color:C.muted,marginTop:10}}>
                  💡 Duplicados detectados por <b>CFDI UUID</b>. Si ya existe el UUID en la app, la factura se omite automáticamente.
                </div>
              </div>
            </div>
          ) : (
            <div>
              {/* Preview results */}
              <div style={{display:"flex",gap:12,marginBottom:20,flexWrap:"wrap"}}>
                <div style={{background:"#E8F5E9",border:"1px solid #A5D6A7",borderRadius:10,padding:"10px 18px"}}>
                  <div style={{fontSize:11,color:C.muted,fontWeight:700,textTransform:"uppercase"}}>Nuevos</div>
                  <div style={{fontSize:24,fontWeight:900,color:C.ok}}>{tasPreview.rows.length}</div>
                </div>
                <div style={{background:"#FFF3E0",border:"1px solid #FFCC80",borderRadius:10,padding:"10px 18px"}}>
                  <div style={{fontSize:11,color:C.muted,fontWeight:700,textTransform:"uppercase"}}>Duplicados (omitidos)</div>
                  <div style={{fontSize:24,fontWeight:900,color:C.warn}}>{tasPreview.dupes.length}</div>
                </div>
              </div>

              {/* Categoría default */}
              <div style={{background:"#F8FAFC",border:`1px solid ${C.border}`,borderRadius:10,padding:14,marginBottom:16}}>
                <div style={{fontSize:13,fontWeight:700,color:C.navy,marginBottom:8}}>Asignar categoría a registros sin segmento:</div>
                <div style={{display:"flex",gap:8,flexWrap:"wrap"}}>
                  {catList.map(cat => {
                    const cs = getCatStyle(cat);
                    return (
                      <button key={cat} onClick={()=>setTasCatDefault(cat)}
                        style={{padding:"5px 14px",borderRadius:20,border:`2px solid ${tasCatDefault===cat?cs.text:C.border}`,background:tasCatDefault===cat?cs.bg:"#fff",color:tasCatDefault===cat?cs.text:C.text,cursor:"pointer",fontWeight:tasCatDefault===cat?700:500,fontSize:12,fontFamily:"inherit"}}>
                        {cat}
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Preview table */}
              {tasPreview.rows.length > 0 && (
                <div style={{maxHeight:280,overflowY:"auto",border:`1px solid ${C.border}`,borderRadius:10,marginBottom:16}}>
                  <table style={{width:"100%",borderCollapse:"collapse",fontSize:12}}>
                    <thead style={{position:"sticky",top:0}}>
                      <tr style={{background:"#C0392B"}}>
                        {["Cliente","Concepto","Segmento","Fecha","Vencimiento","F.Contable","Monto","Moneda"].map(h=>(
                          <th key={h} style={{padding:"8px 10px",color:"#fff",fontWeight:600,fontSize:10,textTransform:"uppercase",textAlign:h==="Monto"?"right":"left"}}>{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {tasPreview.rows.map((r,i)=>(
                        <tr key={i} style={{borderBottom:`1px solid ${C.border}`,background:i%2===0?"#fff":"#FFF5F5"}}>
                          <td style={{padding:"7px 10px",fontWeight:600,color:C.navy}}>{r.cliente}</td>
                          <td style={{padding:"7px 10px",color:C.muted,fontSize:11}}>{r.concepto||"—"}</td>
                          <td style={{padding:"7px 10px"}}><span style={{background:"#FFEBEE",color:"#C0392B",padding:"1px 7px",borderRadius:20,fontSize:10,fontWeight:700}}>{r.segmento||"—"}</span></td>
                          <td style={{padding:"7px 10px",fontSize:11,color:C.muted}}>{r.fecha||"—"}</td>
                          <td style={{padding:"7px 10px",fontSize:11,color:C.muted}}>{r.fechaVencimiento||"—"}</td>
                          <td style={{padding:"7px 10px",fontSize:11,color:C.teal}}>{r.fechaContable||"—"}</td>
                          <td style={{padding:"7px 10px",fontWeight:700,textAlign:"right"}}>{r.moneda==="EUR"?"€":"$"}{fmt(r.monto)}</td>
                          <td style={{padding:"7px 10px"}}><span style={{background:{MXN:"#E3F2FD",USD:"#E8F5E9",EUR:"#F3E5F5"}[r.moneda],color:{MXN:C.mxn,USD:C.usd,EUR:C.eur}[r.moneda],padding:"2px 7px",borderRadius:20,fontSize:10,fontWeight:700}}>{r.moneda}</span></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}

              {tasPreview.rows.length === 0 && (
                <div style={{textAlign:"center",padding:24,color:C.muted,background:"#FFF3E0",borderRadius:10,marginBottom:16}}>
                  ⚠️ Todos los registros del archivo ya existen (UUID duplicado) — no hay nada nuevo que importar.
                </div>
              )}

              <div style={{display:"flex",gap:10,justifyContent:"flex-end"}}>
                <button onClick={()=>setTasPreview(null)} style={{...btnStyle,background:"#F1F5F9",color:C.text}}>← Cambiar archivo</button>
                <button disabled={tasPreview.rows.length===0||tasImportando}
                  onClick={confirmarTasImport}
                  style={{...btnStyle,background:"#C0392B",opacity:(tasPreview.rows.length===0||tasImportando)?0.5:1}}>
                  {tasImportando ? "Importando…" : `✅ Importar ${tasPreview.rows.length} factura${tasPreview.rows.length!==1?"s":""}`}
                </button>
              </div>
            </div>
          )}
        </ModalShell>
      )}

      {/* Cobro Masivo Modal */}
      {cobroMasivoModal && <CobroMasivoModal
        selectedList={filtered.filter(i=>selectedIngresos.has(i.id))}
        onClose={()=>setCobroMasivoModal(false)}
        onSave={async(fecha,notas)=>{
          const list = filtered.filter(i=>selectedIngresos.has(i.id));
          for(const ing of list){
            const porCobrar = (metrics[ing.id]?.porCobrar)||0;
            if(porCobrar<=0) continue;
            const saved = await insertCobro({ingresoId:ing.id,monto:porCobrar,fechaCobro:fecha,notas,tipo:'realizado'});
            setCobros(prev=>[saved,...prev]);
          }
          setSelectedIngresos(new Set());
          setCobroMasivoModal(false);
        }}
      />}
    </div>
  );
}

/* ── Bulk Fecha Ficticia Modal (extracted component) ─────────── */
function BulkFechaModal({selectedList, onClose, onSave}) {
  const [fecha, setFecha] = useState("");
  const [saving, setSaving] = useState(false);
  const handleSave = async() => { setSaving(true); await onSave(fecha); setSaving(false); };
  return (
    <ModalShell title="📅 Asignar Fecha Ficticia Masiva" onClose={onClose}>
      <div style={{background:"#F8FAFC",border:"1px solid #E2E8F0",borderRadius:10,padding:14,marginBottom:16}}>
        <div style={{fontSize:13,color:"#64748B",marginBottom:4}}>Se asignará a <b style={{color:"#0F2D4A"}}>{selectedList.length} ingresos</b>:</div>
        <div style={{display:"flex",flexWrap:"wrap",gap:6,maxHeight:120,overflowY:"auto"}}>
          {selectedList.map(i=>(
            <span key={i.id} style={{background:"#E8F0FE",color:"#1565C0",padding:"3px 10px",borderRadius:20,fontSize:12,fontWeight:600}}>{i.cliente} — {i.concepto||i.categoria}</span>
          ))}
        </div>
      </div>
      <div style={{marginBottom:20}}>
        <label style={{display:"block",fontSize:12,fontWeight:700,color:"#64748B",textTransform:"uppercase",letterSpacing:.5,marginBottom:6}}>Fecha Ficticia de Cobro</label>
        <input type="date" value={fecha} onChange={e=>setFecha(e.target.value)} style={{padding:"10px 14px",borderRadius:10,border:"2px solid #E2E8F0",fontSize:15,width:"100%",boxSizing:"border-box",fontFamily:"inherit"}}/>
        <div style={{fontSize:11,color:"#64748B",marginTop:6}}>Si dejas vacío, se limpiará la fecha ficticia y se usará el vencimiento.</div>
      </div>
      <div style={{display:"flex",gap:10,justifyContent:"flex-end"}}>
        <button onClick={onClose} style={{padding:"10px 20px",borderRadius:10,border:"none",background:"#F1F5F9",color:"#1A2332",fontWeight:700,cursor:"pointer",fontFamily:"inherit"}}>Cancelar</button>
        <button onClick={handleSave} disabled={saving} style={{padding:"10px 20px",borderRadius:10,border:"none",background:"#7B1FA2",color:"#fff",fontWeight:700,cursor:"pointer",fontFamily:"inherit",opacity:saving?.6:1}}>
          {saving?"Guardando…":`✅ Aplicar a ${selectedList.length} ingresos`}
        </button>
      </div>
    </ModalShell>
  );
}

/* ── Cobro Masivo Modal ───────────────────────────────────────── */
function CobroMasivoModal({selectedList, onClose, onSave}) {
  const [fecha, setFecha] = useState(new Date().toISOString().split("T")[0]);
  const [notas, setNotas] = useState("");
  const [saving, setSaving] = useState(false);
  const total = selectedList.reduce((s,i)=>s+i.monto,0);
  const handleSave = async() => { if(!fecha) return; setSaving(true); await onSave(fecha,notas); setSaving(false); };
  return (
    <ModalShell title="💰 Cobro Masivo" onClose={onClose}>
      <div style={{background:"#E8F5E9",border:"1px solid #A5D6A7",borderRadius:10,padding:14,marginBottom:16}}>
        <div style={{fontSize:13,color:"#64748B",marginBottom:4}}>Se registrará cobro completo (Por Cobrar) de <b style={{color:"#0F2D4A"}}>{selectedList.length} ingresos</b></div>
        <div style={{display:"flex",flexWrap:"wrap",gap:6,maxHeight:120,overflowY:"auto",marginTop:8}}>
          {selectedList.map(i=>(
            <span key={i.id} style={{background:"#fff",color:"#1B5E20",padding:"3px 10px",borderRadius:20,fontSize:12,fontWeight:600,border:"1px solid #A5D6A7"}}>{i.cliente} — {i.concepto||i.categoria}</span>
          ))}
        </div>
      </div>
      <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:16,marginBottom:16}}>
        <div>
          <label style={{display:"block",fontSize:12,fontWeight:700,color:"#64748B",textTransform:"uppercase",letterSpacing:.5,marginBottom:6}}>Fecha de Cobro *</label>
          <input type="date" value={fecha} onChange={e=>setFecha(e.target.value)} style={{padding:"10px 14px",borderRadius:10,border:"2px solid #E2E8F0",fontSize:14,width:"100%",boxSizing:"border-box",fontFamily:"inherit"}}/>
        </div>
        <div>
          <label style={{display:"block",fontSize:12,fontWeight:700,color:"#64748B",textTransform:"uppercase",letterSpacing:.5,marginBottom:6}}>Notas</label>
          <input value={notas} onChange={e=>setNotas(e.target.value)} placeholder="Ej. Transferencia bancaria..." style={{padding:"10px 14px",borderRadius:10,border:"2px solid #E2E8F0",fontSize:14,width:"100%",boxSizing:"border-box",fontFamily:"inherit"}}/>
        </div>
      </div>
      <div style={{display:"flex",gap:10,justifyContent:"flex-end"}}>
        <button onClick={onClose} style={{padding:"10px 20px",borderRadius:10,border:"none",background:"#F1F5F9",color:"#1A2332",fontWeight:700,cursor:"pointer",fontFamily:"inherit"}}>Cancelar</button>
        <button onClick={handleSave} disabled={saving||!fecha} style={{padding:"10px 20px",borderRadius:10,border:"none",background:"#43A047",color:"#fff",fontWeight:700,cursor:"pointer",fontFamily:"inherit",opacity:(saving||!fecha)?.6:1}}>
          {saving?"Registrando…":`✅ Registrar cobro de ${selectedList.length} ingresos`}
        </button>
      </div>
    </ModalShell>
  );
}
