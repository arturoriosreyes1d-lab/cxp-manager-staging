import { supabase } from './supabase.js';

/* ── Helpers: convert between DB snake_case and App camelCase ─── */
const toApp = (row) => ({
  id: row.id,
  tipo: row.tipo || 'Factura',
  fecha: row.fecha || '',
  serie: row.serie || '',
  folio: row.folio || '',
  uuid: row.uuid || '',
  proveedor: row.proveedor || '',
  clasificacion: row.clasificacion || '',
  subtotal: +row.subtotal || 0,
  iva: +row.iva || 0,
  retIsr: +row.ret_isr || 0,
  retIva: +row.ret_iva || 0,
  total: +row.total || 0,
  montoPagado: +row.monto_pagado || 0,
  concepto: row.concepto || '',
  diasCredito: row.dias_credito || 30,
  vencimiento: row.vencimiento || '',
  estatus: row.estatus || 'Pendiente',
  fechaProgramacion: row.fecha_programacion || '',
  diasFicticios: row.dias_ficticios || 0,
  referencia: row.referencia || '',
  notas: row.notas || '',
  moneda: row.moneda || 'MXN',
  voBo: row.vo_bo || false,
  autorizadoDireccion: row.autorizado_direccion || false,
  empresaId: row.empresa_id || null,
});

const toDB = (inv) => ({
  id: inv.id,
  tipo: inv.tipo,
  fecha: inv.fecha || null,
  serie: inv.serie,
  folio: inv.folio,
  uuid: inv.uuid,
  proveedor: inv.proveedor,
  clasificacion: inv.clasificacion,
  subtotal: inv.subtotal,
  iva: inv.iva,
  ret_isr: inv.retIsr || 0,
  ret_iva: inv.retIva || 0,
  total: inv.total,
  monto_pagado: inv.montoPagado || 0,
  concepto: inv.concepto || '',
  dias_credito: inv.diasCredito,
  vencimiento: inv.vencimiento || null,
  estatus: inv.estatus,
  fecha_programacion: inv.fechaProgramacion || null,
  dias_ficticios: inv.diasFicticios || 0,
  referencia: inv.referencia || '',
  notas: inv.notas || '',
  moneda: inv.moneda || 'MXN',
  vo_bo: inv.voBo || false,
  autorizado_direccion: inv.autorizadoDireccion || false,
  empresa_id: inv.empresaId || null,
});

const supToApp = (row) => ({
  id: row.id,
  nombre: row.nombre,
  rfc: row.rfc || '',
  moneda: row.moneda || 'MXN',
  diasCredito: row.dias_credito || 30,
  contacto: row.contacto || '',
  telefono: row.telefono || '',
  email: row.email || '',
  banco: row.banco || '',
  clabe: row.clabe || '',
  clasificacion: row.clasificacion || 'Otros',
  activo: row.activo !== false,
  empresaId: row.empresa_id || null,
});

const supToDB = (sup) => ({
  id: sup.id,
  nombre: sup.nombre,
  rfc: sup.rfc || '',
  moneda: sup.moneda || 'MXN',
  dias_credito: sup.diasCredito || 30,
  contacto: sup.contacto || '',
  telefono: sup.telefono || '',
  email: sup.email || '',
  banco: sup.banco || '',
  clabe: sup.clabe || '',
  clasificacion: sup.clasificacion || 'Otros',
  activo: sup.activo !== false,
  empresa_id: sup.empresaId || null,
});

/* ── Invoices ────────────────────────────────────────────────── */
export async function fetchInvoices(empresaId) {
  let q = supabase.from('invoices').select('*').order('fecha', { ascending: false });
  if (empresaId) q = q.eq('empresa_id', empresaId);
  const { data, error } = await q;
  if (error) { console.error('fetchInvoices:', error); return { MXN: [], USD: [], EUR: [] }; }
  const grouped = { MXN: [], USD: [], EUR: [] };
  (data || []).forEach(row => {
    const inv = toApp(row);
    if (grouped[inv.moneda]) grouped[inv.moneda].push(inv);
    else grouped.MXN.push(inv);
  });
  return grouped;
}

export async function upsertInvoice(inv) {
  const row = toDB(inv);
  const isUUID = /^[0-9a-f]{8}-[0-9a-f]{4}-/.test(row.id);
  if (!isUUID) {
    delete row.id;
    const { data, error } = await supabase.from('invoices').insert(row).select().single();
    if (error) { console.error('insertInvoice:', error); return inv; }
    return toApp(data);
  } else {
    const { data, error } = await supabase.from('invoices').update(row).eq('id', row.id).select().single();
    if (error) { console.error('updateInvoice:', error); return inv; }
    return toApp(data);
  }
}

export async function upsertManyInvoices(invArr) {
  const rows = invArr.map(inv => {
    const row = toDB(inv);
    const isUUID = /^[0-9a-f]{8}-[0-9a-f]{4}-/.test(row.id);
    if (!isUUID) delete row.id;
    return row;
  });
  const { data, error } = await supabase.from('invoices').insert(rows).select();
  if (error) { console.error('upsertManyInvoices:', error); return invArr; }
  return (data || []).map(toApp);
}

export async function deleteInvoiceDB(id) {
  const { error } = await supabase.from('invoices').delete().eq('id', id);
  if (error) console.error('deleteInvoice:', error);
}

export async function updateInvoiceField(id, fields) {
  // fields: { clasificacion: 'x' } or { fecha_programacion: 'y' } etc
  const dbFields = {};
  if ('clasificacion' in fields) dbFields.clasificacion = fields.clasificacion;
  if ('fechaProgramacion' in fields) dbFields.fecha_programacion = fields.fechaProgramacion;
  if ('estatus' in fields) dbFields.estatus = fields.estatus;
  if ('montoPagado' in fields) dbFields.monto_pagado = fields.montoPagado;
  if ('concepto' in fields) dbFields.concepto = fields.concepto;
  if ('voBo' in fields) dbFields.vo_bo = fields.voBo;
  if ('autorizadoDireccion' in fields) dbFields.autorizado_direccion = fields.autorizadoDireccion;
  const { error } = await supabase.from('invoices').update(dbFields).eq('id', id);
  if (error) console.error('updateInvoiceField:', error);
}

export async function bulkUpdateInvoices(ids, fields) {
  const dbFields = {};
  if (fields.clasificacion) dbFields.clasificacion = fields.clasificacion;
  if (fields.fechaProgramacion) dbFields.fecha_programacion = fields.fechaProgramacion;
  if (fields.estatus) dbFields.estatus = fields.estatus;
  if (fields.montoPagado !== undefined) dbFields.monto_pagado = fields.montoPagado;
  if ('autorizadoDireccion' in fields) dbFields.autorizado_direccion = fields.autorizadoDireccion;
  const { error } = await supabase.from('invoices').update(dbFields).in('id', ids);
  if (error) console.error('bulkUpdateInvoices:', error);
}

/* ── Suppliers ───────────────────────────────────────────────── */
export async function fetchSuppliers(empresaId) {
  let q = supabase.from('suppliers').select('*').order('nombre');
  if (empresaId) q = q.eq('empresa_id', empresaId);
  const { data, error } = await q;
  if (error) { console.error('fetchSuppliers:', error); return []; }
  return (data || []).map(supToApp);
}

export async function upsertSupplier(sup) {
  const row = supToDB(sup);
  const isUUID = /^[0-9a-f]{8}-[0-9a-f]{4}-/.test(row.id);
  if (!isUUID) {
    // New record: insert without id, let Supabase generate it
    delete row.id;
    const { data, error } = await supabase.from('suppliers').insert(row).select().single();
    if (error) { console.error('insertSupplier:', error); return sup; }
    return supToApp(data);
  } else {
    // Existing record: update by id
    const { data, error } = await supabase.from('suppliers').update(row).eq('id', row.id).select().single();
    if (error) { console.error('updateSupplier:', error); return sup; }
    return supToApp(data);
  }
}

export async function upsertManySuppliers(sups) {
  const rows = sups.map(s => {
    const row = supToDB(s);
    const isUUID = /^[0-9a-f]{8}-[0-9a-f]{4}-/.test(row.id);
    if (!isUUID) delete row.id;
    return row;
  });
  const { data, error } = await supabase.from('suppliers').insert(rows).select();
  if (error) { console.error('upsertManySuppliers:', error); return sups; }
  return (data || []).map(supToApp);
}

/* ── Clasificaciones ─────────────────────────────────────────── */
export async function fetchClasificaciones(empresaId) {
  let q = supabase.from('clasificaciones').select('nombre').order('nombre');
  if (empresaId) q = q.eq('empresa_id', empresaId);
  const { data, error } = await q;
  if (error) { console.error('fetchClasificaciones:', error); return []; }
  return (data || []).map(r => r.nombre);
}

export async function saveClasificaciones(list, empresaId) {
  // Delete all for this empresa, re-insert
  let q = supabase.from('clasificaciones').delete();
  if (empresaId) q = q.eq('empresa_id', empresaId);
  else q = q.neq('id', '00000000-0000-0000-0000-000000000000');
  await q;
  const rows = list.map(nombre => ({ nombre, empresa_id: empresaId || null }));
  const { error } = await supabase.from('clasificaciones').upsert(rows, { onConflict: 'nombre' });
  if (error) console.error('saveClasificaciones:', error);
}

/* ── Payments (pagos programados y realizados) ───────────────── */
export async function fetchPayments(empresaId) {
  // Payments linked to invoices of this empresa
  if (empresaId) {
    const { data: invData } = await supabase.from('invoices').select('id').eq('empresa_id', empresaId);
    const ids = (invData || []).map(r => r.id);
    if (ids.length === 0) return [];
    const { data, error } = await supabase.from('payments').select('*').in('invoice_id', ids).order('fecha_pago', { ascending: false });
    if (error) { console.error('fetchPayments:', error); return []; }
    return (data || []).map(r => ({
      id: r.id, invoiceId: r.invoice_id, monto: +r.monto || 0,
      fechaPago: r.fecha_pago || '', notas: r.notas || '', tipo: r.tipo || 'realizado',
    }));
  }
  const { data, error } = await supabase.from('payments').select('*').order('fecha_pago', { ascending: false });
  if (error) { console.error('fetchPayments:', error); return []; }
  return (data || []).map(r => ({
    id: r.id, invoiceId: r.invoice_id, monto: +r.monto || 0,
    fechaPago: r.fecha_pago || '', notas: r.notas || '', tipo: r.tipo || 'realizado',
  }));
}

export async function insertPayment(p) {
  const row = { invoice_id: p.invoiceId, monto: p.monto, fecha_pago: p.fechaPago, notas: p.notas || '', tipo: p.tipo || 'realizado' };
  const { data, error } = await supabase.from('payments').insert(row).select().single();
  if (error) { console.error('insertPayment:', error); return p; }
  return { id: data.id, invoiceId: data.invoice_id, monto: +data.monto, fechaPago: data.fecha_pago, notas: data.notas || '', tipo: data.tipo || 'realizado' };
}

export async function deletePayment(id) {
  const { error } = await supabase.from('payments').delete().eq('id', id);
  if (error) console.error('deletePayment:', error);
}

export async function updatePayment(id, fields) {
  const dbFields = {};
  if ('monto' in fields) dbFields.monto = fields.monto;
  if ('fechaPago' in fields) dbFields.fecha_pago = fields.fechaPago;
  if ('notas' in fields) dbFields.notas = fields.notas;
  if ('tipo' in fields) dbFields.tipo = fields.tipo;
  const { error } = await supabase.from('payments').update(dbFields).eq('id', id);
  if (error) console.error('updatePayment:', error);
}

/* ═══════════════════════════════════════════════════════════════
   CxC — CUENTAS POR COBRAR
   ═══════════════════════════════════════════════════════════════ */

/* ── Helpers ─────────────────────────────────────────────────── */
const ingresoToApp = (r) => ({
  id: r.id,
  cliente: r.cliente || '',
  concepto: r.concepto || '',
  categoria: r.categoria || '',
  monto: +r.monto || 0,
  moneda: r.moneda || 'MXN',
  tipoCambio: +r.tipo_cambio || 1,
  fecha: r.fecha || '',
  notas: r.notas || '',
  empresaId: r.empresa_id || null,
});

const ingresoToDB = (i) => ({
  id: i.id,
  cliente: i.cliente,
  concepto: i.concepto || '',
  categoria: i.categoria || '',
  monto: i.monto,
  moneda: i.moneda || 'MXN',
  tipo_cambio: i.tipoCambio || 1,
  fecha: i.fecha || null,
  notas: i.notas || '',
  empresa_id: i.empresaId || null,
});

/* ── Ingresos ────────────────────────────────────────────────── */
export async function fetchIngresos(empresaId) {
  let q = supabase.from('ingresos').select('*').order('fecha', { ascending: false });
  if (empresaId) q = q.eq('empresa_id', empresaId);
  const { data, error } = await q;
  if (error) { console.error('fetchIngresos:', error); return []; }
  return (data || []).map(ingresoToApp);
}

export async function upsertIngreso(ing) {
  const row = ingresoToDB(ing);
  const isUUID = /^[0-9a-f]{8}-[0-9a-f]{4}-/.test(row.id);
  if (!isUUID) {
    delete row.id;
    const { data, error } = await supabase.from('ingresos').insert(row).select().single();
    if (error) { console.error('insertIngreso:', error); return ing; }
    return ingresoToApp(data);
  } else {
    const { data, error } = await supabase.from('ingresos').update(row).eq('id', row.id).select().single();
    if (error) { console.error('updateIngreso:', error); return ing; }
    return ingresoToApp(data);
  }
}

export async function deleteIngreso(id) {
  const { error } = await supabase.from('ingresos').delete().eq('id', id);
  if (error) console.error('deleteIngreso:', error);
}

/* ── Cobros ──────────────────────────────────────────────────── */
export async function fetchCobros(empresaId) {
  if (empresaId) {
    const { data: ingData } = await supabase.from('ingresos').select('id').eq('empresa_id', empresaId);
    const ids = (ingData || []).map(r => r.id);
    if (ids.length === 0) return [];
    const { data, error } = await supabase.from('cobros').select('*').in('ingreso_id', ids).order('fecha_cobro', { ascending: false });
    if (error) { console.error('fetchCobros:', error); return []; }
    return (data || []).map(r => ({ id: r.id, ingresoId: r.ingreso_id, monto: +r.monto || 0, fechaCobro: r.fecha_cobro || '', notas: r.notas || '', tipo: r.tipo || 'realizado' }));
  }
  const { data, error } = await supabase.from('cobros').select('*').order('fecha_cobro', { ascending: false });
  if (error) { console.error('fetchCobros:', error); return []; }
  return (data || []).map(r => ({ id: r.id, ingresoId: r.ingreso_id, monto: +r.monto || 0, fechaCobro: r.fecha_cobro || '', notas: r.notas || '', tipo: r.tipo || 'realizado' }));
}

export async function insertCobro(c) {
  const row = {
    ingreso_id: c.ingresoId,
    monto: c.monto,
    fecha_cobro: c.fechaCobro || null,
    notas: c.notas || '',
    tipo: c.tipo || 'realizado',
  };
  const { data, error } = await supabase.from('cobros').insert(row).select().single();
  if (error) { console.error('insertCobro:', error); return c; }
  return {
    id: data.id,
    ingresoId: data.ingreso_id,
    monto: +data.monto,
    fechaCobro: data.fecha_cobro || '',
    notas: data.notas || '',
    tipo: data.tipo || 'realizado',
  };
}

export async function deleteCobro(id) {
  const { error } = await supabase.from('cobros').delete().eq('id', id);
  if (error) console.error('deleteCobro:', error);
}

/* ── Invoice-Ingresos ────────────────────────────────────────── */
export async function fetchInvoiceIngresos(empresaId) {
  if (empresaId) {
    const { data: invData } = await supabase.from('invoices').select('id').eq('empresa_id', empresaId);
    const ids = (invData || []).map(r => r.id);
    if (ids.length === 0) return [];
    const { data, error } = await supabase.from('invoice_ingresos').select('*').in('invoice_id', ids);
    if (error) { console.error('fetchInvoiceIngresos:', error); return []; }
    return (data || []).map(r => ({ id: r.id, invoiceId: r.invoice_id, ingresoId: r.ingreso_id, montoAsignado: +r.monto_asignado || 0 }));
  }
  const { data, error } = await supabase.from('invoice_ingresos').select('*');
  if (error) { console.error('fetchInvoiceIngresos:', error); return []; }
  return (data || []).map(r => ({
    id: r.id,
    invoiceId: r.invoice_id,
    ingresoId: r.ingreso_id,
    montoAsignado: +r.monto_asignado || 0,
  }));
}

export async function upsertInvoiceIngreso(item) {
  const row = { invoice_id: item.invoiceId, ingreso_id: item.ingresoId, monto_asignado: item.montoAsignado };
  if (item.id && /^[0-9a-f]{8}-[0-9a-f]{4}-/.test(item.id)) {
    const { data, error } = await supabase.from('invoice_ingresos').update(row).eq('id', item.id).select().single();
    if (error) { console.error('updateInvoiceIngreso:', error); return item; }
    return { id: data.id, invoiceId: data.invoice_id, ingresoId: data.ingreso_id, montoAsignado: +data.monto_asignado };
  } else {
    const { data, error } = await supabase.from('invoice_ingresos').insert(row).select().single();
    if (error) { console.error('insertInvoiceIngreso:', error); return item; }
    return { id: data.id, invoiceId: data.invoice_id, ingresoId: data.ingreso_id, montoAsignado: +data.monto_asignado };
  }
}

export async function deleteInvoiceIngreso(id) {
  const { error } = await supabase.from('invoice_ingresos').delete().eq('id', id);
  if (error) console.error('deleteInvoiceIngreso:', error);
}

/* ── Categorías Ingreso ──────────────────────────────────────── */
export async function fetchCategoriasIngreso(empresaId) {
  let q = supabase.from('categorias_ingreso').select('*').order('nombre');
  if (empresaId) q = q.eq('empresa_id', empresaId);
  const { data, error } = await q;
  if (error) { console.error('fetchCategoriasIngreso:', error); return []; }
  return (data || []).map(r => ({ id: r.id, nombre: r.nombre }));
}

export async function upsertCategoriaIngreso(nombre) {
  const { data, error } = await supabase.from('categorias_ingreso').upsert({ nombre }, { onConflict: 'nombre' }).select().single();
  if (error) { console.error('upsertCategoriaIngreso:', error); return null; }
  return { id: data.id, nombre: data.nombre };
}

export async function deleteCategoriaIngreso(id) {
  const { error } = await supabase.from('categorias_ingreso').delete().eq('id', id);
  if (error) console.error('deleteCategoriaIngreso:', error);
}
