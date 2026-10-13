# Diagnostico do remanejamento - 13/10/2026

## Resultado principal

O gargalo observado foi a leitura do estoque, nao o calculo. A ultima base
disponivel tinha 121.411 registros. Usando a mesma paginacao da API atual:

| Etapa | Medicao local |
| --- | --- |
| Leitura completa do estoque | 101,36 s, 122 consultas sequenciais |
| Logistica das lojas | 0,31 s |
| Calculo TypeScript | mediana 1,16 s, 3 execucoes |
| Serializacao da resposta | 7,08 ms |
| Resposta de sugestoes | 2,59 MB, 2.835 sugestoes |

Esta foi uma medicao local, com leitura somente, de uma base historica.
Regras representativas: seguranca 20 dias, meta 30 dias, rota 3, piso 0,
estoque minimo desligado e sem filtros de lojas/produtos. Nao representa
necessariamente os filtros selecionados no navegador. Autenticacao,
filtros de atributos, transferencia ao navegador e renderizacao nao estao
incluidos. Os tempos variam com rede, base, filtros e maquina.

Uma segunda leitura limitada a 10 paginas levou 13,12 s para 10.000 linhas.
Nao extrapolar esse tempo como uma medicao da base completa. Nenhum produto,
credencial ou conteudo importado foi salvo nos relatorios.

## Comparacao dos motores existentes

20 cenarios controlados foram comparados com o calculador TypeScript atual:

- `scripts/reallocation-engine.py`: 10/20 iguais no contrato de resposta.
- `api/reallocation-suggestions.py`: 2/20 iguais no contrato de resposta.

O primeiro ainda diverge em piso global, estoque minimo, complemento de
quantidades, dias sem compra/venda, tipo de necessidade, fornecedor,
arredondamento e identificador de grupos de empate. O segundo tambem tem
regras antigas de rotas, permissao das lojas e disponibilidade da origem.
Uma divergencia de identificador/texto nao significa necessariamente
quantidade diferente; os caminhos exatos estao no JSON de comparacao.

Benchmark sintetico: 20 lojas por produto, uma execucao de aquecimento e
cinco amostras por carga. Sem banco, rede, inicializacao do Python ou tela:

| Linhas | TypeScript | Python do script | Mesmas alocacoes |
| --- | --- | --- | --- |
| 5.000 | 142 ms | 117 ms | Sim |
| 25.000 | 1.267 ms | 1.421 ms | Sim |
| 100.000 | 5.600 ms | 5.980 ms | Sim |
| 100.000 com piso 15 | 5.581 ms | 6.949 ms | Nao |

O Python legado parece mais rapido, mas faz menos verificacoes e produz
outros resultados. Nao e uma comparacao equivalente. O TypeScript foi
carregado da rota de producao em uma VM; estes tempos sao diagnosticos
locais, nao uma previsao do ambiente publicado. Igualdade nas cargas
grandes verifica alocacoes/totais, enquanto os 20 casos verificam todos os
campos retornados, com tolerancia numerica de 8 casas decimais.

## Instrumentacao adicionada

A resposta autenticada da API inclui `timings` e o cabecalho `Server-Timing`:
autenticacao, leitura da requisicao, validacao da base, leitura do estoque,
atributos, logistica, calculo e serializacao. As consultas e regras nao
foram modificadas. Requisicoes negadas continuam sem acesso ao banco.

O navegador registra `[remanejamento:tempos]` no console, somente com tempos
e contagens. A medicao ate dois frames apos a resposta e uma aproximacao
do processamento/atualizacao da tela; abas em segundo plano podem distorce-la.
Ela nao substitui um perfil de renderizacao. Nenhuma captura real do tempo
de renderizacao do usuario foi feita nesta etapa.

## Como repetir

```powershell
npm run diagnose:reallocation
npm run diagnose:reallocation -- --fixtures-only
npm run diagnose:reallocation -- --fixtures-only --require-parity
npm run diagnose:reallocation:live
```

O teste de paridade estrita retorna erro enquanto houver divergencias:
isso e esperado nos motores Python atuais. Python deve estar instalado;
`REALLOCATION_PYTHON` permite informar outro executavel. O diagnostico real
usa `.env.local`, permite apenas GET/HEAD e limita bases acima de 100.000
linhas a uma amostra de 10 paginas. `--full-stock` solicita leitura completa.
O comparador atualiza o JSON principal; a leitura real gera relatorio de
base completa ou de amostra, em arquivos separados.

## Proxima etapa recomendada

1. Reduzir leituras completas e consultas sequenciais: estudar filtros no
   servidor/banco e transferencia apenas dos registros necessarios.
2. Preservar os resultados de referencia ao otimizar a leitura. Considerar
   todas as origens/destinos necessarios e produtos sem vendas/estoque.
3. Atualizar um unico motor Python e exigir paridade de quantidades,
   prioridades, reservas, empates e contrato da resposta.
4. Medir novamente calculo e transporte com entradas equivalentes.
5. Confirmar como o Python sera executado na hospedagem, tratar falhas e
   validar a reversao antes de mudar o motor ativo.

O sistema continua usando TypeScript. Nenhuma migracao ou alteracao de dados
foi executada nesta etapa.
