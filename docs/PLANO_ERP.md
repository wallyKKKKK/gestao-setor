# Plano de evolucao para ERP proprio

## Objetivo

Transformar o sistema atual em um ERP modular para gestao interna da rede, evoluindo sem reescrever tudo do zero. A prioridade e consolidar uma base mestre confiavel, depois estoque e movimentos, depois compras/precos/ofertas, e por ultimo PDV/caixa e camadas fiscais.

## Decisao de arquitetura

O sistema atual deve continuar sendo a base do projeto. A evolucao precisa acontecer por modulos, com contratos claros entre eles.

Principios:

- Cadastro mestre e a fonte oficial de produtos, lojas, fabricantes e classificacoes.
- Estoque deve ser tratado como movimento, nao apenas como planilha importada.
- Importacoes continuam existindo, mas passam a alimentar processos controlados.
- Todo modulo critico precisa registrar auditoria.
- Permissoes devem ser por modulo, setor e acao.
- PDV/caixa so entra depois de cadastro, preco e estoque estarem confiaveis.

## Modulos atuais que viram partes do ERP

| Modulo atual | Papel no ERP | Status desejado |
| --- | --- | --- |
| Cadastros | Base mestre | Virar centro oficial de produtos, lojas, fabricantes, linhas, departamentos e categorias |
| Price | Gestao de precos e ofertas | Preco por loja, grupos promocionais, exportacao para ERP externo enquanto necessario |
| Remanejamento | Transferencia interna | Usar estoque atual/snapshots e gerar pedidos de transferencia rastreaveis |
| Pre-vencidos | Oferta por validade | Processo temporario: importar, calcular, relatorio e exportar desconto |
| Compras IA | Inteligencia de compra | Comparar fornecedores, estoque, venda e oportunidades |
| Tarefas | Operacao e workflow | Controle de rotinas, status, prioridade e cronogramas |
| Reunioes | Agenda corporativa | Agenda interna com Google Calendar como integracao opcional |
| Auditoria | Seguranca e rastreabilidade | Registro central de acoes sensiveis |
| Notificacoes | Comunicacao operacional | Avisos internos e eventos do sistema |

## Fase 1: Base mestre

Meta: fazer o sistema ter uma fonte unica e confiavel para dados principais.

Entidades principais:

- Produtos
- EANs e codigos ERP
- Fabricantes
- Linha
- Departamento
- Categoria
- Lojas/unidades de negocio
- Setores
- Usuarios e permissoes

Entregas:

1. Padronizar cadastro de produtos como fonte oficial.
2. Garantir que Price, Remanejamento, Pre-vencidos e Compras usem a mesma base de produtos.
3. Garantir que lojas fiquem salvas no banco e visiveis para todos, com edicao restrita.
4. Criar tela/fluxo de manutencao de fabricante, linha, departamento e categoria.
5. Criar rotina de importacao mestre com relatorio de divergencias.

Risco principal:

- Produtos iguais com EAN/codigo ERP divergente.
- Fabricantes duplicados por grafia diferente.
- Classificacao incompleta vinda de planilhas diferentes.

## Fase 2: Estoque central

Meta: deixar de depender apenas de planilhas soltas e criar um nucleo de estoque.

Entidades sugeridas:

- inventory_snapshots: importacoes de estoque por usuario/setor/processo.
- inventory_snapshot_items: linhas importadas do estoque.
- inventory_current: estoque atual consolidado por loja/produto.
- inventory_movements: movimentos de entrada, saida, venda, transferencia, ajuste e importacao.
- transfer_orders: pedidos de transferencia gerados pelo remanejamento.
- transfer_order_items: itens de cada pedido de transferencia.

Regras:

- Importacao pode ser individual ou por setor, conforme modulo.
- Remanejamento deve usar snapshot valido.
- Exportar transferencia deve gerar pedido rastreavel.
- Ajuste manual de transferencia nao pode sumir ao trocar de aba.

## Fase 3: Compras e fornecedores

Meta: estruturar compra por oportunidade, cotacao e reposicao.

Entidades sugeridas:

- suppliers
- supplier_catalogs
- supplier_catalog_items
- purchase_quotes
- purchase_quote_items
- purchase_orders
- purchase_order_items

Entregas:

1. Importacao livre de ofertas de fornecedores.
2. Comparacao de preco por EAN/produto.
3. Melhor oportunidade considerando preco, estoque, venda, prazo e fornecedor.
4. Exportacao de pedido de compra.
5. Historico de compras por produto/fornecedor.

## Fase 4: Precos, ofertas e margens

Meta: transformar Price em motor de precificacao.

Entidades sugeridas:

- price_lists
- price_list_items
- promotion_groups
- promotion_group_items
- margin_rules
- competitor_prices
- offer_exports

Entregas:

1. Preco por loja.
2. Oferta por grupo promocional.
3. Exportacao TXT por loja e por tipo.
4. Margem planejada por linha/departamento/categoria.
5. Analise de margem real quando houver venda integrada.

## Fase 5: Pre-vencidos consolidado

Meta: manter o fluxo simples e rastreavel.

Fluxo oficial:

1. Criar regra.
2. Importar arquivo.
3. Calcular.
4. Ver relatorio.
5. Exportar TXT de desconto.
6. Esquecer arquivo importado do processo.

Regras:

- Arquivo importado nao deve virar base permanente.
- Regras ficam salvas no banco.
- Usuario pode ativar/desativar regras apenas para a importacao atual.
- Exportacao pode ser arquivo unico ou separado por loja em ZIP.

## Fase 6: PDV / Caixa

Meta: criar ferramenta de venda conectada ao estoque da loja.

Nao iniciar antes de cadastro, preco e estoque estarem maduros.

Entidades sugeridas:

- sales
- sale_items
- cash_registers
- cash_sessions
- payment_methods
- sale_payments
- cash_movements
- customers

Fluxo minimo:

1. Abrir caixa.
2. Buscar produto por EAN/codigo/descricao.
3. Aplicar preco da loja/oferta vigente.
4. Finalizar venda.
5. Baixar estoque.
6. Registrar forma de pagamento.
7. Fechar caixa.

Fora do escopo inicial:

- Emissao fiscal completa.
- NFC-e/NF-e.
- TEF integrado.
- PBM transacional.
- SNGPC.

Esses pontos devem entrar apenas quando o ERP operacional estiver estavel.

## Fase 7: Fiscal e financeiro

Meta: avaliar integracoes e obrigacoes legais.

Possiveis caminhos:

- Integrar com sistema fiscal existente.
- Usar API fiscal homologada.
- Manter exportacao para ERP externo por um periodo.
- So depois criar emissao fiscal propria, se fizer sentido tecnico e juridico.

## Permissoes

Permissoes devem ser por modulo e acao:

- visualizar
- criar
- editar
- excluir
- importar
- exportar
- aprovar
- administrar

Exemplos:

- Todos podem visualizar lojas.
- Apenas admin/gestores editam lojas.
- Todos os setores liberados podem importar estoque para remanejamento.
- Precificacao gerencia Price, Margens e Pre-vencidos.
- Auditoria apenas admin.

## Auditoria obrigatoria

Registrar:

- Login e bloqueios de permissao.
- Criacao/edicao/exclusao de cadastro mestre.
- Importacoes.
- Exportacoes.
- Alteracoes de preco.
- Confirmacao de transferencia.
- Criacao e fechamento de caixa futuramente.
- Alteracoes de permissoes.

## Integracoes externas

Curto prazo:

- Importacao/exportacao TXT, CSV e XLSX.
- Google Calendar para reunioes.
- Fornecedores por planilha ou catalogo exportado.

Medio prazo:

- APIs de fornecedores quando disponiveis.
- BI interno.
- Integracao fiscal/financeira.

## Primeiras entregas recomendadas

1. Criar mapa de entidades do ERP e conferir tabelas atuais.
2. Definir base mestre oficial de produtos e lojas.
3. Criar nucleo de estoque: snapshots, estoque atual e movimentos.
4. Adaptar remanejamento para usar o nucleo de estoque sem perder processos manuais.
5. Consolidar Price como precificacao por loja e grupo promocional.
6. Manter Pre-vencidos como processo temporario com regras salvas.

## Proxima tarefa tecnica

A proxima implementacao recomendada e criar o nucleo de estoque do ERP:

- SQL inicial para inventory_snapshots, inventory_snapshot_items, inventory_current e inventory_movements.
- Tipos TypeScript dessas entidades.
- Service central para registrar importacao e movimento de estoque.
- Sem mudar ainda a interface do usuario.

Isso cria a base para remanejamento, compras, pre-vencidos e futuramente PDV.
