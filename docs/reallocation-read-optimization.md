# Otimizacao da leitura do remanejamento - 13/10/2026

## Implementado

- Indice `(snapshot_id, id)` aplicado no Supabase e registrado na migracao
  `20261013161619_reallocation_stock_cursor_index.sql`.
- Paginacao por cursor, com ate 4 consultas simultaneas. Sem OFFSET.
- Leitura integral dividida em quatro intervalos UUID contiguos e sem
  sobreposicao; resultados reunidos na ordem crescente original dos IDs.
- Produtos selecionados aplicados na consulta em lotes de ate 200 EANs.
- Quando ambas as listas de lojas sao explicitas, busca somente a uniao
  das origens e destinos. Uma lista vazia continua significando todas as
  lojas daquele lado. Codigos antigos sem zero inicial continuam aceitos.
- Somente as colunas utilizadas no calculo sao transferidas.
- Leitura do cadastro para atributos tambem paralelizada; quando ha EANs
  explicitos, apenas esses produtos precisam ser analisados.
- Normalizacao de fabricante/classificacao preservada no servidor. Nao
  substituir por ILIKE bruto, que pode alterar o tratamento de acentos.
- Logistica e busca de atributos independentes iniciadas em paralelo.
- Nenhum cache de estoque adicionado. Falhas cancelam as demais consultas
  e rejeitam a leitura, em vez de produzir sugestoes com uma base parcial.

## Medicoes locais

Mesma base de 121.411 registros; tempos incluem rede e variam por ambiente.
Comparacao com a medicao anterior de 101,36 s para a leitura integral:

| Cenario | Linhas carregadas | Tempo de leitura | Consultas |
| --- | --- | --- | --- |
| Base completa otimizada | 121.411 | 12,35 s | 124, ate 4 simultaneas |
| Uma origem e um destino | 11.506 | 1,71 s | 12 |
| Mesmas lojas e 100 produtos | 185 | 0,60 s | 1 |
| Atributo e produtos explicitos | 18 | 0,71 s | 2 |

A leitura integral fez mais duas consultas devido as fronteiras dos
intervalos, mas deixou de aguardar cada pagina sequencialmente.
O ganho observado na leitura integral foi de aproximadamente 8,2 vezes.
Nao significa que todas as requisicoes ou filtros tenham o mesmo ganho.

O banco confirmou o uso do novo indice no EXPLAIN ANALYZE, sem ordenar
toda a base antes de retornar cada pagina. Nao foram alteradas politicas
de acesso, dados importados, regras do motor ou configuracoes globais do banco.

## Equivalencia e limites

- Contagem, unicidade e checksum dos IDs da leitura completa conferidos
  com uma consulta SQL independente no Supabase.
- Sugestoes dos filtros comparadas com o mesmo motor usando a base
  completa: mesmos campos de negocio e mesma ordem dentro de cada produto,
  com piso global e estoque minimo ativados.
- Os dois cenarios de lojas geraram 43 sugestoes equivalentes; o cenario
  de atributo nao gerou sugestoes nos dois caminhos.
- Ao excluir lojas irrelevantes, a primeira aparicao de um produto pode
  mudar. Assim, a ordem ENTRE produtos e o sufixo de indice global dos IDs
  das sugestoes podem mudar. Os testes preservam a identidade de rota e
  comparam todos os demais campos; nao escondem diferencas de quantidade,
  prioridade, empate, reserva ou ordem dentro do produto.
- Contadores de diagnostico anteriores ao agrupamento refletem agora
  as linhas efetivamente carregadas com filtros, nao toda a base original.
- Cadastro filtrado somente por fabricante/classificacao ainda precisa
  ler os atributos para preservar a normalizacao atual, mas em paralelo.

25 testes passaram, incluindo fronteiras UUID, varias paginas por intervalo,
EANs repetidos e em lotes, lojas antigas, selecao parcial de lojas, zero de
estoque, falhas, cursores invalidos e equivalencia do calculo. Verificacao
de tipos e compilacao completa tambem passaram.

## Repetir a verificacao

```powershell
node --test scripts/reallocation-read.test.cjs scripts/reallocation-minimum-stock.test.cjs scripts/reallocation-timings.test.cjs
npm run diagnose:reallocation:reads
```

O benchmark real aceita `--expected-id-digest` para conferir um checksum
obtido independentemente no banco. Ele permite somente GET/HEAD e salva
apenas contagens, tempos e checksum em `reallocation-read-optimization.json`.
Usa uma base historica para comparar desempenho, sem contornar a validacao
de idade/setor das requisicoes normais da API.

O indice ja esta aplicado no projeto Supabase conectado. As mudancas de
codigo precisam ser publicadas normalmente para chegar ao ambiente remoto.
