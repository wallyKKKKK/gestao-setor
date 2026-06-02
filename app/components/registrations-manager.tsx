'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { Building2, Database, PackageSearch, Plus, Save, Search, Trash2, Truck, Upload, X } from 'lucide-react';
import {
  countReallocationProducts,
  deletePricingBranch,
  deleteSupplierPaymentTerm,
  fetchPricingBranches,
  fetchReallocationProducts,
  fetchSupplierPaymentTerms,
  savePricingBranch,
  saveSupplierPaymentTerm,
  type PricingBranchInput,
  type SupplierPaymentTermInput,
} from '@/lib/api';
import { getAuthHeaders } from '@/lib/auth-headers';
import type { PricingBranch, ReallocationProduct, SupplierPaymentTerm } from '@/lib/types';

type RegistryTab = 'PRODUTOS' | 'LOJAS' | 'FORNECEDORES';

const blankBranch: PricingBranchInput = {
  name: '',
  code: '',
  city: '',
  legal_name: '',
  uf: '',
  cnpj: '',
  logistics_group: '',
  is_active: true,
};

const blankSupplier: SupplierPaymentTermInput = {
  supplier_name: '',
  payment_terms: '',
  category: '',
  region: '',
  min_order_value: 0,
  condition_notes: '',
  contact_name: '',
  phone: '',
  email: '',
  tax_id: '',
  is_active: true,
  sort_order: 0,
};

export function RegistrationsManager() {
  const [activeTab, setActiveTab] = useState<RegistryTab>('PRODUTOS');
  const [products, setProducts] = useState<ReallocationProduct[]>([]);
  const [branches, setBranches] = useState<PricingBranch[]>([]);
  const [suppliers, setSuppliers] = useState<SupplierPaymentTerm[]>([]);
  const [productSearch, setProductSearch] = useState('');
  const [totalProducts, setTotalProducts] = useState(0);
  const [editingBranch, setEditingBranch] = useState<PricingBranchInput | null>(null);
  const [editingSupplier, setEditingSupplier] = useState<SupplierPaymentTermInput | null>(null);
  const [loading, setLoading] = useState(false);
  const [importing, setImporting] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');
  const productFileRef = useRef<HTMLInputElement>(null);

  const loadProducts = useCallback(async (term = productSearch) => {
    setLoading(true);
    try {
      const [rows, total] = await Promise.all([
        term.trim() ? fetchReallocationProducts(term, 120) : Promise.resolve([]),
        countReallocationProducts().catch(() => 0),
      ]);
      setProducts(rows);
      setTotalProducts(total);
      setErrorMessage('');
    } catch {
      setProducts([]);
      setErrorMessage('Nao consegui carregar o cadastro mestre de produtos.');
    } finally {
      setLoading(false);
    }
  }, [productSearch]);

  const loadBranches = useCallback(async () => {
    try {
      setBranches(await fetchPricingBranches());
    } catch {
      setBranches([]);
    }
  }, []);

  const loadSuppliers = useCallback(async () => {
    try {
      setSuppliers(await fetchSupplierPaymentTerms());
    } catch {
      setSuppliers([]);
    }
  }, []);

  useEffect(() => {
    queueMicrotask(() => {
      void loadProducts('');
      void loadBranches();
      void loadSuppliers();
    });
  }, [loadBranches, loadProducts, loadSuppliers]);

  useEffect(() => {
    const timeout = window.setTimeout(() => loadProducts(productSearch), 300);
    return () => window.clearTimeout(timeout);
  }, [loadProducts, productSearch]);

  useEffect(() => {
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;

      if (editingBranch) {
        setEditingBranch(null);
        return;
      }
      if (editingSupplier) {
        setEditingSupplier(null);
        return;
      }
      if (productSearch) {
        setProductSearch('');
      }
    };

    window.addEventListener('keydown', handleEscape);
    return () => window.removeEventListener('keydown', handleEscape);
  }, [editingBranch, editingSupplier, productSearch]);

  const supplierCategories = useMemo(() => Array.from(new Set(suppliers.map((supplier) => supplier.category).filter(Boolean))).length, [suppliers]);
  const logisticsGroups = useMemo(() => Array.from(new Set(branches.map((branch) => branch.logistics_group).filter(Boolean))).length, [branches]);

  const importProductCatalog = async (file: File) => {
    setImporting(true);
    setErrorMessage('');
    try {
      const formData = new FormData();
      formData.append('file', file);
      const response = await fetch('/api/reallocation/products/import', { method: 'POST', headers: await getAuthHeaders(), body: formData });
      const data = await response.json().catch(() => null);
      if (!response.ok) throw new Error(data?.error || 'Erro ao importar cadastro de produtos.');
      alert(`${data.imported || 0} produtos importados. ${data.enriched || 0} produtos enriquecidos. ${data.unmatched || 0} EANs sem vinculo.`);
      await loadProducts(productSearch);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : 'Erro desconhecido');
    } finally {
      setImporting(false);
      if (productFileRef.current) productFileRef.current.value = '';
    }
  };

  const persistBranch = async () => {
    if (!editingBranch?.name || !editingBranch.code) {
      alert('Preencha nome e codigo da loja.');
      return;
    }
    await savePricingBranch(editingBranch);
    setEditingBranch(null);
    await loadBranches();
  };

  const removeBranch = async (branch: PricingBranch) => {
    if (!confirm(`Excluir loja ${branch.name}?`)) return;
    await deletePricingBranch(branch.id);
    await loadBranches();
  };

  const persistSupplier = async () => {
    if (!editingSupplier?.supplier_name) {
      alert('Preencha o nome do fornecedor.');
      return;
    }
    await saveSupplierPaymentTerm(editingSupplier);
    setEditingSupplier(null);
    await loadSuppliers();
  };

  const removeSupplier = async (supplier: SupplierPaymentTerm) => {
    if (!confirm(`Excluir fornecedor ${supplier.supplier_name}?`)) return;
    await deleteSupplierPaymentTerm(supplier.id);
    await loadSuppliers();
  };

  return (
    <main className="max-w-7xl mx-auto px-4 sm:px-6 py-6 sm:py-8 pb-24 md:pb-8">
      <div className="flex flex-col xl:flex-row xl:items-center justify-between gap-4 mb-6">
        <div className="flex items-center gap-4">
          <div className="w-14 h-14 rounded-2xl bg-slate-900 text-white flex items-center justify-center shadow-md">
            <Database size={28} />
          </div>
          <div>
            <h1 className="text-3xl sm:text-4xl font-black uppercase tracking-tight text-slate-900">Cadastros</h1>
            <p className="text-sm font-bold text-slate-500">Base central de produtos, lojas e fornecedores usada pelo sistema.</p>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-5">
        <StatCard label="Produtos mestre" value={totalProducts.toLocaleString('pt-BR')} />
        <StatCard label="Lojas cadastradas" value={branches.length.toLocaleString('pt-BR')} />
        <StatCard label="Grupos logisticos" value={logisticsGroups.toLocaleString('pt-BR')} />
        <StatCard label="Fornecedores" value={suppliers.length.toLocaleString('pt-BR')} />
        <StatCard label="Categorias fornecedor" value={supplierCategories.toLocaleString('pt-BR')} />
        <StatCard label="Lojas ativas" value={branches.filter((branch) => branch.is_active).length.toLocaleString('pt-BR')} />
      </div>

      <div className="mb-5 flex flex-wrap gap-2 rounded-2xl border-2 border-slate-100 bg-white p-2">
        {(['PRODUTOS', 'LOJAS', 'FORNECEDORES'] as RegistryTab[]).map((tab) => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            className={`h-11 px-4 rounded-xl font-black uppercase text-[10px] flex items-center gap-2 ${activeTab === tab ? 'bg-slate-900 text-white' : 'bg-slate-50 text-slate-500'}`}
          >
            {tab === 'PRODUTOS' ? <PackageSearch size={15} /> : tab === 'LOJAS' ? <Building2 size={15} /> : <Truck size={15} />}
            {tab}
          </button>
        ))}
      </div>

      {errorMessage && <div className="mb-5 rounded-2xl border-2 border-amber-200 bg-amber-50 p-4 text-sm font-bold text-amber-800">{errorMessage}</div>}

      {activeTab === 'PRODUTOS' && (
        <section className="rounded-[28px] border-2 border-slate-100 bg-white p-4 shadow-sm">
          <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3 mb-4">
            <div className="relative flex-1">
              <Search size={18} className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400" />
              <input
                value={productSearch}
                onChange={(event) => setProductSearch(event.target.value)}
                placeholder="BUSCAR POR CODIGO ERP, EAN, PRODUTO, FABRICANTE OU CLASSIFICACAO..."
                className="w-full h-12 rounded-2xl bg-slate-50 border-2 border-slate-100 pl-12 pr-4 text-sm font-bold outline-none focus:border-slate-900"
              />
            </div>
            <input
              ref={productFileRef}
              type="file"
              accept=".csv"
              className="hidden"
              onChange={(event) => {
                const file = event.target.files?.[0];
                if (file) importProductCatalog(file);
              }}
            />
            <button onClick={() => productFileRef.current?.click()} disabled={importing} className="h-12 px-4 rounded-2xl bg-slate-900 text-white font-black uppercase text-[10px] flex items-center gap-2 disabled:opacity-50">
              <Upload size={16} /> {importing ? 'Importando...' : 'Importar CSV'}
            </button>
          </div>

          <DataTable emptyText={loading ? 'Carregando...' : productSearch.trim() ? 'Nenhum produto encontrado' : 'Busque para listar produtos'}>
            <thead className="bg-slate-100 text-[10px] uppercase text-slate-600">
              <tr>
                <th className="border border-slate-300 px-3 py-3 text-left">Codigo ERP</th>
                <th className="border border-slate-300 px-3 py-3 text-left">EAN</th>
                <th className="border border-slate-300 px-3 py-3 text-left">Produto</th>
                <th className="border border-slate-300 px-3 py-3 text-left">Fabricante</th>
                <th className="border border-slate-300 px-3 py-3 text-left">Classificacao</th>
              </tr>
            </thead>
            <tbody>
              {products.map((product) => (
                <tr key={product.id} className="even:bg-slate-50">
                  <td className="border border-slate-200 px-3 py-3 font-black">{product.erp_code}</td>
                  <td className="border border-slate-200 px-3 py-3 font-mono">{product.ean || '-'}</td>
                  <td className="border border-slate-200 px-3 py-3 font-bold uppercase">{product.description}</td>
                  <td className="border border-slate-200 px-3 py-3">{product.manufacturer || '-'}</td>
                  <td className="border border-slate-200 px-3 py-3">{product.classification || '-'}</td>
                </tr>
              ))}
            </tbody>
          </DataTable>
        </section>
      )}

      {activeTab === 'LOJAS' && (
        <section className="rounded-[28px] border-2 border-slate-100 bg-white p-4 shadow-sm">
          <div className="flex items-center justify-between gap-3 mb-4">
            <div>
              <h2 className="font-black uppercase text-xl">Lojas</h2>
              <p className="text-xs font-bold text-slate-500">Cadastro central de filiais e grupo logistico.</p>
            </div>
            <button onClick={() => setEditingBranch({ ...blankBranch })} className="h-10 px-4 rounded-2xl bg-slate-900 text-white font-black uppercase text-[10px] flex items-center gap-2">
              <Plus size={15} /> Nova loja
            </button>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
            {branches.map((branch) => (
              <RegistryCard key={branch.id} title={branch.name} subtitle={`${branch.code} ${branch.city ? `- ${branch.city}` : ''}`} badge={branch.logistics_group ? `Grupo ${branch.logistics_group}` : 'Sem grupo'} active={branch.is_active} onEdit={() => setEditingBranch(branch)} onDelete={() => removeBranch(branch)} />
            ))}
          </div>
        </section>
      )}

      {activeTab === 'FORNECEDORES' && (
        <section className="rounded-[28px] border-2 border-slate-100 bg-white p-4 shadow-sm">
          <div className="flex items-center justify-between gap-3 mb-4">
            <div>
              <h2 className="font-black uppercase text-xl">Fornecedores</h2>
              <p className="text-xs font-bold text-slate-500">Cadastro central usado pela interface de prazos.</p>
            </div>
            <button onClick={() => setEditingSupplier({ ...blankSupplier })} className="h-10 px-4 rounded-2xl bg-slate-900 text-white font-black uppercase text-[10px] flex items-center gap-2">
              <Plus size={15} /> Novo fornecedor
            </button>
          </div>
          <DataTable emptyText="Nenhum fornecedor cadastrado">
            <thead className="bg-slate-100 text-[10px] uppercase text-slate-600">
              <tr>
                <th className="border border-slate-300 px-3 py-3 text-left">Fornecedor</th>
                <th className="border border-slate-300 px-3 py-3 text-left">Prazos</th>
                <th className="border border-slate-300 px-3 py-3 text-left">Categoria</th>
                <th className="border border-slate-300 px-3 py-3 text-left">Contato</th>
                <th className="border border-slate-300 px-3 py-3 text-center">Acoes</th>
              </tr>
            </thead>
            <tbody>
              {suppliers.map((supplier) => (
                <tr key={supplier.id} className="even:bg-slate-50">
                  <td className="border border-slate-200 px-3 py-3 font-black">{supplier.supplier_name}</td>
                  <td className="border border-slate-200 px-3 py-3">{supplier.payment_terms || '-'}</td>
                  <td className="border border-slate-200 px-3 py-3">{supplier.category || '-'}</td>
                  <td className="border border-slate-200 px-3 py-3">{supplier.contact_name || supplier.phone || supplier.email || '-'}</td>
                  <td className="border border-slate-200 px-3 py-3">
                    <div className="flex justify-center gap-2">
                      <IconButton onClick={() => setEditingSupplier(supplier)}><Save size={15} /></IconButton>
                      <IconButton danger onClick={() => removeSupplier(supplier)}><Trash2 size={15} /></IconButton>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </DataTable>
        </section>
      )}

      {editingBranch && (
        <EditorModal title="Loja" onClose={() => setEditingBranch(null)} onSave={persistBranch}>
          <TextInput label="Nome" value={editingBranch.name} onChange={(value) => setEditingBranch((current) => current ? { ...current, name: value } : current)} />
          <TextInput label="Codigo" value={editingBranch.code} onChange={(value) => setEditingBranch((current) => current ? { ...current, code: value } : current)} />
          <TextInput label="Cidade" value={editingBranch.city} onChange={(value) => setEditingBranch((current) => current ? { ...current, city: value } : current)} />
          <TextInput label="UF" value={editingBranch.uf} onChange={(value) => setEditingBranch((current) => current ? { ...current, uf: value } : current)} />
          <TextInput label="Grupo logistico" value={editingBranch.logistics_group || ''} onChange={(value) => setEditingBranch((current) => current ? { ...current, logistics_group: value } : current)} />
          <TextInput label="CNPJ" value={editingBranch.cnpj} onChange={(value) => setEditingBranch((current) => current ? { ...current, cnpj: value } : current)} />
          <TextInput label="Razao social" value={editingBranch.legal_name} onChange={(value) => setEditingBranch((current) => current ? { ...current, legal_name: value } : current)} />
          <ToggleInput label="Loja ativa" checked={editingBranch.is_active} onChange={(checked) => setEditingBranch((current) => current ? { ...current, is_active: checked } : current)} />
        </EditorModal>
      )}

      {editingSupplier && (
        <EditorModal title="Fornecedor" onClose={() => setEditingSupplier(null)} onSave={persistSupplier}>
          <TextInput label="Fornecedor" value={editingSupplier.supplier_name} onChange={(value) => setEditingSupplier((current) => current ? { ...current, supplier_name: value } : current)} />
          <TextInput label="Prazo boleto" value={editingSupplier.payment_terms} onChange={(value) => setEditingSupplier((current) => current ? { ...current, payment_terms: value } : current)} />
          <TextInput label="Categoria" value={editingSupplier.category} onChange={(value) => setEditingSupplier((current) => current ? { ...current, category: value } : current)} />
          <TextInput label="Regiao" value={editingSupplier.region} onChange={(value) => setEditingSupplier((current) => current ? { ...current, region: value } : current)} />
          <TextInput label="Contato" value={editingSupplier.contact_name} onChange={(value) => setEditingSupplier((current) => current ? { ...current, contact_name: value } : current)} />
          <TextInput label="Telefone" value={editingSupplier.phone} onChange={(value) => setEditingSupplier((current) => current ? { ...current, phone: value } : current)} />
          <TextInput label="Email" value={editingSupplier.email} onChange={(value) => setEditingSupplier((current) => current ? { ...current, email: value } : current)} />
          <TextInput label="CNPJ" value={editingSupplier.tax_id} onChange={(value) => setEditingSupplier((current) => current ? { ...current, tax_id: value } : current)} />
          <TextInput label="Observacoes" value={editingSupplier.condition_notes} onChange={(value) => setEditingSupplier((current) => current ? { ...current, condition_notes: value } : current)} />
          <ToggleInput label="Fornecedor ativo" checked={editingSupplier.is_active} onChange={(checked) => setEditingSupplier((current) => current ? { ...current, is_active: checked } : current)} />
        </EditorModal>
      )}
    </main>
  );
}

function StatCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-white border-2 border-slate-100 rounded-2xl p-5">
      <p className="text-[10px] font-black uppercase text-slate-400">{label}</p>
      <p className="text-2xl font-black text-slate-900">{value}</p>
    </div>
  );
}

function DataTable({ children }: { children: ReactNode; emptyText: string }) {
  return (
    <div className="max-h-[calc(100vh-260px)] overflow-auto rounded-md border border-slate-300">
      <table className="w-full min-w-[980px] border-collapse text-sm">{children}</table>
    </div>
  );
}

function RegistryCard({ title, subtitle, badge, active, onEdit, onDelete }: { title: string; subtitle: string; badge: string; active: boolean; onEdit: () => void; onDelete: () => void }) {
  return (
    <div className={`rounded-2xl border-2 p-4 ${active ? 'border-slate-100 bg-slate-50' : 'border-red-100 bg-red-50'}`}>
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="font-black uppercase text-slate-900">{title}</p>
          <p className="text-[10px] font-black uppercase text-slate-400">{subtitle}</p>
          <p className="text-[10px] font-black text-blue-600 mt-1">{badge}</p>
          <p className={`text-[9px] font-black uppercase mt-2 ${active ? 'text-green-600' : 'text-red-600'}`}>{active ? 'Ativa' : 'Inativa'}</p>
        </div>
        <div className="flex gap-1">
          <IconButton onClick={onEdit}><Save size={15} /></IconButton>
          <IconButton danger onClick={onDelete}><Trash2 size={15} /></IconButton>
        </div>
      </div>
    </div>
  );
}

function EditorModal({ title, children, onClose, onSave }: { title: string; children: ReactNode; onClose: () => void; onSave: () => void }) {
  return (
    <div className="fixed inset-0 z-[90] bg-slate-900/70 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="bg-white w-full max-w-2xl rounded-[28px] p-6 shadow-2xl max-h-[92vh] overflow-y-auto">
        <div className="flex items-center justify-between mb-5">
          <h2 className="text-2xl font-black uppercase">{title}</h2>
          <button onClick={onClose}><X size={22} /></button>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">{children}</div>
        <div className="mt-6 flex justify-end gap-3">
          <button onClick={onClose} className="px-5 py-3 rounded-2xl bg-slate-100 font-black uppercase text-xs">Cancelar</button>
          <button onClick={onSave} className="px-6 py-3 rounded-2xl bg-slate-900 text-white font-black uppercase text-xs flex items-center gap-2">
            <Save size={16} /> Salvar
          </button>
        </div>
      </div>
    </div>
  );
}

function TextInput({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) {
  return (
    <label className="block">
      <span className="text-[10px] font-black uppercase text-slate-500">{label}</span>
      <input value={value || ''} onChange={(event) => onChange(event.target.value)} className="mt-1 h-11 w-full rounded-2xl border-2 border-slate-100 bg-slate-50 px-4 text-sm font-bold outline-none focus:border-slate-900" />
    </label>
  );
}

function ToggleInput({ label, checked, onChange }: { label: string; checked: boolean; onChange: (checked: boolean) => void }) {
  return (
    <label className="flex items-center gap-3 rounded-2xl bg-slate-50 border-2 border-slate-100 p-4">
      <input type="checkbox" checked={checked} onChange={(event) => onChange(event.target.checked)} className="w-5 h-5" />
      <span className="text-[10px] font-black uppercase text-slate-500">{label}</span>
    </label>
  );
}

function IconButton({ children, onClick, danger = false }: { children: ReactNode; onClick: () => void; danger?: boolean }) {
  return (
    <button onClick={onClick} className={`p-2 rounded-xl bg-white ${danger ? 'text-red-600' : 'text-blue-600'}`}>
      {children}
    </button>
  );
}
