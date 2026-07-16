'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { Building2, Check, ChevronDown, Factory, Layers3, PackageSearch, Pencil, Plus, Save, Search, Trash2, Truck, Upload, X } from 'lucide-react';
import {
  countReallocationProducts,
  deletePricingBranch,
  deletePricingMarginRule,
  deleteReallocationProduct,
  deleteSupplierPaymentTerm,
  fetchReallocationAttributeSummary,
  fetchPricingBranches,
  fetchPricingMarginRules,
  fetchReallocationProducts,
  fetchSupplierPaymentTerms,
  renameReallocationProductAttribute,
  savePricingBranch,
  savePricingMarginRule,
  saveReallocationProduct,
  saveSupplierPaymentTerm,
  type PricingBranchInput,
  type PricingMarginRuleInput,
  type ReallocationProductAttributeField,
  type ReallocationProductAttributeSummary,
  type ReallocationProductInput,
  type SupplierPaymentTermInput,
} from '@/lib/api';
import { getAuthHeaders } from '@/lib/auth-headers';
import type { PricingBranch, PricingMarginRule, ReallocationProduct, SupplierPaymentTerm } from '@/lib/types';

type RegistryTab = 'PRODUTOS' | 'FABRICANTES' | 'CLASSIFICACOES' | 'MARGENS' | 'LOJAS' | 'FORNECEDORES';

interface EditingProductAttribute {
  field: ReallocationProductAttributeField;
  fromValue: string;
  toValue: string;
  count: number;
}

const blankBranch: PricingBranchInput = {
  name: '',
  code: '',
  city: '',
  legal_name: '',
  uf: '',
  cnpj: '',
  logistics_group: '',
  sends_stock: true,
  receives_stock: true,
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

const blankProduct: ReallocationProductInput = {
  erp_code: '',
  ean: '',
  description: '',
  manufacturer: '',
  classification: '',
  source_file: 'cadastros',
};

const blankMarginRule: PricingMarginRuleInput = {
  line: '',
  department: '',
  category: '',
  classification_path: '',
  desired_margin_percent: 0,
  desired_markup_percent: 0,
  source_file: 'cadastros',
  is_active: true,
};

const ALL_REGISTRY_TABS: RegistryTab[] = ['PRODUTOS', 'FABRICANTES', 'CLASSIFICACOES', 'MARGENS', 'LOJAS', 'FORNECEDORES'];

interface RegistrationsManagerProps {
  canManageBranches: boolean;
  canManageProducts: boolean;
  canManageMargins: boolean;
}

export function RegistrationsManager({ canManageBranches, canManageProducts, canManageMargins }: RegistrationsManagerProps) {
  const [activeTab, setActiveTab] = useState<RegistryTab>('PRODUTOS');
  const [products, setProducts] = useState<ReallocationProduct[]>([]);
  const [marginRules, setMarginRules] = useState<PricingMarginRule[]>([]);
  const [branches, setBranches] = useState<PricingBranch[]>([]);
  const [suppliers, setSuppliers] = useState<SupplierPaymentTerm[]>([]);
  const [manufacturers, setManufacturers] = useState<ReallocationProductAttributeSummary[]>([]);
  const [classifications, setClassifications] = useState<ReallocationProductAttributeSummary[]>([]);
  const [productSearch, setProductSearch] = useState('');
  const [productManufacturerFilter, setProductManufacturerFilter] = useState('');
  const [productClassificationFilter, setProductClassificationFilter] = useState('');
  const [attributeSearch, setAttributeSearch] = useState('');
  const [marginSearch, setMarginSearch] = useState('');
  const [marginLineFilter, setMarginLineFilter] = useState('');
  const [marginDepartmentFilter, setMarginDepartmentFilter] = useState('');
  const [marginCategoryFilter, setMarginCategoryFilter] = useState('');
  const [totalProducts, setTotalProducts] = useState(0);
  const [editingProduct, setEditingProduct] = useState<ReallocationProductInput | null>(null);
  const [editingProductAttribute, setEditingProductAttribute] = useState<EditingProductAttribute | null>(null);
  const [editingMarginRule, setEditingMarginRule] = useState<PricingMarginRuleInput | null>(null);
  const [editingBranch, setEditingBranch] = useState<PricingBranchInput | null>(null);
  const [editingSupplier, setEditingSupplier] = useState<SupplierPaymentTermInput | null>(null);
  const [loading, setLoading] = useState(false);
  const [importing, setImporting] = useState(false);
  const [attributeSaving, setAttributeSaving] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');
  const productFileRef = useRef<HTMLInputElement>(null);
  const marginFileRef = useRef<HTMLInputElement>(null);
  const visibleTabs = useMemo<RegistryTab[]>(
    () => (canManageBranches ? ALL_REGISTRY_TABS : ['PRODUTOS', 'FABRICANTES', 'CLASSIFICACOES', 'MARGENS', 'LOJAS']),
    [canManageBranches],
  );

  const loadProducts = useCallback(async (term: string, manufacturerFilter = '', classificationFilter = '') => {
    setLoading(true);
    try {
      const hasProductFilters = Boolean(manufacturerFilter || classificationFilter);
      const [rows, total] = await Promise.all([
        fetchReallocationProducts({
          searchTerm: term,
          manufacturers: manufacturerFilter ? [manufacturerFilter] : [],
          classifications: classificationFilter ? [classificationFilter] : [],
          limit: term.trim() || hasProductFilters ? 160 : 80,
        }),
        countReallocationProducts().catch(() => 0),
      ]);
      setProducts(rows);
      setTotalProducts(total);
      setErrorMessage('');
    } catch {
      setProducts([]);
      setErrorMessage('Não consegui carregar o cadastro mestre de produtos.');
    } finally {
      setLoading(false);
    }
  }, []);

  const loadProductAttributes = useCallback(async () => {
    try {
      const [manufacturerRows, classificationRows] = await Promise.all([
        fetchReallocationAttributeSummary('manufacturer'),
        fetchReallocationAttributeSummary('classification'),
      ]);
      setManufacturers(manufacturerRows);
      setClassifications(classificationRows);
    } catch {
      setManufacturers([]);
      setClassifications([]);
      setErrorMessage('Nao consegui carregar fabricantes e classificacoes do cadastro mestre.');
    }
  }, []);

  const loadBranches = useCallback(async () => {
    try {
      setBranches(await fetchPricingBranches());
    } catch {
      setBranches([]);
    }
  }, []);

  const loadMargins = useCallback(async () => {
    try {
      setMarginRules(await fetchPricingMarginRules());
    } catch {
      setMarginRules([]);
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
      void loadProducts('', '', '');
      void loadProductAttributes();
      void loadMargins();
      void loadBranches();
      if (canManageBranches) void loadSuppliers();
    });
  }, [canManageBranches, loadBranches, loadMargins, loadProductAttributes, loadProducts, loadSuppliers]);

  useEffect(() => {
    const timeout = window.setTimeout(() => loadProducts(productSearch, productManufacturerFilter, productClassificationFilter), 300);
    return () => window.clearTimeout(timeout);
  }, [loadProducts, productClassificationFilter, productManufacturerFilter, productSearch]);

  useEffect(() => {
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;

      if (editingProduct) {
        setEditingProduct(null);
        return;
      }
      if (editingProductAttribute) {
        setEditingProductAttribute(null);
        return;
      }
      if (editingMarginRule) {
        setEditingMarginRule(null);
        return;
      }
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
      if (productManufacturerFilter) {
        setProductManufacturerFilter('');
      }
      if (productClassificationFilter) {
        setProductClassificationFilter('');
      }
      if (attributeSearch) {
        setAttributeSearch('');
      }
    };

    window.addEventListener('keydown', handleEscape);
    return () => window.removeEventListener('keydown', handleEscape);
  }, [attributeSearch, editingBranch, editingMarginRule, editingProduct, editingProductAttribute, editingSupplier, productClassificationFilter, productManufacturerFilter, productSearch]);

  const supplierCategories = useMemo(() => Array.from(new Set(suppliers.map((supplier) => supplier.category).filter(Boolean))).length, [suppliers]);
  const logisticsGroups = useMemo(() => Array.from(new Set(branches.map((branch) => branch.logistics_group).filter(Boolean))).length, [branches]);
  const productManufacturerOptions = useMemo(() => manufacturers.map((item) => item.value), [manufacturers]);
  const productClassificationOptions = useMemo(() => classifications.map((item) => item.value), [classifications]);
  const hasProductCatalogFilters = Boolean(productSearch || productManufacturerFilter || productClassificationFilter);
  const activeAttributeField: ReallocationProductAttributeField = activeTab === 'CLASSIFICACOES' ? 'classification' : 'manufacturer';
  const activeAttributeRows = activeAttributeField === 'manufacturer' ? manufacturers : classifications;
  const activeAttributeLabel = activeAttributeField === 'manufacturer' ? 'fabricante' : 'classificacao';
  const filteredAttributes = useMemo(() => {
    const query = attributeSearch.trim().toUpperCase();
    if (!query) return activeAttributeRows;
    return activeAttributeRows.filter((item) => item.value.toUpperCase().includes(query));
  }, [activeAttributeRows, attributeSearch]);
  const filteredAttributeProductCount = useMemo(
    () => filteredAttributes.reduce((sum, item) => sum + item.count, 0),
    [filteredAttributes],
  );
  const marginTaxonomy = useMemo(() => {
    const rows = marginRules.map((rule) => ({
      line: rule.line,
      department: rule.department,
      category: rule.category,
    }));

    productClassificationOptions.forEach((classification) => {
      rows.push(parseClassificationHierarchy(classification));
    });

    return rows
      .map((row) => ({
        line: normalizeMarginTaxonomyLevel(row.line),
        department: normalizeMarginTaxonomyLevel(row.department),
        category: normalizeMarginTaxonomyLevel(row.category),
      }))
      .filter((row) => row.line || row.department || row.category);
  }, [marginRules, productClassificationOptions]);
  const marginLines = useMemo(() => Array.from(new Set(marginTaxonomy.map((row) => row.line).filter(Boolean))).sort(), [marginTaxonomy]);
  const marginDepartments = useMemo(() => {
    return Array.from(new Set(
      marginTaxonomy
        .filter((row) => !marginLineFilter || row.line === marginLineFilter)
        .map((row) => row.department)
        .filter(Boolean),
    )).sort();
  }, [marginLineFilter, marginTaxonomy]);
  const marginCategories = useMemo(() => {
    return Array.from(new Set(
      marginTaxonomy
        .filter((row) => !marginLineFilter || row.line === marginLineFilter)
        .filter((row) => !marginDepartmentFilter || row.department === marginDepartmentFilter)
        .map((row) => row.category)
        .filter(Boolean),
    )).sort();
  }, [marginDepartmentFilter, marginLineFilter, marginTaxonomy]);
  const filteredMarginRules = useMemo(() => {
    const query = marginSearch.trim().toUpperCase();
    return marginRules.filter((rule) => {
      if (marginLineFilter && rule.line !== marginLineFilter) return false;
      if (marginDepartmentFilter && rule.department !== marginDepartmentFilter) return false;
      if (marginCategoryFilter && rule.category !== marginCategoryFilter) return false;
      if (!query) return true;
      return [rule.line, rule.department, rule.category, rule.classification_path]
        .some((value) => String(value || '').toUpperCase().includes(query));
    });
  }, [marginCategoryFilter, marginDepartmentFilter, marginLineFilter, marginRules, marginSearch]);
  const averageDesiredMargin = useMemo(() => {
    if (!filteredMarginRules.length) return 0;
    return filteredMarginRules.reduce((sum, rule) => sum + Number(rule.desired_margin_percent || 0), 0) / filteredMarginRules.length;
  }, [filteredMarginRules]);

  const importProductCatalog = async (file: File) => {
    if (!canManageProducts) {
      alert('Voce pode visualizar os produtos, mas nao importar esse cadastro.');
      return;
    }
    setImporting(true);
    setErrorMessage('');
    try {
      const formData = new FormData();
      formData.append('file', file);
      const response = await fetch('/api/reallocation/products/import', { method: 'POST', headers: await getAuthHeaders(), body: formData });
      const data = await response.json().catch(() => null);
      if (!response.ok) throw new Error(data?.error || 'Erro ao importar cadastro de produtos.');
      alert(`${data.imported || 0} produtos importados. ${data.enriched || 0} produtos enriquecidos. ${data.unmatched || 0} EANs sem vinculo.`);
      await loadProducts(productSearch, productManufacturerFilter, productClassificationFilter);
      await loadProductAttributes();
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : 'Erro desconhecido');
    } finally {
      setImporting(false);
      if (productFileRef.current) productFileRef.current.value = '';
    }
  };

  const editableProduct = (product: ReallocationProduct): ReallocationProductInput => ({
    id: product.id,
    erp_code: product.erp_code,
    ean: product.ean,
    description: product.description,
    manufacturer: product.manufacturer,
    classification: product.classification,
    source_file: product.source_file || 'cadastros',
  });

  const persistProduct = async () => {
    if (!canManageProducts) {
      alert('Voce pode visualizar os produtos, mas nao editar esse cadastro.');
      return;
    }
    if (!editingProduct?.erp_code || !editingProduct.ean || !editingProduct.description) {
      alert('Preencha codigo ERP, EAN e descricao.');
      return;
    }
    await saveReallocationProduct(editingProduct);
    setEditingProduct(null);
    await loadProducts(productSearch, productManufacturerFilter, productClassificationFilter);
    await loadProductAttributes();
  };

  const removeProduct = async (product: ReallocationProduct) => {
    if (!canManageProducts) {
      alert('Voce pode visualizar os produtos, mas nao excluir esse cadastro.');
      return;
    }
    if (!confirm(`Excluir produto ${product.description}?`)) return;
    await deleteReallocationProduct(product.id);
    await loadProducts(productSearch, productManufacturerFilter, productClassificationFilter);
    await loadProductAttributes();
  };

  const persistProductAttribute = async () => {
    if (!canManageProducts) {
      alert('Voce pode visualizar esse cadastro, mas nao editar os produtos vinculados.');
      return;
    }
    if (!editingProductAttribute) return;

    const nextValue = editingProductAttribute.toValue.trim();
    if (!nextValue) {
      alert('Informe o novo nome.');
      return;
    }

    setAttributeSaving(true);
    setErrorMessage('');
    try {
      const normalizedNextValue = nextValue.toUpperCase().replace(/\s+/g, ' ');
      const result = await renameReallocationProductAttribute({
        field: editingProductAttribute.field,
        fromValue: editingProductAttribute.fromValue,
        toValue: nextValue,
      });
      const nextManufacturerFilter = editingProductAttribute.field === 'manufacturer' && productManufacturerFilter === editingProductAttribute.fromValue
        ? normalizedNextValue
        : productManufacturerFilter;
      const nextClassificationFilter = editingProductAttribute.field === 'classification' && productClassificationFilter === editingProductAttribute.fromValue
        ? normalizedNextValue
        : productClassificationFilter;
      setProductManufacturerFilter(nextManufacturerFilter);
      setProductClassificationFilter(nextClassificationFilter);
      setEditingProductAttribute(null);
      await Promise.all([loadProductAttributes(), loadProducts(productSearch, nextManufacturerFilter, nextClassificationFilter)]);
      alert(`${result.updated || 0} produtos atualizados.`);
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : 'Erro desconhecido');
    } finally {
      setAttributeSaving(false);
    }
  };

  const importMarginRules = async (file: File) => {
    if (!canManageMargins) {
      alert('Voce pode visualizar as margens, mas nao importar esse cadastro.');
      return;
    }
    setImporting(true);
    setErrorMessage('');
    try {
      const formData = new FormData();
      formData.append('file', file);
      const response = await fetch('/api/pricing/margins/import', { method: 'POST', headers: await getAuthHeaders(), body: formData });
      const data = await response.json().catch(() => null);
      if (!response.ok) throw new Error(data?.error || 'Erro ao importar regras de margem.');
      alert(`${data.imported || 0} regras de margem importadas. ${data.skipped || 0} linhas ignoradas/duplicadas.`);
      await loadMargins();
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : 'Erro desconhecido');
    } finally {
      setImporting(false);
      if (marginFileRef.current) marginFileRef.current.value = '';
    }
  };

  const editableMarginRule = (rule: PricingMarginRule): PricingMarginRuleInput => ({
    id: rule.id,
    line: rule.line,
    department: rule.department,
    category: rule.category,
    classification_path: rule.classification_path,
    desired_margin_percent: Number(rule.desired_margin_percent || 0),
    desired_markup_percent: Number(rule.desired_markup_percent || 0),
    source_file: rule.source_file || 'cadastros',
    is_active: rule.is_active,
  });

  const persistMarginRule = async () => {
    if (!canManageMargins) {
      alert('Voce pode visualizar as margens, mas nao editar esse cadastro.');
      return;
    }
    if (!editingMarginRule?.line || !editingMarginRule.category) {
      alert('Preencha linha e categoria.');
      return;
    }
    await savePricingMarginRule(editingMarginRule);
    setEditingMarginRule(null);
    await loadMargins();
  };

  const removeMarginRule = async (rule: PricingMarginRule) => {
    if (!canManageMargins) {
      alert('Voce pode visualizar as margens, mas nao excluir esse cadastro.');
      return;
    }
    if (!confirm(`Excluir margem de ${rule.category}?`)) return;
    await deletePricingMarginRule(rule.id);
    await loadMargins();
  };

  const persistBranch = async () => {
    if (!canManageBranches) {
      alert('Voce pode visualizar as lojas, mas nao editar esse cadastro.');
      return;
    }
    if (!editingBranch?.name || !editingBranch.code) {
      alert('Preencha nome e codigo da loja.');
      return;
    }
    await savePricingBranch(editingBranch);
    setEditingBranch(null);
    await loadBranches();
  };

  const removeBranch = async (branch: PricingBranch) => {
    if (!canManageBranches) {
      alert('Voce pode visualizar as lojas, mas nao excluir esse cadastro.');
      return;
    }
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
    <main className="max-w-7xl mx-auto px-4 sm:px-6 py-4 sm:py-5 pb-24 md:pb-8">
      <div className="grid grid-cols-1 gap-4 mb-5 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Produtos mestre" value={totalProducts.toLocaleString('pt-BR')} />
        <StatCard label="Fabricantes" value={manufacturers.length.toLocaleString('pt-BR')} />
        <StatCard label="Classificacoes" value={classifications.length.toLocaleString('pt-BR')} />
        <StatCard label="Regras de margem" value={marginRules.length.toLocaleString('pt-BR')} />
        <StatCard label="Lojas cadastradas" value={branches.length.toLocaleString('pt-BR')} />
        <StatCard label="Grupos logisticos" value={logisticsGroups.toLocaleString('pt-BR')} />
        {canManageBranches && <StatCard label="Fornecedores" value={suppliers.length.toLocaleString('pt-BR')} />}
        {canManageBranches && <StatCard label="Categorias fornecedor" value={supplierCategories.toLocaleString('pt-BR')} />}
        <StatCard label="Lojas ativas" value={branches.filter((branch) => branch.is_active).length.toLocaleString('pt-BR')} />
      </div>

      <div className="mb-5 flex flex-wrap gap-2 rounded-2xl border-2 border-slate-100 bg-white p-2">
        {visibleTabs.map((tab) => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            className={`h-11 px-4 rounded-xl font-black uppercase text-[10px] flex items-center gap-2 ${activeTab === tab ? 'bg-slate-900 text-white' : 'bg-slate-50 text-slate-500'}`}
          >
            {registryTabIcon(tab)}
            {tab}
          </button>
        ))}
      </div>

      {errorMessage && <div className="mb-5 rounded-2xl border-2 border-amber-200 bg-amber-50 p-4 text-sm font-bold text-amber-800">{errorMessage}</div>}

      {activeTab === 'PRODUTOS' && (
        <section className="rounded-[28px] border-2 border-slate-100 bg-white p-4 shadow-sm">
          <div className="relative z-20 mb-4 grid grid-cols-1 gap-3 rounded-[24px] border border-slate-100 bg-white p-2 shadow-[0_12px_28px_rgba(15,23,42,0.04)] xl:grid-cols-[1fr_240px_260px_auto]">
            <div className="relative flex-1">
              <Search size={18} className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400" />
              <input
                value={productSearch}
                onChange={(event) => setProductSearch(event.target.value)}
                placeholder="BUSCAR POR CODIGO ERP, EAN, PRODUTO, FABRICANTE OU CLASSIFICACAO..."
                className="w-full h-12 rounded-2xl bg-slate-50 border-2 border-slate-100 pl-12 pr-4 text-sm font-bold outline-none focus:border-slate-900"
              />
            </div>
            <SearchableSelect
              value={productManufacturerFilter}
              onChange={setProductManufacturerFilter}
              options={productManufacturerOptions}
              placeholder="Todos fabricantes"
            />
            <SearchableSelect
              value={productClassificationFilter}
              onChange={setProductClassificationFilter}
              options={productClassificationOptions}
              placeholder="Todas classificacoes"
            />
            <input
              ref={productFileRef}
              type="file"
              accept=".csv,.xlsx,.xls"
              className="hidden"
              onChange={(event) => {
                const file = event.target.files?.[0];
                if (file) importProductCatalog(file);
              }}
            />
            {canManageProducts ? (
              <div className="flex flex-wrap gap-2">
                {hasProductCatalogFilters && (
                  <button
                    onClick={() => {
                      setProductSearch('');
                      setProductManufacturerFilter('');
                      setProductClassificationFilter('');
                    }}
                    className="h-12 px-4 rounded-2xl bg-slate-100 text-slate-500 font-black uppercase text-[10px]"
                  >
                    Limpar
                  </button>
                )}
                <button onClick={() => productFileRef.current?.click()} disabled={importing} className="h-12 px-4 rounded-2xl bg-slate-900 text-white font-black uppercase text-[10px] flex items-center gap-2 disabled:opacity-50">
                  <Upload size={16} /> {importing ? 'Importando...' : 'Importar base'}
                </button>
                <button onClick={() => setEditingProduct({ ...blankProduct })} className="h-12 px-4 rounded-2xl bg-blue-600 text-white font-black uppercase text-[10px] flex items-center gap-2">
                  <Plus size={16} /> Novo produto
                </button>
              </div>
            ) : (
              <div className="flex items-center gap-2">
                {hasProductCatalogFilters && (
                  <button
                    onClick={() => {
                      setProductSearch('');
                      setProductManufacturerFilter('');
                      setProductClassificationFilter('');
                    }}
                    className="h-12 px-4 rounded-2xl bg-slate-100 text-slate-500 font-black uppercase text-[10px]"
                  >
                    Limpar
                  </button>
                )}
                <span className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-2 text-[10px] font-black uppercase tracking-widest text-slate-500">
                  Somente leitura
                </span>
              </div>
            )}
          </div>

          <div className="relative z-0">
            <DataTable emptyText={loading ? 'Carregando...' : hasProductCatalogFilters ? 'Nenhum produto encontrado para os filtros' : 'Nenhum produto cadastrado'}>
            <thead className="bg-slate-100 text-[10px] uppercase text-slate-600">
              <tr>
                <th className="border border-slate-300 px-3 py-3 text-left">Codigo ERP</th>
                <th className="border border-slate-300 px-3 py-3 text-left">EAN</th>
                <th className="border border-slate-300 px-3 py-3 text-left">Produto</th>
                <th className="border border-slate-300 px-3 py-3 text-left">Fabricante</th>
                <th className="border border-slate-300 px-3 py-3 text-left">Classificacao</th>
                {canManageProducts && <th className="border border-slate-300 px-3 py-3 text-center">Acoes</th>}
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
                  {canManageProducts && (
                    <td className="border border-slate-200 px-3 py-3">
                      <div className="flex justify-center gap-2">
                        <IconButton onClick={() => setEditingProduct(editableProduct(product))}><Save size={15} /></IconButton>
                        <IconButton danger onClick={() => removeProduct(product)}><Trash2 size={15} /></IconButton>
                      </div>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
            </DataTable>
          </div>
        </section>
      )}

      {(activeTab === 'FABRICANTES' || activeTab === 'CLASSIFICACOES') && (
        <section className="rounded-[28px] border-2 border-slate-100 bg-white p-4 shadow-sm">
          <div className="mb-4 flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
            <div>
              <h2 className="font-black uppercase text-xl">{activeTab === 'FABRICANTES' ? 'Fabricantes' : 'Classificacoes'}</h2>
              <p className="text-xs font-bold text-slate-500">
                Visao agrupada do cadastro mestre. Edite o nome aqui para atualizar todos os produtos vinculados.
              </p>
            </div>
            {canManageProducts ? (
              <span className="rounded-2xl border border-blue-100 bg-blue-50 px-4 py-2 text-[10px] font-black uppercase tracking-widest text-blue-700">
                Edicao em massa
              </span>
            ) : (
              <span className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-2 text-[10px] font-black uppercase tracking-widest text-slate-500">
                Somente leitura
              </span>
            )}
          </div>

          <div className="mb-4 grid grid-cols-1 gap-3 lg:grid-cols-[1fr_180px_180px]">
            <div className="relative">
              <Search size={18} className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400" />
              <input
                value={attributeSearch}
                onChange={(event) => setAttributeSearch(event.target.value)}
                placeholder={`BUSCAR ${activeAttributeLabel.toUpperCase()}...`}
                className="w-full h-11 rounded-2xl bg-slate-50 border-2 border-slate-100 pl-12 pr-4 text-sm font-bold outline-none focus:border-slate-900"
              />
            </div>
            <div className="rounded-2xl border border-slate-100 bg-slate-50 px-4 py-2">
              <p className="text-[9px] font-black uppercase text-slate-400">Grupos</p>
              <p className="text-lg font-black text-slate-900">{filteredAttributes.length.toLocaleString('pt-BR')}</p>
            </div>
            <div className="rounded-2xl border border-slate-100 bg-slate-50 px-4 py-2">
              <p className="text-[9px] font-black uppercase text-slate-400">Produtos</p>
              <p className="text-lg font-black text-slate-900">{filteredAttributeProductCount.toLocaleString('pt-BR')}</p>
            </div>
          </div>

          <DataTable emptyText={`Nenhum ${activeAttributeLabel} encontrado`}>
            <thead className="bg-slate-100 text-[10px] uppercase text-slate-600">
              <tr>
                <th className="border border-slate-300 px-3 py-3 text-left">{activeTab === 'FABRICANTES' ? 'Fabricante' : 'Classificacao'}</th>
                <th className="border border-slate-300 px-3 py-3 text-right">Produtos vinculados</th>
                <th className="border border-slate-300 px-3 py-3 text-left">Participacao na base</th>
                <th className="border border-slate-300 px-3 py-3 text-center">Acoes</th>
              </tr>
            </thead>
            <tbody>
              {filteredAttributes.length === 0 && (
                <tr>
                  <td colSpan={4} className="border border-slate-200 px-3 py-8 text-center text-xs font-black uppercase text-slate-400">
                    Nenhum registro encontrado
                  </td>
                </tr>
              )}
              {filteredAttributes.map((item) => {
                const ratio = totalProducts ? item.count / totalProducts : 0;
                const barWidth = Math.min(100, Math.max(4, ratio * 100));
                return (
                  <tr key={`${activeAttributeField}-${item.value}`} className="even:bg-slate-50">
                    <td className="border border-slate-200 px-3 py-3 font-black uppercase">{item.value}</td>
                    <td className="border border-slate-200 px-3 py-3 text-right font-black">{item.count.toLocaleString('pt-BR')}</td>
                    <td className="border border-slate-200 px-3 py-3">
                      <div className="flex items-center gap-3">
                        <div className="h-2 flex-1 rounded-full bg-slate-100">
                          <div className="h-2 rounded-full bg-blue-600" style={{ width: `${barWidth}%` }} />
                        </div>
                        <span className="w-14 text-right text-[10px] font-black text-slate-500">{(ratio * 100).toFixed(1).replace('.', ',')}%</span>
                      </div>
                    </td>
                    <td className="border border-slate-200 px-3 py-3">
                      <div className="flex justify-center gap-2">
                        <IconButton onClick={() => {
                          setProductSearch('');
                          setProductManufacturerFilter(activeAttributeField === 'manufacturer' ? item.value : '');
                          setProductClassificationFilter(activeAttributeField === 'classification' ? item.value : '');
                          setActiveTab('PRODUTOS');
                        }}>
                          <PackageSearch size={15} />
                        </IconButton>
                        {canManageProducts && (
                          <IconButton onClick={() => setEditingProductAttribute({
                            field: activeAttributeField,
                            fromValue: item.value,
                            toValue: item.value,
                            count: item.count,
                          })}
                          >
                            <Pencil size={15} />
                          </IconButton>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </DataTable>
        </section>
      )}

      {activeTab === 'MARGENS' && (
        <section className="rounded-[28px] border-2 border-slate-100 bg-white p-4 shadow-sm">
          <div className="mb-4 flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
            <div>
              <h2 className="font-black uppercase text-xl">Margens</h2>
              <p className="text-xs font-bold text-slate-500">
                Cadastro mestre de margem e markup por linha, departamento e categoria.
              </p>
            </div>
            <input
              ref={marginFileRef}
              type="file"
              accept=".xlsx,.xls"
              className="hidden"
              onChange={(event) => {
                const file = event.target.files?.[0];
                if (file) importMarginRules(file);
              }}
            />
            {canManageMargins ? (
              <div className="flex flex-wrap gap-2">
                <button onClick={() => marginFileRef.current?.click()} disabled={importing} className="h-11 px-4 rounded-2xl bg-slate-900 text-white font-black uppercase text-[10px] flex items-center gap-2 disabled:opacity-50">
                  <Upload size={16} /> {importing ? 'Importando...' : 'Importar XLSX'}
                </button>
                <button onClick={() => setEditingMarginRule({ ...blankMarginRule })} className="h-11 px-4 rounded-2xl bg-blue-600 text-white font-black uppercase text-[10px] flex items-center gap-2">
                  <Plus size={16} /> Nova margem
                </button>
              </div>
            ) : (
              <span className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-2 text-[10px] font-black uppercase tracking-widest text-slate-500">
                Somente leitura
              </span>
            )}
          </div>

          <div className="relative z-20 mb-4 grid grid-cols-1 gap-3 rounded-[24px] border border-slate-100 bg-white p-2 shadow-[0_12px_28px_rgba(15,23,42,0.04)] lg:grid-cols-[1fr_220px_220px_220px_180px]">
            <div className="relative">
              <Search size={18} className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400" />
              <input
                value={marginSearch}
                onChange={(event) => setMarginSearch(event.target.value)}
                placeholder="BUSCAR POR LINHA, DEPARTAMENTO OU CATEGORIA..."
                className="w-full h-11 rounded-2xl bg-slate-50 border-2 border-slate-100 pl-12 pr-4 text-sm font-bold outline-none focus:border-slate-900"
              />
            </div>
            <SearchableSelect
              value={marginLineFilter}
              onChange={(value) => {
                setMarginLineFilter(value);
                setMarginDepartmentFilter('');
                setMarginCategoryFilter('');
              }}
              options={marginLines}
              placeholder="Todas as linhas"
            />
            <SearchableSelect
              value={marginDepartmentFilter}
              onChange={(value) => {
                setMarginDepartmentFilter(value);
                setMarginCategoryFilter('');
              }}
              options={marginDepartments}
              placeholder="Todos departamentos"
            />
            <SearchableSelect value={marginCategoryFilter} onChange={setMarginCategoryFilter} options={marginCategories} placeholder="Todas categorias" />
            <div className="rounded-2xl border border-slate-100 bg-slate-50 px-4 py-2">
              <p className="text-[9px] font-black uppercase text-slate-400">Margem media</p>
              <p className="text-lg font-black text-slate-900">{averageDesiredMargin.toFixed(1).replace('.', ',')}%</p>
            </div>
          </div>

          <div className="relative z-0">
            <DataTable emptyText="Nenhuma regra de margem cadastrada">
              <thead className="bg-slate-100 text-[10px] uppercase text-slate-600">
                <tr>
                  <th className="border border-slate-300 px-3 py-3 text-left">Linha</th>
                  <th className="border border-slate-300 px-3 py-3 text-left">Departamento</th>
                  <th className="border border-slate-300 px-3 py-3 text-left">Categoria</th>
                  <th className="border border-slate-300 px-3 py-3 text-right">Margem desejada %</th>
                  <th className="border border-slate-300 px-3 py-3 text-right">Markup desejado %</th>
                  {canManageMargins && <th className="border border-slate-300 px-3 py-3 text-center">Acoes</th>}
                </tr>
              </thead>
              <tbody>
                {filteredMarginRules.map((rule) => (
                  <tr key={rule.id} className="even:bg-slate-50">
                    <td className="border border-slate-200 px-3 py-3 font-bold uppercase">{rule.line || '-'}</td>
                    <td className="border border-slate-200 px-3 py-3 uppercase">{rule.department || '-'}</td>
                    <td className="border border-slate-200 px-3 py-3 font-black uppercase">{rule.category || '-'}</td>
                    <td className="border border-slate-200 px-3 py-3 text-right font-black">{Number(rule.desired_margin_percent || 0).toFixed(2).replace('.', ',')}%</td>
                    <td className="border border-slate-200 px-3 py-3 text-right font-black">{Number(rule.desired_markup_percent || 0).toFixed(2).replace('.', ',')}%</td>
                    {canManageMargins && (
                      <td className="border border-slate-200 px-3 py-3">
                        <div className="flex justify-center gap-2">
                          <IconButton onClick={() => setEditingMarginRule(editableMarginRule(rule))}><Save size={15} /></IconButton>
                          <IconButton danger onClick={() => removeMarginRule(rule)}><Trash2 size={15} /></IconButton>
                        </div>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </DataTable>
          </div>
        </section>
      )}

      {activeTab === 'LOJAS' && (
        <section className="rounded-[28px] border-2 border-slate-100 bg-white p-4 shadow-sm">
          <div className="flex items-center justify-between gap-3 mb-4">
            <div>
              <h2 className="font-black uppercase text-xl">Lojas</h2>
              <p className="text-xs font-bold text-slate-500">
                Cadastro central de filiais e grupo logistico usado tambem no remanejamento.
              </p>
            </div>
            {canManageBranches ? (
              <button onClick={() => setEditingBranch({ ...blankBranch })} className="h-10 px-4 rounded-2xl bg-slate-900 text-white font-black uppercase text-[10px] flex items-center gap-2">
                <Plus size={15} /> Nova loja
              </button>
            ) : (
              <span className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-2 text-[10px] font-black uppercase tracking-widest text-slate-500">
                Somente leitura
              </span>
            )}
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
            {branches.map((branch) => (
              <RegistryCard
                key={branch.id}
                title={branch.name}
                subtitle={`${branch.code} ${branch.city ? `- ${branch.city}` : ''}`}
                badge={`${branch.logistics_group ? `Grupo ${branch.logistics_group}` : 'Sem grupo'} | ${branch.sends_stock !== false ? 'Envia' : 'Nao envia'} / ${branch.receives_stock !== false ? 'Recebe' : 'Nao recebe'}`}
                active={branch.is_active}
                canEdit={canManageBranches}
                onEdit={() => setEditingBranch(branch)}
                onDelete={() => removeBranch(branch)}
              />
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
                <th className="border border-slate-300 px-3 py-3 text-center">Ações</th>
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

      {editingProduct && (
        <EditorModal title="Produto mestre" onClose={() => setEditingProduct(null)} onSave={persistProduct}>
          <TextInput label="Codigo ERP" value={editingProduct.erp_code} onChange={(value) => setEditingProduct((current) => current ? { ...current, erp_code: value } : current)} />
          <TextInput label="EAN" value={editingProduct.ean} onChange={(value) => setEditingProduct((current) => current ? { ...current, ean: value } : current)} />
          <TextInput label="Descricao" value={editingProduct.description} onChange={(value) => setEditingProduct((current) => current ? { ...current, description: value } : current)} />
          <TextInput label="Fabricante" value={editingProduct.manufacturer} onChange={(value) => setEditingProduct((current) => current ? { ...current, manufacturer: value } : current)} />
          <TextInput label="Classificacao" value={editingProduct.classification} onChange={(value) => setEditingProduct((current) => current ? { ...current, classification: value } : current)} />
          <TextInput label="Fonte" value={editingProduct.source_file || ''} onChange={(value) => setEditingProduct((current) => current ? { ...current, source_file: value || 'cadastros' } : current)} />
        </EditorModal>
      )}

      {editingProductAttribute && (
        <EditorModal
          title={editingProductAttribute.field === 'manufacturer' ? 'Editar fabricante' : 'Editar classificacao'}
          onClose={() => setEditingProductAttribute(null)}
          onSave={persistProductAttribute}
        >
          <div className="rounded-2xl border-2 border-slate-100 bg-slate-50 p-4 md:col-span-2">
            <p className="text-[10px] font-black uppercase tracking-widest text-slate-400">Valor atual</p>
            <p className="mt-1 text-sm font-black uppercase text-slate-900">{editingProductAttribute.fromValue}</p>
            <p className="mt-2 text-xs font-bold text-slate-500">
              Esta alteracao atualiza {editingProductAttribute.count.toLocaleString('pt-BR')} produtos vinculados e recalcula a busca do cadastro mestre.
            </p>
          </div>
          <TextInput
            label={editingProductAttribute.field === 'manufacturer' ? 'Novo fabricante' : 'Nova classificacao'}
            value={editingProductAttribute.toValue}
            onChange={(value) => setEditingProductAttribute((current) => current ? { ...current, toValue: value } : current)}
          />
          <div className="rounded-2xl border-2 border-blue-100 bg-blue-50 p-4">
            <p className="text-[10px] font-black uppercase tracking-widest text-blue-700">Efeito</p>
            <p className="mt-1 text-xs font-bold text-blue-900">
              Produtos, remanejamento e buscas passam a usar o novo nome assim que salvar.
            </p>
            {attributeSaving && <p className="mt-2 text-[10px] font-black uppercase text-blue-700">Salvando...</p>}
          </div>
        </EditorModal>
      )}

      {editingMarginRule && (
        <EditorModal title="Regra de margem" onClose={() => setEditingMarginRule(null)} onSave={persistMarginRule}>
          <TextInput label="Linha" value={editingMarginRule.line} onChange={(value) => setEditingMarginRule((current) => current ? { ...current, line: value } : current)} />
          <TextInput label="Departamento" value={editingMarginRule.department} onChange={(value) => setEditingMarginRule((current) => current ? { ...current, department: value } : current)} />
          <TextInput label="Categoria" value={editingMarginRule.category} onChange={(value) => setEditingMarginRule((current) => current ? { ...current, category: value } : current)} />
          <TextInput label="Caminho classificacao" value={editingMarginRule.classification_path} onChange={(value) => setEditingMarginRule((current) => current ? { ...current, classification_path: value } : current)} />
          <TextInput label="Margem desejada %" value={String(editingMarginRule.desired_margin_percent || 0)} onChange={(value) => setEditingMarginRule((current) => current ? { ...current, desired_margin_percent: numericInput(value) } : current)} />
          <TextInput label="Markup desejado %" value={String(editingMarginRule.desired_markup_percent || 0)} onChange={(value) => setEditingMarginRule((current) => current ? { ...current, desired_markup_percent: numericInput(value) } : current)} />
          <TextInput label="Fonte" value={editingMarginRule.source_file || ''} onChange={(value) => setEditingMarginRule((current) => current ? { ...current, source_file: value || 'cadastros' } : current)} />
          <ToggleInput label="Regra ativa" checked={editingMarginRule.is_active} onChange={(checked) => setEditingMarginRule((current) => current ? { ...current, is_active: checked } : current)} />
        </EditorModal>
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
          <ToggleInput label="Envia estoque" checked={editingBranch.sends_stock !== false} onChange={(checked) => setEditingBranch((current) => current ? { ...current, sends_stock: checked } : current)} />
          <ToggleInput label="Recebe estoque" checked={editingBranch.receives_stock !== false} onChange={(checked) => setEditingBranch((current) => current ? { ...current, receives_stock: checked } : current)} />
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
          <TextInput label="Observações" value={editingSupplier.condition_notes} onChange={(value) => setEditingSupplier((current) => current ? { ...current, condition_notes: value } : current)} />
          <ToggleInput label="Fornecedor ativo" checked={editingSupplier.is_active} onChange={(checked) => setEditingSupplier((current) => current ? { ...current, is_active: checked } : current)} />
        </EditorModal>
      )}
    </main>
  );
}

function registryTabIcon(tab: RegistryTab) {
  switch (tab) {
    case 'PRODUTOS':
      return <PackageSearch size={15} />;
    case 'FABRICANTES':
      return <Factory size={15} />;
    case 'CLASSIFICACOES':
      return <Layers3 size={15} />;
    case 'MARGENS':
      return <Save size={15} />;
    case 'LOJAS':
      return <Building2 size={15} />;
    case 'FORNECEDORES':
      return <Truck size={15} />;
    default:
      return null;
  }
}

function parseClassificationHierarchy(classificationPath: string) {
  const parts = String(classificationPath || '')
    .split('>')
    .map((part) => normalizeMarginTaxonomyLevel(part))
    .filter(Boolean)
    .filter((part) => part !== 'PRINCIPAL');

  return {
    line: parts[0] || '',
    department: parts.length >= 3 ? parts[1] : '',
    category: parts.length >= 2 ? parts[parts.length - 1] : (parts[0] || ''),
  };
}

function normalizeMarginTaxonomyLevel(value: string) {
  const normalized = String(value || '').trim().toUpperCase().replace(/\s+/g, ' ');
  if (!normalized || normalized.length < 2) return '';
  return normalized;
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

function RegistryCard({ title, subtitle, badge, active, canEdit = true, onEdit, onDelete }: { title: string; subtitle: string; badge: string; active: boolean; canEdit?: boolean; onEdit: () => void; onDelete: () => void }) {
  return (
    <div className={`rounded-2xl border-2 p-4 ${active ? 'border-slate-100 bg-slate-50' : 'border-red-100 bg-red-50'}`}>
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="font-black uppercase text-slate-900">{title}</p>
          <p className="text-[10px] font-black uppercase text-slate-400">{subtitle}</p>
          <p className="text-[10px] font-black text-blue-600 mt-1">{badge}</p>
          <p className={`text-[9px] font-black uppercase mt-2 ${active ? 'text-green-600' : 'text-red-600'}`}>{active ? 'Ativa' : 'Inativa'}</p>
        </div>
        {canEdit && (
          <div className="flex gap-1">
            <IconButton onClick={onEdit}><Save size={15} /></IconButton>
            <IconButton danger onClick={onDelete}><Trash2 size={15} /></IconButton>
          </div>
        )}
      </div>
    </div>
  );
}

function EditorModal({ title, children, onClose, onSave }: { title: string; children: ReactNode; onClose: () => void; onSave: () => void }) {
  return (
    <div className="fixed inset-0 z-[90] flex items-center justify-center bg-slate-900/16 p-3 backdrop-blur-sm">
      <div className="w-full max-w-4xl overflow-visible rounded-[30px] border border-slate-200 bg-white shadow-[0_24px_70px_rgba(15,23,42,0.22)]">
        <div className="flex items-center justify-between border-b-2 border-slate-100 px-5 py-4">
          <div>
            <h2 className="text-xl font-black uppercase italic tracking-tighter">{title}</h2>
            <p className="text-[10px] font-black uppercase tracking-widest text-blue-600">Cadastro operacional</p>
          </div>
          <button onClick={onClose} className="flex h-10 w-10 items-center justify-center rounded-2xl bg-slate-100 text-slate-700 transition hover:bg-slate-200"><X size={21} /></button>
        </div>
        <div className="grid grid-cols-1 gap-3 px-5 py-4 md:grid-cols-2">{children}</div>
        <div className="flex justify-end gap-3 border-t-2 border-slate-100 px-5 py-4">
          <button onClick={onClose} className="h-12 min-w-[160px] rounded-2xl bg-slate-100 text-xs font-black uppercase text-slate-500 transition hover:bg-slate-200">Cancelar</button>
          <button onClick={onSave} className="flex h-12 min-w-[220px] items-center justify-center gap-2 rounded-2xl bg-blue-600 text-xs font-black uppercase text-white transition hover:bg-blue-700">
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

function SearchableSelect({ value, options, placeholder, onChange }: { value: string; options: string[]; placeholder: string; onChange: (value: string) => void }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const containerRef = useRef<HTMLDivElement>(null);
  const filteredOptions = useMemo(() => {
    const normalizedQuery = query.trim().toUpperCase();
    if (!normalizedQuery) return options;
    return options.filter((option) => option.toUpperCase().includes(normalizedQuery));
  }, [options, query]);
  const visibleOptions = filteredOptions.slice(0, 80);

  useEffect(() => {
    if (!open) return;

    const handlePointerDown = (event: MouseEvent) => {
      if (!containerRef.current?.contains(event.target as Node)) {
        setOpen(false);
      }
    };

    document.addEventListener('mousedown', handlePointerDown);
    return () => document.removeEventListener('mousedown', handlePointerDown);
  }, [open]);

  const selectOption = (nextValue: string) => {
    onChange(nextValue);
    setQuery('');
    setOpen(false);
  };

  return (
    <div ref={containerRef} className="relative min-w-0">
      <button
        type="button"
        onClick={() => setOpen((current) => !current)}
        title={value || placeholder}
        className={`flex min-h-12 w-full items-center justify-between gap-3 rounded-2xl border-2 px-4 py-2 text-left text-[11px] font-black uppercase leading-snug outline-none transition ${open || value ? 'border-slate-900 bg-white text-slate-900' : 'border-slate-100 bg-slate-50 text-slate-500 hover:border-slate-200'}`}
      >
        <span className="min-w-0 whitespace-normal break-words">{value || placeholder}</span>
        <ChevronDown size={16} className={`shrink-0 transition ${open ? 'rotate-180 text-blue-600' : 'text-slate-400'}`} />
      </button>

      {open && (
        <div className="absolute left-0 top-full z-[80] mt-2 w-[min(560px,calc(100vw-2rem))] min-w-full overflow-hidden rounded-2xl border-2 border-slate-100 bg-white shadow-[0_24px_60px_rgba(15,23,42,0.18)]">
          <div className="border-b border-slate-100 p-2">
            <div className="relative">
              <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
              <input
                autoFocus
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Pesquisar..."
                className="h-10 w-full rounded-xl border-2 border-slate-100 bg-slate-50 pl-10 pr-3 text-xs font-bold uppercase text-slate-700 outline-none focus:border-slate-900"
              />
            </div>
          </div>

          <div className="max-h-72 overflow-auto p-2">
            <button
              type="button"
              onClick={() => selectOption('')}
              className={`mb-1 flex w-full items-center justify-between rounded-xl px-3 py-2 text-left text-[11px] font-black uppercase transition ${!value ? 'bg-slate-900 text-white' : 'text-slate-600 hover:bg-slate-50'}`}
            >
              <span className="whitespace-normal break-words">{placeholder}</span>
              {!value && <Check size={14} />}
            </button>

            {visibleOptions.map((option) => (
              <button
                key={option}
                type="button"
                onClick={() => selectOption(option)}
                className={`flex w-full items-start justify-between gap-3 rounded-xl px-3 py-3 text-left text-[11px] font-black uppercase leading-snug transition ${value === option ? 'bg-blue-600 text-white' : 'text-slate-600 hover:bg-slate-50'}`}
                title={option}
              >
                <span className="min-w-0 whitespace-normal break-words">{option}</span>
                {value === option && <Check size={14} className="mt-0.5 shrink-0" />}
              </button>
            ))}

            {filteredOptions.length === 0 && (
              <p className="px-3 py-6 text-center text-[11px] font-black uppercase text-slate-400">
                Nenhuma opcao encontrada
              </p>
            )}
          </div>

          {filteredOptions.length > visibleOptions.length && (
            <div className="border-t border-slate-100 bg-slate-50 px-3 py-2 text-[10px] font-black uppercase text-slate-400">
              Mostrando {visibleOptions.length.toLocaleString('pt-BR')} de {filteredOptions.length.toLocaleString('pt-BR')}. Pesquise para refinar.
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function numericInput(value: string) {
  const numeric = Number(value.replace(/[^\d,.-]/g, '').replace(',', '.'));
  return Number.isFinite(numeric) ? numeric : 0;
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
