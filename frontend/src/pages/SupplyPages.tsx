import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, ApiError } from '../lib/api';
import { useAuth } from '../lib/auth';
import { Badge, Button, controlClass, ErrorText, Field, PageHeader } from '../components/ui';
import { ReportDownloads } from '../components/ReportDownloads';

function message(error: unknown): string {
  return error instanceof ApiError ? error.message : 'The request failed.';
}

interface Supplier { id: number; referenceNumber: string; name: string; status: string }
interface Invoice { id: number; referenceNumber: string; invoiceNumber: string; invoiceDate: string; amount: number; supplierName: string; orderReference: string | null }
interface Item { id: number; sku: string; name: string; unit: string; reorderLevel: number; onHand: number; status: string }
interface Warehouse { id: number; code: string; name: string; status: string }
interface RequisitionLine { id: number; description: string; quantity: number; estimatedUnitCost: number; lineTotal: number }
interface Requisition {
  id: number;
  referenceNumber: string;
  purpose: string;
  status: string;
  totalAmount: number;
  approvalRequestId: number | null;
  lines: RequisitionLine[];
}
interface OrderLine { id: number; description: string; quantity: number; unitCost: number; receivedQuantity: number; itemId: number | null }
interface Order {
  id: number;
  referenceNumber: string;
  requisitionReference: string | null;
  supplierName: string | null;
  status: string;
  totalAmount: number;
  lines: OrderLine[];
}
interface Balance { warehouseName: string; sku: string; itemName: string; quantity: number; value: number }
interface Movement { id: number; referenceNumber: string; movementType: string; quantity: number; warehouseName: string; sku: string; balanceAfter: number }
interface StockReport {
  stockValue: number;
  belowReorder: Array<{ sku: string; name: string; onHand: number; reorderLevel: number }>;
  expired: Array<{ sku: string; warehouseName: string; lotCode: string; expiryDate: string; quantity: number }>;
  movements: Array<{ movementType: string; total: number }>;
}

function useList<T>(key: string, path: string) {
  return useQuery({ queryKey: [key], queryFn: () => api<{ data: T }>(path) });
}

export function RequisitionsPage() {
  const { can } = useAuth();
  const client = useQueryClient();
  const requisitions = useList<Requisition[]>('requisitions', '/v1/procurement/requisitions');
  const items = useList<Item[]>('stock-items', '/v1/inventory/items');
  const [purpose, setPurpose] = useState('');
  const [description, setDescription] = useState('');
  const [quantity, setQuantity] = useState('1');
  const [cost, setCost] = useState('0');
  const [itemId, setItemId] = useState('');
  const [error, setError] = useState('');
  const submit = useMutation({
    mutationFn: () => api('/v1/procurement/requisitions', {
      method: 'POST',
      body: JSON.stringify({
        purpose,
        lines: [{
          itemId: itemId ? Number(itemId) : null,
          description,
          quantity: Number(quantity),
          estimatedUnitCost: Number(cost),
        }],
      }),
    }),
    onSuccess: async () => {
      setPurpose('');
      setDescription('');
      setError('');
      await client.invalidateQueries({ queryKey: ['requisitions'] });
    },
    onError: (reason) => setError(message(reason)),
  });

  return (
    <section>
      <PageHeader title="Purchase requisitions" description="A requisition follows the purchase route: supervisor, operations, accounts verification, then the CEO. A purchase order can be raised only after that approval." />
      {requisitions.isError ? <ErrorText>{message(requisitions.error)}</ErrorText> : null}
      {can('procurement.request') || can('procurement.manage') ? (
        <form className="mb-6 grid gap-3 rounded-lg border border-line bg-white p-4" onSubmit={(event) => { event.preventDefault(); setError(''); submit.mutate(); }}>
          <Field label="Purpose"><input className={controlClass} value={purpose} onChange={(event) => setPurpose(event.target.value)} /></Field>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Stock item">
              <select className={controlClass} value={itemId} onChange={(event) => setItemId(event.target.value)}>
                <option value="">No catalogue item</option>
                {(items.data?.data ?? []).filter((item) => item.status === 'active').map((item) => <option key={item.id} value={item.id}>{item.sku} · {item.name}</option>)}
              </select>
            </Field>
            <Field label="Description"><input className={controlClass} value={description} onChange={(event) => setDescription(event.target.value)} /></Field>
            <Field label="Quantity"><input className={controlClass} value={quantity} onChange={(event) => setQuantity(event.target.value)} /></Field>
            <Field label="Estimated unit cost"><input className={controlClass} value={cost} onChange={(event) => setCost(event.target.value)} /></Field>
          </div>
          {error ? <ErrorText>{error}</ErrorText> : null}
          <Button type="submit" disabled={submit.isPending}>Submit requisition</Button>
        </form>
      ) : null}
      <div className="grid gap-3">
        {(requisitions.data?.data ?? []).map((row) => (
          <article key={row.id} className="rounded-lg border border-line bg-white p-4">
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-semibold">{row.referenceNumber}</span>
              <Badge value={row.status} />
              <span className="text-sm text-slate-500">{row.totalAmount.toFixed(2)}</span>
              {row.approvalRequestId ? <Link className="text-sm text-pine" to={`/approvals/${row.approvalRequestId}`}>Approval</Link> : null}
            </div>
            <p className="mt-2 text-sm">{row.purpose}</p>
            <ul className="mt-2 text-sm text-slate-600">
              {row.lines.map((line) => <li key={line.id}>{line.description} · {line.quantity} @ {line.estimatedUnitCost.toFixed(2)}</li>)}
            </ul>
          </article>
        ))}
        {requisitions.data?.data.length === 0 ? <p className="text-sm text-slate-500">No requisitions yet.</p> : null}
      </div>
    </section>
  );
}

export function OrdersPage() {
  const { can } = useAuth();
  const client = useQueryClient();
  const orders = useList<Order[]>('orders', '/v1/procurement/orders');
  const suppliers = useList<Supplier[]>('suppliers', '/v1/procurement/suppliers');
  const requisitions = useList<Requisition[]>('requisitions', '/v1/procurement/requisitions');
  const warehouses = useList<Warehouse[]>('warehouses', '/v1/inventory/warehouses');
  const [requisitionId, setRequisitionId] = useState('');
  const [supplierId, setSupplierId] = useState('');
  const [orderId, setOrderId] = useState('');
  const [warehouseId, setWarehouseId] = useState('');
  const [quantity, setQuantity] = useState('');
  const [error, setError] = useState('');
  const selected = (requisitions.data?.data ?? []).find((row) => String(row.id) === requisitionId);
  const receiving = (orders.data?.data ?? []).find((row) => String(row.id) === orderId);
  const issue = useMutation({
    mutationFn: () => api('/v1/procurement/orders', {
      method: 'POST',
      body: JSON.stringify({
        requisitionId: Number(requisitionId),
        supplierId: Number(supplierId),
        lines: (selected?.lines ?? []).map((line) => ({ requisitionLineId: line.id, unitCost: line.estimatedUnitCost })),
      }),
    }),
    onSuccess: async () => {
      setError('');
      await client.invalidateQueries({ queryKey: ['orders'] });
      await client.invalidateQueries({ queryKey: ['requisitions'] });
    },
    onError: (reason) => setError(message(reason)),
  });
  const receive = useMutation({
    mutationFn: () => api('/v1/procurement/receipts', {
      method: 'POST',
      body: JSON.stringify({
        purchaseOrderId: Number(orderId),
        warehouseId: Number(warehouseId),
        receivedOn: new Date().toISOString().slice(0, 10),
        lines: (receiving?.lines ?? []).filter((line) => line.quantity > line.receivedQuantity).map((line, index) => ({
          orderLineId: line.id,
          quantity: index === 0 ? Number(quantity) : 0,
          damagedQuantity: 0,
        })),
      }),
    }),
    onSuccess: async () => {
      setError('');
      setQuantity('');
      await client.invalidateQueries({ queryKey: ['orders'] });
      await client.invalidateQueries({ queryKey: ['balances'] });
    },
    onError: (reason) => setError(message(reason)),
  });

  return (
    <section>
      <PageHeader title="Purchase orders" description="Orders are issued from an approved requisition. Receiving posts the usable quantity into the chosen warehouse and records damaged quantity separately." />
      {error ? <div className="mb-4"><ErrorText>{error}</ErrorText></div> : null}
      {can('procurement.manage') ? (
        <form className="mb-6 grid gap-3 rounded-lg border border-line bg-white p-4 sm:grid-cols-3" onSubmit={(event) => { event.preventDefault(); issue.mutate(); }}>
          <Field label="Approved requisition">
            <select className={controlClass} value={requisitionId} onChange={(event) => setRequisitionId(event.target.value)}>
              <option value="">Choose</option>
              {(requisitions.data?.data ?? []).filter((row) => row.status === 'approved').map((row) => <option key={row.id} value={row.id}>{row.referenceNumber}</option>)}
            </select>
          </Field>
          <Field label="Supplier">
            <select className={controlClass} value={supplierId} onChange={(event) => setSupplierId(event.target.value)}>
              <option value="">Choose</option>
              {(suppliers.data?.data ?? []).filter((row) => row.status === 'active').map((row) => <option key={row.id} value={row.id}>{row.name}</option>)}
            </select>
          </Field>
          <div className="flex items-end"><Button type="submit" disabled={issue.isPending || !selected}>Issue order</Button></div>
        </form>
      ) : null}
      {can('procurement.manage') || can('inventory.manage') ? (
        <form className="mb-6 grid gap-3 rounded-lg border border-line bg-white p-4 sm:grid-cols-4" onSubmit={(event) => { event.preventDefault(); receive.mutate(); }}>
          <Field label="Open order">
            <select className={controlClass} value={orderId} onChange={(event) => setOrderId(event.target.value)}>
              <option value="">Choose</option>
              {(orders.data?.data ?? []).filter((row) => row.status === 'issued' || row.status === 'partial').map((row) => <option key={row.id} value={row.id}>{row.referenceNumber}</option>)}
            </select>
          </Field>
          <Field label="Warehouse">
            <select className={controlClass} value={warehouseId} onChange={(event) => setWarehouseId(event.target.value)}>
              <option value="">Choose</option>
              {(warehouses.data?.data ?? []).filter((row) => row.status === 'active').map((row) => <option key={row.id} value={row.id}>{row.code} · {row.name}</option>)}
            </select>
          </Field>
          <Field label="Quantity on first open line"><input className={controlClass} value={quantity} onChange={(event) => setQuantity(event.target.value)} /></Field>
          <div className="flex items-end"><Button type="submit" disabled={receive.isPending}>Receive goods</Button></div>
        </form>
      ) : null}
      <div className="grid gap-3">
        {(orders.data?.data ?? []).map((row) => (
          <article key={row.id} className="rounded-lg border border-line bg-white p-4">
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-semibold">{row.referenceNumber}</span>
              <Badge value={row.status} />
              <span className="text-sm text-slate-500">{row.supplierName} · {row.requisitionReference} · {row.totalAmount.toFixed(2)}</span>
            </div>
            <ul className="mt-2 text-sm text-slate-600">
              {row.lines.map((line) => <li key={line.id}>{line.description} · received {line.receivedQuantity} of {line.quantity}</li>)}
            </ul>
          </article>
        ))}
        {orders.data?.data.length === 0 ? <p className="text-sm text-slate-500">No purchase orders yet.</p> : null}
      </div>
    </section>
  );
}

export function SuppliersPage() {
  const { can } = useAuth();
  const client = useQueryClient();
  const suppliers = useList<Supplier[]>('suppliers', '/v1/procurement/suppliers');
  const invoices = useList<Invoice[]>('invoices', '/v1/procurement/invoices');
  const orders = useList<Order[]>('orders', '/v1/procurement/orders');
  const [name, setName] = useState('');
  const [supplierId, setSupplierId] = useState('');
  const [orderId, setOrderId] = useState('');
  const [invoiceNumber, setInvoiceNumber] = useState('');
  const [invoiceDate, setInvoiceDate] = useState('');
  const [amount, setAmount] = useState('');
  const [error, setError] = useState('');
  const create = useMutation({
    mutationFn: () => api('/v1/procurement/suppliers', { method: 'POST', body: JSON.stringify({ name }) }),
    onSuccess: async () => {
      setName('');
      setError('');
      await client.invalidateQueries({ queryKey: ['suppliers'] });
    },
    onError: (reason) => setError(message(reason)),
  });
  const toggle = useMutation({
    mutationFn: (supplier: Supplier) => api(`/v1/procurement/suppliers/${supplier.id}`, {
      method: 'PATCH',
      body: JSON.stringify({ status: supplier.status === 'active' ? 'inactive' : 'active' }),
    }),
    onSuccess: async () => client.invalidateQueries({ queryKey: ['suppliers'] }),
  });
  const recordInvoice = useMutation({
    mutationFn: () => api('/v1/procurement/invoices', {
      method: 'POST',
      body: JSON.stringify({
        supplierId: Number(supplierId),
        purchaseOrderId: orderId ? Number(orderId) : null,
        invoiceNumber,
        invoiceDate,
        amount: Number(amount),
      }),
    }),
    onSuccess: async () => {
      setInvoiceNumber('');
      setAmount('');
      setError('');
      await client.invalidateQueries({ queryKey: ['invoices'] });
    },
    onError: (reason) => setError(message(reason)),
  });
  return (
    <section>
      <PageHeader title="Suppliers" description="An inactive supplier cannot be used on a new purchase order. Recorded invoices stay attached to the supplier." />
      {can('procurement.manage') ? (
        <form className="mb-6 flex flex-wrap items-end gap-3" onSubmit={(event) => { event.preventDefault(); create.mutate(); }}>
          <Field label="Supplier name"><input className={controlClass} value={name} onChange={(event) => setName(event.target.value)} /></Field>
          <Button type="submit" disabled={create.isPending}>Add supplier</Button>
        </form>
      ) : null}
      {can('procurement.manage') ? (
        <form className="mb-6 grid gap-3 rounded-lg border border-line bg-white p-4 sm:grid-cols-2" onSubmit={(event) => { event.preventDefault(); recordInvoice.mutate(); }}>
          <h2 className="font-semibold sm:col-span-2">Supplier invoice</h2>
          <Field label="Supplier">
            <select className={controlClass} value={supplierId} onChange={(event) => setSupplierId(event.target.value)}>
              <option value="">Choose</option>
              {(suppliers.data?.data ?? []).filter((row) => row.status === 'active').map((row) => <option key={row.id} value={row.id}>{row.name}</option>)}
            </select>
          </Field>
          <Field label="Purchase order">
            <select className={controlClass} value={orderId} onChange={(event) => setOrderId(event.target.value)}>
              <option value="">None</option>
              {(orders.data?.data ?? []).map((row) => <option key={row.id} value={row.id}>{row.referenceNumber}</option>)}
            </select>
          </Field>
          <Field label="Invoice number"><input className={controlClass} value={invoiceNumber} onChange={(event) => setInvoiceNumber(event.target.value)} /></Field>
          <Field label="Invoice date"><input className={controlClass} type="date" value={invoiceDate} onChange={(event) => setInvoiceDate(event.target.value)} /></Field>
          <Field label="Amount"><input className={controlClass} value={amount} onChange={(event) => setAmount(event.target.value)} /></Field>
          <div className="flex items-end"><Button type="submit" disabled={recordInvoice.isPending}>Record invoice</Button></div>
        </form>
      ) : null}
      {error ? <div className="mb-4"><ErrorText>{error}</ErrorText></div> : null}
      <div className="mb-6 grid gap-2">
        {(invoices.data?.data ?? []).map((row) => (
          <article key={row.id} className="rounded-lg border border-line bg-white px-4 py-3 text-sm">
            {row.referenceNumber} · {row.supplierName} · {row.invoiceNumber} · {row.invoiceDate} · {row.amount.toFixed(2)}{row.orderReference ? ` · ${row.orderReference}` : ''}
          </article>
        ))}
      </div>
      <div className="grid gap-2">
        {(suppliers.data?.data ?? []).map((row) => (
          <article key={row.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-line bg-white px-4 py-3">
            <div><span className="font-semibold">{row.name}</span> <span className="text-sm text-slate-500">{row.referenceNumber}</span></div>
            <div className="flex items-center gap-3">
              <Badge value={row.status} />
              {can('procurement.manage') ? <button className="text-sm text-pine" type="button" onClick={() => toggle.mutate(row)}>{row.status === 'active' ? 'Deactivate' : 'Activate'}</button> : null}
            </div>
          </article>
        ))}
        {suppliers.data?.data.length === 0 ? <p className="text-sm text-slate-500">No suppliers yet.</p> : null}
      </div>
    </section>
  );
}

export function InventoryPage() {
  const { can } = useAuth();
  const client = useQueryClient();
  const items = useList<Item[]>('stock-items', '/v1/inventory/items');
  const warehouses = useList<Warehouse[]>('warehouses', '/v1/inventory/warehouses');
  const balances = useList<Balance[]>('balances', '/v1/inventory/balances');
  const movements = useList<Movement[]>('movements', '/v1/inventory/movements');
  const [sku, setSku] = useState('');
  const [itemName, setItemName] = useState('');
  const [reorder, setReorder] = useState('0');
  const [warehouseCode, setWarehouseCode] = useState('');
  const [warehouseName, setWarehouseName] = useState('');
  const [movementType, setMovementType] = useState('issue');
  const [warehouseId, setWarehouseId] = useState('');
  const [destinationId, setDestinationId] = useState('');
  const [itemId, setItemId] = useState('');
  const [quantity, setQuantity] = useState('1');
  const [notes, setNotes] = useState('');
  const [error, setError] = useState('');
  const refresh = async () => {
    await client.invalidateQueries({ queryKey: ['stock-items'] });
    await client.invalidateQueries({ queryKey: ['warehouses'] });
    await client.invalidateQueries({ queryKey: ['balances'] });
    await client.invalidateQueries({ queryKey: ['movements'] });
  };
  const addItem = useMutation({
    mutationFn: () => api('/v1/inventory/items', { method: 'POST', body: JSON.stringify({ sku, name: itemName, reorderLevel: Number(reorder), unit: 'unit' }) }),
    onSuccess: async () => { setSku(''); setItemName(''); setError(''); await refresh(); },
    onError: (reason) => setError(message(reason)),
  });
  const addWarehouse = useMutation({
    mutationFn: () => api('/v1/inventory/warehouses', { method: 'POST', body: JSON.stringify({ code: warehouseCode, name: warehouseName }) }),
    onSuccess: async () => { setWarehouseCode(''); setWarehouseName(''); setError(''); await refresh(); },
    onError: (reason) => setError(message(reason)),
  });
  const move = useMutation({
    mutationFn: () => api('/v1/inventory/movements', {
      method: 'POST',
      body: JSON.stringify({
        type: movementType,
        warehouseId: Number(warehouseId),
        destinationWarehouseId: movementType === 'transfer' ? Number(destinationId) : null,
        itemId: Number(itemId),
        quantity: Number(quantity),
        direction: movementType === 'adjustment' ? 'decrease' : undefined,
        notes,
      }),
    }),
    onSuccess: async () => { setNotes(''); setError(''); await refresh(); },
    onError: (reason) => setError(message(reason)),
  });

  return (
    <section>
      <PageHeader title="Stock" description="Receipts come from goods received notes. Issues, transfers, adjustments, and damaged stock each write a movement, so the balance can be traced." />
      {error ? <div className="mb-4"><ErrorText>{error}</ErrorText></div> : null}
      {can('inventory.manage') ? (
        <div className="mb-6 grid gap-4 lg:grid-cols-2">
          <form className="grid gap-3 rounded-lg border border-line bg-white p-4" onSubmit={(event) => { event.preventDefault(); addItem.mutate(); }}>
            <h2 className="font-semibold">Item</h2>
            <Field label="Code"><input className={controlClass} value={sku} onChange={(event) => setSku(event.target.value)} /></Field>
            <Field label="Name"><input className={controlClass} value={itemName} onChange={(event) => setItemName(event.target.value)} /></Field>
            <Field label="Reorder level"><input className={controlClass} value={reorder} onChange={(event) => setReorder(event.target.value)} /></Field>
            <Button type="submit" disabled={addItem.isPending}>Add item</Button>
          </form>
          <form className="grid gap-3 rounded-lg border border-line bg-white p-4" onSubmit={(event) => { event.preventDefault(); addWarehouse.mutate(); }}>
            <h2 className="font-semibold">Warehouse</h2>
            <Field label="Code"><input className={controlClass} value={warehouseCode} onChange={(event) => setWarehouseCode(event.target.value)} /></Field>
            <Field label="Name"><input className={controlClass} value={warehouseName} onChange={(event) => setWarehouseName(event.target.value)} /></Field>
            <Button type="submit" disabled={addWarehouse.isPending}>Add warehouse</Button>
          </form>
          <form className="grid gap-3 rounded-lg border border-line bg-white p-4 lg:col-span-2" onSubmit={(event) => { event.preventDefault(); move.mutate(); }}>
            <h2 className="font-semibold">Movement</h2>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Type">
                <select className={controlClass} value={movementType} onChange={(event) => setMovementType(event.target.value)}>
                  <option value="issue">Issue</option>
                  <option value="transfer">Transfer</option>
                  <option value="adjustment">Adjustment down</option>
                  <option value="damage">Damaged stock</option>
                </select>
              </Field>
              <Field label="Item">
                <select className={controlClass} value={itemId} onChange={(event) => setItemId(event.target.value)}>
                  <option value="">Choose</option>
                  {(items.data?.data ?? []).map((item) => <option key={item.id} value={item.id}>{item.sku} · {item.name}</option>)}
                </select>
              </Field>
              <Field label="Warehouse">
                <select className={controlClass} value={warehouseId} onChange={(event) => setWarehouseId(event.target.value)}>
                  <option value="">Choose</option>
                  {(warehouses.data?.data ?? []).map((row) => <option key={row.id} value={row.id}>{row.name}</option>)}
                </select>
              </Field>
              {movementType === 'transfer' ? (
                <Field label="Destination">
                  <select className={controlClass} value={destinationId} onChange={(event) => setDestinationId(event.target.value)}>
                    <option value="">Choose</option>
                    {(warehouses.data?.data ?? []).map((row) => <option key={row.id} value={row.id}>{row.name}</option>)}
                  </select>
                </Field>
              ) : null}
              <Field label="Quantity"><input className={controlClass} value={quantity} onChange={(event) => setQuantity(event.target.value)} /></Field>
              <Field label="Reason"><input className={controlClass} value={notes} onChange={(event) => setNotes(event.target.value)} /></Field>
            </div>
            <Button type="submit" disabled={move.isPending}>Post movement</Button>
          </form>
        </div>
      ) : null}
      <h2 className="mb-2 font-semibold">On hand</h2>
      <div className="mb-6 grid gap-2">
        {(balances.data?.data ?? []).map((row) => (
          <article key={`${row.warehouseName}-${row.sku}`} className="rounded-lg border border-line bg-white px-4 py-3 text-sm">
            {row.warehouseName} · {row.sku} {row.itemName} · {row.quantity} · value {row.value.toFixed(2)}
          </article>
        ))}
        {balances.data?.data.length === 0 ? <p className="text-sm text-slate-500">No stock on hand.</p> : null}
      </div>
      <h2 className="mb-2 font-semibold">Movements</h2>
      <div className="grid gap-2">
        {(movements.data?.data ?? []).map((row) => (
          <article key={row.id} className="rounded-lg border border-line bg-white px-4 py-3 text-sm">
            {row.referenceNumber} · {row.movementType} · {row.sku} · {row.quantity} · {row.warehouseName} · balance {row.balanceAfter}
          </article>
        ))}
      </div>
    </section>
  );
}

export function StockReportsPage() {
  const report = useQuery({
    queryKey: ['inventory-report'],
    queryFn: () => api<{ data: StockReport }>('/v1/inventory/reports'),
  });
  const data = report.data?.data;
  return (
    <section>
      <PageHeader title="Stock reports" description="Value uses the weighted average cost of each warehouse balance. Reorder and expired lots come from the quantities still on hand." action={<ReportDownloads base="/api/v1/inventory/reports" />} />
      {report.isError ? <ErrorText>{message(report.error)}</ErrorText> : null}
      {data ? (
        <>
          <article className="mb-4 rounded-lg border border-line bg-white px-4 py-4">
            <div className="text-sm text-slate-500">Stock value</div>
            <div className="mt-1 text-3xl font-semibold">{data.stockValue.toFixed(2)}</div>
          </article>
          <h2 className="mb-2 font-semibold">At or below reorder</h2>
          <div className="mb-4 grid gap-2">
            {data.belowReorder.map((row) => <article key={row.sku} className="rounded-lg border border-line bg-white px-4 py-3 text-sm">{row.sku} · {row.name} · on hand {row.onHand} · reorder {row.reorderLevel}</article>)}
            {data.belowReorder.length === 0 ? <p className="text-sm text-slate-500">No item is at its reorder level.</p> : null}
          </div>
          <h2 className="mb-2 font-semibold">Expired lots still on hand</h2>
          <div className="grid gap-2">
            {data.expired.map((row) => <article key={`${row.warehouseName}-${row.lotCode}`} className="rounded-lg border border-line bg-white px-4 py-3 text-sm">{row.sku} · {row.warehouseName} · {row.lotCode} · {row.expiryDate} · {row.quantity}</article>)}
            {data.expired.length === 0 ? <p className="text-sm text-slate-500">No expired quantity is still on hand.</p> : null}
          </div>
        </>
      ) : null}
    </section>
  );
}
